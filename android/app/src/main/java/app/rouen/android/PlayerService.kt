package app.rouen.android

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.webkit.CookieManager
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import org.json.JSONObject

/**
 * The phone's player (dev/design/android-app.md §4.8, §4.19, §4.22): This phone, the phone's own standalone player.
 *
 * It plays the phone's own ([LocalPlay]): downloaded albums from the phone's storage, and the server's library albums
 * streamed from Rouen's file route (§4.20), with cache-ahead. Since §4.22 (the owner, 2026-10-31: "Scrap Squeezelite")
 * the phone is never a Roon zone: nothing here takes Roon's commands or relays Roon's audio (that was v1.9.72-t5 to
 * t52). The media session — the notification, the lock screen, headsets and Bluetooth — is ExoPlayer's own.
 *
 * Opus is decoded by the app's own libopus to float (LibopusAudioRenderer, from Mandarin's app), found by
 * DefaultRenderersFactory ahead of Android's 16-bit decoder.
 *
 * Home or away ([Away], §4.7): the hello ([PhoneLink]) and the audio use the way to Rouen chosen now. On a switch the
 * link says hello on the new address, and every load of audio from then on goes there (each load's address is moved
 * as it opens, [rebase]).
 *
 * Lifetime: the service runs while the app is on screen, while the phone plays its own, and for 15 minutes after the
 * last of those; then it stops. The way to Rouen is followed, and the built-in Tailscale engine runs, only while the
 * service does.
 */
@OptIn(UnstableApi::class)
class PlayerService : MediaSessionService(), PhoneLink.Host {

    companion object {
        private const val TAG = "RouenPlayer"
        private const val IDLE_MS = 15 * 60_000L
        private const val TICK_MS = 1_000L
        // A streamed track can sit paused for a long time: a short read timeout would only reopen it.
        private const val READ_TIMEOUT_MS = 10 * 60_000
        private const val CONNECT_TIMEOUT_MS = 10_000
        private const val LOAD_RETRIES = 40

        @Volatile private var appVisible = false
        @Volatile private var lastVisible = 0L

        /** The service, while it is set up: the page's play reaches the phone's player through it (§4.19). */
        @Volatile var current: PlayerService? = null
            private set

        /** The service is set up (the server screen stops the engine it started only when not). */
        @Volatile var running = false
            private set

        /** The phone is playing its own ([Away] keeps the engine ready at home only then). */
        @Volatile var playing = false
            private set

        /** The player in a line, kept each second on the main thread, for the app's log's snapshots (§4.13). */
        @Volatile private var line: String? = null

        /** The player now, for AppLog's snapshot; null when it is not running. */
        fun snapshot(): String? = if (running) line ?: "running, nothing played yet" else null

        /** One of the app's screens on screen (true) or not. */
        fun setAppVisible(visible: Boolean) {
            appVisible = visible
            lastVisible = SystemClock.elapsedRealtime()
        }
    }

    private val main = Handler(Looper.getMainLooper())
    private var exo: ExoPlayer? = null
    private var mediaSession: MediaSession? = null
    private var link: PhoneLink? = null
    @Volatile private var api: Api? = null
    /** The way to Rouen in use ("http://host:port"); read by the audio's loader thread too. */
    @Volatile private var base = ""
    /** The kind of way [base] is (home, or away): which streaming quality hello names. */
    @Volatile private var baseKind: Way.Kind? = null
    private var lastActive = SystemClock.elapsedRealtime()
    private var destroyed = false

    override fun onCreate() {
        super.onCreate()
        if (!setUp()) stopSelf()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Started again after an idle stop that has not yet ended the service (a controller
        // still bound): the player is made afresh.
        if (exo == null && !destroyed && !setUp()) stopSelf()
        return super.onStartCommand(intent, flags, startId)
    }

    /** The player, its session and the hello to Rouen (once the way to it is known). False when no server is chosen yet. */
    private fun setUp(): Boolean {
        if (Prefs.server(this) == null) return false
        lastActive = SystemClock.elapsedRealtime()
        val player = buildPlayer()
        exo = player
        current = this
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        // What the player does, in the app's log while it is on (PlayerLog, §4.13); snapshots while it runs.
        player.addAnalyticsListener(PlayerLog())
        AppLog.snapshots("player", true)
        AppLog.line("PLAYER", "the player started")
        val s = MediaSession.Builder(this, player).setSessionActivity(open).build()
        mediaSession = s
        // The notification and lock screen follow a session only once it is added (or a controller connects);
        // playback started from Rouen's page has no controller, so it is added here.
        addSession(s)
        running = true
        Away.listen(onWay)
        Away.start(this)
        Away.active(this)?.let { relink(it) }
        main.removeCallbacks(tick)
        main.post(tick)
        return true
    }

    /** The way to Rouen chosen (again): the hello follows it (main thread). */
    private val onWay: (Away.Active) -> Unit = { a ->
        if (!destroyed && exo != null && a.server == Prefs.server(this)) relink(a)
    }

    /** The hello to Rouen on the way [w]: a new link, which says hello there, when the address changed. */
    private fun relink(w: Away.Active) {
        if (link != null && w.base == base) return
        link?.stop()
        base = w.base
        baseKind = w.kind
        val a = Api(w.base, CookieManager.getInstance(), PageRelay.loginBase(w.base))
        api = a
        link = PhoneLink(a, Prefs.deviceId(this), Prefs.name(this), { Prefs.streamQuality(this, baseKind) }, this).also { it.start() }
        Log.i(TAG, "talking to Rouen at ${w.base}")
    }

    /**
     * Each load of a streamed library album's audio (Rouen's file route, §4.20), as it opens: on the address in use now
     * (a track queued at home and loaded away goes to the away address), with the login for that address.
     */
    private fun rebase(spec: DataSpec): DataSpec {
        val uri = spec.uri
        if (uri.encodedPath?.startsWith("/api/phone/") != true) return spec
        val to = Uri.parse(base)
        val moved = if (to.encodedAuthority.isNullOrEmpty() || uri.encodedAuthority == to.encodedAuthority) uri
            else uri.buildUpon().scheme(to.scheme).encodedAuthority(to.encodedAuthority).build()
        val cookie = api?.cookie()
        val out = spec.withUri(moved)
        return if (cookie != null) out.withAdditionalHeaders(mapOf("Cookie" to cookie)) else out
    }

    private fun buildPlayer(): ExoPlayer {
        val factory = DefaultHttpDataSource.Factory()
            .setConnectTimeoutMs(CONNECT_TIMEOUT_MS)
            .setReadTimeoutMs(READ_TIMEOUT_MS)
            .setUserAgent("RouenAndroid/" + BuildConfig.VERSION_NAME)
        // Rouen's file route over HTTP (a streamed library album); a downloaded album's files from the phone (file://).
        val audio = ResolvingDataSource.Factory(DefaultDataSource.Factory(this, factory)) { spec -> rebase(spec) }
        val renderers = DefaultRenderersFactory(this)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER)
            .setEnableAudioFloatOutput(true)
        // The device's own buffer is the cache (§4.5): up to ten minutes ahead, 64 MB at most.
        val ahead = DefaultLoadControl.Builder()
            .setBufferDurationsMs(60_000, 10 * 60_000, 2_500, 5_000)
            .setTargetBufferBytes(64 * 1024 * 1024)
            .setPrioritizeTimeOverSizeThresholds(false)
            .build()
        return ExoPlayer.Builder(this, renderers)
            .setLoadControl(ahead)
            .setMediaSourceFactory(
                DefaultMediaSourceFactory(audio).setLoadErrorHandlingPolicy(DefaultLoadErrorHandlingPolicy(LOAD_RETRIES))
            )
            .setAudioAttributes(
                AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
                /* handleAudioFocus = */ true
            )
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = mediaSession

    override fun onDestroy() {
        destroyed = true
        main.removeCallbacksAndMessages(null)
        shutdown()
        super.onDestroy()
    }

    private fun shutdown() {
        if (current === this) current = null
        if (running) AppLog.line("PLAYER", "the player stopped")
        AppLog.snapshots("player", false)
        line = null
        running = false
        playing = false
        Away.unlisten(onWay)
        Away.stop()
        link?.stop()
        link = null
        api = null
        mediaSession?.let { removeSession(it); it.release() }
        mediaSession = null
        exo?.release()
        exo = null
    }

    // ---- PhoneLink.Host: Rouen's hello ------------------------------------------------------

    override fun onHello(answer: JSONObject) {
        // Rouen's tailnet address, kept for away from home (the last one given; null: Rouen is on no tailnet).
        val at = if (answer.isNull("away_address")) null else answer.optString("away_address", "")
        if (Prefs.setAwayAddress(this, at)) Away.recheck(this)
        Away.serverSaysAway = if (answer.has("away")) answer.optBoolean("away") else null
    }

    override fun onUnreachable() = Away.trouble(this)

    /** The phone's own play (§4.19, §4.22): [LocalPlay], asked through the bridge. */
    val local = LocalPlay({ exo }) { lastActive = SystemClock.elapsedRealtime() }

    private val tick = object : Runnable {
        override fun run() {
            if (destroyed) return
            val p = exo
            PlayerService.playing = local.on && p != null && p.playWhenReady &&
                (p.playbackState == Player.STATE_READY || p.playbackState == Player.STATE_BUFFERING)
            line = p?.let {
                val st = when (it.playbackState) { Player.STATE_IDLE -> "idle"; Player.STATE_BUFFERING -> "buffering"; Player.STATE_READY -> if (it.isPlaying) "playing" else "paused"; else -> "ended" }
                "$st, " + (if (local.on) "the phone's own, item ${it.currentMediaItemIndex + 1} of ${it.mediaItemCount}" else "nothing loaded") +
                    " at ${it.currentPosition} ms, buffered to ${it.bufferedPosition} ms, volume ${it.volume}"
            }
            if (lifeIsOver()) {
                Log.i(TAG, "idle for 15 minutes: stopping")
                AppLog.line("PLAYER", "idle for 15 minutes: the player stops")
                shutdown()
                stopSelf()
                return
            }
            main.postDelayed(this, TICK_MS)
        }
    }

    /** True once the app has been off screen, with the phone playing nothing of its own, for 15 minutes. */
    private fun lifeIsOver(): Boolean {
        val now = SystemClock.elapsedRealtime()
        if (appVisible || (local.on && exo?.isPlaying == true)) {
            lastActive = now
            return false
        }
        return now - maxOf(lastActive, lastVisible) > IDLE_MS
    }
}
