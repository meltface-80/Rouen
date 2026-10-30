package app.rouen.android

import java.util.Base64

/**
 * The share card as the page hands it to the app (dev/design/android-app.md §4.17, v1.9.72-t22): its PNG as base64,
 * and the name the page gave it. Free of Android, so it is tested on the JVM (src/test).
 */
object CardFile {
    /** Larger than any card the page draws (1200 by about 1500, a PNG of 1 to 3 MB), so a runaway page is refused. */
    const val MAX_BYTES = 16 * 1024 * 1024

    private val PNG = byteArrayOf(0x89.toByte(), 'P'.code.toByte(), 'N'.code.toByte(), 'G'.code.toByte())

    /** The page's base64 as a PNG's bytes; null when it is not base64, not a PNG, or too big. */
    fun decode(base64: String?): ByteArray? {
        if (base64.isNullOrEmpty() || base64.length > MAX_BYTES / 3 * 4 + 4) return null
        val bytes = try { Base64.getMimeDecoder().decode(base64) } catch (e: IllegalArgumentException) { return null }
        if (bytes.size < PNG.size || bytes.size > MAX_BYTES) return null
        for (i in PNG.indices) if (bytes[i] != PNG[i]) return null
        return bytes
    }

    /** The page names the file; it must not choose the folder, nor anything but a .png. */
    fun safeName(raw: String?): String {
        val base = (raw ?: "").substringAfterLast('/').substringAfterLast('\\')
            .replace(Regex("[^A-Za-z0-9._-]"), "_")
            .trimStart('.')
            .removeSuffix(".png")
            .take(90)
        return (base.ifEmpty { "card" }) + ".png"
    }
}
