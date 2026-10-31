package app.rouen.android

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.sin
import kotlin.math.sqrt

/** The same checks as the server's Mandarin DspTest, on the phone's copy of the maths. */
class DspTest {
    private val fs = 48000.0
    private fun at(bands: List<Dsp.Band>, f: Double) = Dsp.responseDb(bands, fs, f)
    private fun near(a: Double, b: Double, tol: Double, what: String) = assertTrue("$what: $a vs $b", abs(a - b) <= tol)

    @Test fun `the bands match the cookbook`() {
        val peak = listOf(Dsp.Band("peak", 1000.0, 6.0, 1.41))
        near(at(peak, 1000.0), 6.0, 0.01, "a +6 dB peak at its centre")
        near(at(peak, 100.0), 0.0, 0.1, "nothing three octaves down")
        val ls = listOf(Dsp.Band("low_shelf", 1000.0, 4.0, 0.707))
        near(at(ls, 30.0), 4.0, 0.05, "a low shelf's full lift below")
        near(at(ls, 15000.0), 0.0, 0.05, "none above")
        val hs = listOf(Dsp.Band("high_shelf", 2000.0, -3.0, 0.707))
        near(at(hs, 18000.0), -3.0, 0.1, "a high shelf's cut at the top")
        val hp = listOf(Dsp.Band("high_pass", 80.0, 0.0, 0.707))
        near(at(hp, 80.0), -3.01, 0.05, "a Butterworth high-pass at its corner")
        assertTrue(at(hp, 20.0) < -20)
        val lp = listOf(Dsp.Band("low_pass", 8000.0, 0.0, 0.707))
        near(at(lp, 8000.0), -3.01, 0.05, "a low-pass likewise")
        near(Dsp.responseDb(peak, 96000.0, 1000.0), 6.0, 0.01, "at 96 kHz too")
    }

    @Test fun `headroom is the combined peak, half a dB under`() {
        val one = Dsp.Setting(true, null, listOf(Dsp.Band("peak", 1000.0, 6.0, 1.41)), null)
        assertEquals(-6.5, Dsp.headroom(one, fs), 0.0)
        val two = Dsp.Setting(true, null, listOf(Dsp.Band("peak", 800.0, 3.0, 0.5), Dsp.Band("peak", 1200.0, 3.0, 0.5)), null)
        val peak = Dsp.peakDb(two.bands, fs)
        assertTrue("overlapping bands add: $peak", peak > 5 && peak < 6)
        assertTrue(Dsp.headroom(two, fs) <= -(peak + 0.5) + 0.05)
        val cuts = Dsp.Setting(true, null, listOf(Dsp.Band("peak", 1000.0, -6.0, 1.41)), null)
        assertEquals(-0.5, Dsp.headroom(cuts, fs), 0.0)
        val hp = Dsp.Setting(true, Dsp.Headphone("x", -8.0, listOf(Dsp.Band("peak", 1000.0, 6.0, 1.41))), emptyList(), null)
        assertEquals(-8.0, Dsp.headroom(hp, fs), 0.0)
        val hp2 = Dsp.Setting(true, Dsp.Headphone("x", -3.0, listOf(Dsp.Band("peak", 1000.0, 6.0, 1.41))), emptyList(), null)
        assertEquals(-6.5, Dsp.headroom(hp2, fs), 0.0)
        assertEquals(-2.0, Dsp.headroom(Dsp.Setting(true, null, one.bands, -2.0), fs), 0.0)
    }

    @Test fun `the server's setting is read`() {
        val s = Dsp.parse(JSONObject("""{"enabled": true, "headphone": {"name": "HD 650", "preamp": -6.2, "bands": [{"type": "low_shelf", "freq": 105, "gain": 3.1, "q": 0.7}]},
            "peq": {"bands": [{"type": "peak", "freq": 2400, "gain": -3.5, "q": 2}, {"type": "wah", "freq": 100}, {"type": "high_pass", "freq": 30, "gain": 9}]}, "headroom": "auto"}"""))
        assertTrue(s.enabled); assertTrue(s.active)
        assertEquals("HD 650", s.headphone!!.name)
        assertEquals(-6.2, s.headphone!!.preamp!!, 0.0)
        assertEquals(3, s.bands.size)
        assertEquals("low_shelf", s.bands[0].type)
        assertEquals(0.0, s.bands[2].gain, 0.0)
        assertEquals(null, s.headroom)
        assertEquals(-4.0, Dsp.parse(JSONObject("""{"enabled": true, "peq": {"bands": []}, "headroom": -4}""")).headroom)
        assertFalse(Dsp.parse(null).active)
        assertFalse(Dsp.parse(JSONObject("""{"enabled": true, "peq": {"bands": []}}""")).active)
    }

    @Test fun `a tone through the chain comes out as the response says`() {
        // A −6 dB band on a 1 kHz tone: 6 dB off, and the half-dB headroom.
        val s = Dsp.Setting(true, null, listOf(Dsp.Band("peak", 1000.0, -6.0, 1.41)), null)
        val chain = Dsp.Chain(s, fs, 2)
        val n = 48000
        var inSq = 0.0; var outSq = 0.0
        for (i in 0 until n) {
            val x = 0.5 * sin(2 * PI * 1000 * i / fs)
            val y = chain.process(0, x)
            chain.process(1, x)
            if (i >= n / 2) { inSq += x * x; outSq += y * y }   // after the filter has settled
        }
        val drop = 20 * log10(sqrt(outSq) / sqrt(inSq))
        near(drop, -6.5, 0.1, "6 dB band and 0.5 dB headroom")
        assertEquals(1, chain.bands)
        // A band elsewhere leaves the tone alone, bar the preamp.
        val far = Dsp.Chain(Dsp.Setting(true, null, listOf(Dsp.Band("peak", 8000.0, 6.0, 4.0)), null), fs, 1)
        var a = 0.0; var b = 0.0
        for (i in 0 until n) { val x = 0.5 * sin(2 * PI * 1000 * i / fs); val y = far.process(0, x); if (i >= n / 2) { a += x * x; b += y * y } }
        near(20 * log10(sqrt(b) / sqrt(a)), -6.5, 0.1, "the preamp alone")
    }
}
