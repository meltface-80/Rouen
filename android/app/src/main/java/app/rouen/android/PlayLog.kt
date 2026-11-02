package app.rouen.android

/**
 * What This phone played, track by track (dev/design/android-app.md §4.22, v1.9.72-t57): Rouen's catch-up replays each
 * to Roon, to exactly where the phone got, so Roon counts it or not by its own rules. Fed once a second with the track
 * playing and how far into it ([see]); a track is done when another plays, when it starts again from the top, or when
 * the phone's own play stops ([idle]), and is given to [out] as a [Play]: how far it got and when it began. Paused, a
 * track is neither seen nor done: it goes on when it plays again. Pure, so it is tested on the JVM.
 */
class PlayLog(private val out: (Play) -> Unit) {
    /** A track as the phone's player has it: its media id, its album's title and artist, its title, its place (0-based). */
    data class Item(val id: String, val album: String, val artist: String, val track: String, val index: Int)

    /** One track's play, as Rouen's POST /api/phone/plays takes it: [elapsed] in seconds, [at] in ms since 1970. */
    data class Play(val album: String, val artist: String, val track: String, val index: Int, val elapsed: Double, val at: Long)

    private class Now(val item: Item, var furthestMs: Long, val at: Long)
    private var now: Now? = null

    /** [item] is playing, [positionMs] into it, at [wallMs] (ms since 1970). */
    fun see(item: Item, positionMs: Long, wallMs: Long) {
        val pos = positionMs.coerceAtLeast(0L)
        val n = now
        if (n != null && n.item.id == item.id && !restarted(n, pos)) {
            if (pos > n.furthestMs) n.furthestMs = pos
            return
        }
        idle()
        now = Now(item, pos, wallMs - pos)
    }

    /** Nothing of the phone's own plays any more (stopped, ended, taken): the track playing is done. */
    fun idle() {
        val n = now ?: return
        now = null
        if (n.furthestMs >= MIN_MS) {
            out(Play(n.item.album, n.item.artist, n.item.track, n.item.index, n.furthestMs / 1000.0, n.at))
        }
    }

    /** The same track back at its start after playing a while: played again (Previous, a repeat), a new play. */
    private fun restarted(n: Now, pos: Long) = pos < RESTART_WITHIN_MS && n.furthestMs >= RESTART_AFTER_MS

    companion object {
        /** Less than this is a track skipped straight past: not a play. */
        const val MIN_MS = 1_000L
        private const val RESTART_WITHIN_MS = 3_000L
        private const val RESTART_AFTER_MS = 10_000L
    }
}
