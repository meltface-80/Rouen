package app.rouen.android

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** The albums This phone streams from Rouen: the library's, and TIDAL's and Qobuz's (dev/design/android-app.md §4.20, §4.22). */
class PhoneAlbumTest {
    private val dir = File("/tmp")
    private fun album(vararg extra: Pair<String, String>): JSONObject {
        val j = JSONObject().put("title", "Low").put("artist", "David Bowie")
            .put("tracks", JSONArray().put(JSONObject().put("n", 1).put("title", "Speed of Life").put("length", 166)))
        for ((k, v) in extra) j.put(k, v)
        return j
    }

    @Test fun THE_ONE_aServiceAlbumStreamsFromTheServiceRoute_byItsService_andId() {
        val a = PhoneAlbum.from(album("service" to "qobuz", "id" to "0060253705364"), "opus", dir)!!
        assertEquals("/api/phone/service/file?service=qobuz&album=0060253705364&quality=opus", a.stream)
        assertEquals("Speed of Life", a.tracks[0].title)
        val t = PhoneAlbum.from(album("service" to "tidal", "id" to "77646290"), Prefs.LOSSLESS, dir)!!
        assertEquals("/api/phone/service/file?service=tidal&album=77646290&quality=original", t.stream)
    }

    @Test fun aServiceAlbumIsNeverTakenForTheLibrarysOrADownloadOfTheSameName() {
        val lib = PhoneAlbum.from(album(), "opus", dir)!!
        val q = PhoneAlbum.from(album("service" to "qobuz", "id" to "1"), "opus", dir)!!
        val t = PhoneAlbum.from(album("service" to "tidal", "id" to "1"), "opus", dir)!!
        assertEquals(DownloadPlan.key("Low", "David Bowie"), lib.key)
        assertNotEquals(lib.key, q.key)
        assertNotEquals(q.key, t.key)
        // The queue's track ids split on '-': a key must never hold one.
        assertTrue(q.key.none { it == '-' })
        assertEquals(q.key to 1, LocalQueue.parse(LocalQueue.id(q.key, 1)))
    }

    @Test fun aLibraryAlbumStreamsAsBefore() {
        val a = PhoneAlbum.from(album(), "opus", dir)!!
        assertEquals("/api/phone/album/file?title=Low&artist=David+Bowie&quality=opus", a.stream)
    }

    @Test fun anUnknownServiceOrNoIdIsNotAnAlbum() {
        assertNull(PhoneAlbum.from(album("service" to "spotify", "id" to "1"), "opus", dir))
        assertNull(PhoneAlbum.from(album("service" to "qobuz"), "opus", dir))
    }
}
