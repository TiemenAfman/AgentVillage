// The page the app shows, from a downloaded bundle when there is one, else from the APK
// (Plans/app-zonder-apk-bijwerken.md, decision 7).
//
// Tauri serves the page from `tauri.localhost` out of the assets baked into the APK. `Overlay`
// is put in front of those (`Context::set_assets`): every asking for a file looks in
// `<app data>/bundles/<current>/` first and falls through to the baked copy when the file is
// not there. So the page stays on the same origin - which is what keeps the opener and
// `latest_release` reachable from it (capabilities/default.json is the baked page's) and what
// api.js and assets.js work their bases out from - and a bundle that lacks a file costs
// nothing but that file coming from the APK.
//
// What decides the bundle is the one line in `bundles/current`, a folder name. Until anything
// writes that file this is the baked page exactly, byte for byte. Downloading, checking the
// signature and swapping `current` are step 3 of the plan and not here yet.
//
// Step 0 (the `bundle-proof` feature, never in a release): on start the app writes a bundle of
// its own - the baked index.html with a red bar over it and one small module beside it - and
// points `current` at it, so a phone can show whether a page read off the disk is served, runs
// its modules and may still call the app.
use std::borrow::Cow;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};
use tauri::{App, Assets, Context, Manager, Runtime};

struct Overlay<R: Runtime> {
    inner: Box<dyn Assets<R>>,
    dir: OnceLock<Option<PathBuf>>,
}

/// Put the overlay in front of the context's baked assets. `set_assets` hands the old box
/// back only in exchange for a new one, hence the empty stand-in for the moment between.
pub fn wrap<R: Runtime>(ctx: &mut Context<R>) {
    let baked = ctx.set_assets(Box::new(Nothing));
    ctx.set_assets(Box::new(Overlay { inner: baked, dir: OnceLock::new() }));
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

impl<R: Runtime> Overlay<R> {

    fn from_disk(&self, key: &AssetKey) -> Option<Vec<u8>> {
        let dir = self.dir.get()?.as_ref()?;
        std::fs::read(dir.join(inside(key.as_ref())?)).ok()
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

/// The bundle `bundles/current` names, if it is there. Only a plain folder name is taken.
fn current(bundles: &Path) -> Option<PathBuf> {
    let name = std::fs::read_to_string(bundles.join("current")).ok()?;
    let name = name.trim();
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') {
        return None;
    }
    let dir = bundles.join(name);
    dir.join("index.html").is_file().then_some(dir)
}

impl<R: Runtime> Assets<R> for Overlay<R> {
    fn setup(&self, app: &App<R>) {
        let bundles = app.path().app_data_dir().ok().map(|d| d.join("bundles"));
        #[cfg(feature = "bundle-proof")]
        if let Some(b) = &bundles {
            if let Err(e) = proof::write(b, self.inner.get(&AssetKey::from("index.html"))) {
                eprintln!("promptholm: could not write the proof bundle: {e}");
            }
        }
        // The proof APK is signed with the release key, so it installs over the real app and the
        // real app over it: a build without the feature clears what the proof left behind, or the
        // next release would go on showing the test page.
        #[cfg(not(feature = "bundle-proof"))]
        if let Some(b) = &bundles {
            if std::fs::read_to_string(b.join("current")).is_ok_and(|n| n.trim() == "proof") {
                let _ = std::fs::remove_file(b.join("current"));
                let _ = std::fs::remove_dir_all(b.join("proof"));
            }
        }
        let _ = self.dir.set(bundles.as_deref().and_then(current));
    }

    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        match self.from_disk(key) {
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

#[cfg(feature = "bundle-proof")]
mod proof {
    use std::borrow::Cow;
    use std::path::Path;

    // A red bar that says where the page came from and asks the app the two things the plan
    // needs to know: does `latest_release` answer, and does the opener open a link.
    const BAR: &str = r##"<div id="bundle-proof" style="position:fixed;top:calc(env(safe-area-inset-top) + 6px);left:6px;right:6px;z-index:99999;background:#b03a2e;color:#fff;font:14px/1.4 sans-serif;padding:8px 10px;border-radius:8px">
<b>Bundle proof</b>: this page came from the download folder.<br>
Module: <span id="bp-mod">not run</span><br>
latest_release: <span id="bp-rel">asking...</span><br>
<a id="bp-open" href="#" style="color:#fff;text-decoration:underline">Open the release page (opener)</a>
</div>
<script type="module" src="./bundle-proof.js"></script>
<script>(function () {
  var ipc = window.__TAURI_INTERNALS__, rel = document.getElementById('bp-rel');
  if (!ipc) { rel.textContent = 'no IPC on this page'; return; }
  ipc.invoke('latest_release').then(function (v) { rel.textContent = 'works (' + v + ')'; })
    .catch(function (e) { rel.textContent = 'FAILED: ' + e; });
  document.getElementById('bp-open').onclick = function (e) {
    e.preventDefault();
    ipc.invoke('plugin:opener|open_url', { url: 'https://github.com/TiemenAfman/AgentVillage/releases/latest' })
      .catch(function (err) { alert('opener FAILED: ' + err); });
  };
})();</script>
"##;

    const MODULE: &str = "document.getElementById('bp-mod').textContent = 'works (a module read off the disk)';\n";

    pub fn write(bundles: &Path, baked: Option<Cow<'_, [u8]>>) -> std::io::Result<()> {
        let baked = baked.ok_or_else(|| std::io::Error::other("no baked index.html"))?;
        let html = String::from_utf8_lossy(&baked);
        let html = match html.rfind("</body>") {
            Some(i) => format!("{}{}{}", &html[..i], BAR, &html[i..]),
            None => format!("{html}{BAR}"),
        };
        let dir = bundles.join("proof");
        std::fs::create_dir_all(&dir)?;
        std::fs::write(dir.join("index.html"), html)?;
        std::fs::write(dir.join("bundle-proof.js"), MODULE)?;
        std::fs::write(bundles.join("current"), "proof")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_key_never_reaches_outside_the_bundle() {
        assert_eq!(inside("/js/main.js"), Some("js/main.js"));
        assert_eq!(inside("/index.html"), Some("index.html"));
        for bad in ["/", "", "/../x", "/js/../../x", "/./x", "/js//x", "/a\\b", "/C:/x", "/x/.."] {
            assert_eq!(inside(bad), None, "{bad}");
        }
    }

    #[test]
    fn current_takes_a_plain_folder_name_that_holds_a_page() {
        let root = std::env::temp_dir().join(format!("promptholm-bundle-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("0.8.3")).unwrap();
        assert_eq!(current(&root), None, "no current file");
        std::fs::write(root.join("current"), "0.8.3\n").unwrap();
        assert_eq!(current(&root), None, "a folder without index.html");
        std::fs::write(root.join("0.8.3/index.html"), "<html>").unwrap();
        assert_eq!(current(&root), Some(root.join("0.8.3")));
        std::fs::write(root.join("current"), "../0.8.3").unwrap();
        assert_eq!(current(&root), None, "a path, not a name");
        let _ = std::fs::remove_dir_all(&root);
    }
}
