package app.rouen.android

import android.content.Context
import android.webkit.CookieManager
import java.net.InetSocketAddress

/**
 * The page's one address (dev/design/android-app.md §4.16, v1.9.72-t18): Rouen's page is loaded from
 * http://127.0.0.1:34600, a [Relay] that joins each of the page's connections to the way to Rouen in use ([Away]).
 * When the way switches (the Wi-Fi gone, home again), the page keeps its address, so it is neither loaded again nor
 * covered: its next requests simply go the new way. While the way is being connected (the built-in Tailscale coming
 * up) they wait for it; only "can't reach Rouen" is still said over the page (§4.15). The owner, 2026-10-29: "Ideally
 * this transition should be seamless like mandarin".
 *
 * Rouen's login lives at this address now (the page logs in here), so the player reads it here too ([loginBase]); the
 * first time, the login the phone already had at a way's own address is brought here, so it is not asked for again.
 * If the port can't be had, the page loads from the way itself, as before.
 */
object PageRelay {
    const val PORT = 34600
    const val ADDRESS = "127.0.0.1:$PORT"
    const val BASE = "http://$ADDRESS"

    @Volatile private var relay: Relay? = null

    /** The page's own address is open. */
    fun running(): Boolean = relay?.running() == true

    /** Open it (main thread; again is harmless); false when it can't be had. */
    fun start(c: Context): Boolean {
        val app = c.applicationContext
        val r = relay ?: Relay(PORT, { target(app) }, unreached = { Away.trouble(app) }).also { relay = it }
        if (r.running()) return true
        val ok = r.start()
        if (ok) {
            adoptLogin(app)
            AppLog.line("PAGE", "the page's own address is open: the way to Rouen can change under it")
        } else {
            AppLog.line("PAGE", "the page's own address could not be opened: the page loads from the way itself", anomaly = true)
        }
        return ok
    }

    /** Where Rouen's login is read: here while the page's address is open (the page logs in here), else [base]. */
    fun loginBase(base: String): String = if (running()) BASE else base

    /**
     * Where the page's connections go now (the relay's threads): the way in use once it reaches Rouen; none while it
     * is being connected or can't reach it, and the relay waits.
     */
    private fun target(c: Context): InetSocketAddress? {
        val a = Away.active(c) ?: return null
        if (a.reach != Way.Reach.YES) return null
        return Relay.addressOf(a.base)
    }

    /** The login the phone had at one of Rouen's own addresses, brought here once (main thread). */
    private fun adoptLogin(c: Context) {
        val cm = try { CookieManager.getInstance() } catch (e: RuntimeException) { return }
        if (Way.sessionValue(cm.getCookie(BASE)) != null) return
        val had = listOfNotNull(Prefs.server(c), Prefs.awayAddress(c))
            .firstNotNullOfOrNull { Way.sessionValue(cm.getCookie(Prefs.base(it))) } ?: return
        cm.setCookie(BASE, "${Way.SESSION_COOKIE}=$had; Path=/; Max-Age=${400L * 24 * 3600}; HttpOnly; SameSite=Lax")
        cm.flush()
        AppLog.line("PAGE", "the login brought to the page's own address")
    }
}
