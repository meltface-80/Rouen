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
 * (Settings → Streaming & downloads → Save to): no permission is needed, and Android removes them with the app. Or in
 * a folder of the owner's choosing (v1.9.72-t34), with All files access: albums there outlive the app, and a reinstall
 * pointed at the same folder finds them. Albums are read from every place, so changing where new ones go hides none.
 */
object DownloadStore {
    data class Track(val n: Int, val title: String, val disc: Int, val track: Int, val length: Int, val bytes: Long,
                     val ext: String, val file: String, val done: Boolean)

    /** state: queued, downloading, waiting (for Wi-Fi or for Rouen), done, failed. */
    data class Album(val key: String, val title: String, val artist: String, val imageKey: String, val quality: String,
                     val state: String, val tracks: List<Track>, val error: String, val added: Long, val dir: File,
                     /**
                      * A library album streamed from Rouen rather than downloaded (the split head, §4.20, v1.9.72-t36):
                      * the file route's address up to its n ("/api/phone/album/file?title=…&artist=…&quality=…"), so a
                      * track's audio is "$stream&n=<n>". Null for a downloaded album, whose tracks are files in [dir].
                      */
                     val stream: String? = null) {
        val doneCount: Int get() = tracks.count { it.done }
        /** What the album takes on the phone now. */
        fun bytesOnPhone(): Long = dir.listFiles()?.sumOf { it.length() } ?: 0L
    }

    private const val FILE = "album.json"

    /**
     * The folders albums are kept in: the phone's, an SD card's when there is one, and the folder picked for them when
     * it can be written now (v1.9.72-t34, [PhoneFolders]). [where] first ([DownloadFolder.order]).
     */
    private fun roots(c: Context, where: String): List<File> {
        val dirs = c.getExternalFilesDirs("music").filterNotNull().ifEmpty { listOf(File(c.filesDir, "music")) }
        val phone = File(dirs[0], "albums")
        val sd = dirs.getOrNull(1)?.let { File(it, "albums") }
        return DownloadFolder.order(where, phone, sd, PhoneFolders.downloadPlace(c))
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

    /** The album for the page (RouenPhone.albums, albumState); with [tracks], each track's place, title and length. */
    fun json(a: Album, tracks: Boolean = false): JSONObject {
        val o = JSONObject().put("key", a.key).put("title", a.title).put("artist", a.artist)
            .put("image_key", a.imageKey).put("state", a.state).put("done", a.doneCount).put("total", a.tracks.size)
            .put("quality", a.quality).put("bytes", a.bytesOnPhone()).put("error", a.error)
        if (tracks) {
            val ts = JSONArray()
            for (t in a.tracks) ts.put(JSONObject().put("n", t.n).put("title", t.title).put("disc", t.disc).put("track", t.track).put("length", t.length))
            o.put("tracks", ts)
        }
        return o
    }
}
