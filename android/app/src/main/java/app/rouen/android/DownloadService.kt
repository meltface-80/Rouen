package app.rouen.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Downloads' own foreground service, with a "Downloading" notification (dev/design/android-app.md §4.19,
 * v1.9.72-t30), held by [Downloader] while there is anything to download ([DownloadLine]'s busy and idle).
 *
 * The owner's log, 2026-10-30: an album downloading, the app went to the background; its player service, until then
 * the app's only foreground service, stopped; five seconds later Android cut the app's network ("Software caused
 * connection abort"), and every retry failed to connect until the app was opened again. Mandarin's downloads run under
 * WorkManager with a foreground notification for the same reason. While this service runs the app keeps its network.
 */
class DownloadService : Service() {
    companion object {
        private const val CHANNEL = "downloads"
        private const val ID = 4207
        private const val STOP = "app.rouen.android.downloads.STOP"
        @Volatile private var text = "Downloading to this phone"
        @Volatile private var running = false

        /** Held: there is something to download. Asked from the downloads' thread. */
        fun hold(c: Context) {
            try {
                c.startForegroundService(Intent(c, DownloadService::class.java))
            } catch (e: IllegalStateException) {
                // Android refused a start from the background (a retry, the app long gone): the download goes on, and
                // is cut with the app's network as before, to go on when the app is next opened.
                AppLog.line("DOWNLOAD", "the downloads' notification couldn't be shown: ${e.javaClass.simpleName}", anomaly = true)
            }
        }

        /** Let go: nothing more to download. */
        fun release(c: Context) {
            if (!running) return
            try {
                c.startService(Intent(c, DownloadService::class.java).setAction(STOP))
            } catch (e: IllegalStateException) {
                c.stopService(Intent(c, DownloadService::class.java))
            }
        }

        /** What the notification says: the album and how far it has got. */
        fun say(c: Context, line: String) {
            text = line
            if (running) (c.getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(ID, build(c))
        }

        private fun build(c: Context): Notification {
            val nm = c.getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(CHANNEL) == null) {
                nm.createNotificationChannel(NotificationChannel(CHANNEL, "Downloads", NotificationManager.IMPORTANCE_LOW))
            }
            val open = PendingIntent.getActivity(c, 0, Intent(c, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
            return Notification.Builder(c, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle("Rouen")
                .setContentText(text)
                .setContentIntent(open)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .build()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Foreground first, every time: a start asked with startForegroundService must be answered so within seconds.
        if (Build.VERSION.SDK_INT >= 29) startForeground(ID, build(this), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        else startForeground(ID, build(this))
        running = true
        if (intent?.action == STOP) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        running = false
        super.onDestroy()
    }
}
