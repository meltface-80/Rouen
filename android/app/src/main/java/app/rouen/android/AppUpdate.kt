package app.rouen.android

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

/**
 * The app keeps itself up to date (dev/design/android-app.md §4.12, v1.9.72-t9), as Mandarin's does (its
 * AppUpdate.kt): it looks for a newer APK, downloads it, checks its SHA-256, and hands it to Android's installer —
 * the same signing key every time, so nothing is uninstalled.
 *
 * Where it looks: Rouen never commits a build, so the JSON Mandarin commits beside its APK ({version, url, sha256})
 * rides with the APK instead — rouen-android.json on the newest release (which is never a pre-release), and
 * rouen-android-test.json on the test-android pre-release. A test build (X.Y.Z-tN) is offered the newer of the two,
 * a release build releases only.
 *
 * When: once each time the app starts ([lookup] from MainActivity), and when the page's Settings → Updates opens
 * (the bridge's appUpdateCheck). The page reads [statusJson]; [changed] tells it when something moved.
 */
object AppUpdate {
    private const val TAG = "RouenUpdate"
    private const val RELEASE = "https://github.com/meltface-80/Rouen/releases/latest/download/rouen-android.json"
    private const val TEST = "https://github.com/meltface-80/Rouen/releases/download/test-android/rouen-android-test.json"

    class Release(val version: String, val url: String, val sha256: String)

    private val work = Executors.newSingleThreadExecutor { r -> Thread(r, "app-update").apply { isDaemon = true } }
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var known: Release? = null
    @Volatile private var looking = false
    @Volatile private var busy = false
    @Volatile private var error: String? = null

    /** Called on the main thread whenever the status changed (the page repaints). */
    @Volatile var changed: (() -> Unit)? = null

    private val current get() = BuildConfig.VERSION_NAME
    private fun isTest(v: String) = Regex("-t\\d+$").containsMatchIn(v)

    /** For the page: {"current", "latest", "available", "busy", "error"}. */
    fun statusJson(): String {
        val r = known
        return JSONObject().put("current", current)
            .put("latest", r?.version ?: JSONObject.NULL)
            .put("available", r != null && compare(r.version, current) > 0)
            .put("busy", busy || looking)
            .put("error", error ?: JSONObject.NULL)
            .toString()
    }

    /** Look for a newer app, off the main thread. */
    fun lookup() {
        if (looking || busy) return
        looking = true
        error = null
        tell()
        work.execute {
            val found = mutableListOf<Release>()
            var failed: String? = null
            for (url in if (isTest(current)) listOf(TEST, RELEASE) else listOf(RELEASE)) {
                try {
                    read(url)?.let { found += it }
                } catch (e: IOException) {
                    failed = "Couldn't look for an update: ${e.message}"
                    Log.i(TAG, "$url: ${e.message}")
                }
            }
            known = found.maxWithOrNull { a, b -> compare(a.version, b.version) }
            // A source not there yet (no release carries the app before the first one) is not a failure on its own.
            error = if (found.isEmpty()) failed else null
            looking = false
            tell()
        }
    }

    /** Update: fetch the newer app and hand it to Android's installer. */
    fun install(activity: Activity) {
        val r = known
        if (busy || r == null || compare(r.version, current) <= 0 || gone(activity)) return
        busy = true
        error = null
        tell()
        val dest = File(File(activity.cacheDir, "updates").apply { mkdirs() }, "rouen-${r.version}.apk")
        work.execute {
            val result = runCatching {
                dest.parentFile?.listFiles()?.forEach { if (it != dest) it.delete() }   // only the newest is kept
                if (!(dest.exists() && (r.sha256.isEmpty() || sha256(dest) == r.sha256))) {
                    fetch(r.url, dest)
                    if (r.sha256.isNotEmpty() && sha256(dest) != r.sha256) {
                        dest.delete()
                        throw IOException("the download was damaged — try again")
                    }
                }
            }
            main.post {
                busy = false
                result.onFailure { error = "Couldn't download the update: ${it.message ?: "no answer"}" }
                tell()
                if (result.isSuccess && !gone(activity)) handOver(activity, dest)
            }
        }
    }

    /** [activity] closed or destroyed meanwhile (the phone turned): no dialog and no installer from it. */
    private fun gone(a: Activity) = a.isFinishing || a.isDestroyed

    /** Android's installer — which asks, once, to allow installs from Rouen. */
    private fun handOver(activity: Activity, apk: File) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
            AlertDialog.Builder(activity)
                .setTitle("Allow Rouen to install updates")
                .setMessage("Android asks once: turn on \"Allow from this source\" for Rouen, come back, and tap Update again.")
                .setPositiveButton("Open settings") { _, _ ->
                    runCatching {
                        activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
                    }
                }
                .setNegativeButton("Cancel", null)
                .show()
            return
        }
        val uri = FileProvider.getUriForFile(activity, activity.packageName + ".updates", apk)
        runCatching {
            activity.startActivity(Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
        }.onFailure { error = "Couldn't open the installer: ${it.message ?: "no answer"}"; tell() }
    }

    private fun tell() = main.post { changed?.invoke() }

    /** One source's {version, url, sha256}; null when it has none (404: not published yet). */
    private fun read(url: String): Release? {
        val c = open(url, 15_000)
        try {
            if (c.responseCode == 404) return null
            if (c.responseCode != 200) throw IOException("HTTP ${c.responseCode}")
            val j = JSONObject(c.inputStream.bufferedReader().readText())
            val v = j.optString("version").trim()
            val u = j.optString("url").trim()
            if (v.isEmpty() || !u.startsWith("https://")) return null
            return Release(v, u, j.optString("sha256").trim().lowercase())
        } catch (e: org.json.JSONException) {
            throw IOException("an answer that is not the app's", e)
        } finally {
            c.disconnect()
        }
    }

    private fun fetch(url: String, dest: File) {
        val c = open(url, 60_000)
        try {
            if (c.responseCode != 200) throw IOException("HTTP ${c.responseCode}")
            c.inputStream.use { input -> FileOutputStream(dest).use { input.copyTo(it, 64 * 1024) } }
        } finally {
            c.disconnect()
        }
    }

    /** GitHub answers a release asset with a redirect to its file host, which HttpURLConnection follows (https → https). */
    private fun open(url: String, readTimeout: Int): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 10_000
            this.readTimeout = readTimeout
            instanceFollowRedirects = true
            useCaches = false
            setRequestProperty("User-Agent", "RouenAndroid/$current")
        }

    private fun sha256(f: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        f.inputStream().use { s ->
            val buf = ByteArray(64 * 1024)
            while (true) { val n = s.read(buf); if (n < 0) break; md.update(buf, 0, n) }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    /**
     * Versions compared as the server's updater compares them: part by part (1.9.10 after 1.9.9), and a test build
     * before its release, test builds counting up by their number (1.9.72-t2 < 1.9.72-t10 < 1.9.72). Mandarin's
     * Release.compare.
     */
    fun compare(a: String, b: String): Int {
        val (ca, pa) = split(a)
        val (cb, pb) = split(b)
        for (i in 0 until maxOf(ca.size, cb.size)) {
            val d = ca.getOrElse(i) { 0 }.compareTo(cb.getOrElse(i) { 0 })
            if (d != 0) return d
        }
        return when {
            pa == null && pb == null -> 0
            pa == null -> 1
            pb == null -> -1
            else -> comparePre(pa, pb)
        }
    }

    private fun split(v: String): Pair<List<Int>, String?> {
        val s = v.trim().removePrefix("v")
        val core = s.substringBefore('-').substringBefore('+')
        val pre = if (s.length > core.length && s[core.length] == '-') s.substring(core.length + 1).takeIf { it.isNotEmpty() } else null
        return core.split('.').map { it.toIntOrNull() ?: 0 } to pre
    }

    private fun comparePre(a: String, b: String): Int {
        val re = Regex("\\d+|\\D+")
        val x = re.findAll(a.lowercase()).map { it.value }.toList()
        val y = re.findAll(b.lowercase()).map { it.value }.toList()
        for (i in 0 until maxOf(x.size, y.size)) {
            val p = x.getOrNull(i) ?: return -1
            val q = y.getOrNull(i) ?: return 1
            val pn = p.toLongOrNull()
            val qn = q.toLongOrNull()
            val d = if (pn != null && qn != null) pn.compareTo(qn) else p.compareTo(q)
            if (d != 0) return d
        }
        return 0
    }
}
