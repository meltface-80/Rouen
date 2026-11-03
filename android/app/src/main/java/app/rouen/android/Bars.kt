package app.rouen.android

import android.app.Activity
import android.os.Build
import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

/**
 * The system bars in Rouen's colour, with the page kept clear of them (not edge to edge).
 *
 * Android 15 and later draw every app under the bars whatever it asks (Android 16 ignores the
 * opt-out), so the same is done on every version: the window lays out under the bars, the
 * root is padded by the bars', the cutout's and the keyboard's insets, and its background,
 * Rouen's #0e1012, is what shows behind the bars. The page never sits under them.
 */
object Bars {
    const val COLOR = 0xFF0E1012.toInt()

    @Suppress("DEPRECATION") // the bar colours: ignored on Android 15+, where the root's background shows instead
    fun apply(activity: Activity, root: View) {
        val window = activity.window
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = COLOR
        window.navigationBarColor = COLOR
        if (Build.VERSION.SDK_INT >= 29) {
            window.isNavigationBarContrastEnforced = false
            window.isStatusBarContrastEnforced = false
        }
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }
        root.setBackgroundColor(COLOR)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
            )
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
    }
}
