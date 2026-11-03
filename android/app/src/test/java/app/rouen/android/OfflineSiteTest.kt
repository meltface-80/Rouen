package app.rouen.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread

/** Rouen's page served by the app when Rouen can't be reached (dev/design/android-app.md §4.19, v1.9.72-t29). */
class OfflineSiteTest {
    private val files = mapOf(
        "index.html" to "<!doctype html><html><head><meta charset=\"utf-8\"><script src=\"/login.js\"></script></head><body></body></html>",
        "style.css" to "body{}",
        "offline.js" to "/* offline */",
    )
    private val site = OfflineSite({ files[it]?.toByteArray() }, { key -> if (key == "abc") byteArrayOf(1, 2, 3) else null })

    @Test fun THE_ONE_thePageIsTheCopyWithTheOfflineScriptFirst() {
        val a = site.answer("GET", "/")
        assertEquals(200, a.status)
        assertEquals("text/html; charset=utf-8", a.type)
        val html = String(a.body)
        assertTrue(html, html.startsWith("<!doctype html><html><head>" + OfflineSite.SCRIPT + "<meta"))
        assertTrue("before the page's own scripts", html.indexOf("/offline.js") < html.indexOf("/login.js"))
        assertEquals(200, site.answer("GET", "/index.html?v=3").status)
    }

    @Test fun thePagesFilesAndADownloadedAlbumsCover() {
        assertEquals("body{}", String(site.answer("GET", "/style.css?v=1").body))
        assertEquals("text/css; charset=utf-8", site.answer("GET", "/style.css").type)
        val c = site.answer("GET", "/api/image/dl%3Aabc?size=300")
        assertEquals(200, c.status)
        assertEquals("image/jpeg", c.type)
        assertEquals(listOf<Byte>(1, 2, 3), c.body.toList())
        assertEquals(404, site.answer("GET", "/api/image/dl:other").status)
        assertEquals("a Roon cover is not on the phone", 404, site.answer("GET", "/api/image/roonkey123").status)
    }

    @Test fun rouensApiIsOutOfReachAndNothingLeavesTheFolder() {
        assertEquals(503, site.answer("GET", "/api/zones").status)
        assertEquals(405, site.answer("POST", "/api/play").status)
        assertEquals(404, site.answer("GET", "/../secret").status)
        assertEquals(404, site.answer("GET", "/nothing.js").status)
        assertFalse(OfflineSite.safe("a/../b"))
        assertFalse(OfflineSite.safe("x%2F..%2Fy"))
        assertTrue(OfflineSite.safe("icons/rouen-192.png"))
    }

    @Test fun overARealSocket() {
        val server = ServerSocket()
        server.bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0))
        thread { server.accept().let { site.serve(it) } }
        val reply = Socket("127.0.0.1", server.localPort).use { s ->
            s.getOutputStream().write("GET /style.css HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n".toByteArray())
            s.getInputStream().readBytes().toString(Charsets.UTF_8)
        }
        server.close()
        assertTrue(reply, reply.startsWith("HTTP/1.1 200 OK\r\n"))
        assertTrue(reply, reply.contains("Content-Length: 6\r\n"))
        assertTrue(reply, reply.endsWith("\r\n\r\nbody{}"))
    }
}
