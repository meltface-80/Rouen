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

### 4.8 The app

- **The app is a fork of Mandarin's.**
  - It is named Rouen and uses Rouen's logo as its icon (the owner, point 4). Otherwise it keeps Mandarin's look.
  - It has its own application id, so it installs beside Mandarin.
  - It takes its updates from Rouen's releases.
- **It points at Rouen's API.** Most screens map onto routes Rouen already has. Rouen gains:
  - device sign-in for an app: a token from Rouen's own accounts;
  - the phone's player (hello, commands, state) and its stream;
  - `/api/download/*`;
  - `/api/tailscale*`.
- **CI builds and publishes it** to a `test-android` pre-release, as Mandarin's CI does.

### 4.9 The server's player (§6, server step 1)

What the probe taught, made into the player each phone gets.

- **One player for each device.**
  - The device's id is a random 128-bit id, made by the app (or the browser, §7 point 4) and kept by it.
  - The MAC is `02` followed by the first five bytes of the id's SHA-256.
  - Roon names the zone from the player's ModelName (the probe's zone was "Rouen"), so ModelName is
    "Rouen <device's name>".
  - The player connects to the Core while its device is online. §7 point 2 asks what happens when it isn't.
- **What Roon sends is kept whole.** Each Roon stream is read as fast as Roon sends it into the device's spool
  (`data/phone/<id>/`), as the probe did. The spool keeps the current stream and the next, and nothing older.
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
- **The app comes first** (the owner, 2026-10-29: "Let's get a working android app for streaming first"). There is no
  browser player: the first listener is the app.

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
4. **The app:** the fork, renamed and pointed at Rouen (§4.8), with CI publishing to `test-android`.

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

2. **A device that is offline** (the phone off, or out of reach of home and of Tailscale): should its zone leave Roon
   until the device is back (the player disconnects; Roon keeps it enabled and shows it again when it reconnects), or
   stay in Roon, playing into nothing?
3. **Lossless across a change of rate.** Decided by the owner, 2026-10-29: "Transcoding to opus 256kbps 24/48
   (default) with same option as Mandarin as lossless". So Opus 256 at 48 kHz is the default, and lossless is
   Mandarin's option, at the source's rate (§4.9).
4. **The browser player.** Decided by the owner, 2026-10-29: the app comes first, with no browser player.
