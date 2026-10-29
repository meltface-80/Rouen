package app.rouen.android

import android.net.Uri
import android.util.Log
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicReference

/**
 * The phone's API, version 1 (dev/design/android-app.md §4.10), as the app speaks it:
 *
 *  - `POST /api/phone/hello` on start, and again after any 409 (or a 401: logged in since);
 *  - the commands long poll, `GET /api/phone/commands?after=<seq>&wait=25000`, whose ops go to
 *    [Host.onCommand] in order;
 *  - `POST /api/phone/state`, only the newest report ever sent ([report]);
 *  - `POST /api/phone/control` for the phone's own buttons ([control]);
 *  - `GET /api/phone/now` every 5 s while a session is open, with its cover, to [Host.onNow].
 *
 * A 401 means the WebView has not logged in yet: the link waits and tries again, and never
 * fails because of it. Each part runs on its own thread; nothing here touches the player.
 */
class PhoneLink(
    private val api: Api,
    private val deviceId: String,
    private val name: String,
    private val quality: String,
    private val host: Host
) {
    interface Host {
        /** One command, in order. Called on the link's thread. */
        fun onCommand(cmd: JSONObject)
        /** Is a session open (the now-playing poll runs only then)? */
        fun sessionOpen(): Boolean
        /** What Roon shows for this phone's zone, and its cover (null: none). Called on the link's thread. */
        fun onNow(now: JSONObject, art: ByteArray?)
    }

    @Volatile private var running = true
    @Volatile private var needHello = true
    @Volatile private var after = 0L
    private val pending = AtomicReference<JSONObject?>(null)
    private val reports: ExecutorService = Executors.newSingleThreadExecutor { r -> Thread(r, "phone-state").apply { isDaemon = true } }
    private val controls: ExecutorService = Executors.newSingleThreadExecutor { r -> Thread(r, "phone-control").apply { isDaemon = true } }
    private val commandThread = Thread({ commandLoop() }, "phone-commands").apply { isDaemon = true }
    private val nowThread = Thread({ nowLoop() }, "phone-now").apply { isDaemon = true }

    fun start() {
        commandThread.start()
        nowThread.start()
    }

    fun stop() {
        running = false
        commandThread.interrupt()
        nowThread.interrupt()
        reports.shutdownNow()
        controls.shutdownNow()
    }

    /** Send [state] (without device_id) as the newest report; an older one not yet sent is dropped. */
    fun report(state: JSONObject) {
        if (!running) return
        pending.set(state)
        submit(reports) {
            val body = pending.getAndSet(null) ?: return@submit
            body.put("device_id", deviceId)
            val r = api.post("/api/phone/state", body, REQUEST_MS)
            if (r.code == 409) needHello = true
        }
    }

    /** One of the phone's own buttons, asked of Roon: play, pause, playpause, next, previous, stop. */
    fun control(op: String) {
        if (!running) return
        submit(controls) {
            val body = JSONObject().put("device_id", deviceId).put("op", op)
            var r = api.post("/api/phone/control", body, REQUEST_MS)
            if (r.code == 409 && hello()) r = api.post("/api/phone/control", body, REQUEST_MS)
            if (r.code != 200) Log.w(TAG, "control $op: HTTP ${r.code}")
        }
    }

    private fun submit(pool: ExecutorService, job: () -> Unit) {
        try {
            pool.execute {
                try {
                    job()
                } catch (e: IOException) {
                    Log.w(TAG, "Rouen unreachable: ${e.message}")
                }
            }
        } catch (e: RejectedExecutionException) {
            // The link has stopped (the service is ending): there is no one left to send this for.
        }
    }

    /** Hello: (re)starts this phone's player in Rouen. False when Rouen did not take it. */
    @Synchronized
    private fun hello(): Boolean {
        val body = JSONObject().put("device_id", deviceId).put("name", name).put("quality", quality)
        val r = api.post("/api/phone/hello", body, REQUEST_MS)
        if (r.code != 200) {
            Log.i(TAG, "hello: HTTP ${r.code}" + if (r.code == 401) " (not logged in yet)" else "")
            return false
        }
        val j = r.json() ?: return false
        after = j.optLong("seq", 0L)
        needHello = false
        Log.i(TAG, "hello: ${j.optString("zone_name")}, seq $after")
        return true
    }

    private fun commandLoop() {
        while (running) {
            try {
                if (needHello && !hello()) { nap(RETRY_MS); continue }
                val r = api.get("/api/phone/commands?device_id=$deviceId&after=$after&wait=$WAIT_MS", WAIT_MS + 10_000)
                if (!running) return
                when (r.code) {
                    200 -> take(r.json())
                    409 -> needHello = true
                    401 -> { needHello = true; nap(RETRY_MS) }
                    else -> nap(RETRY_MS)
                }
            } catch (e: IOException) {
                nap(RETRY_MS)
            } catch (e: RuntimeException) {
                // Never let the poll die over one bad answer: say so in the log and carry on.
                Log.w(TAG, "commands", e)
                nap(RETRY_MS)
            }
        }
    }

    /** The answer's commands, in order, each once; then the answer's seq is where the next poll starts. */
    private fun take(j: JSONObject?) {
        if (j == null) return
        var last = after
        val cmds = j.optJSONArray("commands")
        if (cmds != null) {
            for (i in 0 until cmds.length()) {
                val c = cmds.optJSONObject(i) ?: continue
                val seq = c.optLong("seq", 0L)
                if (seq != 0L && seq <= last) continue
                if (!running) return
                host.onCommand(c)
                if (seq > last) last = seq
            }
        }
        after = if (j.has("seq")) maxOf(last, j.optLong("seq", last)) else last
    }

    private fun nowLoop() {
        var lastKey: String? = null
        var lastArt: ByteArray? = null
        while (running) {
            if (!host.sessionOpen()) { nap(1_000); continue }
            try {
                val r = api.get("/api/phone/now?device_id=$deviceId", REQUEST_MS)
                val j = if (r.code == 200) r.json() else null
                if (j != null) {
                    val key = if (j.isNull("image_key")) "" else j.optString("image_key", "")
                    if (key != lastKey) {
                        val art = if (key.isEmpty()) null else api.bytes("/api/image/" + Uri.encode(key) + "?size=512", IMAGE_MS)
                        // A cover that did not come is asked for again on the next round.
                        if (key.isEmpty() || art != null) lastKey = key
                        lastArt = art
                    }
                    if (running) host.onNow(j, lastArt)
                }
            } catch (e: IOException) {
                Log.w(TAG, "now: ${e.message}")
            }
            nap(NOW_MS)
        }
    }

    private fun nap(ms: Long) {
        try {
            Thread.sleep(ms)
        } catch (e: InterruptedException) {
            // Interrupted by stop(): the loop checks `running` next and ends.
        }
    }

    companion object {
        private const val TAG = "RouenLink"
        private const val WAIT_MS = 25_000
        private const val REQUEST_MS = 10_000
        private const val IMAGE_MS = 15_000
        private const val RETRY_MS = 5_000L
        private const val NOW_MS = 5_000L
    }
}
