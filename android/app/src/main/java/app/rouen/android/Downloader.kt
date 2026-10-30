package app.rouen.android

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import org.json.JSONException
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Downloads albums from Rouen to the phone, one at a time (dev/design/android-app.md §4.19, v1.9.72-t28), as
 * Mandarin's DownloadWorker does: the album's tracks from Rouen (GET /api/phone/album), its cover, then each track
 * in turn (GET /api/phone/album/file), each to a .part file first that resumes where it stopped, taking its name
 * only when whole. Wi-Fi only by default; on mobile data it waits for Wi-Fi. When Rouen can't be reached it tries
 * again a minute later. It runs while the app's process does; an album left part way goes on when the app is next
 * opened ([resumeAll], from MainActivity).
 *
 * Only Rouen's own files: an album Rouen can't find in /music (TIDAL, Qobuz) is refused there, and says so here.
 */
object Downloader {
    /** Called on the main thread whenever an album's state moves: the page hears (MainActivity). */
    @Volatile var changed: (() -> Unit)? = null

    private val pool = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "rouen-downloads").apply { isDaemon = true } }
    private val main = Handler(Looper.getMainLooper())
    private val queued = LinkedHashSet<String>()
    /** The album being removed: its download stops between two reads. */
    @Volatile private var cancelled: String? = null
    @Volatile private var watching = false

    private class Refused(message: String) : Exception(message)

    /** Download the album (again, if it failed before). Throws [IOException] when it can't be kept on the phone. */
    fun start(c: Context, title: String, artist: String, imageKey: String): DownloadStore.Album {
        val app = c.applicationContext
        val key = DownloadPlan.key(title, artist)
        val had = DownloadStore.find(app, key)
        val a = when {
            had == null -> DownloadStore.Album(key, title, artist, imageKey, Prefs.choice(app, PhoneChoices.DOWNLOAD_QUALITY) as String,
                "queued", emptyList(), "", System.currentTimeMillis(), DownloadStore.newDir(app, key))
            had.state == "failed" -> had.copy(state = "queued", error = "")
            else -> had
        }
        DownloadStore.save(a)
        AppLog.line("DOWNLOAD", "asked for \"${a.title}\" (${a.quality})")
        enqueue(app, key)
        tell()
        return a
    }

    /** Every album left part way, on its way again (the app opened, Wi-Fi back). Read off the main thread. */
    fun resumeAll(c: Context) {
        val app = c.applicationContext
        pool.execute { for (a in DownloadStore.all(app)) if (a.state != "done" && a.state != "failed") enqueue(app, a.key) }
    }

    /** The album gone from the phone: its download stopped first, if it is the one going. */
    fun remove(c: Context, key: String) {
        val app = c.applicationContext
        cancelled = key
        synchronized(queued) { queued.remove(key) }
        pool.execute {
            DownloadStore.remove(app, key)
            if (cancelled == key) cancelled = null
            AppLog.line("DOWNLOAD", "an album removed from the phone")
            tell()
        }
    }

    private fun enqueue(app: Context, key: String) {
        synchronized(queued) { if (!queued.add(key)) return }
        if (cancelled == key) cancelled = null
        pool.execute { run(app, key) }
    }

    private fun later(app: Context, key: String) {
        synchronized(queued) { if (!queued.add(key)) return }
        pool.schedule({ run(app, key) }, 60, TimeUnit.SECONDS)
    }

    private fun tell() { main.post { changed?.invoke() } }

    private fun set(a: DownloadStore.Album, state: String, error: String): DownloadStore.Album {
        val b = a.copy(state = state, error = error)
        try { DownloadStore.save(b) } catch (e: IOException) {
            AppLog.line("DOWNLOAD", "\"${a.title}\" couldn't be kept: ${e.message}", anomaly = true)
        }
        tell()
        return b
    }

    private fun run(app: Context, key: String) {
        synchronized(queued) { queued.remove(key) }
        var a = DownloadStore.find(app, key) ?: return
        if (a.state == "done" || cancelled == key) return
        if (Prefs.choice(app, PhoneChoices.DOWNLOAD_WIFI_ONLY) as Boolean && metered(app)) {
            set(a, "waiting", "Waiting for Wi-Fi")
            watchForWifi(app)
            return
        }
        val way = Away.active(app)
        if (way == null) { set(a, "waiting", "Waiting for Rouen"); later(app, key); return }
        val api = Api(way.base, CookieManager.getInstance(), PageRelay.loginBase(way.base))
        try {
            a = set(a, "downloading", "")
            if (a.tracks.isEmpty()) {
                a = tracksOf(app, api, a)
                DownloadStore.save(a)
            }
            val cover = File(a.dir, "cover.jpg")
            if (!cover.isFile && a.imageKey.isNotEmpty()) {
                api.bytes("/api/image/" + URLEncoder.encode(a.imageKey, "UTF-8") + "?size=600", 30_000)?.let { cover.writeBytes(it) }
            }
            for (t in a.tracks) {
                if (t.done) continue
                if (!fetch(api, a, t)) return   // removed part way
                a = a.copy(tracks = a.tracks.map { if (it.n == t.n) it.copy(done = true) else it })
                DownloadStore.save(a)
                tell()
            }
            set(a, "done", "")
            AppLog.line("DOWNLOAD", "\"${a.title}\" is on the phone: ${a.tracks.size} tracks")
        } catch (e: Refused) {
            set(a, "failed", e.message ?: "Rouen refused it")
            AppLog.line("DOWNLOAD", "\"${a.title}\" refused: ${e.message}", anomaly = true)
        } catch (e: JSONException) {
            set(a, "failed", "Rouen's answer couldn't be read")
        } catch (e: IOException) {
            if (cancelled == key) return
            set(a, "waiting", "Rouen couldn't be reached; trying again")
            AppLog.line("DOWNLOAD", "\"${a.title}\" stopped: ${e.javaClass.simpleName}: ${e.message}; again in a minute", anomaly = true)
            later(app, key)
        }
    }

    /** The album's tracks as Rouen gives them, within the size limit. */
    private fun tracksOf(app: Context, api: Api, a: DownloadStore.Album): DownloadStore.Album {
        val r = api.get("/api/phone/album?" + DownloadPlan.query(a.title, a.artist), 60_000)
        val j = r.json()
        if (r.code != 200 || j == null) throw Refused(j?.optString("error")?.ifEmpty { null } ?: "Rouen answered ${r.code}")
        val ts = j.getJSONArray("tracks")
        val tracks = (0 until ts.length()).map { i ->
            val t = ts.getJSONObject(i)
            val n = t.getInt("n")
            val ext = t.optString("ext")
            DownloadStore.Track(n, t.optString("title"), t.optInt("disc", 1), t.optInt("track"), t.optInt("length"),
                t.optLong("bytes"), ext, DownloadPlan.trackName(n, ext, a.quality), false)
        }
        if (tracks.isEmpty()) throw Refused("Rouen has no tracks for it")
        val limit = Prefs.choice(app, PhoneChoices.DOWNLOAD_LIMIT_GB) as Int
        val need = DownloadPlan.estimate(tracks.map { it.bytes }, tracks.map { it.length }, a.quality)
        if (!DownloadPlan.fits(limit, DownloadStore.used(app), need)) throw Refused("It would take the downloads past the $limit GB limit")
        return a.copy(tracks = tracks)
    }

    /** Track [t] into its file; false when the album was removed part way. */
    private fun fetch(api: Api, a: DownloadStore.Album, t: DownloadStore.Track): Boolean {
        val file = File(a.dir, t.file)
        val part = File(a.dir, t.file + ".part")
        val range = DownloadPlan.range(part.length(), a.quality)
        val conn = api.download("/api/phone/album/file?" + DownloadPlan.query(a.title, a.artist) + "&n=${t.n}&quality=${a.quality}", range, 120_000)
        try {
            val answer = DownloadPlan.answer(conn.responseCode, range)
            if (answer == DownloadPlan.Answer.FAIL) {
                val why = conn.errorStream?.bufferedReader()?.use { it.readText() }
                throw if (conn.responseCode in 400..499) Refused("Rouen refused track ${t.n}: " + (why ?: conn.responseCode.toString()).take(200))
                else IOException("Rouen answered ${conn.responseCode} for track ${t.n}")
            }
            if (answer != DownloadPlan.Answer.WHOLE) {
                conn.inputStream.use { input ->
                    FileOutputStream(part, answer == DownloadPlan.Answer.APPEND).use { out ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            if (cancelled == a.key) return false
                            val n = input.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n)
                        }
                    }
                }
            }
        } finally {
            conn.disconnect()
        }
        if (!part.renameTo(file)) throw IOException("track ${t.n} couldn't be kept")
        return true
    }

    private fun metered(app: Context): Boolean =
        (app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).isActiveNetworkMetered

    /** On Wi-Fi again (a network that isn't metered), what waited for it goes on. */
    private fun watchForWifi(app: Context) {
        if (watching) return
        watching = true
        val cm = app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)) resumeAll(app)
            }
        })
    }
}
