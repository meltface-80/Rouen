package app.rouen.android

/**
 * The Squeezebox player protocol (SlimProto) as the app speaks it to Roon (dev/design/android-app.md §4.1 A and §4.21,
 * v1.9.72-t41): the messages the player sends and the ones the Core sends, as bytes. A faithful port of Rouen's own
 * server-side implementation (lib/squeeze/slimproto.js), which the t1–t4 probe proved against the owner's Core — the
 * same wire layout, so what works there works here. Bytes only: no socket, no timer, free of Android, so it is tested
 * on the JVM ([SlimTest]). [SlimClient] (next slice) adds the socket, the stream and the player.
 *
 * Player → Core: a 4-byte opcode, a 4-byte big-endian length, the payload.
 * Core → player: a 2-byte big-endian length (of what follows), a 4-byte opcode, the payload.
 * The layouts are Squeezelite's (slimproto.h) and Lyrion's (Slim/Networking/Slimproto.pm), which agree.
 */
object Slim {

    /** Squeezelite's device id: Roon treats the player as a software Squeezebox. */
    const val DEVICE_ID = 12

    /** strm's PCM sample rate, by its character's place after "0" (Squeezelite's sample_rates[]). */
    val RATES = intArrayOf(11025, 22050, 32000, 44100, 48000, 8000, 12000, 16000, 24000, 96000, 88200, 176400, 192000,
        352800, 384000, 705600, 768000)
    /** strm's PCM sample size, by its character's place after "0". */
    val SIZES = intArrayOf(8, 16, 24, 32)
    /** strm's format byte, as a word. */
    val FORMATS = mapOf('f' to "flac", 'p' to "pcm", 'm' to "mp3", 'o' to "ogg", 'a' to "aac", 'w' to "wma",
        'l' to "alac", 'd' to "dsd", 'u' to "opus")
    /** strm's command byte, as a word. */
    val COMMANDS = mapOf('s' to "start", 'p' to "pause", 'u' to "unpause", 'q' to "stop", 't' to "status",
        'f' to "flush", 'a' to "skip")

    /** A message read from the Core: its 4-letter opcode and its payload. */
    class Msg(val op: String, val data: ByteArray)

    private fun u8(b: ByteArray, i: Int): Int = b[i].toInt() and 0xFF
    private fun u16(b: ByteArray, i: Int): Int = (u8(b, i) shl 8) or u8(b, i + 1)
    private fun u32(b: ByteArray, i: Int): Long =
        (u8(b, i).toLong() shl 24) or (u8(b, i + 1).toLong() shl 16) or (u8(b, i + 2).toLong() shl 8) or u8(b, i + 3).toLong()

    private fun putU16(b: ByteArray, at: Int, n: Int) { b[at] = (n ushr 8).toByte(); b[at + 1] = n.toByte() }
    private fun putU32(b: ByteArray, at: Int, n: Long) {
        b[at] = (n ushr 24).toByte(); b[at + 1] = (n ushr 16).toByte(); b[at + 2] = (n ushr 8).toByte(); b[at + 3] = n.toByte()
    }
    private fun putU64(b: ByteArray, at: Int, n: Long) {
        val v = if (n < 0) 0L else n
        putU32(b, at, (v ushr 32) and 0xFFFFFFFFL); putU32(b, at + 4, v and 0xFFFFFFFFL)
    }
    private fun nn(n: Long): Long = if (n < 0) 0 else n

    /** One player → Core message: op (4 ASCII letters), a 4-byte big-endian length, the payload. */
    fun frame(op: String, payload: ByteArray): ByteArray {
        val head = ByteArray(8)
        for (i in 0 until 4) head[i] = (if (i < op.length) op[i].code else 0).toByte()
        putU32(head, 4, payload.size.toLong())
        return head + payload
    }

    /**
     * HELO: the player says who it is. [mac] is 6 bytes; [caps] is the capability text ("Model=…,MaxSampleRate=…,flc").
     * [reconnect] sets the 0x4000 WLAN-channel flag Squeezelite uses to say it is reconnecting.
     */
    fun helo(mac: ByteArray, caps: String, reconnect: Boolean = false, bytesReceived: Long = 0): ByteArray {
        require(mac.size == 6) { "a MAC is 6 bytes" }
        val p = ByteArray(36)
        p[0] = DEVICE_ID.toByte()
        p[1] = 0                                           // revision
        System.arraycopy(mac, 0, p, 2, 6)
        // 8..23: the UUID, zeros (Squeezelite sends none either).
        putU16(p, 24, if (reconnect) 0x4000 else 0)        // WLAN channel list; 0x4000 says "reconnecting"
        putU64(p, 26, bytesReceived)
        p[34] = 'e'.code.toByte(); p[35] = 'n'.code.toByte()
        return frame("HELO", p + caps.toByteArray(Charsets.ISO_8859_1))
    }

    /** What a STAT carries beside its event. All optional; zero when unknown. */
    class Counters(
        val bufferSize: Long = 0, val bufferFull: Long = 0, val bytesReceived: Long = 0, val jiffies: Long = 0,
        val outputSize: Long = 0, val outputFull: Long = 0, val elapsedMs: Long = 0, val serverTimestamp: Long = 0,
        val error: Int = 0,
    )

    /** STAT: an event (4 letters: STMt heartbeat, STMs track started, STMd decoder done, STMu underrun, …) and counters. */
    fun stat(event: String, c: Counters): ByteArray {
        val p = ByteArray(53)
        for (i in 0 until 4) p[i] = (if (i < event.length) event[i].code else 0).toByte()
        // 4: num_crlf, 5: mas_initialized, 6: mas_mode — 0.
        putU32(p, 7, nn(c.bufferSize)); putU32(p, 11, nn(c.bufferFull))
        putU64(p, 15, c.bytesReceived)
        putU16(p, 23, 0xffff)                              // signal strength: wired
        putU32(p, 25, nn(c.jiffies)); putU32(p, 29, nn(c.outputSize)); putU32(p, 33, nn(c.outputFull))
        val ms = if (c.elapsedMs < 0) 0 else c.elapsedMs
        putU32(p, 37, ms / 1000)
        putU16(p, 41, 0)                                   // voltage
        putU32(p, 43, ms)
        putU32(p, 47, nn(c.serverTimestamp))
        putU16(p, 51, c.error and 0xFFFF)
        return frame("STAT", p)
    }

    /** RESP: the audio's HTTP response headers, handed back to the Core. */
    fun resp(headers: String): ByteArray = frame("RESP", headers.toByteArray(Charsets.ISO_8859_1))

    /** SETD: the player's name, answering the Core's ask (setd id 0), or confirming a name it set. */
    fun setdName(name: String): ByteArray =
        frame("SETD", byteArrayOf(0) + (name + "\u0000").toByteArray(Charsets.UTF_8))

    /** DSCO: the audio connection is over, and why: 0 closed, 1 reset by player, 2 by server, 3 never reached, 4 timed out. */
    fun dsco(reason: Int): ByteArray = frame("DSCO", byteArrayOf(reason.toByte()))

    /**
     * Reads Core → player messages from a byte stream that arrives in pieces: a 2-byte big-endian length, then that
     * many bytes starting with the 4-letter opcode. [push] returns the whole messages now complete.
     */
    class Reader {
        private var held = ByteArray(0)
        fun push(chunk: ByteArray): List<Msg> {
            held = if (held.isEmpty()) chunk else held + chunk
            val out = ArrayList<Msg>()
            var off = 0
            while (held.size - off >= 2) {
                val len = u16(held, off)
                if (held.size - off < 2 + len) break
                if (len >= 4) {
                    val op = String(held, off + 2, 4, Charsets.ISO_8859_1)
                    out.add(Msg(op, held.copyOfRange(off + 6, off + 2 + len)))
                }
                off += 2 + len
            }
            held = if (off == 0) held else held.copyOfRange(off, held.size)
            return out
        }
    }

    /** The Core's `strm` command (its 24 header bytes, then the HTTP request to send for the audio). */
    class Strm(
        val command: String, val autostart: String, val format: String, val sampleSize: Int?, val sampleRate: Int?,
        val channels: Int?, val endian: String, val threshold: Int, val transitionPeriod: Int, val transitionType: String,
        val flags: Int, val outputThreshold: Int, val replayGain: Long, val serverPort: Int, val serverIp: String,
        val request: String,
    )

    fun parseStrm(d: ByteArray): Strm {
        require(d.size >= 24) { "strm is at least 24 bytes, this one ${d.size}" }
        val ch = { i: Int -> (d[i].toInt() and 0xFF).toChar() }
        // "?" is the stream saying it itself, never a place in the table.
        val pick = { list: IntArray, c: Char ->
            if (c == '?') null else (c.code - 48).let { if (it in list.indices) list[it] else null }
        }
        return Strm(
            command = COMMANDS[ch(0)] ?: ch(0).toString(),
            autostart = ch(1).toString(),
            format = FORMATS[ch(2)] ?: ch(2).toString(),
            sampleSize = pick(SIZES, ch(3)),
            sampleRate = pick(RATES, ch(4)),
            channels = if (ch(5) == '1') 1 else if (ch(5) == '2') 2 else null,
            endian = ch(6).toString(),
            threshold = u8(d, 7),
            transitionPeriod = u8(d, 9),
            transitionType = ch(10).toString(),
            flags = u8(d, 11),
            outputThreshold = u8(d, 12),
            replayGain = u32(d, 14),
            serverPort = u16(d, 18),
            serverIp = "${u8(d, 20)}.${u8(d, 21)}.${u8(d, 22)}.${u8(d, 23)}",
            request = if (d.size > 24) String(d, 24, d.size - 24, Charsets.ISO_8859_1) else "",
        )
    }

    /** The volume Roon sets (audg, 16.16 fixed point; 0x10000 is unity), or null when too short. */
    class Audg(val left: Double, val right: Double, val adjust: Boolean)

    fun parseAudg(d: ByteArray): Audg? {
        if (d.size < 18) return null
        return Audg(left = u32(d, 10) / 65536.0, right = u32(d, 14) / 65536.0, adjust = d[8].toInt() != 0)
    }

    /** A FLAC stream's own make-up, from its STREAMINFO block; null until there is enough, or when it doesn't say. */
    class FlacInfo(val rate: Int, val channels: Int, val bits: Int, val seconds: Double?)

    fun flacInfo(head: ByteArray): FlacInfo? {
        if (head.size < 42 || String(head, 0, 4, Charsets.ISO_8859_1) != "fLaC" || (u8(head, 4) and 0x7f) != 0) return null
        val s = head.copyOfRange(8, 42)
        val rate = (u8(s, 10) shl 12) or (u8(s, 11) shl 4) or (u8(s, 12) ushr 4)
        val channels = ((u8(s, 12) ushr 1) and 7) + 1
        val bits = (((u8(s, 12) and 1) shl 4) or (u8(s, 13) ushr 4)) + 1
        val samples = (u8(s, 13) and 0x0f).toLong() * 0x100000000L + u32(s, 14)
        return FlacInfo(rate, channels, bits, if (rate != 0 && samples != 0L) samples.toDouble() / rate else null)
    }
}
