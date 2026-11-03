package app.rouen.android

import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The app's ports on 127.0.0.1 (Ports.kt, dev/design/android-app.md §4.7, v1.9.72-t23). The owner, 2026-10-30:
 * "Tailscale connection is intermittent … Mandarin is near perfect all the time. I just cannot connect now using Rouen".
 * Rouen's built-in Tailscale had Mandarin's port: with Mandarin's app on the phone, its engine held it.
 */
class PortsTest {
    @Test fun `THE one - the built-in Tailscale's port is not Mandarin's`() {
        assertNotEquals("Mandarin's engine holds ${Ports.MANDARIN_ENGINE} while Mandarin runs", Ports.MANDARIN_ENGINE, Ports.ENGINE)
    }

    @Test fun `the page's own address is neither`() {
        assertNotEquals(Ports.ENGINE, Ports.PAGE)
        assertNotEquals(Ports.MANDARIN_ENGINE, Ports.PAGE)
    }

    @Test fun `the ones the app uses are Rouen's own constants`() {
        // TailscaleEngine and PageRelay need Android; this pins the values they are given (Ports.ENGINE, Ports.PAGE).
        for (p in listOf(Ports.ENGINE, Ports.PAGE)) assertTrue("$p is an ordinary port", p in 1024..49151)
    }
}
