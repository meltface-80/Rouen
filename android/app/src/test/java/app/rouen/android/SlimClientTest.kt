package app.rouen.android

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The phone's own Squeezebox player's wire helpers (dev/design/android-app.md §4.21, v1.9.72-t43). The socket itself
 * needs a Core, so it is tested on device; the pure pieces are checked here.
 */
class SlimClientTest {

    private fun strm(serverIp: ByteArray, port: Int, request: String): Slim.Strm {
        val d = ByteArray(24)
        "s1f?3210".forEachIndexed { i, c -> d[i] = c.code.toByte() }
        d[18] = (port ushr 8).toByte(); d[19] = port.toByte()
        serverIp.copyInto(d, 20)
        return Slim.parseStrm(d + request.toByteArray(Charsets.ISO_8859_1))
    }

    /**
     * THE one: the MAC the app registers with must be byte-for-byte the server's (lib/phone/player.js macOf), so Roon
     * knows the phone as the same Squeezebox however it connects. The vector is the server's own output for this id.
     */
    @Test fun THE_ONE_theMacMatchesTheServersForTheSameDeviceId() {
        val mac = SlimClient.macOf("rouenphone01")
        assertArrayEquals(byteArrayOf(0x02, 0x2a, 0xc8.toByte(), 0xba.toByte(), 0x85.toByte(), 0xd6.toByte()), mac)
        assertEquals("locally administered", 0x02, mac[0].toInt() and 0xFF)
        assertEquals(6, mac.size)
    }

    @Test fun theStreamUrlUsesTheCoreWhenTheStrmSays0000ElseItsOwnAddress() {
        val toCore = SlimClient.streamUrl("10.0.0.5", strm(byteArrayOf(0, 0, 0, 0), 9100, "GET /stream.flac?x=1 HTTP/1.0\r\n\r\n"))
        assertEquals("http://10.0.0.5:9100/stream.flac?x=1", toCore)
        val toGiven = SlimClient.streamUrl("10.0.0.5", strm(byteArrayOf(192.toByte(), 168.toByte(), 1, 9), 3400, "GET /a/b HTTP/1.0\r\n"))
        assertEquals("the strm's own address when it gives one", "http://192.168.1.9:3400/a/b", toGiven)
    }

    @Test fun theCapsNameTheZoneAndFlac() {
        val caps = SlimClient.caps("Rouen Pixel", "1.9.72-t43")
        assertTrue(caps.contains("ModelName=Rouen Pixel"))
        assertTrue("FLAC is offered", caps.trimEnd().endsWith(",flc"))
        assertTrue(caps.contains("MaxSampleRate=192000"))
    }
}
