package app.rouen.android

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * The phone's DSP for its own play (dev/design/android-app.md §4.20 step 3, v1.9.72-t39): the setting Rouen keeps for
 * this phone (a headphone AutoEQ profile and a manual parametric EQ), the bands as second-order sections, their
 * combined response and the headroom they need, and a [Chain] that runs the audio through them. Applied to the direct
 * head only ([LocalPlay]); when the phone is a Roon zone, Roon does the DSP.
 *
 * Ported, maths for maths, from Mandarin's Dsp.kt (meltface-80/Mandarin: android/core/.../client/Dsp.kt), the Audio EQ
 * Cookbook, so the curve a page draws and the sound the phone makes agree. The AutoEQ profiles and the
 * ParametricEQ.txt an import reads are the server's concern (it sends the setting as JSON); the phone only runs it.
 * Free of Android, so it is tested on the JVM (src/test).
 */
object Dsp {

    const val MAX_BANDS = 10
    const val HEADROOM_MARGIN = 0.5

    /** One band: peak, low_shelf, high_shelf, low_pass or high_pass. */
    class Band(val type: String, val freq: Double, val gain: Double, val q: Double)

    class Headphone(val name: String, val preamp: Double?, val bands: List<Band>)

    /** The setting as Rouen sends it; [bands] is what runs, in order (the headphone's, then the manual PEQ's). */
    class Setting(val enabled: Boolean, val headphone: Headphone?, val peq: List<Band>, val headroom: Double?) {
        val bands: List<Band> get() = (headphone?.bands ?: emptyList()) + peq
        /** Does it change the sound at all? */
        val active: Boolean get() = enabled && bands.isNotEmpty()

        companion object {
            val OFF = Setting(false, null, emptyList(), null)
        }
    }

    /** Normalised coefficients (a0 = 1) of one band at [fs] Hz. */
    class Coeffs(val b0: Double, val b1: Double, val b2: Double, val a1: Double, val a2: Double)

    fun coeffs(b: Band, fs: Double): Coeffs {
        val f0 = min(max(b.freq, 1.0), fs / 2 - 1)
        val q = min(max(b.q, 0.01), 100.0)
        val g = if (b.type == "low_pass" || b.type == "high_pass") 0.0 else b.gain
        val a = 10.0.pow(g / 40)
        val w0 = 2 * PI * f0 / fs
        val cs = cos(w0); val sn = sin(w0)
        val alpha = sn / (2 * q)
        val b0: Double; val b1: Double; val b2: Double; val a0: Double; val a1: Double; val a2: Double
        when (b.type) {
            "low_shelf" -> {
                val s = 2 * sqrt(a) * alpha
                b0 = a * ((a + 1) - (a - 1) * cs + s); b1 = 2 * a * ((a - 1) - (a + 1) * cs); b2 = a * ((a + 1) - (a - 1) * cs - s)
                a0 = (a + 1) + (a - 1) * cs + s; a1 = -2 * ((a - 1) + (a + 1) * cs); a2 = (a + 1) + (a - 1) * cs - s
            }
            "high_shelf" -> {
                val s = 2 * sqrt(a) * alpha
                b0 = a * ((a + 1) + (a - 1) * cs + s); b1 = -2 * a * ((a - 1) + (a + 1) * cs); b2 = a * ((a + 1) + (a - 1) * cs - s)
                a0 = (a + 1) - (a - 1) * cs + s; a1 = 2 * ((a - 1) - (a + 1) * cs); a2 = (a + 1) - (a - 1) * cs - s
            }
            "low_pass" -> {
                b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2
                a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha
            }
            "high_pass" -> {
                b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2
                a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha
            }
            else -> {   // peak
                b0 = 1 + alpha * a; b1 = -2 * cs; b2 = 1 - alpha * a
                a0 = 1 + alpha / a; a1 = -2 * cs; a2 = 1 - alpha / a
            }
        }
        return Coeffs(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
    }

    /** |H(f)| in dB of one section. */
    fun sectionDb(c: Coeffs, f: Double, fs: Double): Double {
        val w = 2 * PI * f / fs
        val c1 = cos(w); val s1 = sin(w); val c2 = cos(2 * w); val s2 = sin(2 * w)
        val nr = c.b0 + c.b1 * c1 + c.b2 * c2; val ni = -(c.b1 * s1 + c.b2 * s2)
        val dr = 1 + c.a1 * c1 + c.a2 * c2; val di = -(c.a1 * s1 + c.a2 * s2)
        val mag2 = (nr * nr + ni * ni) / max(dr * dr + di * di, 1e-30)
        return 10 * log10(max(mag2, 1e-30))
    }

    /** The bands' combined response in dB at [f]. */
    fun responseDb(bands: List<Band>, fs: Double, f: Double): Double =
        bands.sumOf { sectionDb(coeffs(it, fs), f, fs) }

    /** The highest point of the combined response (dB, ≥ 0) over 20 Hz–20 kHz. */
    fun peakDb(bands: List<Band>, fs: Double): Double {
        if (bands.isEmpty()) return 0.0
        val lo = log10(20.0); val hi = log10(20000.0)
        var peak = 0.0
        for (i in 0 until 400) peak = max(peak, responseDb(bands, fs, 10.0.pow(lo + (hi - lo) * i / 399)))
        for (b in bands) if (b.freq > 20 && b.freq < 20000) peak = max(peak, responseDb(bands, fs, b.freq))
        return peak
    }

    /**
     * The preamp in dB (≤ 0): half a dB under the combined peak, a profile's own preamp if it covers that, or a number
     * set by hand. Rounded to a tenth, as the server does.
     */
    fun headroom(s: Setting, fs: Double): Double {
        s.headroom?.let { return min(0.0, it) }
        val bands = s.bands
        if (bands.isEmpty()) return 0.0
        val needed = -(peakDb(bands, fs) + HEADROOM_MARGIN)
        val own = s.headphone?.preamp
        if (own != null && own <= needed) return own
        return Math.round(needed * 10) / 10.0
    }

    private fun band(o: JSONObject): Band? {
        val type = o.optString("type", "")
        if (type !in setOf("peak", "low_shelf", "high_shelf", "low_pass", "high_pass")) return null
        val freq = o.optDouble("freq", Double.NaN)
        if (freq.isNaN() || freq < 10 || freq > 24000) return null
        val q = o.optDouble("q", 0.707).let { if (it.isNaN()) 0.707 else it }.coerceIn(0.1, 20.0)
        val gain = if (type == "low_pass" || type == "high_pass") 0.0
                   else o.optDouble("gain", 0.0).let { if (it.isNaN()) 0.0 else it }.coerceIn(-20.0, 20.0)
        return Band(type, freq, gain, q)
    }

    private fun bands(a: JSONArray?): List<Band> {
        if (a == null) return emptyList()
        return (0 until a.length()).mapNotNull { a.optJSONObject(it)?.let(::band) }.take(MAX_BANDS)
    }

    /** The setting as Rouen sends it (the `dsp` of a hello or a command); null → off. */
    fun parse(o: JSONObject?): Setting {
        if (o == null) return Setting.OFF
        val hp = o.optJSONObject("headphone")?.let {
            Headphone(it.optString("name", ""), it.optDouble("preamp", Double.NaN).let { p -> if (p.isNaN()) null else min(0.0, p) }, bands(it.optJSONArray("bands")))
        }
        val peq = o.optJSONObject("peq")?.let { bands(it.optJSONArray("bands")) } ?: emptyList()
        val hr = if (o.opt("headroom") is Number) o.optDouble("headroom").coerceIn(-30.0, 0.0) else null
        return Setting(o.optBoolean("enabled", false), hp, peq, hr)
    }

    /** One second-order section with its state, direct form I, in doubles. */
    class Section(c: Coeffs) {
        private val b0 = c.b0; private val b1 = c.b1; private val b2 = c.b2; private val a1 = c.a1; private val a2 = c.a2
        private var x1 = 0.0; private var x2 = 0.0; private var y1 = 0.0; private var y2 = 0.0
        fun process(x: Double): Double {
            val y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            x2 = x1; x1 = x; y2 = y1; y1 = y
            return y
        }
        fun reset() { x1 = 0.0; x2 = 0.0; y1 = 0.0; y2 = 0.0 }
    }

    /**
     * A setting ready to run at [fs] Hz over [channels] channels: the preamp as a factor, and a section per band per
     * channel. [process] runs one sample of one channel.
     */
    class Chain(setting: Setting, val fs: Double, val channels: Int) {
        val gain: Double = 10.0.pow(headroom(setting, fs) / 20)
        private val sections: Array<Array<Section>> =
            Array(channels) { setting.bands.map { Section(coeffs(it, fs)) }.toTypedArray() }
        val bands: Int get() = sections.firstOrNull()?.size ?: 0
        fun process(channel: Int, x: Double): Double {
            var v = x * gain
            for (s in sections[channel]) v = s.process(v)
            return v
        }
        fun reset() { for (ch in sections) for (s in ch) s.reset() }
    }

    /** Rounded for the eye: "−6.5 dB". */
    fun db(v: Double): String = (if (v < 0) "−" else if (v > 0) "+" else "") + String.format("%.1f dB", abs(v))
}
