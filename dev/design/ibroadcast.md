# iBroadcast in Roon — design

## 1. Goal (the owner's words, 2026-11-19 and 2026-11-20)

> "I'm thinking of adding iBroadcast like I have to my Mandarin project. I then want a way to play the iBroadcast
> streams via Roon." … "What if we map the iBroadcast as local drive" … "Using the dev branch version of Mandarin for
> the iBroadcast feature I want to implement this in Rouen. Mapping it as a local drive. We'd start by doing this based
> on Rouen and Roon being on the same machine. I'd suggest we add the iBroadcast feature to get the login and access to
> what's on my iBroadcast account and then prove it to see if Roon will import it as if it were Qobuz or Tidal."

The owner's answers (2026-11-20):

- **Rouen signs in as Mandarin's iBroadcast app.** It uses the same client id (registered on the owner's iBroadcast
  account, with the device-code sign-in allowed). A Rouen app of its own can replace it later by changing one constant
  (`CLIENT_ID` in `lib/ibroadcast/api.js`).
- **iBroadcast is a plugin** (`dev/design/plugins.md`): Settings → Plugins → iBroadcast, off until installed. Nothing of
  it runs while it is off, and the drive (§4) will be the plugin's own, unmounted when it is removed.

## 2. Why a drive, and what Roon will make of it

Roon's own streaming services (Qobuz, TIDAL) are built into the Core; an extension cannot add one. The routes that were
weighed (the conversation of 2026-11-19):

- **A radio address**, or Roon's audio-input API (`com.roonlabs.audioinput:1`): Roon fetches an address Rouen serves.
  Roon treats it as a live stream: Stop only, with no pause, skip or seek in Roon's app, no artwork, and nothing in
  Roon's library.
- **A drive** (chosen): Rouen shows the iBroadcast library to Roon as a read-only folder of the original files, laid out
  as Artist / Album / 01 Title.flac. Roon imports it as it imports any folder of music: its own tags and artwork, the
  library, Focus, Radio, the queue with pause, skip and seek, gapless, DSP, play counts, and Roon ARC away from home.

What the owner should expect: **Roon shows these albums as part of the library, not as a third service beside Qobuz and
TIDAL.** In Roon they are files on a storage location, like music on a disk.

## 3. Stage 1 (2.0.6-t1): the sign-in and the library read

Ported from Mandarin's `dev` branch (`server/Mandarin.Server/Services/IBroadcast/IBroadcastApi.cs`, `IBroadcast.cs`,
`IBroadcastLibrary.cs`, `IBroadcastRoutes.cs`, `public/app/settings-ibroadcast.js`), keeping only what reading needs.
Mandarin's upload, schedule, bandwidth and library import into Mandarin's own database are not ported.

### 3.1 The sign-in (`lib/ibroadcast/api.js`, `lib/ibroadcast/account.js`)

- **OAuth 2.0's device flow** on `oauth.ibroadcast.com`, as a TV app signs in: Rouen asks for a code, the page shows it
  with iBroadcast's link, the person approves Rouen there, and Rouen asks at the interval iBroadcast gives (five seconds
  slower each time it answers `slow_down`) until the code is approved, turned down or expired.
- **Read-only:** Rouen asks only for `user.account:read user.library:read`. Mandarin's upload and library-write scopes
  are not asked for.
- **The tokens:** the access token is renewed with ten minutes of its life left (half its life for a shorter-lived one),
  and once more when an answer says `"authenticated": false`; one renewal at a time. The refresh token is kept when a
  renewal returns none.
- **iBroadcast's JSON API** on `api.ibroadcast.com`: `POST /<mode>`, with `client: "rouen"`, Rouen's version, the
  device name `Rouen` and the user agent `rouen/<version>` in the body, and `Authorization: Bearer <access token>`.
  `"result": false` is a failure, said in iBroadcast's own words.
- **Kept in Rouen's settings** under one key, `ibroadcastToken`: `{ token: { access, refresh, expires, life, scope },
  user: { id, name }, premium, formats, checked, since }`. One key, so a backup's keys part (`lib/backup.js` sends any
  key named like a token there) carries the sign-in and the account it is for together. Tokens are never logged, never
  sent to the page, and never in the debug answers.
- **The account** (iBroadcast's `status` mode, with `supported_types`): its name, whether it is Premium, and the file
  types iBroadcast takes. Read when the sign-in completes, and again when the page asks and six hours have passed.
- **Sign out** forgets the sign-in here and revokes it at iBroadcast (whatever iBroadcast answers), and removes the
  library read (§3.2).
- A sign-in under way lives in memory only. Removing the plugin ends it, and nothing asks iBroadcast again.

### 3.2 The library read (`lib/ibroadcast/library.js`)

- iBroadcast's library server (`library.ibroadcast.com`, `POST`, mode `library`) answers the whole library at once:
  tracks, albums and artists, each an id → an array of values with a `map` naming each value's place.
- **What is kept** (`data/ibroadcast/library.json`, beside Rouen's other data): each album with its title, artist, year
  and tracks; each track with its title, artist, track and disc numbers, length, size, file type, iBroadcast's file path
  and its artwork id; and the library's `lastmodified`, its streaming and artwork servers, and when it was read. This is
  what the drive (§4) will list and read from; nothing of it enters Rouen's own library or Roon's.
- As Mandarin writes it: an album iBroadcast keeps one entry per disc (one name, one artist) is one album again, its
  discs in order; a track in the trash, or an album in it, is left out; a track listed under two albums is kept once,
  under the album its own entry names, else the first to list it.
- **When it is read:** once the sign-in completes; on **Read library now**; and, while the plugin's service runs, every
  ten minutes, read again only when iBroadcast's `status.lastmodified` has moved on.
- **What the page says:** albums, tracks, how many are lossless (FLAC, WAV, AIFF), their total size, and when it was
  read. Without Premium, iBroadcast streams only 128 kbps MP3 copies, and the page says so: the drive will need Premium
  to give Roon the original files.

### 3.3 The routes (`lib/ibroadcast/routes.js`, under the plugin's prefix)

    GET  /api/ibroadcast/status          { connected, user: { name }, premium, formats, since, library }, or signed out
                                         { connected: false, pending?: { url, code, expires_at, error } }
    POST /api/ibroadcast/signin          a code to approve on iBroadcast: the state, its pending among it
    POST /api/ibroadcast/signin/cancel   the sign-in under way let go
    POST /api/ibroadcast/signout         signed out, here and at iBroadcast
    POST /api/ibroadcast/library         Read library now: the state once it is read

`library` is `{ reading, albums, tracks, lossless, bytes, at, error }`. A failure is answered in iBroadcast's words with
its status: 401 when signed out or the sign-in was turned down, 502 when iBroadcast failed or couldn't be reached. Writes
must be JSON, as HQPWeb's are (`lib/hqp/service.js`).

### 3.4 The page (`public/ibroadcast/`)

Settings → Plugins → iBroadcast → Settings:

- **Signed out:** Sign in on iBroadcast. Tapped, it shows iBroadcast's link to tap and the code, and asks every two
  seconds until the sign-in completes or fails; Cancel lets it go. Unlike Mandarin, the link is not opened for the
  person: a tab opened after the server's answer is blocked on a phone, and the Android app opens links its own way.
- **Signed in:** "Signed in as …", Premium (yes: the original files; no: 128 kbps MP3 only), the formats iBroadcast
  takes, what the library holds, **Read library now** and **Sign out** (asked first).

### 3.5 `index.js`

The plugin host's setup moves out of `index.js` into `lib/plugins-mount.js` (HQPWeb and iBroadcast registered there),
behaviour unchanged for HQPWeb, and the length baseline is ratcheted.

## 4. Stage 2 (2.0.6-t2, next): the drive, proved by hand

Rouen and Roon on one Linux machine (the owner's choice). A probe, run once by the owner on a few albums:

- a read-only FUSE mount of the library read in §3.2: Artist / Album / `NN Title.<ext>` with the sizes iBroadcast gives;
  a read becomes an HTTP range request for the original file (`<streaming_server>/orig/<path>?Expires&Signature&
  file_id&user_id&platform=rouen&version`, as Mandarin's `IBroadcastStreams.cs` builds it), with a read-ahead cache;
- Docker: `--device /dev/fuse`, `--cap-add SYS_ADMIN`, and the mount shared with the host (`:rshared`) so the Core sees
  it as a local folder;
- what it proves: Roon imports it; plays, seeks and goes from track to track without a gap; how much it downloads to
  import an album (tags and artwork only), and what its audio analysis reads.

Open before stage 2's code, for the owner: background audio analysis (off before the folder is added, or Roon downloads
every file in full); albums that are also on the owner's drives (two copies in Roon); and whether iBroadcast's terms
allow a whole library to be read through their API.

## 5. Testing

- `test/lib/fake-ibroadcast.js`: iBroadcast's servers on loopback, ported from Mandarin's `test/fake-ibroadcast.js`
  (the sign-in, the JSON API, the library server), less its upload and streaming servers.
- Unit: the sign-in with its code, slow-down, approval, refusal and expiry; a stale token renewed once and the call made
  again; the renewal due; no token ever in the page's answer; sign out revoking at iBroadcast; the library's tables read
  (discs joined, the trash left out, a track listed twice kept once), kept, and read again only once it changed.
- DOM: the plugin's page signed out, with a code under way, and signed in.
