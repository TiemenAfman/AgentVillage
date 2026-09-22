// Everything the desktop window knows about the service it shows, and nothing about Tauri.
//
// The window is a shell around `serve.mjs`, not a second copy of it: the islander keeps the
// scan, the data, the agents and the mail, and this side only has to answer three questions
// before it can point a webview at it. Where is the island's folder? Which port is it on?
// Is anything listening there yet - and if not, can we start it?
//
// Starting it copies `start-island-hidden.vbs` deliberately: no console window, everything
// the server prints appended to data/server.log. Two launchers that put a crash in two
// different places is one place too many to look.
use std::fs::{self, OpenOptions};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub const DEFAULT_PORT: u16 = 4747;

/// What the window intends to show and, if it has to, start.
#[derive(Clone, Debug)]
pub struct Plan {
    /// Where the page is. Always loopback unless `--url` said otherwise.
    pub url: String,
    /// The port the islander is expected on. Only probed when `root` is set and no `--url`
    /// was given; a remote island is never started from here.
    pub port: u16,
    /// The checkout with serve.mjs in it, when we know it. None means: connect only.
    pub root: Option<PathBuf>,
    /// True when `--url` pointed us at an island somewhere else.
    pub remote: bool,
}

impl Plan {
    pub fn log_path(&self) -> Option<PathBuf> {
        self.root.as_ref().map(|r| r.join("data").join("server.log"))
    }
}

/// Read the intent off the command line, the environment and config.json - in that order,
/// which is the order serve.mjs reads its own port in, so the two cannot disagree about
/// where the island is.
pub fn plan() -> Plan {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let arg_of = |flag: &str| -> Option<String> {
        let i = args.iter().position(|a| a == flag)?;
        args.get(i + 1).cloned()
    };

    if let Some(url) = arg_of("--url") {
        let url = if url.ends_with('/') { url } else { format!("{url}/") };
        return Plan { url, port: 0, root: None, remote: true };
    }

    let root = find_root();
    let port = arg_of("--port")
        .or_else(|| std::env::var("PORT").ok())
        .and_then(|p| p.trim().parse::<u16>().ok())
        .or_else(|| root.as_deref().and_then(port_from_config))
        .unwrap_or(DEFAULT_PORT);

    // `localhost` rather than 127.0.0.1, because that is the origin every other launcher
    // uses - the cmd, serve.mjs's own --open, the scheduled task's URL in the manual - and
    // the page keeps its settings per origin.
    Plan { url: format!("http://localhost:{port}/"), port, root, remote: false }
}

/// The checkout serve.mjs lives in. Three places to look, in the order they are likely to
/// be right:
///   SETTLERS_ROOT          somebody said so
///   CARGO_MANIFEST_DIR/..  where this binary was built from - correct for `tauri dev` and
///                          for a build that stays on this machine
///   above the executable   a release exe dropped into the repo, or into a folder next to it
fn find_root() -> Option<PathBuf> {
    let is_root = |p: &Path| p.join("serve.mjs").is_file();

    if let Ok(v) = std::env::var("SETTLERS_ROOT") {
        let p = PathBuf::from(v.trim());
        if is_root(&p) {
            return Some(p);
        }
    }

    let built_from = Path::new(env!("CARGO_MANIFEST_DIR")).parent().map(Path::to_path_buf);
    if let Some(p) = built_from.filter(|p| is_root(p)) {
        return Some(p);
    }

    let exe = std::env::current_exe().ok()?;
    let mut dir = exe.parent();
    while let Some(d) = dir {
        if is_root(d) {
            return Some(d.to_path_buf());
        }
        dir = d.parent();
    }
    None
}

/// `port` out of config.json, when the file is there and says so. Anything else - no file,
/// a comment somebody added, a string - is the default, exactly as `config.port || 4747`
/// treats it on the Node side.
fn port_from_config(root: &Path) -> Option<u16> {
    let text = fs::read_to_string(root.join("config.json")).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    json.get("port")?.as_u64().and_then(|p| u16::try_from(p).ok())
}

/// Is anything answering on the port? A TCP handshake is the whole question: serve.mjs only
/// starts listening once it is ready to serve, and asking /api/hello on top would mean an
/// HTTP client for one request.
pub fn listening(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok()
}

/// Wait for the port to come up, polling. Returns how long it took, or None on timeout.
pub fn wait(port: u16, timeout: Duration) -> Option<Duration> {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if listening(port) {
            return Some(start.elapsed());
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    None
}

/// The flag the window hands a second copy of its own executable to make it the go-between.
const SPAWN_FLAG: &str = "--spawn-island";

/// Start the islander in `root`. Returns once the process exists; whether it comes up is
/// `wait`'s job.
///
/// The islander outlives this window on purpose. It is the long-lived half - the scan, the
/// sea, the mail, the agents - and closing the thing you look at it through is not a reason
/// to stop any of that. `stop-island.cmd` is, and stays, how it is stopped.
///
/// Surviving a plain close is free: Windows does not stop a child when its parent exits.
/// Surviving a *tree* kill is not - `taskkill /T`, Task Manager's "End process tree", and
/// the terminal that ran `npm run app` being closed all walk the parent-pid chain and take
/// every descendant with them. So the window does not start node itself: it starts a second
/// copy of this executable with SPAWN_FLAG, which starts node and exits at once. By the time
/// anybody walks the tree, node's parent is a dead pid and the walk cannot reach it. The
/// same trick start-island-hidden.vbs plays with wscript, in other words.
pub fn start(root: &Path, port: u16) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| format!("could not find my own executable: {e}"))?;
    let mut cmd = Command::new(exe);
    cmd.arg(SPAWN_FLAG)
        .arg(root)
        .arg(port.to_string())
        .stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd.output().map_err(|e| format!("could not start the go-between: {e}"))?;
    if out.status.success() {
        return Ok(());
    }
    let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
    Err(if err.is_empty() { format!("the go-between exited with {}", out.status) } else { err })
}

/// The go-between's whole life. Called first thing in `run()`: when this process was started
/// with SPAWN_FLAG it starts node, reports on stderr if it could not, and says so - the
/// caller then returns without ever building a window.
pub fn spawn_if_asked() -> bool {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) != Some(SPAWN_FLAG) {
        return false;
    }
    let root = args.get(1).map(PathBuf::from);
    let port = args.get(2).and_then(|p| p.parse::<u16>().ok());
    let (Some(root), Some(port)) = (root, port) else {
        eprintln!("usage: {SPAWN_FLAG} <root> <port>");
        std::process::exit(2);
    };
    if let Err(e) = spawn_node(&root, port) {
        eprintln!("{e}");
        std::process::exit(1);
    }
    true
}

/// CREATE_NO_WINDOW: a GUI app has no console to hand down, and without this flag Windows
/// conjures one up for node and flashes it on screen. The child gets an invisible console of
/// its own instead of ours, which is also what keeps a ctrl+C in the launching terminal
/// from reaching it.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// node itself, with no console and its output appended to data/server.log - the same two
/// choices start-island-hidden.vbs makes, so a crash lands in the same file whichever
/// launcher started the island.
fn spawn_node(root: &Path, port: u16) -> Result<(), String> {
    let data = root.join("data");
    fs::create_dir_all(&data).map_err(|e| format!("could not create {}: {e}", data.display()))?;
    let log_path = data.join("server.log");
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("could not open {}: {e}", log_path.display()))?;
    let log_err = log.try_clone().map_err(|e| format!("could not reopen the log: {e}"))?;

    let mut cmd = Command::new(node_exe());
    cmd.arg("serve.mjs")
        .arg("--no-open")
        .arg("--port")
        .arg(port.to_string())
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err));

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Nothing else - no job object, no DETACHED_PROCESS - so node simply carries on
        // when this go-between exits a moment from now.
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.spawn()
        .map(|_child| ())
        .map_err(|e| format!("could not start node in {}: {e}", root.display()))
}

/// `node` from PATH, or the place the Windows installer puts it - the same two guesses the
/// vbs makes, in the other order, because a PATH that says something is more deliberate
/// than a default location.
fn node_exe() -> PathBuf {
    if let Some(found) = which("node") {
        return found;
    }
    if let Ok(pf) = std::env::var("ProgramFiles") {
        let p = Path::new(&pf).join("nodejs").join("node.exe");
        if p.is_file() {
            return p;
        }
    }
    PathBuf::from("node")
}

fn which(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    let exts: Vec<String> = if cfg!(windows) {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".EXE;.CMD;.BAT".into())
            .split(';')
            .map(|e| e.to_lowercase())
            .collect()
    } else {
        vec![String::new()]
    };
    for dir in std::env::split_paths(&path) {
        for ext in &exts {
            let candidate = dir.join(format!("{name}{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}
