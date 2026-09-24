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
use std::time::{Duration, Instant};

use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent};

/// Tauri's own default (the msWebOOUI/msPdfOOUI/msSmartScreenProtection set) has to be
/// repeated here, because `additional_browser_args` replaces it rather than adding to it.
/// --force-high-performance-gpu because on a laptop with two graphics cards Chromium picks the integrated one to save
/// power, and on this machine that is the card whose driver keeps falling over.
const BROWSER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --force-high-performance-gpu";

/// How long a close the page was asked to confirm stays asked. A second Alt+F4 inside it
/// closes without asking again - the way out when the page is hung or never answers, so a
/// confirmation can slow a close down but never trap anybody in the window.
const CLOSE_CONFIRM_WINDOW: Duration = Duration::from_secs(5);

/// Told to every page this window loads, the island included: web/js/desktop.js only asks
/// before F5 and before a close when it is here, never in an ordinary browser tab.
const DESKTOP_FLAG: &str = "window.PROMPTHOLM_DESKTOP = true;";

/// How the page says "yes, close": a navigation to this, which on_navigation turns into
/// closing the window. A navigation rather than an invoke, because the island is a remote
/// page (http://localhost) and this way it needs no IPC capability opened to it.
const CLOSE_URL_SCHEME: &str = "promptholm";

/// When the page was last asked to confirm a close (see CloseRequested below).
struct CloseAsk(Mutex<Option<Instant>>);

/// How long a freshly started islander gets to open its port. A cold start does a full scan
/// before it listens, and a village of a few hundred sessions takes a while to read.
const STARTUP_TIMEOUT: Duration = Duration::from_secs(60);

/// How long a window with no checkout to start from waits for an island that may only be
/// restarting before it says it cannot find one.
const NO_ROOT_GRACE: Duration = Duration::from_secs(8);

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
            } else if island::wait(plan.port, NO_ROOT_GRACE).is_some() {
                // Nothing to start it from, but an island that is only restarting - its tray's
                // Restart, a server change - is back within a second or two. Measured: a
                // viewer opened during such a restart gave up in the one second it was down.
                show(&app, &plan.url);
            } else {
                fail(format!(
                    "Nothing is listening on port {}, and this copy of Promptholm is not inside \
                     a checkout, so it has nothing to start the island from. Start \
                     promptholm-island.exe from your checkout once - after that every copy on \
                     this machine can find it - or unpack this one into <checkout>\\bin\\.",
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

/// The window's WebView2 profile lives under %LOCALAPPDATA%\<identifier>, and the
/// identifier used to be com.agentvillage.island. Everything the page keeps in localStorage
/// - the avatar, the sound, the board filters, a half-drawn plan - is in there, so a
/// renamed identifier would open on a stranger's island. Moved once, before WebView2 has a
/// chance to create the new folder empty; if the new one already exists it is left alone.
fn carry_over_webview_data() {
    let Some(base) = std::env::var_os("LOCALAPPDATA").map(std::path::PathBuf::from) else { return };
    let old = base.join("com.agentvillage.island");
    let new = base.join("com.promptholm.island");
    if old.is_dir() && !new.exists() {
        let _ = std::fs::rename(&old, &new);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // A second copy of this exe, started by the first to start node and get out of the way.
    // It never builds a window; see island::start for why there is a go-between at all.
    if island::spawn_if_asked() {
        return;
    }

    carry_over_webview_data();

    let plan = island::plan();
    let own_host = Url::parse(&plan.url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
        .unwrap_or_default();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Island { plan: Mutex::new(plan), busy: AtomicBool::new(false) })
        .manage(CloseAsk(Mutex::new(None)))
        // Alt+F4, the title bar's cross and the taskbar all arrive here. Closing the window
        // never stops the island (the islander outlives it), but it drops you out of walk
        // mode, a panel or a conversation, and it happened by accident often enough to be
        // worth one question. So the first request is held and the page is asked
        // (window.promptholmConfirmClose, web/js/desktop.js); a page that says yes navigates
        // to promptholm://close. Not asked on the splash - there is nothing to lose there -
        // and a second request within CLOSE_CONFIRM_WINDOW always goes through.
        .on_window_event(|window, event| {
            let WindowEvent::CloseRequested { api, .. } = event else { return };
            let Some(webview) = window.app_handle().get_webview_window(window.label()) else { return };
            let on_island = webview
                .url()
                .map(|u| matches!(u.scheme(), "http" | "https"))
                .unwrap_or(false);
            if !on_island {
                return;
            }
            let state = window.app_handle().state::<CloseAsk>();
            let mut asked = state.0.lock().unwrap();
            if asked.map_or(false, |at| at.elapsed() < CLOSE_CONFIRM_WINDOW) {
                *asked = None;
                return;
            }
            *asked = Some(Instant::now());
            api.prevent_close();
            // An older page has no confirmation to show: close as before rather than hang.
            let _ = webview.eval(
                "window.promptholmConfirmClose ? window.promptholmConfirmClose() : (location.href = 'promptholm://close')",
            );
        })
        .invoke_handler(tauri::generate_handler![start_island, open_log])
        .setup(move |app| {
            // Built here rather than declared in tauri.conf.json because the browser
            // arguments and the two navigation hooks only exist on the builder.
            let closer = app.handle().clone();
            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Promptholm")
                .inner_size(1600.0, 1000.0)
                .min_inner_size(640.0, 400.0)
                .center()
                .initialization_script(DESKTOP_FLAG)
                .on_navigation(move |url| {
                    if url.scheme() == CLOSE_URL_SCHEME {
                        if url.host_str() == Some("close") {
                            if let Some(w) = closer.get_webview_window("main") {
                                let _ = w.destroy();
                            }
                        }
                        return false;
                    }
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
