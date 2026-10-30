package app.rouen.android

import android.os.SystemClock
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.util.UnstableApi
import java.lang.reflect.InvocationHandler
import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Proxy
import kotlin.math.abs

/**
 * The player as the media session sees it: the notification, the lock screen, headsets and
 * Bluetooth (dev/design/android-app.md §4.10, `POST /api/phone/control`).
 *
 *  - **Its buttons ask Roon, not ExoPlayer.** play, pause, stop, next and previous go to [ask]
 *    (the control route). Roon then sends the matching command back over the commands poll,
 *    and PlayerService applies it to ExoPlayer, so Roon keeps the queue and the state.
 *  - **Next and previous are always offered**, though ExoPlayer holds one item (the session).
 *  - **It shows what Roon shows** ([setNow], from `/api/phone/now`): title, artist, album and
 *    cover, and the track's length and position rather than the session stream's.
 *  - **It says when Rouen can't be reached** ([setUnreachable], §4.15), in the artist's place, as
 *    Mandarin's notification says "Can't reach Mandarin".
 *
 * **Offline ([local], v1.9.72-t30, §4.19)** it is the phone's own player, playing downloaded albums: its buttons,
 * metadata and positions are ExoPlayer's, and Roon is not asked.
 *
 * Media3's session reads available commands and metadata from the values its listeners are
 * handed as well as from the getters, so each listener is wrapped ([proxyFor]) to hand it
 * this player's own.
 */
@OptIn(UnstableApi::class)
class RoonPlayer(private val inner: Player, private val ask: (String) -> Unit) : ForwardingPlayer(inner) {

    /** What Roon shows for this phone's zone; [at] is when [seekMs] was true. */
    class Now(
        val title: String,
        val artist: String,
        val album: String,
        val lengthMs: Long,
        val seekMs: Long,
        val art: ByteArray?
    ) {
        val at: Long = SystemClock.elapsedRealtime()
    }

    private var now: Now? = null
    private var metadata: MediaMetadata? = null
    /** Said in the artist's place while Rouen can't be reached (null: it can). */
    private var unreachable: String? = null
    private val proxies = LinkedHashMap<Player.Listener, Player.Listener>()

    /** Playing the phone's own files, offline (main thread): the player is ExoPlayer's own, Roon is not asked. */
    var local = false
        set(on) {
            if (field == on) return
            field = on
            clearNow()
            val c = availableCommands
            for (l in proxies.values.toList()) l.onAvailableCommandsChanged(c)
        }

    /** Show [n] (main thread). */
    fun setNow(n: Now) {
        val before = currentPosition
        now = n
        val changed = publish(n)
        // A new track, or Roon seeking: the lock screen is told where it is now.
        val after = currentPosition
        if (changed || abs(after - before) > JUMP_MS) {
            val old = positionInfo(before)
            val new = positionInfo(after)
            for (l in proxies.values.toList()) l.onPositionDiscontinuity(old, new, Player.DISCONTINUITY_REASON_INTERNAL)
        }
    }

    /** [text] said in the artist's place while Rouen can't be reached, or (null) what Roon shows again (main thread). */
    fun setUnreachable(text: String?) {
        if (text == unreachable) return
        unreachable = text
        now?.let { publish(it) }
    }

    /** [n]'s metadata, Rouen out of reach said in it, handed to the listeners when it changed; whether it did. */
    private fun publish(n: Now): Boolean {
        val md = MediaMetadata.Builder()
            .setTitle(n.title.ifEmpty { null })
            .setArtist(unreachable ?: n.artist.ifEmpty { null })
            .setAlbumTitle(n.album.ifEmpty { null })
            .setDurationMs(if (n.lengthMs > 0) n.lengthMs else null)
            .setArtworkData(n.art, if (n.art != null) MediaMetadata.PICTURE_TYPE_FRONT_COVER else null)
            .build()
        val changed = md != metadata
        metadata = md
        if (changed) for (l in proxies.values.toList()) l.onMediaMetadataChanged(md)
        return changed
    }

    /** Nothing to show: the session has ended (main thread). */
    fun clearNow() {
        if (now == null && metadata == null) return
        now = null
        metadata = null
        val md = mediaMetadata
        for (l in proxies.values.toList()) l.onMediaMetadataChanged(md)
    }

    // ---- The buttons: asked of Roon --------------------------------------------------------

    override fun play() = if (local) super.play() else ask("play")
    override fun pause() = if (local) super.pause() else ask("pause")
    override fun setPlayWhenReady(playWhenReady: Boolean) =
        if (local) super.setPlayWhenReady(playWhenReady) else ask(if (playWhenReady) "play" else "pause")
    override fun stop() = if (local) super.stop() else ask("stop")
    override fun seekToNext() = if (local) super.seekToNext() else ask("next")
    override fun seekToNextMediaItem() = if (local) super.seekToNextMediaItem() else ask("next")
    override fun seekToPrevious() = if (local) super.seekToPrevious() else ask("previous")
    override fun seekToPreviousMediaItem() = if (local) super.seekToPreviousMediaItem() else ask("previous")

    /** Preparing the stream is PlayerService's, on Roon's command; a play button's prepare is not needed. */
    override fun prepare() { if (local) super.prepare() }

    override fun seekToDefaultPosition() { if (local) super.seekToDefaultPosition() }

    override fun getAvailableCommands(): Player.Commands = if (local) super.getAvailableCommands() else roonCommands()

    private fun roonCommands(): Player.Commands = super.getAvailableCommands().buildUpon()
        .removeAll(
            Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM,
            Player.COMMAND_SEEK_TO_DEFAULT_POSITION,
            Player.COMMAND_SEEK_TO_MEDIA_ITEM,
            Player.COMMAND_SEEK_BACK,
            Player.COMMAND_SEEK_FORWARD,
            Player.COMMAND_SET_SPEED_AND_PITCH,
            Player.COMMAND_SET_SHUFFLE_MODE,
            Player.COMMAND_SET_REPEAT_MODE,
            Player.COMMAND_SET_MEDIA_ITEM,
            Player.COMMAND_CHANGE_MEDIA_ITEMS,
            Player.COMMAND_SET_PLAYLIST_METADATA,
            Player.COMMAND_SET_TRACK_SELECTION_PARAMETERS,
            Player.COMMAND_SET_VOLUME
        )
        .addAll(
            Player.COMMAND_PLAY_PAUSE,
            Player.COMMAND_STOP,
            Player.COMMAND_SEEK_TO_NEXT,
            Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
            Player.COMMAND_SEEK_TO_PREVIOUS,
            Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM
        )
        .build()

    override fun isCommandAvailable(command: Int): Boolean = availableCommands.contains(command)

    // ---- What is shown: Roon's track, not the session stream -----------------------------

    override fun getMediaMetadata(): MediaMetadata = (if (local) null else metadata) ?: super.getMediaMetadata()
    override fun getDuration(): Long = roonLength() ?: super.getDuration()
    override fun getContentDuration(): Long = roonLength() ?: super.getContentDuration()
    override fun getCurrentPosition(): Long = roonPosition() ?: super.getCurrentPosition()
    override fun getContentPosition(): Long = roonPosition() ?: super.getContentPosition()
    override fun getBufferedPosition(): Long = roonPosition() ?: super.getBufferedPosition()
    override fun getContentBufferedPosition(): Long = roonPosition() ?: super.getContentBufferedPosition()
    override fun getTotalBufferedDuration(): Long = if (roonPosition() != null) 0L else super.getTotalBufferedDuration()
    override fun getBufferedPercentage(): Int {
        val length = roonLength() ?: return super.getBufferedPercentage()
        return ((roonPosition() ?: 0L) * 100 / length).toInt()
    }
    override fun isCurrentMediaItemSeekable(): Boolean = local && super.isCurrentMediaItemSeekable()

    private fun roonLength(): Long? = if (local) null else now?.lengthMs?.takeIf { it > 0 }

    private fun roonPosition(): Long? {
        if (local) return null
        val n = now ?: return null
        if (n.lengthMs <= 0) return null
        var p = n.seekMs
        if (inner.isPlaying) p += SystemClock.elapsedRealtime() - n.at
        return p.coerceIn(0L, n.lengthMs)
    }

    private fun positionInfo(positionMs: Long): Player.PositionInfo {
        val timeline = inner.currentTimeline
        var windowUid: Any? = null
        var periodUid: Any? = null
        if (!timeline.isEmpty) {
            windowUid = timeline.getWindow(inner.currentMediaItemIndex, Timeline.Window()).uid
            periodUid = timeline.getPeriod(inner.currentPeriodIndex, Timeline.Period(), true).uid
        }
        return Player.PositionInfo(
            windowUid, inner.currentMediaItemIndex, inner.currentMediaItem, periodUid, inner.currentPeriodIndex,
            positionMs, positionMs, C.INDEX_UNSET, C.INDEX_UNSET
        )
    }

    // ---- Listeners: handed this player's commands and metadata ---------------------------

    override fun addListener(listener: Player.Listener) {
        super.addListener(proxies.getOrPut(listener) { proxyFor(listener) })
    }

    override fun removeListener(listener: Player.Listener) {
        val proxy = proxies.remove(listener) ?: return
        super.removeListener(proxy)
    }

    /**
     * [target], except that the available commands and the metadata it is handed are this
     * player's. A dynamic proxy, so every other callback (Player.Listener's are all default
     * methods, and grow between Media3 versions) reaches [target] unchanged.
     */
    private fun proxyFor(target: Player.Listener): Player.Listener {
        lateinit var self: Player.Listener
        val handler = InvocationHandler { _, method, args ->
            when (method.name) {
                "equals" -> args?.getOrNull(0) === self
                "hashCode" -> System.identityHashCode(self)
                "toString" -> "RoonPlayer listener for $target"
                "onAvailableCommandsChanged" -> { target.onAvailableCommandsChanged(availableCommands); null }
                "onMediaMetadataChanged" -> { target.onMediaMetadataChanged(mediaMetadata); null }
                else -> try {
                    method.invoke(target, *(args ?: emptyArray()))
                } catch (e: InvocationTargetException) {
                    throw e.targetException
                }
            }
        }
        self = Proxy.newProxyInstance(Player.Listener::class.java.classLoader, arrayOf(Player.Listener::class.java), handler) as Player.Listener
        return self
    }

    companion object {
        private const val JUMP_MS = 2_000L
    }
}
