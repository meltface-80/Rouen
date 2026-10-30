package app.rouen.android

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

/**
 * The page's one address (Relay.kt, dev/design/android-app.md §4.16): with real sockets on 127.0.0.1. The owner,
 * 2026-10-29, Wi-Fi off: the music went on, but the page was covered for seconds and loaded again — "Ideally this
 * transition should be seamless like mandarin".
 */
class RelayTest {
    private val open = mutableListOf<AutoCloseable>()

    @After fun close() { open.reversed().forEach { runCatching { it.close() } } }

    /** A far end that answers each line with its own name and the line, then closes. */
    private fun upstream(name: String): ServerSocket {
        val s = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        open += s
        thread(isDaemon = true) {
            while (!s.isClosed) {
                val c = runCatching { s.accept() }.getOrNull() ?: break
                thread(isDaemon = true) {
                    c.use {
                        val line = it.getInputStream().bufferedReader().readLine() ?: return@use
                        it.getOutputStream().write("$name:$line\n".toByteArray())
                        it.getOutputStream().flush()
                    }
                }
            }
        }
        return s
    }

    private fun freePort(): Int = ServerSocket(0).use { it.localPort }

    private fun ask(port: Int, line: String): String? = Socket("127.0.0.1", port).use {
        it.soTimeout = 5000
        it.getOutputStream().write("$line\n".toByteArray())
        it.getOutputStream().flush()
        it.getInputStream().bufferedReader().readLine()
    }

    private fun addr(s: ServerSocket) = InetSocketAddress("127.0.0.1", s.localPort)

    @Test fun `a connection is joined to the way in use, and a new one to the way switched to - the page keeps its address`() {
        val home = upstream("home"); val engine = upstream("engine")
        val way = AtomicReference<InetSocketAddress?>(addr(home))
        val port = freePort()
        val relay = Relay(port, { way.get() }).also { open += AutoCloseable { it.stop() } }
        assertTrue(relay.start())
        assertEquals("home:hello", ask(port, "hello"))
        way.set(addr(engine))   // the Wi-Fi gone: the built-in Tailscale
        assertEquals("engine:again", ask(port, "again"))
        way.set(addr(home))
        assertEquals("home:back", ask(port, "back"))
    }

    @Test fun `with no way yet a connection waits for one, rather than failing`() {
        val engine = upstream("engine")
        val way = AtomicReference<InetSocketAddress?>(null)
        val port = freePort()
        val relay = Relay(port, { way.get() }, waitMs = 5000).also { open += AutoCloseable { it.stop() } }
        assertTrue(relay.start())
        thread(isDaemon = true) { Thread.sleep(400); way.set(addr(engine)) }   // the engine up a moment later
        assertEquals("engine:wait", ask(port, "wait"))
    }

    @Test fun `no way within the wait - closed, not left hanging`() {
        val port = freePort()
        val relay = Relay(port, { null }, waitMs = 300).also { open += AutoCloseable { it.stop() } }
        assertTrue(relay.start())
        val t0 = System.nanoTime()
        assertNull(ask(port, "anyone"))
        assertTrue("closed after the wait", (System.nanoTime() - t0) / 1_000_000 in 250..4000)
    }

    @Test fun `a way that doesn't answer - the connection closed, and the way looked at again`() {
        val gone = freePort()   // nothing listens there
        val looked = AtomicInteger()
        val port = freePort()
        val relay = Relay(port, { InetSocketAddress("127.0.0.1", gone) }, connectMs = 1000, unreached = { looked.incrementAndGet() })
            .also { open += AutoCloseable { it.stop() } }
        assertTrue(relay.start())
        assertNull(ask(port, "hello"))
        assertEquals(1, looked.get())
    }

    @Test fun `the port taken - start says so, so the page loads the old way`() {
        val taken = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1")).also { open += it }
        val relay = Relay(taken.localPort, { null })
        assertEquals(false, relay.start())
        assertEquals(false, relay.running())
    }

    @Test fun `a way's base as an address`() {
        assertEquals(InetSocketAddress("127.0.0.1", 34500), Relay.addressOf("http://127.0.0.1:34500"))
        assertEquals(InetSocketAddress("192.168.1.20", 3399), Relay.addressOf("http://192.168.1.20:3399/"))
        assertNull(Relay.addressOf("http://nohost"))
        assertNull(Relay.addressOf("http://h:99999"))
    }

    @Test fun `offline, with no way to Rouen, the app answers the connection itself - and Rouen's back, the way does`() {
        val home = upstream("home")
        val way = AtomicReference<InetSocketAddress?>(null)
        val offline = java.util.concurrent.atomic.AtomicBoolean(true)
        val port = freePort()
        val relay = Relay(port, { if (offline.get()) null else way.get() }, waitMs = 300, local = { s ->
            if (!offline.get()) false else {
                s.use { val line = it.getInputStream().bufferedReader().readLine(); it.getOutputStream().write("app:$line\n".toByteArray()); it.getOutputStream().flush() }
                true
            }
        }).also { open += AutoCloseable { it.stop() } }
        assertTrue(relay.start())
        assertEquals("app:hello", ask(port, "hello"))
        offline.set(false); way.set(addr(home))
        assertEquals("home:back", ask(port, "back"))
    }
}
