package app.rouen.android

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

/**
 * The phone's hello to Rouen (dev/design/android-app.md §4.10, §4.22): `POST /api/phone/hello` when the link starts,
 * and again every [EVERY_MS] for as long as it runs (5 s apart until Rouen takes it). Each way to Rouen gets its own
 * link ([PlayerService]'s relink), so a switch between home and away says hello on the new address. Hello's answer goes
 * to [Host.onHello]: whether Rouen sees the phone as away, and Rouen's tailnet address, which the app keeps for
 * reaching Rouen from away (§4.7) — said again each time, so an address Rouen gains or changes later reaches the app.
 * The repeated hello is also how the player notices Rouen stop answering while nothing else asks it (the screen off,
 * the page idle), as the commands poll did before §4.22. After each hello Rouen takes, This phone's plays not yet sent
 * ([PendingPlays]) go to `POST /api/phone/plays`, for Rouen's catch-up to replay to Roon (§4.22, v1.9.72-t57).
 *
 * Since §4.22 (the owner, 2026-10-31: "Scrap Squeezelite") the phone is never a Roon zone, so that is all the link
 * does: no commands long poll, no state reports, no now playing, no control. It still sends the phone's name and
 * streaming quality, which a Rouen from before v1.9.72-t53 requires (it refuses a hello without them); a newer Rouen
 * does not read them.
 *
 * A 401 means the WebView has not logged in yet: the link waits and tries again, and never fails because of it. Rouen
 * not answering at all goes to [Host.onUnreachable], so the way to it is looked at again ([Away]). It runs on its own
 * thread; nothing here touches the player.
 */
class PhoneLink(
    private val api: Api,
    private val deviceId: String,
    private val name: String,
    /** The streaming quality for the way in use, read at each hello (for a Rouen from before v1.9.72-t53 only). */
    private val quality: () -> String,
    /** This phone's plays not yet sent to Rouen. */
    private val plays: PendingPlays,
    private val host: Host
) {
    interface Host {
        /** Hello's answer (`away`, `away_address`). Called on the link's thread. */
        fun onHello(answer: JSONObject)
        /** Rouen did not answer at [Api.base] (nothing there, or no network). Called on the link's thread. */
        fun onUnreachable()
    }

    @Volatile private var running = true
    private val thread = Thread({ loop() }, "phone-hello").apply { isDaemon = true }

    fun start() = thread.start()

    fun stop() {
        running = false
        thread.interrupt()
    }

    /** Hello now and every [EVERY_MS] while the link runs; every [RETRY_MS] while Rouen doesn't take it. */
    private fun loop() {
        var said: String? = null
        while (running) {
            try {
                val seen = hello()
                if (seen != null) {
                    // In the log only when what Rouen says changes: a hello every 30 s would otherwise fill it.
                    if (seen != said) AppLog.line("LINK", "hello: $seen")
                    said = seen
                    send()
                    nap(EVERY_MS)
                    continue
                }
            } catch (e: IOException) {
                said = null
                if (running) host.onUnreachable()
            } catch (e: RuntimeException) {
                // Never let the link die over one bad answer: say so in the log and try again.
                Log.w(TAG, "hello", e)
                AppLog.line("LINK", "hello: ${e.javaClass.simpleName}: ${e.message}", anomaly = true)
            }
            nap(RETRY_MS)
        }
    }

    /** One hello: what Rouen said, in a line for the log, or null when it didn't take it. */
    private fun hello(): String? {
        val body = JSONObject().put("device_id", deviceId).put("name", name).put("quality", quality())
        val r = api.post("/api/phone/hello", body, REQUEST_MS)
        if (r.code != 200) {
            Log.i(TAG, "hello: HTTP ${r.code}" + if (r.code == 401) " (not logged in yet)" else "")
            AppLog.line("LINK", "hello refused: HTTP ${r.code}" + if (r.code == 401) " (not logged in yet)" else "", anomaly = r.code != 401)
            return null
        }
        val j = r.json() ?: return null
        if (running) host.onHello(j)
        return "Rouen sees this phone " + (if (j.optBoolean("away")) "away (over the tailnet)" else "at home") +
            ", Rouen's tailnet address ${if (j.isNull("away_address")) "none" else "given"}"
    }

    /**
     * This phone's plays not yet sent, the oldest first, at most [MAX_SEND] at a time: taken by Rouen, they go; refused
     * as malformed (400), they go too, as they never will be taken (only plays Rouen takes are kept, so that is a Rouen
     * whose rules changed, and keeping them would block every play behind them); anything else (a Rouen from before
     * v1.9.72-t56 has no such route) or no answer, they are kept for the next hello. Its own failures stay its own: a
     * hello Rouen just took says Rouen is there, so a lost upload is not a reason to look at the way to Rouen again.
     */
    private fun send() {
        val batch = plays.first(MAX_SEND)
        if (batch.isEmpty()) return
        val list = JSONArray()
        for (p in batch) list.put(PendingPlays.json(p))
        val r = try {
            api.post("/api/phone/plays", JSONObject().put("device_id", deviceId).put("plays", list), REQUEST_MS)
        } catch (e: IOException) {
            AppLog.line("LINK", "plays not sent (${e.javaClass.simpleName}); kept for the next hello", anomaly = true)
            return
        }
        when (r.code) {
            200 -> {
                plays.drop(batch)
                val off = r.json()?.optBoolean("catchup", true) == false
                AppLog.line("LINK", "${batch.size} play(s) sent for Rouen's catch-up" + if (off) " (catch-up is off in Rouen: not kept)" else "")
            }
            400 -> {
                plays.drop(batch)
                AppLog.line("LINK", "${batch.size} play(s) refused by Rouen as malformed: dropped", anomaly = true)
            }
            else -> AppLog.line("LINK", "plays not sent: HTTP ${r.code}; kept for the next hello", anomaly = r.code != 404)
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
        private const val REQUEST_MS = 10_000
        private const val RETRY_MS = 5_000L
        /** Plays sent at most at once (Rouen takes up to 500). */
        private const val MAX_SEND = 200
        /** How often a running link says hello again (the commands poll it replaces asked every 25 s or so). */
        private const val EVERY_MS = 30_000L
    }
}
