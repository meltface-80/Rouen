package app.rouen.lite

import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import org.json.JSONObject
import java.io.IOException

/**
 * The share card's Copy image (dev/design/rouen-lite.md §3, 2.0.6-t11; the owner, 2026-11-24: "I said it was failing to
 * copy and to fix it, not remove it"). A WebView refuses the image clipboard, so the app copies it. 2.0.6-t6 did it as
 * the Rouen Android app does (a content provider over the app's cache, and the storage permission for Android 8 and 9), and
 * Google Play Protect then blocked Rouen Lite. This does it with the least Android has for it: no provider and no
 * permission. The card is saved to Pictures/Rouen through MediaStore (Android 10 and later let an app add its own
 * pictures there without asking), replacing the card copied before, and the clipboard holds that picture's content://
 * address, which the app it is pasted into reads. Before Android 10 there is no way without the permission: it says so.
 *
 * Answers {"ok": true} or {"error": why not}, as the page's other bridge calls do.
 */
object CardCopy {
    /** The one copied card kept: each Copy replaces it, so they don't pile up in the gallery. */
    private const val NAME = "Rouen card (copied).png"
    private const val MAX_BYTES = 16 * 1024 * 1024

    fun copy(context: Context, png: String?): String {
        if (Build.VERSION.SDK_INT < 29) return error("Copy image needs Android 10 or later: tap Download instead")
        val bytes = try { Base64.decode(png ?: "", Base64.DEFAULT) } catch (e: IllegalArgumentException) { null }
        val isPng = bytes != null && bytes.size > 8 && bytes.size <= MAX_BYTES &&
            bytes[0] == 0x89.toByte() && bytes[1] == 'P'.code.toByte() && bytes[2] == 'N'.code.toByte() && bytes[3] == 'G'.code.toByte()
        if (!isPng) return error("that is not the card's picture")
        return try {
            val r = context.contentResolver
            val folder = Environment.DIRECTORY_PICTURES + "/Rouen/"
            // The card copied before, which this app added: gone, so one stays.
            r.delete(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                "${MediaStore.MediaColumns.DISPLAY_NAME} = ? AND ${MediaStore.MediaColumns.RELATIVE_PATH} = ?", arrayOf(NAME, folder))
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, NAME)
                put(MediaStore.MediaColumns.MIME_TYPE, "image/png")
                put(MediaStore.MediaColumns.RELATIVE_PATH, folder)
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val uri: Uri = r.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return error("Android didn't give a place for it")
            try {
                r.openOutputStream(uri)?.use { it.write(bytes!!) } ?: throw IOException("no stream")
                r.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
            } catch (e: IOException) {
                r.delete(uri, null, null)
                throw e
            }
            val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(ClipData.newUri(r, "Album card", uri))
            JSONObject().put("ok", true).toString()
        } catch (e: IOException) {
            error("Couldn't copy the card: ${e.message ?: e.javaClass.simpleName}")
        } catch (e: SecurityException) {
            error("Couldn't copy the card: Android refused it")
        } catch (e: IllegalArgumentException) {
            error("Couldn't copy the card: ${e.message ?: "Android refused it"}")
        }
    }

    private fun error(why: String) = JSONObject().put("error", why).toString()
}
