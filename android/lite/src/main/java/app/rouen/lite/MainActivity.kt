package app.rouen.lite

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView
import java.net.HttpURLConnection
import java.net.URL

/**
 * Rouen's page, from the server on this device (dev/design/rouen-lite.md §3): the service is started, then the page is
 * shown once the server answers. Until then, "Starting Rouen Lite…"; if Node ended, why, from its log's last word.
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var status: TextView
    private val main = Handler(Looper.getMainLooper())
    private var shown = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        status = TextView(this).apply {
            text = getString(R.string.starting)
            setTextColor(Color.parseColor("#E8E6E1"))
            textSize = 18f
            gravity = Gravity.CENTER
        }
        setContentView(status)
        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            setBackgroundColor(Color.parseColor("#0E1012"))
            webViewClient = WebViewClient()
        }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        RouenService.start(this)
        waitForServer(System.currentTimeMillis())
    }

    /** Asks the server every half second, for up to three minutes (a first start unpacks Rouen and reads the library). */
    private fun waitForServer(since: Long) {
        Thread {
            val up = try {
                val c = URL("http://127.0.0.1:${NodeRunner.PORT}/api/login").openConnection() as HttpURLConnection
                c.connectTimeout = 1000; c.readTimeout = 2000
                val ok = c.responseCode in 200..499
                c.disconnect()
                ok
            } catch (e: Exception) { false }   // not listening yet: asked again below
            main.post {
                when {
                    shown -> {}
                    up -> { shown = true; setContentView(web); web.loadUrl("http://127.0.0.1:${NodeRunner.PORT}/") }
                    NodeRunner.exitCode != null -> status.text = "Rouen stopped (${NodeRunner.exitCode}). Open the app again to restart it."
                    System.currentTimeMillis() - since > 180_000 -> status.text = "Rouen hasn't started after three minutes."
                    else -> main.postDelayed({ waitForServer(since) }, 500)
                }
            }
        }.start()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (shown && web.canGoBack()) web.goBack() else moveTaskToBack(true)
    }
}
