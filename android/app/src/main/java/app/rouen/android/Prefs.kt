package app.rouen.android

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import java.security.SecureRandom

/**
 * What the app keeps (SharedPreferences): the server, the phone's name, the device id the server
 * knows this phone by (dev/design/android-app.md §4.9, §4.10); the settings the page shows inside
 * the app ([PhoneChoices]: streaming quality at home and away, the download settings); and away from
 * home: Rouen's tailnet address, the built-in Tailscale on or off, and whether it has joined (§4.7);
 * and whether the app's log is collected (§4.13).
 */
object Prefs {
    const val DEFAULT_PORT = Way.DEFAULT_PORT
    const val OPUS = "opus"
    const val LOSSLESS = "lossless"

    private const val FILE = "rouen"
    private const val SERVER = "server"
    private const val NAME = "name"
    /** The first build's one quality, read only as the two streaming qualities' fallback. */
    private const val QUALITY = "quality"
    private const val DEVICE_ID = "device_id"
    private const val AWAY = "away_address"
    private const val ENGINE_ON = "engine_on"
    private const val ENGINE_JOINED = "engine_joined"
    private const val LOGGING = "logging"
    private const val ROON_ZONE = "roon_zone"

    private fun of(c: Context): SharedPreferences = c.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /** The server as "host:port", or null before the first connect. */
    fun server(c: Context): String? = of(c).getString(SERVER, null)?.takeIf { it.isNotBlank() }

    /** The page and the API's base: "http://host:port". */
    fun base(server: String): String = "http://$server"

    fun name(c: Context): String = of(c).getString(NAME, null)?.takeIf { it.isNotBlank() } ?: Build.MODEL

    /**
     * The phone's zone in Roon, as Rouen's last hello named it ("Rouen <name>"), or null before one. Kept, so the page
     * knows This phone's zone in Roon from its first zone list, before this start's hello (v1.9.72-t32).
     */
    fun roonZone(c: Context): String? = of(c).getString(ROON_ZONE, null)?.takeIf { it.isNotBlank() }

    fun setRoonZone(c: Context, name: String?) {
        if (!name.isNullOrBlank() && name != roonZone(c)) of(c).edit().putString(ROON_ZONE, name).apply()
    }

    /**
     * One of the page's settings ([PhoneChoices]), as kept: a String, Boolean or Int, or its default.
     * The two streaming qualities fall back on the one quality of the first build (`quality`).
     */
    fun choice(c: Context, key: String): Any {
        val p = of(c)
        val def = PhoneChoices.DEFAULTS.getValue(key)
        return when (def) {
            is Boolean -> p.getBoolean(key, def)
            is Int -> p.getInt(key, def)
            else -> {
                val legacy = if (key == PhoneChoices.HOME_QUALITY || key == PhoneChoices.AWAY_QUALITY) p.getString(QUALITY, null) else null
                val v = p.getString(key, null) ?: legacy
                if (v != null && PhoneChoices.parse(key, v, listOf("phone", "sd")) != null) v else def
            }
        }
    }

    /** Keep [value] (already checked by [PhoneChoices.parse]) for [key]. */
    fun setChoice(c: Context, key: String, value: Any) {
        val e = of(c).edit()
        when (value) {
            is Boolean -> e.putBoolean(key, value)
            is Int -> e.putInt(key, value)
            else -> e.putString(key, value.toString())
        }
        e.apply()
    }

    /** The quality hello asks for on the way of [kind]: home's at home, away's over the tailnet. */
    fun helloQuality(c: Context, kind: Way.Kind?): String = choice(c, PhoneChoices.streamKey(kind)) as String

    /** Follow changes to what is kept (the listener must be held: SharedPreferences keeps it weakly). */
    fun listen(c: Context, l: SharedPreferences.OnSharedPreferenceChangeListener) = of(c).registerOnSharedPreferenceChangeListener(l)

    fun unlisten(c: Context, l: SharedPreferences.OnSharedPreferenceChangeListener) = of(c).unregisterOnSharedPreferenceChangeListener(l)

    /** The connect screen's choice: the server, the phone's name, and one quality for home and away both. */
    fun save(c: Context, server: String, name: String, quality: String) {
        val q = if (quality == LOSSLESS) LOSSLESS else OPUS
        of(c).edit()
            .putString(SERVER, server)
            .putString(NAME, name.trim().ifEmpty { Build.MODEL })
            .putString(PhoneChoices.HOME_QUALITY, q)
            .putString(PhoneChoices.AWAY_QUALITY, q)
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

    /** The app's log is collected (Settings → Setup → Logging, §4.13; off by default). */
    fun logging(c: Context): Boolean = of(c).getBoolean(LOGGING, false)

    fun setLogging(c: Context, on: Boolean) { of(c).edit().putBoolean(LOGGING, on).apply() }

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
