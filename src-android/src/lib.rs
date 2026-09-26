// The island on a phone. Nothing here but a webview on the bundled page: dist/ is web/ with
// PROMPTHOLM_STANDALONE written into it (scripts/pack-android.mjs), and from there the page
// joins its sea on its own - there is no islander to start, probe or wait for.
//
// The window is built here rather than declared in tauri.conf.json for one hook: a link to
// anywhere else - the update banner's "get the new version", say - is handed to the
// phone's browser instead of replacing the island in the only window there is, with no
// back button to return by. The desktop window does the same (src-tauri/src/lib.rs).
use std::io::Write;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

/// Where a new version comes from: the one URL GitHub keeps pointing at the newest release,
/// the same one web/js/update.js gives the browser.
const APK_URL: &str =
    "https://github.com/TiemenAfman/AgentVillage/releases/latest/download/promptholm-android.apk";

/// The same release, asked of the API: which version it is, without fetching the APK.
const LATEST_API: &str = "https://api.github.com/repos/TiemenAfman/AgentVillage/releases/latest";

/// The newest release's version ("0.5.1", the tag without its v), for the update gate.
///
/// The sea's welcome says which release the sea is on, and until now that was the only way
/// the app heard of a new one - so it only heard once whoever keeps the sea had updated it.
/// This asks GitHub itself, so the card goes up as soon as there is a release to install.
/// In Rust for the same reason as install_update: the page's fetch would go out from
/// tauri.localhost, and here there is no origin to argue about. GitHub refuses a request
/// with no User-Agent, hence the header.
#[tauri::command]
async fn latest_release() -> Result<String, String> {
    let res = reqwest::Client::new()
        .get(LATEST_API)
        .header("User-Agent", "promptholm-android")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("GitHub answered {}", res.status()));
    }
    let release: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let tag = release["tag_name"].as_str().ok_or("the release has no tag")?;
    Ok(tag.trim_start_matches('v').to_string())
}

/// Fetch that APK and put it in front of Android's installer.
///
/// This is the whole of "update from inside the app", and it is as far as an app outside the
/// Play Store is allowed to go: Android lets nothing replace itself quietly, so the phone
/// still asks. What it saves is the trip through the browser, a file that lands in a
/// downloads folder and a tap on a notification - the three places the old button lost
/// people, when it worked at all.
///
/// Downloaded here rather than in the page for two reasons. The page is on tauri.localhost
/// and a GitHub release asset carries no CORS header, so its fetch would be refused; and the
/// file has to land where the FileProvider in AndroidManifest.xml can share it, which is
/// this cache directory (`cache-path` in res/xml/file_paths.xml).
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("promptholm-android.apk");

    let mut res = reqwest::get(APK_URL).await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("the release answered {}", res.status()));
    }
    // A chunk at a time, straight to disk: a phone with no ten spare megabytes of heap can
    // still install an update.
    let mut file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
    }
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);

    // Through the FileProvider, which is what the opener plugin does with a path: a file://
    // URI would be a FileUriExposedException. What shows up is the phone's own "install this
    // app?" - and the first time, a trip to settings to let this app install others
    // (REQUEST_INSTALL_PACKAGES in the manifest is the permission to ask for it).
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![install_update, latest_release])
        .setup(|app| {
            let handle = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .on_navigation(move |url| {
                    // The bundled page is served from tauri.localhost (http or https,
                    // depending on the platform); everything else is somewhere else.
                    if url.host_str() == Some("tauri.localhost") || url.scheme() == "tauri" {
                        return true;
                    }
                    // Not `let _ =`: that is how the update button came to do nothing at
                    // all for three releases. The page asks the opener over IPC first now
                    // (web/js/ui.js), so this is the fallback - and a fallback that fails
                    // silently is no fallback. The window is still never navigated away
                    // from: there is no back button here to return by.
                    if let Err(e) = handle.opener().open_url(url.as_str(), None::<&str>) {
                        eprintln!("promptholm: could not hand {url} to the phone: {e}");
                    }
                    false
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the island");
}
