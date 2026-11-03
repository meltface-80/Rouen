package app.rouen.android

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.SystemClock
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService.LibraryParams
import androidx.media3.session.MediaLibraryService.MediaLibrarySession
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionError
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.Callable
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/**
 * Android Auto (dev/design/android-app.md §4.24, v1.9.72-t81; the owner, 2026-11-03: "add Android auto support to the
 * app Mandarin has this"), after Mandarin's PhonePlayerService.Library. What the car's media screen lists ([CarTree])
 * and what a tap on it plays:
 *
 *  - an album or a playlist of Rouen's: Roon is asked to play it to the phone's own Roon zone ("Rouen <phone>"), with
 *    Rouen's /api/play and /api/playlist/play, as the page does. Roon then opens a session on the phone (§4.23), and the
 *    tap's answer is that session's item, so the car shows Roon's track and its buttons go to Roon as they always do;
 *  - a downloaded album: the phone's own copy, always (the owner: "From the phone's copy"), as LocalPlay plays it.
 *
 * The player ([RoonPlayer]) takes no items from the car: they are what it already holds once Roon or LocalPlay has
 * started. Covers go as bytes (Android Auto can't open Rouen's addresses), four at a time, eight seconds for a list.
 * Everything that asks Rouen runs off the main thread; LocalPlay runs on it.
 */
@OptIn(UnstableApi::class)
class CarLibrary(
    private val context: Context,
    private val api: () -> Api?,
    private val local: LocalPlay,
    private val main: Handler,
    /** The item the phone's player holds now (main thread). */
    private val current: () -> MediaItem?,
) : MediaLibrarySession.Callback {

    // Threads that end when idle, so a service that stops leaves none behind. A tap has its own, never behind a listing.
    private val browse = pool(2)
    private val taps = pool(1)
    private val covers = pool(4)
    /** What each listed id stands for, to play it by the names it was listed with. */
    private val rows = ConcurrentHashMap<String, CarTree.Row>()
    /** The library A–Z, read whole, kept a while. */
    @Volatile private var library: Pair<Long, List<CarTree.Row>>? = null
    /** A tap on one of Rouen's albums, waiting for Roon to open its session on the phone. */
    @Volatile private var pending: SettableFuture<MediaSession.MediaItemsWithStartPosition>? = null
    /** When the car last asked for anything: the player stays up while it is in use (PlayerService.lifeIsOver). */
    @Volatile private var lastUsed = 0L

    /** The session the car browses (main thread). */
    @Volatile private var session: MediaLibrarySession? = null

    /**
     * The car is connected, or asked for something within [ms] (main thread). While Android Auto stays connected the
     * service must not stop: its session would be released under the car, and the car keeps the dead one.
     */
    fun inUse(now: Long, ms: Long): Boolean = (lastUsed != 0L && now - lastUsed < ms) ||
        session?.connectedControllers?.any { it.packageName in CARS } == true

    /** Roon opened a session on the phone (PlayerService, main thread): a tap waiting for it is answered. */
    fun opened(item: MediaItem?) {
        val f = pending ?: return
        pending = null
        if (item != null) f.set(MediaSession.MediaItemsWithStartPosition(listOf(item), 0, C.TIME_UNSET))
        else f.setException(IllegalStateException("no session item"))
    }

    override fun onGetLibraryRoot(
        session: MediaLibrarySession, browser: MediaSession.ControllerInfo, params: LibraryParams?
    ): ListenableFuture<LibraryResult<MediaItem>> {
        lastUsed = SystemClock.elapsedRealtime()
        this.session = session
        // Android Auto's "resume what was playing" asks for a recent root: Roon's queue isn't the phone's to offer.
        if (params?.isRecent == true) return Futures.immediateFuture(LibraryResult.ofError(SessionError.ERROR_NOT_SUPPORTED))
        return Futures.immediateFuture(LibraryResult.ofItem(folder(CarTree.ROOT, "Rouen"), params))
    }

    override fun onGetChildren(
        session: MediaLibrarySession, browser: MediaSession.ControllerInfo, parentId: String,
        page: Int, pageSize: Int, params: LibraryParams?
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
        lastUsed = SystemClock.elapsedRealtime()
        val f = SettableFuture.create<LibraryResult<ImmutableList<MediaItem>>>()
        browse.execute {
            f.set(runCatching { LibraryResult.ofItemList(ImmutableList.copyOf(onePage(children(session, parentId), page, pageSize)), params) }
                .getOrElse { e ->
                    AppLog.line("CAR", "couldn't list $parentId: ${e.message}", anomaly = true)
                    LibraryResult.ofError(SessionError.ERROR_IO)
                })
        }
        return f
    }

    override fun onSetMediaItems(
        mediaSession: MediaSession, controller: MediaSession.ControllerInfo,
        mediaItems: MutableList<MediaItem>, startIndex: Int, startPositionMs: Long
    ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
        lastUsed = SystemClock.elapsedRealtime()
        val id = mediaItems.firstOrNull()?.mediaId ?: ""
        val (kind, rest) = CarTree.kind(id)
        return when (kind) {
            CarTree.DOWNLOAD -> playDownload(rest)
            // Played only by the names it was listed with: an offset alone may name another album by now.
            CarTree.ALBUM, CarTree.PLAYLIST -> rows[id]?.let { playOnRoon(kind, rest.toIntOrNull(), it) }
                ?: Futures.immediateFailedFuture(IllegalStateException("listed before the app restarted: list it again"))
            else -> Futures.immediateFailedFuture(IllegalArgumentException("not playable: $id"))
        }
    }

    /** A downloaded album, from the phone's copy (main thread, where the player is). */
    private fun playDownload(key: String): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
        val f = SettableFuture.create<MediaSession.MediaItemsWithStartPosition>()
        main.post {
            val a = DownloadStore.find(context, key)?.takeIf { it.state == "done" }
            val item = if (a != null && local.play(a, 0)) current() else null
            AppLog.line("CAR", if (item != null) "a downloaded album, from the phone" else "a downloaded album couldn't be played")
            if (item != null) f.set(MediaSession.MediaItemsWithStartPosition(listOf(item), 0, C.TIME_UNSET))
            else f.setException(IllegalStateException("not on the phone"))
        }
        return f
    }

    /**
     * One of Rouen's albums or playlists, played by Roon to the phone's own zone. Answered when Roon opens the session
     * on the phone ([opened]), or failed after 20 seconds.
     */
    private fun playOnRoon(kind: String, offset: Int?, row: CarTree.Row): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
        val a = api() ?: return Futures.immediateFailedFuture(IllegalStateException("Rouen not reached"))
        if (offset == null) return Futures.immediateFailedFuture(IllegalArgumentException("no offset"))
        val f = SettableFuture.create<MediaSession.MediaItemsWithStartPosition>()
        pending?.setException(IllegalStateException("another album was asked for"))
        pending = f
        taps.execute {
            val failed = runCatching {
                val zone = phoneZone(a) ?: throw IllegalStateException("the phone's zone isn't in Roon yet")
                // Given up on (20 seconds) or overtaken by another tap: Roon isn't asked late.
                if (f.isDone) return@execute
                val body = JSONObject().put("offset", offset).put("zone_or_output_id", zone).put("kind", "play_now")
                body.put("title", row.title)
                if (kind == CarTree.ALBUM) body.put("subtitle", row.subtitle)
                val r = a.post(if (kind == CarTree.ALBUM) "/api/play" else "/api/playlist/play", body, 20_000)
                if (r.code !in 200..299) throw IllegalStateException("Rouen answered ${r.code}")
                AppLog.line("CAR", "Roon asked to play ${if (kind == CarTree.ALBUM) "an album" else "a playlist"} to the phone")
                // Roon may play it in the session already open (no new "open" comes): with Roon's session on the
                // player, the tap is answered with it after a moment. The player keeps its item either way.
                main.postDelayed({
                    val now = current()
                    if (pending === f && now != null && !local.on) { pending = null; f.set(MediaSession.MediaItemsWithStartPosition(listOf(now), 0, C.TIME_UNSET)) }
                }, 3_000)
            }.exceptionOrNull()
            if (failed != null) main.post {
                AppLog.line("CAR", "couldn't play: ${failed.message}", anomaly = true)
                if (pending === f) { pending = null; f.setException(failed) }
            }
        }
        main.postDelayed({
            if (pending === f) { pending = null; f.setException(IllegalStateException("Roon didn't start it")) }
        }, 20_000)
        return f
    }

    /** The phone's own Roon zone, by the name Rouen's hello gave it; waited for a few seconds after a cold start. */
    private fun phoneZone(a: Api): String? {
        val name = Prefs.roonZone(context) ?: return null
        repeat(6) { i ->
            val zones = a.get("/api/zones", 10_000).json()?.optJSONArray("zones")
            if (zones != null) for (k in 0 until zones.length()) {
                val z = zones.optJSONObject(k) ?: continue
                if (z.optString("display_name") == name) return z.optString("zone_id").takeIf { it.isNotEmpty() }
            }
            if (i < 5) Thread.sleep(1500)
        }
        return null
    }

    /** One level of the tree (off the main thread: it may ask Rouen). */
    private fun children(session: MediaLibrarySession, parentId: String): List<MediaItem> {
        val reached = api()
        val online = reached != null && reached.cookie() != null && Prefs.roonZone(context) != null
        if (parentId == CarTree.ROOT) {
            if (!online) whenOnline(session)
            return CarTree.root(online).map { (id, title) -> folder(id, title) }
        }
        if (parentId == CarTree.DOWNLOADS) return DownloadStore.all(context).filter { it.state == "done" }
            .sortedBy { it.title.lowercase() }
            .map { d -> playable(CarTree.DOWNLOAD + d.key, d.title, d.artist, coverOf(File(d.dir, "cover.jpg")), MediaMetadata.MEDIA_TYPE_ALBUM) }
        // Rouen's folders: only signed in, in reach, and with the phone's zone known (otherwise the root hides them).
        val a: Api = (if (online) reached else null) ?: return emptyList()
        return when {
            parentId == CarTree.RECENT -> albums(a, CarTree.albums(a.get("/api/home/history", 15_000).json()))
            parentId == CarTree.PICKS -> albums(a, CarTree.picks(a.get("/api/smart-picks", 15_000).json()))
            parentId == CarTree.RANDOM -> albums(a, CarTree.albums(a.get("/api/random-albums?count=20", 15_000).json()))
            parentId == CarTree.PLAYLISTS -> listed(a, CarTree.albums(a.get("/api/playlists", 15_000).json(), "playlists"),
                CarTree.PLAYLIST, MediaMetadata.MEDIA_TYPE_PLAYLIST)
            parentId == CarTree.LIBRARY -> CarTree.chunks(wholeLibrary(a)).map { c -> folder(c.id, c.title) }
            parentId.startsWith(CarTree.CHUNK) -> {
                val from = parentId.removePrefix(CarTree.CHUNK).toIntOrNull() ?: 0
                val all = wholeLibrary(a)
                listed(a, all.subList(from.coerceIn(0, all.size), minOf(from + CarTree.CHUNK_SIZE, all.size)),
                    CarTree.ALBUM, MediaMetadata.MEDIA_TYPE_ALBUM, cover = 150)
            }
            else -> emptyList()
        }
    }

    /** One page of a level, as the car asked for it (Android Auto asks for all of it at once). */
    private fun onePage(all: List<MediaItem>, page: Int, size: Int): List<MediaItem> {
        if (page <= 0 && size >= all.size) return all
        val from = page.toLong() * size
        return if (page < 0 || size <= 0 || from >= all.size) emptyList() else all.subList(from.toInt(), minOf(from + size, all.size.toLong()).toInt())
    }

    /**
     * The car shown the root without Rouen's folders, as when it starts the app cold and Rouen isn't reached yet: for
     * three minutes (Tailscale coming up away from home), once Rouen is, the car is told the root has changed, and it asks
     * again.
     */
    @Volatile private var watching = false
    private fun whenOnline(session: MediaLibrarySession) {
        if (watching) return
        watching = true
        browse.execute {
            try {
                repeat(90) {
                    Thread.sleep(2000)
                    val a = api()
                    if (a != null && a.cookie() != null && Prefs.roonZone(context) != null) {
                        main.post {
                            runCatching { session.notifyChildrenChanged(CarTree.ROOT, CarTree.root(true).size, null) }
                            // A failure means the session was released with the service: no car is left to tell.
                        }
                        return@execute
                    }
                }
            } catch (_: InterruptedException) {
                // The service is going: nothing is waiting for the root any more.
            } finally { watching = false }
        }
    }

    /** The library A–Z, 200 at a time, kept ten minutes. */
    private fun wholeLibrary(a: Api): List<CarTree.Row> {
        library?.let { (at, kept) -> if (SystemClock.elapsedRealtime() - at < 10 * 60_000) return kept }
        val all = ArrayList<CarTree.Row>()
        var offset = 0
        while (true) {
            // Rouen still building its list (503) or out of reach: nothing is kept, the car is told it failed.
            val r = a.get("/api/library/albums?offset=$offset&count=200", 15_000)
            val j = r.json()?.takeIf { r.code in 200..299 } ?: throw IllegalStateException("the library: Rouen answered ${r.code}")
            all.addAll(CarTree.albums(j))
            offset += 200
            if (offset >= j.optInt("total", 0)) break
        }
        library = SystemClock.elapsedRealtime() to all
        return all
    }

    private fun albums(a: Api, list: List<CarTree.Row>): List<MediaItem> = listed(a, list, CarTree.ALBUM, MediaMetadata.MEDIA_TYPE_ALBUM)

    /**
     * Rows as playable items, each with its cover (as many as come in eight seconds, four at a time). [cover] px:
     * Mandarin's 300 for its lists of twenty; smaller for the library's runs of a hundred.
     */
    private fun listed(a: Api, list: List<CarTree.Row>, prefix: String, type: Int, cover: Int = 300): List<MediaItem> {
        val jobs = list.map { r -> Callable { if (r.imageKey.isNotEmpty()) runCatching { a.bytes("/api/image/${r.imageKey}?size=$cover", 8_000) }.getOrNull() else null } }
        val got = runCatching { covers.invokeAll(jobs, 8, TimeUnit.SECONDS) }.getOrDefault(emptyList())
        return list.mapIndexed { i, r ->
            val id = prefix + r.offset
            rows[id] = r
            val art = got.getOrNull(i)?.let { f -> if (f.isCancelled) null else runCatching { f.get() }.getOrNull() }
            playable(id, r.title, r.subtitle, art, type)
        }
    }

    private fun folder(id: String, title: String): MediaItem = MediaItem.Builder()
        .setMediaId(id)
        .setMediaMetadata(MediaMetadata.Builder()
            .setTitle(title).setIsBrowsable(true).setIsPlayable(false)
            .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_ALBUMS).build())
        .build()

    /** Covers go as bytes: Android Auto can't open the phone's files or Rouen's addresses. */
    private fun playable(id: String, title: String, artist: String, art: ByteArray?, type: Int): MediaItem = MediaItem.Builder()
        .setMediaId(id)
        .setMediaMetadata(MediaMetadata.Builder()
            .setTitle(title).setArtist(artist).setAlbumTitle(title)
            .setIsBrowsable(false).setIsPlayable(true)
            .setMediaType(type)
            .apply { art?.let { setArtworkData(it, MediaMetadata.PICTURE_TYPE_FRONT_COVER) } }
            .build())
        .build()

    private companion object {
        /** Android Auto, and Android Automotive's media app. */
        val CARS = setOf("com.google.android.projection.gearhead", "com.android.car.media")
    }

    private fun pool(n: Int) = ThreadPoolExecutor(n, n, 30, TimeUnit.SECONDS, LinkedBlockingQueue<Runnable>())
        .apply { allowCoreThreadTimeOut(true) }

    /** A downloaded album's cover, made small for the car. */
    private fun coverOf(f: File): ByteArray? = runCatching {
        if (!f.exists()) return null
        val bmp = BitmapFactory.decodeFile(f.path, BitmapFactory.Options().apply { inSampleSize = 4 }) ?: return null
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, 85, out)
        out.toByteArray()
    }.getOrNull()
}
