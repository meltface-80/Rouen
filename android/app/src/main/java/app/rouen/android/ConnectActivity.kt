package app.rouen.android

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.TextView
import java.util.concurrent.Executors

/**
 * The server, the phone's name and the quality (dev/design/android-app.md §4.8): on first run,
 * from the launcher shortcut "Server & playback", and from the "can't reach Rouen" screen.
 *
 * Rouen is looked for on the phone's /24 at port 3399 as soon as the screen opens; the servers
 * that answer are listed to tap. An address can be typed instead (host, or host:port).
 * Everything is saved on Connect, once the address has answered as a Rouen.
 */
class ConnectActivity : Activity() {

    private val main = Handler(Looper.getMainLooper())
    private val work = Executors.newSingleThreadExecutor { r -> Thread(r, "connect").apply { isDaemon = true } }

    private lateinit var status: TextView
    private lateinit var found: LinearLayout
    private lateinit var searchAgain: Button
    private lateinit var address: EditText
    private lateinit var name: EditText
    private lateinit var opus: RadioButton
    private lateinit var lossless: RadioButton
    private lateinit var connect: Button
    private var searching = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = dp(20)
            setPadding(pad, pad, pad, pad)
        }
        column.addView(text("Rouen", 26f, R.color.text).apply { setPadding(0, 0, 0, dp(4)) })
        column.addView(text("Server & playback", 15f, R.color.text_dim).apply { setPadding(0, 0, 0, dp(20)) })

        column.addView(heading("Rouen on this network"))
        status = text("", 14f, R.color.text_dim).apply { setPadding(0, dp(4), 0, dp(8)) }
        column.addView(status)
        found = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        column.addView(found)
        searchAgain = Button(this).apply { text = "Search again"; setOnClickListener { search() } }
        column.addView(searchAgain)

        column.addView(heading("Or its address"))
        address = field("192.168.1.20 or 192.168.1.20:3399", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI)
        address.setText(Prefs.server(this) ?: "")
        address.imeOptions = EditorInfo.IME_ACTION_GO
        address.setOnEditorActionListener { _, action, _ -> if (action == EditorInfo.IME_ACTION_GO) { connectTyped(); true } else false }
        column.addView(address)

        column.addView(heading("This phone's name"))
        column.addView(text("Roon shows this phone as the zone \"Rouen <name>\".", 13f, R.color.text_dim))
        name = field("Phone name", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS)
        name.setText(Prefs.name(this))
        column.addView(name)

        column.addView(heading("Quality"))
        opus = RadioButton(this).apply { id = View.generateViewId(); text = "Opus 256 kbps (default)"; setTextColor(getColor(R.color.text)) }
        lossless = RadioButton(this).apply { id = View.generateViewId(); text = "Lossless (FLAC)"; setTextColor(getColor(R.color.text)) }
        val group = RadioGroup(this).apply { addView(opus); addView(lossless) }
        group.check(if (Prefs.quality(this) == Prefs.LOSSLESS) lossless.id else opus.id)
        column.addView(group)

        connect = Button(this).apply { text = "Connect"; setOnClickListener { connectTyped() } }
        column.addView(connect, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(16) })

        val scroll = ScrollView(this).apply { isFillViewport = true; addView(column) }
        setContentView(scroll)
        Bars.apply(this, scroll)
        search()
    }

    override fun onDestroy() {
        work.shutdownNow()
        super.onDestroy()
    }

    private fun search() {
        if (searching) return
        val mine = Finder.localIpv4()
        if (mine.isEmpty()) {
            status.text = "This phone isn't on a local network. Join your Wi-Fi, or type Rouen's address."
            return
        }
        searching = true
        searchAgain.isEnabled = false
        found.removeAllViews()
        status.text = "Looking for Rouen on port ${Prefs.DEFAULT_PORT}…"
        Thread({
            val hosts = mine.take(2).flatMap { Finder.candidates(it) }.distinct()
            val hits = Finder.find(hosts, onFound = { h -> main.post { addFound("$h:${Prefs.DEFAULT_PORT}") } }) { h ->
                Finder.isRouen("$h:${Prefs.DEFAULT_PORT}", PROBE_CONNECT_MS, PROBE_READ_MS)
            }
            main.post {
                if (isFinishing || isDestroyed) return@post
                searching = false
                searchAgain.isEnabled = true
                status.text = when (hits.size) {
                    0 -> "No Rouen answered on port ${Prefs.DEFAULT_PORT}. Type its address below."
                    1 -> "Found Rouen. Tap it to connect."
                    else -> "Found ${hits.size} servers. Tap the one to use."
                }
            }
        }, "search").apply { isDaemon = true }.start()
    }

    private fun addFound(server: String) {
        if (isFinishing || isDestroyed) return
        for (i in 0 until found.childCount) if (found.getChildAt(i).tag == server) return
        found.addView(Button(this).apply {
            tag = server
            text = server
            gravity = Gravity.CENTER
            setOnClickListener { address.setText(server); tryConnect(server) }
        })
    }

    private fun connectTyped() {
        val server = Prefs.parseAddress(address.text.toString())
        if (server == null) {
            status.text = "That isn't an address. Type it as 192.168.1.20 or 192.168.1.20:3399."
            return
        }
        tryConnect(server)
    }

    private fun tryConnect(server: String) {
        val phone = name.text.toString()
        val quality = if (lossless.isChecked) Prefs.LOSSLESS else Prefs.OPUS
        connect.isEnabled = false
        status.text = "Connecting to $server…"
        work.execute {
            val ok = Finder.isRouen(server, CONNECT_MS, CONNECT_MS)
            main.post {
                if (isFinishing || isDestroyed) return@post
                connect.isEnabled = true
                if (!ok) {
                    status.text = "Rouen didn't answer at $server. Check the address and port, that Rouen is running, " +
                        "and that this phone is on the same network."
                    return@post
                }
                Prefs.save(this, server, phone, quality)
                // The player starts again with the new server, name and quality (MainActivity starts it).
                stopService(Intent(this, PlayerService::class.java))
                startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK))
                finish()
            }
        }
    }

    private fun dp(v: Int): Int = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    private fun text(s: String, sizeSp: Float, color: Int) = TextView(this).apply {
        text = s
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
        setTextColor(getColor(color))
    }

    private fun heading(s: String) = text(s, 16f, R.color.text).apply { setPadding(0, dp(20), 0, dp(4)) }

    private fun field(hint: String, type: Int) = EditText(this).apply {
        this.hint = hint
        inputType = type
        isSingleLine = true
        setTextColor(getColor(R.color.text))
        setHintTextColor(getColor(R.color.text_dim))
    }

    companion object {
        private const val PROBE_CONNECT_MS = 700
        private const val PROBE_READ_MS = 1500
        private const val CONNECT_MS = 4000
    }
}
