package app.rouen.android

import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.Socket
import java.net.URLDecoder

/**
 * Rouen's page served by the app when Rouen can't be reached (dev/design/android-app.md §4.19, v1.9.72-t29): the
 * page's own address (127.0.0.1:34600, [PageRelay]) answers from the copy of public/ the APK carries, so the page is
 * the same page, at the same address (the theme and what it keeps in the browser stay), with offline.js put first in
 * its <head>. That script answers the page's /api from the phone; here only:
 *
 *   - the page's files, from [read] (the APK's assets, page/<name>);
 *   - /api/image/dl:<key>, a downloaded album's cover, from [cover] (an <img> is not asked through the page's fetch);
 *   - anything else under /api/: 503, Rouen can't be reached.
 *
 * Free of Android, so it is tested on the JVM with real sockets (src/test).
 */
class OfflineSite(private val read: (String) -> ByteArray?, private val cover: (String) -> ByteArray?) {
    class Answer(val status: Int, val type: String, val body: ByteArray)

    /** What [method] on [target] (the request's path and query) is answered. */
    fun answer(method: String, target: String): Answer {
        if (method != "GET" && method != "HEAD") return text(405, "Rouen can't be reached: nothing can be changed.")
        val path = target.substringBefore('#').substringBefore('?')
        if (path.startsWith("/api/image/")) {
            val key = try { URLDecoder.decode(path.removePrefix("/api/image/"), "UTF-8") } catch (e: IllegalArgumentException) { "" }
            val bytes = if (key.startsWith("dl:")) cover(key.removePrefix("dl:")) else null
            return if (bytes != null) Answer(200, "image/jpeg", bytes) else text(404, "No cover on this phone.")
        }
        if (path.startsWith("/api/")) return Answer(503, "application/json", "{\"error\":\"Rouen can't be reached.\"}".toByteArray())
        val name = if (path == "/" || path.isEmpty()) "index.html" else path.removePrefix("/")
        if (!safe(name)) return text(404, "Not here.")
        val bytes = read(name) ?: return text(404, "Not in the app's copy of Rouen's page.")
        return Answer(200, typeOf(name), if (name == "index.html") inject(bytes) else bytes)
    }

    /** One request on [socket], answered, and the connection closed (the page opens another for the next). */
    fun serve(socket: Socket) {
        socket.use { s ->
            try {
                s.soTimeout = 10_000
                val input = BufferedInputStream(s.getInputStream())
                val first = line(input) ?: return
                while (true) { val h = line(input) ?: break; if (h.isEmpty()) break }   // the headers: none is needed
                val parts = first.split(' ')
                if (parts.size < 2) return
                val a = answer(parts[0], parts[1])
                val out = s.getOutputStream()
                out.write(("HTTP/1.1 ${a.status} ${reason(a.status)}\r\nContent-Type: ${a.type}\r\nContent-Length: ${a.body.size}\r\n" +
                    "Cache-Control: no-store\r\nConnection: close\r\n\r\n").toByteArray(Charsets.US_ASCII))
                if (parts[0] != "HEAD") out.write(a.body)
                out.flush()
            } catch (e: IOException) {
                // The page went (a reload, the app closed): the request has no one to answer, and the socket closes.
            }
        }
    }

    private fun line(input: InputStream): String? {
        val buf = ByteArrayOutputStream()
        while (true) {
            val b = input.read()
            if (b < 0) return if (buf.size() == 0) null else buf.toString("ISO-8859-1")
            if (b == '\n'.code) return buf.toString("ISO-8859-1").trimEnd('\r')
            if (buf.size() > 16 * 1024) return null
            buf.write(b)
        }
    }

    private fun text(status: Int, s: String) = Answer(status, "text/plain; charset=utf-8", s.toByteArray())

    companion object {
        const val SCRIPT = "<script src=\"/offline.js\"></script>"

        /** The page with offline.js first in its <head>, before any of the page's own scripts. */
        fun inject(html: ByteArray): ByteArray {
            val s = String(html, Charsets.UTF_8)
            val m = Regex("<head[^>]*>", RegexOption.IGNORE_CASE).find(s)
            val out = if (m != null) s.substring(0, m.range.last + 1) + SCRIPT + s.substring(m.range.last + 1) else SCRIPT + s
            return out.toByteArray(Charsets.UTF_8)
        }

        /** A file of the page's: no way out of its folder, and nothing but a plain path. */
        fun safe(name: String): Boolean =
            name.isNotEmpty() && !name.startsWith("/") && !name.contains("..") && name.all { it.isLetterOrDigit() || it in "._-/" }

        fun typeOf(name: String): String = when (name.substringAfterLast('.', "").lowercase()) {
            "html" -> "text/html; charset=utf-8"
            "js" -> "text/javascript; charset=utf-8"
            "css" -> "text/css; charset=utf-8"
            "json", "webmanifest" -> "application/json"
            "svg" -> "image/svg+xml"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "webp" -> "image/webp"
            "ico" -> "image/x-icon"
            "woff2" -> "font/woff2"
            "woff" -> "font/woff"
            else -> "application/octet-stream"
        }

        private fun reason(status: Int) = when (status) {
            200 -> "OK"; 404 -> "Not Found"; 405 -> "Method Not Allowed"; 503 -> "Service Unavailable"; else -> "Error"
        }
    }
}
