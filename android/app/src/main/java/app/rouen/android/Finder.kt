package app.rouen.android

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.SocketException
import java.net.URL
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Finding Rouen on the phone's own network (dev/design/android-app.md §4.8).
 *
 * From Mandarin's app (meltface-80/Mandarin: android/core/.../client/Finder.kt and
 * android/app/.../Net.kt), with Rouen's probe: every address in the phone's /24 is asked
 * `GET /api/login` on port 3399, a few dozen at a time. That route needs no login, and a
 * Rouen answers it with JSON holding `loggedIn` and `setup` (or `accounts: false`).
 */
object Finder {

    /** This phone's own IPv4 addresses on the local network, Wi-Fi first. */
    fun localIpv4(): List<String> {
        val out = ArrayList<Pair<Int, String>>()
        val ifs = try {
            NetworkInterface.getNetworkInterfaces()?.toList() ?: return emptyList()
        } catch (e: SocketException) {
            // No interfaces to read (the phone is offline): no address, and the screen says so.
            return emptyList()
        }
        for (ni in ifs) {
            val usable = try { ni.isUp && !ni.isLoopback } catch (e: SocketException) { false }
            if (!usable) continue
            val rank = when {
                ni.name.startsWith("wlan") -> 0
                ni.name.startsWith("eth") -> 1
                ni.name.startsWith("rmnet") || ni.name.startsWith("ccmni") -> 9   // mobile data
                else -> 5
            }
            for (a in ni.inetAddresses.toList()) {
                if (a is Inet4Address && !a.isLoopbackAddress && a.isSiteLocalAddress) {
                    out += rank to (a.hostAddress ?: continue)
                }
            }
        }
        return out.sortedBy { it.first }.map { it.second }.distinct()
    }

    /** Every other address in the same /24 as [localIp], nearest first. */
    fun candidates(localIp: String): List<String> {
        val parts = localIp.split('.')
        if (parts.size != 4 || parts.any { it.toIntOrNull() !in 0..255 }) return emptyList()
        val base = parts.take(3).joinToString(".")
        val me = parts[3].toInt()
        return (1..254).filter { it != me }
            .sortedBy { kotlin.math.abs(it - me) }
            .map { "$base.$it" }
    }

    /**
     * Probe [hosts] with [probe] (true: a Rouen answered there) and return the ones that did,
     * in the order given. [onFound] fires as each is found, so the screen can show the first
     * without waiting for all.
     */
    fun find(
        hosts: List<String>,
        threads: Int = 48,
        deadlineMs: Long = 8000,
        onFound: (String) -> Unit = {},
        probe: (String) -> Boolean
    ): List<String> {
        if (hosts.isEmpty()) return emptyList()
        val found = ConcurrentLinkedQueue<String>()
        val pool = Executors.newFixedThreadPool(threads.coerceIn(1, hosts.size)) { r ->
            Thread(r, "finder").apply { isDaemon = true }
        }
        try {
            for (h in hosts) {
                pool.execute {
                    if (probe(h)) { found.add(h); onFound(h) }
                }
            }
            pool.shutdown()
            pool.awaitTermination(deadlineMs, TimeUnit.MILLISECONDS)
        } finally {
            pool.shutdownNow()
        }
        val set = found.toSet()
        return hosts.filter { it in set }
    }

    /**
     * Is Rouen at [server] ("host:port")? `GET /api/login` answers JSON with `loggedIn` and
     * `setup`, or `accounts: false` when Rouen runs without accounts. Anything else is not Rouen.
     */
    fun isRouen(server: String, connectMs: Int, readMs: Int): Boolean {
        var conn: HttpURLConnection? = null
        return try {
            conn = URL(Prefs.base(server) + "/api/login").openConnection() as HttpURLConnection
            conn.connectTimeout = connectMs
            conn.readTimeout = readMs
            conn.instanceFollowRedirects = false
            conn.setRequestProperty("Accept", "application/json")
            if (conn.responseCode != 200) return false
            val text = conn.inputStream.bufferedReader().use { it.readText() }
            val j = JSONObject(text)
            (j.has("loggedIn") && j.has("setup")) || (j.has("accounts") && !j.optBoolean("accounts", true))
        } catch (e: Exception) {
            // Nothing there, something that is not Rouen, or not JSON: each is simply "not Rouen".
            false
        } finally {
            conn?.disconnect()
        }
    }
}
