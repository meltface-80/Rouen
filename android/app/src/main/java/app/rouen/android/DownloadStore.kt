package app.rouen.android

import android.content.Context
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.File
import java.io.IOException

/**
 * Albums kept on this phone (dev/design/android-app.md §4.19, v1.9.72-t28), as Mandarin's DownloadStore keeps them:
 * each a folder named by its key ([DownloadPlan.key]) holding album.json (the album, its tracks and how far the
 * download has got), cover.jpg, and one file per track. In the app's own storage on the phone, or on an SD card
 * (Settings → Streaming & downloads → Save to): no permission is needed, and Android removes them with the app.
 * Albums are read from both places, so changing where new ones go hides none.
 */
object DownloadStore {
    data class Track(val n: Int, val title: String, val disc: Int, val track: Int, val length: Int, val bytes: Long,
                     val ext: String, val file: String, val done: Boolean)

    /** state: queued, downloading, waiting (for Wi-Fi or for Rouen), done, failed. */
    data class Album(val key: String, val title: String, val artist: String, val imageKey: String, val quality: String,
                     val state: String, val tracks: List<Track>, val error: String, val added: Long, val dir: File) {
        val doneCount: Int get() = tracks.count { it.done }
        /** What the album takes on the phone now. */
        fun bytesOnPhone(): Long = dir.listFiles()?.sumOf { it.length() } ?: 0L
    }

    private const val FILE = "album.json"

    /** The folders albums are kept in: the phone's, and an SD card's when there is one. [where] first. */
    private fun roots(c: Context, where: String): List<File> {
        val dirs = c.getExternalFilesDirs("music").filterNotNull().ifEmpty { listOf(File(c.filesDir, "music")) }
        val phone = File(dirs[0], "albums")
        val sd = dirs.getOrNull(1)?.let { File(it, "albums") }
        return if (where == "sd" && sd != null) listOf(sd, phone) else listOfNotNull(phone, sd)
    }

    /** Where a new album goes, by the setting. */
    fun newDir(c: Context, key: String): File = File(roots(c, Prefs.choice(c, PhoneChoices.DOWNLOAD_LOCATION) as String)[0], key)

    /** Every album on the phone or on its way, newest first. */
    fun all(c: Context): List<Album> = roots(c, "phone").flatMap { r -> r.listFiles()?.toList() ?: emptyList() }
        .mapNotNull { read(it) }.sortedByDescending { it.added }

    fun find(c: Context, key: String): Album? = roots(c, "phone").map { File(it, key) }.firstNotNullOfOrNull { read(it) }

    /** What every album takes on the phone. */
    fun used(c: Context): Long = all(c).sumOf { it.bytesOnPhone() }

    private fun read(dir: File): Album? {
        val f = File(dir, FILE)
        if (!f.isFile) return null
        return try {
            val o = JSONObject(f.readText())
            val ts = o.optJSONArray("tracks") ?: JSONArray()
            val tracks = (0 until ts.length()).map { i ->
                val t = ts.getJSONObject(i)
                Track(t.getInt("n"), t.optString("title"), t.optInt("disc", 1), t.optInt("track"), t.optInt("length"),
                    t.optLong("bytes"), t.optString("ext"), t.optString("file"), t.optBoolean("done"))
            }
            Album(o.getString("key"), o.optString("title"), o.optString("artist"), o.optString("image_key"),
                o.optString("quality", "original"), o.optString("state", "queued"), tracks, o.optString("error"),
                o.optLong("added"), dir)
        } catch (e: JSONException) {
            null   // half-written by an app killed mid-save: not an album; the next save writes it whole
        } catch (e: IOException) {
            null   // unreadable (a card taken out): not listed until it can be read again
        }
    }

    /** Kept whole or not at all: written beside it, then moved over it. */
    fun save(a: Album) {
        val o = JSONObject().put("key", a.key).put("title", a.title).put("artist", a.artist).put("image_key", a.imageKey)
            .put("quality", a.quality).put("state", a.state).put("error", a.error).put("added", a.added)
        val ts = JSONArray()
        for (t in a.tracks) ts.put(JSONObject().put("n", t.n).put("title", t.title).put("disc", t.disc).put("track", t.track)
            .put("length", t.length).put("bytes", t.bytes).put("ext", t.ext).put("file", t.file).put("done", t.done))
        o.put("tracks", ts)
        if (!a.dir.isDirectory && !a.dir.mkdirs()) throw IOException("no room for the album on the phone")
        val tmp = File(a.dir, "$FILE.tmp")
        tmp.writeText(o.toString())
        if (!tmp.renameTo(File(a.dir, FILE))) throw IOException("the album's record couldn't be kept")
    }

    /** The album and its files gone from the phone. */
    fun remove(c: Context, key: String): Boolean = find(c, key)?.dir?.deleteRecursively() ?: false

    /** The album for the page (RouenPhone.downloads, downloadState). */
    fun json(a: Album): JSONObject = JSONObject().put("key", a.key).put("title", a.title).put("artist", a.artist)
        .put("image_key", a.imageKey).put("state", a.state).put("done", a.doneCount).put("total", a.tracks.size)
        .put("quality", a.quality).put("bytes", a.bytesOnPhone()).put("error", a.error)
}
