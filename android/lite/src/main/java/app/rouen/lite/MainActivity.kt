package app.rouen.lite

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.Gravity
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import android.webkit.WebViewClient
import android.widget.TextView
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

/**
 * Rouen's page, from the server on this device (dev/design/rouen-lite.md §3): the service is started, then the page is
 * shown once the server answers. Until then, "Starting Rouen Lite…"; if Node ended, why, from its log's last word.
 */
class MainActivity : ComponentActivity() {
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
            // The page's downloads (a backup, a playlist, a log): a link goes nowhere in a WebView (the review).
            addJavascriptInterface(Bridge(), "RouenLite")
        }
        // Back within the page, else the app to the background, the server running. Android 16 no longer calls
        // onBackPressed for an app targeting it (the review).
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (shown && web.canGoBack()) web.goBack() else moveTaskToBack(true) }
        })
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
                    NodeRunner.exitCode != null -> status.text = "Rouen stopped (${NodeRunner.exitCode}): it starts again in a moment."
                    System.currentTimeMillis() - since > 180_000 -> status.text = "Rouen hasn't started after three minutes."
                    else -> main.postDelayed({ waitForServer(since) }, 500)
                }
            }
        }.start()
    }

    /**
     * What the page calls as window.RouenLite (public/app-files.js): its downloads, saved to Downloads/Rouen
     * ([SavedDownload]); and the share card's Copy image and Download ([CardShare]), its PNG as base64 and its name,
     * each answering {"ok": true} or {"error": why not}, as the Rouen Android app's RouenPhone.cardCopy and cardSave.
     */
    private inner class Bridge {
        @JavascriptInterface
        fun fileSave(data: String?, name: String?): String = SavedDownload.save(this@MainActivity, data, name)

        @JavascriptInterface
        fun cardCopy(png: String?, name: String?): String = card(png, name) { bytes, file -> CardShare.copy(this@MainActivity, bytes, file) }

        @JavascriptInterface
        fun cardSave(png: String?, name: String?): String = card(png, name) { bytes, file -> CardShare.save(this@MainActivity, bytes, file) }

        /** The card's bytes, a PNG's and not too large, under a safe name ending .png; then the act's answer. */
        private fun card(png: String?, name: String?, act: (ByteArray, String) -> String?): String {
            val bytes = try { Base64.decode(png ?: "", Base64.DEFAULT) } catch (e: IllegalArgumentException) { null }
            val isPng = bytes != null && bytes.size > 8 && bytes.size <= MAX_CARD_BYTES &&
                bytes[0] == 0x89.toByte() && bytes[1] == 'P'.code.toByte() && bytes[2] == 'N'.code.toByte() && bytes[3] == 'G'.code.toByte()
            if (!isPng) return JSONObject().put("error", "that is not the card's picture").toString()
            val n = SavedDownload.safeName(name) ?: "Rouen-card"
            val why = act(bytes!!, if (n.endsWith(".png", ignoreCase = true)) n else "$n.png")
            return if (why == null) JSONObject().put("ok", true).toString() else JSONObject().put("error", why).toString()
        }
    }

    private companion object {
        /** A card is a few hundred KB; a picture past this is not one. */
        const val MAX_CARD_BYTES = 16 * 1024 * 1024
    }
}
