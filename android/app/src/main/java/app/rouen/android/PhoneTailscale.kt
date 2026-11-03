package app.rouen.android

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executors

/**
 * This phone on the tailnet: the built-in Tailscale's state, sign-in, sign-out and switch, as the server screen's
 * "Away from home" ([AwaySection]) and Rouen's own page (Settings → Setup → Away from home → This phone, through
 * [RouenPhone]) both show them (dev/design/android-app.md §4.7; v1.9.72-t10, the owner: "How do I get the app/phone on
 * the console … Mandarin logs the server in and then I add the app/phone").
 *
 * Every engine call runs on this object's thread: the engine is asked over HTTP on 127.0.0.1, which neither the main
 * thread nor the WebView's JavaScript thread may wait on. [look] reads the state and keeps it ([last]); whoever
 * [listen]s is told on the main thread when it moved.
 */
object PhoneTailscale {
    private val work = Executors.newSingleThreadExecutor { r -> Thread(r, "phone-tailscale").apply { isDaemon = true } }
    private val main = Handler(Looper.getMainLooper())

    /** The engine's state at the last look (null: not running, or not asked yet). */
    @Volatile var last: JSONObject? = null
        private set
    /** The engine's state the time before, to see it become "Running". */
    @Volatile private var lastState: String? = null
    /** Told on the main thread whenever [last] or the switch moved: the server screen, and the page. */
    private val listeners = CopyOnWriteArraySet<() -> Unit>()
    fun listen(f: () -> Unit) { listeners.add(f) }
    fun unlisten(f: () -> Unit) { listeners.remove(f) }
    /** A line about what is happening now ("Asking Tailscale for a sign-in link…"), until the next look. */
    @Volatile var note: String? = null
        private set

    private fun background(job: () -> Unit) = work.execute {
        try {
            job()
        } catch (e: RuntimeException) {
            // One bad answer must not end the thread every later look runs on: said, and the next look asks again.
            note = "Tailscale: " + (e.message ?: e.javaClass.simpleName)
        }
        main.post { for (f in listeners) f() }
    }

    private fun ask(f: () -> JSONObject): JSONObject = try {
        f()
    } catch (e: IOException) {
        JSONObject().put("error", e.message ?: "the engine isn't answering")
    }

    /** Read the state (the engine started first for a phone signed in to it). */
    fun look(c: Context) = background { lookNow(c.applicationContext) }

    private fun lookNow(c: Context) {
        val st: JSONObject? = when {
            !Prefs.engineOn(c) || !TailscaleEngine.installed(c) -> null
            TailscaleEngine.alive() -> ask { TailscaleEngine.status() }
            TailscaleEngine.signedIn(c) -> ask { TailscaleEngine.startForSignIn(c, Way.hostname(Prefs.name(c))); TailscaleEngine.status() }
            else -> null
        }
        val s = st?.optString("state", "") ?: ""
        if (s.isNotEmpty()) TailscaleEngine.noteState(s)
        if (s == "Running" && lastState != null && lastState != "Running") {
            // Just signed in (or approved): the way to Rouen is looked at now, not at the next change of network.
            Prefs.setEngineJoined(c, true)
            Away.recheck(c, soon = true)
        }
        if (st != null) lastState = s
        last = st
        note = null
    }

    /** Ask for a sign-in link; [open] is given it on the main thread (or the state, once already signed in). */
    fun signIn(c: Context, open: (String) -> Unit) {
        val app = c.applicationContext
        note = "Asking Tailscale for a sign-in link…"
        background {
            val st = ask {
                val started = TailscaleEngine.startForSignIn(app, Way.hostname(Prefs.name(app)))
                if (started.optString("auth_url").isNotEmpty() || started.optString("state") == "Running") started else TailscaleEngine.login()
            }
            val url = st.optString("auth_url").takeIf { it.isNotEmpty() }
            last = st
            note = when {
                url != null -> "Sign in on Tailscale's page; this follows."
                st.optString("state") == "Running" -> null
                else -> "No sign-in link yet" + (st.optString("error").takeIf { it.isNotEmpty() }?.let { ": $it" } ?: "") + ". Try again in a moment."
            }
            if (url != null) main.post { open(url) }
        }
    }

    fun signOut(c: Context) {
        val app = c.applicationContext
        note = "Signing out…"
        background {
            ask { TailscaleEngine.logout(app) }
            Away.recheck(app)
            lookNow(app)
        }
    }

    /** The switch: off, only home or a VPN reaches Rouen. */
    fun use(c: Context, on: Boolean) {
        val app = c.applicationContext
        Prefs.setEngineOn(app, on)
        background {
            if (!on) TailscaleEngine.stop()
            Away.recheck(app)
            lookNow(app)
        }
    }

    /** The state in words, as the server screen and the page both say it. */
    fun describe(c: Context, st: JSONObject? = last): String {
        note?.let { return it }
        val s = st?.optString("state", "") ?: ""
        return when {
            !Prefs.engineOn(c) -> "Off. Away from home, only a VPN (the Tailscale app, say) reaches Rouen."
            !TailscaleEngine.installed(c) -> "Not in this build of the app."
            st == null -> "Needs sign-in."
            st.optString("error").isNotEmpty() && s.isEmpty() -> "Error: " + st.optString("error")
            else -> buildString {
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
        }
    }

    private fun firstIp(st: JSONObject): String? = st.optJSONArray("ips")?.optString(0)?.takeIf { it.isNotEmpty() }

    /** Which way the phone reaches Rouen now, and Rouen's tailnet address. */
    fun wayText(c: Context): String {
        val tailnet = Prefs.awayAddress(c)?.let { "Rouen's tailnet address: $it." }
            ?: "Rouen's tailnet address isn't known yet: Rouen gives it once it is on a tailnet, or type it on the server screen."
        val now = when (Away.active(c)?.kind) {
            Way.Kind.HOME -> "Now: at home."
            Way.Kind.DIRECT -> "Now: away, through a VPN."
            Way.Kind.ENGINE -> "Now: away, through the built-in Tailscale."
            null -> ""
        } + if (Away.serverSaysAway == true) " Rouen sees this phone on its tailnet." else ""
        return if (now.isEmpty()) tailnet else "$now\n$tailnet"
    }

    /** Signed in, as far as the last look says. */
    fun signedIn(): Boolean = last?.optString("state") == "Running"

    /** For Rouen's page: {"installed", "on", "signedIn", "canSignOut", "hostname", "text", "way"}. */
    fun statusJson(c: Context): String {
        val on = Prefs.engineOn(c)
        return JSONObject()
            .put("installed", TailscaleEngine.installed(c))
            .put("on", on)
            .put("signedIn", signedIn())
            .put("canSignOut", on && (signedIn() || TailscaleEngine.signedIn(c)))
            .put("hostname", Way.hostname(Prefs.name(c)))
            .put("text", describe(c))
            .put("way", wayText(c))
            .toString()
    }
}
