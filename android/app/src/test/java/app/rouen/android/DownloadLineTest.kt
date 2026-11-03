package app.rouen.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * One download at a time, and Remove (dev/design/android-app.md §4.19, v1.9.72-t30). The owner, 2026-10-30: "the
 * remove button failed but removing the snow patrol album did remove both" — Kodaline's removal was queued behind
 * Snow Patrol's download on the one download thread, and ran only when that download was stopped by its own Remove.
 */
class DownloadLineTest {
    @Test fun THE_ONE_removingAnAlbumNotDownloadingDoesNotWaitBehindTheOneThatIs() {
        val line = DownloadLine(Executors.newSingleThreadScheduledExecutor())
        val going = CountDownLatch(1)
        val release = CountDownLatch(1)
        line.run("snow-patrol") { going.countDown(); release.await(5, TimeUnit.SECONDS) }
        assertTrue(going.await(5, TimeUnit.SECONDS))
        val deleted = AtomicBoolean(false)
        line.remove("kodaline") { deleted.set(true) }
        assertTrue("removed at once, not after Snow Patrol's download", deleted.get())
        assertFalse("and Snow Patrol's download goes on", line.cancelled("snow-patrol"))
        release.countDown()
    }

    @Test fun removingTheAlbumDownloadingStopsItAndRemovesItOnceItHasLetGo() {
        val line = DownloadLine(Executors.newSingleThreadScheduledExecutor())
        val going = CountDownLatch(1)
        val sawStop = AtomicBoolean(false)
        val order = java.util.Collections.synchronizedList(mutableListOf<String>())
        line.run("snow-patrol") {
            going.countDown()
            val until = System.nanoTime() + 5_000_000_000
            while (!line.cancelled("snow-patrol") && System.nanoTime() < until) Thread.sleep(5)
            sawStop.set(line.cancelled("snow-patrol"))
            order += "download stopped"
        }
        assertTrue(going.await(5, TimeUnit.SECONDS))
        val removed = CountDownLatch(1)
        line.remove("snow-patrol") { order += "removed"; removed.countDown() }
        assertTrue(removed.await(5, TimeUnit.SECONDS))
        assertTrue("the download saw it was stopped", sawStop.get())
        assertEquals(listOf("download stopped", "removed"), order.toList())
    }

    @Test fun anAlbumAskedForAgainAfterARemoveIsNotStillStopped() {
        val line = DownloadLine(Executors.newSingleThreadScheduledExecutor())
        line.remove("kodaline") {}
        line.asked("kodaline")
        assertFalse(line.cancelled("kodaline"))
    }

    /**
     * The owner's log, 2026-10-30: downloading, the app went to the background, its player service stopped, and five
     * seconds later Android cut the app's network ("Software caused connection abort"), until the app was opened again.
     * Downloads hold a foreground service of their own while there is anything to do: busy once, when the first comes;
     * idle once, when the last (a retry's wait among them) is done.
     */
    @Test fun THE_ONE_forTheForegroundService_busyWhileAnythingIsToDoIdleWhenNothingIs() {
        val said = java.util.Collections.synchronizedList(mutableListOf<String>())
        val idle = CountDownLatch(1)
        val line = DownloadLine(Executors.newSingleThreadScheduledExecutor(), busy = { said += "busy" }, idle = { said += "idle"; idle.countDown() })
        val release = CountDownLatch(1)
        line.run("a") { release.await(5, TimeUnit.SECONDS) }
        line.run("b") {}
        line.later("c", 0) {}
        assertEquals(listOf("busy"), said.toList())
        release.countDown()
        assertTrue(idle.await(5, TimeUnit.SECONDS))
        Thread.sleep(50)
        assertEquals(listOf("busy", "idle"), said.toList())
        line.run("d") {}
        Thread.sleep(200)
        assertEquals("busy again for the next", listOf("busy", "idle", "busy", "idle"), said.toList())
    }
}
