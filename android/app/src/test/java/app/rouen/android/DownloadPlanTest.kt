package app.rouen.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The rules of a download from Rouen to the phone (dev/design/android-app.md §4.19, v1.9.72-t28). */
class DownloadPlanTest {
    @Test fun theKeyIsTheAlbumWhicheverScreenNamesIt() {
        val k = DownloadPlan.key("Western Stars", "Bruce Springsteen")
        assertEquals(20, k.length)
        assertTrue(k.all { it in '0'..'9' || it in 'a'..'f' })
        assertEquals(k, DownloadPlan.key(" western stars ", "BRUCE SPRINGSTEEN"))
        assertNotEquals(k, DownloadPlan.key("Western Stars", "Someone Else"))
        // The artist and the title are not run together: "A" + "BC" is not "AB" + "C".
        assertNotEquals(DownloadPlan.key("BC", "A"), DownloadPlan.key("C", "AB"))
    }

    @Test fun theRoutesQueryCarriesAnyTitle() {
        assertEquals("title=Hello%2C%20World%20%26%20Co&artist=A%2FB", DownloadPlan.query("Hello, World & Co", "A/B"))
    }

    @Test fun eachTrackIsItsPlaceAndItsEnding() {
        assertEquals("001.flac", DownloadPlan.trackName(1, "FLAC", "original"))
        assertEquals("012.ogg", DownloadPlan.trackName(12, "flac", "opus"))
        assertEquals("003.bin", DownloadPlan.trackName(3, "../..", "original"))
        assertEquals("004.m4a", DownloadPlan.trackName(4, "m4a", "original"))
    }

    @Test fun THE_ONE_aStoppedTrackResumesWhereItStopped() {
        assertEquals("bytes=5000-", DownloadPlan.range(5000, "original"))
        assertNull(DownloadPlan.range(0, "original"))
        assertNull("Opus is made as it is sent: it starts again", DownloadPlan.range(5000, "opus"))
        assertEquals(DownloadPlan.Answer.APPEND, DownloadPlan.answer(206, "bytes=5000-"))
        assertEquals(DownloadPlan.Answer.RESTART, DownloadPlan.answer(200, "bytes=5000-"))
        assertEquals(DownloadPlan.Answer.RESTART, DownloadPlan.answer(200, null))
        assertEquals(DownloadPlan.Answer.WHOLE, DownloadPlan.answer(416, "bytes=5000-"))
        assertEquals(DownloadPlan.Answer.FAIL, DownloadPlan.answer(416, null))
        assertEquals(DownloadPlan.Answer.FAIL, DownloadPlan.answer(404, null))
        assertEquals("a 206 not asked for is not appended", DownloadPlan.Answer.FAIL, DownloadPlan.answer(206, null))
    }

    @Test fun theSizeLimit() {
        val gb = 1L shl 30
        assertTrue(DownloadPlan.fits(0, 500 * gb, 500 * gb))
        assertTrue(DownloadPlan.fits(8, 7 * gb, gb))
        assertFalse(DownloadPlan.fits(8, 7 * gb, gb + 1))
        assertEquals(30_000L, DownloadPlan.estimate(listOf(10_000, 20_000), listOf(100, 200), "original"))
        assertEquals(300 * DownloadPlan.OPUS_BYTES_PER_SECOND, DownloadPlan.estimate(listOf(10_000, 20_000), listOf(100, 200), "opus"))
    }

    /**
     * The owner, 2026-10-30, after t30: "Downloads not fixed or working correctly". The log: every download asked for
     * the album's cover first, Roon (through Rouen's /api/image) didn't answer, and the cover's 30 s timeout failed the
     * whole album, again and again, before a single track. The tracks are Rouen's own files and never needed Roon.
     */
    @Test fun THE_ONE_aCoverThatDoesNotComeStopsNoTrack() {
        val did = mutableListOf<String>()
        var failed: Exception? = null
        val whole = DownloadPlan.steps(
            tracks = { did += "tracks"; true },
            cover = { did += "cover"; throw java.net.SocketTimeoutException("timeout") },
            coverFailed = { failed = it })
        assertTrue("the album is whole without its cover", whole)
        assertEquals("the tracks first, then the cover", listOf("tracks", "cover"), did)
        assertTrue(failed is java.net.SocketTimeoutException)
    }

    @Test fun anAlbumRemovedPartWayAsksForNoCover() {
        val did = mutableListOf<String>()
        assertFalse(DownloadPlan.steps(tracks = { did += "tracks"; false }, cover = { did += "cover" }, coverFailed = {}))
        assertEquals(listOf("tracks"), did)
    }

    @Test fun aTrackThatFailsStillFailsTheRunForItsRetry() {
        try {
            DownloadPlan.steps(tracks = { throw java.io.IOException("connection abort") }, cover = {}, coverFailed = {})
            throw AssertionError("a track's failure must reach the retry")
        } catch (e: java.io.IOException) {
            assertEquals("connection abort", e.message)
        }
    }
}
