// No console window, in debug as well. The template only did this in release, but the debug
// exe is the one a desktop shortcut points at, and it left an empty console standing next
// to the island for as long as the window was open. The cost is that `tauri dev` no longer
// shows this process's own eprintln! - everything worth reading is in data/server.log.
#![windows_subsystem = "windows"]

fn main() {
    promptholm_lib::run()
}
