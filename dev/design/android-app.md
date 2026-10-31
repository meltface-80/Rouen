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
    as a native process and forwards `127.0.0.1:34510` to the server's tailnet address. That port is Rouen's own:
    Mandarin's app forwards `127.0.0.1:34500`, and keeps it open (v1.9.72-t23, `Ports.kt`).
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
- **Rouen reads the file itself, from the `/music` mount** (v1.9.72-t27): the album's folder the label scan kept, as the
  album's credits find it (`lib/credits/files.js`, `album-credits.md` §2.2), its audio files in the album's order. This
  replaces the first plan, Roon's own path for each track (`ContentLocation`, `native-remote.md` §16.5): that needs
  Roon's private protocol, which is used only where `roon-native.md` allows, and the label scan's folder is already
  proven on the owner's server. An album not found in `/music` (TIDAL, Qobuz, or a folder the scan did not keep) can't be
  downloaded, and the app says so.
- It sends the file as Original or Opus 256, as Mandarin does.
- **Downloads play in the app's offline mode.** With no Core in reach, those plays are not Roon's and don't appear in
  Roon's history. With Rouen in reach they play through Roon, as any album does (§4.19).

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
    3. else the engine: `/forward` to that address on `127.0.0.1:34510`, used as `http://127.0.0.1:34510`. Until
       v1.9.72-t23 this was `34500`, Mandarin's port: with Mandarin on the phone its engine held it, Rouen's forward
       was refused (the port in use) and Rouen's requests went into Mandarin's tunnel, so Rouen couldn't be reached
       away now and then while Mandarin always could (the owner, 2026-10-30: "Tailscale connection is intermittent …
       Mandarin is near perfect all the time");
    4. with none of those, Rouen can't be reached, and the app says so, with why (§4.15). The home address is kept
       for the next look, but it is never taken for reached.
  - **On a switch:**
    - Rouen's login cookie is per origin, so `rouen_session` is carried to the new origin first, and the login is
      not asked for twice.
    - The page stays where it is: it is loaded from its own address in the app, which follows the way (§4.16,
      v1.9.72-t18). Only when that address can't be had does the page load from the new origin, on the same path.
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

**The trail (v1.9.72-t10).** `/api/debug/phones` gives each player's last 400 events, each with its time:
- what Roon asked (`strm` and its command);
- each of Roon's streams, and the session and segment it went to;
- the sessions the phone was told to open;
- what Roon was told (every STM but the heartbeat's STMt, with the elapsed it carried);
- the phone's reports whenever its state or session changed, or it had an error;
- each fetch of a session's audio by the phone, and how much it got, how long it took and why its sending ended (all
  sent, the session stopped, the phone left, the file unreadable) (v1.9.72-t17);
- with a report of buffering, how much of that session Rouen had made, and whether it was still making it, had made
  all of it or had stopped (v1.9.72-t17). That tells the network apart from Roon and ffmpeg.

It kept 80 until v1.9.72-t17: the owner's first logs were saved after the stutter and the stall they were for had
already gone from it.

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

- **The page:** Settings → Setup (`public/phone-settings.js`), before Away from home, as Mandarin's Downloads is. Only
  inside the app: a browser has no bridge, so it gets neither the page nor its entry.
  - From **v1.9.72-t47** these are **two Setup pages**, not one "Streaming & downloads" page: **Streaming** (the two
    quality rows) and **Downloads & Offline** (quality, folder, size limit, Wi-Fi only, and the On-this-phone list).
    With Away from home, that is the owner's three settings groups (the owner, 2026-10-31). The controls and the bridge
    are unchanged; only how they are grouped on the page. Caching (under Away from home) and the phone's-own-music
    folder (under Downloads & Offline) land with their own builds.
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
  - files and folders, keys and tokens. A constant's name (`ERROR_CODE_IO_NETWORK_CONNECTION_FAILED`) is kept, though
    as long as a key (v1.9.72-t14).
- **Kept on the phone:** the app's files, `applog/current.log` and `previous.log`, 3 MB each, at most 6 MB.
- **Save log:**
  - **Where:** written to the phone's Downloads, `Downloads/Rouen/rouen-log-<date-time>.txt` (MediaStore on Android 10
    and later; the public Downloads folder before, with the storage permission Android 8 and 9 need for it).
  - **Contents:** the app's log, then Rouen's side, both through `LogRedact`:
    - the phone's trail from `/api/debug/phones` (§4.10);
    - Rouen's built-in Tailscale state from `/api/tailscale`.

    Rouen's side is JSON, one value to a line, and goes through `LogRedact.jsonLine` (v1.9.72-t14): each key is kept,
    and each string's text goes through the line rules without its quotes. Keys that name a person, a phone or a
    place (`name`, `zone`, `hostname`, `dns_name`, and the like) have their value hidden whole. Through the line rules
    alone, every key and every string was taken for quoted text: the owner's first log (2026-10-29) had nothing of
    Rouen's left.
    - this phone's own Tailscale (v1.9.72-t19): its state and its own log, its last 200 lines, through the same
      redaction.
  - **Header:** a line asking for it to be looked through before it is sent.
- **The built-in Tailscale's failures say why** (v1.9.72-t19). The owner's log of 2026-10-30 had the engine failing to
  reach Rouen every 30 ms and nothing to say why. Each step now writes its answer when it fails: starting it, the state
  it stayed in, the forward to Rouen refused (with the engine's HTTP status and error), Rouen not reached in three
  tries. A failure also brings the engine's own last 30 lines and its error output into the log, once a minute at
  most.
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

### 4.14 Now playing says what the phone hears (v1.9.72-t12)

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

### 4.15 When Rouen can't be reached (v1.9.72-t13)

The owner, 2026-10-29: "tailscale fails when on mobile data. Lost connection but no toast or error message. I play
music on WiFi. Turn WiFi off. Music plays but no control using app. Force closed and stop app, open to connect to
server. Try but blank black screen … Mandarin does it correctly".

**What the code did.** When neither the home address nor a way over the tailnet answered, `Way.choose` fell back to
the home address and the app used it as if it were reached:
- the page kept asking an address the phone had left, and its controls hung with nothing said;
- the player's buttons failed silently (the failure went only to Android's log);
- on a cold start the page was loaded from that address, and the WebView sat black until the connection gave up,
  minutes later, because the "Looking for Rouen…" cover was taken away as soon as the load began.

Why nothing answered over the tailnet is not settled by the code: most likely the phone was not signed in to
Tailscale (the owner's console showed only the server), or the engine did not reach Rouen. The app's log (§4.13)
says which, and what the app says now names it too.

**What it does now** (Mandarin's "Can't reach Mandarin", its notification and widget):

- **The way says whether Rouen is reached** (`Away.Active.reach`, `Way.reach`): yes; connecting, for the engine
  until its own probe has reached Rouen (a forward set up is not enough: it is set before Rouen is asked); or no,
  when nothing answered. With no, it says why (`Way.whyNot`), the first thing to put right first:
  1. no network on the phone;
  2. the engine was tried and did not reach Rouen, or Tailscale wants the phone signed in again;
  3. Rouen's tailnet address isn't known yet (Rouen gives it once it is on a tailnet);
  4. the build has no engine;
  5. the phone's Tailscale is switched off;
  6. the phone isn't signed in.

  Each names where to put it right: the server screen ("Change server") → Away from home, which works without
  Rouen. Tailscale wanting the phone signed in again counts as not signed in until a look at it (the server screen,
  Rouen's page) finds it running; it is not retried every 20 seconds meanwhile.
- **It does not flicker** (`Way.settleReach`):
  - Rouen lost is told only when a second look in a row, 3 seconds on, finds it lost too. A Wi-Fi handing over to
    mobile data has no network for a second or two, and a slow Rouen misses one look.
  - The engine's no stands while later looks find it connecting again. Those looks come every 20 seconds from the
    player's link failing. Only the engine's probe, tried on behind it, ends it, or Retry, or a change of network.
- **The screen.**
  - With no, it says "Can't reach Rouen" and why, over the page, with Retry and Change server. Nothing is loaded
    from an address that would only hang.
  - While the engine comes up the page is not covered: its requests wait for the engine through the page's own
    address (§4.16). Only when that address can't be had does it say "Connecting to Rouen through Tailscale on this
    phone…", as it did in v1.9.72-t13.
  - Reached again, the page is uncovered as it was, or loaded afresh if it never came.
  - Every load is covered by "Connecting to Rouen…" until the page is on screen (its first paint). A page that has
    not come in 20 seconds on screen is said not to answer, "Rouen didn't answer in 20 seconds", and the way is looked
    at again. The load is not cut off: a slow tunnel's page uncovers itself when it comes. While the app is out of
    sight, nothing is timed.
  - What the way says (can't reach, and why) stands over what a load meets meanwhile. Callbacks of an earlier load,
    cut short by a switch of way, are not taken for the new one's.
  - Retry looks at the way again and always hears what came of it, even when nothing changed.
- **The notification** says "Can't reach Rouen" (or "Connecting to Rouen…") in the artist's place.
- **The phone's own buttons** (the notification, the lock screen, a headset) are not sent while Rouen can't be
  reached, or when one does not get through. A short toast says so (Android 12 cuts a toast to two lines; why is on
  the screen and in the log).
  - Pause and stop are done on the phone itself, so the music can always be stopped, as when headphones come out.
  - Roon never heard that pause. So once Rouen is reached again it is sent, and an `open` of the same session saying
    play leaves the phone paused, until Roon's own pause or play comes back.
- **The log** has the look's inputs (the engine on, signed in), what was decided, whether it was reached, and why
  not.

Not in this build: Mandarin's tie to the home Wi-Fi (its item 127, `bindProcessToNetwork` while home), which is for
a Wi-Fi still up but judged poor, not the Wi-Fi gone.

### 4.16 The page's own address (v1.9.72-t18)

The owner, 2026-10-29, after t14: with the Wi-Fi turned off the music played on, but the page was covered for two to
seven seconds and then loaded again — "Ideally this transition should be seamless like mandarin". Mandarin's screens
are native: only the connection beneath them changes. Rouen's page lived at the way's own address (home's, or the
engine's 127.0.0.1 port), so a switch of way was a new origin, and a new origin is a new page.

- **The page is loaded from `http://127.0.0.1:34600`**, a relay in the app (`Relay.kt`, `PageRelay.kt`). Each of the
  page's connections is joined, byte for byte, to the way in use at that moment: home's address, Rouen's tailnet
  address directly, or the engine's port.
  - A switch of way changes nothing the page can see. Its next requests go the new way; the ones open on the old way
    end with it, and the page asks again.
  - While the way is being connected (the engine coming up), a connection waits for it, 20 s at most, and is then
    closed. The page is not covered meanwhile.
  - A way that doesn't answer closes the connection and has the way looked at again.
- **What stays as it was:**
  - "Can't reach Rouen", and why, is still said over the page (§4.15). Every load is still covered until its first
    paint.
  - The player's link and audio still go to the way's own address. They follow a switch as before; the music already
    went on through one.
- **The login.** The page logs in at its own address now, so the player and the saved log read Rouen's login there.
  The first time, the login the phone had at home's or the tailnet's address is brought over, so it isn't asked for
  again.
  - Cookies don't count the port, so the engine's 127.0.0.1:34510 and the page's address share one login.
  - What the page keeps in the browser (the chosen zone and the like) belongs to its address, so it starts afresh once.
- **Rouen's server is unchanged.** It reads no `Host` or `Origin`, and a request still comes from the phone's address
  at home, or from the engine away, so its login limiter and its away check see what they saw before.
- **If the port can't be had** (another app holding it), the page loads from the way itself, as in v1.9.72-t13.

### 4.17 The share card in the app (v1.9.72-t22)

The owner, 2026-10-30: "Android app share card doesn't work correctly with copying the image of the share card …
Download didn't work either. Compare to Mandarins android app". None of the browser's three ways works in the app's
WebView:

- **Download** was a link to the card's `blob:` address. A WebView downloads only through a listener the app sets, and
  Android's download manager can't fetch a `blob:` address, so the tap did nothing.
- **Copy image** wrote the PNG with the browser's clipboard. A WebView refuses that ("Write permission denied") or
  leaves nothing another app can paste.
- **Share…** needs Web Share, which a WebView doesn't have, so it was never offered.

As Mandarin's page did with its app (`window.MusicDShare`, its `ShareBridge.kt`), the page hands the card's PNG to the
app. `public/app-files.js` (moved out of `app.js`) offers, when `window.RouenPhone` has them:

- **Copy image** → `RouenPhone.cardCopy(png, name)`: the PNG on Android's clipboard as a `content://` address
  (`ClipData.newUri`), which the app it is pasted into reads. "Copied!" for a moment.
- **Download** → `cardSave`: saved to the phone's **Pictures/Rouen**, where the gallery shows it. "Saved to Pictures"
  for a moment. Android 8 and 9 ask once for the storage permission, as Save log does (§4.13).

**No Share… in the app (v1.9.72-t25).** t22 also offered Share…, through Android's share sheet. The owner, once Copy
image worked: "I want share removed to leave copy and download". So the app offers those two only. In a browser Share…
is still offered wherever the browser has Web Share.

The PNG goes over as base64 with its file name. The app takes only a PNG, of 16 MB at most, and only a plain file name,
which it ends in `.png` (`CardFile.kt`). A card being copied waits in the app's cache, `shared/`, which holds
only the newest one. It leaves the app through the app's one `FileProvider` (authority `<app>.files`, which the app's
own update uses too; `res/xml/file_paths.xml`). A refusal is said under the card, in the app's words. In a browser
nothing changes.

**The page's other downloads (v1.9.72-t24).** The owner, after the card: "Yes, fix the other downloads the same way".
Three more were download links, which do nothing in the WebView: a shared playlist's **.musicd** (the share sheet's
Download), the **labels scan log** (Labels → Download scan log) and a **backup** (Backup & restore → Download). In the
app each is handed over, its bytes as base64 with its name, to `RouenPhone.fileSave(data, name)` (`app-files.js`:
`RouenFiles`), which saves it to the phone's **Downloads/Rouen**, where the app's log goes too (§4.13) and the Files app
and every file picker (a restore's "Restore from a file…" among them) find it. Each then says "Saved to Downloads/Rouen",
or the app's reason not. The app saves only those kinds (`.musicd`, `.log`, `.txt`, `.json`), as text, of 32 MB at most,
under a plain file name (`SavedFile.kt`). In a browser each stays the browser's own download.

### 4.18 The mini player, always there and docked in the app (v1.9.72-t26)

The owner, 2026-10-30: "when no zone is selected there is no mini transport bar / I want the mini transport bar to be
permanently visible on the android app as well as browsers / I want the mini transport bar for the app like Mandarin's
which is docked to the bottom bar and not translucent".

- **Always there, in a browser and in the app** (`public/mini-bar.js`), as Mandarin's is. Only Now playing hides it,
  because it has its own transport.
  - With no zone (Roon gives none), it reads "No Zone Selected" over "Tap the speaker to choose where to play". The
    speaker opens the zone list, and so does the volume button, since there is no volume to set.
  - With a zone that has nothing playing, it shows the zone's name over "Nothing playing" and "Pick an album to play
    here".
- **Docked in the app**, as Mandarin's app has it (its bug list item 102). The app's User-Agent ends
  `RouenAndroid/<version>` (§4.8), and `mini-bar.js` marks `<html>` with `rouen-app`. `touchnav.css` then puts the bar:
  - edge to edge, straight on top of the row along the foot;
  - solid in the row's colour, with a hairline along its top;
  - square, with no shadow, and the track's progress along its top.

  A browser keeps the floating pill. `test/dom/mini-bar-always.test.js`.
### 4.19 Downloads, the phone's own music, and offline (decided 2026-10-30)

The owner, 2026-10-30, while Roon Labs is asked about ARC's way in: "I want to work on downloads from Roon to the
Android app for offline use / Offline use requires the app to have the same Rouen UI. This is why Mandarin's app became
a native app / For offline use Rouen's app must have the same UI / I also want music on the phone to be playable through
the app / This is how Mandarin's app works". Answered the same day:

- **The offline screens are Rouen's own page, carried in the app** (chosen over Mandarin's native rewrite).
- **The phone's own music shows always,** at home, away and offline.
- **Offline the app shows what can play:** the downloads and the phone's own music.
- **With Rouen in reach, a downloaded album plays through Roon,** as any album does: Roon's history, Radio and queue.
  Its audio comes from Rouen, so away from home it uses data. Only offline does the phone play its own copy.
- **The phone's own music is one folder, picked** with Android's folder picker, as Mandarin's. Nothing else on the phone
  is read, and no permission is asked for.

Mandarin's WebView app went the same way before it went native: it kept a copy of its page, and answered the page's
`/api` from the phone when the server was out of reach (its `OfflineSite.kt`, `OfflineApi.kt`, `LocalMusic.kt`,
`DownloadStore.kt`, `DownloadWorker.kt`, `DownloadsBridge.kt`). Those are ported, with Rouen's routes in place of
Mandarin's.

**The page, carried in the app.**
- The APK carries a copy of `public/`, put in its assets by the build (never committed), the same build of Rouen as
  the app's own version.
- With Rouen in reach the page is Rouen's own, through the page's address (§4.16), as now.
- With no way to Rouen (§4.15), the page's address serves the copy instead, and the app answers the page's `/api`
  itself (below). When Rouen is back, the page is loaded from Rouen again, on the same screen.
- The page knows it is offline from `RouenPhone.settings().network` (`"offline"`). It then says so once ("Offline —
  playing what's on this phone"), and hides what needs Rouen: Roon's zones, the Shelf's lists from Roon, search of
  services, Settings other than the phone's own.

**Downloads (from Rouen to the phone).**
- **Rouen's side,** `lib/phone/downloads.js`:
  - `GET /api/phone/album?title=&artist=` gives the album as the download sees it: `{title, artist, image_key, tracks:
    [{n, title, disc, track, length, bytes, ext}]}` from its `/music` folder (§4.6). 404 with the reason for an album
    not in `/music`.
  - `GET /api/phone/album/file?title=&artist=&n=&quality=original|opus` gives track `n`: the file as stored (with
    `Range`, so a download resumes), or Opus 256 in Ogg, made by ffmpeg as the player's are.
  - Both need Rouen's login, as every route does.
- **The app's side** (Mandarin's, ported):
  - Each album is a folder in the app's storage, or on an SD card: `album.json` (the album, its tracks, how far the
    download has got), `cover.jpg`, and one file per track.
  - The app downloads one album at a time, on Wi-Fi only by default (`Downloader.kt`). Each track goes to a `.part`
    file first, resumes where it stopped, and takes its name only when whole. The size limit is kept. When Rouen can't
    be reached it tries again a minute later; on mobile data it waits for Wi-Fi. (v1.9.72-t28) It runs in the app's own
    process, not under Android's WorkManager, which Mandarin's uses: an album left part way goes on the next time the
    app is opened. WorkManager, which carries on with the app closed, can follow.
  - The tracks come first, then the cover (v1.9.72-t31). The tracks are Rouen's own files; the cover is Roon's,
    through Rouen's `/api/image`. A cover that doesn't come is logged and stops nothing: the album is done without it,
    and the cover is asked for again each time the app is opened.
  - The settings are §4.11's.
- **The page,** only in the app (`RouenPhone.albumDownload`, `albumState`, `albumRemove`, `albums`; the page hears
  each move through `window.__rouenDownloadsChanged()`):
  - the album view's ⋯ gains "Download to this phone", and while it downloads, how far it has got; then "Remove from
    this phone";
  - Settings → Streaming & downloads → On this phone lists them, with how much room they take, and removes them;
  - Home's "Downloaded" came with offline (step 3, v1.9.72-t29). From v1.9.72-t32 it is one of Home's rows, online and
    offline (below, "the owner's tests of t31").
  - In a browser nothing changes.

**The owner's first tests of downloads (2026-10-30)**, and what they decided:
- "I must not be able to download Tidal or Qobuz albums at all" (v1.9.72-t30):
  - the ⋯ menu asks Rouen (`GET /api/phone/album`) as it is made, and an album Rouen hasn't in `/music` gets no
    Download;
  - an album Rouen refuses that way is not kept on the phone, even as "not downloaded".
- "the remove button failed but removing the snow patrol album did remove both" (v1.9.72-t30): a removal was queued
  on the one download thread, behind whatever album was downloading. A removal now happens at once (`DownloadLine.kt`);
  only the album downloading is stopped first, and removed once it lets go of its files.
- "Unable to choose the folder on my phone where downloads are stored". Decided: Mandarin's way. Settings → Streaming
  & downloads → Choose folder picks any folder; Android asks once for All files access; albums there outlive the app,
  and a reinstall finds them again by their `album.json`. Phone storage and the SD card stay as they are.
  Built in v1.9.72-t34:
  - Settings → Streaming & downloads → Download folder: Choose… opens Android's folder picker (`FolderPicks.kt`), then,
    unless the app has it, Android's page for All files access (the storage permission on Android 8 to 10). Allow
    access asks again; Forget folder forgets it, and new albums go to phone storage. Its note says where it stands:
    none, needed (no access yet), unmapped (not a folder on the phone or a card, such as a cloud drive's), away (not
    there now) or granted (`DownloadFolder.access`).
  - The folder is kept by its address, and written as a plain path (`DownloadFolder.pathOf`: "primary:Music/Rouen" is
    the phone's Music/Rouen, "1234-5678:Music" the card's). Each album is a folder in it named by its key, as in the
    app's own storage.
  - Once granted it is one of the places to save to, chosen as it is picked. Albums are read from every place
    (`DownloadFolder.order`), so changing where new ones go hides none, and albums already on the phone stay where
    they are.
- "Downloading Snow Patrol's final straw album failed" (v1.9.72-t30). The log shows the cause: the app went to the
  background, its player service (until then its only foreground service) stopped, and five seconds later Android
  cut the app's network ("Software caused connection abort"); every retry failed to connect until the app was opened
  again. Downloads now hold a foreground service of their own while there is anything to download (`DownloadService`,
  type dataSync, its notification saying the album and how far it has got), as Mandarin's do under WorkManager.
- "Downloads not fixed or working correctly" (after t30, v1.9.72-t31). The log shows every download asking for the
  album's cover first. Roon wasn't answering Rouen, so `/api/image` hung, and the cover's 30-second timeout failed the
  whole album before any track, on every retry. The cover now comes after the tracks, and a missing one fails nothing.
- Opus downloads are slow. The path is the phone ← Rouen ← ffmpeg ← the file in `/music`, not Roon: Rouen makes each
  track as it sends it, at the resampler's highest precision, so a download is as fast as the server converts.
  Decided: convert ahead. While one track is sent, Rouen makes the next ones, so the phone rarely waits. The sound is
  the same.

**The phone's own music** (Mandarin's `LocalMusic`, ported).
- One folder, picked in Settings → Streaming & downloads, read for its tags and covers into a small index, read again
  when the app returns to the front and when Android reports a change in it.
- Home gains "On this phone"; each album opens in Rouen's album view.
- **It plays on the phone itself, outside Roon:** Roon can't see these files. The zone list gains "This phone", and the
  mini player and Now playing drive the phone's own player when it is chosen. These plays are not in Roon's history.

**Offline, how it is built (v1.9.72-t29).** In place of an `OfflineApi` in the app, the page answers its own `/api`:
- The APK carries `public/` as it is when the app is built (a Gradle task copies it into the assets as `page/`; never
  committed). So the offline copy is the page of the app's own build: a change to the page comes to it with the next
  app.
- With the way saying Rouen can't be reached and the page's own address open, the page's address answers from that
  copy (`OfflineSite.kt`, through the relay's local hand-off), with `public/offline.js` first in `<head>`. The online
  page never loads that script.
- `offline.js` answers the page's `/api` from the bridge (`RouenPhone.albums()`, `album(title, artist)`): it runs before
  any of the page's scripts, which keep their own reference to `fetch` (`login.js`). Being the page's own code, it is
  tested in the page's own harness.
- The app serves only the files, and `/api/image/dl:<key>`, a downloaded album's cover, since an `<img>` doesn't go
  through `fetch`. Everything else under `/api/` is a 503.
- When Rouen answers again (not merely being connected), Rouen's own page is loaded again, at Home.
- Built in two steps:
  - v1.9.72-t29: the page, Home's "Downloaded" (the albums wholly on the phone, each opening in Rouen's album view) and
    the Library as those albums;
  - v1.9.72-t31: playing them. offline.js gives one zone, "This phone"; Play Now on an album or a track, the mini
    player and Now playing go to the bridge's `localPlay`, `localState`, `localControl` and `localSeek`. Those drive the
    phone's own player (PlayerService's ExoPlayer, which now reads `file://` as well as Rouen's sessions) with the
    downloaded files. Its notification and lock screen are the player's own: `RoonPlayer` passes them through in its
    local mode, rather than asking Roon. Roon opening a session on the phone again ends the local play.

**The owner's tests of t31 (2026-10-30)**, and what was decided with them (v1.9.72-t32):
- "Online and offline modes should work in harmony". Decided:
  - **Going back online doesn't stop a download playing.** The log showed why it did: each time the phone reaches
    Rouen, Rouen's hello sends it a volume and a stop, and the player obeyed the stop. While the phone plays its own
    files, Roon's stop, pause, play and volume no longer reach the player (`LocalQueue.roonMay`). Only Roon opening a
    session on the phone now takes the player back. A session that Rouen's hello replays (Roon was playing to the phone
    before it went offline) does not: Roon is asked to stop it, so its zone doesn't stand playing what isn't heard. The phone's own play is at full gain, so the phone's volume keys are
    its volume; Roon's volume for the phone's zone is kept and given back when Roon takes the player.
  - **Online, Rouen's page shows and drives it**, exactly as offline, as "This phone", until something is played
    through Roon (`public/phone-local.js`). In the app the phone is one zone, "This phone": the phone's own play while
    there is one, and otherwise the phone's zone in Roon ("Rouen <name>", which the app learns from Rouen's hello and keeps, so the page knows it
    before this start's hello). The
    page's requests for it go to Roon's zone, and their answers come back as This phone. So a Play Now on This phone
    goes through Roon, which ends the phone's own play.
  - **Online, a downloaded album plays through Roon**, as any library album. The phone's files play only offline, or
    while a play that began offline goes on.
- "Albums downloaded have no track times": offline, `/api/album/track-times` gives the download's lengths.
- "Albums downloaded have no add to queue buttons", "Playing a downloaded album offline shows no queue on the queue
  screen". Decided: the phone's own queue (`LocalPlay`, from `PlayerService`). Queue and Play Next, on an album or a
  track, add to it from any downloaded album (`RouenPhone.localAdd`); the Queue screen lists it from the track playing
  (`localQueue`), and a tap plays from there (`localJump`). With nothing of the phone's own playing, they play.
- "I want a downloads carousel to be present when there are downloaded albums regardless of being offline. This
  downloads carousel will be added to the home screen settings page and moveable like the others". Decided:
  - "downloads" is one of Home's rows (`lib/routes/home-rows.js`), "Downloaded", first by default. A layout stored
    before it gets it first, switched on. It is moved and switched off like the others.
  - It is the app's only (`public/home-downloads.js`): a browser has no downloads, so there it is neither on Home nor
    in Settings → Home Screen. With nothing on the phone it hides itself.
  - Offline, Home shows it alone, under the offline note. A tile opens the album: online Rouen's own album view (by its
    title and artist, as a tile whose offset has moved is found), offline the download's. Covers are the download's
    own offline and Roon's online.

**Offline, what the page's `/api` answers** (Mandarin's `OfflineApi`, with Rouen's routes):
- `/api/zones` gives "This phone" alone; `/api/zone-state`, `/api/control`, `/api/play` and the queue drive the phone's
  player (`public/phone-local.js` from v1.9.72-t32, shared with the online page).
- Home gives "Downloaded" and "On this phone"; the Library gives those albums, A to Z; an album's page is its
  `album.json`.
- `/api/image/<key>` gives the album's `cover.jpg`.
- Every other route answers as empty, so a screen shows nothing rather than an error.
- What the screens ask for at the start (the settings, the theme) is kept from the last time Rouen answered, as
  Mandarin's `OfflineSite` keeps it.

**The order,** each its own build, tested before the next:
1. **v1.9.72-t27, Rouen's side of downloads:** the two routes, with their tests.
2. **v1.9.72-t28, the app downloads:** the store, the downloader, the bridge, Download in the album view's ⋯, the list
   in Settings. Online only: a downloaded album plays through Roon.
3. **Offline:** the page carried in the app, its `/api` answered from the downloads, and Home's "Downloaded" (v1.9.72-t29);
   then playing them on the phone, offline.
4. **The phone's own music:** the folder, "On this phone", "This phone" as a zone, online and offline.

### 4.20 Split head: direct playback away from home (owner, 2026-10-31)

The owner, 2026-10-31: away from home the app should not take Roon's zone audio over the link. Instead Rouen "becomes a
mini Mandarin": it serves the audio to the app, which plays it itself, as Mandarin's app does. At home nothing changes
— the phone is a Roon zone as in the rest of this section. The app's reading of whether it is on the server's LAN is
the switch between the two heads.

**The switch — on the LAN or not.** The app is "home" when it is on the **same subnet** as the Roon server, "away"
otherwise. Today away is decided by whether the home address answers (`Way`/`Away`); this adds a subnet test (the
phone's own IPv4 address and prefix against the server's home address), so a phone on a different LAN is away at once,
without waiting for a probe to time out. Home → the Roon zone, as now. Away → the direct head below.

**Play counts: the silent zone.** Away, Roon still plays the chosen album to Rouen's Squeezebox zone, exactly as now —
so Roon's history, play counts, queue and "what's next" stay true — but Rouen **discards that zone's audio** instead of
sending it to the phone. The app's transport drives both: a skip or a new album on the phone is mirrored to the zone,
so Roon follows. Roon counts a play at its own real-time pace on the silent zone, as it always has; the phone's own
playback (which may be cached ahead) does not change that. Nothing is written to Roon's library by Rouen: the count is
Roon's own, from its own playback. (This keeps the owner's "Roon still knows what's been played" true, which direct
playback alone would not — a direct play Roon never sees, it never counts.)

**Local files, away — Mandarin's method.** For a track whose album is a local file on the server (Rouen already knows
this per track, from the `/music` label scan and the library record's source), Rouen serves the file to the app from
the `/music :ro` mount, as the downloads already do (§4.6, `/api/phone/album/file`): the file as it is (lossless), or
Opus 256 transcoded by ffmpeg as the player's are. Only local files are served this way; this is a copy of Mandarin's
local-file serving. The app plays it with a Media3 cache (cache-ahead and riding out a weak link, §4.5, which the zone
path cannot do).

**The owner's away test of B1 (2026-10-31), and the fixes (v1.9.72-t38).** B1 played local albums direct away, and the
owner found three things to put right: away the whole zone list still showed (the Sonos and the rest), and Now playing
had no cover and no quality. Decided and done: **away (off the server's subnet) the app shows This phone only**, as
Mandarin does (the home zones can't be heard away); **Now playing and the Queue carry the album's cover** (its Roon
image key travels with the play, `/api/play`'s body); and **Now playing shows the quality** (Opus 256, or lossless
with the rate). The owner also asked, for later: the audio zones shown as Mandarin's are; the DSP in each zone's
settings — the phone's AutoEQ/PEQ for This phone (step 3), and Roon's own DSP for a Roon zone (`dev/design` §14, the
zone-settings work) — tracked there, not in this fix.

**The owner's second away test (2026-10-31), and the fixes (v1.9.72-t40).** Two more things to put right. (1) A streamed library album "showed no times but then did when I paused it": its Opus track is made by ffmpeg as it is sent, so the player has no length to measure until it is buffered, and Now playing sat at 0:00/0:00. Fixed — **the track's metadata length (from `/api/phone/album`) is shown until the player measures its own** (`LocalQueue.shownLength`, used by `LocalPlay.state`), as the Queue already did. (2) "Some local albums come up with this error": away, an album `playLibrary` can't serve (not one of the server's own `/music` files) fell through to the misleading "This phone isn't one of Roon's zones right now" — but away there is no Roon zone for the phone to be. Fixed — **away that message never shows**; the refusal says plainly that This phone plays your own library files and Rouen couldn't find this album's among them. Whether a *specific* album the owner believes is local misses the `/music` match (the `wfAlbumKey` title‖artist bridge) is a separate question, open with the owner: if it is a genuine match miss rather than a streaming-service album, the fix is in the matcher (or, for true Mandarin parity, resolving a library album to its file by Roon's own path — a research item, not this fix).

**The Wi-Fi drop — the relay stops, no handoff (owner, 2026-10-31; the handoff dropped, v1.9.72-t51).** Playing to the
home Squeezebox zone ("the Squeezelite") and leaving the house, the music used to go on over mobile data: the app only
re-pointed its link to the tailnet (`PlayerService.onWay → relink`) and kept relaying Roon's zone. Away from home the
phone now plays its own (This phone), **never the Roon relay** — `PlayerService` discards the zone's audio, stopping
any session Roon opens away rather than streaming it over mobile data. The t48 handoff — capturing a part-played album
and loading it into This phone, paused at the spot — is **dropped** (owner, 2026-10-31): away is a fresh context, not a
continuation; the music stops on the drop and you open This phone and play. The two-headed shape the owner chose is
**by subnet**: on the server's LAN Rouen is the Roon remote it has always been; off it, Rouen is a standalone player
(local files, then TIDAL/Qobuz as its own client — Mandarin's away experience), This phone its own zone, shown away
(the next build makes "This phone" away-only). "This phone" and the Squeezebox zone are **two separate zones**: the
phone's own direct play, with the phone's AutoEQ/PEQ, and the Roon zone named in Roon with Roon's DSP.

**The away counts — proven (owner, 2026-10-31; the counts probe, v1.9.72-t50).** The owner set the live silent-zone
mirror aside — playing every away track a second time (with the waveform, a third) to a muted Roon zone is too much
streaming — for a **catch-up when the phone is home**, which turned on one unknown: does Roon count a play off the
elapsed the player reports, or off its own clock? The Squeezebox probe (§4.1) answered it on the owner's Core: at
`speed=80`, `99` and `120` the play count went up by **exactly one per track** (the owner, 2026-10-31). So **Roon
counts off the reported elapsed, not its own clock**, and no over-count at any speed. A day of away listening can be
caught up to Roon in minutes when home — the ceiling is the download rate (~40×, Roon streams the album as one FLAC
with no length header, so the probe can't end a stream before it has downloaded it), not the speed setting. The plan
holds: when the phone is home again, Rouen fast-replays the away-played tracks to the phone's zone, and Roon counts
each. **Catch-up is opt-in** (Settings → Setup, the owner, 2026-10-31); off, away plays reach the services (TIDAL,
Qobuz, Last.fm) but not Roon's own count. This unblocks the away rework — the two-headed Rouen and the Mandarin port.

**App leads, Roon follows for the count (owner, 2026-10-31: "B").** Two ways were put to the owner to reconcile the
Roon zone (a continuous, Roon-paced, multi-track stream that already counts) with per-track direct files: **A**, the
zone leads and the app's direct audio follows it (simple, reliable counts, but Roon still paces it — no deep
cache-ahead); **B**, the app leads on its own timeline (full cache-ahead, instant skip and seek) and Rouen mirrors each
of the app's moves to the Roon zone so Roon follows and counts. The owner chose **B**, the true mini-Mandarin away.

- The app plays the local library album on its own player, streamed from Rouen (`/api/phone/album/file`), as a queue
  with cache-ahead — the same player that plays downloads offline (`LocalPlay`), its media items HTTP rather than
  `file://`.
- Rouen keeps the phone's Squeezebox zone, and **mirrors the app's playback onto it through Roon**: when the app starts
  an album (or skips, or picks another), Rouen has Roon play that album on the zone from the same track; the zone's
  audio is produced but the app never fetches it. So Roon's history and play counts are Roon's own, from its own
  real-time playback, while the phone hears the direct files. A skip past Roon's count threshold counts as it always
  would; the app leading does not change that.
- Built in two steps, each tested on the owner's device from `test-android`:
  - **B1:** the app plays an away local album direct (its own player, cache-ahead), audibly. No zone mirror yet — the
    play is not yet counted by Roon.
  - **B2:** Rouen mirrors the app's album, skips and track changes onto the Roon zone, so the play is counted.

**AutoEQ and PEQ, on the phone.** The app gains headphone AutoEQ and a parametric EQ, applied in its own player, for
the one phone the app is installed on (kept on the device, as Mandarin's phone-side DSP). It applies to the direct head
only; when the phone is a Roon zone, Roon does the DSP.

- **The DSP core (`Dsp.kt`, v1.9.72-t39), Mandarin's model ported.** The setting Rouen keeps for this phone — a
  headphone AutoEQ profile (its name, preamp and bands) and a manual parametric EQ — as the `dsp` of a hello or a
  command (JSON); its bands (peak, low/high shelf, low/high pass) as cookbook biquads; the combined response and the
  headroom (the preamp, half a dB under the peak, or the profile's own, or by hand); and a `Chain` that runs the audio
  through them (a section per band per channel, direct form I). The same maths as Mandarin's `Dsp.kt`, so a page's
  curve and the phone's sound agree. Pure, JVM-tested (`DspTest`, ported). (It replaces the narrower `Peq.kt` of t37.)
- **Applying it (next slice):** the `Chain` in an ExoPlayer `AudioProcessor` on the phone's own player ([LocalPlay]),
  bypassed when the setting is off or flat.
- **Where the bands come from — Mandarin's way (server-side).** Rouen keeps the per-phone DSP setting and sends it to
  the app; the app only runs it. A manual PEQ is set on the page. For "AutoEQ" proper — picking a headphone and getting
  its correction — the AutoEq profiles are the server's concern: Rouen fetches them from the AutoEq project on demand
  (the owner's lean, 2026-10-31), keeping a copy, and parses the `ParametricEQ.txt` into the setting's bands; an import
  of a `ParametricEQ.txt` is the same path. The DSP row in Play On → Zone Settings opens this for This phone (for a
  Roon zone it opens Roon's own DSP, `dev/design/native-remote.md` §15, already built).

**TIDAL and Qobuz, away — the probe (2026-10-31), and what is still open.** The owner asked whether Roon can hand Rouen
the service's own stream URL to play directly, no extra login, with the silent zone keeping the count. A read-only
decompile of the owner's Roon Server (the DLLs already read for `roon-arc.md`) found:

- Roon fetches a per-track stream URL from each service with the owner's **Roon-side** service session:
  - **Qobuz** (`Roon.Qobuz.Proxy.GetFileUrl` → `track/getFileUrl`): a **plain, unencrypted, time-limited CDN URL**
    (`StreamUrl.Url`, with mime, sample rate and bit depth; no key). Roon logs it at debug level
    ("result from getfileurl: …") — this is the "URL in the logs" the owner has seen. An app given that URL could
    play it directly for the URL's lifetime.
  - **TIDAL** (`Roon.Tidal.Proxy.GetStreamUrl` → `tracks/{id}/streamurl`): a URL plus an optional **`encryptionString`**
    — when present, the stream is encrypted and the app would have to decrypt it with that key; newer TIDAL
    (`playbackinfopostpaywall`) returns a manifest instead. So TIDAL is not reliably a plain, directly-playable URL.
- **The catch:** that URL is produced and consumed **inside the Core's own playback pipeline**
  (`Broker.Transport.*.GetPlaybackInfo` → `AudioPlaybackInfo`). It is **not** carried over the reverse-engineered LAN
  protocol (`Roon.Broker.Api`) to any client — the only URL a client sees there is the auxiliary-file URL (art and the
  like), not the stream. So there is **no existing "give me the stream URL" call** for Rouen to make on the LAN.

  Getting the URL anyway would mean one of:
  1. **Scraping Roon Server's live debug log** for the `getfileurl` line as each track starts — fragile (timing,
     format, debug logging must be on), and Qobuz only;
  2. **Calling Qobuz/TIDAL directly with Roon's stored service token**, read from Roon's own data — which is using
     Roon's credentials, the account/credential territory the ARC note already flags, and the folder the owner said is
     never copied.

  Neither is the clean "Roon tells Rouen the URL" the owner pictured; the protocol offers no such hand-off. TIDAL
  also needs decryption for some content.

**So, decided and open:**
- **Local files, away: direct serve + silent zone + phone AutoEQ/PEQ** — clean, no new login, no ARC, Roon keeps the
  count. This is the build this section specifies; it is the first step.
- **TIDAL/Qobuz, away: Rouen becomes its own streaming client, Mandarin's way** (owner, 2026-10-31: "these would
  need to have the same login and playback function as Mandarin"). Not from Roon at all — getting the URL from Roon
  is reachable only by log-scraping (Qobuz) or by using Roon's own service token (both), and TIDAL is often DASH or
  encrypted, so there is no clean hand-off. Instead Rouen ports Mandarin's own service clients
  (`Mandarin.Server/Services/QobuzApi.cs`, `TidalApi.cs`, `ServiceStreams.cs`):
  - **Rouen's own sign-in**, separate from Roon's: Qobuz by username and password (`user/login` → a user auth token);
    TIDAL by OAuth device code (sign in on tidal.com, Rouen keeps and refreshes the tokens). The owner signs in once,
    in Rouen's settings.
  - **Rouen fetches the audio itself** with that session (Qobuz signed `track/getFileUrl`; TIDAL `playbackinfo` — one
    address, or MPEG-DASH reassembled through ffmpeg) and **serves plain audio to the app**, exactly as it serves
    local files and downloads. The app never needs the service's raw URL, which is what makes TIDAL's DASH/encryption
    a non-issue — the server does that work, as Mandarin's does.
  - This is the "additional login" set aside earlier, now chosen; it is **not** ARC (no Roon cloud, no sealing), it is
    Rouen standing in as a Qobuz/TIDAL app with the owner's own accounts.
  - It is a large feature — a whole TIDAL+Qobuz client (auth, token refresh, stream resolve, DASH reassembly,
    transcode, play reporting) — and its own run of builds, after the local-files head.
- **Play counts for TIDAL/Qobuz — the open question.** Rouen reports plays to the service itself, as Mandarin does
  (Qobuz start/end events, TIDAL likewise), so the owner's **TIDAL/Qobuz account** history stays right. But **Roon**
  is bypassed, so Roon's own counts need the silent zone — and for a streaming track that means Roon *also* streams
  it, through Roon's own service session: a second fetch, from a second account, kept in step. The owner wants Roon's
  count too (2026-10-31: "work out how to get the play counts working so Roon plays to the silent zone"), by the same
  mirror as B2 below: the app plays the service track from Rouen, and Rouen has Roon play that same track on the zone,
  so Roon counts. The service's own play report (as Mandarin does) keeps the TIDAL/Qobuz account's history besides.

**The order (local files first):**
1. The subnet switch (app): home vs away by the server's subnet, with its test. **Done, v1.9.72-t35.**
2. Away, local files, the owner's **B** (app leads, Roon follows for the count):
   - **B1:** the app plays an away local album direct (its own player, cache-ahead, streamed from Rouen), audibly; no
     zone mirror yet.
   - **B2:** Rouen mirrors the app's album, skips and track changes onto the Roon zone, so Roon counts the play.
3. Phone-side AutoEQ + PEQ, applied to the direct head.
4. TIDAL/Qobuz as Rouen's own client (Mandarin's `QobuzApi`/`TidalApi`/`ServiceStreams` ported): sign-in, resolve,
   serve to the app, report plays. Its own run of builds. Roon's count for these is by the same zone mirror as B2.

### 4.21 The home head: the Squeezebox player moves into the app (owner, 2026-10-31)

**The owner's report and decision, 2026-10-31.** On Wi-Fi (the same subnet as the Core) the phone stopped showing as a
Roon zone, and the server-side Squeezebox player (§4.9) had always been hit-and-miss about appearing. The owner asked
whether the **app itself** could be the Squeezebox player, rather than Rouen's server emulating one. It can, and that is
the home head from here.

- **Why, not Roon Bridge.** Roon Bridge/RAAT is a certified-endpoint path (shipping an implementation is the Roon T&C
  problem the owner named), and there is no Roon Bridge for a stock Android phone anyway. Squeezebox, by contrast, is
  Roon's **own** supported endpoint type — it is exactly what the server-side player uses today — so moving it into the
  app changes where the player runs, not whether Roon supports it.
- **How.** The app opens the SlimProto connection to the Core directly (port 3483), does the same HELO/STAT/strm
  handshake the server does (`lib/squeeze/slimproto.js`, ported to Kotlin as `Slim`), registers as a Squeezebox named
  "Rouen <phone>", takes Roon's FLAC stream over HTTP and plays it on the app's own player (ExoPlayer, which already
  decodes FLAC and plays gapless). Roon's play/pause/stop/seek/volume drive that player; the app reports its real
  position back as STAT, so Roon's seek bar, history and scrobble follow what the phone actually plays. **No Rouen
  server in the home audio path** — the phone *is* the zone, holding its own connection with reconnect and keepalive,
  which is what makes it reliable where the emulated zone was not.
- **Licensing.** The SlimProto client is re-implemented in Kotlin from Rouen's own JS (which we own), **not** by
  embedding GPL `squeezelite`, so the app's licensing stays clean.
- **Addressing.** The app needs the Core's SlimProto host. Rouen already knows it (it is the Roon extension) and hands
  it to the app, so no fragile UDP broadcast discovery is needed on the phone's Wi-Fi.
- **Home only; away is unchanged.** Over Tailscale the phone reaches the *server*, not the Core's 3483, so away keeps
  the split head of §4.20: the app plays direct, and the **server-side** player (§4.9) stays for Roon's play counts (the
  B2 mirror). So both players exist: the app's for the home zone, the server's for the away count. The server-side
  player is retired from the *home* path once the app's is proven.

**The slices.** 1 (**v1.9.72-t41**) the SlimProto bytes layer ported to Kotlin (`Slim`), pure and JVM-tested
(`SlimTest`) — no socket yet. 2a (**v1.9.72-t42**) the handoff of the Core's SlimProto host to the app: the `hello`
response carries `core_host` (the same host Rouen's server-side player uses) and `slim_port` (3483), so the app has
where to connect with no UDP discovery; it uses them only on the server's subnet. 2b (**v1.9.72-t43**) the socket
client's engine (`SlimClient`): the SlimProto control connection — HELO, the STAT heartbeat, reconnect, and Roon's
`strm`/`audg` mapped onto a player interface (`Out`) — a faithful port of `lib/phone/player.js`, free of Android, with
its pure pieces JVM-tested (`SlimClientTest`): the **MAC byte-matches the server's** so Roon knows the phone as one
player however it connects, and a `strm` becomes the Core's stream URL. No socket wiring into the service yet. 2c the
wiring: start `SlimClient` at home and stop it away/offline, with its `Out` driving ExoPlayer on the Core's FLAC, and
the **server yielding the home zone** (the phone's `hello` says `slim`, and Rouen runs its server-side player only when
that device is away — so the two never both hold the one MAC). That is when the phone appears, and plays, in Roon on
Wi-Fi (owner tests on device). 4 gapless across streams (the early-STMu handshake the probe settled, §4.1). 5 retire the
server-side home zone, leaving it for the away count only.

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
