package app.rouen.android

import org.json.JSONObject
import java.io.File
import java.net.URLEncoder

/**
 * A GET /api/phone/album answer turned into the [DownloadStore.Album] that [LocalPlay] streams from Rouen's file route,
 * for the away-direct play (dev/design/android-app.md §4.20; [RouenPhone.playLibrary]). Away from home the phone plays
 * your own library files direct, streamed from Rouen over Tailscale, rather than through Roon.
 */
object PhoneAlbum {
    /**
     * The album, or null when the JSON ({"title","artist","image_key","tracks":[{"n","title","disc","track","length"}]})
     * has no title or no tracks. [quality] is the away streaming quality setting; its tracks are streamed from Rouen's
     * file route, which [PlayerService]'s data source rebases to the address in use and gives the login.
     */
    fun from(json: JSONObject, quality: String, filesDir: File): DownloadStore.Album? {
        val title = json.optString("title").trim()
        val artist = json.optString("artist").trim()
        val arr = json.optJSONArray("tracks") ?: return null
        if (title.isEmpty() || arr.length() == 0) return null
        val enc = { s: String -> URLEncoder.encode(s, "UTF-8") }
        val fileQuality = if (quality == Prefs.LOSSLESS) "original" else "opus"
        val stream = "/api/phone/album/file?title=${enc(title)}&artist=${enc(artist)}&quality=$fileQuality"
        val tracks = (0 until arr.length()).map { i ->
            val t = arr.getJSONObject(i)
            DownloadStore.Track(t.optInt("n", i + 1), t.optString("title"), t.optInt("disc", 1), t.optInt("track"),
                t.optInt("length"), 0L, "", "", done = true)
        }
        return DownloadStore.Album(DownloadPlan.key(title, artist), title, artist, json.optString("image_key"), quality,
            "done", tracks, "", System.currentTimeMillis(), filesDir, stream)
    }
}
