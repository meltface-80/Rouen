package app.rouen.lite

import android.content.Context
import android.net.ConnectivityManager
import android.util.Log
import java.io.File
import java.io.IOException
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.NetworkInterface
import java.net.SocketException

/**
 * The device's network interfaces, for the built-in Tailscale engine (dev/design/rouen-lite.md §5.1, L4). Android 11
 * and later don't let native code list them, and Tailscale needs them; the engine takes them as text (POST /interfaces,
 * musicdnet/ifaces.go), one per line, `name index mtu up|loopback|multicast addr/bits,addr/bits`, and a line naming the
 * default route's interface, `default <name>`: the Rouen Android app's own (TailscaleEngine.kt interfacesText), line for
 * line. Rouen's server runs the engine, so the text goes to a file in its data folder ([FILE], named to it as
 * MUSICDNET_INTERFACES by [NodeRunner]) and the server hands it over whenever it changes (lib/tailscale/node.js).
 * Java's NetworkInterface and ConnectivityManager, with the permissions Rouen Lite has: no new one.
 */
object Interfaces {
    private const val TAG = "RouenLite"

    /** Where the server reads it: Rouen's data folder (NodeRunner's files/rouen/data), its Tailscale folder. */
    fun file(context: Context): File = File(context.filesDir, "rouen/data/tailscale/interfaces.txt")

    /**
     * Written afresh, whole (a temporary file renamed over it, so the server never reads half of one); one write at a
     * time, as the service's start and each change of network each start one (the review of 2.0.6-t10).
     */
    @Synchronized
    fun write(context: Context) {
        try {
            val f = file(context)
            f.parentFile?.mkdirs()
            val tmp = File(f.parentFile, f.name + ".tmp")
            tmp.writeText(text(context))
            if (!tmp.renameTo(f)) throw IOException("couldn't replace ${f.name}")
        } catch (e: IOException) {
            // The engine keeps the list it had; the next change of network writes it again.
            Log.i(TAG, "interfaces: ${e.message}")
        }
    }

    fun text(context: Context): String {
        val sb = StringBuilder()
        val name = try {
            val cm = context.getSystemService(ConnectivityManager::class.java)
            cm?.getLinkProperties(cm.activeNetwork)?.interfaceName
        } catch (e: SecurityException) {
            null
        }
        if (!name.isNullOrBlank()) sb.append("default ").append(name).append('\n')
        val ifs = try {
            NetworkInterface.getNetworkInterfaces()?.toList() ?: emptyList()
        } catch (e: SocketException) {
            emptyList()
        }
        for (ni in ifs) {
            val flags = ArrayList<String>()
            try {
                if (ni.isUp) flags += "up"
                if (ni.isLoopback) flags += "loopback"
                if (ni.supportsMulticast()) flags += "multicast"
            } catch (e: SocketException) {
                // An interface going away as it is read: listed with no flags, the next look has it right.
            }
            if (flags.isEmpty()) flags += "none"
            val addrs = ni.interfaceAddresses.mapNotNull { ia ->
                val host = when (val a = ia.address) {
                    is Inet6Address -> a.hostAddress?.substringBefore('%')
                    is Inet4Address -> a.hostAddress
                    else -> null
                } ?: return@mapNotNull null
                "$host/${ia.networkPrefixLength}"
            }
            val mtu = try { ni.mtu } catch (e: SocketException) { 1500 }
            sb.append(ni.name).append(' ').append(ni.index).append(' ').append(mtu)
                .append(' ').append(flags.joinToString("|")).append(' ').append(addrs.joinToString(",")).append('\n')
        }
        return sb.toString()
    }
}
