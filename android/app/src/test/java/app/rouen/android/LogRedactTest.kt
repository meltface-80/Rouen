package app.rouen.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The app's log holds no personal data (dev/design/android-app.md §4.13): each line goes through LogRedact before it is
 * written. Mandarin's LogRedactTest (its owner's logs of 20 and 21 October), and Rouen's own requests and lines.
 */
class LogRedactTest {
    private fun same(s: String) = assertEquals(s, LogRedact.line(s))

    @Test fun `addresses of every kind`() {
        assertEquals("WAY    home at http://[address] answers", LogRedact.line("WAY    home at http://192.168.0.57:3399 answers"))
        assertEquals("WAY    the forward at http://[address] missed", LogRedact.line("WAY    the forward at http://127.0.0.1:34500 missed"))
        assertEquals("NET    GET /api/login → SocketTimeoutException: failed to connect to /[ip] (port 3399) from /[ip] (port 50928) after 5000ms",
            LogRedact.line("NET    GET /api/login → SocketTimeoutException: failed to connect to /192.168.0.57 (port 3399) from /192.0.0.4 (port 50928) after 5000ms"))
        assertEquals("away: using [ip]:3399", LogRedact.line("away: using 100.92.159.80:3399"))
        assertEquals("route [ip] via [ip]", LogRedact.line("route 10.2.0.0/24 via 10.2.0.1"))
        assertEquals("v6 [ip], [ip] and [ip]", LogRedact.line("v6 fd7a:115c:a1e0::1, fe80::1c2b:3aff:fe4d:5e6f%wlan0 and 2001:db8:85a3:0:0:8a2e:370:7334"))
        assertEquals("the phone at [mac]", LogRedact.line("the phone at 34:7E:5C:D9:64:62"))
        assertEquals("on [host]", LogRedact.line("on rouen-a142.tail1234.ts.net"))
        assertEquals("by [email]", LogRedact.line("by someone@example.com"))
    }

    @Test fun `devices, sessions and keys`() {
        assertEquals("NET    GET /api/phone/commands?device_id=[…]&after=12&wait=25000 → ok in 25012 ms",
            LogRedact.line("NET    GET /api/phone/commands?device_id=ae527e11a6f6146ecac68298f510fa50&after=12&wait=25000 → ok in 25012 ms"))
        assertEquals("NET    GET /api/phone/audio?device_id=[…]&session=17 → ok",
            LogRedact.line("NET    GET /api/phone/audio?device_id=ae527e11a6f6146ecac68298f510fa50&session=17 → ok"))
        assertEquals("the phone […]", LogRedact.line("the phone ae527e11a6f6146ecac68298f510fa50"))
        assertEquals("device [id]", LogRedact.line("device 0f8fad5b-d9cb-469f-a165-70867728950e"))
        assertEquals("token=[…] and Bearer […]", LogRedact.line("token=abc123def and Bearer eyJhbGciOiJIUzI1NiJ9"))
        assertEquals("Cookie: […]", LogRedact.line("Cookie: rouen_session=s3cr3t"))
        assertEquals("rouen_session=[…]", LogRedact.line("rouen_session=s3cr3t"))
        assertEquals("key […]", LogRedact.line("key 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"))
        assertEquals("sign in at https://[address][path]", LogRedact.line("sign in at https://login.tailscale.com/a/abc123"))
    }

    @Test fun `what is listened to and searched for, and files and folders`() {
        assertEquals("NET    GET /api/album/extras?title=[…]&artist=[…]&day=[…] → ok in 12 ms",
            LogRedact.line("NET    GET /api/album/extras?title=Battle%20Born&artist=The%20Killers&day=1 → ok in 12 ms"))
        assertEquals("NET    GET /api/search?q=[…]", LogRedact.line("NET    GET /api/search?q=1984"))
        assertEquals("NET    GET /api/image/[…]?size=512 → ok in 40 ms 52311 B",
            LogRedact.line("NET    GET /api/image/4f1b2b0b822cd15d6c15b0f00a08ab12?size=512 → ok in 40 ms 52311 B"))
        assertEquals("FileNotFoundException: [path]: open failed: ENOENT",
            LogRedact.line("FileNotFoundException: /storage/emulated/0/Music/The Killers/Battle Born/01 Flesh and Bone.flac: open failed: ENOENT"))
        assertEquals("no album '[…]' here", LogRedact.line("no album 'Battle Born' here"))
        assertEquals("said \"[…]\"", LogRedact.line("said \"Road trip\""))
    }

    @Test fun `what the log is for is kept`() {
        same("10-29 19:30:18.578 !! NET    GET /api/phone/state → SocketException: Connection reset after 660 ms")
        same("PLAYER state BUFFERING → READY, play when ready, at 4007 ms, buffered 61230 ms")
        same("PLAYER audio: audio/flac 96000 Hz, 2 channels, encoding 22; decoder c2.android.flac.decoder")
        same("PLAYER error ERROR_CODE_DECODING_FAILED: MediaCodecAudioRenderer error, index=1, format=Format(null, null, null, audio/flac, null, -1, null, [-1, -1, -1.0, null], [2, 96000])")
        same("PLAYER error ERROR_CODE_IO_NETWORK_CONNECTION_FAILED (2001): failed to connect, ERROR_CODE_AUDIO_TRACK_INIT_FAILED")
        same("LINK   command open, session 17, play")
        same("SNAP   player: playing, session 17 at 62481 ms, buffered 128 s; memory 41 of 256 MB")
        same("APP    started: Rouen for Android 1.9.72-t11 (10907211), Android 16 (API 36)")
        same("LOGCAT 10-29 19:42:23.659  8735  8735 I RouenAway: away: the forward is up")
    }

    @Test fun `nothing personal is left in a whole log`() {
        val out = SAMPLE.lines().joinToString("\n") { LogRedact.line(it) }
        for (bad in listOf("192.168.", "100.92.", "10.2.0.2", "127.0.0.1", "ae527e11", "Killers", "Battle", "Soen", "Ane%20Brun", "tail1234", "s3cr3t"))
            assertFalse("$bad left in", out.contains(bad))
    }

    @Test fun `Rouen's side keeps its keys and its trail, its names and addresses hidden (the owner's log of 29 October had nothing else)`() {
        val json = """
            {
             "design": "dev\/design\/android-app.md §4.9, §4.10",
             "phones": [
              {
               "device_id": "ae527e11a6f6146ecac68298f510fa50",
               "name": "Owner's Pixel",
               "online": true,
               "last_seen_ms_ago": 9442,
               "player": {
                "zone": "Rouen · Owner's Pixel",
                "session": 15,
                "format": null,
                "trail": [
                 "20:49:53.038 Roon: strm stop",
                 "20:49:53.151 phone told to open session 15, playing",
                 "20:50:24.866 phone: paused in session 15 at 31392 ms — ERROR_CODE_IO_NETWORK_CONNECTION_FAILED: failed to connect to /192.168.0.57"
                ]
               }
              }
             ],
             "ips": [
              "100.92.159.80",
              "fd7a:115c:a1e0::1"
             ],
             "dns_name": "rouen.tail1234.ts.net",
             "hostname": "rouen",
             "auth_url": null,
             "state": "Running"
            }
        """.trimIndent()
        val out = json.lines().joinToString("\n") { LogRedact.jsonLine(it) }
        for (kept in listOf("\"design\": \"dev/design/android-app.md §4.9, §4.10\",", "\"device_id\": \"[…]\",", "\"name\": \"[…]\",",
                "\"online\": true,", "\"last_seen_ms_ago\": 9442,", "\"zone\": \"[…]\",", "\"session\": 15,", "\"format\": null,",
                "\"20:49:53.038 Roon: strm stop\",", "\"20:49:53.151 phone told to open session 15, playing\",",
                "\"20:50:24.866 phone: paused in session 15 at 31392 ms — ERROR_CODE_IO_NETWORK_CONNECTION_FAILED: failed to connect to /[ip]\"",
                "\"[ip]\",", "\"dns_name\": \"[…]\",", "\"hostname\": \"[…]\",", "\"auth_url\": null,", "\"state\": \"Running\""))
            assertTrue("$kept kept in:\n$out", out.contains(kept))
        for (bad in listOf("ae527e11", "Owner", "Pixel", "100.92.", "fd7a", "tail1234", "192.168."))
            assertFalse("$bad left in", out.contains(bad))
    }

    @Test fun `the phone's Tailscale engine's own lines keep what happened, without addresses, keys or the account (v1,9,72-t19)`() {
        // The engine's log comes into the saved log from v1.9.72-t19: the owner's log of 2026-10-30 00:23 had the
        // built-in Tailscale failing every 30 ms and nothing of the engine's to say why.
        val lines = listOf(
            "00:19:53 magicsock: endpoints changed: 192.168.0.23:41641 (local), 81.2.69.160:41641 (stun)",
            "00:19:53 control: NetInfo: NetInfo{varies=false hairpin= ipv6=false UDP=true derp=#16 portmap= link=\"\"}",
            "00:19:53 wgengine: Reconfig: configuring router [fd7a:115c:a1e0::1/128 100.91.94.91/32]",
            "00:19:54 netmap: self: [abc12] auth=machine-authorized u=someone@example.com [100.91.94.91/32]",
            "00:19:54 nodekey:3f2a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a now",
            "00:19:54 Received auth URL: https://login.tailscale.com/a/1a2b3c4d5e6f",
            "00:19:55 forward 127.0.0.1:34500 -> 100.91.94.91:3399: listen tcp 127.0.0.1:34500: bind: address already in use"
        )
        val out = lines.joinToString("\n") { LogRedact.line(it) }
        for (bad in listOf("192.168.", "81.2.69.160", "fd7a", "100.91.", "someone@", "3f2a9b8c", "1a2b3c4d5e6f", "127.0.0.1"))
            assertFalse("$bad left in:\n$out", out.contains(bad))
        for (kept in listOf("magicsock: endpoints changed", "configuring router", "auth=machine-authorized", "address already in use", "Received auth URL"))
            assertTrue("$kept kept in:\n$out", out.contains(kept))
    }

    private companion object {
        val SAMPLE = """
            10-29 19:42:32.190    NET    GET /api/album/extras?title=Battle%20Born&artist=The%20Killers&day=1 → ok in 12 ms
            10-29 19:43:38.819 !! NET    GET /api/lastfm/similar-albums?artist=Ane%20Brun → ok in 4246 ms
            10-29 20:14:52.077 !! NET    GET /api/phone/commands?device_id=ae527e11a6f6146ecac68298f510fa50&after=9&wait=25000 → SocketTimeoutException: failed to connect to /192.168.0.57 (port 3399) from /10.2.0.2 (port 56048) after 5000ms after 5006 ms
                                   LOGCAT 10-29 20:15:10.117  8735  8830 I RouenAway: away: using 100.92.159.80:3399
            10-29 20:21:07.234 !! NET    GET /api/lastfm/similar-albums?artist=Soen → ok in 3469 ms
            10-29 20:23:02.332 !! WAY    the forward at http://127.0.0.1:34500 missed (1 in a row)
            10-29 20:24:57.156    WAY    connected as rouen-a142.tail1234.ts.net
            10-29 20:25:00.000    NET    Cookie: rouen_session=s3cr3t
        """.trimIndent()
    }
}
