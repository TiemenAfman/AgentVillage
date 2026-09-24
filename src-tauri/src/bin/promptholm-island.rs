// The islander as a program of its own: `node serve.mjs`, kept, with a tray icon to hold it by.
//
// The window (promptholm.exe) is the interface and nothing else; this is the island. It
// has no window and no WebView - a tray icon, a menu, and node as its child. Its life is
// node's life: node's stdin is a pipe this process holds, and `serve.mjs --supervised` shuts
// down cleanly when that pipe closes, so Stop is polite, Quit takes the island with it, and
// this process being killed outright does not leave a node behind with nothing to stop it
// from. Plans/islander-als-eigen-exe.md has the reasoning.
//
// The sea needs nothing here: it runs inside node (createSea, for single and host; closed
// again on a join), so it comes and goes with the island.
//
// Deliberately not a Tauri app. tray-icon and tao are what Tauri itself draws its tray and
// runs its event loop with, already in the lockfile, and using them directly keeps WebView2
// and the whole of Tauri out of a process that never shows a page.
#![windows_subsystem = "windows"]

#[allow(dead_code)]
#[path = "../island.rs"]
mod island;

use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::{Duration, Instant};

use tao::event::{Event, StartCause};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
use tray_icon::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tray_icon::{Icon, MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};

/// The window's exe: next to this one in a build folder, one folder up in an unpacked
/// release, where this one lives in app\.
const WINDOW_EXE: &str = "promptholm.exe";

/// How often the tray looks at the island: is our node still alive, is the port answering.
const POLL: Duration = Duration::from_secs(2);

/// How long a polite stop gets before it is a kill. serve.mjs's shutdown() closes the sea and
/// the agents and exits in well under a second; this is only for a node that is wedged.
const STOP_GRACE: Duration = Duration::from_secs(5);

enum UserEvent {
    Menu(MenuEvent),
    Tray(TrayIconEvent),
    /// A second copy found this one keeping the port with nothing listening (`knock`).
    Knock,
}

#[derive(Clone, Copy, PartialEq)]
enum State {
    Starting,
    /// Answering on the port. `ours` is false for an island somebody started by hand, which
    /// this tray adopts rather than refusing to run beside.
    Running { ours: bool },
    Stopped,
}

struct Keeper {
    root: PathBuf,
    port: u16,
    child: Option<Child>,
}

impl Keeper {
    fn state(&mut self) -> State {
        if let Some(child) = self.child.as_mut() {
            if !matches!(child.try_wait(), Ok(None)) {
                // It exited - crashed, or stopped from inside. What it said is in server.log.
                self.child = None;
            }
        }
        match (island::listening(self.port), self.child.is_some()) {
            (true, ours) => State::Running { ours },
            (false, true) => State::Starting,
            (false, false) => State::Stopped,
        }
    }

    fn start(&mut self) {
        if self.child.is_some() || island::listening(self.port) {
            return;
        }
        match island::spawn_node(&self.root, self.port, true) {
            Ok(child) => self.child = Some(child),
            Err(e) => note(&self.root, &format!("could not start the island: {e}")),
        }
    }

    /// Ask ours to go by closing its stdin; a kill if it has not gone within STOP_GRACE.
    /// An island that is not ours has no pipe to close, so it gets stop-island.cmd's taskkill.
    fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            drop(child.stdin.take());
            let until = Instant::now() + STOP_GRACE;
            while Instant::now() < until && matches!(child.try_wait(), Ok(None)) {
                std::thread::sleep(Duration::from_millis(100));
            }
            if matches!(child.try_wait(), Ok(None)) {
                let _ = child.kill();
                let _ = child.wait();
            }
        } else if island::listening(self.port) {
            island::kill_listener(self.port);
        }
        // The port is released a moment after the process; a restart that raced it would
        // meet serve.mjs's quiet exit on EADDRINUSE.
        let until = Instant::now() + Duration::from_secs(3);
        while Instant::now() < until && island::listening(self.port) {
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    fn url(&self) -> String {
        format!("http://localhost:{}/", self.port)
    }
}

fn main() {
    let plan = island::plan();
    if plan.remote {
        // An island somewhere else is not ours to keep.
        return;
    }
    let Some(root) = plan.root.clone() else {
        // No console to say it on, and nowhere to write a log to without a root.
        return;
    };
    let port = plan.port;
    let Some(_one) = only_islander(port) else {
        // Another islander already keeps this port, and it has the tray. Usually its island
        // is up and there is nothing to do - but a tray whose island was stopped from its
        // menu still holds the port, and exiting here without a word left nothing listening:
        // the double-click did nothing, and the window waited out its minute and failed.
        // Measured with a checkout's tray stopped and a release unpacked beside it.
        if !island::listening(port) {
            wake_keeper(port);
        }
        return;
    };
    // After the mutex, not before: a copy that exits above may be from another folder than
    // the islander that keeps the port, and would leave checkout.txt pointing at an island
    // nobody runs.
    island::remember_root(&root);
    let knocks = knock_door(port);

    if !node_answers() {
        // Everything else is written to server.log, but somebody who has just unpacked a
        // zip and double-clicked it is not going to go and read a log: without node there
        // is no island at all, so it is said to their face, once, and the tray does not
        // pretend to be keeping anything.
        alert(
            "Promptholm needs Node.js",
            "Promptholm runs on Node.js 22 or newer, and this computer does not seem to have it.\n\n\
             Install it from https://nodejs.org (the LTS version), then start Promptholm again.",
        );
        shell_open("https://nodejs.org/");
        return;
    }
    first_run(&root);

    let mut keeper = Keeper { root, port, child: None };
    keeper.start();

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    MenuEvent::set_event_handler(Some(move |e| {
        let _ = proxy.send_event(UserEvent::Menu(e));
    }));
    let proxy = event_loop.create_proxy();
    TrayIconEvent::set_event_handler(Some(move |e| {
        let _ = proxy.send_event(UserEvent::Tray(e));
    }));
    listen_for_knocks(knocks, event_loop.create_proxy());

    // Which code this island is, at the top of the menu and in the tooltip. Read again on
    // every restart from the menu, since that is when a pulled checkout becomes what runs.
    let mut label = island::build_label(&keeper.root);
    let version = MenuItem::new(format!("Promptholm {label}"), false, None);
    let open = MenuItem::new("Open Promptholm", true, None);
    let browser = MenuItem::new("Open in browser", true, None);
    let toggle = MenuItem::new("Stop the island", true, None);
    let restart = MenuItem::new("Restart the island", true, None);
    let log = MenuItem::new("Open log", true, None);
    let quit = MenuItem::new("Quit", true, None);
    let menu = Menu::new();
    let _ = menu.append_items(&[
        &version,
        &PredefinedMenuItem::separator(),
        &open,
        &browser,
        &PredefinedMenuItem::separator(),
        &toggle,
        &restart,
        &log,
        &PredefinedMenuItem::separator(),
        &quit,
    ]);

    let mut tray: Option<TrayIcon> = None;
    let mut shown: Option<State> = None;

    event_loop.run(move |event, _, flow| {
        *flow = ControlFlow::WaitUntil(Instant::now() + POLL);

        match event {
            // tray-icon asks for the icon to be made once the loop is running, not before.
            Event::NewEvents(StartCause::Init) => {
                tray = TrayIconBuilder::new()
                    .with_icon(icon())
                    .with_tooltip("Promptholm")
                    .with_menu(Box::new(menu.clone()))
                    .with_menu_on_left_click(false)
                    .build()
                    .ok();
            }
            Event::UserEvent(UserEvent::Tray(TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            })) => open_window(&keeper),
            // Starting is a no-op for an island that is already starting or up.
            Event::UserEvent(UserEvent::Knock) => keeper.start(),
            Event::UserEvent(UserEvent::Menu(e)) => {
                let id = e.id();
                if id == open.id() {
                    open_window(&keeper);
                } else if id == browser.id() {
                    shell_open(&keeper.url());
                } else if id == toggle.id() {
                    match keeper.state() {
                        State::Stopped => keeper.start(),
                        _ => keeper.stop(),
                    }
                } else if id == restart.id() {
                    keeper.stop();
                    keeper.start();
                    label = island::build_label(&keeper.root);
                    version.set_text(format!("Promptholm {label}"));
                    shown = None;   // and the tooltip with it
                } else if id == log.id() {
                    shell_open(&island::home(&keeper.root).join("data").join("server.log").display().to_string());
                } else if id == quit.id() {
                    keeper.stop();
                    tray = None;
                    *flow = ControlFlow::Exit;
                    return;
                }
            }
            _ => {}
        }

        // Every wake-up, whatever woke us: cheap (one connect to loopback), and it is what
        // keeps the tooltip and the menu true after a crash nobody clicked for.
        let now = keeper.state();
        if shown != Some(now) {
            shown = Some(now);
            let (tip, verb) = match now {
                State::Starting => (format!("Promptholm {label} - starting on port {}", keeper.port), "Stop the island"),
                State::Running { ours: true } => (format!("Promptholm {label} - on port {}", keeper.port), "Stop the island"),
                State::Running { ours: false } => {
                    (format!("Promptholm {label} - on port {} (started elsewhere)", keeper.port), "Stop the island")
                }
                State::Stopped => (format!("Promptholm {label} - stopped"), "Start the island"),
            };
            toggle.set_text(verb);
            restart.set_enabled(now != State::Stopped);
            open.set_enabled(now != State::Stopped);
            browser.set_enabled(now != State::Stopped);
            if let Some(t) = tray.as_ref() {
                let _ = t.set_tooltip(Some(tip));
            }
        }
    });
}

/// Can we run node at all? `node --version`, windowless, and nothing more.
fn node_answers() -> bool {
    let mut cmd = Command::new(island::node_exe());
    cmd.arg("--version").stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    island::no_window(&mut cmd);
    cmd.status().map(|s| s.success()).unwrap_or(false)
}

/// A home with no config.json has no island yet: run setup once, the same scripts/setup.mjs
/// a checkout runs by hand, before the server starts. Importing lib/paths.mjs moves an
/// island that stood somewhere else before ~/.promptholm existed into it, so on a machine
/// with an island this is a move and setup finds the config already there; on a fresh one
/// it is the whole install - config.json founded as of now, and the session hook.
/// `--first-run` makes setup leave a hook that is already there alone (it may belong to a
/// checkout on the same machine). Waited for, output to server.log, and a failure only
/// noted: the server still starts, and says the rest itself.
fn first_run(root: &Path) {
    if island::home(root).join("config.json").is_file() {
        return;
    }
    note(root, "no island in this home yet: running setup, which moves one in or founds one");
    let log = island::home(root).join("data").join("server.log");
    let out = std::fs::OpenOptions::new().create(true).append(true).open(&log);
    let mut cmd = Command::new(island::node_exe());
    cmd.arg("scripts/setup.mjs").arg("--first-run").current_dir(root).stdin(std::process::Stdio::null());
    if let Ok(f) = out {
        if let Ok(g) = f.try_clone() {
            cmd.stdout(f).stderr(g);
        }
    }
    island::no_window(&mut cmd);
    match cmd.status() {
        Ok(s) if s.success() => {}
        Ok(s) => note(root, &format!("setup exited with {s}")),
        Err(e) => note(root, &format!("could not run setup: {e}")),
    }
}

#[cfg(windows)]
fn alert(title: &str, text: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONWARNING, MB_OK};
    let w = |s: &str| s.encode_utf16().chain([0]).collect::<Vec<u16>>();
    let (t, m) = (w(title), w(text));
    unsafe { MessageBoxW(std::ptr::null_mut(), m.as_ptr(), t.as_ptr(), MB_OK | MB_ICONWARNING) };
}

#[cfg(not(windows))]
fn alert(_title: &str, _text: &str) {}

/// The window, pointed at this island. The browser when there is no window's exe to start.
fn open_window(keeper: &Keeper) {
    let dir = std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf));
    let exe = dir
        .iter()
        .flat_map(|d| [Some(d.join(WINDOW_EXE)), d.parent().map(|up| up.join(WINDOW_EXE))])
        .flatten()
        .find(|p| p.is_file());
    let Some(exe) = exe else {
        shell_open(&keeper.url());
        return;
    };
    let mut cmd = Command::new(exe);
    cmd.arg("--port").arg(keeper.port.to_string()).env("PROMPTHOLM_ROOT", &keeper.root);
    if cmd.spawn().is_err() {
        shell_open(&keeper.url());
    }
}

/// A URL in the default browser, a file in whatever opens it. rundll32 rather than
/// `cmd /c start`, because start treats its first quoted argument as a window title and
/// flashes a console while doing it.
fn shell_open(target: &str) {
    let mut cmd = Command::new("rundll32");
    cmd.arg("url.dll,FileProtocolHandler").arg(target);
    island::no_window(&mut cmd);
    let _ = cmd.spawn();
}

/// A line in server.log for the one thing that can go wrong before node is there to log.
fn note(root: &Path, line: &str) {
    use std::io::Write;
    let dir = island::home(root).join("data");
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("server.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "[promptholm-island] {line}");
    }
}

/// The exe's own icon. tauri-build embeds icons/icon.ico into every binary of this crate
/// under id 32512 (IDI_APPLICATION); a plain square stands in if that ever stops being true.
fn icon() -> Icon {
    if let Ok(i) = Icon::from_resource(32512, None) {
        return i;
    }
    let (w, h) = (32u32, 32u32);
    let rgba = [0x2f, 0x7d, 0x5a, 0xff].repeat((w * h) as usize);
    Icon::from_rgba(rgba, w, h).expect("a 32x32 square is a valid icon")
}

/// One islander per port, held by a named mutex for as long as this process lives. Two
/// trays for one island would each think the other's node was "started elsewhere".
#[cfg(windows)]
fn only_islander(port: u16) -> Option<impl Drop> {
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HANDLE};
    use windows_sys::Win32::System::Threading::CreateMutexW;

    struct Held(HANDLE);
    impl Drop for Held {
        fn drop(&mut self) {
            unsafe { CloseHandle(self.0) };
        }
    }

    let name: Vec<u16> = format!("Local\\Promptholm-island-{port}").encode_utf16().chain([0]).collect();
    let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
    if handle.is_null() {
        return None;
    }
    if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
        unsafe { CloseHandle(handle) };
        return None;
    }
    Some(Held(handle))
}

#[cfg(not(windows))]
fn only_islander(_port: u16) -> Option<()> {
    Some(())
}

/// The second copy's side of the knock. A keeper with the door has its island started by it.
/// One without is an islander from before the door - a checkout's tray beside a newer
/// release - and can only be told about. It gets a few seconds first, since a keeper that
/// is only starting has nothing listening yet either, and the message says "not answering"
/// rather than "stopped" because a slow cold start can outlast those seconds.
fn wake_keeper(port: u16) {
    if knock(port) || island::wait(port, Duration::from_secs(5)).is_some() {
        return;
    }
    alert(
        "Promptholm is already running",
        &format!(
            "Another Promptholm is keeping port {port}, but its island is not answering - most \
             likely it was stopped from its tray icon.\n\n\
             Start it again there (perhaps behind the ^), or choose Quit there and start this \
             one again."
        ),
    );
}

/// Beside the mutex, a named event a second copy can knock on.
#[cfg(windows)]
fn knock_name(port: u16) -> Vec<u16> {
    format!("Local\\Promptholm-island-{port}-knock").encode_utf16().chain([0]).collect()
}

/// The keeper's side: an auto-reset event, made straight after the mutex, so a knock that
/// lands before the loop runs is not lost - it stays signalled until a wait takes it. Held
/// for the life of the process, like the mutex. None when Windows would not make one; a
/// second copy then says its piece in a message box instead.
#[cfg(windows)]
fn knock_door(port: u16) -> Option<usize> {
    use windows_sys::Win32::System::Threading::CreateEventW;
    let name = knock_name(port);
    let handle = unsafe { CreateEventW(std::ptr::null(), 0, 0, name.as_ptr()) };
    // A HANDLE is a raw pointer and not Send, so the listening thread is handed a number.
    (!handle.is_null()).then_some(handle as usize)
}

/// One thread blocked on the door, turning every knock into a Knock for the loop.
#[cfg(windows)]
fn listen_for_knocks(door: Option<usize>, proxy: EventLoopProxy<UserEvent>) {
    use windows_sys::Win32::Foundation::{HANDLE, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Threading::{WaitForSingleObject, INFINITE};
    let Some(raw) = door else { return };
    std::thread::spawn(move || loop {
        if unsafe { WaitForSingleObject(raw as HANDLE, INFINITE) } != WAIT_OBJECT_0 {
            return;
        }
        if proxy.send_event(UserEvent::Knock).is_err() {
            return; // the loop has gone
        }
    });
}

/// False when there is no door to knock on.
#[cfg(windows)]
fn knock(port: u16) -> bool {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenEventW, SetEvent, EVENT_MODIFY_STATE};
    let name = knock_name(port);
    let handle = unsafe { OpenEventW(EVENT_MODIFY_STATE, 0, name.as_ptr()) };
    if handle.is_null() {
        return false;
    }
    let rang = unsafe { SetEvent(handle) } != 0;
    unsafe { CloseHandle(handle) };
    rang
}

#[cfg(not(windows))]
fn knock_door(_port: u16) -> Option<usize> {
    None
}

#[cfg(not(windows))]
fn listen_for_knocks(_door: Option<usize>, _proxy: EventLoopProxy<UserEvent>) {}

#[cfg(not(windows))]
fn knock(_port: u16) -> bool {
    false
}
