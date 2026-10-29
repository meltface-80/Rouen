package app.rouen.android

/**
 * How often the phone's interface list is handed to the Tailscale engine. From Mandarin's app
 * (meltface-80/Mandarin: android/core/.../client/InterfaceFeed.kt, its item 202), unchanged.
 *
 * The app offers the list on every look at the network, and every network callback is a look:
 * a signal-strength change on mobile data among them, several a minute. A list that differs from
 * the last makes the engine look at the network again, rebind and find its addresses, and with
 * Wi-Fi and mobile data both up the list can flap, each flap costing the engine CPU (Android once
 * ended Mandarin over it). So a list the same as the last is not sent at all, and lists that
 * differ go at most once in [MIN_GAP_MS]: a change in the gap is sent when the gap is up
 * ([Action.Later]), so a flap that undoes itself costs nothing and a real change is never lost.
 *
 * Plain Kotlin, no Android: tested on the JVM (src/test).
 */
class InterfaceFeed(private val clock: () -> Long) {
    sealed class Action {
        object Send : Action()
        object Skip : Action()
        data class Later(val inMs: Long) : Action()
    }

    private var lastText: String? = null
    private var lastSentAt = Long.MIN_VALUE / 2

    /** [text] offered now: sent, skipped as unchanged, or to be offered again in a moment. */
    fun offer(text: String): Action {
        if (text == lastText) return Action.Skip
        val since = clock() - lastSentAt
        if (since < MIN_GAP_MS) return Action.Later(MIN_GAP_MS - since)
        lastText = text
        lastSentAt = clock()
        return Action.Send
    }

    /** A new engine process: it has no list yet, so the next offer is sent whatever came before. */
    fun reset() {
        lastText = null
        lastSentAt = Long.MIN_VALUE / 2
    }

    companion object {
        const val MIN_GAP_MS = 10_000L
    }
}
