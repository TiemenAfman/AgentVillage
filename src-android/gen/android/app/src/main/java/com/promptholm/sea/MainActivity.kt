package com.promptholm.sea

import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Into the notch as well: the page draws its own HUD and has nothing to keep clear of.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      window.attributes.layoutInDisplayCutoutMode =
        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
    }
    hideBars()
  }

  // Edge to edge alone left the status bar's clock over the title card and the navigation
  // buttons over the minimap. A game hides them; a swipe from the edge brings them back
  // for a moment, and coming back into focus (after that, or after a notification) hides
  // them again.
  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) hideBars()
  }

  private fun hideBars() {
    val bars = WindowCompat.getInsetsController(window, window.decorView)
    bars.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    bars.hide(WindowInsetsCompat.Type.systemBars())
  }
}
