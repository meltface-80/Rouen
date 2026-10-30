package app.rouen.android

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.Environment
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.lang.ref.WeakReference

/**
 * `window.RouenPhone`: what Rouen's page can ask of the app, only inside the app (as Mandarin's
 * `MusicdDownloads`, meltface-80/Mandarin: android/app/.../DownloadsBridge.kt). The page offers
 * these settings only when the bridge is there, so browsers are unchanged.
 *
 *   RouenPhone.settings()        {"homeQuality", "awayQuality", "network", "downloadQuality",
 *                                 "downloadLocation", "downloadWifiOnly", "downloadLimitGb",
 *                                 "places": [{"id", "label", "free"}]}
 *   RouenPhone.set(key, value)   one of [PhoneChoices.KEYS], value as text: the new settings(),
 *                                or {"error": "…"}
 *   RouenPhone.appUpdate()       the app's own update ([AppUpdate], §4.12): {"current", "latest",
 *                                "available", "busy", "error"}
 *   RouenPhone.tailscale()       this phone on the tailnet ([PhoneTailscale], §4.7): {"installed", "on",
 *                                "signedIn", "canSignOut", "hostname", "text", "way"} as last looked;
 *   RouenPhone.tailscaleLook()   look again (the page tells itself so, through __rouenPhoneChanged)
 *   RouenPhone.tailscaleSignIn() / tailscaleSignOut() / tailscaleUse("true"|"false")
 *   RouenPhone.logging()         the app's log ([AppLog], §4.13): {"on", "about", "saving", "saved", "error"}
 *   RouenPhone.loggingUse("true"|"false") / loggingSave() / loggingClear()
 *   RouenPhone.appUpdateCheck()  look for a newer app; appUpdateInstall() fetch and install it.
 *                                Both answer at once; the page hears the outcome through
 *                                `window.__rouenPhoneChanged()`.
 *   RouenPhone.cardCopy(png, name) / cardSave(png, name)
 *                                the share card's Copy image and Download ([CardShare], §4.17):
 *                                its PNG as base64, and its file name; {"ok": true} or {"error": "…"}
 *   RouenPhone.fileSave(data, name)  one of the page's downloads ([SavedFile]: a .musicd, a .log, a backup's
 *                                .json) to the phone's Downloads/Rouen ([DownloadsFolder], §4.17); as above
 *
 * The streaming qualities take effect at once ([PlayerService] says hello again with the one in
 * use, and Rouen applies it from the next session Roon starts). The download settings are only
 * kept: downloads come in a later build. Whatever the app itself changes (the way to Rouen, the
 * server screen), the page hears through `window.__rouenPhoneChanged()` ([MainActivity]).
 *
 * Every method answers only while the page in the WebView is Rouen's own ([origin], kept by
 * MainActivity as each page starts): any other page gets {"error"}. Called on the WebView's
 * JavaScript thread, never the main one.
 */
class RouenPhone(context: Context) {
    companion object { const val NAME = "RouenPhone" }

    private val c = context.applicationContext

    /** The activity the app's update is installed from (MainActivity). */
    @Volatile var activity: WeakReference<Activity>? = null
    private val main = Handler(Looper.getMainLooper())

    /** The origin ("host:port") of the page now in the WebView. */
    @Volatile var origin: String? = null

    /** The settings as the page last had them ([signature]; null: it has not asked yet). */
    @Volatile private var lastSent: String? = null

    @JavascriptInterface
    fun settings(): String {
        if (!allowed()) return refused()
        lastSent = signature()
        return now()
    }

    @JavascriptInterface
    fun set(key: String?, value: String?): String {
        if (!allowed()) return refused()
        val k = key ?: ""
        val v = value ?: ""
        val parsed = PhoneChoices.parse(k, v, places().map { it.first })
            ?: return JSONObject().put("error", PhoneChoices.refusal(k, v)).toString()
        Prefs.setChoice(c, k, parsed)
        lastSent = signature()
        return now()
    }

    @JavascriptInterface
    fun tailscale(): String = if (!allowed()) refused() else PhoneTailscale.statusJson(c)

    /** Look again; the answer comes through window.__rouenPhoneChanged (so reading it there never asks again). */
    @JavascriptInterface
    fun tailscaleLook(): String {
        if (!allowed()) return refused()
        PhoneTailscale.look(c)
        return "{}"
    }

    @JavascriptInterface
    fun tailscaleSignIn(): String {
        if (!allowed()) return refused()
        PhoneTailscale.signIn(c) { url ->
            val a = activity?.get()
            if (a != null && !a.isFinishing && !a.isDestroyed) {
                try {
                    a.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                } catch (e: ActivityNotFoundException) {
                    // No browser: the page shows the state, and the server screen's sign-in says the same.
                }
            }
        }
        return PhoneTailscale.statusJson(c)
    }

    @JavascriptInterface
    fun tailscaleSignOut(): String {
        if (!allowed()) return refused()
        PhoneTailscale.signOut(c)
        return PhoneTailscale.statusJson(c)
    }

    @JavascriptInterface
    fun tailscaleUse(on: String?): String {
        if (!allowed()) return refused()
        PhoneTailscale.use(c, on == "true")
        return PhoneTailscale.statusJson(c)
    }

    @JavascriptInterface
    fun logging(): String = if (!allowed()) refused() else loggingJson()

    private fun loggingJson(): String = JSONObject()
        .put("on", AppLog.on)
        .put("about", if (AppLog.on) AppLog.about() else "")
        .put("saving", AppLog.saving)
        .put("saved", AppLog.saved ?: JSONObject.NULL)
        .put("error", AppLog.saveError ?: JSONObject.NULL)
        .toString()

    @JavascriptInterface
    fun loggingUse(on: String?): String {
        if (!allowed()) return refused()
        AppLog.switch(c, on == "true")
        return loggingJson()
    }

    /** Save to Downloads/Rouen: answers at once; the outcome comes through window.__rouenPhoneChanged. */
    @JavascriptInterface
    fun loggingSave(): String {
        if (!allowed()) return refused()
        val a = activity?.get() ?: return JSONObject().put("error", "the app is not on screen").toString()
        val base = Away.active(c)?.base?.let { PageRelay.loginBase(it) }
        main.post { AppLog.save(a, base) }
        return loggingJson()
    }

    @JavascriptInterface
    fun loggingClear(): String {
        if (!allowed()) return refused()
        AppLog.clear()
        return loggingJson()
    }

    @JavascriptInterface
    fun appUpdate(): String = if (!allowed()) refused() else AppUpdate.statusJson()

    @JavascriptInterface
    fun appUpdateCheck(): String {
        if (!allowed()) return refused()
        AppUpdate.lookup()
        return AppUpdate.statusJson()
    }

    @JavascriptInterface
    fun appUpdateInstall(): String {
        if (!allowed()) return refused()
        val a = activity?.get() ?: return JSONObject().put("error", "the app is not on screen").toString()
        main.post { AppUpdate.install(a) }
        return AppUpdate.statusJson()
    }

    @JavascriptInterface
    fun cardCopy(png: String?, name: String?): String = card(png, name) { bytes, file -> CardShare.copy(c, bytes, file) }

    @JavascriptInterface
    fun cardSave(png: String?, name: String?): String = card(png, name) { bytes, file ->
        val a = activity?.get() ?: return@card "the app is not on screen"
        CardShare.save(a, bytes, file)
    }

    @JavascriptInterface
    fun fileSave(data: String?, name: String?): String {
        if (!allowed()) return refused()
        val f = SavedFile.accept(data, name) ?: return JSONObject().put("error", SavedFile.refusal(data, name)).toString()
        val a = activity?.get() ?: return JSONObject().put("error", "the app is not on screen").toString()
        if (!DownloadsFolder.mayWrite(a)) return JSONObject().put("error", "Allow Rouen to save to the phone's storage, then try again").toString()
        return try {
            DownloadsFolder.write(a, f.bytes, f.name, f.mime)
            JSONObject().put("ok", true).put("name", f.name).toString()
        } catch (e: java.io.IOException) {
            JSONObject().put("error", "Couldn't save it: ${e.message ?: e.javaClass.simpleName}").toString()
        } catch (e: SecurityException) {
            JSONObject().put("error", "Couldn't save it: Android refused the storage").toString()
        }
    }

    /** One of the card's acts, on what the page sent once it is a PNG ([CardFile]): {"ok": true} or {"error": why not}. */
    private fun card(png: String?, name: String?, act: (ByteArray, String) -> String?): String {
        if (!allowed()) return refused()
        val bytes = CardFile.decode(png) ?: return JSONObject().put("error", "that is not the card's picture").toString()
        val why = act(bytes, CardFile.safeName(name))
        return if (why == null) JSONObject().put("ok", true).toString() else JSONObject().put("error", why).toString()
    }

    /**
     * Has something the page shows changed since it last asked (the app's own change: the way to
     * Rouen, the server screen)? Then the page is to be told; free space alone does not count.
     */
    fun changedForPage(): Boolean {
        val was = lastSent ?: return false
        val sig = signature()
        if (sig == was) return false
        lastSent = sig
        return true
    }

    /** What the page shows, but free space. */
    private fun signature(): String =
        PhoneChoices.KEYS.joinToString(",") { "$it=${Prefs.choice(c, it)}" } +
            ",network=" + PhoneChoices.network(Away.active(c)?.kind, Away.hasNetwork(c)) +
            ",places=" + places().joinToString("|") { it.first }

    /** The settings now, as JSON text. */
    private fun now(): String {
        val o = JSONObject()
        for (k in PhoneChoices.KEYS) o.put(k, Prefs.choice(c, k))
        o.put("network", PhoneChoices.network(Away.active(c)?.kind, Away.hasNetwork(c)))
        val list = JSONArray()
        for ((id, label, free) in places()) list.put(JSONObject().put("id", id).put("label", label).put("free", free))
        o.put("places", list)
        return o.toString()
    }

    private fun allowed(): Boolean {
        val at = origin ?: return false
        return Away.origins(c).any { it.equals(at, ignoreCase = true) }
    }

    private fun refused(): String = JSONObject().put("error", "only Rouen's own page may ask").toString()

    /** Phone storage, and an SD card when there is one: (id, label, free bytes). As Mandarin's DownloadStore.places. */
    private fun places(): List<Triple<String, String, Long>> {
        val dirs = c.getExternalFilesDirs("music").toList()
        val out = ArrayList<Triple<String, String, Long>>()
        dirs.forEachIndexed { i, d ->
            if (d == null) return@forEachIndexed
            val removable = i > 0 && try { Environment.isExternalStorageRemovable(d) } catch (e: IllegalArgumentException) { true }
            if (i == 0) out += Triple("phone", "Phone storage", free(d))
            else if (removable && out.none { it.first == "sd" }) out += Triple("sd", "SD card", free(d))
        }
        if (out.none { it.first == "phone" }) out.add(0, Triple("phone", "Phone storage", free(File(c.filesDir, "music"))))
        return out
    }

    private fun free(d: File): Long = try { d.usableSpace } catch (e: SecurityException) { 0L }
}
