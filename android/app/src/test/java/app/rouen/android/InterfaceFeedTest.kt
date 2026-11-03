package app.rouen.android

import org.junit.Assert.assertEquals
import org.junit.Test

/** The interface list handed to the engine only when it changed, at most once in ten seconds (InterfaceFeed.kt). */
class InterfaceFeedTest {
    private var now = 1_000_000L
    private val feed = InterfaceFeed { now }

    @Test fun `the first list is sent, the same list again is not`() {
        assertEquals(InterfaceFeed.Action.Send, feed.offer("wlan0"))
        now += 60_000
        assertEquals(InterfaceFeed.Action.Skip, feed.offer("wlan0"))
    }

    @Test fun `a change within ten seconds waits for the rest of the gap`() {
        assertEquals(InterfaceFeed.Action.Send, feed.offer("wlan0"))
        now += 4_000
        assertEquals(InterfaceFeed.Action.Later(6_000), feed.offer("rmnet0"))
        now += 6_000
        assertEquals(InterfaceFeed.Action.Send, feed.offer("rmnet0"))
    }

    @Test fun `a new engine is sent the list whatever came before`() {
        assertEquals(InterfaceFeed.Action.Send, feed.offer("wlan0"))
        feed.reset()
        assertEquals(InterfaceFeed.Action.Send, feed.offer("wlan0"))
    }
}
