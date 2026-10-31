package app.rouen.android

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import java.io.File

/**
 * The download folder of the owner's own choosing (dev/design/android-app.md §4.19, v1.9.72-t34), as Mandarin's
 * DownloadStore keeps its own: picked with Android's folder picker ([FolderPicks]), kept by its address, written to as
 * a plain path with Android's "All files access". [DownloadFolder] holds the rules; this asks Android.
 */
object PhoneFolders {
    /** The folder picked for downloads, or null. */
    fun downloadUri(c: Context): Uri? = Prefs.downloadFolder(c)?.let { Uri.parse(it) }

    /** The folder as a path, when it is on the phone or an SD card. */
    fun downloadPath(c: Context): File? {
        val u = downloadUri(c) ?: return null
        val tree = try { DocumentsContract.getTreeDocumentId(u) } catch (e: IllegalArgumentException) { null }
        @Suppress("DEPRECATION") val primary = Environment.getExternalStorageDirectory().path
        return DownloadFolder.pathOf(u.authority, tree, primary)?.let { File(it) }
    }

    /** The folder's own name, for the page ("Music", "Rouen"). */
    fun downloadName(c: Context): String? {
        val u = downloadUri(c) ?: return null
        val doc = try {
            DocumentsContract.buildDocumentUriUsingTree(u, DocumentsContract.getTreeDocumentId(u))
        } catch (e: IllegalArgumentException) {
            null
        }
        val named = doc?.let {
            try {
                c.contentResolver.query(it, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use { q ->
                    if (q.moveToFirst()) q.getString(0) else null
                }
            } catch (e: SecurityException) {
                null   // the picker's permission taken back (the folder forgotten in Android's settings): its path names it
            } catch (e: IllegalArgumentException) {
                null   // the provider no longer knows the folder (gone, or its card out): as above
            }
        }
        return named ?: downloadPath(c)?.name ?: u.lastPathSegment?.substringAfterLast(':')?.substringAfterLast('/')
    }

    /** Android's "All files access" (from Android 11), or the storage permission before it. */
    fun allFilesAccess(c: Context): Boolean =
        if (Build.VERSION.SDK_INT >= 30) Environment.isExternalStorageManager()
        else c.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED

    /** Where the folder stands ([DownloadFolder.access]): none, unmapped, needed, away or granted. */
    fun downloadAccess(c: Context): String {
        val path = downloadPath(c)
        val allFiles = allFilesAccess(c)
        return DownloadFolder.access(downloadUri(c) != null, path?.path, allFiles, allFiles && path?.isDirectory == true)
    }

    /** The folder as a place to save to, when downloads can be written there now. */
    fun downloadPlace(c: Context): File? = if (downloadAccess(c) == "granted") downloadPath(c) else null

    /** A folder picked: kept, and the place to save to from now. */
    fun setDownload(c: Context, uri: Uri) {
        Prefs.setDownloadFolder(c, uri.toString())
        Prefs.setChoice(c, PhoneChoices.DOWNLOAD_LOCATION, DownloadFolder.PLACE)
        AppLog.line("DOWNLOAD", "download folder picked: ${downloadName(c) ?: "a folder"}, ${downloadAccess(c)}")
    }

    /** The folder forgotten: new albums go to phone storage. The albums in it stay there, on the phone. */
    fun forgetDownload(c: Context) {
        downloadUri(c)?.let { u ->
            try {
                c.contentResolver.releasePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            } catch (e: SecurityException) {
                // Not held any longer (taken back in Android's settings): nothing to give back.
            }
        }
        Prefs.setDownloadFolder(c, null)
        if (Prefs.choice(c, PhoneChoices.DOWNLOAD_LOCATION) == DownloadFolder.PLACE) Prefs.setChoice(c, PhoneChoices.DOWNLOAD_LOCATION, "phone")
        AppLog.line("DOWNLOAD", "download folder forgotten: new albums go to phone storage")
    }
}
