package app.rouen.android

import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.webkit.CookieManager
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileWriter
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * The app's log (dev/design/android-app.md §4.13, v1.9.72-t11): Mandarin's AppLog (meltface-80/Mandarin:
 * android/app/.../AppLog.kt) for Rouen. Off unless switched on (Settings → Setup → Logging, through [RouenPhone]); then
 * nothing at all is collected. On, it keeps what the app does — every request to Rouen with how long it took (NET), the
 * link's hello, commands and reports (LINK), the phone's player (PLAYER), the way to Rouen (WAY), the page's loads and
 * console errors (PAGE), the app's own update (UPDATE), a snapshot every five minutes (SNAP), and the app's own lines of
 * Android's log (LOGCAT) — each line through [LogRedact] before it is written. Kept in files/applog, the last two files
 * of [FILE_BYTES] each; switched off, deleted. Saved, with Rouen's side (the phone's trail and Rouen's Tailscale), to
 * Downloads/Rouen.
 */
object AppLog {
    private const val FILE_BYTES = 3L * 1024 * 1024
    /** The app's own tags in Android's log, the only ones read (with a crash's). */
    private val TAGS = listOf("RouenAway", "RouenTailscale", "RouenLink", "RouenPlayer", "RouenUpdate", "RouenLog")
    private val io = Executors.newSingleThreadExecutor { r -> Thread(r, "applog").apply { isDaemon = true } }
    private val timer = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "applog-timer").apply { isDaemon = true } }
    private val stamp = SimpleDateFormat("MM-dd HH:mm:ss.SSS", Locale.UK)
    @Volatile private var dir: File? = null
    @Volatile private var app: Context? = null
    @Volatile private var logcat: Process? = null
    @Volatile private var snapping: ScheduledFuture<*>? = null
    /** Who wants snapshots now (the page on screen, the player running): taken while any does. */
    private val snapFor = HashSet<String>()
    private var out: FileWriter? = null

    /** Switched on; off, nothing is collected. */
    @Volatile var on = false
        private set
    /** The last save's file name, or why it failed (for the page). */
    @Volatile var saved: String? = null
        private set
    @Volatile var saveError: String? = null
        private set
    @Volatile var saving = false
        private set
    /** Told when a save ends (the page repaints). */
    @Volatile var changed: (() -> Unit)? = null

    /** With the app's process (RouenApp): collecting if switched on, and a crash written down before it ends the app. */
    fun start(c: Context) {
        if (app != null) return
        app = c.applicationContext
        dir = File(c.filesDir, "applog")
        if (Prefs.logging(c)) begin(c)
        val before = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { t, e ->
            crash("crash on ${t.name}: " + android.util.Log.getStackTraceString(e))
            before?.uncaughtException(t, e)
        }
    }

    /** Switched on or off (the page): off deletes the log. */
    fun switch(c: Context, to: Boolean) {
        Prefs.setLogging(c, to)
        if (to) {
            begin(c)
        } else {
            line("APP", "logging off")
            on = false
            logcat?.destroy()
            logcat = null
            snapping?.cancel(false)
            snapping = null
            deleteFiles()
        }
    }

    private fun begin(c: Context) {
        if (on) return
        dir?.mkdirs()
        on = true
        line("APP", "logging on: Rouen for Android ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE}), Android ${Build.VERSION.RELEASE} " +
            "(API ${Build.VERSION.SDK_INT}), ${Build.MANUFACTURER} ${Build.MODEL}, ${Build.SUPPORTED_ABIS.firstOrNull() ?: "?"}")
        line("APP", "settings: " + PhoneChoices.KEYS.joinToString(", ") { "$it ${Prefs.choice(c, it)}" } +
            "; built-in Tailscale ${if (Prefs.engineOn(c)) "on" else "off"}, signed in before ${TailscaleEngine.signedIn(c)}")
        Thread({ readLogcat() }, "applog-logcat").apply { isDaemon = true; start() }
        synchronized(snapFor) { if (snapFor.isNotEmpty()) schedule() }
    }

    /** A line of [cat], without personal data; [anomaly] marks it "!!". Nothing while off. */
    fun line(cat: String, msg: String, anomaly: Boolean = false) {
        if (!on) return
        val at = System.currentTimeMillis()
        val text = "${synchronized(stamp) { stamp.format(Date(at)) }} ${if (anomaly) "!!" else "  "} ${cat.padEnd(6)} ${LogRedact.line(msg)}\n"
        try {
            io.execute { write(text) }
        } catch (e: java.util.concurrent.RejectedExecutionException) {
            // The process is ending: the line has nowhere to go, and nothing waits on it.
        }
    }

    /** A crash, written at once on its own thread's stack (the process is going): its trace without personal data. */
    private fun crash(text: String) {
        val d = dir ?: return
        if (!on) return
        val safe = text.lines().joinToString("\n") { LogRedact.line(it) }
        try {
            FileWriter(File(d, "current.log"), true).use { it.write("${synchronized(stamp) { stamp.format(Date()) }} !! APP    $safe\n") }
        } catch (e: IOException) {
            // The disk refused the last words: the crash is still Android's own to report.
        }
    }

    private fun write(text: String) {
        val d = dir ?: return
        if (!on) return
        try {
            val f = File(d, "current.log")
            if (f.length() > FILE_BYTES) { out?.close(); out = null; f.renameTo(File(d, "previous.log")) }
            val w = out ?: FileWriter(File(d, "current.log"), true).also { out = it }
            w.write(text)
            w.flush()
        } catch (e: IOException) {
            // A full disk: this line is lost, and the next one tries afresh.
            out = null
        }
    }

    /** The app's own lines of Android's log (its tags, Info and above, and a crash's), each without personal data. */
    private fun readLogcat() {
        try {
            val filter = TAGS.map { "$it:I" } + listOf("AndroidRuntime:E", "ExoPlayerImplInternal:W", "MediaCodecAudioRenderer:W", "*:S")
            val p = ProcessBuilder(listOf("logcat", "-v", "threadtime", "--pid=${android.os.Process.myPid()}", "-T", "1") + filter)
                .redirectErrorStream(true).start()
            logcat = p
            p.inputStream.bufferedReader().forEachLine { l ->
                if (on && l.isNotBlank()) { val s = LogRedact.line(l); io.execute { write("                       LOGCAT $s\n") } }
            }
        } catch (e: IOException) {
            line("APP", "Android's log can't be read: ${e.javaClass.simpleName}", anomaly = true)
        }
    }

    /** Snapshots every five minutes while [who] (the page on screen, "page"; the player, "player") wants them. */
    fun snapshots(who: String, want: Boolean) {
        synchronized(snapFor) {
            if (want) snapFor.add(who) else snapFor.remove(who)
            if (snapFor.isEmpty()) { snapping?.cancel(false); snapping = null } else if (snapping == null && on) schedule()
        }
    }

    private fun schedule() {
        snapping = timer.scheduleWithFixedDelay({ snapshot() }, 0, 5, TimeUnit.MINUTES)
    }

    /** The way to Rouen and the network, the player, the app's memory, the engine. */
    private fun snapshot() {
        val c = app ?: return
        if (!on) return
        val rt = Runtime.getRuntime()
        val a = Away.active(c)
        val way = when (a?.kind) {
            Way.Kind.HOME -> "home"
            Way.Kind.DIRECT -> "away, through a VPN"
            Way.Kind.ENGINE -> "away, through the built-in Tailscale"
            null -> "none found"
        } + when (a?.reach) {
            Way.Reach.CONNECTING -> ", connecting"
            Way.Reach.NO -> ", can't reach Rouen"
            else -> ""
        }
        line("SNAP", "way: $way; network ${if (Away.hasNetwork(c)) "up" else "none"}; memory ${(rt.totalMemory() - rt.freeMemory()) / 1_048_576} of ${rt.maxMemory() / 1_048_576} MB")
        line("SNAP", "player: " + (PlayerService.snapshot() ?: "not running"))
        line("SNAP", "engine: " + if (TailscaleEngine.alive()) "running" else "not running")
    }

    /** How much is logged, and since when, for the page. */
    fun about(): String {
        val d = dir ?: return "Nothing logged yet"
        val files = listOf(File(d, "previous.log"), File(d, "current.log")).filter { it.exists() }
        val bytes = files.sumOf { it.length() }
        val from = files.firstOrNull()?.let { f -> f.useLines { it.firstOrNull()?.take(18) } }
        return if (bytes == 0L) "Nothing logged yet" else "${(bytes + 1023) / 1024} KB logged" + (from?.let { ", since $it" } ?: "")
    }

    /**
     * The log saved to Downloads/Rouen as rouen-log-<when>.txt: the app's, then Rouen's side (the phone's trail and Rouen's
     * built-in Tailscale, fetched now with the page's login, each line through LogRedact.jsonLine: keys kept, names hidden).
     */
    fun save(a: Activity, base: String?) {
        if (saving) return
        // Android 8 and 9 write to the public Downloads only with the storage permission, asked for here, once.
        if (Build.VERSION.SDK_INT < 29 && a.checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            a.requestPermissions(arrayOf(android.Manifest.permission.WRITE_EXTERNAL_STORAGE), 41)
            saveError = "Allow Rouen to save to the phone's storage, then tap Save log again."
            changed?.invoke()
            return
        }
        saving = true
        saveError = null
        line("APP", "log saved from Settings → Setup → Logging")
        io.execute {
            val all = ByteArrayOutputStream()
            all.write("Rouen for Android's log: the app's, then Rouen's side. It is made without personal data; please look through it before you send it.\n\n— The app —\n".toByteArray())
            dir?.let { d -> for (f in listOf(File(d, "previous.log"), File(d, "current.log"))) if (f.exists()) f.inputStream().use { it.copyTo(all) } }
            all.write("\n— Rouen (the server) —\n".toByteArray())
            for (path in listOf("/api/debug/phones", "/api/tailscale")) {
                val text = if (base == null) "(no way to Rouen now)" else try {
                    val r = Api(base, CookieManager.getInstance()).get(path, 10_000)
                    if (r.code == 200) pretty(r.text) else "HTTP ${r.code}"
                } catch (e: IOException) {
                    "(Rouen couldn't be reached: ${e.javaClass.simpleName})"
                }
                all.write("\n$path\n".toByteArray())
                all.write(text.lines().joinToString("\n") { LogRedact.jsonLine(it) }.toByteArray())
                all.write("\n".toByteArray())
            }
            val name = "rouen-log-" + SimpleDateFormat("yyyy-MM-dd-HHmmss", Locale.UK).format(Date()) + ".txt"
            val ok = toDownloads(a, all.toByteArray(), name)
            saving = false
            if (ok == null) { saved = name; saveError = null } else { saveError = ok }
            a.runOnUiThread { changed?.invoke() }
        }
    }

    /** One JSON value to a line (so each line is redacted with its own key in sight); any other text as it is. */
    private fun pretty(text: String): String = try { JSONObject(text).toString(1) } catch (e: org.json.JSONException) { text }

    /** [bytes] to Downloads/Rouen/[name]; null when written, else why not. */
    private fun toDownloads(a: Activity, bytes: ByteArray, name: String): String? = try {
        if (Build.VERSION.SDK_INT >= 29) {
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                put(MediaStore.MediaColumns.MIME_TYPE, "text/plain")
                put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Rouen")
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val r = a.contentResolver
            val uri = r.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: throw IOException("Downloads would not take it")
            try {
                r.openOutputStream(uri)?.use { it.write(bytes) } ?: throw IOException("no stream")
                r.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
            } catch (e: IOException) {
                r.delete(uri, null, null)
                throw e
            }
        } else {
            @Suppress("DEPRECATION")
            val d = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Rouen").apply { mkdirs() }
            File(d, name).writeBytes(bytes)
        }
        null
    } catch (e: IOException) {
        "Couldn't save the log: ${e.message ?: e.javaClass.simpleName}"
    } catch (e: SecurityException) {
        "Couldn't save the log: Android refused the storage (${e.message ?: "no permission"})"
    }

    /** The log emptied; collecting goes on. */
    fun clear() {
        deleteFiles()
        line("APP", "log cleared")
    }

    private fun deleteFiles() {
        io.execute {
            try { out?.close() } catch (e: IOException) { /* closing a file being deleted: nothing left to keep */ }
            out = null
            dir?.let { d -> File(d, "previous.log").delete(); File(d, "current.log").delete() }
        }
    }
}
