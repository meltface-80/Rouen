package app.rouen.android

import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/** This phone's plays kept until Rouen has them (dev/design/android-app.md §4.22, v1.9.72-t57). */
class PendingPlaysTest {
    @get:Rule val tmp = TemporaryFolder()

    private fun play(n: Int) = PlayLog.Play("Low", "David Bowie", "t$n", n, 10.0 + n, 1_000L + n)

    @Test fun THE_ONE_playsAreKeptAcrossARestart_untilSent() {
        val f = File(tmp.root, "plays.json")
        val p = PendingPlays(f) {}
        p.add(play(1))
        p.add(play(2))
        p.add(play(3))
        val again = PendingPlays(f) {}
        val sent = again.first(2)
        assertEquals(listOf(play(1), play(2)), sent)
        again.drop(sent)
        assertEquals(listOf(play(3)), PendingPlays(f) {}.first(10))
    }

    @Test fun exactlyThePlaysSentGo_notTheFirstSoMany() {
        val f = File(tmp.root, "plays.json")
        val p = PendingPlays(f) {}
        p.add(play(1))
        p.add(play(2))
        val sent = p.first(2)
        // While they are on their way, the oldest go (the list full) and a new one comes.
        p.drop(listOf(sent[0]))
        p.add(play(3))
        p.drop(sent)
        assertEquals(listOf(play(3)), PendingPlays(f) {}.first(10))
    }

    @Test fun aPlayRouenWouldRefuseIsNeverKept_soNoBatchIsRefusedForIt() {
        val said = mutableListOf<String>()
        val p = PendingPlays(File(tmp.root, "plays.json")) { said.add(it) }
        p.add(PlayLog.Play("Low", " ", "Speed of Life", 0, 30.0, 1_000L))   // no artist
        p.add(PlayLog.Play("Low", "David Bowie", "Speed of Life", 1000, 30.0, 1_000L))
        p.add(PlayLog.Play("Low", "David Bowie", "Speed of Life", 0, 7 * 3600.0, 1_000L))
        p.add(play(1))
        assertEquals(listOf(play(1)), p.first(10))
        assertEquals(3, said.size)
    }

    @Test fun aFileThatCantBeReadStartsAfresh_andSaysSo() {
        val f = File(tmp.root, "plays.json")
        f.writeText("[{\"album\": \"Lo")
        val said = mutableListOf<String>()
        val p = PendingPlays(f) { said.add(it) }
        assertEquals(0, p.size())
        assertEquals(1, said.size)
    }

    @Test fun eachPlayIsSentAsRouenTakesIt() {
        val j = PendingPlays.json(play(1))
        assertEquals("Low", j.getString("album"))
        assertEquals("David Bowie", j.getString("artist"))
        assertEquals("t1", j.getString("track"))
        assertEquals(1, j.getInt("index"))
        assertEquals(11.0, j.getDouble("elapsed"), 0.0)
        assertEquals(1_001L, j.getLong("at"))
    }
}
