package app.rouen.android

import android.app.PendingIntent
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.webkit.CookieManager
import android.widget.Toast
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
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
import java.net.MalformedURLException
import java.net.URL

/**
 * The phone's player (dev/design/android-app.md §4.8–§4.10): this phone as a Roon zone,
 * through Rouen.
 *
 * Rouen's commands ([PhoneLink]) drive ExoPlayer: `open` plays a session (one growing Ogg Opus
 * or FLAC stream, of unknown length), `pause`, `play`, `stop`, `volume`. What ExoPlayer does
 * goes back as state reports, every second while playing and on every change. The media
 * session shows Roon's track and sends its buttons to Roon ([RoonPlayer]).
 *
 * Opus is decoded by the app's own libopus to float (LibopusAudioRenderer, from Mandarin's
 * app), found by DefaultRenderersFactory ahead of Android's 16-bit decoder.
 *
 * Home or away ([Away], §4.7): the link and the audio use the way to Rouen chosen now. On a
 * switch the link says hello again on the new address, and the player takes the session Roon
 * sends: the same one is kept, what is buffered plays on, and every load of audio from then on
 * goes to the new address (each load's address is moved there as it opens, [rebase]).
 *
 * Lifetime: the service runs while the app is on screen, while a session is open (playing or
 * paused), and for 15 minutes after the last of those; then it stops, and Rouen drops the
 * phone's zone from Roon once it stops polling (§4.9). The way to Rouen is followed, and the
 * built-in Tailscale engine runs, only while the service does.
 */
@OptIn(UnstableApi::class)
class PlayerService : MediaSessionService(), PhoneLink.Host {

    companion object {
        private const val TAG = "RouenPlayer"
        private const val IDLE_MS = 15 * 60_000L
        private const val TICK_MS = 1_000L
        // A session can sit idle (paused in Roon) for a long time: a short read timeout would only reopen it.
        private const val READ_TIMEOUT_MS = 10 * 60_000
        private const val CONNECT_TIMEOUT_MS = 10_000
        private const val LOAD_RETRIES = 40

        @Volatile private var appVisible = false
        @Volatile private var lastVisible = 0L

        /** The service is set up (the server screen stops the engine it started only when not). */
        @Volatile var running = false
            private set

        /** The phone is playing ([Away] keeps the engine ready at home only then). */
        @Volatile var playing = false
            private set

        /** The player in a line, kept each second on the main thread, for the app's log's snapshots (§4.13). */
        @Volatile private var line: String? = null

        /** The player now, for AppLog's snapshot; null when it is not running. */
        fun snapshot(): String? = if (running) line ?: "running, no session yet" else null

        /** One of the app's screens on screen (true) or not. */
        fun setAppVisible(visible: Boolean) {
            appVisible = visible
            lastVisible = SystemClock.elapsedRealtime()
        }
    }

    private val main = Handler(Looper.getMainLooper())
    private var exo: ExoPlayer? = null
    private var roon: RoonPlayer? = null
    private var mediaSession: MediaSession? = null
    private var link: PhoneLink? = null
    @Volatile private var api: Api? = null
    /** The way to Rouen in use ("http://host:port"); read by the audio's loader thread too. */
    @Volatile private var base = ""
    /** The kind of way [base] is (home, or away): which streaming quality hello asks for. */
    @Volatile private var baseKind: Way.Kind? = null
    /** The open session, as Rouen numbered it (null: none). Main thread. */
    private var session: Any? = null
    @Volatile private var sessionIsOpen = false
    /** The session paused or stopped on the phone while Rouen couldn't be reached (null: none), till Roon hears it. Main thread. */
    private var pausedHere: Any? = null
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

    /** The player, its session and the link to Rouen (once the way to it is known). False when no server is chosen yet. */
    private fun setUp(): Boolean {
        if (Prefs.server(this) == null) return false
        lastActive = SystemClock.elapsedRealtime()
        val player = buildPlayer()
        exo = player
        val r = RoonPlayer(player) { op -> ask(op) }
        roon = r
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        // What the player does, in the app's log while it is on (PlayerLog, §4.13); snapshots while it runs.
        player.addAnalyticsListener(PlayerLog())
        AppLog.snapshots("player", true)
        AppLog.line("PLAYER", "the player started")
        val s = MediaSession.Builder(this, r).setSessionActivity(open).build()
        mediaSession = s
        // The notification and lock screen follow a session only once it is added (or a
        // controller connects); playback started by Rouen has no controller, so it is added here.
        addSession(s)
        player.addListener(object : Player.Listener {
            override fun onEvents(player: Player, events: Player.Events) = report()

            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                // Paused by the phone itself (headphones out, a call): Roon is asked to pause too.
                if (!playWhenReady && (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_BECOMING_NOISY ||
                        reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS)) {
                    link?.control("pause")
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                Log.w(TAG, "playback failed: ${error.errorCodeName}", error)
                // Sent to Rouen with the next report, for its trail (/api/debug/phones, v1.9.72-t10).
                lastError = error.errorCodeName + (error.cause?.let { ": " + (it.message ?: it.javaClass.simpleName) } ?: "")
                lastErrorAt = SystemClock.elapsedRealtime()
                report()
            }
        })
        running = true
        Away.listen(onWay)
        Away.start(this)
        Away.active(this)?.let { relink(it); r.setUnreachable(cantReach(it)) }
        Prefs.listen(this, onSetting)
        main.removeCallbacks(tick)
        main.post(tick)
        return true
    }

    /** The way to Rouen chosen (again): the link follows it, and the notification says when Rouen can't be reached (main thread). */
    private val onWay: (Away.Active) -> Unit = { a ->
        if (!destroyed && exo != null && a.server == Prefs.server(this)) {
            relink(a)
            roon?.setUnreachable(cantReach(a))
            // Paused on the phone while Rouen couldn't be reached: Roon is told now (kept till Roon's pause comes back).
            if (a.reach == Way.Reach.YES && pausedHere != null && pausedHere == session) link?.control("pause")
        }
    }

    /** What the notification says in the artist's place on the way [a] (§4.15): null while Rouen is reached. */
    private fun cantReach(a: Away.Active): String? = when (a.reach) {
        Way.Reach.YES -> null
        Way.Reach.CONNECTING -> "Connecting to Rouen…"
        Way.Reach.NO -> "Can't reach Rouen"
    }

    /** One of the phone's own buttons: asked of Roon, or, while Rouen can't be reached, said so (§4.15). */
    private fun ask(op: String) {
        val a = Away.active(this)
        if (a != null && a.reach != Way.Reach.YES) {
            AppLog.line("LINK", "the phone's button: $op, not sent: Rouen can't be reached", anomaly = true)
            notSent(op)
            Away.trouble(this)
            return
        }
        link?.control(op)
    }

    /**
     * [op] did not reach Roon (main thread): said on screen, and a pause or stop done on the phone itself,
     * as when headphones come out, so the music can always be stopped; Roon hears the phone's state
     * when Rouen answers again.
     */
    private fun notSent(op: String) {
        if (destroyed) return
        val here = op == "pause" || op == "stop"
        if (here) { exo?.pause(); pausedHere = session }
        // Short: Android 12 and later cut a toast to two lines. Why is on the screen and in the log.
        Toast.makeText(applicationContext, "Can't reach Rouen: $op not sent." + if (here) " Paused on this phone." else "", Toast.LENGTH_LONG).show()
    }

    /** A streaming quality changed (the page's setting): hello again if it is the one in use (main thread). */
    private val onSetting = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
        if (key == PhoneChoices.HOME_QUALITY || key == PhoneChoices.AWAY_QUALITY) link?.qualityChanged()
    }

    /**
     * The link to Rouen on the way [w]: a new one, which says hello there, when the address changed.
     * Home and away ask for their own quality, so a switch says it again with the other one.
     */
    private fun relink(w: Away.Active) {
        if (link != null && w.base == base) return
        link?.stop()
        base = w.base
        baseKind = w.kind
        val a = Api(w.base, CookieManager.getInstance(), PageRelay.loginBase(w.base))
        api = a
        link = PhoneLink(a, Prefs.deviceId(this), Prefs.name(this), { Prefs.helloQuality(this, baseKind) }, this).also { it.start() }
        Log.i(TAG, "talking to Rouen at ${w.base}")
    }

    /**
     * Each load of a session's audio, as it opens: on the address in use now (a session opened at
     * home and loaded again away goes to the away address), with the login for that address.
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
        val audio = ResolvingDataSource.Factory(factory) { spec -> rebase(spec) }
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
        if (running) AppLog.line("PLAYER", "the player stopped")
        AppLog.snapshots("player", false)
        line = null
        running = false
        playing = false
        Away.unlisten(onWay)
        Prefs.unlisten(this, onSetting)
        Away.stop()
        link?.stop()
        link = null
        api = null
        session = null
        sessionIsOpen = false
        mediaSession?.let { removeSession(it); it.release() }
        mediaSession = null
        exo?.release()
        exo = null
        roon = null
    }

    // ---- PhoneLink.Host: Rouen's side ----------------------------------------------------

    override fun onCommand(cmd: JSONObject) {
        main.post { if (!destroyed) apply(cmd) }
    }

    override fun sessionOpen(): Boolean = sessionIsOpen

    override fun onHello(answer: JSONObject) {
        // Rouen's tailnet address, kept for away from home (the last one given; null: Rouen is on no tailnet).
        val at = if (answer.isNull("away_address")) null else answer.optString("away_address", "")
        if (Prefs.setAwayAddress(this, at)) Away.recheck(this)
        Away.serverSaysAway = if (answer.has("away")) answer.optBoolean("away") else null
    }

    override fun onUnreachable() = Away.trouble(this)

    override fun onControlLost(op: String) {
        main.post { notSent(op) }
    }

    override fun onNow(now: JSONObject, art: ByteArray?) {
        val n = RoonPlayer.Now(
            title = text(now, "title"),
            artist = text(now, "artist"),
            album = text(now, "album"),
            lengthMs = now.optLong("length", 0L),
            seekMs = now.optLong("seek", 0L),
            art = art
        )
        main.post { if (!destroyed && session != null) roon?.setNow(n) }
    }

    private fun text(j: JSONObject, key: String): String = if (j.isNull(key)) "" else j.optString(key, "")

    /** One of Rouen's commands, on the main thread. */
    private fun apply(cmd: JSONObject) {
        val p = exo ?: return
        when (val op = cmd.optString("op")) {
            "open" -> {
                val url = resolve(cmd.optString("url", "")) ?: return
                // The session this phone already has (hello again, after a lost login): kept, not restarted.
                // On a new address too: its audio is fetched from there as each load opens (rebase).
                if (session != null && cmd.opt("session") == session && p.mediaItemCount > 0) {
                    if (p.playbackState == Player.STATE_IDLE) p.prepare()
                    // Paused on the phone while Rouen couldn't be reached: Roon never heard it, so it says play.
                    // The phone stays paused, and Roon is told now (§4.15).
                    if (pausedHere != null && pausedHere == session && cmd.optBoolean("play", true)) {
                        p.playWhenReady = false
                        AppLog.line("LINK", "paused on this phone while Rouen couldn't be reached: Roon told now")
                        link?.control("pause")
                    } else {
                        p.playWhenReady = cmd.optBoolean("play", true)
                    }
                    report()
                    return
                }
                pausedHere = null
                session = cmd.opt("session")
                sessionIsOpen = true
                roon?.clearNow()
                p.setMediaItem(MediaItem.Builder().setUri(url).setMediaId("rouen-session-$session").build())
                p.prepare()
                p.playWhenReady = cmd.optBoolean("play", true)
            }
            "pause" -> { pausedHere = null; p.pause() }
            "play" -> {
                pausedHere = null
                if (p.playbackState == Player.STATE_IDLE && p.mediaItemCount > 0) p.prepare()
                p.play()
            }
            "stop" -> {
                pausedHere = null
                p.stop()
                p.clearMediaItems()
                report()
                session = null
                sessionIsOpen = false
                roon?.clearNow()
            }
            "volume" -> {
                val gain = cmd.optDouble("gain", Double.NaN)
                if (!gain.isNaN()) p.volume = gain.toFloat().coerceIn(0f, 1f)
            }
            else -> Log.w(TAG, "unknown command: $op")
        }
        report()
    }

    /** A session's url, relative to the server as Rouen gives it, made absolute. */
    private fun resolve(url: String): String? {
        if (url.isEmpty()) return null
        return try {
            URL(URL("$base/"), url).toString()
        } catch (e: MalformedURLException) {
            Log.w(TAG, "bad session url: $url")
            null
        }
    }

    /** Where the open session is, as the newest report (main thread). */
    /** The player's last error, told to Rouen with every report in the 5 s after it. */
    private var lastError: String? = null
    private var lastErrorAt = 0L

    private fun report() {
        val p = exo ?: return
        val s = session ?: return
        val state = when (p.playbackState) {
            Player.STATE_IDLE -> "stopped"
            Player.STATE_ENDED -> "ended"
            Player.STATE_BUFFERING -> if (p.playWhenReady) "buffering" else "paused"
            else -> if (p.isPlaying) "playing" else "paused"
        }
        val r = JSONObject()
            .put("session", s)
            .put("position", p.currentPosition)
            .put("state", state)
            .put("buffered", p.bufferedPosition)
        // On every report for 5 s: the link sends only the newest, so one report alone could be overtaken.
        lastError?.let { if (SystemClock.elapsedRealtime() - lastErrorAt < 5_000) r.put("error", it.take(200)) else lastError = null }
        link?.report(r)
    }

    private val tick = object : Runnable {
        override fun run() {
            if (destroyed) return
            val p = exo
            val playing = p != null && p.playWhenReady &&
                (p.playbackState == Player.STATE_READY || p.playbackState == Player.STATE_BUFFERING)
            PlayerService.playing = playing && session != null
            if (playing && session != null) report()
            line = p?.let {
                val st = when (it.playbackState) { Player.STATE_IDLE -> "idle"; Player.STATE_BUFFERING -> "buffering"; Player.STATE_READY -> if (it.isPlaying) "playing" else "paused"; else -> "ended" }
                "$st, session ${session ?: "none"} at ${it.currentPosition} ms, buffered to ${it.bufferedPosition} ms, volume ${it.volume}"
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

    /** True once the app has been off screen, with no session open, for 15 minutes. */
    private fun lifeIsOver(): Boolean {
        val now = SystemClock.elapsedRealtime()
        val p = exo
        val open = session != null && p != null &&
            (p.playbackState == Player.STATE_READY || p.playbackState == Player.STATE_BUFFERING)
        if (appVisible || open) {
            lastActive = now
            return false
        }
        return now - maxOf(lastActive, lastVisible) > IDLE_MS
    }
}
