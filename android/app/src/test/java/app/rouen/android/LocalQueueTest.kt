package app.rouen.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The phone's own play (dev/design/android-app.md §4.19, v1.9.72-t32). */
class LocalQueueTest {
    /**
     * The owner, 2026-10-30: "When I went back online during playing the album it stopped playback". The log, 23:05:25:
     * the phone reached Rouen again, Rouen sent its hello's volume and stop, and the player obeyed the stop.
     */
    @Test fun THE_ONE_backOnlineRoonsStopVolumePauseAndPlayLeaveThePhonesOwnPlayAlone() {
        for (op in listOf("stop", "volume", "pause", "play")) assertFalse(op, LocalQueue.roonMay(op, local = true))
        assertTrue("Roon starting a stream on the phone takes it back", LocalQueue.roonMay("open", local = true))
        assertFalse("a session Rouen's hello remembers from before is not Roon starting one", LocalQueue.roonMay("open", local = true, replay = true))
        assertTrue("without the phone's own play, it is picked up as before", LocalQueue.roonMay("open", local = false, replay = true))
        for (op in listOf("open", "stop", "volume", "pause", "play")) assertTrue(op, LocalQueue.roonMay(op, local = false))
    }

    @Test fun playNextGoesJustAfterTheTrackPlayingAndQueueAtTheEnd() {
        assertEquals(3, LocalQueue.insertAt(count = 10, current = 2, next = true))
        assertEquals(10, LocalQueue.insertAt(count = 10, current = 2, next = false))
        assertEquals(10, LocalQueue.insertAt(count = 10, current = 9, next = true))
        assertEquals(0, LocalQueue.insertAt(count = 0, current = 0, next = true))
    }

    @Test fun anAlbumsTracksAsEachRequestTakesThem() {
        val done = listOf(1, 2, 4, 5)
        assertEquals("from a downloaded track", listOf(4, 5), LocalQueue.pick(done, 3, "play"))
        assertEquals("from a track not downloaded: the next that is", listOf(4, 5), LocalQueue.pick(done, 2, "play"))
        assertEquals("past the end: the album from its start", done, LocalQueue.pick(done, 9, "play"))
        assertEquals(listOf(2), LocalQueue.pick(done, 1, "track"))
        assertEquals("a track not downloaded: none", emptyList<Int>(), LocalQueue.pick(done, 2, "track"))
        assertEquals(done, LocalQueue.pick(done, 0, "album"))
    }

    @Test fun aQueuedTracksIdCarriesItsAlbumAndNumber() {
        assertEquals("ab12" to 7, LocalQueue.parse(LocalQueue.id("ab12", 7)))
        assertNull(LocalQueue.parse("rouen-session-4"))
        assertNull(LocalQueue.parse(null))
        assertNull(LocalQueue.parse("local--3"))
    }
}
