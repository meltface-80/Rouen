package app.rouen.lite

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import org.json.JSONObject
import java.io.File

/**
 * One of the page's downloads, saved (dev/design/rouen-lite.md §3): its bytes as base64 and its name, as Rouen's page
 * hands them (public/app-files.js), to Downloads/Rouen through MediaStore on Android 10 and later, or to the app's own
 * Downloads folder before. Answers {"ok": true, "name"} or {"error": why not}, as Rouen for Android's fileSave does.
 */
object SavedDownload {
    private const val MAX_BYTES = 64 * 1024 * 1024

    /** A name safe as one file: no folder, no character a file system refuses, not empty. */
    fun safeName(name: String?): String? {
        val n = (name ?: "").substringAfterLast('/').substringAfterLast('\\')
            .replace(Regex("[\\u0000-\\u001f:*?\"<>|]"), "-").trim().trimEnd('.').take(120)
        return n.takeIf { it.isNotEmpty() && it != "." && it != ".." }
    }

    fun save(context: Context, data: String?, name: String?): String {
        val n = safeName(name) ?: return JSONObject().put("error", "the file has no name").toString()
        val bytes = try { Base64.decode(data ?: "", Base64.DEFAULT) } catch (e: IllegalArgumentException) { null }
        if (bytes == null || bytes.isEmpty()) return JSONObject().put("error", "the file is empty").toString()
        if (bytes.size > MAX_BYTES) return JSONObject().put("error", "the file is too large to save here").toString()
        return try {
            if (Build.VERSION.SDK_INT >= 29) {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, n)
                    put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Rouen")
                }
                val uri = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: return JSONObject().put("error", "Android didn't give a place to save it").toString()
                context.contentResolver.openOutputStream(uri).use { it?.write(bytes) ?: throw java.io.IOException("no stream") }
            } else {
                val dir = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "Rouen").apply { mkdirs() }
                File(dir, n).writeBytes(bytes)
            }
            JSONObject().put("ok", true).put("name", n).toString()
        } catch (e: Exception) {
            JSONObject().put("error", "Couldn't save it: ${e.message ?: e.javaClass.simpleName}").toString()
        }
    }
}
