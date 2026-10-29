package app.rouen.android

import java.util.Locale

/**
 * Home or away, decided (dev/design/android-app.md §4.7, §4.8): the rules [Away] follows, free of
 * Android so they are tested on the JVM (src/test). From Mandarin's app (meltface-80/Mandarin:
 * android/core/.../client/Route.kt and EngineIdle.kt), with Rouen's three ways to the server.
 */
object Way {
    const val DEFAULT_PORT = 3399

    /** Where the app talks to Rouen: its home address, its tailnet address directly, or the built-in engine. */
    enum class Kind { HOME, DIRECT, ENGINE }

    /**
     * The way, in order: the home address when it answers; else Rouen's tailnet address when it
     * answers directly (the Tailscale app or another VPN is on); else the built-in engine, when there
     * is a tailnet address to forward to and the phone is signed in to it. With none of those, the
     * home address: the page then says Rouen can't be reached.
     */
    fun choose(homeAnswers: Boolean, haveAway: Boolean, directAnswers: Boolean, engineReady: Boolean): Kind = when {
        homeAnswers -> Kind.HOME
        directAnswers -> Kind.DIRECT
        haveAway && engineReady -> Kind.ENGINE
        else -> Kind.HOME
    }

    /**
     * How many looks at the home address, none answered, make the phone away (Mandarin's item 157):
     * on Wi-Fi and home till now, [HOME_MISSES] in a row, so one slow answer does not send the phone
     * away at home; coming home, or off Wi-Fi, one look decides.
     */
    fun looksBeforeAway(wasAway: Boolean, onWifi: Boolean): Int = if (!wasAway && onWifi) HOME_MISSES else 1
    const val HOME_MISSES = 3

    /**
     * May the engine be started afresh at [now] (ms), last started afresh at [last] (0: never)? At most
     * once in [RESTART_GAP_MS] (Mandarin's item 157): a restart drops the music playing and every
     * request, and the server itself may be what is not answering.
     */
    fun mayRestartEngine(now: Long, last: Long): Boolean = last == 0L || now - last >= RESTART_GAP_MS
    const val RESTART_GAP_MS = 180_000L

    /**
     * The phone's name on the tailnet: "rouen-" and the phone's name, lowercased, every character
     * other than a-z and 0-9 made "-", at most 63 characters (one DNS label).
     */
    fun hostname(phoneName: String): String {
        val tail = phoneName.trim().lowercase(Locale.ROOT).map { if (it in 'a'..'z' || it in '0'..'9') it else '-' }.joinToString("")
        return ("rouen-" + tail).take(63)
    }

    /**
     * An address as typed or as Rouen gives it ("192.168.1.20", "rouen.local:3399",
     * "http://100.101.102.103:3399/") made into "host:port", or null when it is not one. No port
     * means Rouen's own, 3399.
     */
    fun parseAddress(typed: String?): String? {
        var s = typed?.trim() ?: return null
        s = s.removePrefix("http://").removePrefix("https://")
        s = s.substringBefore('/').trim()
        if (s.isEmpty() || s.any { it.isWhitespace() }) return null
        val colon = s.lastIndexOf(':')
        if (colon < 0) return "$s:$DEFAULT_PORT"
        val host = s.substring(0, colon)
        val port = s.substring(colon + 1).toIntOrNull() ?: return null
        if (host.isEmpty() || host.contains(':') || port !in 1..65535) return null
        return "$host:$port"
    }

    /**
     * Is [server] ("host:port") a tailnet address: Tailscale's IPv4 range, 100.64.0.0/10, or a
     * MagicDNS name (….ts.net)? Only such an address is tried through the built-in engine when typed.
     */
    fun isTailnet(server: String): Boolean {
        val host = server.substringBeforeLast(':').lowercase(Locale.ROOT)
        if (host.endsWith(".ts.net")) return true
        val parts = host.split('.')
        if (parts.size != 4) return false
        val n = parts.map { it.toIntOrNull() ?: return false }
        if (n.any { it !in 0..255 }) return false
        return n[0] == 100 && n[1] in 64..127
    }

    const val SESSION_COOKIE = "rouen_session"

    /** Rouen's login (the `rouen_session` value) in a Cookie header as CookieManager gives it, or null. */
    fun sessionValue(cookieHeader: String?): String? {
        if (cookieHeader.isNullOrBlank()) return null
        for (part in cookieHeader.split(';')) {
            val i = part.indexOf('=')
            if (i > 0 && part.substring(0, i).trim() == SESSION_COOKIE) return part.substring(i + 1).trim().takeIf { it.isNotEmpty() }
        }
        return null
    }

    /**
     * The login to give the origin being switched to, or null to leave it as it is. Rouen's cookie
     * is per origin, so without this the page would ask for the login again at each address.
     *
     * [fromValue]: the login at the origin in use until now (null: none, or the first look of this
     * run). It follows the phone when it differs. With none, the origin keeps its own login if it has
     * one ([targetValue]), and otherwise takes the first of [fallbacks] (the home address's, then the
     * tailnet address's): a first look must never put an older login over a newer one.
     */
    fun carry(fromValue: String?, targetValue: String?, fallbacks: List<String?>): String? {
        if (fromValue != null) return fromValue.takeIf { it != targetValue }
        if (targetValue != null) return null
        return fallbacks.firstOrNull { it != null }
    }

    /**
     * Whether the engine is kept running (Mandarin's EngineIdle, its item 202: Android ended the app
     * over the CPU of an engine left idle at home). Away it is the way to the server and stays. At
     * home it is kept while the phone plays (walking out then keeps the music going) and stopped once
     * idle for [GRACE_MS]; away again, it joins in seconds, its sign-in kept on disk.
     */
    class EngineIdle(private val clock: () -> Long) {
        enum class Verdict { KEEP, WAIT, STOP }

        private var idleSince: Long? = null

        /** The engine's fate now: [away] the way is the engine; [inUse] the phone's player is playing. */
        fun verdict(away: Boolean, inUse: Boolean): Verdict {
            if (away || inUse) { idleSince = null; return Verdict.KEEP }
            val now = clock()
            val from = idleSince ?: now.also { idleSince = it }
            return if (now - from >= GRACE_MS) Verdict.STOP else Verdict.WAIT
        }

        /** How long until the grace is up, for the next look; the whole grace while not idle. */
        fun remaining(): Long = idleSince?.let { (GRACE_MS - (clock() - it)).coerceAtLeast(0L) } ?: GRACE_MS

        companion object {
            const val GRACE_MS = 2 * 60_000L
        }
    }
}
