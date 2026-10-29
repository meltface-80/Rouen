package app.rouen.android

import android.webkit.CookieManager
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Rouen's routes, asked with the WebView's own login (dev/design/android-app.md §4.8):
 * the `rouen_session` cookie from the WebView's cookie store goes with every request, so the
 * player is logged in exactly when the page is. Nothing else signs in.
 *
 * Every call throws [IOException] when Rouen cannot be reached; an HTTP status is an answer.
 */
class Api(val base: String, private val cookies: CookieManager) {

    class Reply(val code: Int, val text: String) {
        /** The body as a JSON object, or null when it is not one. */
        fun json(): JSONObject? = try { JSONObject(text) } catch (e: org.json.JSONException) { null }
    }

    /** The WebView's cookies for Rouen, as a Cookie header (null before any login). */
    fun cookie(): String? = cookies.getCookie(base)?.takeIf { it.isNotBlank() }

    fun get(path: String, timeoutMs: Int): Reply = call("GET", path, null, timeoutMs)

    fun post(path: String, body: JSONObject, timeoutMs: Int): Reply = call("POST", path, body, timeoutMs)

    /** Raw bytes (a cover), or null for anything but a 200. */
    fun bytes(path: String, timeoutMs: Int): ByteArray? {
        val conn = open("GET", path, timeoutMs)
        try {
            if (conn.responseCode != 200) return null
            return conn.inputStream.use { it.readBytes() }
        } finally {
            conn.disconnect()
        }
    }

    private fun call(method: String, path: String, body: JSONObject?, timeoutMs: Int): Reply {
        val conn = open(method, path, timeoutMs)
        try {
            conn.setRequestProperty("Accept", "application/json")
            if (body != null) {
                val bytes = body.toString().toByteArray(Charsets.UTF_8)
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setFixedLengthStreamingMode(bytes.size)
                conn.outputStream.use { it.write(bytes) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            return Reply(code, text)
        } finally {
            conn.disconnect()
        }
    }

    private fun open(method: String, path: String, timeoutMs: Int): HttpURLConnection {
        val conn = URL(base + path).openConnection() as HttpURLConnection
        conn.requestMethod = method
        conn.connectTimeout = minOf(timeoutMs, CONNECT_MS)
        conn.readTimeout = timeoutMs
        conn.useCaches = false
        conn.instanceFollowRedirects = false
        cookie()?.let { conn.setRequestProperty("Cookie", it) }
        return conn
    }

    companion object {
        private const val CONNECT_MS = 8_000
    }
}
