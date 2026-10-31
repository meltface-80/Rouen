package app.rouen.android

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * The parametric EQ for the phone's own play (dev/design/android-app.md §4.20, step 3, v1.9.72-t37): the bands and the
 * biquad coefficients a player applies, and the AutoEQ/REW ParametricEQ.txt an import reads. Applied only to the
 * direct head (the phone playing its own files away, [LocalPlay]); when the phone is a Roon zone, Roon does the DSP.
 * For the one phone the app is installed on.
 *
 * Free of Android — the maths and the parse — so it is tested on the JVM (src/test). Who applies the coefficients to
 * the audio (an ExoPlayer AudioProcessor) and how the bands are stored and chosen come in the next slice.
 */
object Peq {
    /** A band's shape, as AutoEQ and REW write it: peaking, low shelf, high shelf. */
    enum class Kind { PK, LS, HS }

    /** One band: its shape, centre (or corner) frequency in Hz, gain in dB, and Q. */
    data class Band(val kind: Kind, val freq: Double, val gainDb: Double, val q: Double)

    /** A whole correction: a preamp in dB (to stop the boosts clipping), and the bands in order. */
    data class Curve(val preampDb: Double, val bands: List<Band>)

    /** A biquad's coefficients, already normalised by a0 (so a0 is 1). Direct-form I: y = b0 x + b1 x1 + b2 x2 − a1 y1 − a2 y2. */
    data class Biquad(val b0: Double, val b1: Double, val b2: Double, val a1: Double, val a2: Double)

    private val PREAMP = Regex("""(?i)^\s*Preamp:\s*(-?\d+(?:\.\d+)?)\s*dB""")
    // "Filter 1: ON PK Fc 105 Hz Gain -2.0 dB Q 0.70" — REW/AutoEQ's line; an OFF filter, or one we can't map, is skipped.
    private val FILTER = Regex("""(?i)^\s*Filter\s+\d+:\s*ON\s+(PK|LS|HS|LSC|HSC|PEQ)\s+Fc\s+(-?\d+(?:\.\d+)?)\s*Hz\s+Gain\s+(-?\d+(?:\.\d+)?)\s*dB\s+Q\s+(-?\d+(?:\.\d+)?)""")

    /**
     * An AutoEQ/REW ParametricEQ.txt read into a [Curve]: its "Preamp:" line (0 dB when there is none) and every
     * "Filter N: ON …" line it can map (PK, and the shelves LS/HS, their REW aliases LSC/HSC; PEQ is a peaking band).
     * A line that is off or in a shape this doesn't know is left out.
     */
    fun parse(text: String): Curve {
        var preamp = 0.0
        val bands = ArrayList<Band>()
        for (line in text.lineSequence()) {
            PREAMP.find(line)?.let { preamp = it.groupValues[1].toDouble() }
            val f = FILTER.find(line) ?: continue
            val kind = when (f.groupValues[1].uppercase()) {
                "LS", "LSC" -> Kind.LS
                "HS", "HSC" -> Kind.HS
                else -> Kind.PK   // PK, PEQ
            }
            val freq = f.groupValues[2].toDouble()
            val gain = f.groupValues[3].toDouble()
            val q = f.groupValues[4].toDouble()
            if (freq > 0 && q > 0) bands.add(Band(kind, freq, gain, q))
        }
        return Curve(preamp, bands)
    }

    /**
     * The RBJ-cookbook biquad for [band] at [sampleRate] Hz (peaking EQ, low shelf, high shelf), normalised by a0.
     * A frequency at or above Nyquist is pinned just below it, so the maths stays defined.
     */
    fun biquad(band: Band, sampleRate: Int): Biquad {
        val nyquist = sampleRate / 2.0
        val f = band.freq.coerceIn(1.0, nyquist - 1.0)
        val a = 10.0.pow(band.gainDb / 40.0)          // amplitude, sqrt of the linear gain
        val w0 = 2.0 * PI * f / sampleRate
        val cw = cos(w0)
        val sw = sin(w0)
        val alpha = sw / (2.0 * band.q)
        val b0: Double; val b1: Double; val b2: Double; val a0: Double; val a1: Double; val a2: Double
        when (band.kind) {
            Kind.PK -> {
                b0 = 1 + alpha * a; b1 = -2 * cw; b2 = 1 - alpha * a
                a0 = 1 + alpha / a; a1 = -2 * cw; a2 = 1 - alpha / a
            }
            Kind.LS -> {
                val tsa = 2 * sqrt(a) * alpha
                b0 = a * ((a + 1) - (a - 1) * cw + tsa)
                b1 = 2 * a * ((a - 1) - (a + 1) * cw)
                b2 = a * ((a + 1) - (a - 1) * cw - tsa)
                a0 = (a + 1) + (a - 1) * cw + tsa
                a1 = -2 * ((a - 1) + (a + 1) * cw)
                a2 = (a + 1) + (a - 1) * cw - tsa
            }
            Kind.HS -> {
                val tsa = 2 * sqrt(a) * alpha
                b0 = a * ((a + 1) + (a - 1) * cw + tsa)
                b1 = -2 * a * ((a - 1) + (a + 1) * cw)
                b2 = a * ((a + 1) + (a - 1) * cw - tsa)
                a0 = (a + 1) - (a - 1) * cw + tsa
                a1 = 2 * ((a - 1) - (a + 1) * cw)
                a2 = (a + 1) - (a - 1) * cw - tsa
            }
        }
        return Biquad(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
    }

    /**
     * The gain in dB a [Biquad] applies at [freq] Hz for [sampleRate], for tests and a response display: the magnitude
     * of H(e^jw) in dB.
     */
    fun gainAt(bq: Biquad, freq: Double, sampleRate: Int): Double {
        val w = 2.0 * PI * freq / sampleRate
        // Numerator and denominator as complex numbers at e^{-jw}, e^{-2jw}.
        val cosw = cos(w); val sinw = sin(w); val cos2 = cos(2 * w); val sin2 = sin(2 * w)
        val nr = bq.b0 + bq.b1 * cosw + bq.b2 * cos2
        val ni = -(bq.b1 * sinw + bq.b2 * sin2)
        val dr = 1.0 + bq.a1 * cosw + bq.a2 * cos2
        val di = -(bq.a1 * sinw + bq.a2 * sin2)
        val mag = sqrt((nr * nr + ni * ni) / (dr * dr + di * di))
        return 20.0 * kotlin.math.log10(mag)
    }
}
