package app.rouen.lite

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import android.webkit.WebResourceRequest
import android.webkit.WebViewClient
import android.widget.TextView
import java.net.HttpURLConnection
import java.net.URISyntaxException
import java.net.URL

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
            webViewClient = object : WebViewClient() {
                /**
                 * Rouen's own page stays here; a link anywhere else goes to Android (2.0.6-t12; the owner: "open in
                 * Qobuz fails" — an app's intent:// link left the page on "net::ERR_UNKNOWN_URL_SCHEME", and a site's
                 * link replaced Rouen on screen): a web link to the browser, an app's link to its app, or, without the
                 * app, its own web fallback. An intent:// link is a web page's, so it may only reach what a browser
                 * may (CATEGORY_BROWSABLE) and names no component of its own (the standard guard).
                 */
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val u = request.url
                    val isWeb = u.scheme == "http" || u.scheme == "https"
                    if (isWeb && (u.host == "127.0.0.1" || u.host == "localhost")) return false
                    val intent = try {
                        if (u.scheme == "intent") Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME).apply {
                            addCategory(Intent.CATEGORY_BROWSABLE)
                            component = null
                            selector = null
                        } else Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE)
                    } catch (e: URISyntaxException) {
                        null   // a link that isn't one: nothing opens, and Rouen stays on screen
                    }
                    if (intent != null) open(intent)
                    return true
                }
            }
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

    /** An intent from a link, started; without an app for it, its own web fallback (an intent:// link's), if any. */
    private fun open(intent: Intent) {
        try {
            startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: ActivityNotFoundException) {
            val fallback = intent.getStringExtra("browser_fallback_url") ?: return
            val f = Uri.parse(fallback)
            if (f.scheme != "http" && f.scheme != "https") return
            try {
                startActivity(Intent(Intent.ACTION_VIEW, f).addCategory(Intent.CATEGORY_BROWSABLE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (e2: ActivityNotFoundException) {
                // No browser on the device either: nothing opens, and Rouen stays on screen.
            }
        }
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

    /** What the page calls as window.RouenLite: its downloads, saved to Downloads/Rouen ([SavedDownload]); the share card's Copy image ([CardCopy]). */
    private inner class Bridge {
        @JavascriptInterface
        fun fileSave(data: String?, name: String?): String = SavedDownload.save(this@MainActivity, data, name)

        /** The share card's Copy image ([CardCopy], 2.0.6-t11): its PNG as base64; {"ok": true} or {"error": why not}. */
        @JavascriptInterface
        fun cardCopy(png: String?, name: String?): String = CardCopy.copy(this@MainActivity, png)
    }
}
