package app.rouen.android

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback

/**
 * Rouen's own web app, full screen in a WebView (dev/design/android-app.md §4.8): every screen
 * is Rouen's, and so is the login page. The player (PlayerService) reads the same login from
 * the WebView's cookie store.
 *
 * Links to other hosts open in the browser; back goes back in the page's history; a page that
 * cannot load offers Retry and "Change server".
 */
class MainActivity : ComponentActivity() {

    companion object {
        const val ACTION_CONNECT = "app.rouen.android.action.CONNECT"
    }

    private lateinit var web: WebView
    private lateinit var failure: View
    private lateinit var failureText: TextView
    /** The server the page was loaded from ("host:port"). */
    private var loaded: String? = null
    private var failed = false
    private var forgetHistory = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Prefs.server(this) == null) {
            startActivity(Intent(this, ConnectActivity::class.java))
            finish()
            return
        }
        if (intent?.action == ACTION_CONNECT) startActivity(Intent(this, ConnectActivity::class.java))

        val root = FrameLayout(this)
        web = WebView(this)
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        failure = failureView()
        root.addView(failure, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)
        Bars.apply(this, root)
        setUpWebView()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) {
                    web.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                    isEnabled = true
                }
            }
        })
        if (savedInstanceState != null && web.restoreState(savedInstanceState) != null) loaded = Prefs.server(this)
        askForNotifications()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == ACTION_CONNECT) startActivity(Intent(this, ConnectActivity::class.java))
    }

    override fun onStart() {
        super.onStart()
        PlayerService.setAppVisible(true)
        val server = Prefs.server(this) ?: return
        startService(Intent(this, PlayerService::class.java))
        if (server != loaded) load(server)
    }

    override fun onStop() {
        PlayerService.setAppVisible(false)
        // The login cookie reaches disk now, so the player still has it if the app is closed.
        CookieManager.getInstance().flush()
        super.onStop()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (::web.isInitialized) web.saveState(outState)
    }

    override fun onDestroy() {
        if (::web.isInitialized) web.destroy()
        super.onDestroy()
    }

    private fun load(server: String) {
        forgetHistory = loaded != null
        loaded = server
        failure.visibility = View.GONE
        web.loadUrl(Prefs.base(server) + "/")
    }

    @SuppressLint("SetJavaScriptEnabled") // Rouen is a JavaScript app; the WebView shows only the user's own Rouen
    private fun setUpWebView() {
        CookieManager.getInstance().setAcceptCookie(true)
        web.setBackgroundColor(Bars.COLOR)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        // Lets Rouen's page know it runs in the app.
        web.settings.userAgentString = web.settings.userAgentString + " RouenAndroid/" + BuildConfig.VERSION_NAME
        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (isOwn(request.url)) return false
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                } catch (e: ActivityNotFoundException) {
                    // Nothing on the phone opens this kind of link: the tap does nothing and the page stays as it is.
                }
                return true
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                failed = false
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (!request.isForMainFrame) return
                failed = true
                showFailure(error.description?.toString())
            }

            override fun onPageFinished(view: WebView, url: String?) {
                if (failed) return
                failure.visibility = View.GONE
                if (forgetHistory) { forgetHistory = false; web.clearHistory() }
            }
        }
    }

    /** A link to the Rouen this page came from (same host and port), as against anywhere else. */
    private fun isOwn(url: Uri): Boolean {
        val server = loaded ?: return true
        val scheme = url.scheme ?: return false
        if (scheme != "http" && scheme != "https") return false
        val port = if (url.port != -1) url.port else if (scheme == "https") 443 else 80
        return "${url.host}:$port".equals(server, ignoreCase = true)
    }

    private fun showFailure(reason: String?) {
        failureText.text = "Couldn't reach Rouen at ${loaded ?: "?"}." + (reason?.let { "\n\n$it" } ?: "") +
            "\n\nCheck that Rouen is running and that this phone is on the same network."
        failure.visibility = View.VISIBLE
    }

    private fun failureView(): View {
        val pad = dp(24)
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(pad, pad, pad, pad)
            setBackgroundColor(Bars.COLOR)
            visibility = View.GONE
            isClickable = true
        }
        failureText = TextView(this).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            setTextColor(getColor(R.color.text))
            gravity = Gravity.CENTER
        }
        box.addView(failureText)
        box.addView(Button(this).apply {
            text = "Retry"
            setOnClickListener { retry() }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(20) })
        box.addView(Button(this).apply {
            text = "Change server"
            setOnClickListener { startActivity(Intent(this@MainActivity, ConnectActivity::class.java)) }
        })
        return box
    }

    private fun retry() {
        val server = Prefs.server(this) ?: return
        failureText.text = "Connecting to $server…"
        if (web.url != null && server == loaded) web.reload() else load(server)
    }

    private fun askForNotifications() {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
    }

    private fun dp(v: Int): Int = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()
}
