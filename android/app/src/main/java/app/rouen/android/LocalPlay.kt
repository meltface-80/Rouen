package app.rouen.android

import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * The phone's own play: downloaded albums played on the phone's player, Roon not asked (dev/design/android-app.md
 * §4.19). Offline from v1.9.72-t31 (moved out of [PlayerService] in v1.9.72-t32). From v1.9.72-t32 it is a queue,
 * which Play next and Queue add to from several albums, and it goes on when Rouen can be reached again. Rouen's page
 * shows and drives it there as "This phone" (public/phone-local.js) until Roon starts a stream on the phone ([end]).
 *
 * The player plays at full gain while it plays the phone's own files, so the phone's volume keys are the volume. Roon's
 * volume for the phone's zone is kept apart and given back when Roon takes the player again.
 * All on the main thread, where the player is.
 */
class LocalPlay(
    private val exo: () -> ExoPlayer?,
    private val roon: () -> RoonPlayer?,
    /** The player taken from Roon's session: [PlayerService] lets that session go. */
    private val began: () -> Unit
) {
    /** The albums in the queue, by key: their titles, artists and tracks. */
    private val albums = HashMap<String, DownloadStore.Album>()
    /** Roon's volume for the phone's zone, kept while the phone plays its own (null: not taken). */
    private var roonGain: Float? = null

    /** Playing the phone's own files. */
    val on: Boolean get() = roon()?.local == true

    /** The album's downloaded tracks from [from] (the page's track index) on, in place of whatever was queued. */
    fun play(a: DownloadStore.Album, from: Int): Boolean {
        val p = exo() ?: return false
        val items = items(a, LocalQueue.pick(doneOf(a), from, "play"))
        if (items.isEmpty() || !take(p)) return false
        albums.clear()
        albums[a.key] = a
        p.setMediaItems(items, 0, 0L)
        p.prepare()
        p.play()
        AppLog.line("PLAYER", "the phone's own: \"${a.title}\" from track ${from + 1}")
        return true
    }

    /**
     * The album ([track] null) or one of its tracks, after the track playing ([next]) or at the end of the queue.
     * With nothing of the phone's own playing, it plays.
     */
    fun add(a: DownloadStore.Album, track: Int?, next: Boolean): Boolean {
        val p = exo() ?: return false
        val ns = if (track == null) LocalQueue.pick(doneOf(a), 0, "album") else LocalQueue.pick(doneOf(a), track, "track")
        if (ns.isEmpty()) return false
        val idle = p.playbackState == Player.STATE_IDLE || p.playbackState == Player.STATE_ENDED
        if (!on || p.mediaItemCount == 0 || idle) return play(a, if (track == null) 0 else track).also { if (it && track != null) trimTo(p, 1) }
        albums[a.key] = a
        p.addMediaItems(LocalQueue.insertAt(p.mediaItemCount, p.currentMediaItemIndex, next), items(a, ns))
        AppLog.line("PLAYER", "the phone's own: ${ns.size} track(s) of \"${a.title}\" " + if (next) "next" else "queued")
        return true
    }

    /** What the phone plays: {state, index, count, position, length, title, artist, album, key}, or {state: "stopped"}. */
    fun state(): JSONObject {
        val p = exo()
        val at = p?.let { LocalQueue.parse(it.currentMediaItem?.mediaId) }
        if (p == null || !on || p.mediaItemCount == 0 || at == null) return JSONObject().put("state", "stopped")
        val state = when (p.playbackState) {
            Player.STATE_IDLE, Player.STATE_ENDED -> "stopped"
            Player.STATE_BUFFERING -> if (p.playWhenReady) "loading" else "paused"
            else -> if (p.isPlaying) "playing" else "paused"
        }
        val a = albums[at.first]
        return JSONObject().put("state", state).put("index", p.currentMediaItemIndex).put("count", p.mediaItemCount)
            .put("position", p.currentPosition / 1000.0).put("length", (p.duration.takeIf { it > 0 } ?: 0L) / 1000.0)
            .put("title", p.currentMediaItem?.mediaMetadata?.title?.toString() ?: "")
            .put("artist", a?.artist ?: "").put("album", a?.title ?: "").put("key", at.first)
    }

    /** The queue from the track playing on: {id (its place), title, artist, album, key, length}. */
    fun queue(): JSONArray {
        val out = JSONArray()
        val p = exo() ?: return out
        if (!on) return out
        for (i in p.currentMediaItemIndex.coerceAtLeast(0) until p.mediaItemCount) {
            val at = LocalQueue.parse(p.getMediaItemAt(i).mediaId) ?: continue
            val a = albums[at.first] ?: continue
            val t = a.tracks.firstOrNull { it.n == at.second } ?: continue
            out.put(JSONObject().put("id", i).put("title", t.title).put("artist", a.artist).put("album", a.title)
                .put("key", a.key).put("length", t.length))
        }
        return out
    }

    /** A button on the page's transport: play, pause, playpause, next, previous, stop. */
    fun control(op: String) {
        val p = exo() ?: return
        if (!on) return
        when (op) {
            "play" -> p.play()
            "pause" -> p.pause()
            "playpause" -> if (p.isPlaying) p.pause() else p.play()
            "next" -> if (p.hasNextMediaItem()) p.seekToNextMediaItem()
            "previous" -> if (p.currentPosition > 3_000 || !p.hasPreviousMediaItem()) p.seekTo(0L) else p.seekToPreviousMediaItem()
            "stop" -> { p.stop(); p.clearMediaItems(); albums.clear() }
        }
    }

    /** To [seconds] into the track playing. */
    fun seek(seconds: Double) {
        val p = exo() ?: return
        if (on && seconds >= 0) p.seekTo((seconds * 1000).toLong())
    }

    /** Play from the queue's item at [index] (the Queue screen's tap). */
    fun jump(index: Int) {
        val p = exo() ?: return
        if (on && index in 0 until p.mediaItemCount) { p.seekTo(index, 0L); p.play() }
    }

    /** Roon's volume for the phone's zone, while the phone plays its own: kept for when Roon takes the player again. */
    fun roonVolume(gain: Float) { roonGain = gain }

    /** Roon starts a stream on the phone: the phone's own play gives way, and Roon's volume comes back. */
    fun end() {
        val r = roon() ?: return
        if (!r.local) return
        r.local = false
        albums.clear()
        roonGain?.let { g -> exo()?.volume = g }
        roonGain = null
    }

    /** The player taken from Roon's session, at full gain, Roon's own kept. */
    private fun take(p: ExoPlayer): Boolean {
        val r = roon() ?: return false
        if (!r.local) roonGain = p.volume
        began()
        r.local = true
        p.volume = 1f
        return true
    }

    /** Only the first [n] items left (a single track asked for with nothing playing). */
    private fun trimTo(p: ExoPlayer, n: Int) { if (p.mediaItemCount > n) p.removeMediaItems(n, p.mediaItemCount) }

    private fun doneOf(a: DownloadStore.Album): List<Int> = a.tracks.filter { it.done }.map { it.n }

    private fun items(a: DownloadStore.Album, ns: List<Int>): List<MediaItem> {
        // A streamed library album (§4.20, v1.9.72-t36): its tracks are fetched from Rouen's file route, which
        // PlayerService's ResolvingDataSource rebases to the address in use and gives the login cookie. A downloaded
        // album's are files in its folder, with its cover.jpg as artwork.
        val cover = if (a.stream != null) null else File(a.dir, "cover.jpg").takeIf { it.isFile }?.readBytes()
        return a.tracks.filter { it.n in ns }.map { t ->
            val md = MediaMetadata.Builder().setTitle(t.title).setArtist(a.artist).setAlbumTitle(a.title)
            if (cover != null) md.setArtworkData(cover, MediaMetadata.PICTURE_TYPE_FRONT_COVER)
            val uri = if (a.stream != null) Uri.parse(a.stream + "&n=" + t.n) else Uri.fromFile(File(a.dir, t.file))
            MediaItem.Builder().setUri(uri).setMediaId(LocalQueue.id(a.key, t.n))
                .setMediaMetadata(md.build()).build()
        }
    }
}
