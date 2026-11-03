package app.rouen.android

import org.json.JSONObject

/**
 * Android Auto's tree, as data (dev/design/android-app.md §4.24, v1.9.72-t81): the folders, the ids of what is in
 * them, and Rouen's answers read into rows. Pure, so it is tested on the JVM; CarLibrary turns it into Media3 items.
 *
 * The owner's folders (2026-11-03): Recently played, Smart Picks, Random albums, Library A–Z, Playlists, Downloaded
 * albums. Albums only (a tap plays the album from its start), no search. Rouen's folders need Rouen (signed in, in
 * reach, the phone's zone known); Downloaded albums are always there.
 */
object CarTree {
    const val ROOT = "root"
    const val RECENT = "recent"
    const val PICKS = "picks"
    const val RANDOM = "random"
    const val LIBRARY = "library"
    const val PLAYLISTS = "playlists"
    const val DOWNLOADS = "downloads"

    /** A library album: al:<offset>. */
    const val ALBUM = "al:"
    /** A Roon playlist: pl:<offset>. */
    const val PLAYLIST = "pl:"
    /** An album downloaded to the phone: dl:<its folder's key>. */
    const val DOWNLOAD = "dl:"
    /** A run of the library A–Z: lib:<first offset in the run>. */
    const val CHUNK = "lib:"

    /** How many albums a run of the library holds. */
    const val CHUNK_SIZE = 100

    /** One album or playlist as Rouen lists it: its place in Roon's list, and the names that make sure of it. */
    data class Row(val offset: Int, val title: String, val subtitle: String, val imageKey: String)

    /** A run of the library: its id, its title ("Abba – Bowie"), and where it starts and ends in the whole list. */
    data class Chunk(val id: String, val title: String, val from: Int, val until: Int)

    /** The root's folders, in the owner's order: Rouen's only when [online]. */
    fun root(online: Boolean): List<Pair<String, String>> = buildList {
        if (online) {
            add(RECENT to "Recently played")
            add(PICKS to "Smart Picks")
            add(RANDOM to "Random albums")
            add(LIBRARY to "Library A–Z")
            add(PLAYLISTS to "Playlists")
        }
        add(DOWNLOADS to "Downloaded albums")
    }

    /** Albums in [j]'s array [key] ({offset, title, subtitle, image_key}); one with no place in Roon's list is left out. */
    fun albums(j: JSONObject?, key: String = "albums"): List<Row> {
        val a = j?.optJSONArray(key) ?: return emptyList()
        return (0 until a.length()).mapNotNull { i ->
            val o = a.optJSONObject(i) ?: return@mapNotNull null
            // A missing or null offset reads as -1: not in Roon's list, left out.
            val off = o.optInt("offset", -1).takeIf { it >= 0 } ?: return@mapNotNull null
            Row(off, o.optString("title", ""), o.optString("subtitle", ""), text(o, "image_key"))
        }
    }

    /** Smart Picks that are in the Roon library now (only those can be played): by the library's own names. */
    fun picks(j: JSONObject?): List<Row> {
        val a = j?.optJSONArray("picks") ?: return emptyList()
        return (0 until a.length()).mapNotNull { i ->
            val o = a.optJSONObject(i) ?: return@mapNotNull null
            // A missing or null offset reads as -1: not in Roon's list, left out.
            val off = o.optInt("offset", -1).takeIf { it >= 0 } ?: return@mapNotNull null
            Row(off, text(o, "library_title").ifEmpty { text(o, "album") },
                text(o, "library_subtitle").ifEmpty { text(o, "artist") }, text(o, "image_key"))
        }
    }

    /** The whole library in runs of [size], each titled by its first and last album. */
    fun chunks(all: List<Row>, size: Int = CHUNK_SIZE): List<Chunk> =
        all.indices.step(size).map { from ->
            val until = minOf(from + size, all.size)
            val first = all[from].title.ifEmpty { "…" }
            val last = all[until - 1].title.ifEmpty { "…" }
            Chunk(CHUNK + from, if (until - from == 1) first else "${short(first)} – ${short(last)}", from, until)
        }

    /** What an id is: one of the kinds above, and what follows its prefix. */
    fun kind(id: String): Pair<String, String> = listOf(ALBUM, PLAYLIST, DOWNLOAD, CHUNK)
        .firstOrNull { id.startsWith(it) }?.let { it to id.removePrefix(it) } ?: ("" to id)

    private fun short(s: String): String = if (s.length <= 18) s else s.take(17).trimEnd() + "…"

    /** A string field, "" when absent or null (org.json's optString gives "null" for a JSON null). */
    private fun text(o: JSONObject, key: String): String = if (o.isNull(key)) "" else o.optString(key, "")
}
