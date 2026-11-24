package app.rouen.lite

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File
import java.io.FileNotFoundException

/**
 * The one copied share card, read by the app it is pasted into (dev/design/rouen-lite.md §3, 2.0.6-t18; the owner,
 * 2026-11-24: "the share card copy function does copy to clipboard but also downloads it. I don't want download at the
 * same time"). The card lives in this app's own cache, where no gallery sees it; the clipboard holds this provider's
 * address for it, and Android lets the app it is pasted into read it, and nothing else: the provider is not exported,
 * and reading it takes the clipboard's grant (grantUriPermissions). One file, read only; nothing can be written, listed
 * or deleted through it. Not androidx's FileProvider, and no permission is asked for (2.0.6-t6's was blocked by Google
 * Play Protect with both).
 */
class CardProvider : ContentProvider() {
    companion object {
        const val NAME = "card.png"
        /** Where the card is kept: the app's cache, the card's own folder. */
        fun file(context: Context) = File(File(context.cacheDir, "card"), NAME)
        /** Its address: this app's authority, so a second build of the app never answers for this one. */
        fun uri(context: Context): Uri = Uri.parse("content://${context.packageName}.card/$NAME")
    }

    override fun onCreate() = true

    private fun ours(uri: Uri) = uri.pathSegments.size == 1 && uri.lastPathSegment == NAME

    override fun getType(uri: Uri): String? = if (ours(uri)) "image/png" else null

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (!ours(uri) || mode != "r") throw FileNotFoundException("Only the copied card, to read")
        val f = file(context ?: throw FileNotFoundException("No context"))
        if (!f.isFile) throw FileNotFoundException("No card has been copied")
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    /** Its name and size, which an app it is pasted into may ask before reading it. */
    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? {
        if (!ours(uri)) return null
        val f = file(context ?: return null)
        val cols = projection ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
        val row = cols.map { c -> when (c) { OpenableColumns.DISPLAY_NAME -> "Rouen card.png"; OpenableColumns.SIZE -> f.length(); else -> null } }
        return MatrixCursor(cols).apply { addRow(row.toTypedArray()) }
    }

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0
}
