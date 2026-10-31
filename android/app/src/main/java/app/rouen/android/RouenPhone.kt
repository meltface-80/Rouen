package app.rouen.android

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.Environment
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.lang.ref.WeakReference

/**
 * `window.RouenPhone`: what Rouen's page can ask of the app, only inside the app (as Mandarin's
 * `MusicdDownloads`, meltface-80/Mandarin: android/app/.../DownloadsBridge.kt). The page offers
 * these settings only when the bridge is there, so browsers are unchanged.
 *
 *   RouenPhone.settings()        {"homeQuality", "awayQuality", "network", "downloadQuality",
 *                                 "downloadLocation", "downloadWifiOnly", "downloadLimitGb",
 *                                 "places": [{"id", "label", "free"}],
 *                                 "folder": {"name", "access"}} (the download folder picked, v1.9.72-t34:
 *                                 access none, unmapped, needed, away or granted; [DownloadFolder.access])
 *   RouenPhone.folderPick()      Android's folder picker for the download folder ([FolderPicks]); then, when
 *                                needed, Android's All files access. folderAllow() asks for that access again;
 *                                folderForget() forgets the folder (its albums stay on the phone). The page hears
 *                                what came of them through `window.__rouenPhoneChanged()`.
 *   RouenPhone.set(key, value)   one of [PhoneChoices.KEYS], value as text: the new settings(),
 *                                or {"error": "…"}
 *   RouenPhone.appUpdate()       the app's own update ([AppUpdate], §4.12): {"current", "latest",
 *                                "available", "busy", "error"}
 *   RouenPhone.tailscale()       this phone on the tailnet ([PhoneTailscale], §4.7): {"installed", "on",
 *                                "signedIn", "canSignOut", "hostname", "text", "way"} as last looked;
 *   RouenPhone.tailscaleLook()   look again (the page tells itself so, through __rouenPhoneChanged)
 *   RouenPhone.tailscaleSignIn() / tailscaleSignOut() / tailscaleUse("true"|"false")
 *   RouenPhone.logging()         the app's log ([AppLog], §4.13): {"on", "about", "saving", "saved", "error"}
 *   RouenPhone.loggingUse("true"|"false") / loggingSave() / loggingClear()
 *   RouenPhone.appUpdateCheck()  look for a newer app; appUpdateInstall() fetch and install it.
 *                                Both answer at once; the page hears the outcome through
 *                                `window.__rouenPhoneChanged()`.
 *   RouenPhone.cardCopy(png, name) / cardSave(png, name)
 *                                the share card's Copy image and Download ([CardShare], §4.17):
 *                                its PNG as base64, and its file name; {"ok": true} or {"error": "…"}
 *   RouenPhone.fileSave(data, name)  one of the page's downloads ([SavedFile]: a .musicd, a .log, a backup's
 *                                .json) to the phone's Downloads/Rouen ([DownloadsFolder], §4.17); as above
 *   RouenPhone.albumDownload(title, artist, imageKey)  an album from Rouen to the phone ([Downloader], §4.19):
 *                                the album as below, or {"error": "…"}
 *   RouenPhone.albumState(title, artist)  {"key", "title", "artist", "image_key", "state", "done", "total",
 *                                "quality", "bytes", "error"} (state: queued, downloading, waiting, done,
 *                                failed), or {"state": "none"}
 *   RouenPhone.albumRemove(title, artist)  the album gone from the phone: {"ok": true}
 *   RouenPhone.albums()          every album on the phone or on its way, newest first, each as above.
 *   RouenPhone.album(title, artist)  one, as above with its "tracks": [{"n", "title", "disc", "track", "length"}]
 *                                (offline.js's album page, v1.9.72-t29), or {"state": "none"}
 *   RouenPhone.localPlay(title, artist, from)  the phone's own play (§4.19, [LocalPlay]; offline from v1.9.72-t31, and
 *                                on when Rouen comes back from t32): a downloaded album played on the phone from
 *                                track [from] (0 for the first), Roon not asked: {"ok": true} or {"error": "…"}
 *   RouenPhone.localAdd(title, artist, track, next)  the album (track "") or its track [track] (0 for the first),
 *                                after the track playing (next "1") or at the end of the queue (v1.9.72-t32)
 *   RouenPhone.localState()      what the phone plays: {"state", "index", "count", "position", "length", "title",
 *                                "artist", "album", "key"} (seconds), or {"state": "stopped"}; with "roon_zone", the
 *                                phone's zone in Roon as Rouen named it, once Rouen has said (v1.9.72-t32)
 *   RouenPhone.localQueue()      the queue from the track playing on: [{"id", "title", "artist", "album", "key",
 *                                "length"}] (v1.9.72-t32); localJump(id) plays from one
 *   RouenPhone.localControl(op)  play, pause, playpause, next, previous, stop; localSeek(seconds)
 *                                The page hears each move through `window.__rouenDownloadsChanged()`.
 *
 * The streaming qualities take effect at once ([PlayerService] says hello again with the one in
 * use, and Rouen applies it from the next session Roon starts). The download settings are the
 * downloads' own (§4.19). Whatever the app itself changes (the way to Rouen, the
 * server screen), the page hears through `window.__rouenPhoneChanged()` ([MainActivity]).
 *
 * Every method answers only while the page in the WebView is Rouen's own ([origin], kept by
 * MainActivity as each page starts): any other page gets {"error"}. Called on the WebView's
 * JavaScript thread, never the main one.
 */
class RouenPhone(context: Context) {
    companion object { const val NAME = "RouenPhone" }

    private val c = context.applicationContext

    /** The activity the app's update is installed from (MainActivity). */
    @Volatile var activity: WeakReference<Activity>? = null
    private val main = Handler(Looper.getMainLooper())

    /** The origin ("host:port") of the page now in the WebView. */
    @Volatile var origin: String? = null

    /** The settings as the page last had them ([signature]; null: it has not asked yet). */
    @Volatile private var lastSent: String? = null

    @JavascriptInterface
    fun settings(): String {
        if (!allowed()) return refused()
        lastSent = signature()
        return now()
    }

    @JavascriptInterface
    fun set(key: String?, value: String?): String {
        if (!allowed()) return refused()
        val k = key ?: ""
        val v = value ?: ""
        val parsed = PhoneChoices.parse(k, v, places().map { it.first })
            ?: return JSONObject().put("error", PhoneChoices.refusal(k, v)).toString()
        Prefs.setChoice(c, k, parsed)
        lastSent = signature()
        return now()
    }

    @JavascriptInterface
    fun folderPick(): String = onPicks { it.pickDownloads() }

    @JavascriptInterface
    fun folderAllow(): String = onPicks { it.askAllFiles() }

    @JavascriptInterface
    fun folderForget(): String {
        if (!allowed()) return refused()
        PhoneFolders.forgetDownload(c)
        lastSent = signature()
        return now()
    }

    /** [f] with the activity's folder picker, on the main thread: {} at once, or {"error"} without the activity. */
    private fun onPicks(f: (FolderPicks) -> Unit): String {
        if (!allowed()) return refused()
        val picks = FolderPicks.current?.get() ?: return JSONObject().put("error", "The app isn't on screen.").toString()
        main.post { f(picks) }
        return "{}"
    }

    @JavascriptInterface
    fun tailscale(): String = if (!allowed()) refused() else PhoneTailscale.statusJson(c)

    /** Look again; the answer comes through window.__rouenPhoneChanged (so reading it there never asks again). */
    @JavascriptInterface
    fun tailscaleLook(): String {
        if (!allowed()) return refused()
        PhoneTailscale.look(c)
        return "{}"
    }

    @JavascriptInterface
    fun tailscaleSignIn(): String {
        if (!allowed()) return refused()
        PhoneTailscale.signIn(c) { url ->
            val a = activity?.get()
            if (a != null && !a.isFinishing && !a.isDestroyed) {
                try {
                    a.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                } catch (e: ActivityNotFoundException) {
                    // No browser: the page shows the state, and the server screen's sign-in says the same.
                }
            }
        }
        return PhoneTailscale.statusJson(c)
    }

    @JavascriptInterface
    fun tailscaleSignOut(): String {
        if (!allowed()) return refused()
        PhoneTailscale.signOut(c)
        return PhoneTailscale.statusJson(c)
    }

    @JavascriptInterface
    fun tailscaleUse(on: String?): String {
        if (!allowed()) return refused()
        PhoneTailscale.use(c, on == "true")
        return PhoneTailscale.statusJson(c)
    }

    @JavascriptInterface
    fun logging(): String = if (!allowed()) refused() else loggingJson()

    private fun loggingJson(): String = JSONObject()
        .put("on", AppLog.on)
        .put("about", if (AppLog.on) AppLog.about() else "")
        .put("saving", AppLog.saving)
        .put("saved", AppLog.saved ?: JSONObject.NULL)
        .put("error", AppLog.saveError ?: JSONObject.NULL)
        .toString()

    @JavascriptInterface
    fun loggingUse(on: String?): String {
        if (!allowed()) return refused()
        AppLog.switch(c, on == "true")
        return loggingJson()
    }

    /** Save to Downloads/Rouen: answers at once; the outcome comes through window.__rouenPhoneChanged. */
    @JavascriptInterface
    fun loggingSave(): String {
        if (!allowed()) return refused()
        val a = activity?.get() ?: return JSONObject().put("error", "the app is not on screen").toString()
        val base = Away.active(c)?.base?.let { PageRelay.loginBase(it) }
        main.post { AppLog.save(a, base) }
        return loggingJson()
    }

    @JavascriptInterface
    fun loggingClear(): String {
        if (!allowed()) return refused()
        AppLog.clear()
        return loggingJson()
    }

    @JavascriptInterface
    fun appUpdate(): String = if (!allowed()) refused() else AppUpdate.statusJson()

    @JavascriptInterface
    fun appUpdateCheck(): String {
        if (!allowed()) return refused()
        AppUpdate.lookup()
        return AppUpdate.statusJson()
    }

    @JavascriptInterface
    fun appUpdateInstall(): String {
        if (!allowed()) return refused()
        val a = activity?.get() ?: return JSONObject().put("error", "the app is not on screen").toString()
        main.post { AppUpdate.install(a) }
        return AppUpdate.statusJson()
    }

    @JavascriptInterface
    fun cardCopy(png: String?, name: String?): String = card(png, name) { bytes, file -> CardShare.copy(c, bytes, file) }

    @JavascriptInterface
    fun cardSave(png: String?, name: String?): String = card(png, name) { bytes, file ->
        val a = activity?.get() ?: return@card "the app is not on screen"
        CardShare.save(a, bytes, file)
    }

    @JavascriptInterface
    fun albumDownload(title: String?, artist: String?, imageKey: String?): String {
        if (!allowed()) return refused()
        val t = title?.trim().orEmpty()
        if (t.isEmpty()) return JSONObject().put("error", "the album has no title").toString()
        return try {
            DownloadStore.json(Downloader.start(c, t, artist?.trim().orEmpty(), imageKey.orEmpty())).toString()
        } catch (e: java.io.IOException) {
            JSONObject().put("error", "Couldn't keep it on the phone: ${e.message ?: e.javaClass.simpleName}").toString()
        }
    }

    @JavascriptInterface
    fun albumState(title: String?, artist: String?): String {
        if (!allowed()) return refused()
        val a = DownloadStore.find(c, DownloadPlan.key(title.orEmpty(), artist.orEmpty()))
            ?: return JSONObject().put("state", "none").toString()
        return DownloadStore.json(a).toString()
    }

    @JavascriptInterface
    fun albumRemove(title: String?, artist: String?): String {
        if (!allowed()) return refused()
        Downloader.remove(c, DownloadPlan.key(title.orEmpty(), artist.orEmpty()))
        return JSONObject().put("ok", true).toString()
    }

    @JavascriptInterface
    fun album(title: String?, artist: String?): String {
        if (!allowed()) return refused()
        val a = DownloadStore.find(c, DownloadPlan.key(title.orEmpty(), artist.orEmpty()))
            ?: return JSONObject().put("state", "none").toString()
        return DownloadStore.json(a, tracks = true).toString()
    }

    @JavascriptInterface
    fun localPlay(title: String?, artist: String?, from: String?): String {
        if (!allowed()) return refused()
        val a = downloaded(title, artist) ?: return JSONObject().put("error", "Not on this phone.").toString()
        val p = player() ?: return JSONObject().put("error", "The phone's player couldn't start.").toString()
        val ok = onMain { p.local.play(a, from?.toIntOrNull() ?: 0) } ?: false
        return (if (ok) JSONObject().put("ok", true) else JSONObject().put("error", "It couldn't be played.")).toString()
    }

    @JavascriptInterface
    fun localAdd(title: String?, artist: String?, track: String?, next: String?): String {
        if (!allowed()) return refused()
        val a = downloaded(title, artist) ?: return JSONObject().put("error", "Not on this phone.").toString()
        val p = player() ?: return JSONObject().put("error", "The phone's player couldn't start.").toString()
        val ok = onMain { p.local.add(a, track?.toIntOrNull(), next == "1") } ?: false
        return (if (ok) JSONObject().put("ok", true) else JSONObject().put("error", "It couldn't be queued.")).toString()
    }

    /**
     * The split head (§4.20, v1.9.72-t36, owner's "B"): away from home, a local library album played on the phone's
     * own player, streamed from Rouen (not through Roon's zone), with cache-ahead. [albumJson] is the album as the
     * page has it from GET /api/phone/album ({"title", "artist", "tracks": [{"n", "title", "disc", "track",
     * "length"}]}); [from] is the page's track index (0 for the first). The tracks' audio is Rouen's file route, which
     * ExoPlayer rebases to the address in use with the login ([PlayerService.rebase]), at the away streaming quality
     * (lossless → the file as it is, Opus → Opus 256). Only away: at home a library album plays through Roon, so this
     * answers {"error": "home"} and the page routes to Roon instead. Roon's play count follows in B2.
     */
    @JavascriptInterface
    fun playLibrary(albumJson: String?, from: String?): String {
        if (!allowed()) return refused()
        if (Away.active(c)?.kind == Way.Kind.HOME) return JSONObject().put("error", "home").toString()
        val j = try { JSONObject(albumJson ?: "") } catch (e: org.json.JSONException) { return JSONObject().put("error", "bad album").toString() }
        val title = j.optString("title").trim()
        val artist = j.optString("artist").trim()
        val arr = j.optJSONArray("tracks") ?: JSONArray()
        if (title.isEmpty() || arr.length() == 0) return JSONObject().put("error", "Not one of this server's own albums.").toString()
        val quality = Prefs.choice(c, PhoneChoices.AWAY_QUALITY) as String
        val enc = { s: String -> java.net.URLEncoder.encode(s, "UTF-8") }
        val stream = "/api/phone/album/file?title=${enc(title)}&artist=${enc(artist)}&quality=${if (quality == Prefs.LOSSLESS) "original" else "opus"}"
        val tracks = (0 until arr.length()).map { i ->
            val t = arr.getJSONObject(i)
            DownloadStore.Track(t.optInt("n", i + 1), t.optString("title"), t.optInt("disc", 1), t.optInt("track"),
                t.optInt("length"), 0L, "", "", done = true)
        }
        // The album's Roon image key (the page sends it, v1.9.72-t38), so Now playing shows the cover away.
        val imageKey = j.optString("image_key")
        val a = DownloadStore.Album(DownloadPlan.key(title, artist), title, artist, imageKey, quality, "done", tracks, "",
            System.currentTimeMillis(), c.filesDir, stream)
        val p = player() ?: return JSONObject().put("error", "The phone's player couldn't start.").toString()
        val ok = onMain { p.local.play(a, from?.toIntOrNull() ?: 0) } ?: false
        return (if (ok) JSONObject().put("ok", true) else JSONObject().put("error", "It couldn't be played.")).toString()
    }

    @JavascriptInterface
    fun localState(): String {
        if (!allowed()) return refused()
        val zone = Prefs.roonZone(c) ?: JSONObject.NULL
        val p = PlayerService.current ?: return JSONObject().put("state", "stopped").put("roon_zone", zone).toString()
        val s = onMain { p.local.state() } ?: JSONObject().put("state", "stopped")
        return s.put("roon_zone", zone).toString()
    }

    @JavascriptInterface
    fun localQueue(): String {
        if (!allowed()) return refused()
        val p = PlayerService.current ?: return "[]"
        return (onMain { p.local.queue() } ?: org.json.JSONArray()).toString()
    }

    @JavascriptInterface
    fun localJump(id: String?): String {
        if (!allowed()) return refused()
        val p = PlayerService.current ?: return JSONObject().put("error", "Nothing is playing on this phone.").toString()
        val i = id?.toIntOrNull() ?: return JSONObject().put("error", "id, please").toString()
        onMain { p.local.jump(i) }
        return JSONObject().put("ok", true).toString()
    }

    @JavascriptInterface
    fun localControl(op: String?): String {
        if (!allowed()) return refused()
        val p = PlayerService.current ?: return JSONObject().put("error", "Nothing is playing on this phone.").toString()
        onMain { p.local.control(op.orEmpty()) }
        return JSONObject().put("ok", true).toString()
    }

    @JavascriptInterface
    fun localSeek(seconds: String?): String {
        if (!allowed()) return refused()
        val p = PlayerService.current ?: return JSONObject().put("error", "Nothing is playing on this phone.").toString()
        val s = seconds?.toDoubleOrNull() ?: return JSONObject().put("error", "seconds, please").toString()
        onMain { p.local.seek(s) }
        return JSONObject().put("ok", true).toString()
    }

    /** The album wholly on the phone, by the page's title and artist. */
    private fun downloaded(title: String?, artist: String?): DownloadStore.Album? =
        DownloadStore.find(c, DownloadPlan.key(title.orEmpty(), artist.orEmpty()))?.takeIf { it.state == "done" }

    /** [f] on the main thread, where the player is, its answer waited for (2 s at most; null when it didn't come). */
    private fun <T> onMain(f: () -> T): T? {
        val latch = java.util.concurrent.CountDownLatch(1)
        val out = java.util.concurrent.atomic.AtomicReference<T?>(null)
        main.post { try { out.set(f()) } finally { latch.countDown() } }
        latch.await(2, java.util.concurrent.TimeUnit.SECONDS)
        return out.get()
    }

    /** The phone's player, started when it isn't running (an offline play can be the first thing it does). */
    private fun player(): PlayerService? {
        PlayerService.current?.let { return it }
        try {
            c.startService(android.content.Intent(c, PlayerService::class.java))
        } catch (e: IllegalStateException) {
            return null   // Android refused a start from the background: the page is on screen when it asks, so rare
        }
        val until = android.os.SystemClock.elapsedRealtime() + 3_000
        while (android.os.SystemClock.elapsedRealtime() < until) {
            PlayerService.current?.let { return it }
            Thread.sleep(50)
        }
        return null
    }

    @JavascriptInterface
    fun albums(): String {
        if (!allowed()) return refused()
        val list = org.json.JSONArray()
        for (a in DownloadStore.all(c)) list.put(DownloadStore.json(a))
        return list.toString()
    }

    @JavascriptInterface
    fun fileSave(data: String?, name: String?): String {
        if (!allowed()) return refused()
        val f = SavedFile.accept(data, name) ?: return JSONObject().put("error", SavedFile.refusal(data, name)).toString()
        val a = activity?.get() ?: return JSONObject().put("error", "the app is not on screen").toString()
        if (!DownloadsFolder.mayWrite(a)) return JSONObject().put("error", "Allow Rouen to save to the phone's storage, then try again").toString()
        return try {
            DownloadsFolder.write(a, f.bytes, f.name, f.mime)
            JSONObject().put("ok", true).put("name", f.name).toString()
        } catch (e: java.io.IOException) {
            JSONObject().put("error", "Couldn't save it: ${e.message ?: e.javaClass.simpleName}").toString()
        } catch (e: SecurityException) {
            JSONObject().put("error", "Couldn't save it: Android refused the storage").toString()
        }
    }

    /** One of the card's acts, on what the page sent once it is a PNG ([CardFile]): {"ok": true} or {"error": why not}. */
    private fun card(png: String?, name: String?, act: (ByteArray, String) -> String?): String {
        if (!allowed()) return refused()
        val bytes = CardFile.decode(png) ?: return JSONObject().put("error", "that is not the card's picture").toString()
        val why = act(bytes, CardFile.safeName(name))
        return if (why == null) JSONObject().put("ok", true).toString() else JSONObject().put("error", why).toString()
    }

    /**
     * Has something the page shows changed since it last asked (the app's own change: the way to
     * Rouen, the server screen)? Then the page is to be told; free space alone does not count.
     */
    fun changedForPage(): Boolean {
        val was = lastSent ?: return false
        val sig = signature()
        if (sig == was) return false
        lastSent = sig
        return true
    }

    /** What the page shows, but free space. */
    private fun signature(): String =
        PhoneChoices.KEYS.joinToString(",") { "$it=${Prefs.choice(c, it)}" } +
            ",network=" + PhoneChoices.network(Away.active(c)?.kind, Away.hasNetwork(c)) +
            ",places=" + places().joinToString("|") { it.first } +
            ",folder=" + PhoneFolders.downloadName(c) + ":" + PhoneFolders.downloadAccess(c)

    /** The settings now, as JSON text. */
    private fun now(): String {
        val o = JSONObject()
        for (k in PhoneChoices.KEYS) o.put(k, Prefs.choice(c, k))
        o.put("network", PhoneChoices.network(Away.active(c)?.kind, Away.hasNetwork(c)))
        val list = JSONArray()
        for ((id, label, free) in places()) list.put(JSONObject().put("id", id).put("label", label).put("free", free))
        o.put("places", list)
        o.put("folder", JSONObject().put("name", PhoneFolders.downloadName(c) ?: JSONObject.NULL).put("access", PhoneFolders.downloadAccess(c)))
        return o.toString()
    }

    private fun allowed(): Boolean {
        val at = origin ?: return false
        return Away.origins(c).any { it.equals(at, ignoreCase = true) }
    }

    private fun refused(): String = JSONObject().put("error", "only Rouen's own page may ask").toString()

    /**
     * Phone storage, an SD card when there is one, and the folder picked when downloads can be written there
     * (v1.9.72-t34): (id, label, free bytes). As Mandarin's DownloadStore.places.
     */
    private fun places(): List<Triple<String, String, Long>> {
        val dirs = c.getExternalFilesDirs("music").toList()
        val out = ArrayList<Triple<String, String, Long>>()
        dirs.forEachIndexed { i, d ->
            if (d == null) return@forEachIndexed
            val removable = i > 0 && try { Environment.isExternalStorageRemovable(d) } catch (e: IllegalArgumentException) { true }
            if (i == 0) out += Triple("phone", "Phone storage", free(d))
            else if (removable && out.none { it.first == "sd" }) out += Triple("sd", "SD card", free(d))
        }
        if (out.none { it.first == "phone" }) out.add(0, Triple("phone", "Phone storage", free(File(c.filesDir, "music"))))
        PhoneFolders.downloadPlace(c)?.let { d -> out += Triple(DownloadFolder.PLACE, PhoneFolders.downloadName(c) ?: d.name, free(d)) }
        return out
    }

    private fun free(d: File): Long = try { d.usableSpace } catch (e: SecurityException) { 0L }
}
