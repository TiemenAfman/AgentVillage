// Everything the desktop window knows about the service it shows, and nothing about Tauri.
// The islander exe (bin/promptholm-island.rs) includes this same file by path, which is
// why nothing in here may reach for Tauri: that binary does not link it.
//
// The window is a shell around `serve.mjs`, not a second copy of it: the islander keeps the
// scan, the data, the agents and the mail, and this side only has to answer three questions
// before it can point a webview at it. Where is the island's folder? Which port is it on?
// Is anything listening there yet - and if not, can we start it?
//
// Starting node always looks the same, whichever exe does it: no console window, everything
// the server prints appended to data/server.log. Two launchers that put a crash in two
// different places is one place too many to look.
use std::fs::{self, OpenOptions};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
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
        self.root.as_ref().map(|r| home(r).join("data").join("server.log"))
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
    // uses - serve.mjs's own --open, the tray's "Open in browser" - and the page keeps its
    // settings per origin.
    Plan { url: format!("http://localhost:{port}/"), port, root, remote: false }
}

/// The folder serve.mjs lives in. Five places to look, in the order they are likely to be
/// right:
///   PROMPTHOLM_ROOT          somebody said so
///   app\ beside the exe    an unpacked release: both exes and the island they run, in one
///                          folder that can stand anywhere
///   CARGO_MANIFEST_DIR/..  where this binary was built from - correct for `tauri dev` and
///                          for a build that stays on this machine
///   above the executable   an exe dropped into a checkout, or into a folder next to it
///   remembered             the checkout the last islander on this machine ran from
///                          (`remember_root`) - what makes a release zip unpacked on the
///                          desktop find the island instead of reporting it missing
pub fn find_root() -> Option<PathBuf> {
    let is_root = |p: &Path| p.join("serve.mjs").is_file();

    if let Ok(v) = std::env::var("PROMPTHOLM_ROOT") {
        let p = PathBuf::from(v.trim());
        if is_root(&p) {
            return Some(p);
        }
    }

    let beside = std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.join("app")));
    if let Some(p) = beside.filter(|p| is_root(p)) {
        return Some(p);
    }

    let built_from = Path::new(env!("CARGO_MANIFEST_DIR")).parent().map(Path::to_path_buf);
    if let Some(p) = built_from.filter(|p| is_root(p)) {
        return Some(p);
    }

    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent();
        while let Some(d) = dir {
            if is_root(d) {
                return Some(d.to_path_buf());
            }
            dir = d.parent();
        }
    }

    remembered_root().filter(|p| is_root(p))
}

/// %LOCALAPPDATA%\Promptholm - where an unpacked release keeps its config and data, and
/// where the islander leaves a note of which folder it ran from.
fn local_home() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|b| PathBuf::from(b).join("Promptholm"))
}

/// Where the island in `root` keeps config.json and data/. The same rule as HOME in
/// lib/paths.mjs, and it has to stay the same rule: the log the tray opens and the one the
/// server writes are only one file while the two agree. A checkout keeps them in itself; a
/// release (release.json beside serve.mjs) in %LOCALAPPDATA%\Promptholm.
pub fn home(root: &Path) -> PathBuf {
    if let Some(v) = std::env::var_os("PROMPTHOLM_HOME").filter(|v| !v.is_empty()) {
        return PathBuf::from(v);
    }
    if root.join("release.json").is_file() {
        if let Some(h) = local_home() {
            return h;
        }
    }
    root.to_path_buf()
}

fn memory_file() -> Option<PathBuf> {
    local_home().map(|h| h.join("checkout.txt"))
}

fn remembered_root() -> Option<PathBuf> {
    let text = fs::read_to_string(memory_file()?).ok()?;
    let line = text.lines().next()?.trim();
    (!line.is_empty()).then(|| PathBuf::from(line))
}

/// Written by the islander each time it starts. Best effort: an exe that cannot write it
/// still runs its island, it only means a stray copy elsewhere will not find it.
pub fn remember_root(root: &Path) {
    let Some(file) = memory_file() else { return };
    if let Some(dir) = file.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let _ = fs::write(file, format!("{}\n", root.display()));
}

/// Which version and commit the island in `root` is: "0.1.1 · 9eac940". The same rule as
/// lib/buildinfo.mjs, and it has to stay the same rule or the tray and the island's own
/// sea name different code: a release says so in release.json (it has no .git), a checkout
/// has package.json for the version and .git for the commit. Read from the folder, not
/// from the exe - the tray runs whatever checkout it was pointed at, and that moves on
/// with every pull while the exe stays the one that was built.
pub fn build_label(root: &Path) -> String {
    let json = |f: &Path| -> Option<serde_json::Value> { serde_json::from_str(&fs::read_to_string(f).ok()?).ok() };
    let text = |v: &serde_json::Value, k: &str| v.get(k).and_then(|s| s.as_str()).map(str::to_string);
    let (version, commit) = match json(&root.join("release.json")) {
        Some(r) => (text(&r, "version"), text(&r, "commit")),
        None => (json(&root.join("package.json")).and_then(|p| text(&p, "version")), git_commit(root)),
    };
    let parts: Vec<String> = [version.map(|v| format!("v{v}")), commit].into_iter().flatten().collect();
    if parts.is_empty() { "unknown build".to_string() } else { parts.join(" · ") }
}

/// HEAD's commit, seven characters, read by hand: through a worktree's `.git` file, a
/// symbolic ref, and packed-refs. None without a repository.
fn git_commit(root: &Path) -> Option<String> {
    let read = |p: PathBuf| fs::read_to_string(p).ok().map(|s| s.trim().to_string());
    let hex = |s: &str| s.len() == 40 && s.bytes().all(|b| b.is_ascii_hexdigit());
    let mut dir = root.join(".git");
    if let Some(pointer) = read(dir.clone()).filter(|p| p.starts_with("gitdir:")) {
        dir = root.join(pointer[7..].trim());
    }
    let head = read(dir.join("HEAD"))?;
    let Some(r) = head.strip_prefix("ref:").map(str::trim) else {
        return hex(&head).then(|| head[..7].to_string());
    };
    let refs = read(dir.join("commondir")).map(|c| dir.join(c)).unwrap_or_else(|| dir.clone());
    if let Some(h) = read(refs.join(r)).filter(|h| hex(h)) {
        return Some(h[..7].to_string());
    }
    read(refs.join("packed-refs"))?.lines().find_map(|line| {
        let (h, name) = line.trim().split_once(' ')?;
        (name == r && hex(h)).then(|| h[..7].to_string())
    })
}

/// `port` out of config.json, when the file is there and says so. Anything else - no file,
/// a comment somebody added, a string - is the default, exactly as `config.port || 4747`
/// treats it on the Node side.
fn port_from_config(root: &Path) -> Option<u16> {
    let text = fs::read_to_string(home(root).join("config.json")).ok()?;
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

/// The islander's own executable, which lives next to the window's: one crate, one build,
/// two binaries (Plans/islander-als-eigen-exe.md).
pub const ISLANDER_EXE: &str = "promptholm-island.exe";

/// Start the islander in `root`. Returns once the process exists; whether it comes up is
/// `wait`'s job.
///
/// The islander outlives this window on purpose. It is the long-lived half - the scan, the
/// sea, the mail, the agents - and closing the thing you look at it through is not a reason
/// to stop any of that. Its own tray icon is how it is stopped.
///
/// Surviving a plain close is free: Windows does not stop a child when its parent exits.
/// Surviving a *tree* kill is not - `taskkill /T`, Task Manager's "End process tree", and
/// the terminal that ran `npm run app` being closed all walk the parent-pid chain and take
/// every descendant with them. So the window does not start the islander itself: it starts a
/// second copy of this executable with SPAWN_FLAG, which starts the islander and exits at
/// once. By the time anybody walks the tree, the islander's parent is a dead pid and the walk
/// cannot reach it.
///
/// The go-between gets no pipes. This used to be `output()`, which waits for EOF on the
/// go-between's stdout and stderr - and Windows hands every inheritable handle down to node,
/// those two pipes included, so EOF came when node *exited*. The island was up in two
/// seconds and the splash sat on "Starting the island" until somebody stopped it. So: wait
/// for the exit code only, and let whatever the go-between says land in server.log, the
/// file the splash's failure already points at.
pub fn start(root: &Path, port: u16) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| format!("could not find my own executable: {e}"))?;
    let (_, log_err) = open_log(root)?;
    let mut cmd = Command::new(exe);
    cmd.arg(SPAWN_FLAG)
        .arg(root)
        .arg(port.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::from(log_err));
    no_window(&mut cmd);
    let status = cmd.status().map_err(|e| format!("could not start the go-between: {e}"))?;
    if status.success() {
        return Ok(());
    }
    Err(format!("Could not start the island (the go-between exited with {status}). The end of the island's log says why."))
}

/// data/server.log opened for appending, twice - one handle for stdout, one for stderr.
fn open_log(root: &Path) -> Result<(fs::File, fs::File), String> {
    let data = home(root).join("data");
    fs::create_dir_all(&data).map_err(|e| format!("could not create {}: {e}", data.display()))?;
    let log_path = data.join("server.log");
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("could not open {}: {e}", log_path.display()))?;
    let log_err = log.try_clone().map_err(|e| format!("could not reopen the log: {e}"))?;
    Ok((log, log_err))
}

/// The go-between's whole life. Called first thing in `run()`: when this process was started
/// with SPAWN_FLAG it starts the islander, reports on stderr if it could not, and says so -
/// the caller then returns without ever building a window.
///
/// The islander exe when it stands next to us, node itself when it does not - an exe copied
/// somewhere on its own still gets an island, just one without a tray to stop it from.
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
    let started = match islander_exe() {
        Some(exe) => {
            let mut cmd = Command::new(&exe);
            cmd.arg("--port")
                .arg(port.to_string())
                .env("PROMPTHOLM_ROOT", &root)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            no_window(&mut cmd);
            cmd.spawn().map(|_| ()).map_err(|e| format!("could not start {}: {e}", exe.display()))
        }
        None => spawn_node(&root, port, false).map(|_| ()),
    };
    if let Err(e) = started {
        eprintln!("{e}");
        std::process::exit(1);
    }
    true
}

fn islander_exe() -> Option<PathBuf> {
    let p = std::env::current_exe().ok()?.with_file_name(ISLANDER_EXE);
    p.is_file().then_some(p)
}

/// CREATE_NO_WINDOW: a GUI app has no console to hand down, and without this flag Windows
/// conjures one up for node and flashes it on screen. The child gets an invisible console of
/// its own instead of ours, which is also what keeps a ctrl+C in the launching terminal
/// from reaching it.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Nothing else - no job object, no DETACHED_PROCESS - so a child simply carries on
        // when whoever started it exits.
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

/// node itself, with no console and its output appended to data/server.log, so a crash lands
/// in the same file whichever exe started the island.
///
/// `supervised` is the islander exe's way of starting it: stdin is a pipe the caller keeps,
/// and serve.mjs shuts down cleanly when it closes. Anybody else passes false, because a
/// go-between that exits a moment later would close that pipe and take the island with it.
pub fn spawn_node(root: &Path, port: u16, supervised: bool) -> Result<Child, String> {
    let (log, log_err) = open_log(root)?;

    let mut cmd = Command::new(node_exe());
    cmd.arg("serve.mjs")
        .arg("--no-open")
        .arg("--port")
        .arg(port.to_string())
        .current_dir(root)
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err));
    if supervised {
        cmd.arg("--supervised").stdin(Stdio::piped());
    } else {
        cmd.stdin(Stdio::null());
    }
    no_window(&mut cmd);

    cmd.spawn().map_err(|e| format!("could not start node in {}: {e}", root.display()))
}

/// Stop whatever is listening on `port`: netstat for the pid,
/// taskkill /f for the process. Only for an island somebody else started - one the islander
/// exe started itself is asked politely through its stdin first.
pub fn kill_listener(port: u16) -> bool {
    let mut cmd = Command::new("netstat");
    cmd.args(["-ano", "-p", "TCP"]);
    no_window(&mut cmd);
    let Ok(out) = cmd.output() else { return false };
    let wanted = format!(":{port}");
    let mut killed = false;
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let cols: Vec<&str> = line.split_whitespace().collect();
        // Proto, Local Address, Foreign Address, State, PID. The state column is localised
        // ("LISTENING", "LUISTEREN"), so a foreign address of port 0 is the test instead.
        if cols.len() != 5 || !cols[1].ends_with(&wanted) || !cols[2].ends_with(":0") {
            continue;
        }
        if let Ok(pid) = cols[4].parse::<u32>() {
            let mut kill = Command::new("taskkill");
            kill.args(["/f", "/pid", &pid.to_string()]).stdout(Stdio::null()).stderr(Stdio::null());
            no_window(&mut kill);
            killed |= kill.status().map(|s| s.success()).unwrap_or(false);
        }
    }
    killed
}

/// `node` from PATH, or the place the Windows installer puts it - in that order, because a
/// PATH that says something is more deliberate than a default location.
pub fn node_exe() -> PathBuf {
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
