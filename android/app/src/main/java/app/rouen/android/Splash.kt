package app.rouen.android

import android.app.Activity
import android.graphics.Outline
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.widget.FrameLayout
import android.widget.ImageView

/**
 * The app's first [MS] (dev/design/android-app.md §4.15, v1.9.72-t58; the owner, 2026-11-02: "show the Rouen logo in
 * the centre of the screen. After 3 seconds if not connected, then show that screen"): Rouen's logo, centred on Rouen's
 * background, over everything [MainActivity] shows beneath it. It goes when the page is on screen ([done]), or after
 * [MS] whatever is beneath it then — the page, or "Connecting to Rouen…" / "Can't reach Rouen" with Retry and Change
 * server. So an opening that reaches Rouen within [MS] never shows the connecting screen, and one that doesn't shows it
 * from then on, as before. Only on an opening: a screen turned, or brought back from the background, has none.
 */
class Splash(activity: Activity, root: FrameLayout) {
    private val view: View = FrameLayout(activity).apply {
        setBackgroundColor(Bars.COLOR)
        // Takes the taps meant for the screen beneath, which the user can't see yet.
        isClickable = true
        val size = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, LOGO_DP, activity.resources.displayMetrics).toInt()
        addView(ImageView(activity).apply {
            setImageResource(R.mipmap.ic_launcher_foreground)
            contentDescription = "Rouen"
            // The middle two thirds, in a circle: as Android's own launch screen shows the icon (Android 12 on), so the
            // one hands over to the other without a jump, and the image's own square, a shade off Rouen's background,
            // doesn't show.
            outlineProvider = object : ViewOutlineProvider() {
                override fun getOutline(v: View, o: Outline) {
                    val i = v.width / 6
                    o.setOval(i, i, v.width - i, v.height - i)
                }
            }
            clipToOutline = true
        }, FrameLayout.LayoutParams(size, size, Gravity.CENTER))
    }
    private val end = Runnable { done() }

    init {
        root.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        view.postDelayed(end, MS)
    }

    /** The page is on screen, or the time is up: what is beneath is shown. Once; more calls do nothing. */
    fun done() {
        view.removeCallbacks(end)
        (view.parent as? ViewGroup)?.removeView(view)
    }

    companion object {
        /** How long the logo stands before a screen saying Rouen isn't reached yet may show. */
        const val MS = 3_000L
        /** The launcher image's side, as Android's launch screen draws it; its logo fills the middle two thirds. */
        private const val LOGO_DP = 240f
    }
}
