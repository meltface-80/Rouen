package app.rouen.android

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.webkit.CookieManager
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors

/**
 * Home or away (dev/design/android-app.md §4.7, §4.8): the address the app talks to Rouen on,
 * decided again whenever the phone's network changes. From Mandarin's app (meltface-80/Mandarin:
 * android/app/.../Away.kt), with Rouen's three ways ([Way.choose]):
 *
 *  - home: the server's own address, when it answers `GET /api/login`;
 *  - direct: Rouen's tailnet address (hello's `away_address`), when a VPN is up and it answers
 *    there (the Tailscale app, or another VPN). Never tried with no VPN up (Mandarin's item 159:
 *    100.x is the carriers' own range on mobile data);
 *  - the built-in engine ([TailscaleEngine]): http://127.0.0.1:34510 ([Ports.ENGINE]), forwarded to that address.
 *
 * The way is taken as soon as it is decided (Mandarin's item 118), so nothing goes on asking an
 * address the phone has left while the engine comes up; when it is up, the listeners hear again.
 * Rouen's login cookie is per origin, so it is carried to the new origin before they hear
 * ([Way.carry]).
 *
 * Nothing answering is never taken for home (§4.15): the way says whether Rouen is reached
 * ([Way.reach]), and when it is not, why ([Way.whyNot]), for the screen, the notification and the buttons.
 *
 * Lifetime: [start] by the player and the screens, [stop] by the player when it ends; the engine
 * goes with it. At home the engine runs only while the phone plays ([Way.EngineIdle]).
 */
object Away {
    private const val TAG = "RouenAway"
    private const val TROUBLE_GAP_MS = 20_000L
    /** How soon a way lost on one look is looked at again. */
    private const val LOST_AGAIN_MS = 3_000L

    /**
     * The way in use: for [server] (Prefs.server when decided), of [kind], at [base] ("http://host:port");
     * whether Rouen is reached there ([reach]), and if it is not, [why] (§4.15).
     */
    data class Active(val server: String, val kind: Way.Kind, val base: String,
                      val reach: Way.Reach = Way.Reach.YES, val why: String? = null)

    private val main = Handler(Looper.getMainLooper())
    private val work = Executors.newSingleThreadExecutor { r -> Thread(r, "away").apply { isDaemon = true } }
    private val repairs = Executors.newSingleThreadExecutor { r -> Thread(r, "away-engine").apply { isDaemon = true } }
    private val listeners = CopyOnWriteArrayList<(Active) -> Unit>()
    private val idle = Way.EngineIdle { SystemClock.elapsedRealtime() }
    /** Each network's transports and validation as last seen, so a signal-strength change is not a look. */
    private val seen = ConcurrentHashMap<Network, String>()

    /** The way last decided (the [work] thread's). */
    @Volatile private var current: Active? = null
    /** The way last told, its login carried (main thread): what [active] says. */
    @Volatile private var announced: Active? = null
    /** This run's first look is made (until it is, [active] says nothing: Mandarin's item 157). */
    @Volatile private var looked = false
    @Volatile private var watching = false
    @Volatile private var repairing = false
    @Volatile private var lastTrouble = 0L
    /** The next way decided is told even if unchanged ([retry]: a screen waits for it). */
    @Volatile private var tellNext = false
    /** The next look is asked for afresh (Retry, a change of network), not by the link's trouble ([Way.settleReach]). */
    @Volatile private var freshLook = false
    /** Looks in a row that found Rouen lost ([Way.settleReach]: one alone is not told). On [work] only. */
    private var lostLooks = 0
    @Volatile private var app: Context? = null
    /** Hello's `away`: Rouen saw this phone's request come over the tailnet (null: Rouen did not say). */
    @Volatile var serverSaysAway: Boolean? = null
    private var callbacks: List<ConnectivityManager.NetworkCallback> = emptyList()
    private var pending: Runnable? = null

    /** [l] hears the way whenever it changes, or the engine has come up (main thread). */
    fun listen(l: (Active) -> Unit) { listeners += l }

    fun unlisten(l: (Active) -> Unit) { listeners -= l }

    /** The way to the server chosen now, or null before this run's first look at it. */
    fun active(c: Context): Active? {
        val a = announced ?: return null
        return if (a.server == Prefs.server(c)) a else null
    }

    /** The origins Rouen is known at: home, its tailnet address, the engine's port, and the page's own address (§4.16). */
    fun origins(c: Context): Set<String> = listOfNotNull(Prefs.server(c), Prefs.awayAddress(c), TailscaleEngine.FORWARD, PageRelay.ADDRESS).toSet()

    /** The network is being followed (the player or a screen has started it). */
    fun following(): Boolean = watching

    /** Follow the phone's network from now on, and look now (main thread; again is harmless). */
    fun start(c: Context) {
        val a = c.applicationContext
        app = a
        if (!watching) {
            watching = true
            looked = false
            announced = null
            register(a)
            work.execute { check(a) }
        } else {
            recheck(a)
        }
    }

    /** Stop following the network, and the engine with it (main thread). */
    fun stop() {
        if (!watching) return
        watching = false
        val cm = app?.getSystemService(ConnectivityManager::class.java)
        for (cb in callbacks) {
            try {
                cm?.unregisterNetworkCallback(cb)
            } catch (e: IllegalArgumentException) {
                // Never registered (registering failed): nothing to undo.
            }
        }
        callbacks = emptyList()
        seen.clear()
        pending?.let { main.removeCallbacks(it) }
        pending = null
        main.removeCallbacks(lookAgain)
        // After any look already queued, and only if nothing started following again meanwhile.
        work.execute { if (!watching) TailscaleEngine.stop() }
    }

    /** Look again soon, afresh: changes come in bursts, so they are gathered ([soon]: a lost network, for less). */
    fun recheck(c: Context, soon: Boolean = false) {
        freshLook = true
        look(c, soon)
    }

    private fun look(c: Context, soon: Boolean = false) {
        val a = c.applicationContext
        main.post {
            if (!watching) return@post
            pending?.let { if (!soon) return@post; main.removeCallbacks(it) }
            val r = Runnable { pending = null; work.execute { check(a) } }
            pending = r
            main.postDelayed(r, if (soon) 300L else 1500L)
        }
    }

    /** Retry, on the screen: looked at again soon, and what comes of it told even if nothing changed. */
    fun retry(c: Context) {
        tellNext = true
        recheck(c, soon = true)
    }

    /** Rouen did not answer on the way in use (the player's link): looked at again, at most once in 20 s. */
    fun trouble(c: Context) {
        val now = SystemClock.elapsedRealtime()
        if (now - lastTrouble < TROUBLE_GAP_MS) return
        lastTrouble = now
        look(c)
    }

    private fun register(c: Context) {
        val cm = c.getSystemService(ConnectivityManager::class.java) ?: return
        val onChange = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = recheck(c)
            // The Wi-Fi gone (walking out of the door): looked at now, not after the usual pause.
            override fun onLost(network: Network) { seen.remove(network); recheck(c, soon = true) }
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                val key = listOf(
                    NetworkCapabilities.TRANSPORT_WIFI, NetworkCapabilities.TRANSPORT_CELLULAR,
                    NetworkCapabilities.TRANSPORT_ETHERNET, NetworkCapabilities.TRANSPORT_VPN
                ).joinToString("") { if (caps.hasTransport(it)) "1" else "0" } +
                    (if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) "v" else "-")
                if (seen.put(network, key) != key) {
                    val names = listOf("Wi-Fi", "mobile data", "Ethernet", "VPN").filterIndexed { i, _ -> key[i] == '1' }
                    AppLog.line("WAY", "the phone's network: " + (names.joinToString(" + ").ifEmpty { "none" }) +
                        if (key.endsWith("v")) ", internet checked" else ", internet not checked")
                    recheck(c)
                }
            }
        }
        // The Wi-Fi and any VPN too: they come and go while Android's default stays the same (Mandarin's item 127).
        val others = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { AppLog.line("WAY", "a Wi-Fi or VPN network came"); recheck(c) }
            override fun onLost(network: Network) { AppLog.line("WAY", "a Wi-Fi or VPN network went"); recheck(c, soon = true) }
        }
        val list = ArrayList<ConnectivityManager.NetworkCallback>()
        try {
            cm.registerDefaultNetworkCallback(onChange)
            list += onChange
            val wifiOrVpn = NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                .addTransportType(NetworkCapabilities.TRANSPORT_VPN)
                .removeCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
                .build()
            cm.registerNetworkCallback(wifiOrVpn, others)
            list += others
        } catch (e: RuntimeException) {
            // Android refused a callback (too many registered, or no permission): the way is still looked at
            // on every start and whenever the player finds Rouen not answering.
            Log.w(TAG, "can't follow the network", e)
        }
        callbacks = list
    }

    /** Where Rouen is now, decided and told. On [work] only. */
    private fun check(c: Context) {
        val home = Prefs.server(c) ?: return
        val was = current?.takeIf { it.server == home }
        val fresh = freshLook
        freshLook = false
        // No network at all: nothing to reach, so the way stays as it was, said to reach nothing (a second look on).
        if (was != null && !hasNetwork(c)) {
            val lostBefore = lostLooks > 0
            lostLooks++
            if (Way.settleReach(was.reach, was.kind, Way.Reach.NO, was.kind, lostBefore, fresh) == Way.Reach.YES) return lostOnce(was)
            return settle(was.copy(reach = Way.Reach.NO, why = whyNot(c, Prefs.awayAddress(c), tried = false)))
        }
        val awayAt = Prefs.awayAddress(c)
        val vpn = onVpn(c)
        val looks = Way.looksBeforeAway(wasAway = was != null && was.kind != Way.Kind.HOME, onWifi = onWifi(c))
        val homeOk = answers(home, looks)
        // Tailscale wanting the phone signed in again is not ready: said so, not tried every 20 s.
        val engineReady = Prefs.engineOn(c) && TailscaleEngine.signedIn(c) && !TailscaleEngine.needsLogin
        val direct = !homeOk && awayAt != null && awayAt != home && vpn && Finder.isRouen(awayAt, 3000, 3000)
        val kind = Way.choose(homeOk, awayAt != null, direct, engineReady)
        val found = Way.reach(kind, homeOk, engineReached = kind == Way.Kind.ENGINE && awayAt != null && TailscaleEngine.reached(awayAt))
        val reach = Way.settleReach(was?.reach, was?.kind, found, kind, lostLooks > 0, fresh)
        AppLog.line("WAY", "looked: home ${if (homeOk) "answers" else "silent"} ($looks look(s)), Wi-Fi ${onWifi(c)}, VPN $vpn, " +
            "tailnet address ${if (awayAt != null) "known" else "unknown"}, direct ${if (direct) "answers" else "no"}, engine ready $engineReady " +
            "(on ${Prefs.engineOn(c)}, signed in ${TailscaleEngine.signedIn(c)}, needs login ${TailscaleEngine.needsLogin}) → ${kind.name.lowercase()}, " +
            "reached ${found.name.lowercase()}" + if (reach != found) " (told ${reach.name.lowercase()})" else "",
            anomaly = found == Way.Reach.NO)
        lostLooks = if (found == Way.Reach.NO) lostLooks + 1 else 0
        if (was != null && reach == Way.Reach.YES && found == Way.Reach.NO) return lostOnce(was)
        val base = Prefs.base(
            when (kind) {
                Way.Kind.HOME -> home
                Way.Kind.DIRECT -> awayAt ?: home
                Way.Kind.ENGINE -> TailscaleEngine.FORWARD
            }
        )
        // The phone's addresses changed: the engine finds its way on the new network.
        if (TailscaleEngine.alive()) TailscaleEngine.sendInterfaces()
        val why = when {
            reach != Way.Reach.NO -> null
            found == Way.Reach.NO -> whyNot(c, awayAt, tried = false)
            else -> was?.why   // the engine's NO standing: its own why
        }
        settle(Active(home, kind, base, reach, why))
        if (kind == Way.Kind.ENGINE && awayAt != null) repair(c, awayAt) else engineAtHome(c, awayAt, engineReady)
    }

    /** Rouen lost on one look only: the way kept as told, and looked at again in a few seconds (§4.15). */
    private fun lostOnce(was: Active) {
        settle(was)
        later(LOST_AGAIN_MS)
    }

    /**
     * The way taken: kept, and told when it changed. On the main thread its login is carried first,
     * and only then is it [active], so nothing loads the new origin before the login is there.
     */
    private fun settle(a: Active) {
        val before = current
        current = a
        val first = !looked
        looked = true
        val asked = tellNext
        tellNext = false
        if (a == before && !first && !asked) return
        Log.i(TAG, "${a.kind.name.lowercase()}: using ${a.base}, reached ${a.reach.name.lowercase()}")
        AppLog.line("WAY", "now ${a.kind.name.lowercase()}: using ${a.base}" + (if (before != null && before.kind != a.kind) " (was ${before.kind.name.lowercase()})" else "") +
            when (a.reach) { Way.Reach.YES -> ""; Way.Reach.CONNECTING -> ", connecting"; Way.Reach.NO -> ", can't reach Rouen: ${a.why}" },
            anomaly = a.reach == Way.Reach.NO)
        main.post {
            val from = announced?.takeIf { it.server == a.server }
            if (from != a) carryCookie(from, a)
            announced = a
            tell(a)
        }
    }

    private fun tell(a: Active) {
        for (l in listeners) {
            try {
                l(a)
            } catch (e: RuntimeException) {
                // One screen's failure to follow must not keep the others (or the player) from hearing.
                Log.w(TAG, "a listener failed", e)
            }
        }
    }

    /** Rouen's login carried to [to]'s origin from [from]'s, or the home or tailnet address's (main thread). */
    private fun carryCookie(from: Active?, to: Active) {
        val c = app ?: return
        val cm = try { CookieManager.getInstance() } catch (e: RuntimeException) { return }
        fun at(base: String?) = base?.let { Way.sessionValue(cm.getCookie(it)) }
        val fallbacks = listOfNotNull(Prefs.base(to.server), Prefs.awayAddress(c)?.let { Prefs.base(it) }, Prefs.base(TailscaleEngine.FORWARD))
            .filter { it != to.base }.map { at(it) }
        val value = Way.carry(at(from?.base?.takeIf { it != to.base }), at(to.base), fallbacks) ?: return
        cm.setCookie(to.base, "${Way.SESSION_COOKIE}=$value; Path=/; Max-Age=${400L * 24 * 3600}; HttpOnly; SameSite=Lax")
        cm.flush()
        Log.i(TAG, "login carried to ${to.base}")
    }

    /**
     * The engine joined and forwarding to [target], on its own thread; the listeners hear when it is up,
     * and when it did not reach Rouen, why (§4.15). Its outcome goes to the way in use when that is still
     * the engine's, whatever looks were made meanwhile (a look made while this runs starts no other).
     */
    private fun repair(c: Context, target: String) {
        if (repairing) return
        repairing = true
        repairs.execute {
            // Cleared once the outcome is applied (on [work], after any look queued meanwhile), so no look in between
            // finds a repair still marked as running and starts none.
            var handed = false
            try {
                val now = current
                if (!watching || now == null || now.kind != Way.Kind.ENGINE) return@execute
                val up = TailscaleEngine.connectAway(c, target, Way.hostname(Prefs.name(c)))
                if (!up) {
                    Log.i(TAG, "the built-in Tailscale did not reach Rouen")
                    AppLog.line("WAY", "the built-in Tailscale did not reach Rouen" + if (TailscaleEngine.needsLogin) " (Tailscale wants this phone signed in again)" else "", anomaly = true)
                }
                work.execute {
                    try {
                        val cur = current
                        if (!watching || cur == null || cur.kind != Way.Kind.ENGINE || cur.base != now.base) return@execute
                        when {
                            !up -> settle(cur.copy(reach = Way.Reach.NO, why = whyNot(c, target, tried = true)))
                            cur.reach == Way.Reach.YES -> main.post { if (announced == cur) tell(cur) }
                            else -> settle(cur.copy(reach = Way.Reach.YES, why = null))
                        }
                    } finally {
                        repairing = false
                    }
                }
                handed = true
            } finally {
                if (!handed) repairing = false
            }
        }
    }

    /**
     * Why Rouen can't be reached now ([tried]: through the engine, which did not reach it; Tailscale wanting the phone
     * signed in again was found by trying it too).
     */
    private fun whyNot(c: Context, awayAt: String?, tried: Boolean): String = Way.whyNot(
        hasNetwork = hasNetwork(c), haveAway = awayAt != null, engineInBuild = TailscaleEngine.installed(c),
        engineOn = Prefs.engineOn(c), signedIn = TailscaleEngine.signedIn(c), engineTried = tried || TailscaleEngine.needsLogin,
        needsLogin = TailscaleEngine.needsLogin)

    /** At home (or over a VPN): the engine kept ready while the phone plays, stopped once idle (Mandarin's item 202). */
    private fun engineAtHome(c: Context, awayAt: String?, engineReady: Boolean) {
        if (!engineReady || awayAt == null) {
            if (TailscaleEngine.alive()) TailscaleEngine.stop()
            return
        }
        when (idle.verdict(away = false, inUse = PlayerService.playing)) {
            Way.EngineIdle.Verdict.KEEP -> {
                if (!TailscaleEngine.ready(awayAt)) repairs.execute { TailscaleEngine.prepare(c, awayAt, Way.hostname(Prefs.name(c))) }
                later(5 * 60_000L)
            }
            Way.EngineIdle.Verdict.WAIT -> if (TailscaleEngine.alive()) later(idle.remaining() + 500)
            Way.EngineIdle.Verdict.STOP -> if (TailscaleEngine.alive()) TailscaleEngine.stop()
        }
    }

    private val lookAgain = Runnable { app?.let { a -> if (watching) work.execute { check(a) } } }

    /** The way looked at again in [ms], once however often asked. */
    private fun later(ms: Long) {
        main.removeCallbacks(lookAgain)
        main.postDelayed(lookAgain, ms)
    }

    /** Rouen answering at [server], asked up to [looks] times a second apart. */
    private fun answers(server: String, looks: Int): Boolean {
        for (i in 1..looks) {
            if (Finder.isRouen(server, 1500, 1500)) return true
            if (i < looks) {
                try {
                    Thread.sleep(1000)
                } catch (e: InterruptedException) {
                    Thread.currentThread().interrupt()
                    return false
                }
            }
        }
        return false
    }

    /** A network Rouen could be reached over: Wi-Fi, Ethernet or mobile data (a VPN alone has nothing under it). */
    fun hasNetwork(c: Context): Boolean = transports(c).any { !it.hasTransport(NetworkCapabilities.TRANSPORT_VPN) }

    private fun onVpn(c: Context): Boolean = transports(c).any { it.hasTransport(NetworkCapabilities.TRANSPORT_VPN) }

    private fun onWifi(c: Context): Boolean = transports(c).any {
        it.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || it.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
    }

    @Suppress("DEPRECATION")   // allNetworks: the one way to see a VPN beside the default network
    private fun transports(c: Context): List<NetworkCapabilities> {
        val cm = c.getSystemService(ConnectivityManager::class.java) ?: return emptyList()
        return try {
            cm.allNetworks.mapNotNull { cm.getNetworkCapabilities(it) }
        } catch (e: SecurityException) {
            emptyList()
        }
    }
}
