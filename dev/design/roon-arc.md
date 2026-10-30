# How Roon ARC plays — the read-only probe (2026-10-30)

The owner, 2026-10-29: "Does the reverse engineered code show us how Arc works with Roon server for playback", then
"probe to understand and if it can be used for our benefit. But I feel this is needing account login within Rouen for
Roon". This is what was found, and what using it would take. **Nothing was built and nothing was connected.**

## 1. Where it was read

- **The source.** The owner's own Roon Server: Roon's official Docker image (`ghcr.io/roonlabs/roonserver`), its
  program folder `RoonServer/Appliance`. Only Roon's own DLLs were taken (75 files, 20 MB), not the database or any
  account data. They were decompiled with ILSpy into the session's scratch space, and are not kept in the repository.
- **What was read.** ARC's server side is the `Roon.Broker.Mobile` namespace in `Roon.Broker.Core.dll`. Its client for
  Roon's cloud is `Roon.ServiceProxy.RoonMobileService.dll`.
- **What was not read.** The ARC app itself, Android or iOS.
- **What the earlier catalogue held.** It covered `Roon.Broker.Api.dll` only, the protocol of Roon's desktop app on
  port 9332 (`roon-native.md`). Its `Mobile` service is ARC's settings page (`SetCurrentPort`,
  `VerifyPortForward`), not ARC.

## 2. What ARC is, on the server

- **An HTTP API**, `https://<address>:<port>/mobile/1/api`. It runs on the port ARC's settings open on the router, and
  on Roon Server's own HTTPS port at home. The server announces its addresses to Roon's cloud.
- **Its routes (`Module.cs`):**
  - `/hello` and `/profiles`;
  - pages, each a whole screen in one answer: home, album, artist, playlist, search, genre, composition, the
    browsers (`/pages/albumbrowser` and the rest), and `/focus/*` for their filters;
  - TIDAL, Qobuz, KKBOX and nugs routes;
  - `/sync`, `/download/smart`, `/metadata`, `/tracks/match`;
  - `/radio/session/*`;
  - `/playback/info/*`, `/playback/*` and `/download/*`.
- **Playback is not a Roon zone.** ARC's app fetches each track from Roon Server and plays it itself, as Mandarin's
  app does:
  - `/playback/<keypair id>/<sealed "version=1&track=<id>">` gives the track's original file;
  - with `?mode=download&quality=…` it gives it encoded (`ETDPDownloadFlac`, `ETDPDownloadOpus`) or as it is;
  - further path parts give the segments of an HLS transcode (`TranscodeManager`, `HlsOpusSegmentizer`): Ogg Opus at
    48 kHz, encoded by Roon itself with libopusenc.
- **The qualities:** `original`, `cd` (FLAC), `lossyHigh` and `lossy` (Opus).
- **What follows from that.** The client chooses which tracks to fetch and when. That is how ARC downloads and caches
  ahead, which Rouen's Squeezebox zone cannot do (`android-app.md` §4.5): there, Roon decides what comes next.
- **Roon Server also carries Tailscale for ARC** (`TailscaleHealth.cs`, `/roon/app/tailscale/tailscale`, its state in
  `/roon/data/tailscaled.state`).

## 3. How it is guarded — the owner was right

Every route but `/playback/*`'s segments goes through `Authorize`:

- **The keypair id.** The request carries `X-RoonMobile-Keypair-Id`.
- **The key pair comes from Roon's cloud.** Roon Server asks Roon's cloud for the key pair behind that id:
  `https://roonmobile.roonlabs.net/`, `GetRoonCoreKeypair(core id, type, keypair id)`, with types `api` and
  `playback`.
- **The keys are sealed.** They arrive encrypted and are opened by Roon's native code (`RoonPlatform.Invoke(12983)`),
  not by .NET.
- **The request is sealed too.** Its JSON body is encrypted with the key pair, and opened by native code
  (`RoonPlatform.Invoke(128321)`). A playback URL's track id is sealed the same way.
- **No way round it in this build.** The switch that would skip all this (`NoMobileAuth`) is never set: it is always
  off.

So a client needs a key pair that Roon's cloud has issued for this Core. The ARC app gets one by signing in with the
owner's Roon account. Roon's cloud call for that (`GetRoonMobileKeypair(core id)`) is in the same proxy, but the
sign-in itself lives in the ARC app, which wasn't read.

## 4. What using it would take

1. **The owner's Roon account in Rouen.** Rouen would sign in to Roon's cloud as the owner, keep that sign-in, and ask
   for key pairs as ARC does.
2. **Roon's sealing, done the same way.** It is done in native code. The DLLs suggest NaCl-style boxes (`NaCl.Core`
   and `Chaos.NaCl` ship beside them), but the formats are in the native library, which wasn't read.
3. **The client's side, from the ARC app.** How it signs in and asks for key pairs would have to be read from the ARC
   app itself.

**What it would give:**
- any track, fetched whenever wanted, so caching 5 tracks ahead (or a whole album) is the client's choice;
- Roon's own Opus and FLAC encodes, and its download path;
- no Squeezebox zone, and none of its gaps or stalls.

**What it would cost:**
- Rouen would pose as Roon's own app, with the owner's account.
- It is Roon's private, sealed protocol with Roon's cloud in the loop. Any Roon update can change it, and Roon could
  refuse it.
- It is far outside what `roon-native.md` allows (proven methods, one by one, on the LAN, no account).

## 5. Where it stands

This is a finding, not a decision. Building on it needs the owner's word, given these costs. Without it, Rouen's
phone player stays a Squeezebox zone, which needs no account and no cloud.

## 6. The risks, if it were ever built (2026-10-30)

The owner, 2026-10-30: "If I do this for myself I'm ok with it. But others use my software … Are we 'hacking Roon' or
doing anything else considered dodgy … If I pushed this out to more then I'd want to be crystal clear to everyone about
what's happening." Kept here to come back to. This is not legal advice: anything shipped to others is checked against
Roon's own terms, and with someone qualified, first.

### 6.1 What it would be

- **Not breaking in.** Each person would sign in with their own Roon account, to their own Core, to play their own
  library. Nothing would be reached that the person doesn't already pay for or own.
- **Posing as Roon's own app.** Rouen would sign in to Roon's cloud and ask for key pairs as the ARC app does, so Roon
  would take it for ARC. Roon has not approved that.
- **Getting round Roon's sealing.** Every ARC request, and each playback URL's track id, is sealed by Roon's native
  code (§3). Talking to it means doing that sealing the same way. If it rests on secrets built into Roon's software,
  that means taking them out of it. This is the part most likely to be seen as defeating a protection.
- **More reverse engineering.** How the ARC app signs in and asks for key pairs would have to be read from the ARC app
  itself (§4.3). Most software licences forbid decompiling; Roon's terms are to be read on this.

### 6.2 Beside what Rouen does already

| | Roon's say | Account | Cloud | Sealing got round |
|---|---|---|---|---|
| The public extension API | supported | no | no | no |
| Roon's private LAN protocol (`roon-native.md`) | not approved | no | no | no |
| ARC | not approved | yes | yes | yes |

The private protocol is already reverse-engineered and unofficial. ARC would go further on every count.

### 6.3 What Rouen's server would keep

- **Not the password.** It would be used once, to sign in.
- **A Roon account sign-in token.** The phone plays with no one at a keyboard, so a long-lived token would live in
  Rouen's data volume (`musicd-remote-data`). Whoever has that volume, or a backup of it, could act as the person on
  Roon's cloud. What else the token allows is in the ARC app, which was not read. (Roon Server keeps such a token in
  its own data folder: that is why that folder is never copied.)
- **The Core's key pairs** (`api`, `playback`). They let a client read and play the library.
- **Possibly the account's email**, whatever the sign-in answers with.

So Rouen would hold credentials. Built, it would keep them out of its backups, delete them on signing out, and say how
to take them back: sign out in Rouen, or change the Roon password.

### 6.4 The risks

- **It breaks.** Any Roon update can change the protocol or the sealing.
- **The account.** Roon can see an unofficial client on its cloud. It could refuse it, or act against the accounts
  using it. For the owner that is their own risk to take; for others it is a risk handed to them.
- **Shipping it.** Handing it out hands out the way round the sealing to everyone. Some countries allow reverse
  engineering for interoperability; in others getting round a protection is a legal risk.

### 6.5 If it were ever shipped: crystal clear

- **Off by default**, opt-in, behind a screen of its own.
- **In plain words on that screen:** "This signs in to Roon's servers as you and acts as Roon's ARC app. Roon hasn't
  approved it. It may stop working, Roon may block it, and that could affect your Roon account."
- **What is kept and where**, and that signing out deletes it.
- **How to take it back:** sign out in Rouen, or change the Roon password.

### 6.6 Better routes, first

- **Ask Roon.** Roon Labs has a developer community. Asking whether a client may use ARC's playback, or for an official
  way to fetch tracks, costs nothing; a yes would take away every risk above.
- **What can be had without ARC.** A disk cache on the phone, on today's Squeezebox zone (`android-app.md` §4.5): not
  five tracks ahead, since Roon decides what comes next, but it rides out a poor signal, with no account and nothing to
  get round.
