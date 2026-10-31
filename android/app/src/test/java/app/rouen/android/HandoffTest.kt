package app.rouen.android

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The split-head handoff's track-matching (dev/design/android-app.md §4.20, v1.9.72-t48): which of an album's tracks
 * Roon's now-playing names, so This phone resumes the right one. Pure; the rest of the handoff is device-only.
 */
class HandoffTest {
    private val album = listOf("Intro", "Everything In Its Right Place", "The National Anthem", "How to Disappear Completely")

    @Test fun exactTitleGivesItsIndex() {
        assertEquals(2, Handoff.trackIndex(album, "The National Anthem"))
    }

    @Test fun firstTrackIsZero() {
        assertEquals(0, Handoff.trackIndex(album, "Intro"))
    }

    @Test fun matchIgnoresCaseAndSurroundingSpace() {
        assertEquals(1, Handoff.trackIndex(album, "  everything in its right place "))
    }

    @Test fun noMatchResumesFromTheStart() {
        // A title Roon shows that the /music album doesn't have (a mismatch) still hands the album over, from track 1.
        assertEquals(0, Handoff.trackIndex(album, "Idioteque"))
    }

    @Test fun emptyNowTitleResumesFromTheStart() {
        assertEquals(0, Handoff.trackIndex(album, ""))
    }

    @Test fun theFirstOfTwoAlikeTitlesWins() {
        assertEquals(1, Handoff.trackIndex(listOf("Prelude", "Theme", "Theme"), "Theme"))
    }
}
