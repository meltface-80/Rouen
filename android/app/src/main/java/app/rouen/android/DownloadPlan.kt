package app.rouen.android

import java.net.URLEncoder
import java.security.MessageDigest

/**
 * The rules of a download from Rouen to the phone (dev/design/android-app.md §4.19, v1.9.72-t28), free of Android so
 * they are tested on the JVM (src/test): the album's key, its tracks' file names, how a stopped track resumes, and
 * the size limit. [Downloader] and [DownloadStore] do the rest.
 */
object DownloadPlan {
    /** Opus 256 kbps: 32,000 bytes a second, which is what a track made as Opus takes, near enough. */
    const val OPUS_BYTES_PER_SECOND = 32_000L

    /**
     * An album's key: its own folder on the phone, and how the page and the app name it to each other. The album's
     * artist and title as Rouen gives them, so the same album is the same key from any screen.
     */
    fun key(title: String, artist: String): String {
        val d = MessageDigest.getInstance("SHA-1").digest((artist.trim().lowercase() + "\n" + title.trim().lowercase()).toByteArray(Charsets.UTF_8))
        return d.take(10).joinToString("") { "%02x".format(it) }
    }

    /** The album as Rouen's download routes name it (lib/phone/downloads.js). */
    fun query(title: String, artist: String): String = "title=" + enc(title) + "&artist=" + enc(artist)

    /** Track [n]'s file, as Rouen sends it: the ending its file has, or .ogg for Opus. */
    fun trackName(n: Int, ext: String, quality: String): String =
        "%03d".format(n) + "." + (if (quality == "opus") "ogg" else safeExt(ext))

    /** An ending Rouen gave, made safe for a file name. */
    fun safeExt(ext: String): String = ext.lowercase().filter { it in 'a'..'z' || it in '0'..'9' }.take(5).ifEmpty { "bin" }

    /** What to ask for a track already [have] bytes into: the rest (Opus is made as it is sent, so it starts again). */
    fun range(have: Long, quality: String): String? = if (have > 0 && quality != "opus") "bytes=$have-" else null

    enum class Answer { APPEND, RESTART, WHOLE, FAIL }

    /** What Rouen's answer [code] means for a track [have] bytes into, having asked [range]. */
    fun answer(code: Int, range: String?): Answer = when {
        code == 206 && range != null -> Answer.APPEND
        code == 200 -> Answer.RESTART   // the whole file, from its start: what was had is thrown away
        code == 416 && range != null -> Answer.WHOLE   // nothing left to send: what was had is the track
        else -> Answer.FAIL
    }

    /** Roughly how many bytes an album takes as [quality]: the files' own sizes, or Opus's rate over their lengths. */
    fun estimate(bytes: List<Long>, lengths: List<Int>, quality: String): Long =
        if (quality == "opus") lengths.sumOf { it.toLong() * OPUS_BYTES_PER_SECOND } else bytes.sum()

    /** Whether [need] more bytes stay within the limit of [limitGb] GB (0: none), with [used] already taken. */
    fun fits(limitGb: Int, used: Long, need: Long): Boolean = limitGb <= 0 || used + need <= limitGb.toLong() * (1L shl 30)

    private fun enc(s: String): String = URLEncoder.encode(s, "UTF-8").replace("+", "%20")
}
