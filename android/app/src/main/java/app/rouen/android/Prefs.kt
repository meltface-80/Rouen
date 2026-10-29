package app.rouen.android

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import java.security.SecureRandom

/**
 * What the app keeps (SharedPreferences): the server, the phone's name, the quality, the
 * device id the server knows this phone by (dev/design/android-app.md §4.9, §4.10), and away from
 * home: Rouen's tailnet address, the built-in Tailscale on or off, and whether it has joined (§4.7).
 */
object Prefs {
    const val DEFAULT_PORT = Way.DEFAULT_PORT
    const val OPUS = "opus"
    const val LOSSLESS = "lossless"

    private const val FILE = "rouen"
    private const val SERVER = "server"
    private const val NAME = "name"
    private const val QUALITY = "quality"
    private const val DEVICE_ID = "device_id"
    private const val AWAY = "away_address"
    private const val ENGINE_ON = "engine_on"
    private const val ENGINE_JOINED = "engine_joined"

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

    /** Rouen's tailnet address as "host:port" (the last hello's `away_address`, or typed), or null. */
    fun awayAddress(c: Context): String? = Way.parseAddress(of(c).getString(AWAY, null))

    /** Keep [address] (a URL or "host:port") as Rouen's tailnet address; true when it changed. Null or not an address: kept as it was. */
    fun setAwayAddress(c: Context, address: String?): Boolean {
        val a = Way.parseAddress(address) ?: return false
        if (a == awayAddress(c)) return false
        of(c).edit().putString(AWAY, a).apply()
        return true
    }

    /** The built-in Tailscale engine may be used away from home (the switch on the server screen; on by default). */
    fun engineOn(c: Context): Boolean = of(c).getBoolean(ENGINE_ON, true)

    fun setEngineOn(c: Context, on: Boolean) { of(c).edit().putBoolean(ENGINE_ON, on).apply() }

    /** The engine has joined the tailnet here (its state on disk is the other sign; Mandarin's item 157). */
    fun engineJoined(c: Context): Boolean = of(c).getBoolean(ENGINE_JOINED, false)

    fun setEngineJoined(c: Context, joined: Boolean) {
        if (engineJoined(c) != joined) of(c).edit().putBoolean(ENGINE_JOINED, joined).apply()
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
}
