// The island on a phone. Nothing here but a webview on the bundled page: dist/ is web/ with
// PROMPTHOLM_STANDALONE written into it (scripts/pack-android.mjs), and from there the page
// joins its sea on its own - there is no islander to start, probe or wait for.
//
// The window is built here rather than declared in tauri.conf.json for one hook: a link to
// anywhere else - the update banner's "get the new version", say - is handed to the
// phone's browser instead of replacing the island in the only window there is, with no
// back button to return by. The desktop window does the same (src-tauri/src/lib.rs).
use tauri::{WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .on_navigation(move |url| {
                    // The bundled page is served from tauri.localhost (http or https,
                    // depending on the platform); everything else is somewhere else.
                    if url.host_str() == Some("tauri.localhost") || url.scheme() == "tauri" {
                        return true;
                    }
                    let _ = handle.opener().open_url(url.as_str(), None::<&str>);
                    false
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the island");
}
