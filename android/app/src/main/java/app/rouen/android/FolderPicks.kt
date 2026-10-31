package app.rouen.android

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import java.lang.ref.WeakReference

/**
 * Android's folder picker and its "All files access", for the page's Settings → Streaming & downloads
 * (dev/design/android-app.md §4.19, v1.9.72-t34): the download folder of the owner's own choosing ([PhoneFolders]).
 * Made by [MainActivity] as it starts (a picker's result must be registered then); [RouenPhone] asks [current].
 * [changed] tells the page; the page hears too when the app comes back from Android's settings.
 */
class FolderPicks(private val a: ComponentActivity, private val changed: () -> Unit) {
    companion object {
        /** The activity's, while it is there. */
        @Volatile var current: WeakReference<FolderPicks>? = null
        private const val STORAGE_ASK = 4208
    }

    private val downloads = a.registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri != null) pickedDownloads(uri)
    }

    init { current = WeakReference(this) }

    /** The picker, for the download folder. On the main thread. */
    fun pickDownloads() {
        try {
            downloads.launch(PhoneFolders.downloadUri(a))
        } catch (e: ActivityNotFoundException) {
            AppLog.line("DOWNLOAD", "no folder picker on this phone", anomaly = true)
        }
    }

    /** Android's page for All files access (from Android 11), or its storage permission's question before. On the main thread. */
    fun askAllFiles() {
        if (Build.VERSION.SDK_INT >= 30) {
            val own = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + a.packageName))
            try {
                a.startActivity(own)
            } catch (e: ActivityNotFoundException) {
                try {
                    a.startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
                } catch (e2: ActivityNotFoundException) {
                    AppLog.line("DOWNLOAD", "this phone has no page for All files access", anomaly = true)
                }
            }
        } else {
            a.requestPermissions(arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE), STORAGE_ASK)
        }
    }

    private fun pickedDownloads(uri: Uri) {
        try {
            a.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        } catch (e: SecurityException) {
            // A provider that grants none to keep: the folder is written as a path, with All files access, not through it.
        }
        PhoneFolders.setDownload(a, uri)
        // Android asks once: straight on to its page, so the owner isn't sent back to the page to ask again.
        if (PhoneFolders.downloadAccess(a) == "needed") askAllFiles()
        changed()
    }
}
