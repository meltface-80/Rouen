package app.rouen.android

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The SlimProto bytes layer (dev/design/android-app.md §4.1 A, §4.21, v1.9.72-t41), ported from the proven server-side
 * lib/squeeze/slimproto.js. Pure, JVM-tested: the wire layout both sides share, so what the probe proved on the owner's
 * Core holds for the app's own player too.
 */
class SlimTest {

    private fun u8(b: ByteArray, i: Int) = b[i].toInt() and 0xFF
    private fun u16(b: ByteArray, i: Int) = (u8(b, i) shl 8) or u8(b, i + 1)
    private fun u32(b: ByteArray, i: Int): Long =
        (u8(b, i).toLong() shl 24) or (u8(b, i + 1).toLong() shl 16) or (u8(b, i + 2).toLong() shl 8) or u8(b, i + 3).toLong()

    @Test fun frameIsOpThenBigEndianLengthThenPayload() {
        val f = Slim.frame("STAT", byteArrayOf(1, 2, 3))
        assertEquals("STAT", String(f, 0, 4, Charsets.ISO_8859_1))
        assertEquals(3L, u32(f, 4))
        assertArrayEquals(byteArrayOf(1, 2, 3), f.copyOfRange(8, f.size))
    }

    @Test fun heloSaysWhoThePlayerIs() {
        val mac = byteArrayOf(0x02, 0x11, 0x22, 0x33, 0x44, 0x55)
        val f = Slim.helo(mac, "Model=Rouen,flc", reconnect = true)
        assertEquals("HELO", String(f, 0, 4, Charsets.ISO_8859_1))
        val p = f.copyOfRange(8, f.size)
        assertEquals(Slim.DEVICE_ID, u8(p, 0))
        assertArrayEquals(mac, p.copyOfRange(2, 8))
        assertEquals("the reconnect flag is 0x4000 in the WLAN-channel field", 0x4000, u16(p, 24))
        assertEquals("en", String(p, 34, 2, Charsets.ISO_8859_1))
        assertEquals("Model=Rouen,flc", String(p, 36, p.size - 36, Charsets.ISO_8859_1))
    }

    @Test fun statCarriesTheElapsedTimeInSecondsAndMillis() {
        val f = Slim.stat("STMt", Slim.Counters(elapsedMs = 90_123, jiffies = 5000))
        val p = f.copyOfRange(8, f.size)
        assertEquals("STMt", String(p, 0, 4, Charsets.ISO_8859_1))
        assertEquals(53, p.size)
        assertEquals("elapsed seconds at offset 37", 90L, u32(p, 37))
        assertEquals("elapsed millis at offset 43", 90_123L, u32(p, 43))
        assertEquals("the heartbeat's jiffies at 25", 5000L, u32(p, 25))
    }

    @Test fun theReaderJoinsPiecesAndSkipsAShortFrame() {
        val payload = ByteArray(18) { it.toByte() }
        val msg = byteArrayOf(0x00, (4 + payload.size).toByte()) + "audg".toByteArray(Charsets.ISO_8859_1) + payload
        val r = Slim.Reader()
        // Split across two chunks: nothing complete until the second arrives.
        assertTrue(r.push(msg.copyOfRange(0, 5)).isEmpty())
        val got = r.push(msg.copyOfRange(5, msg.size))
        assertEquals(1, got.size)
        assertEquals("audg", got[0].op)
        assertArrayEquals(payload, got[0].data)
        // A frame shorter than an opcode is stepped over, not returned.
        val short = byteArrayOf(0x00, 0x02, 0x41, 0x42)
        assertTrue(r.push(short).isEmpty())
    }

    /**
     * THE one: a `strm` is read field for field. The sample-rate table place is the bug class the server once had
     * (a wrong index reads 44100 as some other rate), so it is asserted exactly; break RATES' order and this fails.
     */
    @Test fun THE_ONE_strmIsReadFieldForField() {
        val d = ByteArray(24)
        "s1f?3210".forEachIndexed { i, c -> d[i] = c.code.toByte() }  // start, autostart 1, flac, size ?, rate[3]=44100, 2ch, little, transType 0
        d[7] = 10                                                     // threshold KB
        putU16(d, 18, 9000)                                          // server port
        // server ip 0.0.0.0 (the Core's own), left as zeros
        val strm = Slim.parseStrm(d + "GET /stream.flac HTTP/1.0\r\n\r\n".toByteArray(Charsets.ISO_8859_1))
        assertEquals("start", strm.command)
        assertEquals("flac", strm.format)
        assertNull("'?' means the stream says its own size", strm.sampleSize)
        assertEquals(44100, strm.sampleRate)
        assertEquals(2, strm.channels)
        assertEquals("1", strm.endian)
        assertEquals(10, strm.threshold)
        assertEquals(9000, strm.serverPort)
        assertEquals("0.0.0.0", strm.serverIp)
        assertTrue(strm.request.startsWith("GET /stream.flac"))
    }

    @Test fun audgIsTheVolumeInSixteenSixteen() {
        val d = ByteArray(18)
        d[8] = 1                        // adjust
        putU32(d, 10, 0x00010000)       // left: unity
        putU32(d, 14, 0x00008000)       // right: half
        val a = Slim.parseAudg(d)!!
        assertTrue(a.adjust)
        assertEquals(1.0, a.left, 1e-9)
        assertEquals(0.5, a.right, 1e-9)
        assertNull("too short: no gains", Slim.parseAudg(ByteArray(10)))
    }

    @Test fun flacInfoReadsTheStreaminfoBlock() {
        val head = ByteArray(42)
        "fLaC".toByteArray(Charsets.ISO_8859_1).copyInto(head, 0)
        head[4] = 0x80.toByte()         // last metadata block, type 0 (STREAMINFO)
        // STREAMINFO starts at offset 8; its bytes 10..17 carry rate/channels/bits/samples.
        head[18] = 0x0A; head[19] = 0xC4.toByte(); head[20] = 0x42; head[21] = 0xF0.toByte()
        putU32(head, 22, 441_000)       // total samples
        val fi = Slim.flacInfo(head)!!
        assertEquals(44100, fi.rate)
        assertEquals(2, fi.channels)
        assertEquals(16, fi.bits)
        assertEquals(10.0, fi.seconds!!, 1e-9)
        assertNull("too short to tell", Slim.flacInfo(ByteArray(20)))
        assertNull("not a FLAC header", Slim.flacInfo(ByteArray(42) { 'x'.code.toByte() }))
    }

    private fun putU16(b: ByteArray, at: Int, n: Int) { b[at] = (n ushr 8).toByte(); b[at + 1] = n.toByte() }
    private fun putU32(b: ByteArray, at: Int, n: Long) {
        b[at] = (n ushr 24).toByte(); b[at + 1] = (n ushr 16).toByte(); b[at + 2] = (n ushr 8).toByte(); b[at + 3] = n.toByte()
    }
    private fun putU32(b: ByteArray, at: Int, n: Int) = putU32(b, at, n.toLong())
}
