package app.rouen.lite

import android.content.Context
import android.os.Build
import android.system.Os
import android.util.Log
import java.io.File
import java.nio.file.Files
import java.util.zip.ZipInputStream

/**
 * Node and Rouen's server, started once in this process (dev/design/rouen-lite.md §3): Node can't be started twice
 * in one process, so a second start() is nothing.
 *
 * Rouen's server comes in the APK as assets/rouen.zip (CI makes it). It is unpacked to files/rouen/app whenever the
 * installed APK is newer than the copy (a test build keeps its version, so its install time is what is compared), the
 * whole tree replaced so nothing of an older one is left. Rouen's data folder, files/rouen/data, is the app's own and is
 * kept: app/data is a link to it, so Rouen finds it where it always does.
 */
object NodeRunner {
    private const val TAG = "RouenLite"
    const val PORT = 3399

    @Volatile var started = false
        private set
    /** Node's exit code once it has ended (Rouen failing, for the moment before the process ends); null while it runs. */
    @Volatile var exitCode: Int? = null
        private set

    init {
        System.loadLibrary("node")
        System.loadLibrary("rouenlite")
    }

    @JvmStatic private external fun startNode(arguments: Array<String>): Int

    @Synchronized
    fun start(context: Context) {
        if (started) return
        started = true
        val app = context.applicationContext
        Thread({
            try {
                val dir = unpack(app)
                Os.setenv("ROUEN_LITE", "1", true)
                Os.setenv("PORT", PORT.toString(), true)
                Os.setenv("HOME", app.filesDir.absolutePath, true)
                Os.setenv("TMPDIR", app.cacheDir.absolutePath, true)
                Log.i(TAG, "starting Rouen in ${dir.absolutePath}")
                val code = startNode(arrayOf("node", File(dir, "lite-start.js").absolutePath))
                exitCode = code
                Log.w(TAG, "Rouen ended ($code): the process ends, for Android to start it again")
            } catch (e: Throwable) {
                exitCode = -100
                Log.e(TAG, "Rouen couldn't start", e)
            }
            // Node can't start twice in one process (the review: "open the app again" did nothing). The process ends,
            // as Rouen's own process.exit ends it; Android starts the service again (START_STICKY) in a new one.
            android.os.Process.killProcess(android.os.Process.myPid())
        }, "rouen-node").apply { isDaemon = true }.start()
    }

    /** Rouen's server, unpacked when the APK is newer than the copy; its folder. */
    private fun unpack(context: Context): File {
        val root = File(context.filesDir, "rouen")
        val app = File(root, "app")
        val data = File(root, "data").apply { mkdirs() }
        val stamp = File(root, "app.stamp")
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        @Suppress("DEPRECATION")
        val code = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
        val want = "${info.versionName}|$code|${info.lastUpdateTime}"
        if (stamp.isFile && stamp.readText() == want && File(app, "lite-start.js").isFile) return app
        Log.i(TAG, "unpacking Rouen $want")
        // The link to the data first, on its own: a delete walking the tree would follow it into Rouen's data.
        val link = File(app, "data").toPath()
        if (Files.isSymbolicLink(link)) Files.delete(link)
        app.deleteRecursively()
        app.mkdirs()
        context.assets.open("rouen.zip").use { input ->
            ZipInputStream(input.buffered()).use { zip ->
                val base = app.canonicalPath + File.separator
                while (true) {
                    val e = zip.nextEntry ?: break
                    val out = File(app, e.name)
                    // A name leading out of the folder is not one of Rouen's files; nor is a data folder (it is the link).
                    if (!out.canonicalPath.startsWith(base) || e.name == "data" || e.name.startsWith("data/")) continue
                    if (e.isDirectory) out.mkdirs()
                    else {
                        out.parentFile?.mkdirs()
                        out.outputStream().use { zip.copyTo(it) }
                    }
                }
            }
        }
        // Rouen's data where Rouen looks for it (index.js's __dirname/data), kept across versions.
        Os.symlink(data.absolutePath, File(app, "data").absolutePath)
        stamp.writeText(want)
        return app
    }
}
