// Only so `cargo tauri dev` can show the same bundled page in a window on the desktop.
#![windows_subsystem = "windows"]

fn main() {
    promptholm_android_lib::run()
}
