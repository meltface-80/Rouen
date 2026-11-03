package app.rouen.android

import android.app.Activity
import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File
import java.io.IOException

/**
 * The phone's Downloads/Rouen, where the Files app and every app's file picker find what Rouen saves: the app's own
 * log ([AppLog.save], §4.13) and the page's downloads ([RouenPhone.fileSave], §4.17).
 */
object DownloadsFolder {
    /**
     * Android 8 and 9 write to the public Downloads only with the storage permission: asked for here, once, and false
     * until it is given (the caller says to try again). Android 10 on needs none.
     */
    fun mayWrite(a: Activity): Boolean {
        if (Build.VERSION.SDK_INT >= 29) return true
        if (a.checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) == android.content.pm.PackageManager.PERMISSION_GRANTED) return true
        a.requestPermissions(arrayOf(android.Manifest.permission.WRITE_EXTERNAL_STORAGE), 41)
        return false
    }

    /** [bytes] to Downloads/Rouen/[name]; throws IOException or SecurityException when it can't. */
    fun write(a: Activity, bytes: ByteArray, name: String, mime: String) {
        if (Build.VERSION.SDK_INT >= 29) {
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                put(MediaStore.MediaColumns.MIME_TYPE, mime)
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
    }
}
