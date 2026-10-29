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
 *  - the built-in engine ([TailscaleEngine]): http://127.0.0.1:34500, forwarded to that address.
 *
 * The way is taken as soon as it is decided (Mandarin's item 118), so nothing goes on asking an
 * address the phone has left while the engine comes up; when it is up, the listeners hear again.
 * Rouen's login cookie is per origin, so it is carried to the new origin before they hear
 * ([Way.carry]).
 *
 * Lifetime: [start] by the player and the screens, [stop] by the player when it ends; the engine
 * goes with it. At home the engine runs only while the phone plays ([Way.EngineIdle]).
 */
object Away {
    private const val TAG = "RouenAway"
    private const val TROUBLE_GAP_MS = 20_000L

    /** The way in use: for [server] (Prefs.server when decided), of [kind], at [base] ("http://host:port"). */
    data class Active(val server: String, val kind: Way.Kind, val base: String)

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

    /** The origins Rouen is known at: home, its tailnet address, and the engine's port. */
    fun origins(c: Context): Set<String> = listOfNotNull(Prefs.server(c), Prefs.awayAddress(c), TailscaleEngine.FORWARD).toSet()

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

    /** Look again soon: changes come in bursts, so they are gathered ([soon]: a lost network, for less). */
    fun recheck(c: Context, soon: Boolean = false) {
        val a = c.applicationContext
        main.post {
            if (!watching) return@post
            pending?.let { if (!soon) return@post; main.removeCallbacks(it) }
            val r = Runnable { pending = null; work.execute { check(a) } }
            pending = r
            main.postDelayed(r, if (soon) 300L else 1500L)
        }
    }

    /** Rouen did not answer on the way in use (the player's link): looked at again, at most once in 20 s. */
    fun trouble(c: Context) {
        val now = SystemClock.elapsedRealtime()
        if (now - lastTrouble < TROUBLE_GAP_MS) return
        lastTrouble = now
        recheck(c)
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
                if (seen.put(network, key) != key) recheck(c)
            }
        }
        // The Wi-Fi and any VPN too: they come and go while Android's default stays the same (Mandarin's item 127).
        val others = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = recheck(c)
            override fun onLost(network: Network) = recheck(c, soon = true)
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
        // No network at all: nothing to reach, so the way stays as it was.
        if (was != null && !hasNetwork(c)) return settle(was)
        val awayAt = Prefs.awayAddress(c)
        val vpn = onVpn(c)
        val looks = Way.looksBeforeAway(wasAway = was != null && was.kind != Way.Kind.HOME, onWifi = onWifi(c))
        val homeOk = answers(home, looks)
        val engineReady = Prefs.engineOn(c) && TailscaleEngine.signedIn(c)
        val direct = !homeOk && awayAt != null && awayAt != home && vpn && Finder.isRouen(awayAt, 3000, 3000)
        val kind = Way.choose(homeOk, awayAt != null, direct, engineReady)
        val base = Prefs.base(
            when (kind) {
                Way.Kind.HOME -> home
                Way.Kind.DIRECT -> awayAt ?: home
                Way.Kind.ENGINE -> TailscaleEngine.FORWARD
            }
        )
        // The phone's addresses changed: the engine finds its way on the new network.
        if (TailscaleEngine.alive()) TailscaleEngine.sendInterfaces()
        settle(Active(home, kind, base))
        if (kind == Way.Kind.ENGINE && awayAt != null) repair(c, awayAt) else engineAtHome(c, awayAt, engineReady)
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
        if (a == before && !first) return
        Log.i(TAG, "${a.kind.name.lowercase()}: using ${a.base}")
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

    /** The engine joined and forwarding to [target], on its own thread; the listeners hear when it is up. */
    private fun repair(c: Context, target: String) {
        if (repairing) return
        repairing = true
        repairs.execute {
            try {
                val now = current
                if (watching && now != null && now.kind == Way.Kind.ENGINE &&
                    TailscaleEngine.connectAway(c, target, Way.hostname(Prefs.name(c)))) {
                    main.post { if (announced == now) tell(now) }
                } else {
                    Log.i(TAG, "the built-in Tailscale is not up yet")
                }
            } finally {
                repairing = false
            }
        }
    }

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
