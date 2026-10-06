// The island as its own window.
//
// This is a shell, not a second viewer. The window is a WebView2 pointed at the islander
// that is already the island - http://localhost:4747/ - exactly as Chrome's --app window
// shows it. Nothing under web/ is bundled, built or copied: the page keeps its
// import map, api.js keeps working out `mine()` from its own URL, and lib/access.mjs sees a
// loopback socket with a matching Host and Origin, the same as from any browser. Bundling
// web/ into the app was the scaffold's default and would have broken all three of those at
// once - Plans/DONE/eiland-als-desktop-app.md has the full reasoning.
//
// What the shell adds over a browser is the one thing a browser cannot do: make sure the
// service is there before showing it. The window opens on a splash of its own (splash/),
// the splash asks Rust to `start_island`, and Rust probes the port, starts serve.mjs if
// nothing answers, waits, and then navigates the same webview to the island. From then on
// the page is on its own and this side only has two jobs left: sending links to other sites
// to the system browser, and keeping the window itself on the island.
#[allow(dead_code)] // shared with the islander exe, which uses the other half of it
mod island;
mod bubble;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::webview::NewWindowResponse;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size, Url, WebviewUrl,
    WebviewWindowBuilder, Window, WindowEvent,
};

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

/// Fullscreen is the window's, not the page's: promptholm://fullscreen/<on|off|toggle|query>
/// is how the page asks (same door as the close, and for the same reason - no IPC capability
/// is opened to a remote page), and `window.promptholmFullscreen(bool)` is how it is told what
/// the window really is. HTML fullscreen put Chromium's "press Esc to exit full screen" bubble
/// in the window and fought walk mode's Escape; web/js/desktop.js has the page's half.
const FULLSCREEN_HOST: &str = "fullscreen";

/// What the page was last told, so a drag-resize does not eval a line per pixel.
static TOLD_FULLSCREEN: AtomicBool = AtomicBool::new(false);

/// Where the window was, kept between starts in window.json beside the WebView2 profile.
#[derive(serde::Serialize, serde::Deserialize, Clone, PartialEq, Debug)]
struct WindowMemory {
    /// Outer position and inner size in physical pixels, always the *windowed* ones: while
    /// the window is fullscreen, maximized or minimized the events report the monitor.
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
    fullscreen: bool,
}

/// `current` is the latest state seen, `written` what is on disk, `at` when that happened.
struct Remembered {
    current: Option<WindowMemory>,
    written: Option<WindowMemory>,
    at: Instant,
}
struct WindowState(Mutex<Remembered>);

/// A drag is hundreds of events a second; the file is written at most this often, and
/// always when the window goes (Destroyed).
const REMEMBER_EVERY: Duration = Duration::from_millis(500);

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

fn memory_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_local_data_dir().ok().map(|d| d.join("window.json"))
}

fn load_memory(app: &AppHandle) -> Option<WindowMemory> {
    let m: WindowMemory = serde_json::from_slice(&std::fs::read(memory_path(app)?).ok()?).ok()?;
    (m.width >= 320 && m.height >= 200 && m.width <= 16_000 && m.height <= 16_000).then_some(m)
}

/// Whether the remembered window still has somewhere to be: a screen that has been unplugged
/// since would put it where nobody can reach it, so its title bar has to be on a monitor.
fn on_a_monitor(app: &AppHandle, m: &WindowMemory) -> bool {
    app.available_monitors().unwrap_or_default().iter().any(|mon| {
        let (p, s) = (mon.position(), mon.size());
        let (tx, ty) = (m.x + 80, m.y + 20);
        tx >= p.x && ty >= p.y && tx < p.x + s.width as i32 && ty < p.y + s.height as i32
    })
}

/// Take stock of the window and write it down if it changed (and it is time, or `force`).
fn remember(window: &Window, force: bool) {
    let state = window.app_handle().state::<WindowState>();
    let Ok(mut st) = state.0.lock() else { return };
    let mut cur = st.current.clone();
    // Once the window is being destroyed its getters fail: write what was seen last.
    if let (Ok(fullscreen), Ok(minimized), Ok(maximized)) =
        (window.is_fullscreen(), window.is_minimized(), window.is_maximized())
    {
        cur = observe(window, cur, fullscreen, minimized, maximized);
    }
    st.current = cur.clone();
    if cur == st.written || cur.is_none() || !(force || st.at.elapsed() >= REMEMBER_EVERY) {
        return;
    }
    let Some(path) = memory_path(window.app_handle()) else { return };
    if let (Some(dir), Ok(json)) = (path.parent(), serde_json::to_vec(&cur)) {
        let _ = std::fs::create_dir_all(dir);
        // By rename, like every file the island keeps: a crash halfway leaves the old one.
        let tmp = path.with_extension("tmp");
        if std::fs::write(&tmp, json).is_ok() && std::fs::rename(&tmp, &path).is_ok() {
            st.written = cur;
            st.at = Instant::now();
        }
    }
}

fn observe(
    window: &Window,
    mut cur: Option<WindowMemory>,
    fullscreen: bool,
    minimized: bool,
    maximized: bool,
) -> Option<WindowMemory> {
    if !fullscreen && !minimized {
        // Maximized keeps the windowed rectangle it will come back to.
        if !maximized {
            if let (Ok(p), Ok(s)) = (window.outer_position(), window.inner_size()) {
                cur = Some(WindowMemory { x: p.x, y: p.y, width: s.width, height: s.height, maximized, fullscreen });
            }
        }
        if let Some(c) = cur.as_mut() {
            c.maximized = maximized;
        }
    }
    if let Some(c) = cur.as_mut() {
        c.fullscreen = fullscreen;
    }
    cur
}

/// Put the remembered window back before it is shown.
fn apply_memory(app: &AppHandle, win: &tauri::WebviewWindow, m: &WindowMemory) {
    if on_a_monitor(app, m) {
        let _ = win.set_size(Size::Physical(PhysicalSize::new(m.width, m.height)));
        let _ = win.set_position(Position::Physical(PhysicalPosition::new(m.x, m.y)));
    }
    if m.maximized {
        let _ = win.maximize();
    }
    if m.fullscreen {
        let _ = win.set_fullscreen(true);
    }
}

/// Say what the window's fullscreen state is to the page (if it is listening: the splash
/// and an older page are not, and the line then does nothing).
fn tell_fullscreen(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else { return };
    let on = win.is_fullscreen().unwrap_or(false);
    TOLD_FULLSCREEN.store(on, Ordering::Relaxed);
    let _ = win.eval(format!("window.promptholmFullscreen && window.promptholmFullscreen({on})"));
}

/// promptholm://fullscreen/<what>. On a thread of its own because a getter on the main thread
/// from inside its own navigation callback would wait for itself.
fn fullscreen_request(app: &AppHandle, what: &str) {
    let app = app.clone();
    let what = what.trim_matches('/').to_string();
    std::thread::spawn(move || {
        let Some(win) = app.get_webview_window("main") else { return };
        let now = win.is_fullscreen().unwrap_or(false);
        let want = match what.as_str() {
            "on" => true,
            "off" => false,
            "toggle" => !now,
            _ => now, // "query"
        };
        if want != now {
            let _ = win.set_fullscreen(want);
            // The window's own resize event tells the page; this is for the case where it
            // does not come (a window that already filled the monitor).
            std::thread::sleep(Duration::from_millis(250));
        }
        tell_fullscreen(&app);
    });
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
        .manage(WindowState(Mutex::new(Remembered { current: None, written: None, at: Instant::now() })))
        // Alt+F4, the title bar's cross and the taskbar all arrive here. Closing the window
        // never stops the island (the islander outlives it), but it drops you out of walk
        // mode, a panel or a conversation, and it happened by accident often enough to be
        // worth one question. So the first request is held and the page is asked
        // (window.promptholmConfirmClose, web/js/desktop.js); a page that says yes navigates
        // to promptholm://close. Not asked on the splash - there is nothing to lose there -
        // and a second request within CLOSE_CONFIRM_WINDOW always goes through.
        .on_window_event(|window, event| {
            match event {
                // Fullscreen arrives as a resize; the page is told only when it changed.
                WindowEvent::Resized(_) => {
                    remember(window, false);
                    let on = window.is_fullscreen().unwrap_or(false);
                    if on != TOLD_FULLSCREEN.load(Ordering::Relaxed) {
                        tell_fullscreen(window.app_handle());
                    }
                    return;
                }
                WindowEvent::Moved(_) => return remember(window, false),
                WindowEvent::Destroyed => return remember(window, true),
                _ => {}
            }
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
                // Shown once the remembered place is put back, or it opens in the middle and
                // jumps.
                .visible(false)
                .initialization_script(DESKTOP_FLAG)
                .on_navigation(move |url| {
                    if url.scheme() == CLOSE_URL_SCHEME {
                        match url.host_str() {
                            Some("close") => {
                                if let Some(w) = closer.get_webview_window("main") {
                                    let _ = w.destroy();
                                }
                            }
                            Some(FULLSCREEN_HOST) => fullscreen_request(&closer, url.path()),
                            _ => {}
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
            let window = builder.build()?;
            if let Some(m) = load_memory(app.handle()) {
                apply_memory(app.handle(), &window, &m);
                if let Ok(mut st) = app.state::<WindowState>().0.lock() {
                    st.current = Some(m.clone());
                    st.written = Some(m);
                }
            }
            let _ = window.show();
            // Chromium's "press Esc to show your cursor" bubble on every pointer lock.
            #[cfg(windows)]
            if let Ok(hwnd) = window.hwnd() {
                bubble::hide_pointer_lock_bubble(hwnd.0 as isize);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
