// The one thing this phone does that no plugin on the shelf does for it: hand a downloaded
// APK to Android's package installer.
//
// tauri-plugin-opener's open_path is not that. On Android it is
// Intent(ACTION_VIEW, "/data/.../promptholm-android.apk".toUri()) - a bare path, no scheme,
// no type - which nothing on the phone answers; so up to v0.7.0 install_update
// (src-android/src/lib.rs) fetched the whole update, failed here, and fell back to the
// browser, whose own download of the same file sat at 100% and never offered to install.
//
// A class in the app module rather than a plugin crate of its own: Rust registers it by
// name (register_android_plugin, which loads it through the activity's class loader, the
// same way a library plugin's class is found), and a crate would be eight files of gradle
// around these twenty lines of Kotlin. `tauri android build` leaves the files in this folder
// alone, as it does MainActivity.kt.
package com.promptholm.sea

import android.app.Activity
import android.content.Intent
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class InstallArgs {
  lateinit var path: String
}

@TauriPlugin
class InstallerPlugin(private val activity: Activity) : Plugin(activity) {
  // Put the APK at `path` in front of the package installer.
  //
  // The installer is another process, and since Android 7 a file:// URI handed to one is a
  // FileUriExposedException - so the file goes as a content:// URI from the FileProvider in
  // AndroidManifest.xml, with read permission granted along with the intent. That provider
  // shares the app's cache (res/xml/file_paths.xml, cache-path), which is where
  // install_update writes the file; a path anywhere else is refused by getUriForFile.
  // ACTION_VIEW with the APK's own type is what opens the installer since ACTION_INSTALL_PACKAGE
  // was deprecated; the installer itself handles the rest - the first time, a trip to
  // settings to allow this app to install others (REQUEST_INSTALL_PACKAGES in the manifest).
  @Command
  fun install(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(InstallArgs::class.java)
      val uri = FileProvider.getUriForFile(activity, activity.packageName + ".fileprovider", File(args.path))
      val intent = Intent(Intent.ACTION_VIEW)
        .setDataAndType(uri, "application/vnd.android.package-archive")
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      activity.startActivity(intent)
      invoke.resolve()
    } catch (e: Exception) {
      invoke.reject(e.message ?: e.toString())
    }
  }
}
