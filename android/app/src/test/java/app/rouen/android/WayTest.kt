package app.rouen.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Home or away, decided (Way.kt): the rules Away follows. */
class WayTest {

    @Test fun `home answers, so home, whatever else there is`() {
        assertEquals(Way.Kind.HOME, Way.choose(homeAnswers = true, haveAway = true, directAnswers = true, engineReady = true))
    }

    @Test fun `away with a VPN that reaches Rouen, so its tailnet address directly, not the engine`() {
        assertEquals(Way.Kind.DIRECT, Way.choose(homeAnswers = false, haveAway = true, directAnswers = true, engineReady = true))
    }

    @Test fun `away with no VPN, the built-in engine, once signed in and with an address to forward to`() {
        assertEquals(Way.Kind.ENGINE, Way.choose(homeAnswers = false, haveAway = true, directAnswers = false, engineReady = true))
        assertEquals("not signed in", Way.Kind.HOME, Way.choose(homeAnswers = false, haveAway = true, directAnswers = false, engineReady = false))
        assertEquals("no tailnet address", Way.Kind.HOME, Way.choose(homeAnswers = false, haveAway = false, directAnswers = false, engineReady = true))
    }

    @Test fun `three misses before away at home on Wi-Fi, one otherwise`() {
        assertEquals(3, Way.looksBeforeAway(wasAway = false, onWifi = true))
        assertEquals(1, Way.looksBeforeAway(wasAway = true, onWifi = true))
        assertEquals(1, Way.looksBeforeAway(wasAway = false, onWifi = false))
    }

    @Test fun `the engine is started afresh at most once in three minutes`() {
        assertTrue(Way.mayRestartEngine(now = 5_000, last = 0))
        assertFalse(Way.mayRestartEngine(now = 100_000, last = 1_000))
        assertTrue(Way.mayRestartEngine(now = 181_000, last = 1_000))
    }

    @Test fun `the tailnet name is rouen- and the phone's name, lowercased, other characters made -`() {
        assertEquals("rouen-pixel-8-pro", Way.hostname("Pixel 8 Pro"))
        assertEquals("rouen-owner-s-phone", Way.hostname("Owner's Phone"))
        assertEquals("rouen-caf-", Way.hostname("Café"))
        assertEquals(63, Way.hostname("x".repeat(100)).length)
    }

    @Test fun `addresses as typed or as Rouen gives them`() {
        assertEquals("100.101.102.103:3399", Way.parseAddress("http://100.101.102.103:3399"))
        assertEquals("100.101.102.103:3399", Way.parseAddress("http://100.101.102.103:3399/"))
        assertEquals("192.168.1.20:3399", Way.parseAddress("192.168.1.20"))
        assertEquals("rouen.local:8080", Way.parseAddress(" rouen.local:8080 "))
        assertNull(Way.parseAddress(null))
        assertNull(Way.parseAddress(""))
        assertNull(Way.parseAddress("host:99999"))
        assertNull(Way.parseAddress("a b"))
    }

    @Test fun `tailnet addresses are 100_64_0_0 slash 10 and ts_net names only`() {
        assertTrue(Way.isTailnet("100.101.102.103:3399"))
        assertTrue(Way.isTailnet("100.64.0.1:3399"))
        assertTrue(Way.isTailnet("100.127.255.255:3399"))
        assertTrue(Way.isTailnet("rouen.tail1234.ts.net:3399"))
        assertFalse(Way.isTailnet("100.63.0.1:3399"))
        assertFalse(Way.isTailnet("100.128.0.1:3399"))
        assertFalse(Way.isTailnet("192.168.1.20:3399"))
        assertFalse(Way.isTailnet("rouen.local:3399"))
    }

    @Test fun `the login is read out of a Cookie header`() {
        assertEquals("abc", Way.sessionValue("rouen_session=abc"))
        assertEquals("abc", Way.sessionValue("theme=dark; rouen_session=abc; other=1"))
        assertNull(Way.sessionValue("theme=dark"))
        assertNull(Way.sessionValue("rouen_session="))
        assertNull(Way.sessionValue(null))
        assertNull(Way.sessionValue("x_rouen_session=abc"))
    }

    @Test fun `on a switch the login in use follows the phone`() {
        assertEquals("new", Way.carry(fromValue = "new", targetValue = "old", fallbacks = listOf("home")))
        assertEquals("new", Way.carry(fromValue = "new", targetValue = null, fallbacks = emptyList()))
        assertNull("already there", Way.carry(fromValue = "same", targetValue = "same", fallbacks = listOf("home")))
    }

    @Test fun `on a first look an origin keeps its own login, and one with none takes home's`() {
        assertNull(Way.carry(fromValue = null, targetValue = "newer", fallbacks = listOf("older")))
        assertEquals("home", Way.carry(fromValue = null, targetValue = null, fallbacks = listOf(null, "home", "away")))
        assertNull(Way.carry(fromValue = null, targetValue = null, fallbacks = listOf(null, null)))
    }

    @Test fun `the engine is kept away and while playing, stopped after two idle minutes at home`() {
        var now = 1_000_000L
        val idle = Way.EngineIdle { now }
        assertEquals(Way.EngineIdle.Verdict.KEEP, idle.verdict(away = true, inUse = false))
        assertEquals(Way.EngineIdle.Verdict.WAIT, idle.verdict(away = false, inUse = false))
        now += Way.EngineIdle.GRACE_MS - 1
        assertEquals(Way.EngineIdle.Verdict.WAIT, idle.verdict(away = false, inUse = false))
        assertEquals(1L, idle.remaining())
        assertEquals("playing starts the grace over", Way.EngineIdle.Verdict.KEEP, idle.verdict(away = false, inUse = true))
        now += 1
        assertEquals(Way.EngineIdle.Verdict.WAIT, idle.verdict(away = false, inUse = false))
        now += Way.EngineIdle.GRACE_MS
        assertEquals(Way.EngineIdle.Verdict.STOP, idle.verdict(away = false, inUse = false))
    }
}
