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
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/**
 * "Away from home" on the server screen (dev/design/android-app.md §4.7, §4.8), as Mandarin's
 * Settings → Away from home (meltface-80/Mandarin: android/app/.../TailscaleTestActivity.kt):
 * the built-in Tailscale's state, "Sign in to Tailscale" (the engine's sign-in link, opened in the
 * browser), "Sign out", and a switch to turn it off (then only home, or a VPN, reaches Rouen).
 *
 * The engine is started here only for a phone signed in to it, or on "Sign in"; the state is read
 * every 2 s while the screen is in front ([resume] / [pause]). Closed with no player running, the
 * engine this screen started is stopped ([close]).
 */
class AwaySection(private val activity: Activity, column: LinearLayout) {

    private val main = Handler(Looper.getMainLooper())
    private val work = Executors.newSingleThreadExecutor { r -> Thread(r, "away-section").apply { isDaemon = true } }
    private val state: TextView
    private val way: TextView
    private val signIn: Button
    private val signOut: Button
    private val use: Switch
    private var shown = false
    /** The engine's state at the last look, to see it become "Running". */
    private var lastState: String? = null

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
        main.removeCallbacks(refresh)
        main.post(refresh)
    }

    fun pause() {
        shown = false
        main.removeCallbacks(refresh)
    }

    /** The screen is going: the engine stopped if only this screen had it running, else the way looked at again (it decides). */
    fun close() {
        pause()
        work.shutdownNow()
        val c = activity.applicationContext
        if (PlayerService.running || Away.following()) Away.recheck(c) else Thread({ TailscaleEngine.stop() }, "away-section-stop").apply { isDaemon = true; start() }
    }

    private val refresh = object : Runnable {
        override fun run() {
            if (!shown) return
            inBackground { look() }
            main.postDelayed(this, 2000)
        }
    }

    /** On the section's thread; quietly not, once the screen has gone. */
    private fun inBackground(job: () -> Unit) {
        try {
            work.execute(job)
        } catch (e: RejectedExecutionException) {
            // The screen has closed: nothing is left to show the answer on.
        }
    }

    /** The state read (the engine started first for a phone signed in to it) and shown. */
    private fun look() {
        val c = activity.applicationContext
        val st: JSONObject? = when {
            !Prefs.engineOn(c) || !TailscaleEngine.installed(c) -> null
            TailscaleEngine.alive() -> ask { TailscaleEngine.status() }
            TailscaleEngine.signedIn(c) -> ask { TailscaleEngine.startForSignIn(c, Way.hostname(Prefs.name(c))); TailscaleEngine.status() }
            else -> null
        }
        main.post { show(st) }
    }

    private fun ask(f: () -> JSONObject): JSONObject = try {
        f()
    } catch (e: IOException) {
        JSONObject().put("error", e.message ?: "the engine isn't answering").put("_status", 0)
    }

    private fun show(st: JSONObject?) {
        if (activity.isFinishing || activity.isDestroyed) return
        val c = activity
        val on = Prefs.engineOn(c)
        val s = st?.optString("state", "") ?: ""
        if (s == "Running" && lastState != null && lastState != "Running") {
            // Just signed in (or approved): the way to Rouen is looked at now, not at the next change of network.
            Prefs.setEngineJoined(c, true)
            Away.recheck(c, soon = true)
        }
        if (st != null) lastState = s
        state.text = when {
            !on -> "Off. Away from home, only a VPN (the Tailscale app, say) reaches Rouen."
            !TailscaleEngine.installed(c) -> "Not in this build of the app."
            st == null -> "Needs sign-in."
            st.optString("error").isNotEmpty() && s.isEmpty() -> "Error: " + st.optString("error")
            else -> describe(st, s)
        }
        way.text = wayText()
        val signedIn = s == "Running"
        signIn.isEnabled = on && TailscaleEngine.installed(c)
        signIn.visibility = if (signedIn) View.GONE else View.VISIBLE
        signOut.visibility = if (on && (signedIn || TailscaleEngine.signedIn(c))) View.VISIBLE else View.GONE
    }

    private fun describe(st: JSONObject, s: String): String = buildString {
        append(
            when (s) {
                "Running" -> "Connected as " + (st.optString("dns_name").trimEnd('.').ifEmpty { firstIp(st) ?: "this phone" })
                "NeedsLogin" -> "Needs sign-in."
                "NeedsMachineAuth" -> "Waiting for approval in the Tailscale admin console."
                "Starting", "NoState", "Stopped" -> "Starting…"
                else -> s
            }
        )
        if (s == "Running" && st.has("online") && !st.optBoolean("online", true)) append(" (not online on the tailnet yet)")
        st.optJSONArray("health")?.let { a -> if (a.length() > 0) append("\nTailscale warns: ").append((0 until a.length()).joinToString("; ") { a.optString(it) }) }
        st.optString("error").takeIf { it.isNotEmpty() }?.let { append("\nError: ").append(it) }
    }

    private fun firstIp(st: JSONObject): String? = st.optJSONArray("ips")?.optString(0)?.takeIf { it.isNotEmpty() }

    private fun wayText(): String {
        val c = activity
        val tailnet = Prefs.awayAddress(c)?.let { "Rouen's tailnet address: $it." }
            ?: "Rouen's tailnet address isn't known yet: Rouen gives it once it is on a tailnet, or type it above."
        val now = when (Away.active(c)?.kind) {
            Way.Kind.HOME -> "Now: at home."
            Way.Kind.DIRECT -> "Now: away, through a VPN."
            Way.Kind.ENGINE -> "Now: away, through the built-in Tailscale."
            null -> ""
        } + if (Away.serverSaysAway == true) " Rouen sees this phone on its tailnet." else ""
        return if (now.isEmpty()) tailnet else "$now\n$tailnet"
    }

    private fun signIn() {
        val c = activity.applicationContext
        state.text = "Asking Tailscale for a sign-in link…"
        inBackground {
            val st = ask {
                val started = TailscaleEngine.startForSignIn(c, Way.hostname(Prefs.name(c)))
                if (started.optString("auth_url").isNotEmpty() || started.optString("state") == "Running") started else TailscaleEngine.login()
            }
            val url = st.optString("auth_url").takeIf { it.isNotEmpty() }
            main.post {
                when {
                    url != null -> open(url)
                    st.optString("state") == "Running" -> show(st)
                    else -> state.text = "No sign-in link yet" + (st.optString("error").takeIf { it.isNotEmpty() }?.let { ": $it" } ?: "") +
                        ". Try again in a moment."
                }
            }
        }
    }

    private fun open(url: String) {
        try {
            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (e: ActivityNotFoundException) {
            state.text = "No browser on this phone opens the sign-in page:\n$url"
        }
    }

    private fun signOut() {
        val c = activity.applicationContext
        state.text = "Signing out…"
        inBackground {
            ask { TailscaleEngine.logout(c) }
            Away.recheck(c)
            look()
        }
    }

    private fun switched(on: Boolean) {
        val c = activity.applicationContext
        Prefs.setEngineOn(c, on)
        inBackground {
            if (!on) TailscaleEngine.stop()
            Away.recheck(c)
            look()
        }
    }

    private fun dp(v: Int): Int = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), activity.resources.displayMetrics).toInt()

    private fun text(s: String, sizeSp: Float, color: Int) = TextView(activity).apply {
        text = s
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
        setTextColor(activity.getColor(color))
    }

    private fun heading(s: String) = text(s, 16f, R.color.text).apply { setPadding(0, dp(20), 0, dp(4)) }
}
