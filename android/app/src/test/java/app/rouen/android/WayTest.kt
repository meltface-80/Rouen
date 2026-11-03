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

    @Test fun `nothing answered is said, never taken for home (the owner, 29 October - no toast, no controls, a black screen)`() {
        assertEquals(Way.Reach.NO, Way.reach(Way.Kind.HOME, homeAnswers = false, engineReached = false))
        assertEquals(Way.Reach.YES, Way.reach(Way.Kind.HOME, homeAnswers = true, engineReached = false))
        assertEquals(Way.Reach.YES, Way.reach(Way.Kind.DIRECT, homeAnswers = false, engineReached = false))
        assertEquals("the engine's last probe reached Rouen", Way.Reach.YES,
            Way.reach(Way.Kind.ENGINE, homeAnswers = false, engineReached = true))
        assertEquals("forwarding or not, Rouen not yet reached through the engine: not loaded on a port that may only hang", Way.Reach.CONNECTING,
            Way.reach(Way.Kind.ENGINE, homeAnswers = false, engineReached = false))
    }

    @Test fun `the screen does not flicker - Rouen lost is told on the second look, the engine's NO stands till its probe`() {
        fun settle(was: Way.Reach?, wasKind: Way.Kind?, found: Way.Reach, kind: Way.Kind, lostBefore: Boolean = false, fresh: Boolean = false) =
            Way.settleReach(was, wasKind, found, kind, lostBefore, fresh)
        assertEquals("one look lost (a Wi-Fi handing over, a slow answer)", Way.Reach.YES,
            settle(Way.Reach.YES, Way.Kind.HOME, Way.Reach.NO, Way.Kind.HOME))
        assertEquals("two looks in a row", Way.Reach.NO, settle(Way.Reach.YES, Way.Kind.HOME, Way.Reach.NO, Way.Kind.HOME, lostBefore = true))
        assertEquals("the first look of a run says what it found", Way.Reach.NO, settle(null, null, Way.Reach.NO, Way.Kind.HOME))
        assertEquals("the engine's NO, a look made by the link's trouble", Way.Reach.NO,
            settle(Way.Reach.NO, Way.Kind.ENGINE, Way.Reach.CONNECTING, Way.Kind.ENGINE))
        assertEquals("the engine's NO, Retry or a new network", Way.Reach.CONNECTING,
            settle(Way.Reach.NO, Way.Kind.ENGINE, Way.Reach.CONNECTING, Way.Kind.ENGINE, fresh = true))
        assertEquals("the engine reached again", Way.Reach.YES, settle(Way.Reach.NO, Way.Kind.ENGINE, Way.Reach.YES, Way.Kind.ENGINE))
        assertEquals("home again", Way.Reach.YES, settle(Way.Reach.NO, Way.Kind.ENGINE, Way.Reach.YES, Way.Kind.HOME))
    }

    @Test fun `why Rouen can't be reached, the first thing to put right first`() {
        fun why(net: Boolean = true, away: Boolean = true, inBuild: Boolean = true, on: Boolean = true, signedIn: Boolean = true,
                tried: Boolean = false, needsLogin: Boolean = false) =
            Way.whyNot(hasNetwork = net, haveAway = away, engineInBuild = inBuild, engineOn = on, signedIn = signedIn,
                engineTried = tried, needsLogin = needsLogin)
        assertEquals("This phone has no network.", why(net = false, signedIn = false))
        assertEquals("Rouen doesn't answer at its home address, and this phone isn't signed in to Tailscale. " +
            "Sign it in: Change server → Away from home → Sign in to Tailscale.", why(signedIn = false))
        assertEquals("Rouen doesn't answer at its home address, and Tailscale on this phone is switched off. " +
            "Switch it on: Change server → Away from home → Use the built-in Tailscale.", why(on = false, signedIn = false))
        assertEquals("Rouen doesn't answer at its home address, and its tailnet address isn't known yet. At home, sign Rouen " +
            "in to Tailscale (Settings → Setup → Away from home): the app learns the address from it.", why(away = false, signedIn = false))
        assertEquals("Rouen doesn't answer at its home address, and this build has no built-in Tailscale: connect a VPN to your tailnet.",
            why(inBuild = false))
        assertEquals("Tailscale on this phone couldn't reach Rouen. Check that Rouen is running and on your tailnet.", why(tried = true))
        assertEquals("Tailscale on this phone needs signing in again: Change server → Away from home → Sign in to Tailscale.",
            why(tried = true, needsLogin = true))
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

    @Test fun `the split head's subnet switch -- on the server's LAN is home, off it is away`() {
        // The phone on the server's /24: home.
        assertEquals(true, Way.sameSubnet("192.168.1.20", listOf("192.168.1.50" to 24)))
        // The phone on another LAN (a cafe, mobile data): away, without asking the home address.
        assertEquals(false, Way.sameSubnet("192.168.1.20", listOf("10.0.0.5" to 24)))
        // Several interfaces, one of them the server's subnet: home.
        assertEquals(true, Way.sameSubnet("192.168.1.20", listOf("10.0.0.5" to 24, "192.168.1.9" to 24)))
        // Tailscale's 100.x interface is up but the server's LAN address is not in it: still away.
        assertEquals(false, Way.sameSubnet("192.168.1.20", listOf("100.101.102.103" to 10)))
        // The prefix matters: a /24 excludes a neighbour the /16 would include.
        assertEquals(false, Way.sameSubnet("192.168.2.20", listOf("192.168.1.9" to 24)))
        assertEquals(true, Way.sameSubnet("192.168.2.20", listOf("192.168.1.9" to 16)))
        // Can't be told: a named server, or no IPv4 interface -> null, so home falls back to the probe.
        assertNull(Way.sameSubnet("rouen.local", listOf("192.168.1.9" to 24)))
        assertNull(Way.sameSubnet("192.168.1.20", emptyList()))
    }

    @Test fun `inSubnet and ipv4 -- the masks and the parse`() {
        assertEquals(true, Way.inSubnet(Way.ipv4("192.168.1.20")!!, Way.ipv4("192.168.1.0")!!, 24))
        assertEquals(false, Way.inSubnet(Way.ipv4("192.168.2.20")!!, Way.ipv4("192.168.1.0")!!, 24))
        assertEquals("prefix 0 is everything", true, Way.inSubnet(Way.ipv4("8.8.8.8")!!, Way.ipv4("1.2.3.4")!!, 0))
        assertEquals("prefix 32 is the one host", false, Way.inSubnet(Way.ipv4("1.2.3.5")!!, Way.ipv4("1.2.3.4")!!, 32))
        assertNull(Way.ipv4("rouen.local"))
        assertNull(Way.ipv4("192.168.1"))
        assertNull(Way.ipv4("192.168.1.256"))
        assertEquals(Way.ipv4("255.255.255.255"), -1)
    }
}
