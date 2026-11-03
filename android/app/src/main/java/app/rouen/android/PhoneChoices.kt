package app.rouen.android

/**
 * The phone's settings that Rouen's page shows inside the app (`window.RouenPhone`, [RouenPhone]):
 * streaming quality at home and away, and the download settings, kept for when downloads are
 * built (dev/design/android-app.md §4.6, §4.8). As Mandarin's app has them (meltface-80/Mandarin:
 * android/app/.../DownloadsBridge.kt, DownloadStore.Settings).
 *
 * Which keys and values there are, free of Android so it is tested on the JVM (src/test).
 */
object PhoneChoices {
    const val HOME_QUALITY = "homeQuality"
    const val AWAY_QUALITY = "awayQuality"
    const val DOWNLOAD_QUALITY = "downloadQuality"
    const val DOWNLOAD_LOCATION = "downloadLocation"
    const val DOWNLOAD_WIFI_ONLY = "downloadWifiOnly"
    const val DOWNLOAD_LIMIT_GB = "downloadLimitGb"

    val KEYS = listOf(HOME_QUALITY, AWAY_QUALITY, DOWNLOAD_QUALITY, DOWNLOAD_LOCATION, DOWNLOAD_WIFI_ONLY, DOWNLOAD_LIMIT_GB)

    /** Streaming: Opus 256 kbps at 48 kHz (the default, the owner's), or lossless (FLAC at the source's rate). */
    val STREAM = listOf("opus", "lossless")
    /** Downloads: the files as they are (the default), or Opus 256. */
    val DOWNLOAD = listOf("original", "opus")
    /** The download size limit in GB; 0 is none. */
    val LIMITS_GB = listOf(0, 8, 16, 32, 64, 128, 256)

    /** Every setting as it is when never set. */
    val DEFAULTS: Map<String, Any> = mapOf(
        HOME_QUALITY to "opus",
        AWAY_QUALITY to "opus",
        DOWNLOAD_QUALITY to "original",
        DOWNLOAD_LOCATION to "phone",
        DOWNLOAD_WIFI_ONLY to true,
        DOWNLOAD_LIMIT_GB to 0
    )

    /**
     * [value] (as the page sends it: text) for [key], as it is kept: a String, a Boolean or an Int.
     * Null for an unknown key or a value it cannot take. [places]: the places to save to on this
     * phone now ("phone", and "sd" when there is a card).
     */
    fun parse(key: String, value: String, places: Collection<String>): Any? = when (key) {
        HOME_QUALITY, AWAY_QUALITY -> value.takeIf { it in STREAM }
        DOWNLOAD_QUALITY -> value.takeIf { it in DOWNLOAD }
        DOWNLOAD_LOCATION -> value.takeIf { it in places }
        DOWNLOAD_WIFI_ONLY -> when (value) { "true" -> true; "false" -> false; else -> null }
        DOWNLOAD_LIMIT_GB -> value.trim().toIntOrNull()?.takeIf { it in LIMITS_GB }
        else -> null
    }

    /** Why [parse] said no, in words for the page. */
    fun refusal(key: String, value: String): String =
        if (key !in KEYS) "unknown setting: $key" else "$key cannot be \"$value\""

    /** The streaming quality key for the way in use: home's at home, away's over the tailnet. */
    fun streamKey(kind: Way.Kind?): String = if (kind == null || kind == Way.Kind.HOME) HOME_QUALITY else AWAY_QUALITY

    /** The page's word for where the phone is: home, away, or offline (no way to Rouen decided). */
    fun network(kind: Way.Kind?, hasNetwork: Boolean): String = when {
        !hasNetwork || kind == null -> "offline"
        kind == Way.Kind.HOME -> "home"
        else -> "away"
    }
}
