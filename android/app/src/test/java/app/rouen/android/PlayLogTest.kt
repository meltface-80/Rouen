package app.rouen.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** This phone's plays, track by track, for the catch-up (dev/design/android-app.md §4.22, v1.9.72-t57). */
class PlayLogTest {
    private val a = PlayLog.Item("k1#1", "Low", "David Bowie", "Speed of Life", 0)
    private val b = PlayLog.Item("k1#2", "Low", "David Bowie", "Breaking Glass", 1)

    private fun log(): Pair<PlayLog, MutableList<PlayLog.Play>> {
        val out = mutableListOf<PlayLog.Play>()
        return PlayLog { out.add(it) } to out
    }

    @Test fun THE_ONE_aTrackIsDoneWhenTheNextPlays_withHowFarItGotAndWhenItBegan() {
        val (log, out) = log()
        log.see(a, 0, 1_000_000)
        log.see(a, 40_000, 1_040_000)
        log.see(a, 165_000, 1_165_000)
        log.see(b, 1_000, 1_166_000)
        assertEquals(listOf(PlayLog.Play("Low", "David Bowie", "Speed of Life", 0, 165.0, 1_000_000)), out)
        log.idle()
        assertEquals(PlayLog.Play("Low", "David Bowie", "Breaking Glass", 1, 1.0, 1_165_000), out[1])
    }

    @Test fun aTrackSkippedStraightPastIsNotAPlay() {
        val (log, out) = log()
        log.see(a, 400, 1_000)
        log.see(b, 0, 2_000)
        assertTrue(out.isEmpty())
    }

    @Test fun seekingBackInATrackIsTheSamePlay_startingItAgainIsANewOne() {
        val (log, out) = log()
        log.see(a, 0, 0)
        log.see(a, 60_000, 60_000)
        log.see(a, 30_000, 61_000)
        assertTrue("a seek back is the same play", out.isEmpty())
        log.see(a, 1_000, 62_000)
        assertEquals(listOf(60.0), out.map { it.elapsed })
        log.idle()
        assertEquals(listOf(60.0, 1.0), out.map { it.elapsed })
        assertEquals(61_000L, out[1].at)
    }

    @Test fun idleTwiceGivesThePlayOnce() {
        val (log, out) = log()
        log.see(a, 5_000, 10_000)
        log.idle()
        log.idle()
        assertEquals(1, out.size)
    }
}
