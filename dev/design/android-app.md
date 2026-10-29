# Rouen for Android — design (investigation)

Status: **proposed, 2026-10-29; nothing built.** The open points in §7 go to the owner before any code that depends
on them is written (`CLAUDE.md`, "Spec authority").

## 1. The owner's words (2026-10-29)

> A dedicated Android app (like the mandarin version) with local playback to the app from Roon server. The app would
> need to tell Roon to transcode to what Roon Arc uses, Opus 256kbps 24bit 48khz or lossless options. Caching like
> mandarin. Downloads of local music files only, not Qobuz or Tidal. This would need a VPN, so like Mandarin, Rouen
> would have tailscale baked in to Rouen on the server and in the app. Basically the exact android app for Mandarin
> but using the Roon server. One app for home and away.

## 2. What Mandarin's app is (read from `meltface-80/Mandarin`, 2026-10-29)

- **A native app**, Kotlin and Jetpack Compose, every screen native (`android/app`, about 25,000 lines; `android/core`,
  plain Kotlin, about 8,300 lines and 4,400 of tests). minSdk 26, arm64 only. Media3 ExoPlayer in a
  `MediaLibraryService` (notification, lock screen, Bluetooth, Android Auto), libopus decoding to float, its own USB
  DAC driver, DSD to a USB DAC, parametric and headphone EQ, ReplayGain.
- **The phone is a zone of the server.** The server holds the queue; the app says hello (`/api/phone/hello`), takes
  commands from a long poll (`/api/phone/commands`) and reports its state (`/api/phone/state`). The phone shows in every
  remote as one more zone; away from home it is the only zone the app may play.
- **The server serves the audio**: `/stream/t<id>.<ext>`, signed (`?s=`), with a bearer token from an SRP sign-in. At
  home the file as stored (or FLAC 24/48 by ffmpeg when the phone can't take it); away, **Opus 256 kbps VBR, 48 kHz, in
  Ogg** by ffmpeg (`-c:a libopus -b:a 256k -vbr on`, soxr resampling), each track made whole first, the next two ahead,
  a 4 GB server cache. Away quality is an app setting: Opus 256 (default) or Original.
- **Caching and downloads**: a Media3 `SimpleCache` of 2–10 GB with 5–45 tracks fetched ahead; downloads per album
  (Original or Opus 256, Wi-Fi only, size limit, automatic downloads), **local files only** — a Qobuz or TIDAL track is
  refused ("Streamed tracks can't be downloaded"). An offline mode answers the app's calls from its downloads.
- **Home and away**: the server is found on the phone's /24 by probing; home is Wi-Fi with the home address answering,
  anything else is away. **Tailscale is built in on both ends** as one Go program, `musicdnet` (`tailscale.com/tsnet`,
  userspace, no VPN permission, about 1,100 lines): in the server's image it joins the tailnet and serves the tailnet
  port to the server; in the app it runs as a native process and forwards `127.0.0.1:34500` to the server's tailnet
  address. Sign-in is the interactive Tailscale link, from Settings. The official Tailscale app is the fallback.
- **Its server API is Roon's shape already**: Mandarin's playback routes follow MusicD Remote's (Rouen's) `/api`
  (`/api/zones`, `/api/zone-state`, `/api/control`, `/api/play`, `/api/queue` …), written against Roon's zone model.
  The app calls about 180 routes; what exists only for the app on Mandarin's server is about 2,000 lines of C#
  (the phone zone, Opus and downloads, the Tailscale engine's driver) and the Go engine.

## 3. What Roon gives an app (investigated 2026-10-29)

- **The official extension API: no audio.** It controls zones and browses; it never hands a track's audio to anyone.
- **Roon's private protocol (what native mode speaks): no way to make the Core transcode or stream to a phone.** The
  reverse-engineered catalogue (`Roon.Broker.Api.dll`, 295 services, 5,050 methods) has no transcode, Opus, stream or
  "create an output" method. ARC's audio protocol is not in it: the only ARC surface is the `Mobile` service — the
  remote-access settings page (port, UPnP, external address). How ARC fetches and transcodes audio is not known, and
  nothing public has reverse-engineered it; it signs in with the Roon account, through Roon's own cloud. **So "tell Roon
  to transcode like ARC" is not possible from here.**
- **One lead, untested:** `Library::GetTrackExportInfoForTracks(tracks)` answers each track's `FilePath` and an
  `HttpPath` — which suggests the Core serves the original file over HTTP (with `Root::get_LocalBaseUrl`). Original
  files only, not a transcode; whether it needs a session, and on which port, is unknown. A probe would say.
- **A phone can be a Roon zone only as a device Roon already plays to**: RAAT (Roon's own, undocumented, licensed to
  hardware makers), AirPlay, Chromecast, or Squeezebox. Roon still plays Squeezebox players (Settings → Setup →
  Squeezebox support): a player connects to the Core on TCP 3483 (SlimProto, documented, open-source players exist)
  and Roon streams FLAC or PCM to it. That makes the phone a real Roon zone — everything Roon plays, TIDAL and Qobuz
  included, with Roon's DSP and history — but in FLAC or PCM only (no Opus), live (no cache, no downloads), and away it
  needs the Core's ports reachable over the tailnet.

## 4. The proposal: the Mandarin app, with Rouen as its server

Rouen does for the phone what Mandarin's server does: **Rouen serves the audio, not Roon.**

- **The audio of local files.** Rouen reads the files itself, from the `/music` mount it already has (the label scan,
  credits and waveforms read it), each track found from Roon's own path for it (`ContentLocation` on the server's
  `TrackLite`, proven in `native-remote.md` §16.5) mapped onto `/music`; or, if the probe proves it, fetched from the
  Core by `HttpPath`. **Transcoding by Rouen's own ffmpeg** (`ffmpeg-static`, already in the image; checked
  2026-10-29: it has `libopus` and `flac`): Mandarin's arguments, Opus 256 kbps VBR 48 kHz away (decoded on the phone
  to float — "24/48"), the original or FLAC 24/48 at home, "lossless" away as an option.
- **The phone a zone of Rouen's.** Rouen holds its queue (Mandarin's hello / commands / state), and shows it among
  Roon's zones in every Rouen screen, so the remote plays to the phone as to any room. Roon doesn't see it: plays on the
  phone don't reach Roon's history or Roon Radio, and Roon's DSP doesn't apply (the app's own EQ does). Rouen keeps the
  phone's history and scrobbles it (Last.fm) itself.
- **TIDAL and Qobuz on the phone** — not through Roon (it can't): through Rouen's own sign-in to each, as Mandarin
  does and as Rouen's waveforms already do (`lib/qobuz*.js`, `lib/tidal*.js`). Streamed, never downloaded (the owner's
  rule). §7, point 2.
- **Caching and downloads exactly as Mandarin's**, downloads of local files only.
- **Tailscale built in on both ends**: Mandarin's `musicdnet` engine in Rouen's image (a Go build stage, as Mandarin's
  Dockerfile) and in the app; Settings → Away from home in Rouen, as Mandarin's. Away, the phone reaches Rouen; Rouen
  reaches the Core on the LAN as now — the Core itself never needs to be on the tailnet.
- **The app: a fork of Mandarin's**, its own name and id (Rouen, installable beside Mandarin), its own update feed (the
  Rouen release), pointed at Rouen's API. Most of the screens map onto routes Rouen already has (Mandarin took them from
  Rouen); the rest Rouen gains: sign-in for an app (a device token from Rouen's own accounts), stable track ids
  (Roon's `TrackId`, not a session's object id), `/stream`, `/api/phone/*`, `/api/download/*`, `/api/tailscale*`.

**The other way, kept for later:** the phone as a Squeezebox player of Roon's (§3) — every source Roon has, Roon's DSP
and history — as a second mode of the same app at home, if the owner wants Roon's own playback on the phone too. Not
Opus, not cached, so not the away path.

## 5. What is lost against Roon ARC, said plainly

- Plays on the phone are not Roon's: no Roon history, no Roon Radio continuing on the phone, no Roon DSP.
- TIDAL and Qobuz need Rouen's own sign-in to each service, separate from Roon's.
- A file Rouen can't read (no `/music` mount, a path that doesn't map) can't be played on the phone, unless `HttpPath`
  proves out.
- A second app to build, sign and keep in step with Rouen's screens — as Mandarin's is kept in step with its web page.

## 6. The order

1. **The probe (read only, server, run by hand):** for an album, each track's `ContentLocation` and its `/music` path
   found or not; `GetTrackExportInfoForTracks` and `get_LocalBaseUrl` read, the `HttpPath` fetched once; one track made
   into Opus 256 and FLAC 24/48 by Rouen's ffmpeg, timed.
2. **The server, step 1:** Tailscale built in (`musicdnet`, Settings → Away from home); `/stream` with Mandarin's
   transcoding and signing; device sign-in for an app; stable track ids.
3. **The server, step 2:** the phone zone (hello / commands / state) and its place among the zones on every screen;
   downloads.
4. **The app:** the fork, renamed and pointed at Rouen; built and published by Rouen's CI to a `test-android`
   pre-release, as Mandarin's is.
5. **TIDAL and Qobuz on the phone** (§7, point 2), then the Squeezebox mode if wanted (§7, point 3).

## 7. Open for the owner

1. **Rouen serves the audio, not Roon** (§4): accepted, knowing plays on the phone are not Roon's (§5)?
2. **TIDAL and Qobuz on the phone** through Rouen's own sign-in to each (streamed, not downloaded) — or local files
   only on the phone?
3. **The phone also as a Roon zone at home** (Squeezebox, §3), later — wanted?
4. **The app's name and id:** "Rouen", its own id beside Mandarin's — and the same visual design as Mandarin's app?
5. **The Windows build** gains the Tailscale engine too, or the Docker image only?
