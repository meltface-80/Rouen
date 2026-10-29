package app.rouen.android

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import java.security.SecureRandom

/**
 * What the app keeps (SharedPreferences): the server, the phone's name, the quality, and the
 * device id the server knows this phone by (dev/design/android-app.md §4.9, §4.10).
 */
object Prefs {
    const val DEFAULT_PORT = 3399
    const val OPUS = "opus"
    const val LOSSLESS = "lossless"

    private const val FILE = "rouen"
    private const val SERVER = "server"
    private const val NAME = "name"
    private const val QUALITY = "quality"
    private const val DEVICE_ID = "device_id"

    private fun of(c: Context): SharedPreferences = c.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /** The server as "host:port", or null before the first connect. */
    fun server(c: Context): String? = of(c).getString(SERVER, null)?.takeIf { it.isNotBlank() }

    /** The page and the API's base: "http://host:port". */
    fun base(server: String): String = "http://$server"

    fun name(c: Context): String = of(c).getString(NAME, null)?.takeIf { it.isNotBlank() } ?: Build.MODEL

    fun quality(c: Context): String = if (of(c).getString(QUALITY, OPUS) == LOSSLESS) LOSSLESS else OPUS

    fun save(c: Context, server: String, name: String, quality: String) {
        of(c).edit()
            .putString(SERVER, server)
            .putString(NAME, name.trim().ifEmpty { Build.MODEL })
            .putString(QUALITY, if (quality == LOSSLESS) LOSSLESS else OPUS)
            .apply()
    }

    /** A random 128-bit id, 32 lowercase hex characters, made once and kept. */
    @Synchronized
    fun deviceId(c: Context): String {
        val p = of(c)
        p.getString(DEVICE_ID, null)?.takeIf { ID.matches(it) }?.let { return it }
        val bytes = ByteArray(16).also { SecureRandom().nextBytes(it) }
        val id = bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) }
        p.edit().putString(DEVICE_ID, id).commit()
        return id
    }

    private val ID = Regex("^[0-9a-f]{32}$")

    /**
     * An address as typed ("192.168.1.20", "rouen.local:3399", "http://nas:3399/") made into
     * "host:port", or null when it is not one. No port means Rouen's own, 3399.
     */
    fun parseAddress(typed: String): String? {
        var s = typed.trim()
        s = s.removePrefix("http://").removePrefix("https://")
        s = s.substringBefore('/').trim()
        if (s.isEmpty() || s.any { it.isWhitespace() }) return null
        val colon = s.lastIndexOf(':')
        if (colon < 0) return "$s:$DEFAULT_PORT"
        val host = s.substring(0, colon)
        val port = s.substring(colon + 1).toIntOrNull() ?: return null
        if (host.isEmpty() || host.contains(':') || port !in 1..65535) return null
        return "$host:$port"
    }
}
