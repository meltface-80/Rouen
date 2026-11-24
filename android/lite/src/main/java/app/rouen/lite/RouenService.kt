package app.rouen.lite

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import java.net.Inet4Address

/**
 * The server, as a foreground service (dev/design/rouen-lite.md §3): Android stops background work otherwise. While it
 * runs it holds a Wi-Fi multicast lock (Roon finds its Core by multicast; Android drops it without one), a Wi-Fi lock and
 * a CPU lock (a server answers with the screen off), and its notification says where other devices reach Rouen.
 * Started by the app; started again by Android if its process is stopped (START_STICKY), which also starts Node again.
 */
class RouenService : Service() {
    private var multicast: WifiManager.MulticastLock? = null
    private var wifi: WifiManager.WifiLock? = null
    private var cpu: PowerManager.WakeLock? = null
    /** The notification's address kept current as the network changes (the review: one read at the start went stale). */
    private var watching: ConnectivityManager.NetworkCallback? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val n = notification()
        if (Build.VERSION.SDK_INT >= 34) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(ID, n)
        hold()
        watchNetwork()
        Thread({ Interfaces.write(applicationContext) }, "rouen-interfaces").apply { isDaemon = true; start() }
        NodeRunner.start(this)
        return START_STICKY
    }

    private fun watchNetwork() {
        if (watching != null) return
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = refresh()
            override fun onLost(network: Network) = refresh()
            override fun onLinkPropertiesChanged(network: Network, lp: LinkProperties) = refresh()
        }
        cm.registerDefaultNetworkCallback(cb)
        watching = cb
    }

    private fun refresh() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(ID, notification())
        // The built-in Tailscale engine's view of the network, kept current (L4, design §5.1): off the main thread.
        Thread({ Interfaces.write(applicationContext) }, "rouen-interfaces").apply { isDaemon = true; start() }
    }

    private fun hold() {
        val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        if (multicast == null) multicast = wm.createMulticastLock("rouen-lite").apply { setReferenceCounted(false); acquire() }
        if (wifi == null) {
            @Suppress("DEPRECATION")
            val mode = if (Build.VERSION.SDK_INT >= 29) WifiManager.WIFI_MODE_FULL_LOW_LATENCY else WifiManager.WIFI_MODE_FULL_HIGH_PERF
            wifi = wm.createWifiLock(mode, "rouen-lite").apply { setReferenceCounted(false); acquire() }
        }
        if (cpu == null) {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            cpu = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "rouen-lite:server").apply { setReferenceCounted(false); acquire() }
        }
    }

    override fun onDestroy() {
        watching?.let { (getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).unregisterNetworkCallback(it) }
        watching = null
        multicast?.release(); multicast = null
        wifi?.release(); wifi = null
        cpu?.release(); cpu = null
        super.onDestroy()
    }

    private fun notification(): Notification {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.channel), NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val where = address(this)?.let { "Other devices: http://$it:${NodeRunner.PORT}" } ?: "Running on this device"
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher_foreground)
            .setContentTitle("Rouen Lite is running")
            .setContentText(where)
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val CHANNEL = "rouen-lite"
        private const val ID = 1

        /**
         * This device's address on its local network (IPv4), for other devices: a Wi-Fi or Ethernet network's first,
         * where Roon and the other devices are, else the active network's; null without one.
         */
        fun address(context: Context): String? {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val v4 = { n: Network? -> cm.getLinkProperties(n)?.linkAddresses?.map { it.address }
                ?.firstOrNull { it is Inet4Address && !it.isLoopbackAddress }?.hostAddress }
            @Suppress("DEPRECATION")
            val local = cm.allNetworks.firstOrNull { n ->
                val caps = cm.getNetworkCapabilities(n)
                caps != null && (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) && v4(n) != null
            }
            return v4(local) ?: v4(cm.activeNetwork)
        }

        fun start(context: Context) {
            val i = Intent(context, RouenService::class.java)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(i) else context.startService(i)
        }
    }
}
