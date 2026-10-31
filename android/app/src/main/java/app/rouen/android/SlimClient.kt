package app.rouen.android

import java.net.InetSocketAddress
import java.net.Socket
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * The phone's own Squeezebox player on the wire (dev/design/android-app.md §4.21, v1.9.72-t43): the app holds the
 * SlimProto control connection to the Roon Core itself, so the phone *is* the zone at home, not a zone Rouen's server
 * emulates. A faithful port of Rouen's proven server-side player (lib/phone/player.js) — the HELO/STAT handshake, the
 * heartbeat, the reconnect, and the mapping of Roon's `strm`/`audg` onto a player — over [Slim]'s bytes layer. What it
 * does NOT port is the server's transcode-and-relay: the app takes Roon's FLAC stream straight off the Core and plays
 * it on its own player, so a stream's `strm` becomes a URL for [Out.play].
 *
 * Free of Android: the socket and timers are plain JVM and the player is an interface ([Out]), so the logic is the
 * server's and can be exercised the same way. [PlayerService] supplies the [Out] that drives ExoPlayer, and starts and
 * stops this only at home (the split head, §4.20; away the server keeps its player for Roon's counts).
 *
 * One worker thread reads the socket; a single-thread scheduler beats and ticks. Roon's commands arrive on the reader
 * thread and are handed to [Out], which must be safe to call there (PlayerService hops to the main thread).
 */
class SlimClient(
    private val host: String,
    private val port: Int,
    private val deviceId: String,
    private val zoneName: String,
    private val version: String,
    private val out: Out,
    private val log: (String) -> Unit = {},
) {
    /** The player the client drives. All calls come on the reader thread; the implementation makes them safe. */
    interface Out {
        /** Roon's `strm start`: play this HTTP URL (the Core's stream), from the beginning. */
        fun play(url: String)
        fun pause()
        fun unpause()
        fun stop()
        /** Roon's `audg`: set the output gain, 0..1. */
        fun volume(gain: Double)
        /** How far into the current stream the player is, in milliseconds (0 when nothing plays). */
        fun positionMs(): Long
        /** Whether the player is playing now (drives the STMt heartbeat's state to Roon). */
        fun playing(): Boolean
    }

    companion object {
        private const val RECONNECT_MS = 3000L
        private const val BEAT_MS = 1000L
        private const val SILENT_MS = 35_000L

        /** The player's MAC: 0x02 (locally administered) and the first five bytes of the device id's SHA-256 — the same
         *  as the server's (lib/phone/player.js `macOf`), so Roon knows the phone as one player however it connects. */
        fun macOf(deviceId: String): ByteArray {
            val h = MessageDigest.getInstance("SHA-256").digest(deviceId.toByteArray(Charsets.UTF_8))
            return byteArrayOf(0x02) + h.copyOfRange(0, 5)
        }

        /** The capabilities HELO sends — Squeezelite's, as the server's player gives them, naming the zone and FLAC. */
        fun caps(zoneName: String, version: String): String =
            "Model=squeezelite,AccuratePlayPoints=1,HasDigitalOut=1,HasPolarityInversion=1," +
                "Firmware=v$version-rouen,ModelName=$zoneName,MaxSampleRate=192000,flc"

        /** The stream URL for a `strm`: its own server address, or the Core's when it says 0.0.0.0, and the request's path. */
        fun streamUrl(host: String, strm: Slim.Strm): String {
            val h = if (strm.serverIp == "0.0.0.0" || strm.serverIp.isBlank()) host else strm.serverIp
            val path = Regex("^[A-Z]+\\s+(\\S+)").find(strm.request)?.groupValues?.getOrNull(1) ?: "/"
            return "http://$h:${strm.serverPort}$path"
        }
    }

    @Volatile private var stopped = true
    @Volatile private var socket: Socket? = null
    @Volatile private var connected = false
    @Volatile private var everConnected = false
    @Volatile private var lastHeard = 0L
    private var scheduler: ScheduledExecutorService? = null

    /** Join Roon (and keep rejoining). Idempotent. */
    @Synchronized fun start() {
        if (!stopped) return
        stopped = false
        scheduler = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "slim-beat").apply { isDaemon = true } }
        scheduler?.scheduleWithFixedDelay({ beat() }, BEAT_MS, BEAT_MS, TimeUnit.MILLISECONDS)
        link()
    }

    /** Leave Roon: the zone goes. Idempotent. */
    @Synchronized fun stop() {
        if (stopped) return
        stopped = true
        connected = false
        scheduler?.shutdownNow()
        scheduler = null
        try { socket?.close() } catch (e: Exception) { /* closing a closed socket is fine */ }
        socket = null
    }

    val running: Boolean get() = !stopped

    private fun send(bytes: ByteArray) {
        val s = socket
        if (connected && s != null && !s.isClosed) {
            try { s.getOutputStream().write(bytes); s.getOutputStream().flush() }
            catch (e: Exception) { log("write failed: ${e.message}"); try { s.close() } catch (x: Exception) {} }
        }
    }

    /** STAT: an event and where the player is, as Roon reads it. */
    private fun status(event: String, serverTimestamp: Long = 0) {
        val ms = out.positionMs().coerceAtLeast(0)
        send(Slim.stat(event, Slim.Counters(elapsedMs = ms, serverTimestamp = serverTimestamp)))
    }

    private fun onMessage(op: String, data: ByteArray) {
        when (op) {
            "strm" -> {
                val st = Slim.parseStrm(data)
                when (st.command) {
                    "status" -> status("STMt", st.replayGain)
                    "start" -> { out.play(streamUrl(host, st)); status("STMs") }
                    "pause" -> { out.pause(); status("STMp") }
                    "unpause" -> { out.unpause(); status("STMr") }
                    "stop", "flush" -> { out.stop(); status("STMf") }
                    else -> { /* skip, status, and any byte we do not act on */ }
                }
            }
            "audg" -> Slim.parseAudg(data)?.let { out.volume(maxOf(it.left, it.right).coerceIn(0.0, 1.0)) }
            "setd" -> if (data.isNotEmpty() && data[0].toInt() == 0) send(Slim.setdName(zoneName))
        }
    }

    /** Open the connection, say hello, and read until it closes; then (unless stopped) reconnect. On its own thread. */
    private fun link() {
        if (stopped) return
        Thread({
            val sock = Socket()
            socket = sock
            val reader = Slim.Reader()
            try {
                sock.connect(InetSocketAddress(host, port), CONNECT_MS)
                connected = true
                lastHeard = System.currentTimeMillis()
                send(Slim.helo(macOf(deviceId), caps(zoneName, version), reconnect = everConnected))
                everConnected = true
                log("joined Roon as $zoneName at $host:$port")
                val input = sock.getInputStream()
                val buf = ByteArray(8192)
                while (!stopped) {
                    val n = input.read(buf)
                    if (n < 0) break
                    lastHeard = System.currentTimeMillis()
                    for (m in reader.push(buf.copyOfRange(0, n))) {
                        try { onMessage(m.op, m.data) } catch (e: Exception) { log("message ${m.op}: ${e.message}") }
                    }
                }
            } catch (e: Exception) {
                if (!stopped) log("Roon: ${e.message}")
            } finally {
                connected = false
                try { sock.close() } catch (e: Exception) { /* already closed */ }
                if (socket === sock) socket = null
                if (!stopped) scheduler?.schedule({ link() }, RECONNECT_MS, TimeUnit.MILLISECONDS)
            }
        }, "slim-read").apply { isDaemon = true }.start()
    }

    /** Each second: drop a silent connection (so it reconnects), else send the heartbeat Roon expects. */
    private fun beat() {
        if (stopped || !connected) return
        if (System.currentTimeMillis() - lastHeard > SILENT_MS) {
            log("silent ${SILENT_MS}ms: dropping to reconnect")
            try { socket?.close() } catch (e: Exception) { /* already closed */ }
            return
        }
        status("STMt")
    }
}

/** The socket connect timeout, matched to the server-side player's reconnect pace. */
private const val CONNECT_MS = 10_000
