// The island on a phone. Nothing here but a webview on the bundled page: dist/ is web/ with
// PROMPTHOLM_STANDALONE written into it (scripts/pack-android.mjs), and from there the page
// joins its sea on its own - there is no islander to start, probe or wait for.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running the island");
}
