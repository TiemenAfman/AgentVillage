// The island as its own window.
//
// This is a shell, not a second viewer. The window is a WebView2 pointed at the islander
// that is already the island - http://localhost:4747/ - exactly as Chrome's --app window
// shows it. Nothing under web/ is bundled, built or copied: the page keeps its
// import map, api.js keeps working out `mine()` from its own URL, and lib/access.mjs sees a
// loopback socket with a matching Host and Origin, the same as from any browser. Bundling
// web/ into the app was the scaffold's default and would have broken all three of those at
// once - Plans/eiland-als-desktop-app.md has the full reasoning.
//
// What the shell adds over a browser is the one thing a browser cannot do: make sure the
// service is there before showing it. The window opens on a splash of its own (splash/),
// the splash asks Rust to `start_island`, and Rust probes the port, starts serve.mjs if
// nothing answers, waits, and then navigates the same webview to the island. From then on
// the page is on its own and this side only has two jobs left: sending links to other sites
// to the system browser, and keeping the window itself on the island.
#[allow(dead_code)] // shared with the islander exe, which uses the other half of it
mod island;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder};

/// Tauri's own default (the msWebOOUI/msPdfOOUI/msSmartScreenProtection set) has to be
/// repeated here, because `additional_browser_args` replaces it rather than adding to it.
/// --force-high-performance-gpu because on a laptop with two graphics cards Chromium picks the integrated one to save
/// power, and on this machine that is the card whose driver keeps falling over.
const BROWSER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --force-high-performance-gpu";

/// How long a freshly started islander gets to open its port. A cold start does a full scan
/// before it listens, and a village of a few hundred sessions takes a while to read.
const STARTUP_TIMEOUT: Duration = Duration::from_secs(60);

struct Island {
    plan: Mutex<island::Plan>,
    /// One bring-up at a time: a second Try again while the first is still waiting would
    /// start a second node, and although serve.mjs exits quietly on EADDRINUSE, the two
    /// racing for the port is not a thing worth allowing.
    busy: AtomicBool,
}

#[derive(serde::Serialize, Clone)]
struct Failed {
    message: String,
    log: Option<String>,
}

/// Called by the splash as soon as it is listening, and again from its Try again button.
/// The splash asks rather than Rust starting on its own so that no event can be emitted
/// before there is a listener for it - the "no folder" failure is immediate, and an event
/// with nobody listening is simply gone.
#[tauri::command]
fn start_island(app: AppHandle) {
    bring_up(app);
}

#[tauri::command]
fn open_log(app: AppHandle) -> Result<(), String> {
    let path = app
        .state::<Island>()
        .plan
        .lock()
        .map_err(|e| e.to_string())?
        .log_path()
        .ok_or_else(|| "this window does not know where the island's folder is".to_string())?;
    tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| e.to_string())
}

fn bring_up(app: AppHandle) {
    let state = app.state::<Island>();
    if state.busy.swap(true, Ordering::SeqCst) {
        return;
    }
    let plan = match state.plan.lock() {
        Ok(p) => p.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    };

    std::thread::spawn(move || {
        let say = |m: String| {
            let _ = app.emit("island:status", m);
        };
        let fail = |m: String| {
            let log = plan.log_path().map(|p| p.display().to_string());
            let _ = app.emit("island:failed", Failed { message: m, log });
        };

        if plan.remote {
            say(format!("Sailing to {}", plan.url));
            show(&app, &plan.url);
        } else {
            say(format!("Looking for the island on port {}", plan.port));
            if island::listening(plan.port) {
                show(&app, &plan.url);
            } else if let Some(root) = plan.root.as_deref() {
                say(format!("Starting the island from {}", root.display()));
                match island::start(root, plan.port) {
                    Err(e) => fail(e),
                    Ok(()) => match island::wait(plan.port, STARTUP_TIMEOUT) {
                        Some(_) => show(&app, &plan.url),
                        None => fail(format!(
                            "The island was started but did not answer on port {} within a \
                             minute. Its own log has what it said.",
                            plan.port
                        )),
                    },
                }
            } else {
                fail(format!(
                    "Nothing is listening on port {}, and this window does not know where the \
                     island's folder is. Start the island yourself (promptholm-island.exe), or set \
                     SETTLERS_ROOT to the checkout and try again.",
                    plan.port
                ));
            }
        }

        app.state::<Island>().busy.store(false, Ordering::SeqCst);
    });
}

/// Point the one window at the island. Safe from any thread: navigate() is dispatched to
/// the main thread by the runtime.
fn show(app: &AppHandle, url: &str) {
    let Some(win) = app.get_webview_window("main") else { return };
    if let Ok(u) = Url::parse(url) {
        let _ = win.navigate(u);
    }
}

/// Where this window may go: the splash (tauri:// in general, http://tauri.localhost on
/// Windows), this machine, and the island it was pointed at. Anywhere else is a link on a
/// noticeboard - a Jira ticket, a pull request, a Remote repo - and belongs in the system
/// browser, not in place of the island with no back button.
fn stays_here(url: &Url, own_host: &str) -> bool {
    if matches!(url.scheme(), "tauri" | "about" | "blob" | "data") {
        return true;
    }
    let host = url.host_str().unwrap_or("");
    matches!(host, "tauri.localhost" | "ipc.localhost" | "localhost" | "127.0.0.1" | "::1")
        || (!own_host.is_empty() && host.eq_ignore_ascii_case(own_host))
}

fn open_elsewhere(url: &Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // A second copy of this exe, started by the first to start node and get out of the way.
    // It never builds a window; see island::start for why there is a go-between at all.
    if island::spawn_if_asked() {
        return;
    }

    let plan = island::plan();
    let own_host = Url::parse(&plan.url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
        .unwrap_or_default();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Island { plan: Mutex::new(plan), busy: AtomicBool::new(false) })
        .invoke_handler(tauri::generate_handler![start_island, open_log])
        .setup(move |app| {
            // Built here rather than declared in tauri.conf.json because the browser
            // arguments and the two navigation hooks only exist on the builder.
            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Promptholm")
                .inner_size(1600.0, 1000.0)
                .min_inner_size(640.0, 400.0)
                .center()
                .on_navigation(move |url| {
                    if stays_here(url, &own_host) {
                        return true;
                    }
                    open_elsewhere(url);
                    false
                })
                .on_new_window(|url, _features| {
                    open_elsewhere(&url);
                    NewWindowResponse::Deny
                });
            #[cfg(windows)]
            let builder = builder.additional_browser_args(BROWSER_ARGS);
            builder.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
