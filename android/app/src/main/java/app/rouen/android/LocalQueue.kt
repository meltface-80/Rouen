package app.rouen.android

/**
 * The rules of the phone's own play, the downloaded albums played on the phone (dev/design/android-app.md §4.19,
 * v1.9.72-t32), free of Android so they are tested on the JVM (src/test). [LocalPlay] does the playing.
 */
object LocalQueue {
    /**
     * Whether Roon's command [op] reaches the player while it plays the phone's own files ([local]). Only Roon opening
     * a session on the phone now takes the player back: not one Rouen's hello [replay]s, which Roon started before the
     * phone's own play. Its stop, pause, play and volume are for Roon's own session, and the phone has none while it
     * plays its own: until v1.9.72-t32, the stop Rouen sends each time the phone reaches it again ended the download
     * playing (the owner's log, 2026-10-30, 23:05:25).
     */
    fun roonMay(op: String, local: Boolean, replay: Boolean = false): Boolean = !local || (op == "open" && !replay)

    /** Where tracks added go, in a queue of [count] playing item [current]: just after it (Play next) or at the end. */
    fun insertAt(count: Int, current: Int, next: Boolean): Int = if (next && count > 0) minOf(current + 1, count) else count

    /**
     * Which of an album's downloaded tracks ([done], their numbers in album order) a request takes. [from] is the
     * page's track index (0: the first): "play" plays from it on, "track" takes that one, "album" takes them all.
     */
    fun pick(done: List<Int>, from: Int, how: String): List<Int> = when (how) {
        "track" -> done.filter { it == from + 1 }
        "play" -> done.filter { it >= from + 1 }.ifEmpty { done }
        else -> done
    }

    /**
     * The track length to show, in seconds: the player's measured length once it knows it ([durationMs] > 0), else the
     * album metadata's [trackLength] (seconds). A streamed library album's Opus track (§4.20) is made by ffmpeg as it
     * is sent, so it has no length the player can measure until it is buffered — without this, Now playing sat at
     * 0:00/0:00 until a pause let the player catch up (the owner, 2026-10-31; v1.9.72-t40). The metadata length comes
     * from Rouen's /api/phone/album, so it is right from the first second.
     */
    fun shownLength(durationMs: Long, trackLength: Int?): Double =
        durationMs.takeIf { it > 0 }?.div(1000.0) ?: (trackLength?.takeIf { it > 0 }?.toDouble() ?: 0.0)

    /** A queued track's id in the player: its album's key and its number. */
    fun id(key: String, n: Int): String = "local-$key-$n"

    /** The album's key and the track's number back from [id], or null for an id that isn't the phone's own. */
    fun parse(id: String?): Pair<String, Int>? {
        val parts = id?.split('-') ?: return null
        if (parts.size != 3 || parts[0] != "local" || parts[1].isEmpty()) return null
        val n = parts[2].toIntOrNull() ?: return null
        return parts[1] to n
    }
}
