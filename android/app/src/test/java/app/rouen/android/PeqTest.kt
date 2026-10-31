package app.rouen.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The phone's parametric EQ maths and the ParametricEQ.txt parse (dev/design/android-app.md §4.20 step 3,
 * v1.9.72-t37). Free of Android, so on the JVM.
 */
class PeqTest {
    private val SR = 48000

    @Test fun THE_ONE_aPeakingBandHasItsGainAtItsCentreAndNoneFarAway() {
        val bq = Peq.biquad(Peq.Band(Peq.Kind.PK, 1000.0, 6.0, 1.0), SR)
        assertEquals("the boost at the centre", 6.0, Peq.gainAt(bq, 1000.0, SR), 0.05)
        assertEquals("flat two decades below", 0.0, Peq.gainAt(bq, 10.0, SR), 0.2)
        assertEquals("flat well above", 0.0, Peq.gainAt(bq, 20000.0, SR), 0.3)
        // A cut is the mirror of a boost at the centre.
        val cut = Peq.biquad(Peq.Band(Peq.Kind.PK, 1000.0, -6.0, 1.0), SR)
        assertEquals(-6.0, Peq.gainAt(cut, 1000.0, SR), 0.05)
    }

    @Test fun shelvesLiftOrDropOneEndAndLeaveTheOther() {
        val ls = Peq.biquad(Peq.Band(Peq.Kind.LS, 100.0, 6.0, 0.7), SR)
        assertEquals("the low shelf lifts the bottom", 6.0, Peq.gainAt(ls, 20.0, SR), 0.3)
        assertEquals("and leaves the top", 0.0, Peq.gainAt(ls, 15000.0, SR), 0.3)
        val hs = Peq.biquad(Peq.Band(Peq.Kind.HS, 8000.0, -4.0, 0.7), SR)
        assertEquals("the high shelf drops the top", -4.0, Peq.gainAt(hs, 20000.0, SR), 0.3)
        assertEquals("and leaves the bottom", 0.0, Peq.gainAt(hs, 50.0, SR), 0.3)
    }

    @Test fun biquadIsNormalisedByA0() {
        // A flat (0 dB) peaking band is the identity: b0 = 1, the rest 0.
        val bq = Peq.biquad(Peq.Band(Peq.Kind.PK, 1000.0, 0.0, 1.0), SR)
        assertEquals(1.0, bq.b0, 1e-9)
        assertEquals(0.0, Peq.gainAt(bq, 1000.0, SR), 1e-6)
    }

    @Test fun THE_ONE_parsesAnAutoEqParametricFile() {
        val text = """
            Preamp: -6.5 dB
            Filter 1: ON PK Fc 105 Hz Gain -2.0 dB Q 0.70
            Filter 2: ON LSC Fc 105 Hz Gain 3.0 dB Q 0.70
            Filter 3: OFF PK Fc 200 Hz Gain 5.0 dB Q 1.00
            Filter 4: ON HS Fc 10000 Hz Gain -1.5 dB Q 0.71
            # a comment, and a blank line follow

        """.trimIndent()
        val c = Peq.parse(text)
        assertEquals(-6.5, c.preampDb, 1e-9)
        assertEquals("the OFF filter is left out", 3, c.bands.size)
        assertEquals(Peq.Band(Peq.Kind.PK, 105.0, -2.0, 0.70), c.bands[0])
        assertEquals("LSC maps to a low shelf", Peq.Kind.LS, c.bands[1].kind)
        assertEquals(Peq.Kind.HS, c.bands[2].kind)
        assertEquals(10000.0, c.bands[2].freq, 1e-9)
    }

    @Test fun noPreampLineMeansZero() {
        val c = Peq.parse("Filter 1: ON PK Fc 440 Hz Gain 1.0 dB Q 2.0\n")
        assertEquals(0.0, c.preampDb, 1e-9)
        assertEquals(1, c.bands.size)
    }

    @Test fun aFrequencyAtOrAboveNyquistStaysDefined() {
        val bq = Peq.biquad(Peq.Band(Peq.Kind.HS, 30000.0, 3.0, 0.7), SR)  // above Nyquist (24 kHz)
        assertTrue(bq.b0.isFinite() && bq.a1.isFinite() && bq.a2.isFinite())
    }
}
