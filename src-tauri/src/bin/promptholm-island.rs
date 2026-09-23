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
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tray_icon::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tray_icon::{Icon, MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};

/// The window's exe, which stands next to this one.
const WINDOW_EXE: &str = "promptholm.exe";

/// How often the tray looks at the island: is our node still alive, is the port answering.
const POLL: Duration = Duration::from_secs(2);

/// How long a polite stop gets before it is a kill. serve.mjs's shutdown() closes the sea and
/// the agents and exits in well under a second; this is only for a node that is wedged.
const STOP_GRACE: Duration = Duration::from_secs(5);

enum UserEvent {
    Menu(MenuEvent),
    Tray(TrayIconEvent),
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
        // Another islander already keeps this port. It has the tray; this one has nothing to do.
        return;
    };

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

    let open = MenuItem::new("Open Promptholm", true, None);
    let browser = MenuItem::new("Open in browser", true, None);
    let toggle = MenuItem::new("Stop the island", true, None);
    let restart = MenuItem::new("Restart the island", true, None);
    let log = MenuItem::new("Open log", true, None);
    let quit = MenuItem::new("Quit", true, None);
    let menu = Menu::new();
    let _ = menu.append_items(&[
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
                } else if id == log.id() {
                    shell_open(&keeper.root.join("data").join("server.log").display().to_string());
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
                State::Starting => (format!("Promptholm - starting on port {}", keeper.port), "Stop the island"),
                State::Running { ours: true } => (format!("Promptholm - on port {}", keeper.port), "Stop the island"),
                State::Running { ours: false } => {
                    (format!("Promptholm - on port {} (started elsewhere)", keeper.port), "Stop the island")
                }
                State::Stopped => ("Promptholm - stopped".to_string(), "Start the island"),
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

/// The window, pointed at this island. The browser when the window's exe is not next to us.
fn open_window(keeper: &Keeper) {
    let exe = std::env::current_exe().ok().map(|e| e.with_file_name(WINDOW_EXE)).filter(|p| p.is_file());
    let Some(exe) = exe else {
        shell_open(&keeper.url());
        return;
    };
    let mut cmd = Command::new(exe);
    cmd.arg("--port").arg(keeper.port.to_string()).env("SETTLERS_ROOT", &keeper.root);
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
    let path = root.join("data").join("server.log");
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
