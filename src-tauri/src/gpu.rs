// Which graphics card the window draws on: the keeper's choice in Settings -> Graphics
// (Plans/sneller-op-igpu.md), "fast" (the discrete card, the default) or "low" (the integrated
// one - on the accu, or to leave the RTX to something else).
//
// Chromium picks its adapter once, when the GPU process starts, from a command-line switch:
// nothing the page says later (`powerPreference`) moves it. So the choice is kept in gpu.json
// beside window.json, read before the window is built, and a change takes a new window. The
// page asks through promptholm://gpu/<fast|low|query|restart> - the close's door, no IPC
// capability opened to a remote page - and is told `window.promptholmGpu({ running, chosen })`.
//
// The switch names have underscores. Chromium matches them literally and ignores the hyphenated
// spelling the window carried up to 0.10.7 (measured, Plans/sneller-op-igpu.md).

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Gpu {
    Fast,
    Low,
}

impl Gpu {
    pub fn word(self) -> &'static str {
        match self {
            Gpu::Fast => "fast",
            Gpu::Low => "low",
        }
    }

    /// The page's word, or None for anything else (an old file, a typo): the caller keeps fast.
    pub fn from_word(w: &str) -> Option<Gpu> {
        match w.trim().to_ascii_lowercase().as_str() {
            "fast" => Some(Gpu::Fast),
            "low" => Some(Gpu::Low),
            _ => None,
        }
    }

    /// The Chromium switch that puts the GPU process on this card.
    pub fn switch(self) -> &'static str {
        match self {
            Gpu::Fast => "--force_high_performance_gpu",
            Gpu::Low => "--force_low_power_gpu",
        }
    }
}

/// Tauri's own default (the msWebOOUI/msPdfOOUI/msSmartScreenProtection set) has to be
/// repeated, because `additional_browser_args` replaces it rather than adding to it.
const TAURI_DEFAULT: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

/// Everything the window hands WebView2, for the card chosen.
pub fn browser_args(gpu: Gpu) -> String {
    format!("{TAURI_DEFAULT} {}", gpu.switch())
}

/// gpu.json's contents: `{"gpu":"low"}`. Anything unreadable is the default, fast.
pub fn parse(json: &[u8]) -> Gpu {
    serde_json::from_slice::<serde_json::Value>(json)
        .ok()
        .and_then(|v| v.get("gpu").and_then(|g| g.as_str()).and_then(Gpu::from_word))
        .unwrap_or(Gpu::Fast)
}

pub fn load(path: &Path) -> Gpu {
    std::fs::read(path).map(|b| parse(&b)).unwrap_or(Gpu::Fast)
}

/// Written by rename, like window.json: a crash halfway leaves the old choice.
pub fn save(path: &Path, gpu: Gpu) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, format!("{{\"gpu\":\"{}\"}}", gpu.word()))?;
    std::fs::rename(&tmp, path)
}

/// The line the page is told: what this window draws on now, and what the next one will.
pub fn tell_line(running: Gpu, chosen: Gpu) -> String {
    format!(
        "window.promptholmGpu && window.promptholmGpu({{ running: '{}', chosen: '{}' }})",
        running.word(),
        chosen.word()
    )
}

/// How a restarted window knows to wait for the one that started it.
pub const AFTER_FLAG: &str = "--after-window";

/// The arguments a restarted window gets: this one's own (`--url`, `--port`), less an earlier
/// AFTER_FLAG and its pid, plus AFTER_FLAG <pid>.
pub fn restart_args(own: &[String], pid: u32) -> Vec<String> {
    let mut out = Vec::new();
    let mut skip = false;
    for a in own {
        if skip {
            skip = false;
            continue;
        }
        if a == AFTER_FLAG {
            skip = true;
            continue;
        }
        out.push(a.clone());
    }
    out.push(AFTER_FLAG.to_string());
    out.push(pid.to_string());
    out
}

/// The pid after AFTER_FLAG, if this window was started by another one restarting.
pub fn after_pid(args: &[String]) -> Option<u32> {
    let i = args.iter().position(|a| a == AFTER_FLAG)?;
    args.get(i + 1)?.parse().ok()
}

/// Wait for the window that restarted us to be gone, so its WebView2 browser process lets go
/// of the profile folder: one folder is one browser process, and a second environment asking
/// for other switches while the old one lives is refused. The browser process follows its host
/// out within a moment, which the short pause after covers; the window's build is retried on
/// top of that (lib.rs).
#[cfg(windows)]
pub fn wait_for(pid: u32, limit: Duration) {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE};
    unsafe {
        let h = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
        if !h.is_null() {
            WaitForSingleObject(h, limit.as_millis().min(u32::MAX as u128) as u32);
            CloseHandle(h);
        }
    }
    std::thread::sleep(Duration::from_millis(400));
}

#[cfg(not(windows))]
pub fn wait_for(_pid: u32, limit: Duration) {
    std::thread::sleep(limit.min(Duration::from_secs(1)));
}

/// Start a fresh copy of this exe as the next window. It inherits nothing of ours to wait on.
pub fn spawn_next(exe: &PathBuf, args: &[String]) -> std::io::Result<()> {
    let mut cmd = std::process::Command::new(exe);
    cmd.args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    cmd.spawn().map(|_| ())
}

/// Retry `f` until it succeeds or `limit` has passed (the last error is returned).
pub fn retry<T, E>(limit: Duration, mut f: impl FnMut() -> Result<T, E>) -> Result<T, E> {
    let start = Instant::now();
    loop {
        match f() {
            Ok(v) => return Ok(v),
            Err(e) if start.elapsed() >= limit => return Err(e),
            Err(_) => std::thread::sleep(Duration::from_millis(300)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_switch_follows_the_choice_with_underscores() {
        assert_eq!(Gpu::Fast.switch(), "--force_high_performance_gpu");
        assert_eq!(Gpu::Low.switch(), "--force_low_power_gpu");
        for g in [Gpu::Fast, Gpu::Low] {
            let args = browser_args(g);
            assert!(args.starts_with(TAURI_DEFAULT), "Tauri's default is repeated: {args}");
            assert!(args.ends_with(g.switch()));
            assert!(!args.contains("force-"), "never the hyphenated spelling: {args}");
        }
    }

    #[test]
    fn the_file_reads_back_and_anything_else_is_fast() {
        assert_eq!(parse(br#"{"gpu":"low"}"#), Gpu::Low);
        assert_eq!(parse(br#"{"gpu":"fast"}"#), Gpu::Fast);
        assert_eq!(parse(br#"{"gpu":"rtx"}"#), Gpu::Fast);
        assert_eq!(parse(b"not json"), Gpu::Fast);
        assert_eq!(parse(b"{}"), Gpu::Fast);
        let dir = std::env::temp_dir().join(format!("promptholm-gpu-{}", std::process::id()));
        let path = dir.join("gpu.json");
        save(&path, Gpu::Low).unwrap();
        assert_eq!(load(&path), Gpu::Low);
        save(&path, Gpu::Fast).unwrap();
        assert_eq!(load(&path), Gpu::Fast);
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(load(&dir.join("missing.json")), Gpu::Fast);
    }

    #[test]
    fn words_and_the_line_told() {
        assert_eq!(Gpu::from_word(" LOW "), Some(Gpu::Low));
        assert_eq!(Gpu::from_word("query"), None);
        assert_eq!(
            tell_line(Gpu::Fast, Gpu::Low),
            "window.promptholmGpu && window.promptholmGpu({ running: 'fast', chosen: 'low' })"
        );
    }

    #[test]
    fn a_restart_keeps_the_arguments_and_names_one_pid() {
        let own: Vec<String> = ["--port", "4747", "--after-window", "12", "--url", "x"]
            .iter().map(|s| s.to_string()).collect();
        let next = restart_args(&own, 99);
        assert_eq!(next, ["--port", "4747", "--url", "x", "--after-window", "99"]);
        assert_eq!(after_pid(&next), Some(99));
        assert_eq!(after_pid(&own[..2]), None);
    }
}
