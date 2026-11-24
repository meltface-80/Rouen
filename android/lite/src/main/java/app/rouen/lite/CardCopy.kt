package app.rouen.lite

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.io.IOException

/**
 * The share card's Copy image (dev/design/rouen-lite.md §3). A WebView refuses the image clipboard, so the app copies it.
 * 2.0.6-t11 saved the card to Pictures/Rouen through MediaStore and put that picture on the clipboard: a copy that was
 * also a download, a picture in the gallery each time (the owner, 2026-11-24: "I don't want download at the same time.
 * That's why there are two buttons"). Since 2.0.6-t18 the card is kept in this app's own cache, where no gallery sees
 * it, and the clipboard holds CardProvider's address for it, which the app it is pasted into reads with the clipboard's
 * grant. The picture 2.0.6-t11 left in Pictures/Rouen, which this app added, is taken away.
 *
 * Answers {"ok": true} or {"error": why not}, as the page's other bridge calls do.
 */
object CardCopy {
    /** The picture 2.0.6-t11 kept in Pictures/Rouen for each Copy. */
    private const val OLD_NAME = "Rouen card (copied).png"
    private const val MAX_BYTES = 16 * 1024 * 1024

    fun copy(context: Context, png: String?): String {
        val bytes = try { Base64.decode(png ?: "", Base64.DEFAULT) } catch (e: IllegalArgumentException) { null }
        val isPng = bytes != null && bytes.size > 8 && bytes.size <= MAX_BYTES &&
            bytes[0] == 0x89.toByte() && bytes[1] == 'P'.code.toByte() && bytes[2] == 'N'.code.toByte() && bytes[3] == 'G'.code.toByte()
        if (!isPng) return error("that is not the card's picture")
        return try {
            val f = CardProvider.file(context)
            f.parentFile?.mkdirs()
            // Written beside it, then put in its place: an app reading the card copied before never reads half of this one.
            val part = File(f.parentFile, "card.part")
            part.writeBytes(bytes!!)
            if (!part.renameTo(f)) throw IOException("the card couldn't be put in place")
            val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(ClipData.newUri(context.contentResolver, "Album card", CardProvider.uri(context)))
            removeOldCopy(context)
            JSONObject().put("ok", true).toString()
        } catch (e: IOException) {
            error("Couldn't copy the card: ${e.message ?: e.javaClass.simpleName}")
        } catch (e: SecurityException) {
            error("Couldn't copy the card: Android refused it")
        }
    }

    /** 2.0.6-t11's picture in Pictures/Rouen, which this app added and so may take away without asking (Android 10 on). */
    private fun removeOldCopy(context: Context) {
        if (Build.VERSION.SDK_INT < 29) return
        try {
            context.contentResolver.delete(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                "${MediaStore.MediaColumns.DISPLAY_NAME} = ? AND ${MediaStore.MediaColumns.RELATIVE_PATH} = ?",
                arrayOf(OLD_NAME, Environment.DIRECTORY_PICTURES + "/Rouen/"))
        } catch (e: SecurityException) {
            // Not this app's to remove (the user moved or re-saved it): left where it is; the copy itself has worked.
        }
    }

    private fun error(why: String) = JSONObject().put("error", why).toString()
}
