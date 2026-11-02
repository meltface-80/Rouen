package app.rouen.android

import org.json.JSONObject
import java.io.File
import java.net.URLEncoder

/**
 * A GET /api/phone/album answer turned into the [DownloadStore.Album] that [LocalPlay] streams from Rouen's file route,
 * for the away-direct play (dev/design/android-app.md §4.20; [RouenPhone.playLibrary]). Away from home the phone plays
 * your own library files direct, streamed from Rouen over Tailscale, rather than through Roon.
 *
 * A TIDAL or Qobuz album (§4.22, "TIDAL and Qobuz", slice 3) comes the same way, with its `service` and the service's
 * album `id`: Rouen fetches each track's audio itself, with its own sign-in, and serves it from
 * `/api/phone/service/file?service&album&n&quality` — the library file route's contract, so it plays exactly as a
 * library album does. Its key is made from the service and the id, never from the title, so it can't be taken for a
 * library album or a download of the same name.
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
        // A TIDAL or Qobuz album: one of the two services, with the service's album id; anything else isn't one.
        val service = json.optString("service").trim()
        val serviceId = json.optString("id").trim()
        if (service.isNotEmpty() && (service !in SERVICES || serviceId.isEmpty())) return null
        val stream = if (service.isNotEmpty()) "/api/phone/service/file?service=$service&album=${enc(serviceId)}&quality=$fileQuality"
            else "/api/phone/album/file?title=${enc(title)}&artist=${enc(artist)}&quality=$fileQuality"
        val key = if (service.isNotEmpty()) DownloadPlan.key("$service:$serviceId", "") else DownloadPlan.key(title, artist)
        val tracks = (0 until arr.length()).map { i ->
            val t = arr.getJSONObject(i)
            DownloadStore.Track(t.optInt("n", i + 1), t.optString("title"), t.optInt("disc", 1), t.optInt("track"),
                t.optInt("length"), 0L, "", "", done = true)
        }
        return DownloadStore.Album(key, title, artist, json.optString("image_key"), quality,
            "done", tracks, "", System.currentTimeMillis(), filesDir, stream)
    }

    /** The services This phone plays through Rouen's own sign-in (§4.22). */
    val SERVICES = setOf("qobuz", "tidal")
}
