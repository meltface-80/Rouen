package app.rouen.android

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException

/**
 * The share card's Copy image and Download, done by the app (dev/design/android-app.md §4.17, v1.9.72-t22), as
 * Mandarin's ShareBridge (meltface-80/Mandarin: android/app/.../ShareBridge.kt) does them. No Share…: the owner,
 * v1.9.72-t25, "I want share removed to leave copy and download". In the app's WebView none of
 * the browser's ways works: a download link goes nowhere (a WebView downloads only through a listener, and Android's
 * download manager cannot fetch the page's blob: address), there is no Web Share, and the WebView's image clipboard is
 * refused or leaves nothing another app can paste. So the page hands the card's PNG over ([RouenPhone]).
 *
 * Each answers null when it was done, else why not, in words the page shows.
 */
object CardShare {
    /** The cache's folder the card leaves the app from (res/xml/file_paths.xml): only the card being copied. */
    private const val DIR = "shared"

    /** Copied as an image: Android's clipboard holds a content:// address to the PNG, which the app pasted into reads. */
    fun copy(c: Context, bytes: ByteArray, name: String): String? = try {
        val uri = FileProvider.getUriForFile(c, c.packageName + ".files", write(c, bytes, name))
        val cm = c.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newUri(c.contentResolver, "Album card", uri))
        null
    } catch (e: IOException) {
        "Couldn't copy the card: ${e.message ?: e.javaClass.simpleName}"
    } catch (e: IllegalArgumentException) {
        "Couldn't copy the card: ${e.message ?: "no address for it"}"
    } catch (e: SecurityException) {
        "Couldn't copy the card: Android refused it"
    }

    /**
     * Saved to the phone's Pictures/Rouen, where the gallery shows it. Android 10 on needs no permission; Android 8 and 9
     * need the storage permission, which is asked for here and the page asked to try again ([AppLog.save] does the same).
     */
    fun save(a: Activity, bytes: ByteArray, name: String): String? {
        if (Build.VERSION.SDK_INT < 29 && a.checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            a.requestPermissions(arrayOf(android.Manifest.permission.WRITE_EXTERNAL_STORAGE), 42)
            return "Allow Rouen to save to the phone's storage, then tap Download again"
        }
        return try {
            if (Build.VERSION.SDK_INT >= 29) {
                val values = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                    put(MediaStore.MediaColumns.MIME_TYPE, "image/png")
                    put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Rouen")
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }
                val r = a.contentResolver
                val uri = r.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: throw IOException("Pictures would not take it")
                try {
                    r.openOutputStream(uri)?.use { it.write(bytes) } ?: throw IOException("no stream")
                    r.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
                } catch (e: IOException) {
                    r.delete(uri, null, null)
                    throw e
                }
            } else {
                @Suppress("DEPRECATION")
                val d = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "Rouen").apply { mkdirs() }
                val f = File(d, name).apply { writeBytes(bytes) }
                android.media.MediaScannerConnection.scanFile(a, arrayOf(f.path), arrayOf("image/png"), null)
            }
            null
        } catch (e: IOException) {
            "Couldn't save the card: ${e.message ?: e.javaClass.simpleName}"
        } catch (e: SecurityException) {
            "Couldn't save the card: Android refused the storage"
        }
    }

    /** The cache holding exactly the card being copied now, so it cannot grow. */
    private fun write(c: Context, bytes: ByteArray, name: String): File {
        val d = File(c.cacheDir, DIR)
        d.listFiles()?.forEach { it.delete() }
        if (!d.isDirectory && !d.mkdirs()) throw IOException("no room in the app's cache")
        return File(d, name).apply { writeBytes(bytes) }
    }
}
