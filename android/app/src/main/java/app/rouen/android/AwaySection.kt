package app.rouen.android

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.Switch
import android.widget.TextView

/**
 * "Away from home" on the server screen (dev/design/android-app.md §4.7, §4.8), as Mandarin's
 * Settings → Away from home (meltface-80/Mandarin: android/app/.../TailscaleTestActivity.kt):
 * the built-in Tailscale's state, "Sign in to Tailscale" (the engine's sign-in link, opened in the
 * browser), "Sign out", and a switch to turn it off (then only home, or a VPN, reaches Rouen).
 *
 * The engine is started here only for a phone signed in to it, or on "Sign in"; the state is read
 * every 2 s while the screen is in front ([resume] / [pause]). Closed with no player running, the
 * engine this screen started is stopped ([close]). What it says and does is [PhoneTailscale]'s,
 * which Rouen's own page (Settings → Setup → Away from home → This phone) shows too.
 */
class AwaySection(private val activity: Activity, column: LinearLayout) {

    private val main = Handler(Looper.getMainLooper())
    private val state: TextView
    private val way: TextView
    private val signIn: Button
    private val signOut: Button
    private val use: Switch
    private var shown = false

    init {
        column.addView(heading("Away from home"))
        column.addView(text(
            "Rouen's built-in Tailscale reaches Rouen from anywhere, with no VPN app. Sign in once, with the Tailscale " +
                "account Rouen's server is on.", 13f, R.color.text_dim
        ))
        state = text("", 15f, R.color.text).apply { setPadding(0, dp(10), 0, dp(4)) }
        column.addView(state)
        way = text("", 13f, R.color.text_dim).apply { setPadding(0, 0, 0, dp(8)) }
        column.addView(way)
        signIn = Button(activity).apply { text = "Sign in to Tailscale"; setOnClickListener { signIn() } }
        column.addView(signIn)
        signOut = Button(activity).apply { text = "Sign out"; setOnClickListener { signOut() } }
        column.addView(signOut)
        use = Switch(activity).apply {
            text = "Use the built-in Tailscale"
            setTextColor(activity.getColor(R.color.text))
            isChecked = Prefs.engineOn(activity)
            setOnCheckedChangeListener { _, on -> switched(on) }
        }
        column.addView(use, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
    }

    fun resume() {
        shown = true
        PhoneTailscale.listen(onChange)
        main.removeCallbacks(refresh)
        main.post(refresh)
    }

    fun pause() {
        shown = false
        PhoneTailscale.unlisten(onChange)
        main.removeCallbacks(refresh)
    }

    /** The screen is going: the engine stopped if only this screen had it running, else the way looked at again (it decides). */
    fun close() {
        pause()
        val c = activity.applicationContext
        if (PlayerService.running || Away.following()) Away.recheck(c) else Thread({ TailscaleEngine.stop() }, "away-section-stop").apply { isDaemon = true; start() }
    }

    private val onChange: () -> Unit = { show() }

    private val refresh = object : Runnable {
        override fun run() {
            if (!shown) return
            PhoneTailscale.look(activity)
            main.postDelayed(this, 2000)
        }
    }

    /** What [PhoneTailscale] says now (its state, and the way to Rouen), shown (PhoneTailscale.kt, shared with the page). */
    private fun show() {
        if (activity.isFinishing || activity.isDestroyed) return
        val c = activity
        val on = Prefs.engineOn(c)
        state.text = PhoneTailscale.describe(c)
        way.text = PhoneTailscale.wayText(c)
        val signedIn = PhoneTailscale.signedIn()
        signIn.isEnabled = on && TailscaleEngine.installed(c)
        signIn.visibility = if (signedIn) View.GONE else View.VISIBLE
        signOut.visibility = if (on && (signedIn || TailscaleEngine.signedIn(c))) View.VISIBLE else View.GONE
    }

    private fun signIn() {
        PhoneTailscale.signIn(activity) { url -> open(url) }
        show()
    }

    private fun open(url: String) {
        try {
            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (e: ActivityNotFoundException) {
            state.text = "No browser on this phone opens the sign-in page:\n$url"
        }
    }

    private fun signOut() {
        PhoneTailscale.signOut(activity)
        show()
    }

    private fun switched(on: Boolean) {
        PhoneTailscale.use(activity, on)
        show()
    }

    private fun dp(v: Int): Int = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), activity.resources.displayMetrics).toInt()

    private fun text(s: String, sizeSp: Float, color: Int) = TextView(activity).apply {
        text = s
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
        setTextColor(activity.getColor(color))
    }

    private fun heading(s: String) = text(s, 16f, R.color.text).apply { setPadding(0, dp(20), 0, dp(4)) }
}
