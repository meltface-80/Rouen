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
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
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
 * The page is loaded from the way to Rouen chosen now ([Away]: home, Rouen's tailnet address, or
 * the built-in Tailscale's 127.0.0.1:34500), and again from the new one on a switch, on the same
 * path; Rouen's login is carried to the new origin first, so it is not asked for twice.
 *
 * The page gets `window.RouenPhone` ([RouenPhone]: the phone's streaming and download settings),
 * answering only while the page is Rouen's own; when the app itself changes what it shows (the way
 * to Rouen, the server screen), the page is told with `window.__rouenPhoneChanged()`.
 *
 * Links to other hosts open in the browser; back goes back in the page's history; a page that
 * cannot load offers Retry and "Change server".
 *
 * Never a black screen, never a silent one (§4.15): while the page loads, "Connecting to Rouen…" is
 * shown until it is on screen, and a page that has not come in [LOAD_MS] is said not to answer (it may
 * still come: a slow tunnel's page is not cut off, and uncovers itself when it does).
 * When the way says Rouen can't be reached, that is said over the page, with why, and nothing is
 * loaded from an address that would only hang; when it is reached again, the page comes back.
 */
class MainActivity : ComponentActivity() {

    companion object {
        const val ACTION_CONNECT = "app.rouen.android.action.CONNECT"
        /** How long a page may take to come before Rouen is said not to answer. */
        private const val LOAD_MS = 20_000L
    }

    private lateinit var web: WebView
    private lateinit var failure: View
    private lateinit var failureText: TextView
    private lateinit var phone: RouenPhone
    /** The origin the page was loaded from ("http://host:port"). */
    private var loadedBase: String? = null
    private var failed = false
    /** When the page last started loading, for its time in the app's log. */
    private var pageStarted = 0L
    private var forgetHistory = false
    /** The page loaded last ([load]) is on screen. */
    private var pageShown = false
    /** The way said Rouen can't be reached (or is being connected), and the page is covered. */
    private var covered = false
    /** The page loaded last has not come in [LOAD_MS]: said, and the way looked at again; the load goes on. */
    private val stuck = Runnable {
        if (pageShown || failed || isDestroyed) return@Runnable
        AppLog.line("PAGE", "no page in ${LOAD_MS / 1000} s: Rouen isn't answering", anomaly = true)
        showFailure("Rouen didn't answer in ${LOAD_MS / 1000} seconds.")
        Away.trouble(this)
    }

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
        if (savedInstanceState != null && web.restoreState(savedInstanceState) != null) {
            loadedBase = Away.active(this)?.base
            pageShown = true
        }
        Away.listen(onWay)
        askForNotifications()
        // The app's own update (§4.12): looked for each time the app starts; the page hears what came of it.
        AppUpdate.changed = {
            if (!isDestroyed && ::web.isInitialized) web.evaluateJavascript("window.__rouenPhoneChanged && window.__rouenPhoneChanged()", null)
        }
        if (savedInstanceState == null) AppUpdate.lookup()
        // A log saved (or not): the page's Logging hears (§4.13).
        AppLog.changed = AppUpdate.changed
        // This phone on the tailnet (Rouen's Away from home page, This phone): the page hears when it moved.
        PhoneTailscale.listen(onTailscale)
    }

    private val onTailscale: () -> Unit = {
        if (!isDestroyed && ::web.isInitialized) web.evaluateJavascript("window.__rouenPhoneChanged && window.__rouenPhoneChanged()", null)
    }

    /** The way to Rouen chosen (again), or the built-in Tailscale come up: the page follows. */
    private val onWay: (Away.Active) -> Unit = { a ->
        if (!isDestroyed && ::web.isInitialized && a.server == Prefs.server(this)) follow(a)
    }

    /**
     * The page on the way [a] (§4.15): loaded from it when Rouen is reached there, and again when it
     * failed or never came; otherwise said over the page why not, or that it is being connected.
     */
    private fun follow(a: Away.Active) {
        when (a.reach) {
            Way.Reach.NO -> { covered = true; showFailure(null, a.why) }
            Way.Reach.CONNECTING -> { covered = true; showWaiting("Connecting to Rouen through Tailscale on this phone…") }
            Way.Reach.YES -> {
                val wasCovered = covered
                covered = false
                when {
                    a.base != loadedBase -> load(a.base)
                    // Failed, or left loading while Rouen could not be reached: loaded afresh.
                    failed || (!pageShown && wasCovered) -> load(a.base)
                    // Loading now: its own time limit stands.
                    !pageShown -> Unit
                    else -> {
                        if (wasCovered) failure.visibility = View.GONE
                        tellPage()
                    }
                }
            }
        }
    }

    /** The page told that what RouenPhone.settings() says has changed, when it has (not by the page itself). */
    private fun tellPage() {
        if (::phone.isInitialized && phone.changedForPage()) {
            web.evaluateJavascript("window.__rouenPhoneChanged && window.__rouenPhoneChanged()", null)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == ACTION_CONNECT) startActivity(Intent(this, ConnectActivity::class.java))
    }

    override fun onStart() {
        super.onStart()
        PlayerService.setAppVisible(true)
        AppLog.snapshots("page", true)
        if (Prefs.server(this) == null) return
        Away.start(this)
        startService(Intent(this, PlayerService::class.java))
        // A load left while the app was away (its time limit counts only while on screen): timed again from now.
        if (loadedBase != null && !pageShown && !failed) { web.removeCallbacks(stuck); web.postDelayed(stuck, LOAD_MS) }
        val a = Away.active(this)
        if (a != null) follow(a) else if (loadedBase == null) showLooking() else tellPage()
    }

    override fun onStop() {
        PlayerService.setAppVisible(false)
        // Out of sight a page may come only with all its covers (no first paint is shown): not timed meanwhile.
        if (::web.isInitialized) web.removeCallbacks(stuck)
        AppLog.snapshots("page", false)
        // The login cookie reaches disk now, so the player still has it if the app is closed.
        CookieManager.getInstance().flush()
        super.onStop()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (::web.isInitialized) web.saveState(outState)
    }

    override fun onDestroy() {
        Away.unlisten(onWay)
        AppUpdate.changed = null
        AppLog.changed = null
        PhoneTailscale.unlisten(onTailscale)
        if (::web.isInitialized) { web.removeCallbacks(stuck); web.destroy() }
        super.onDestroy()
    }

    /** The page from [base], on the path it is on now when that is Rouen's (a switch keeps the screen). */
    private fun load(base: String) {
        val path = web.url?.let { Uri.parse(it) }?.takeIf { isOwn(it) }?.let { u ->
            (u.encodedPath ?: "/") + (u.encodedQuery?.let { "?$it" } ?: "") + (u.encodedFragment?.let { "#$it" } ?: "")
        } ?: "/"
        forgetHistory = loadedBase != null
        loadedBase = base
        pageShown = false
        failed = false
        showWaiting("Connecting to Rouen…")
        web.removeCallbacks(stuck)
        web.postDelayed(stuck, LOAD_MS)
        web.loadUrl(base + path)
    }

    private fun showLooking() = showWaiting("Looking for Rouen…")

    private fun showWaiting(text: String) {
        failureText.text = text
        failure.visibility = View.VISIBLE
    }

    /** The page loaded last is on screen: uncovered, unless the way says Rouen can't be reached. */
    private fun shown() {
        if (failed || pageShown) return
        pageShown = true
        web.removeCallbacks(stuck)
        if (!covered) failure.visibility = View.GONE
    }

    @SuppressLint("SetJavaScriptEnabled") // Rouen is a JavaScript app; the WebView shows only the user's own Rouen
    private fun setUpWebView() {
        CookieManager.getInstance().setAcceptCookie(true)
        web.setBackgroundColor(Bars.COLOR)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        // Lets Rouen's page know it runs in the app.
        web.settings.userAgentString = web.settings.userAgentString + " RouenAndroid/" + BuildConfig.VERSION_NAME
        web.webChromeClient = object : WebChromeClient() {
            // The page's own errors and warnings, in the app's log while it is on (PAGE, §4.13).
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                if (m.messageLevel() == ConsoleMessage.MessageLevel.ERROR || m.messageLevel() == ConsoleMessage.MessageLevel.WARNING) {
                    AppLog.line("PAGE", "console ${m.messageLevel().name.lowercase()}: ${m.message()} (${Uri.parse(m.sourceId()).path ?: "?"}:${m.lineNumber()})",
                        anomaly = m.messageLevel() == ConsoleMessage.MessageLevel.ERROR)
                }
                return super.onConsoleMessage(m)
            }
        }
        phone = RouenPhone(this)
        phone.activity = java.lang.ref.WeakReference(this)
        web.addJavascriptInterface(phone, RouenPhone.NAME)
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
                pageStarted = android.os.SystemClock.elapsedRealtime()
                AppLog.line("PAGE", "loading ${url?.let { Uri.parse(it).path?.ifEmpty { "/" } } ?: "?"} from $url")
                // The bridge answers this page only if it is Rouen's (RouenPhone checks the origin).
                phone.origin = url?.let { hostPort(Uri.parse(it)) }
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                // Failed already, or an earlier load's (one interrupted by a way's switch): the reason given stands.
                if (!request.isForMainFrame || failed || !isCurrent(request.url.toString())) return
                AppLog.line("PAGE", "the page could not load: ${error.description} (error ${error.errorCode})", anomaly = true)
                failed = true
                web.removeCallbacks(stuck)
                showFailure(error.description?.toString())
            }

            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
                if (request.isForMainFrame || errorResponse.statusCode >= 500) {
                    AppLog.line("PAGE", "HTTP ${errorResponse.statusCode} for ${request.url.path}", anomaly = true)
                }
            }

            // The page's first paint: on screen from now, before its images and the rest have come.
            override fun onPageCommitVisible(view: WebView, url: String?) { if (isCurrent(url)) shown() }

            override fun onPageFinished(view: WebView, url: String?) {
                AppLog.line("PAGE", "loaded in ${android.os.SystemClock.elapsedRealtime() - pageStarted} ms" + if (failed) " (failed)" else "")
                if (failed || !isCurrent(url)) return
                shown()
                if (forgetHistory) { forgetHistory = false; web.clearHistory() }
            }
        }
    }

    /** [url] is of the origin loaded last, not an earlier load's, cut short by a switch of way (null: can't tell, so taken). */
    private fun isCurrent(url: String?): Boolean {
        val at = url?.let { hostPort(Uri.parse(it)) } ?: return true
        val base = loadedBase?.let { hostPort(Uri.parse(it)) } ?: return true
        return at.equals(base, ignoreCase = true)
    }

    /** A link to Rouen (its home address, its tailnet address, or the built-in Tailscale's port), as against anywhere else. */
    private fun isOwn(url: Uri): Boolean {
        val at = hostPort(url) ?: return false
        return Away.origins(this).any { it.equals(at, ignoreCase = true) }
    }

    /** An http(s) address's "host:port" (the port said or the scheme's), or null for anything else. */
    private fun hostPort(url: Uri): String? {
        val scheme = url.scheme ?: return null
        if (scheme != "http" && scheme != "https") return null
        val port = if (url.port != -1) url.port else if (scheme == "https") 443 else 80
        return "${url.host}:$port"
    }

    /** Rouen not reached: [why] the way says so (§4.15), or else what the page's load met ([reason]), with a hint. */
    private fun showFailure(reason: String?, why: String? = null) {
        // The way says Rouen can't be reached, and why: that stands over what a load met meanwhile.
        if (why == null && covered) { failure.visibility = View.VISIBLE; return }
        if (why != null) {
            failureText.text = "Can't reach Rouen.\n\n$why"
            failure.visibility = View.VISIBLE
            return
        }
        val a = Away.active(this)
        val hint = when {
            a?.kind == Way.Kind.ENGINE -> "This phone is away from home, using the built-in Tailscale. Check that Rouen is running " +
                "and on your tailnet, and that this phone is signed in (Change server → Away from home)."
            a?.kind == Way.Kind.DIRECT -> "This phone is away from home, using Rouen's tailnet address through a VPN. " +
                "Check that Rouen is running and that the VPN is connected."
            Prefs.awayAddress(this) == null -> "Check that Rouen is running and that this phone is on the same network."
            else -> "Check that Rouen is running and that this phone is on the same network. Away from home, sign in to " +
                "Tailscale (Change server → Away from home)."
        }
        failureText.text = "Couldn't reach Rouen at ${loadedBase?.removePrefix("http://") ?: "?"}." +
            (reason?.let { "\n\n$it" } ?: "") + "\n\n" + hint
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

    /** Retry: the way to Rouen looked at again (come home, say), and the page loaded again on it. */
    private fun retry() {
        Away.retry(this)
        val a = Away.active(this) ?: return showLooking()
        // Not reached: the look just asked for says again, or loads the page once Rouen answers.
        if (a.reach != Way.Reach.YES) return showWaiting("Looking for Rouen…")
        load(a.base)
    }

    private fun askForNotifications() {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
    }

    private fun dp(v: Int): Int = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()
}
