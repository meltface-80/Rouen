package app.rouen.android

import android.content.Context
import android.net.ConnectivityManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import org.json.JSONException
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.NetworkInterface
import java.net.SocketException
import java.net.URL
import java.security.SecureRandom
import java.util.concurrent.ConcurrentLinkedDeque
import java.util.concurrent.TimeUnit

/**
 * The built-in Tailscale (dev/design/android-app.md §4.7): the engine in `musicdnet/` at the
 * repository's root, shipped in the APK as libmusicdnet.so and run as a program of its own. It
 * joins the tailnet as this phone (no VPN, no Tailscale app) and opens 127.0.0.1:[PORT], which
 * leads to Rouen's tailnet address. From Mandarin's app (meltface-80/Mandarin:
 * android/app/.../TailscaleEngine.kt), without its crash notes and log screen.
 *
 * The app drives it over HTTP on 127.0.0.1 with a secret only the two of them know
 * (`MUSICDNET_SECRET`). Its stdin is held open by the app: when the app's process ends, it ends.
 * Its state (the sign-in) lives in the app's files, under `tailscale/`.
 *
 * Every call here blocks: never on the main thread.
 */
object TailscaleEngine {
    private const val TAG = "RouenTailscale"

    /** The phone-side port: fixed, so the page keeps one origin (its login and its settings belong to it). */
    const val PORT = 34500

    /** The address the app uses when the engine carries it. */
    const val FORWARD = "127.0.0.1:$PORT"

    @Volatile private var process: Process? = null
    @Volatile private var port = 0
    @Volatile private var secret = ""
    @Volatile private var appContext: Context? = null
    /** The target the engine forwards to, as far as this process knows (null: none yet). */
    @Volatile private var readyFor: String? = null
    /** When the engine was last started afresh by [connectAway]. */
    @Volatile private var freshAt = 0L

    /** Tailscale last said the phone must be signed in again (NeedsLogin), for why Rouen can't be reached (§4.15). */
    @Volatile var needsLogin = false
        private set

    /** The target Rouen was last reached at through the engine ([connectAway]'s probe); null: not, or not since. */
    @Volatile private var reachedFor: String? = null

    /** The engine's last error-output lines (a crash says why there). */
    val stderrTail = ConcurrentLinkedDeque<String>()

    private fun binary(c: Context) = File(c.applicationInfo.nativeLibraryDir, "libmusicdnet.so")

    private fun stateDir(c: Context) = File(c.filesDir, "tailscale")

    /** The engine is in this build (CI puts it in; a local build without Go has none). */
    fun installed(c: Context) = binary(c).exists()

    /** Signed in here: the engine is in the build and has joined before (its state on disk, or the app's note). */
    fun signedIn(c: Context) = installed(c) && (File(stateDir(c), "tailscaled.state").exists() || Prefs.engineJoined(c))

    fun alive() = process?.isAlive == true

    /** Already joined and forwarding to [target], as far as this process knows. */
    fun ready(target: String) = alive() && readyFor == target

    /**
     * Rouen reached at [target] through the engine, as its last probe found: what "reached" means for the engine's way
     * (§4.15). Forwarding ([ready]) is not enough: a forward is set before Rouen is ever asked.
     */
    fun reached(target: String) = alive() && reachedFor == target

    /** Tailscale's state as a look at it found it (the server screen, Rouen's page): a sign-in done there is noticed. */
    fun noteState(state: String) {
        when (state) {
            "Running" -> needsLogin = false
            "NeedsLogin", "NeedsMachineAuth" -> { needsLogin = true; reachedFor = null }
        }
    }

    /** Start the engine if it is not running. */
    @Synchronized
    fun ensureRunning(c: Context) {
        appContext = c.applicationContext
        process?.let { if (it.isAlive) return }
        val bin = binary(c)
        if (!bin.exists()) throw IOException("The Tailscale engine isn't in this build (${bin.path})")
        val bytes = ByteArray(24).also { SecureRandom().nextBytes(it) }
        secret = bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) }
        val dir = stateDir(c).apply { mkdirs() }
        val pb = ProcessBuilder(bin.path, "-dir", dir.path).redirectErrorStream(false)
        pb.environment()["MUSICDNET_SECRET"] = secret
        pb.environment()["HOME"] = dir.path
        pb.environment()["TMPDIR"] = c.cacheDir.path
        val p = pb.start()
        // Its first line: "CONTROL <port>".
        val line = p.inputStream.bufferedReader().readLine()
        if (line == null || !line.startsWith("CONTROL ")) {
            val why = p.errorStream.bufferedReader().readText().take(500)
            p.destroy()
            throw IOException("The Tailscale engine didn't start: $why")
        }
        port = line.removePrefix("CONTROL ").trim().toIntOrNull() ?: throw IOException("The Tailscale engine said: $line")
        process = p
        // Its error output kept flowing (a full pipe would stall it), and its tail kept.
        Thread({
            try {
                p.errorStream.bufferedReader().forEachLine {
                    stderrTail.addLast(it)
                    while (stderrTail.size > 50) stderrTail.pollFirst()
                }
            } catch (e: IOException) {
                // The pipe closed: the engine has ended, which is all this thread waits for.
            }
            if (process === p) Log.w(TAG, "the engine ended by itself: " + stderrTail.toList().takeLast(5).joinToString(" | "))
        }, "musicdnet-stderr").apply { isDaemon = true; start() }
        Log.i(TAG, "engine running, control port $port")
        sendInterfaces(force = true)
    }

    /**
     * Away: the engine running, joined as [hostname], forwarding 127.0.0.1:[PORT] to [target]
     * ("ip:port"), and Rouen answering through it. A few seconds when all is well.
     */
    fun connectAway(c: Context, target: String, hostname: String): Boolean {
        val ok = try {
            connect(c, target, hostname)
        } catch (e: IOException) {
            Log.i(TAG, "away connection: ${e.message}")
            false
        }
        reachedFor = if (ok) target else null
        return ok
    }

    private fun connect(c: Context, target: String, hostname: String): Boolean {
        if (!signedIn(c)) return false
        val wasAlive = alive()
        if (!join(c, target, hostname)) return false
        for (i in 0 until 3) {
            if (reaches()) return true
            // Connections from before a network change hang until they time out: dropped, but not on a
            // first miss (Mandarin's item 157), most often a tunnel only waking from the phone's sleep,
            // which the rebind puts right without cutting off the music.
            if (i > 0) { json("POST", "/down?on=1"); json("POST", "/down?on=0") }
            // And Tailscale rebinds its sockets: a tunnel can go stale with nothing on the phone changed.
            json("POST", "/rebind", timeoutMs = 12_000)
        }
        // An engine that was running and still can't reach Rouen has most likely gone stale: started
        // afresh, once in three minutes at most (its sign-in is on disk, so joining takes seconds).
        if (!wasAlive) return false
        val now = SystemClock.elapsedRealtime()
        if (!Way.mayRestartEngine(now, freshAt)) { Log.i(TAG, "can't reach $target; started afresh lately, so not again yet"); return false }
        freshAt = now
        Log.i(TAG, "can't reach $target; starting the engine afresh")
        stop()
        return join(c, target, hostname) && reaches()
    }

    /**
     * Rouen answering over the tailnet: the engine's own probe (Rouen's `/api/health`, as Mandarin's
     * server answers it), or else Rouen's `/api/login` through the forwarded port (a Rouen without
     * `/api/health` answers the probe 404).
     */
    private fun reaches(): Boolean =
        json("GET", "/probe", timeoutMs = 10_000).optBoolean("ok") || Finder.isRouen(FORWARD, 4000, 4000)

    /** Running, joined, forwarding to [target] and open for connections; false when it can't join (not signed in, or not in time). */
    private fun join(c: Context, target: String, hostname: String): Boolean {
        if (!started(c, hostname)) return false
        if (json("POST", "/forward?target=$target&port=$PORT").optInt("_status") >= 400) return false
        readyFor = target
        json("POST", "/down?on=0")
        return true
    }

    /** Running and joined as [hostname] (waited for, ten seconds at most); false when it needs a sign-in. */
    private fun started(c: Context, hostname: String): Boolean {
        ensureRunning(c)
        sendInterfaces()
        json("POST", "/start", JSONObject().put("Hostname", hostname).toString(), 30_000)
        for (i in 0 until 40) {
            when (json("GET", "/status", timeoutMs = 4000).optString("state")) {
                "Running" -> { needsLogin = false; Prefs.setEngineJoined(c, true); return true }
                "NeedsLogin", "NeedsMachineAuth" -> {
                    Log.i(TAG, "Tailscale on this phone needs signing in again (Server & playback → Away from home)")
                    needsLogin = true
                    reachedFor = null
                    Prefs.setEngineJoined(c, false)
                    return false
                }
            }
            try {
                Thread.sleep(250)
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
                return false
            }
        }
        return false
    }

    /** Joined and forwarding to [target] without checking Rouen answers (at home it is reached another way). */
    fun prepare(c: Context, target: String, hostname: String) {
        if (!signedIn(c)) return
        try {
            if (started(c, hostname) && json("POST", "/forward?target=$target&port=$PORT").optInt("_status") < 400) readyFor = target
        } catch (e: IOException) {
            Log.i(TAG, "couldn't keep Tailscale ready: ${e.message}")
        }
    }

    /** The engine running and started as [hostname], for the sign-in screen: its status. */
    fun startForSignIn(c: Context, hostname: String): JSONObject {
        ensureRunning(c)
        return json("POST", "/start", JSONObject().put("Hostname", hostname).toString(), 30_000)
    }

    /** Ask for a sign-in link: the status, with `auth_url` when Tailscale has given one. */
    fun login(): JSONObject = json("POST", "/login", timeoutMs = 20_000)

    /** Sign this phone out of the tailnet. */
    fun logout(c: Context): JSONObject {
        Prefs.setEngineJoined(c, false)
        readyFor = null
        reachedFor = null
        return json("POST", "/logout")
    }

    fun status(): JSONObject = json("GET", "/status", timeoutMs = 4000)

    /** Stopped, and gone before a new one starts (Mandarin's item 158: the dying one held the app's port). */
    @Synchronized
    fun stop() {
        val p = process
        process = null   // first: its watcher then knows the end was asked for
        readyFor = null
        reachedFor = null
        if (p == null) return
        try {
            p.outputStream.close()
        } catch (e: IOException) {
            // Its stdin is already closed: destroy() below ends it all the same.
        }
        p.destroy()
        try {
            p.waitFor(3, TimeUnit.SECONDS)
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
        }
        Log.i(TAG, "engine stopped")
    }

    private val feed = InterfaceFeed { SystemClock.elapsedRealtime() }
    private val later = Handler(Looper.getMainLooper())
    @Volatile private var laterPending = false

    /**
     * The phone's interfaces and which one carries its traffic, for the engine (Android 11+ does not
     * let native code list them). Sent only when the list differs from the last, at most once in ten
     * seconds ([InterfaceFeed]); [force]: a new engine process, which has no list yet.
     */
    fun sendInterfaces(force: Boolean = false) {
        val text = interfacesText()
        val action = synchronized(feed) { if (force) feed.reset(); feed.offer(text) }
        when (action) {
            InterfaceFeed.Action.Skip -> return
            is InterfaceFeed.Action.Later -> {
                if (laterPending) return
                laterPending = true
                later.postDelayed({
                    laterPending = false
                    Thread({ sendInterfaces() }, "musicdnet-interfaces").apply { isDaemon = true; start() }
                }, action.inMs)
            }
            InterfaceFeed.Action.Send -> try {
                call("POST", "/interfaces", text)
            } catch (e: IOException) {
                // The engine is not answering (ending, or not started): the next look sends the list again.
                Log.i(TAG, "interfaces: ${e.message}")
            }
        }
    }

    private fun interfacesText(): String {
        val sb = StringBuilder()
        appContext?.let { c ->
            val name = try {
                val cm = c.getSystemService(ConnectivityManager::class.java)
                cm?.getLinkProperties(cm.activeNetwork)?.interfaceName
            } catch (e: SecurityException) {
                null
            }
            if (!name.isNullOrBlank()) sb.append("default ").append(name).append('\n')
        }
        val ifs = try {
            NetworkInterface.getNetworkInterfaces()?.toList() ?: emptyList()
        } catch (e: SocketException) {
            emptyList()
        }
        for (ni in ifs) {
            val flags = ArrayList<String>()
            try {
                if (ni.isUp) flags += "up"
                if (ni.isLoopback) flags += "loopback"
                if (ni.supportsMulticast()) flags += "multicast"
            } catch (e: SocketException) {
                // An interface going away as it is read: listed with no flags, the next look has it right.
            }
            if (flags.isEmpty()) flags += "none"
            val addrs = ni.interfaceAddresses.mapNotNull { ia ->
                val host = when (val a = ia.address) {
                    is Inet6Address -> a.hostAddress?.substringBefore('%')
                    is Inet4Address -> a.hostAddress
                    else -> null
                } ?: return@mapNotNull null
                "$host/${ia.networkPrefixLength}"
            }
            val mtu = try { ni.mtu } catch (e: SocketException) { 1500 }
            sb.append(ni.name).append(' ').append(ni.index).append(' ').append(mtu)
                .append(' ').append(flags.joinToString("|")).append(' ').append(addrs.joinToString(",")).append('\n')
        }
        return sb.toString()
    }

    /** One call to the engine: (HTTP status, body). Throws [IOException] when it is not answering. */
    fun call(method: String, path: String, body: String? = null, timeoutMs: Int = 15_000): Pair<Int, String> {
        if (port == 0) throw IOException("the Tailscale engine is not running")
        val c = URL("http://127.0.0.1:$port$path").openConnection() as HttpURLConnection
        c.requestMethod = method
        c.connectTimeout = 3000
        c.readTimeout = timeoutMs
        c.useCaches = false
        c.setRequestProperty("X-Secret", secret)
        try {
            if (body != null) {
                c.doOutput = true
                c.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val code = c.responseCode
            val text = (if (code >= 400) c.errorStream else c.inputStream)?.bufferedReader()?.use { it.readText() } ?: ""
            return code to text
        } finally {
            c.disconnect()
        }
    }

    /** One call, its JSON answer with `_status` added (`error` holds a body that is not JSON). */
    fun json(method: String, path: String, body: String? = null, timeoutMs: Int = 15_000): JSONObject {
        val (code, text) = call(method, path, body, timeoutMs)
        val j = try { JSONObject(text) } catch (e: JSONException) { JSONObject().put("error", text) }
        return j.put("_status", code)
    }
}
