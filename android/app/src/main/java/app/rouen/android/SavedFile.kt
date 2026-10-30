package app.rouen.android

import java.util.Base64

/**
 * A file the page asks the app to save to Downloads/Rouen (dev/design/android-app.md §4.17, v1.9.72-t23): a shared
 * playlist's .musicd, the labels scan log, a backup's .json. Only those kinds, as plain text, and only a plain file
 * name. Free of Android, so it is tested on the JVM (src/test).
 */
object SavedFile {
    /** Larger than any backup Rouen makes (its settings, playlists and keys: well under 1 MB), so a runaway page is refused. */
    const val MAX_BYTES = 32 * 1024 * 1024

    /** What the page may save, by its ending, and the type Android files it under. */
    private val KINDS = mapOf("musicd" to "text/plain", "log" to "text/plain", "txt" to "text/plain", "json" to "application/json")

    /** A file accepted: its name as saved, its type, its bytes. */
    class Accepted(val name: String, val mime: String, val bytes: ByteArray)

    /** The page's file, or null with why not ([refusal]). */
    fun accept(base64: String?, rawName: String?): Accepted? {
        val name = safeName(rawName) ?: return null
        val mime = KINDS[name.substringAfterLast('.').lowercase()] ?: return null
        val bytes = decode(base64) ?: return null
        return Accepted(name, mime, bytes)
    }

    /** Why [accept] refused, in the page's words. */
    fun refusal(base64: String?, rawName: String?): String = when {
        plain(rawName).isEmpty() -> "that file's name can't be saved"
        safeName(rawName) == null -> "the app doesn't save that kind of file"
        decode(base64) == null -> "that file couldn't be read"
        else -> "that file couldn't be saved"
    }

    /** The page's name with no folder and nothing but plain characters, before its ending is looked at. */
    private fun plain(raw: String?): String = (raw ?: "").substringAfterLast('/').substringAfterLast('\\')
        .replace(Regex("[^A-Za-z0-9._-]"), "_")
        .trimStart('.')

    /** The page's base64 as bytes; null when it is not base64 or too big. An empty file is a file. */
    fun decode(base64: String?): ByteArray? {
        if (base64 == null || base64.length > MAX_BYTES / 3 * 4 + 4) return null
        val bytes = try { Base64.getMimeDecoder().decode(base64) } catch (e: IllegalArgumentException) { return null }
        return if (bytes.size > MAX_BYTES) null else bytes
    }

    /**
     * The page names the file; it must not choose the folder. Null when nothing is left of it, or it has no ending of
     * the kinds the app saves.
     */
    fun safeName(raw: String?): String? {
        val name = plain(raw)
        if (name.isEmpty() || !name.contains('.')) return null
        val ext = name.substringAfterLast('.').lowercase()
        if (ext !in KINDS) return null
        val stem = name.substringBeforeLast('.').take(90)
        return if (stem.isEmpty()) null else "$stem.$ext"
    }
}
