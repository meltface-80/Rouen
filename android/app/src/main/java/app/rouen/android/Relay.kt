package app.rouen.android

import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * A relay on 127.0.0.1 (dev/design/android-app.md §4.16, v1.9.72-t18): each connection made to it is joined, byte for
 * byte, to the address [target] gives at that moment, so whoever connects keeps one address while what is behind it
 * changes. The page is loaded from it: when the way to Rouen switches (home, a VPN, the built-in Tailscale), the page's
 * next requests go the new way and the page itself is never loaded again.
 *
 * - [target] null means no way to Rouen yet: a connection waits for one, [waitMs] at most, then is closed. Unless
 *   [local] takes it: offline, the app answers the page itself ([OfflineSite], v1.9.72-t29).
 * - A connection whose far end can't be reached is closed, and [unreached] is told (the way is looked at again).
 * - A connection already joined stays with the address it was joined to: when that way goes, it ends, and the page
 *   asks again, through the relay, on the new way.
 *
 * Free of Android, so it is tested on the JVM with real sockets (src/test).
 */
class Relay(
    private val port: Int,
    private val target: () -> InetSocketAddress?,
    private val waitMs: Long = 20_000L,
    private val connectMs: Int = 5_000,
    private val unreached: () -> Unit = {},
    private val local: (Socket) -> Boolean = { false }
) {
    @Volatile private var server: ServerSocket? = null
    private val pool: ExecutorService = Executors.newCachedThreadPool { r -> Thread(r, "relay").apply { isDaemon = true } }

    /** Listening. */
    fun running(): Boolean = server?.isClosed == false

    /** Listen on 127.0.0.1:[port]; false when the port can't be had (another app holds it). Again is harmless. */
    @Synchronized
    fun start(): Boolean {
        if (running()) return true
        val s = ServerSocket()
        return try {
            s.reuseAddress = true
            s.bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), port))
            server = s
            pool.execute { accept(s) }
            true
        } catch (e: IOException) {
            s.close()
            false
        }
    }

    /** Stop listening; connections already joined run to their end. */
    @Synchronized
    fun stop() {
        server?.close()
        server = null
    }

    private fun accept(s: ServerSocket) {
        while (!s.isClosed) {
            val near = try {
                s.accept()
            } catch (e: IOException) {
                return   // closed by stop(): nothing more to accept
            }
            pool.execute { join(near) }
        }
    }

    /** [near] joined to the way's address, once there is one. */
    private fun join(near: Socket) {
        if (target() == null && local(near)) return
        val to = waitForTarget()
        if (to == null) {
            near.close()
            return
        }
        val far = Socket()
        try {
            far.connect(to, connectMs)
        } catch (e: IOException) {
            far.close()
            near.close()
            unreached()
            return
        }
        near.tcpNoDelay = true
        far.tcpNoDelay = true
        pool.execute { pump(near.getInputStream(), far.getOutputStream(), near, far) }
        pump(far.getInputStream(), near.getOutputStream(), near, far)
    }

    private fun waitForTarget(): InetSocketAddress? {
        val until = System.nanoTime() + waitMs * 1_000_000
        while (true) {
            target()?.let { return it }
            if (System.nanoTime() >= until) return null
            try {
                Thread.sleep(100)
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
                return null
            }
        }
    }

    /** One direction, until either end goes; then both ends are closed, which ends the other direction too. */
    private fun pump(from: InputStream, to: OutputStream, a: Socket, b: Socket) {
        val buf = ByteArray(16 * 1024)
        try {
            while (true) {
                val n = from.read(buf)
                if (n < 0) break
                to.write(buf, 0, n)
                to.flush()
            }
        } catch (e: IOException) {
            // One end went (the way left, or the page closed it): both are closed below, which is all there is to do.
        } finally {
            a.close()
            b.close()
        }
    }

    companion object {
        /**
         * "http://host:port" (a way's base) as an address to join to, null when it is not one. A name is looked up here,
         * so it is called on the relay's own threads, never the main one.
         */
        fun addressOf(base: String): InetSocketAddress? {
            val hp = base.removePrefix("http://").substringBefore('/')
            val colon = hp.lastIndexOf(':')
            if (colon <= 0) return null
            val port = hp.substring(colon + 1).toIntOrNull() ?: return null
            if (port !in 1..65535) return null
            return InetSocketAddress(hp.substring(0, colon), port)
        }
    }
}
