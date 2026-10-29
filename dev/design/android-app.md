# Rouen for Android — design

Status: **decided by the owner, 2026-10-29 (§1).** The probe ran five times on the owner's Core (§4.1). The owner chose
way A, the Squeezebox player inside Rouen. Next is the server's player (§4.9); §7 holds what is still open.

## 1. The owner's words (2026-10-29)

The request:

> A dedicated Android app (like the mandarin version) with local playback to the app from Roon server. The app would
> need to tell Roon to transcode to what Roon Arc uses, Opus 256kbps 24bit 48khz or lossless options. Caching like
> mandarin. Downloads of local music files only, not Qobuz or Tidal. This would need a VPN, so like Mandarin, Rouen
> would have tailscale baked in to Rouen on the server and in the app. Basically the exact android app for Mandarin
> but using the Roon server. One app for home and away.

The answers to the first version of this design, the same day:

> 1. Yes Roon to Rouen to the app. If Rouen showed as a Roon zone by using Roon bridge or Squeezelite, then play
>    history etc would work. Rouen would transcode to opus 256kbps 24/48
> 2. If the above is applied then it doesn't matter where the music is coming from. Tidal, Qobuz or local. It'll all
>    work
> 3. Yes.
> 4. Rouen, yes but use the Rouen logo
> 5. Both

Read with the questions they answer:

1. **The audio path is Roon → Rouen → the app.** Rouen shows in Roon as a zone, so Roon plays to it as to any room,
   with Roon's history, Radio and DSP. Rouen transcodes what Roon sends into Opus 256 kbps at 48 kHz for the phone.
2. **Everything Roon plays plays on the phone:** TIDAL, Qobuz, local files, radio. It all comes through Roon, so Rouen
   needs no sign-in of its own to any service.
3. **The phone is a Roon zone at home too.** It is the same zone, home and away.
4. **The app is called Rouen and uses Rouen's logo** as its icon. Otherwise it keeps Mandarin's look.
5. **Tailscale is built into both the Docker image and the Windows build.**

## 2. What Mandarin's app is (read from `meltface-80/Mandarin`, 2026-10-29)

- **It is a native app**, written in Kotlin with Jetpack Compose; every screen is native.
  - `android/app` is about 25,000 lines; `android/core` is plain Kotlin, about 8,300 lines plus 4,400 of tests.
  - It targets minSdk 26, arm64 only.
  - Playback is Media3 ExoPlayer in a `MediaLibraryService`, which gives the notification, the lock screen,
    Bluetooth and Android Auto.
  - Its own audio features: libopus decoding to float, its own USB DAC driver, DSD to a USB DAC, parametric and
    headphone EQ, and ReplayGain.
- **The phone is a zone of the server.** The server holds the queue. The app:
  - says hello (`/api/phone/hello`);
  - takes commands from a long poll (`/api/phone/commands`);
  - reports its state (`/api/phone/state`).
- **The server serves the audio** at `/stream/t<id>.<ext>`, signed (`?s=`), with a bearer token from an SRP sign-in.
  - Away, it sends Opus 256 kbps VBR, 48 kHz, in Ogg, made by ffmpeg (`-c:a libopus -b:a 256k -vbr on`, soxr
    resampling). Each track is made whole first, the next two are made ahead, and the server keeps a 4 GB cache.
  - At home, it sends the file as stored, or FLAC 24/48 when the phone can't take the original.
  - Away quality is an app setting: Opus 256 (the default) or Original.
- **Caching and downloads:**
  - The cache is a Media3 `SimpleCache` of 2–10 GB, filled 5–45 tracks ahead.
  - Downloads are per album: Original or Opus 256, Wi-Fi only, with a size limit and automatic downloads.
  - Downloads are of local files only. A TIDAL or Qobuz track is refused ("Streamed tracks can't be downloaded").
  - An offline mode answers the app's calls from its downloads.
- **Home and away:**
  - The app finds the server by probing the phone's /24. Home is Wi-Fi with the home address answering; anything else
    is away.
  - **Tailscale is built in on both ends**, as one Go program, `musicdnet` (`tailscale.com/tsnet`, userspace, no VPN
    permission needed, about 1,100 lines).
  - In the server's image, `musicdnet` joins the tailnet and serves the tailnet port to the server. In the app, it runs
    as a native process and forwards `127.0.0.1:34500` to the server's tailnet address.
  - Sign-in is Tailscale's interactive link, opened from Settings. The official Tailscale app is the fallback.
- **The app's routes already follow Rouen's:** Mandarin took its playback routes from MusicD Remote, which is Rouen
  (`/api/zones`, `/api/zone-state`, `/api/control`, `/api/play`, `/api/queue` …).

## 3. What Roon offers an app (investigated 2026-10-29)

- **The official extension API carries no audio.** It controls zones and browses; it never hands a track's audio to
  anyone.
- **Roon's private protocol has no way to make the Core transcode or stream to a phone.**
  - The catalogue of `Roon.Broker.Api.dll` (295 services, 5,050 methods) has no transcode, Opus, stream or "create an
    output" method.
  - ARC's audio protocol is not in it. The only ARC part is the `Mobile` service, which is the remote-access settings
    page.
  - So Rouen cannot ask Roon to transcode the way ARC does.
- **A device Roon plays to is a zone, with everything a zone has.** Roon plays to these kinds of device:
  - **Roon Bridge** (RAAT, Roon's own). This is a free program from Roon Labs that turns a computer's sound card into a
    Roon zone. Roon supports and tests it, and it is gapless.
  - **Squeezebox** (SlimProto, documented). The player connects to the Core on TCP 3483, and Roon streams FLAC or PCM
    to it over HTTP (Settings → Setup → Squeezebox support). Squeezelite is the common software player.
    - Roon's Knowledge Base says Roon does not support software Squeezebox players and does not test them.
    - Users report a ceiling of 24/192, and mixed results on gapless playback.
  - **AirPlay:** 16/44.1 at most, and lossy in Roon's experience. Ruled out.
  - **Chromecast:** a receiver needs Google's certification. Ruled out.
- **For a later step: `Library::GetTrackExportInfoForTracks(tracks)`** answers each track's `FilePath` and `HttpPath`.
  Read with `Root::get_LocalBaseUrl`, this suggests the Core serves original files over HTTP. Downloads may use it
  (§4.6).

## 4. The design: Rouen is a Roon zone for each phone

### 4.1 How Rouen becomes a Roon zone

The owner named both ways ("Roon bridge or Squeezelite"). Either way, Rouen never plays sound itself: it takes Roon's
stream and hands it on to the phone.

**A. A Squeezebox player inside Rouen** (tried first; the probe decides).
- **How it works.** Rouen speaks SlimProto itself, in Node, for each phone. Squeezelite is not needed: what Squeezelite
  adds is a sound card, and Rouen needs none.
- **For it:**
  - It runs the same in the Docker image and the Windows build.
  - Nothing is installed on the host.
  - A Squeezebox player asks for the next track before the current one ends: it says "decoder done" (STMd) once a
    track's data is in. So Roon may send ahead of playback, and that is what makes caching and riding out a dropped
    connection possible away from home.
- **Against it:**
  - Roon does not support software Squeezebox players (§3).
  - Its ceiling is 24/192. That is above what the phone gets anyway.
  - Gapless playback has to be proved.

**B. Roon Bridge with a loopback sound card** (if A fails the probe).
- **How it works.** Roon Bridge plays to an ALSA loopback device (`snd-aloop`). Rouen reads the other end and
  transcodes it.
- **For it:** it is Roon's own supported endpoint, and gapless.
- **Against it:**
  - **The host's kernel must load `snd-aloop`.** Not every NAS can, Docker Desktop can't, and Windows needs a virtual
    audio cable instead.
  - Roon's licence must allow shipping Roon Bridge inside Rouen's image.
  - **The audio arrives in real time only,** so nothing is ever ahead to cache: a dropped connection away from home is
    a gap.

**The probe (§6, step 1) measures A** on the owner's own Core:
- whether Roon accepts the player;
- what Roon sends: format, rate and bits;
- how far ahead of playback Roon sends;
- whether track boundaries are gapless;
- the commands for pause, seek and volume;
- how long the transcode takes.

The owner gets the result, with a recommendation, before step 2 is built.

**What the probe found** (three runs on the owner's Core, Roon 2.74 build 1716, 2026-10-29; 1.9.72-t1 and t2):
- **Roon accepts the player.** It asks its name (setd), says its version (vers 7.7.5), sets its volume (audg), and
  plays to it once it is enabled in Settings → Audio. Roon names the zone itself: "Rouen", the player's ModelName,
  not the name the player gives.
- **Roon sends FLAC 16/44.1**, encoded as it streams, so the header carries no length. It does so for local files and
  for a streaming service's album alike.
- **One stream carries two tracks, back to back:**
  - Seen twice: *What About Love* (236 s) and *Coming up Close* (280 s) made one 516 s stream; *This Is a Trick*
    (186 s) and *Telepathy* (215 s) made one of 401 s.
  - Both tracks arrive within about 8 s of the start, some 60 times faster than playback.
  - Roon holds back the stream's last few hundred bytes. It sends them and closes the stream when the first track
    ends, and then shows the second as playing, with no new command. **Within a stream, the change of track is
    gapless.**
- **Between streams there was a gap:**
  - The player said "decoder done" (STMd) as the stream closed, that is, at the first track's end. Roon did not send
    the next stream until the player ran dry (STMu).
  - It then sent the next stream within about 0.25 s.
  - A real player reads the stream at playback speed, so its STMd comes seconds before its audio runs out. 1.9.72-t3
    held STMd back until 30 s of audio was left. **Roon still waited for STMu:** it sent the next stream within about
    1 ms of STMu, and nothing before it. The gap was 0.14 s. That matches Roon users' reports of a gap between
    tracks with Squeezelite.
  - **So Rouen says STMu early** (1.9.72-t4, 10 s before the audio runs out by default), and takes Roon's next stream
    while the current one still plays. Two things are kept from the player's side:
    - Roon's stops on the way to the next stream (two arrive just after STMu) are not obeyed;
    - the next stream's STMs is sent only when its audio really starts.
    If Roon accepts that, the phone hears no gap. The cost is that Roon shows the next track as loading for the last
    seconds of the one before.
- **The 1.9.72-t4 runs (2026-10-29) settled it.** Roon uses two behaviours, and Rouen handles both without a gap.
  - **Same format: one continuous stream.**
    - Roon kept the stream open and added each next track to it the moment the one before ended: *Bitches Brew* at
      the end of *This Is a Trick*, *Thholyghst* at the end of *Telepathy*. Each arrived whole within about 4 s.
    - So the stream is gapless by itself, and always at least one whole track ahead of playback.
    - Why the earlier runs, of the same albums, closed the stream at the boundary instead is not known. Rouen does not
      need to know it.
  - **A change of format: a new stream, brought in early.** Played 16/44.1 → 24/96 → 24/192:
    - Roon started a new stream at each change.
    - Rouen said STMu with 9.9 s left. Roon sent two stops, which were not obeyed, and the new stream 48 to 134 ms
      later.
    - The new stream arrived in 7 to 14 s (93 MB at 24/192 in 13.5 s). It followed with a **gap of 0 ms**, its STMs
      at the very end of the track before.
    - The owner heard and saw no issue.
  - **The cost, to fix in the real player:** between the early STMu and the next STMs, Roon shows the next track as
    playing, and its seek bar reads from the elapsed time Rouen still reports for the old track. In those seconds the
    real player reports 0 for the new stream.
  - **Opus 256 keeps up at any rate:** 186 s at 16/44.1 took 10 s; 161 s at 24/96, 8.8 s; 213 s at 24/192, 11 s.
- **Pause, unpause, skip and volume all come through.** Volume arrives as audg gains, in fine steps. A skip's new
  stream starts within about 0.1 s.
- **Transcoding is fast enough.** 401 s of audio became Opus 256 in 22 s; 516 s took 26 s, making 17 MB.

### 4.2 The audio path

**Roon → Rouen → ffmpeg → the app.**
- **Roon to Rouen:** FLAC or PCM, on the LAN.
- **Rouen to the app, by Rouen's own ffmpeg** (`ffmpeg-static`, already in the image; checked 2026-10-29, it has
  `libopus` and `flac`). Mandarin's arguments are used:
  - **Opus 256 kbps VBR at 48 kHz in Ogg.** The default away. The phone decodes it to float, which is the "24/48" in the
    owner's words.
  - **Lossless:** FLAC as Roon sent it, or FLAC 24/48 when the phone can't take the rate. The default at home, and a
    setting for away.
- The quality settings are the app's, as Mandarin's are.

### 4.3 One zone for each phone

- **Each phone that signs in gets its own player in Rouen.**
  - Its MAC is derived from the app's device id, so Roon knows it again after a restart.
  - It is named "Rouen · <phone's name>".
- **The owner enables each new phone once in Roon** (Settings → Audio), as for any new device.
- **Roon holds the queue.** Rouen relays and reports:
  - It relays Roon's commands (play, pause, stop, seek, volume, all in SlimProto) to the phone.
  - It reports the phone's real position and state back to Roon, from the app's own reports. So Roon's seek bar, its
    history and its scrobbling follow what the phone actually plays.
- **The phone's API is smaller than Mandarin's,** because Rouen holds no queue. It has three parts:
  - hello: the phone registers its player;
  - commands: a long poll that brings Roon's commands and the stream to play;
  - state: the phone reports its position and whether it is playing, paused or buffering.
- **The app controls its own zone with Rouen's existing zone controls,** as it controls any room: queue, Radio, DSP,
  volume, transfer and grouping are all Roon's.

### 4.4 Everything Roon plays

TIDAL, Qobuz, local files and radio all reach the phone through Roon (the owner, point 2). Rouen needs no sign-in to
any service. Roon's DSP applies before Rouen, and the app's EQ after.

### 4.5 Caching

- **On the phone,** a Media3 cache works as Mandarin's: what the phone has received plays on through a dropped
  connection.
- **In Rouen,** whatever Roon sends ahead (§4.1 A) is transcoded and held for the phone. The probe found that to be
  at least one whole track beyond the one playing, within seconds of its start. At a change of format it is the next
  track, from about 10 s before the change (§4.1, the 1.9.72-t4 runs).
- **Two things Mandarin's cache does are not possible in a Roon zone:**
  - **Fetching 5–45 tracks ahead.** Roon picks the next track only when the player is ready for it.
  - **Replaying from the phone's cache.** A replay is Roon playing the track again.

### 4.6 Downloads

- **Downloads are of local files only,** as Mandarin's (the owner).
- **Rouen reads the file itself:**
  - from the `/music` mount, finding the path from Roon's own path for the track (`ContentLocation`,
    `native-remote.md` §16.5);
  - or, if a later probe proves it, from the Core by `HttpPath` (§3).
- It sends the file as Original or Opus 256, as Mandarin does.
- **Downloads play in the app's offline mode.** With no Core in reach, those plays are not Roon's and don't appear in
  Roon's history.

### 4.7 Tailscale on both ends

- **Mandarin's `musicdnet` engine is built in:**
  - in Rouen's Docker image, as a Go build stage, as in Mandarin's Dockerfile;
  - **and in the Windows build** (the owner, point 5), cross-compiled for Windows x64;
  - and in the app.
- **Rouen's settings gain an "Away from home" section,** as Mandarin's.
- **Only Rouen joins the tailnet.** Away, the phone reaches Rouen over the tailnet, and Rouen reaches the Core on the
  LAN as now; the Core itself never joins.

**As built on the server (v1.9.72-t7, the owner, 2026-10-29: "Now the integral tailscale VPN like mandarin"):**

- **The engine** is Mandarin's `android/musicdnet`, copied unchanged into `musicdnet/` at the root of the repository:
  the image's Go stage, the Windows build and the app's build all take it from there.
  - In the image it is `/usr/local/bin/musicdnet`. On Windows it is `bin/musicdnet.exe` beside Rouen: `windows.yml`
    builds it into the payload, so a Windows install's one-tap update brings it too.
  - **A container updated in place** (the one-tap update brings Rouen's files, not a new image) has no engine in an
    image older than this build. It downloads the one of its own version from that version's release:
    `release.yml`'s `engine` job attaches `musicdnet-linux-amd64.gz`, `musicdnet-linux-arm64.gz` and
    `musicdnet-SHA256SUMS`, and the download is checked against the checksums. These files are not `.tar.gz`, so the
    updater never takes one for the tarball. A test build has no release, so it needs its image.
- **The manager** is `lib/tailscale/node.js`, Mandarin's `lib/server/tsnode.js` rule for rule. It leaves out the hand-over
  to Mandarin's C# server, which Rouen does not have.
  - The engine starts with Rouen, joins as `rouen` (`TS_HOSTNAME` overrides), and serves the tailnet's port 3399 to Rouen on
    127.0.0.1.
  - `TS_AUTHKEY` signs it in without Settings. `TAILSCALE=off` leaves it out, and `TS_CONTROL_URL` names another
    control server.
  - It is on unless switched off (the stored setting `tailscaleEnabled`), as Mandarin's is.
  - The watchdog asks a node that is Running but not online to rebind, and later starts it afresh.
- **Settings → Setup → Away from home** (`public/away.js`) shows:
  - the state and the address;
  - the switch;
  - Sign in, which opens Tailscale's own page;
  - Sign out.

  Behind Rouen's login, like everything else. Its changes are refused from away (403), because away they would change how you
  are connected.
- **Away, a request reaches Rouen from the engine on 127.0.0.1**, with the caller's tailnet address in
  `X-Forwarded-For`.
  - Express believes that header from loopback only (`trust proxy: loopback`). So `req.ip` is the caller, and the login
    limiter counts each caller apart.
  - A request is away when it came from loopback with a tailnet address (100.64.0.0/10 or fd7a:115c:a1e0::/48).
  - Rouen's login is unchanged away. A Rouen set up without accounts is open to your tailnet as it is to your home
    network.
- **This phone, on the same page (v1.9.72-t10).**
  - The owner: "How do I get the app/phone on the console … Mandarin logs the server in and then I add the app/phone … I
    only have a single login here".
  - In the app, Settings → Setup → Away from home gains a second part, **This phone**: the phone's own engine's state,
    Sign in (with the same Tailscale account), Sign out, and its switch.
  - It goes through the bridge (§4.11): `tailscale()` reads the state, `tailscaleLook()` asks the engine afresh (the
    answer comes back through `window.__rouenPhoneChanged`), and `tailscaleSignIn()`, `tailscaleSignOut()` and
    `tailscaleUse(on)` act.
  - The server screen's Away from home shows the same, from the same code (`PhoneTailscale.kt`).
  - The server first, then the phone: it is Mandarin's order.
- **The phone learns the way:** `/api/phone/hello` answers `away` (whether this hello came over the tailnet) and
  `away_address` (`http://<Rouen's tailnet IPv4>:3399`, or null). The app keeps the address for when home does not
  answer.

### 4.8 The app

**Decided by the owner, 2026-10-29: Rouen's own web app inside an Android app, with native playback** ("Make Rouen's
android app a webviewer if it's easier"). It replaces the first plan, a fork of Mandarin's native screens: those call
Mandarin's routes, which differ from Rouen's in shape (the route map of 2026-10-29), and porting them all is weeks of
work before anything plays.

- **The screens are Rouen's web app**, full screen in a WebView: every screen Rouen has, on the first day. Mandarin's
  native screens can replace them one at a time later.
- **The playing is native:**
  - the phone's player (§4.9, §4.10) in a Media3 `MediaSessionService`;
  - background playback, the notification, the lock screen, Bluetooth and Android Auto's controls;
  - Opus decoded by libopus to float, as in Mandarin's app (its `cpp/` and renderer, carried over).
- **Sign-in is Rouen's own login page**, in the WebView. The player reads the same session cookie from the WebView's
  cookie store and sends it with its own requests. Rouen's login is not changed (`dev/design/login.md`).
- **Finding the server:** the address typed in, or found on the phone's /24 at port 3399. The probe asks
  `GET /api/login`, which needs no login and answers `{account, setup, loggedIn, …}`.
- **Its name and look:** named Rouen, with Rouen's logo as its icon (the owner, point 4), and its own application id,
  so it installs beside Mandarin.
- **CI builds and publishes it:**
  - Rouen's CI builds the APK and attaches it to a rolling `test-android` pre-release, as Mandarin's CI does.
  - The APK is never committed.
  - Its updates come from Rouen's releases, and a test build's from `test-android` too (§4.12).
- **The first build plays at home:**
  - The built-in Tailscale engine (§4.7) is the next build.
  - Downloads and the phone's own files come after (§4.6).
- **Away from home, in the app** (the second build; Mandarin's app's way, ported with its lessons):
  - **The engine** is `musicdnet/` at the repository's root, Mandarin's byte for byte, built by CI into the APK as
    `libmusicdnet.so` and run from the app's native library folder. Its name on the tailnet is `rouen-` and the
    phone's name, lowercased, every character other than a–z and 0–9 made `-`. It runs only while the player
    service runs, or while the server screen is open, and stops with them. At home it runs only while the phone
    plays, and stops after two idle minutes.
  - **Rouen's tailnet address** is hello's `away_address` (§4.7); the app keeps the last one given. A tailnet address
    typed on the server screen serves for a first run away; one that does not answer directly is tried through the
    engine.
  - **Rouen has no `/api/health`,** which the engine's `/probe` asks. So the app counts Rouen as reached when the
    probe answers, or when `/api/login` answers through the forwarded port.
  - **The way to Rouen**, looked at on every start and every change of network:
    1. the home address, when it answers `GET /api/login`. On Wi-Fi and home until now, three misses a second
       apart are needed before away;
    2. else Rouen's tailnet address directly, when a VPN is up and it answers there (the Tailscale app, or another
       VPN). It is never tried with no VPN up: 100.x is the carriers' own range on mobile data;
    3. else the engine: `/forward` to that address on `127.0.0.1:34500`, used as `http://127.0.0.1:34500`.
  - **On a switch:**
    - Rouen's login cookie is per origin, so `rouen_session` is carried to the new origin first, and the login is
      not asked for twice.
    - The page loads from the new origin on the same path.
    - The player's link says hello there, and the player takes the session Roon sends.
  - **The server screen gains "Away from home":**
    - a status line (Off, Needs sign-in, Connected as the phone's tailnet name, or the error);
    - "Sign in to Tailscale", which opens the engine's sign-in link in the browser;
    - "Sign out";
    - a switch that turns the engine off. Then only home or a VPN reaches Rouen.
- **The phone's settings in Rouen's own Settings** (the owner, 2026-10-29: "Also add to Rouen settings for downloads
  and streaming quality like Mandarin"). As Mandarin's `MusicdDownloads`, the page reaches them only inside the app,
  through `window.RouenPhone`. It answers only while the page in the WebView is at one of Rouen's own origins.
  - `settings()` gives `homeQuality` and `awayQuality` (`opus` or `lossless`), `network` (`home`, `away` or
    `offline`), and the download settings:
    - `downloadQuality`: `original` or `opus`;
    - `downloadLocation`: `phone` or `sd`;
    - `downloadWifiOnly`;
    - `downloadLimitGb`: 0 (none), 8, 16, 32, 64, 128 or 256;
    - `places`: phone storage, and an SD card when there is one, each with its free bytes.
  - `set(key, value)` changes one of them and answers with the new settings, or `{"error"}`.
  - The defaults are Opus at home and away (§7 point 3), and original files to the phone, on Wi-Fi only, with no limit.
  - Hello asks for `homeQuality` on the home address and `awayQuality` away. When the quality in use changes, or the
    way switches between home and away, the app says hello again. Rouen applies it from the next session Roon starts.
  - The connect screen's quality sets both. The page learns of changes the app makes itself through
    `window.__rouenPhoneChanged()`.
  - The download settings are only kept: downloads come after Tailscale is tested (§4.6).

### 4.9 The server's player (§6, server step 1)

What the probe taught, made into the player each phone gets.

- **One player for each device.**
  - The device's id is a random 128-bit id, made by the app (or the browser, §7 point 4) and kept by it.
  - The MAC is `02` followed by the first five bytes of the id's SHA-256.
  - Roon names the zone from the player's ModelName (the probe's zone was "Rouen"), so ModelName is
    "Rouen <device's name>".
  - The player connects to the Core while its device is online. When the device is offline, the player disconnects
    and its zone leaves Roon until the device is back (the owner, §7 point 2). Offline, the app still plays its
    downloads and the phone's own files, once those are built.
- **What Roon sends is decoded as it arrives** (as built, 1.9.72-t5):
  - Each Roon stream goes straight into its own ffmpeg decoder, read as fast as that takes it. A stream that arrives
    before its turn waits, its decoder held, so Roon's stream is held too.
  - What is kept on disk is the session itself, in `data/phone/<id>/s<n>.ogg` (or `.flac`): the current session and
    the two before it.
  - The probe's spool of Roon's FLAC is not needed. Roon sends far faster than playback, and the session file is
    already the phone's cache on the server.
- **One continuous stream to the device, a "session":**
  - Each Roon stream is decoded, resampled by soxr to 48 kHz float, and fed in order into one Opus encoder (256 kbps
    VBR, Ogg). That gives one Ogg stream from Roon's first stream to its next stop, gapless across Roon's streams and
    across changes of format.
  - The device fetches `/api/phone/<id>/audio?session=<n>`. Rouen serves it as fast as the device reads, so the
    device's own buffer is the cache: at least a whole track ahead (§4.5).
  - Lossless is Mandarin's option (the owner, 2026-10-29): FLAC at the source's rate, up to 24 bits. A change of rate
    starts a new session, in lossless only.
  - A stop, a flush or a seek from Roon ends the session. The next strm starts a new one, and the device is told to
    open it.
- **The device's position is Roon's.**
  - The device reports where it is in its session every second, and on every change.
  - Rouen maps that onto Roon's streams, whose lengths are measured as they arrive, and reports it to Roon:
    - STMt's elapsed is the position in the current Roon stream;
    - STMs when the device crosses into the next stream;
    - STMd and the early STMu as in the probe (30 s and 10 s before the stream's audio runs out);
    - the real STMu when the device has played everything.
  - Between the early STMu and the next STMs, elapsed is reported as 0 (the probe's one cost, §4.1).
- **Roon's commands go to the device** over the commands channel (§4.3): pause, unpause, stop. Volume (audg) is
  applied by the device as a gain.
- **The app comes first** (the owner, 2026-10-29: "Let's get a working android app for streaming first"). A browser
  player comes after it (§7 point 4).

### 4.10 The phone's API (version 1)

**Common to every route:**
- Each route needs Rouen's login, as every route does: the WebView's `rouen_session` cookie, or nothing when Rouen runs
  without accounts.
- `device_id` is 32 hex characters.
- Times are in milliseconds.

**`POST /api/phone/hello`**
- Body: `{device_id, name, quality: "opus" | "lossless"}`.
- Answer: `{device_id, zone_name: "Rouen <name>", seq, open, away, away_address}`.
  - `open` is the session the device's player is playing, given again to a device that restarted (or null).
  - `away` and `away_address` were added in v1.9.72-t7 (§4.7).
- It starts the device's player, or refreshes it.
- 400 for a bad body; 503 when Rouen has no Core.

**`POST /api/phone/state`** may carry `error`: the phone's player's own (Media3's error code and its cause, at most
200 characters), sent with every report for 5 s after it happened (v1.9.72-t10).

**The trail (v1.9.72-t10).** `/api/debug/phones` gives each player's last 80 events, each with its time:
- what Roon asked (`strm` and its command);
- each of Roon's streams, and the session and segment it went to;
- the sessions the phone was told to open;
- what Roon was told (every STM but the heartbeat's STMt, with the elapsed it carried);
- the phone's reports whenever its state or session changed, or it had an error.

A phone that plays a few seconds and moves on is diagnosed from the trail, not guessed at.

**`GET /api/phone/commands?device_id=&after=<seq>&wait=<ms, at most 25000>`**
- A long poll. Answer: `{seq, commands: [{seq, op, …}]}`.
- Ops:
  - `open {session, url, play}`: play `url` (a session) from its start;
  - `pause`;
  - `play` (unpause);
  - `stop`: stop, and drop the session;
  - `volume {gain}`: a gain from 0 to 1, from Roon's audg.
- 409 says "say hello again".
- A device that has not polled for 45 s is offline: its player disconnects, and its zone leaves Roon (§4.9).

**`POST /api/phone/state`**
- Body: `{device_id, session, position, state, buffered?}`.
  - `position` is the place in the session.
  - `state` is one of `playing`, `paused`, `buffering`, `stopped`, `ended`.
- Answer: `{ok: true}`.
- Sent every second while playing, and on every change.

**`GET /api/phone/audio?device_id=&session=<n>`**
- The session: `audio/ogg` (Opus) or `audio/flac`, sent as it is made and as fast as it is read, until the session
  ends.
- 404 for a session no longer kept.

**`POST /api/phone/control`**
- Body: `{device_id, op: "play" | "pause" | "playpause" | "next" | "previous" | "stop"}`.
- Answer: `{ok: true}`.
- The phone's own buttons (notification, lock screen, headset, Bluetooth) do not act on the phone's player. They ask
  Roon, through this route, on the device's own zone. Roon then sends the command back (§4.9), so Roon stays the one
  that holds the queue and the state.

**`GET /api/phone/now?device_id=`**
- What Roon shows for the device's zone, from the official API's zones: `{title, artist, album, image_key, length,
  seek, state}`. It feeds the notification and the lock screen.
- Covers are `/api/image/<key>?size=512`, with the cookie.

### 4.11 Streaming and download settings (v1.9.72-t9)

The owner, 2026-10-29: "Also add to Rouen settings for downloads and streaming quality like Mandarin". Mandarin keeps
these settings in the app and shows them on the server's Settings page through a bridge the page has only inside the
app (Mandarin's `DownloadsBridge.kt` and `public/app/android-downloads.js`). Rouen does the same.

- **The page:** Settings → Setup → Streaming & downloads (`public/phone-settings.js`), before Away from home, as
  Mandarin's Downloads is. Only inside the app: a browser has no bridge, so it gets neither the page nor its entry.
- **The settings are the phone's own,** kept by the app (SharedPreferences), not by Rouen. Two phones can differ.
- **Streaming to this phone:**
  - one quality at home and one away, each Opus 256 or lossless FLAC;
  - both Opus 256 by default (§7 point 3: Opus 256 is the default, lossless the option);
  - Mandarin plays the original at home and asks only for away; Rouen asks for both, because the owner made Opus the
    default everywhere.
  - The app sends the quality for the network it is on with its hello (`quality`, §4.10), and says hello again when the
    choice or the network changes. Rouen uses it from the next session Roon starts (the player's `setQuality`).
- **Downloading:** the quality (Original or Opus 256), where to save (phone storage or an SD card), a size limit, and
  Wi-Fi only, with Mandarin's defaults.
  - These are kept for the downloads of a later build (the owner: downloads after Tailscale is tested), and the page
    says so.
  - Mandarin's automatic downloads, its cache ahead and its offline mode wait for downloads and the phone's own music
    (§4.6).
- **The bridge,** `window.RouenPhone`, added by the app to its WebView. Each method answers a JSON string.
  - `settings()` answers:
    - `homeQuality`, `awayQuality`: `"opus"` or `"lossless"`;
    - `network`: `"home"`, `"away"` or `"offline"`;
    - `downloadQuality` (`"original"` or `"opus"`), `downloadLocation` (`"phone"` or `"sd"`), `downloadWifiOnly`,
      and `downloadLimitGb` (0 for no limit, else 8 to 256);
    - `places`: `[{id, label, free}]`, only those present.
  - `set(key, value)` takes both as strings, and answers the new settings, or `{error}` for a key or value it refuses.
  - After a change made in the app itself, the app calls `window.__rouenPhoneChanged()`.

### 4.12 Updates in the app (v1.9.72-t9)

The owner, 2026-10-29: "I also want app and server update checks within the android app like I have in Mandarin".

- **Rouen's own update is unchanged.** The app shows Rouen's page, so the page's update offer and Settings → Updates
  are in the app as they are in a browser: the one-tap update, checked every 7 days and once at startup (the owner's
  rule).
- **The app updates itself,** as Mandarin's does (Mandarin's `AppUpdate.kt`). It finds a newer APK, downloads it, checks
  its SHA-256, and hands it to Android's installer. The signing key is the same every time, so nothing is uninstalled.
  Android asks once to allow installs from Rouen.
- **Where it looks.** Mandarin commits its APK and a `dist/latest.json` beside it. Rouen never commits a build
  (CLAUDE.md), so the same JSON rides with the APK instead:
  - `rouen-android.json` (`{version, url, sha256}`) beside `rouen-android.apk` on each version's release, attached by
    `release.yml` when the owner merges `dev` into `main`. The app reads it from the newest release, which excludes
    pre-releases.
  - `rouen-android-test.json` beside `rouen-android-test.apk` on the `test-android` pre-release. Each build on `dev`
    replaces it.
  - A test build (a version `X.Y.Z-tN`) is offered the newer of the two. A release build is offered releases only.
    Versions compare as the server's updater compares them: `X.Y.Z-tN` comes before `X.Y.Z`.
- **versionCode comes from the version, not the run number:** `major × 10⁷ + minor × 10⁵ + patch × 10² + N` for a test
  build, and `+ 99` for a release. A release built by another workflow then still installs over the test builds
  before it, and Android never sees a downgrade.
- **When it looks:** once each time the app starts, and when Settings → Updates is opened. An offer stays until
  installed.
- **The page side:** Settings → Updates gains a row "Rouen for Android" (`public/phone-settings.js`) in the app only:
  the version installed, the newer one when there is one, Check, and Update.
  - It uses three more bridge methods (§4.11):
    - `appUpdate()` answers `{current, latest, available, busy, error}`;
    - `appUpdateCheck()` looks again;
    - `appUpdateInstall()` downloads and installs.
  - The last two answer at once. When each is done, the app calls `window.__rouenPhoneChanged()`.

### 4.13 The app's log (v1.9.72-t11)

The owner, 2026-10-29: "Build logging into the Android app like mandarin. Capture all data relevant. Make logging an
on/off item. Save logs to phone. Look at how mandarin does this. I want this to be perfect." Mandarin's is its
`AppLog.kt`, `LogRedact.kt` and `SettingsLogging.kt` (bug list items 116 and 121). Rouen's follows it rule for rule:

- **Off unless switched on.** The switch is Settings → Setup → **Logging**, in the app only, through the bridge (§4.11).
  - Off, nothing is collected at all.
  - Switching it off deletes the log.
- **What it keeps, while on.** Each line has its time and a category; an anomaly is marked `!!`.
  - **APP:** the app started, and its version, Android's, and the phone's model; logging on; a crash's trace, written at
    once (the process is going).
  - **NET:** every request to Rouen, with how long it took, its status, or its error. A long poll (`/api/phone/commands`)
    is never slow: Rouen holds it on purpose. A slow answer (2 s or more) and an error are marked.
  - **LINK:** each hello (the zone, `away`, the seq), each command Rouen sent (op, session, play), and each report whose
    state or session changed.
  - **PLAYER:** what the phone's player does:
    - its state and play-when-ready (with the reason);
    - the audio's format (codec, rate, channels, encoding) and its decoder;
    - each load's end (bytes, ms);
    - underruns, and every error with its cause chain;
    - headphones out, audio focus lost.
  - **WAY:** the way to Rouen found and lost (home, a VPN, the built-in Tailscale), the network's changes, and the
    engine's state.
  - **PAGE:** each page load and its time, a load that failed, and the page's console errors and warnings.
  - **UPDATE:** each check for the app's own update, what it found, and installs.
  - **SNAP:** every five minutes while the app is on screen or the player runs:
    - the way to Rouen and the network;
    - the player's state, place and buffer;
    - the app's memory;
    - the engine's state.
  - **LOGCAT:** the app's own lines of Android's log (its tags, Info and above), and a crash's.
- **No personal data** (Mandarin's `LogRedact`, its tests ported). Every line goes through it before it is written. It
  removes:
  - every address (IP, host, tailnet name, web address, MAC, email);
  - device ids, zone and phone names;
  - what is played or searched for (a request's values, quoted text);
  - files and folders, keys and tokens.
- **Kept on the phone:** the app's files, `applog/current.log` and `previous.log`, 3 MB each, at most 6 MB.
- **Save log:**
  - **Where:** written to the phone's Downloads, `Downloads/Rouen/rouen-log-<date-time>.txt` (MediaStore on Android 10
    and later; the public Downloads folder before, with the storage permission Android 8 and 9 need for it).
  - **Contents:** the app's log, then Rouen's side, both through `LogRedact`:
    - the phone's trail from `/api/debug/phones` (§4.10);
    - Rouen's built-in Tailscale state from `/api/tailscale`.
  - **Header:** a line asking for it to be looked through before it is sent.
- **Clear** empties it; collecting goes on.
- **The page:** Settings → Setup → **Logging**:
  - the switch, and what it does;
  - the privacy note (Mandarin's words);
  - how much is logged and since when;
  - Save log, which says where the file went or why it could not;
  - Clear.
- **The bridge:**
  - `logging()` answers `{on, about, saved, error}`;
  - `loggingUse("true"|"false")`, `loggingSave()` and `loggingClear()` act. Save answers at once, and the outcome
    comes through `window.__rouenPhoneChanged()`.

### 4.14 Now playing says what the phone hears (v1.9.72-t11)

The owner, 2026-10-29: "add to the now playing screen if the music playing is lossless or opus, just as Mandarin does.
Use the opus logo like mandarin as well". Mandarin's Now playing has a badge under the album name, its
`paintNpFormat` and `.np-format` CSS. Rouen's is the same, for a phone's zone:

- **The data.** `/api/zone-state`'s `now_playing.format` is `{kind, text}`:
  - `{kind: "opus", text: "256kbps"}` for a phone's zone playing Opus;
  - `{kind: "lossless", text: "Lossless · <bits>-bit/<rate> kHz"}` playing lossless, from the open session's depth
    and rate;
  - `null` for any other zone, or a phone with no session open.

  It comes from the phone's player (`lib/phone/devices.js` `formatFor`), matched to the zone by its name or an output's.
- **The badge.** It sits under the album name: Xiph.Org's Opus logo, Mandarin's CSS mask so it takes the badge's
  colour, beside the bit rate; or the lossless text. It shows in every client (a browser too), not only the app,
  as Mandarin's does.
- Roon's own zones get no badge yet: their signal path is Roon's to say, and a later build can read it.

## 5. Against Roon ARC, said plainly

- **Roon does not support software Squeezebox players** (way A, §4.1). A Roon update could change how Roon treats one.
  Way B is the supported fallback.
- **Plays from downloads in offline mode** are not in Roon's history (§4.6).
- **Caching is shallower than Mandarin's:** what Roon sends ahead, not 5–45 tracks (§4.5).
- **There is a second app to build, sign and keep in step with Rouen's screens,** as Mandarin's is kept in step with
  Mandarin's web page.

## 6. The order

1. **The probe, 1.9.72-t1** (Rouen and Roon only, run by hand). Rouen joins Roon as one test Squeezebox player,
   "Rouen probe":
   - The owner enables it in Roon and plays an album to it, skipping, pausing and seeking.
   - Rouen logs what Roon sends: messages, formats, how far ahead it sends, track boundaries.
   - Rouen keeps the last tracks it received, transcodes them to Opus 256, times the transcode, and offers the result
     to listen to in a browser. That is the whole path from Roon to a phone, heard before any app exists.
2. **Server, step 1:**
   - the player for each phone (§4.3, way A or B as the probe decides);
   - the stream to the app (§4.2);
   - device sign-in;
   - Tailscale in the image and the Windows build (§4.7).
3. **Server, step 2:** downloads (§4.6).
4. **The app:** Rouen's web app in a WebView with native playback (§4.8), its CI publishing to `test-android`. It is
   built beside step 2, against the phone's API (§4.10), and plays at home first; Tailscale is its next build.

## 7. Open for the owner

1. **After the probe:** way A or way B (§4.1), on the evidence. If B, two questions follow:
   - can the host running Rouen load `snd-aloop`? It is not needed for A.
   - does Roon's licence allow shipping Roon Bridge inside Rouen?

   **The evidence (§4.1, five runs) and the recommendation: way A**, the Squeezebox player inside Rouen.
   - Roon takes it.
   - It is gapless, by Roon's continuous stream and, at a change of format, by the early STMu.
   - It is always at least a track ahead, which is the cache away from home.
   - It works on any host, Docker or Windows, with nothing installed.
   Way B is kept as the fallback should a Roon update break A.

   **Decided by the owner, 2026-10-29: way A** ("Yea. A").

2. **A device that is offline** (the phone off, or out of reach of home and of Tailscale). Decided by the owner,
   2026-10-29: its zone leaves Roon until the device is back. The app still plays what it has downloaded from the
   server and the phone's own files, once those are built.
3. **Lossless across a change of rate.** Decided by the owner, 2026-10-29: "Transcoding to opus 256kbps 24/48
   (default) with same option as Mandarin as lossless". So Opus 256 at 48 kHz is the default, and lossless is
   Mandarin's option, at the source's rate (§4.9).
4. **The browser player.** Decided by the owner, 2026-10-29: the app comes first. After it, browsers play too:
   "It would be good for browser's to play music, especially iOS with a PWA". That makes Rouen's web app, installed on
   an iPhone's home screen, a Roon zone of its own, by the same player as the app's (§4.9).
   - Downloads are the Android app's only, unless a PWA can hold them too. Whether iOS keeps a PWA's audio reliably,
     and how much, is to be found out when the browser player is built.
   - The browser's format is to be settled then, by what each browser plays. iOS Safari plays FLAC, but Ogg Opus only
     in recent versions.
