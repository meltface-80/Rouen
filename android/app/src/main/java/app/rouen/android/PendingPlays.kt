package app.rouen.android

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.Collections
import java.util.IdentityHashMap

/**
 * This phone's plays not yet sent to Rouen (dev/design/android-app.md §4.22, v1.9.72-t57), kept in [file] so that plays
 * made offline, or while Rouen couldn't be reached, are sent once it can be — [PhoneLink] sends them with its hello.
 * At most [MAX] are kept: past that, the oldest go. A play Rouen would refuse (see [valid]) is never kept, so a batch
 * is never refused for one of them. The service's saving thread adds; the link's thread takes and drops; the file is
 * read on first use, on whichever of them comes first, never on the main thread.
 */
class PendingPlays(
    private val file: File,
    /** Said when the file can't be read or written ([AppLog] in the app). */
    private val note: (String) -> Unit = { AppLog.line("PLAYS", it, anomaly = true) }
) {
    private val plays: MutableList<PlayLog.Play> by lazy { read() }

    /** A play to send; one Rouen would refuse is said and not kept. */
    @Synchronized
    fun add(p: PlayLog.Play) {
        if (!valid(p)) { note("a play Rouen wouldn't take was not kept: ${p.track} (${p.album})"); return }
        plays.add(p)
        if (plays.size > MAX) plays.subList(0, plays.size - MAX).clear()
        write()
    }

    /** The oldest [n] plays, to send (still kept until [drop]). */
    @Synchronized
    fun first(n: Int): List<PlayLog.Play> = plays.take(n)

    /**
     * The plays [sent] (from [first]) have gone to Rouen, or never will: exactly they go, by identity — not "the first
     * so many", which, with plays added and the oldest trimmed meanwhile, could be others never sent.
     */
    @Synchronized
    fun drop(sent: List<PlayLog.Play>) {
        if (sent.isEmpty()) return
        val gone = Collections.newSetFromMap(IdentityHashMap<PlayLog.Play, Boolean>()).apply { addAll(sent) }
        if (plays.removeAll { it in gone }) write()
    }

    @Synchronized
    fun size(): Int = plays.size

    private fun read(): MutableList<PlayLog.Play> {
        if (!file.isFile) return mutableListOf()
        return try {
            val a = JSONArray(file.readText())
            (0 until a.length()).mapNotNull { i -> a.optJSONObject(i)?.let { playOf(it) }?.takeIf { valid(it) } }.toMutableList()
        } catch (e: Exception) {
            // A file that can't be read (cut off by a crash) holds nothing that can be sent: started afresh.
            note("the kept plays couldn't be read (${e.javaClass.simpleName}): started afresh")
            mutableListOf()
        }
    }

    private fun write() {
        val a = JSONArray()
        for (p in plays) a.put(json(p))
        try {
            val tmp = File(file.path + ".tmp")
            tmp.writeText(a.toString())
            // Replaced in one step: a crash leaves the old list or the new one, never neither.
            Files.move(tmp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
        } catch (e: IOException) {
            note("the plays couldn't be kept: ${e.message}")
        }
    }

    companion object {
        /** Kept at most: a phone offline for weeks, playing all day, keeps its last few thousand tracks. */
        const val MAX = 5000

        /** A play as Rouen's POST /api/phone/plays takes it. */
        fun json(p: PlayLog.Play): JSONObject = JSONObject().put("album", p.album).put("artist", p.artist).put("track", p.track)
            .put("index", p.index).put("elapsed", p.elapsed).put("at", p.at)

        /** Longest elapsed Rouen takes (6 hours, in seconds), and the highest track place. */
        private const val MAX_ELAPSED = 6 * 3600.0
        private const val MAX_INDEX = 999

        /**
         * Whether Rouen's POST /api/phone/plays takes [p] (lib/catchup/mount.js `playOf`): album, artist and track
         * named, the place 0..999, elapsed above 0 and at most 6 hours, a time.
         */
        fun valid(p: PlayLog.Play): Boolean = p.album.isNotBlank() && p.artist.isNotBlank() && p.track.isNotBlank() &&
            p.index in 0..MAX_INDEX && p.elapsed > 0.0 && p.elapsed <= MAX_ELAPSED && p.at > 0L

        private fun playOf(j: JSONObject): PlayLog.Play =
            PlayLog.Play(j.optString("album"), j.optString("artist"), j.optString("track"), j.optInt("index", -1),
                j.optDouble("elapsed", 0.0), j.optLong("at"))
    }
}
