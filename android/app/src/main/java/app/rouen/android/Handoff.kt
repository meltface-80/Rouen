package app.rouen.android

import org.json.JSONObject
import java.io.File
import java.net.URLEncoder

/**
 * The split-head handoff (dev/design/android-app.md §4.20, v1.9.72-t48): when the phone drops off the server's LAN
 * while the Roon zone ("the Squeezelite") is playing to it, [PlayerService] stops the relay and hands the album, the
 * track and the exact spot to This phone, which resumes on play — direct from your own library files, over Tailscale.
 *
 * Two pieces, kept here so both the away-direct play ([RouenPhone.playLibrary]) and the handoff build the album the
 * same way:
 *  - [fromPhoneAlbum]: a GET /api/phone/album answer turned into the [DownloadStore.Album] LocalPlay streams.
 *  - [trackIndex]: which of the album's tracks Roon's now-playing names, so the handoff resumes the right one. Pure,
 *    JVM-tested ([HandoffTest]); the phone has no track number from /api/phone/now, only the title.
 */
object Handoff {
    /**
     * The album, or null when the JSON ({"title","artist","image_key","tracks":[{"n","title","disc","track","length"}]})
     * has no title or no tracks. [quality] is the away streaming quality setting; its tracks are streamed from Rouen's
     * file route, which [PlayerService]'s data source rebases to the address in use and gives the login.
     */
    fun fromPhoneAlbum(json: JSONObject, quality: String, filesDir: File): DownloadStore.Album? {
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

    /**
     * The 0-based index into [titles] (the album's tracks, in order) of the one Roon shows playing ([nowTitle]), or 0
     * when nothing matches — so the handoff still resumes the album from its start rather than losing it. Matched on
     * the title trimmed and case-folded (the Shelf's matcher is title-first), since /api/phone/now carries no number.
     */
    fun trackIndex(titles: List<String>, nowTitle: String): Int {
        val want = nowTitle.trim().lowercase()
        if (want.isEmpty()) return 0
        val at = titles.indexOfFirst { it.trim().lowercase() == want }
        return if (at >= 0) at else 0
    }
}
