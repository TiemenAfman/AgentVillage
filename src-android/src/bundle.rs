// The page the app shows, from a downloaded bundle when there is one, else from the APK
// (Plans/app-zonder-apk-bijwerken.md).
//
// Tauri serves the page from `tauri.localhost` out of the assets baked into the APK. `Overlay`
// is put in front of those (`Context::set_assets`): every asking for a file looks in
// `<app data>/bundles/<current>/` first and falls through to the baked copy when the file is
// not there. So the page stays on the same origin - which is what keeps the opener and
// `latest_release` reachable from it (capabilities/default.json is the baked page's) and what
// api.js and assets.js work their bases out from. Step 0 proved it on a phone: a page and a
// module read off the disk, and `latest_release` answering from there.
//
// The life of a bundle, all of it in plain files in `bundles/` so a crash anywhere leaves
// something the next start can read:
//
//   check     `bundle_check` asks GitHub for `promptholm-web.json`, checks its ed25519
//             signature against the key baked in here (bundle-key.pub), and refuses a bundle
//             for a newer shell (SHELL_V) or that is not newer than what runs. It fetches the
//             zip to `<v>.part`, checks size and sha256, unpacks it to `<v>.tmp` (no name that
//             leaves the folder), renames that to `<v>` and writes `next`.
//   swap      at the next start (setup) or when the page asks (`bundle_apply`, the card's
//             Restart): `prev` = `current`, `current` = `next`, `trial` = "<v> 1".
//   confirm   the page calls `bundle_ok` once it has booted: `trial` and `prev` go.
//   fall back a start that finds `trial` already at 2 has seen the bundle fail to boot twice:
//             it goes into `failed` (never tried again) and `current` goes back to `prev`, or to
//             the APK's own page. A bundle never runs when the APK is as new or newer.
//
// Nothing here decides anything on the wire: a missing key file, a GitHub that does not answer
// or a release with no bundle all leave the page the app already had.
use std::borrow::Cow;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock, RwLock};

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use sha2::{Digest, Sha256};
use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};
use tauri::{App, Assets, Context, Manager, Runtime, State};

/// What the shell offers the page (the commands in lib.rs, the opener's rights). A bundle names
/// the lowest it runs on; one for a newer shell is left for a new APK. The one copy is the file,
/// which scripts/sign-bundle.mjs reads too.
pub fn shell_v() -> u32 {
    include_str!("../shell-version").trim().parse().expect("shell-version is a whole number")
}

/// The public half of the key the release workflow signs bundles with (scripts/bundle-key.mjs
/// writes it). Empty: no bundle is ever taken.
const PUBLIC_KEY: &str = include_str!("../bundle-key.pub");

const BUNDLE_JSON: &str =
    "https://github.com/TiemenAfman/AgentVillage/releases/latest/download/promptholm-web.json";
const BUNDLE_ZIP: &str =
    "https://github.com/TiemenAfman/AgentVillage/releases/latest/download/promptholm-web.zip";

/// Past these a download or an unpacking is refused: the dist/ of 0.8.2 is 44 MB unpacked.
const MAX_ZIP: u64 = 150 << 20;
const MAX_UNPACKED: u64 = 400 << 20;
/// Starts a new bundle gets to reach `bundle_ok` before it counts as broken.
const TRIES: u32 = 2;

pub struct Shared {
    bundles: PathBuf,
    baked: String,
    dir: RwLock<Option<PathBuf>>,
    /// A check is under way (the boot's and the hourly one can overlap). An atomic and not a
    /// mutex: the check holds it across awaits, and a mutex guard is not Send.
    busy: AtomicBool,
}

struct Busy<'a>(&'a AtomicBool);

impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

struct Overlay<R: Runtime> {
    inner: Box<dyn Assets<R>>,
    shared: OnceLock<Arc<Shared>>,
}

/// Put the overlay in front of the context's baked assets. `set_assets` hands the old box
/// back only in exchange for a new one, hence the empty stand-in for the moment between.
pub fn wrap<R: Runtime>(ctx: &mut Context<R>) {
    let baked = ctx.set_assets(Box::new(Nothing));
    ctx.set_assets(Box::new(Overlay { inner: baked, shared: OnceLock::new() }));
}

struct Nothing;

impl<R: Runtime> Assets<R> for Nothing {
    fn get(&self, _: &AssetKey) -> Option<Cow<'_, [u8]>> {
        None
    }
    fn iter(&self) -> Box<AssetsIter<'_>> {
        Box::new(std::iter::empty())
    }
    fn csp_hashes(&self, _: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}

impl<R: Runtime> Assets<R> for Overlay<R> {
    // Runs before lib.rs builds the window, so the first page asked for already comes from
    // the right place.
    fn setup(&self, app: &App<R>) {
        let Ok(data) = app.path().app_data_dir() else { return };
        let shared = Arc::new(Shared {
            bundles: data.join("bundles"),
            baked: app.package_info().version.to_string(),
            dir: RwLock::new(None),
            busy: AtomicBool::new(false),
        });
        let _ = std::fs::create_dir_all(&shared.bundles);
        let dir = on_start(&shared.bundles, &shared.baked);
        *shared.dir.write().unwrap() = dir;
        app.manage(shared.clone());
        let _ = self.shared.set(shared);
    }

    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        let from_disk = self.shared.get().and_then(|s| {
            let dir = s.dir.read().ok()?.clone()?;
            std::fs::read(dir.join(inside(key.as_ref())?)).ok()
        });
        match from_disk {
            Some(bytes) => Some(Cow::Owned(bytes)),
            None => self.inner.get(key),
        }
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        self.inner.iter()
    }

    fn csp_hashes(&self, html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        // csp is null in tauri.conf.json, so these are empty; a bundle's page is never hashed.
        self.inner.csp_hashes(html_path)
    }
}

// ---- the files in bundles/ -------------------------------------------------------------

fn read(b: &Path, name: &str) -> Option<String> {
    let s = std::fs::read_to_string(b.join(name)).ok()?;
    let s = s.trim();
    (!s.is_empty()).then(|| s.to_string())
}

fn write(b: &Path, name: &str, value: &str) {
    let _ = std::fs::write(b.join(name), value);
}

fn forget(b: &Path, name: &str) {
    let _ = std::fs::remove_file(b.join(name));
}

/// A version string we take as a folder name: digits and dots only.
fn version(s: &str) -> Option<Vec<u64>> {
    if s.is_empty() || !s.chars().all(|c| c.is_ascii_digit() || c == '.') {
        return None;
    }
    s.split('.').map(|p| p.parse().ok()).collect()
}

/// a is newer than b. Unreadable is never newer, and anything readable is newer than unreadable.
fn newer(a: &str, b: &str) -> bool {
    match (version(a), version(b)) {
        (Some(x), Some(y)) => {
            let n = x.len().max(y.len());
            let at = |v: &Vec<u64>, i: usize| v.get(i).copied().unwrap_or(0);
            (0..n).map(|i| at(&x, i).cmp(&at(&y, i))).find(|o| o.is_ne()) == Some(std::cmp::Ordering::Greater)
        }
        (Some(_), None) => true,
        _ => false,
    }
}

fn usable(b: &Path, v: &str) -> bool {
    version(v).is_some() && b.join(v).join("index.html").is_file()
}

fn failed(b: &Path, v: &str) -> bool {
    read(b, "failed").is_some_and(|f| f.lines().any(|l| l.trim() == v))
}

/// Make `next` the bundle that runs, if it is still worth running. The caller holds the start
/// or the page's say-so; the trial count starts at 1 because this start or reload is a try.
fn promote(b: &Path, baked: &str) -> bool {
    let Some(next) = read(b, "next") else { return false };
    forget(b, "next");
    let cur = read(b, "current");
    let ahead = newer(&next, baked) && cur.as_deref().is_none_or(|c| newer(&next, c));
    if !usable(b, &next) || failed(b, &next) || !ahead {
        let _ = std::fs::remove_dir_all(b.join(&next));
        return false;
    }
    match cur {
        Some(c) => write(b, "prev", &c),
        None => forget(b, "prev"),
    }
    write(b, "current", &next);
    write(b, "trial", &format!("{next} 1"));
    true
}

/// Everything a start decides, in order; the folder to serve the page from, or the APK's own.
fn on_start(b: &Path, baked: &str) -> Option<PathBuf> {
    // The step-0 proof APK (0.8.2 on a branch) left `current` = proof: it is signed with the
    // release key, so a real build installs over it and must not go on showing its test page.
    if read(b, "current").as_deref() == Some("proof") {
        forget(b, "current");
        let _ = std::fs::remove_dir_all(b.join("proof"));
    }

    // A bundle on trial that never said `bundle_ok`: one more try, or it has failed.
    if let Some(trial) = read(b, "trial") {
        let mut it = trial.split_whitespace();
        let v = it.next().unwrap_or("").to_string();
        let tries: u32 = it.next().and_then(|n| n.parse().ok()).unwrap_or(TRIES);
        if tries >= TRIES {
            let mut list = read(b, "failed").unwrap_or_default();
            list.push_str(&format!("\n{v}"));
            write(b, "failed", list.trim());
            forget(b, "trial");
            match read(b, "prev").filter(|p| usable(b, p)) {
                Some(p) => write(b, "current", &p),
                None => forget(b, "current"),
            }
            forget(b, "prev");
            let _ = std::fs::remove_dir_all(b.join(&v));
        } else {
            write(b, "trial", &format!("{v} {}", tries + 1));
        }
    }

    promote(b, baked);

    // An APK as new as the bundle or newer (the keeper installed one): its own page wins.
    if let Some(c) = read(b, "current") {
        if !usable(b, &c) || !newer(&c, baked) {
            forget(b, "current");
            forget(b, "trial");
        }
    }
    tidy(b);
    read(b, "current").map(|c| b.join(c))
}

/// Remove every folder and half-written file nobody names any more.
fn tidy(b: &Path) {
    let keep: Vec<String> = ["current", "prev", "next"].iter().filter_map(|n| read(b, n)).collect();
    let Ok(entries) = std::fs::read_dir(b) else { return };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let path = e.path();
        if path.is_dir() && !keep.contains(&name) {
            let _ = std::fs::remove_dir_all(&path);
        } else if name.ends_with(".part") {
            let _ = std::fs::remove_file(&path);
        }
    }
}

/// A key is a path the page asked for, `/js/main.js`; this is it relative to the bundle's
/// folder, or None for anything that could reach outside it.
fn inside(key: &str) -> Option<&str> {
    let rel = key.trim_start_matches('/');
    let bad = rel.is_empty()
        || rel.contains('\\')
        || rel.contains(':')
        || rel.split('/').any(|part| part.is_empty() || part == "." || part == "..");
    (!bad).then_some(rel)
}

// ---- what a bundle.json says, and whether to believe it ---------------------------------

/// The bytes the signature is over. scripts/sign-bundle.mjs builds the same string; the test
/// below holds the two to one signature made by Node.
pub fn message(version: &str, shell: u32, size: u64, sha256: &str) -> String {
    format!("promptholm-web:1\n{version}\n{shell}\n{size}\n{sha256}\n")
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    let s = s.trim();
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok()).collect()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(Debug, PartialEq)]
pub struct Offer {
    pub version: String,
    pub shell: u32,
    pub size: u64,
    pub sha256: String,
}

/// A bundle.json, believed only with a good signature under `key` (32 bytes, hex).
pub fn verify(json: &serde_json::Value, key: &str) -> Result<Offer, String> {
    let key: [u8; 32] = unhex(key)
        .and_then(|k| k.try_into().ok())
        .ok_or("this app carries no bundle key")?;
    let key = VerifyingKey::from_bytes(&key).map_err(|_| "the bundle key is not a key")?;
    let field = |n: &str| json.get(n).ok_or_else(|| format!("bundle.json has no {n}"));
    if field("v")?.as_u64() != Some(1) {
        return Err("bundle.json is of a kind this app does not read".into());
    }
    let offer = Offer {
        version: field("version")?.as_str().filter(|v| version(v).is_some()).ok_or("bad version")?.into(),
        shell: field("shell")?.as_u64().and_then(|s| u32::try_from(s).ok()).ok_or("bad shell")?,
        size: field("size")?.as_u64().filter(|&s| s > 0 && s <= MAX_ZIP).ok_or("bad size")?,
        sha256: field("sha256")?
            .as_str()
            .filter(|h| h.len() == 64 && unhex(h).is_some())
            .ok_or("bad sha256")?
            .to_ascii_lowercase(),
    };
    let sig: [u8; 64] = field("sig")?
        .as_str()
        .and_then(unhex)
        .and_then(|s| s.try_into().ok())
        .ok_or("bad signature")?;
    key.verify(
        message(&offer.version, offer.shell, offer.size, &offer.sha256).as_bytes(),
        &Signature::from_bytes(&sig),
    )
    .map_err(|_| "the bundle's signature does not hold")?;
    Ok(offer)
}

/// Unpack `zip` into `to`, refusing any name that leaves the folder and more than MAX_UNPACKED.
fn unpack(zip: &Path, to: &Path) -> Result<(), String> {
    let file = std::fs::File::open(zip).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut total = 0u64;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let rel = entry.enclosed_name().ok_or("a name in the bundle leaves its folder")?;
        let out = to.join(rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut f = std::fs::File::create(&out).map_err(|e| e.to_string())?;
        // Counted as it is written, never trusted from the header: a zip may lie about sizes.
        let mut buf = [0u8; 64 << 10];
        loop {
            let n = entry.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            total += n as u64;
            if total > MAX_UNPACKED {
                return Err("the bundle unpacks to more than it may".into());
            }
            f.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        }
    }
    if !to.join("index.html").is_file() {
        return Err("the bundle has no index.html".into());
    }
    Ok(())
}

// ---- the commands the page calls ---------------------------------------------------------

/// Look for a newer bundle and fetch it. `{ status, version }`: `ready` (fetched, waiting for a
/// restart), `current` (nothing newer), `shell` (needs a newer app: the APK card's business),
/// `none` (no bundle published, or this app has no key).
#[tauri::command]
pub async fn bundle_check(shared: State<'_, Arc<Shared>>) -> Result<serde_json::Value, String> {
    let s = shared.inner().clone();
    let answer = |status: &str, version: Option<&str>| serde_json::json!({ "status": status, "version": version });
    if PUBLIC_KEY.trim().is_empty() {
        return Ok(answer("none", None));
    }
    if s.busy.swap(true, Ordering::SeqCst) {
        return Ok(answer("busy", None));
    }
    let _held = Busy(&s.busy);
    let b = &s.bundles;
    if let Some(next) = read(b, "next").filter(|n| usable(b, n)) {
        return Ok(answer("ready", Some(&next)));
    }

    let client = reqwest::Client::new();
    let res = client
        .get(BUNDLE_JSON)
        .header("User-Agent", "promptholm-android")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if res.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(answer("none", None));
    }
    if !res.status().is_success() {
        return Err(format!("GitHub answered {}", res.status()));
    }
    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let offer = verify(&json, PUBLIC_KEY)?;
    let running = read(b, "current").unwrap_or_else(|| s.baked.clone());
    if !newer(&offer.version, &running) || !newer(&offer.version, &s.baked) || failed(b, &offer.version) {
        return Ok(answer("current", Some(&offer.version)));
    }
    if offer.shell > shell_v() {
        return Ok(answer("shell", Some(&offer.version)));
    }

    // The zip, a chunk at a time to disk, hashed as it comes and cut off past its own size.
    let part = b.join(format!("{}.part", offer.version));
    let mut res = client
        .get(BUNDLE_ZIP)
        .header("User-Agent", "promptholm-android")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("the bundle answered {}", res.status()));
    }
    let mut file = std::fs::File::create(&part).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut got = 0u64;
    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        got += chunk.len() as u64;
        if got > offer.size {
            let _ = std::fs::remove_file(&part);
            return Err("the bundle is bigger than it said".into());
        }
        hash.update(&chunk);
        file.write_all(&chunk).map_err(|e| e.to_string())?;
    }
    drop(file);
    if got != offer.size || hex(&hash.finalize()) != offer.sha256 {
        let _ = std::fs::remove_file(&part);
        return Err("the bundle is not the one that was signed".into());
    }

    let tmp = b.join(format!("{}.tmp", offer.version));
    let _ = std::fs::remove_dir_all(&tmp);
    let unpacked = unpack(&part, &tmp);
    let _ = std::fs::remove_file(&part);
    if let Err(e) = unpacked {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(e);
    }
    let dir = b.join(&offer.version);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::rename(&tmp, &dir).map_err(|e| e.to_string())?;
    write(b, "next", &offer.version);
    Ok(answer("ready", Some(&offer.version)))
}

/// The card's Restart: swap now, and the page reloads itself onto it.
#[tauri::command]
pub fn bundle_apply(shared: State<'_, Arc<Shared>>) -> bool {
    let s = shared.inner();
    if !promote(&s.bundles, &s.baked) {
        return false;
    }
    *s.dir.write().unwrap() = read(&s.bundles, "current").map(|c| s.bundles.join(c));
    true
}

/// The page booted on the bundle it was served: it is good, and the one before it can go.
#[tauri::command]
pub fn bundle_ok(shared: State<'_, Arc<Shared>>) {
    let b = &shared.inner().bundles;
    if read(b, "trial").is_some() {
        forget(b, "trial");
        if let Some(p) = read(b, "prev") {
            forget(b, "prev");
            let _ = std::fs::remove_dir_all(b.join(p));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("promptholm-bundle-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    fn bundle(b: &Path, v: &str) {
        std::fs::create_dir_all(b.join(v)).unwrap();
        std::fs::write(b.join(v).join("index.html"), v).unwrap();
    }

    #[test]
    fn a_key_never_reaches_outside_the_bundle() {
        assert_eq!(inside("/js/main.js"), Some("js/main.js"));
        assert_eq!(inside("/index.html"), Some("index.html"));
        for bad in ["/", "", "/../x", "/js/../../x", "/./x", "/js//x", "/a\\b", "/C:/x", "/x/.."] {
            assert_eq!(inside(bad), None, "{bad}");
        }
    }

    #[test]
    fn versions_compare_by_number() {
        assert!(newer("0.8.10", "0.8.9"));
        assert!(newer("0.9", "0.8.9"));
        assert!(!newer("0.8.2", "0.8.2"));
        assert!(!newer("0.8.1", "0.8.2"));
        assert!(!newer("../0.9", "0.8.2"), "not a version, never newer");
        assert!(newer("0.8.3", "proof"));
    }

    #[test]
    fn a_fetched_bundle_runs_from_the_next_start_and_is_kept_once_it_boots() {
        let b = scratch("swap");
        bundle(&b, "0.8.3");
        write(&b, "next", "0.8.3");
        assert_eq!(on_start(&b, "0.8.2"), Some(b.join("0.8.3")));
        assert_eq!(read(&b, "trial").as_deref(), Some("0.8.3 1"));
        // The page says it booted.
        forget(&b, "trial");
        assert_eq!(on_start(&b, "0.8.2"), Some(b.join("0.8.3")), "kept across starts");
        // A newer APK goes over it: its own page wins and the bundle is cleared away.
        assert_eq!(on_start(&b, "0.8.3"), None);
        assert!(!b.join("0.8.3").exists());
    }

    #[test]
    fn a_bundle_that_never_boots_falls_back_and_is_not_tried_again() {
        let b = scratch("fail");
        bundle(&b, "0.8.3");
        write(&b, "current", "0.8.3");
        bundle(&b, "0.8.4");
        write(&b, "next", "0.8.4");
        assert_eq!(on_start(&b, "0.8.2"), Some(b.join("0.8.4")), "first try");
        assert_eq!(on_start(&b, "0.8.2"), Some(b.join("0.8.4")), "second try");
        assert_eq!(on_start(&b, "0.8.2"), Some(b.join("0.8.3")), "two starts without bundle_ok: back");
        assert!(failed(&b, "0.8.4"));
        bundle(&b, "0.8.4");
        write(&b, "next", "0.8.4");
        assert_eq!(on_start(&b, "0.8.2"), Some(b.join("0.8.3")), "a failed version is never promoted");
    }

    #[test]
    fn an_older_bundle_never_replaces_a_newer_one() {
        let b = scratch("older");
        bundle(&b, "0.8.5");
        write(&b, "current", "0.8.5");
        bundle(&b, "0.8.4");
        write(&b, "next", "0.8.4");
        assert_eq!(on_start(&b, "0.8.2"), Some(b.join("0.8.5")));
        assert!(!b.join("0.8.4").exists(), "tidied away");
    }

    #[test]
    fn the_proof_bundle_is_cleared() {
        let b = scratch("proof");
        bundle(&b, "proof");
        write(&b, "current", "proof");
        assert_eq!(on_start(&b, "0.8.2"), None);
        assert!(!b.join("proof").exists());
    }

    // Seed 32 x 0x07, signed by Node's crypto over `message` (tests/bundle-sign.test.mjs makes
    // and asserts the same signature), so the two languages agree on the signed bytes.
    const TEST_KEY: &str = "ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c";
    const TEST_SIG: &str = "389d190eec228a37a6dba535af0692bb2bffac0806ac5f9aff1ba75b89b1d53c53c082a406c7f643e33a99fcd0aa1b0854b30b03926b2d52f115faf130365a01";

    #[test]
    fn a_signature_made_by_node_holds_and_anything_changed_breaks_it() {
        let good = serde_json::json!({
            "v": 1, "version": "0.8.3", "shell": 1, "size": 1234,
            "sha256": "ab".repeat(32), "sig": TEST_SIG,
        });
        let offer = verify(&good, TEST_KEY).expect("node's signature holds");
        assert_eq!(offer, Offer { version: "0.8.3".into(), shell: 1, size: 1234, sha256: "ab".repeat(32) });
        for (field, value) in [("version", serde_json::json!("0.8.4")), ("size", serde_json::json!(1235)),
                               ("shell", serde_json::json!(2)), ("sha256", serde_json::json!("cd".repeat(32)))] {
            let mut bad = good.clone();
            bad[field] = value;
            assert!(verify(&bad, TEST_KEY).is_err(), "{field} changed and it still verified");
        }
        assert!(verify(&good, "").is_err(), "no key, no bundle");
    }

    // A real bundle end to end, as CI makes it: PROMPTHOLM_BUNDLE_E2E=<dir> with web.json,
    // web.zip and pub (scripts/bundle-key.mjs + sign-bundle.mjs), then
    // `cargo test --lib -- --ignored real_bundle`.
    #[test]
    #[ignore]
    fn real_bundle_verifies_and_unpacks() {
        let dir = PathBuf::from(std::env::var("PROMPTHOLM_BUNDLE_E2E").expect("PROMPTHOLM_BUNDLE_E2E"));
        let json: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.join("web.json")).unwrap()).unwrap();
        let key = std::fs::read_to_string(dir.join("pub")).unwrap();
        let offer = verify(&json, &key).expect("signed by sign-bundle.mjs");
        let bytes = std::fs::read(dir.join("web.zip")).unwrap();
        assert_eq!(bytes.len() as u64, offer.size);
        assert_eq!(hex(&Sha256::digest(&bytes)), offer.sha256);
        let out = dir.join("unpacked");
        let _ = std::fs::remove_dir_all(&out);
        unpack(&dir.join("web.zip"), &out).expect("unpacks");
        assert!(out.join("js/main.js").is_file());
    }

    #[test]
    fn unpacking_refuses_a_name_that_leaves_the_folder() {
        let b = scratch("zip");
        let zip_path = b.join("evil.zip");
        let mut z = zip::ZipWriter::new(std::fs::File::create(&zip_path).unwrap());
        let opts = zip::write::SimpleFileOptions::default();
        z.start_file("index.html", opts).unwrap();
        z.write_all(b"<html>").unwrap();
        z.start_file("../escape.txt", opts).unwrap();
        z.write_all(b"x").unwrap();
        z.finish().unwrap();
        assert!(unpack(&zip_path, &b.join("out")).is_err());
        assert!(!b.join("escape.txt").exists());
    }
}
