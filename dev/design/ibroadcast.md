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
  slower each time it answers `slow_down`) until the code is approved, turned down or expired. iBroadcast out of reach
  or failing (a cut connection, a 5xx answer) is asked again at the interval, so an approval made meanwhile is still
  found; only a refusal, an expiry or an app not let sign in with a code ends the sign-in.
- **Read-only:** Rouen asks only for `user.account:read user.library:read`. Mandarin's upload and library-write scopes
  are not asked for.
- **The tokens:** the access token is renewed with ten minutes of its life left (half its life for a shorter-lived one),
  and once more when an answer says `"authenticated": false`; one renewal at a time. The refresh token is kept when a
  renewal returns none. A refresh token iBroadcast refuses signs Rouen out here (not at iBroadcast failing, a 5xx), so
  the page offers Sign in again instead of a dead end.
- **iBroadcast's JSON API** on `api.ibroadcast.com`: `POST /<mode>`, with `client: "rouen"`, Rouen's version, the
  device name `Rouen` and the user agent `rouen/<version>` in the body, and `Authorization: Bearer <access token>`.
  `"result": false` is a failure, said in iBroadcast's own words.
- **Kept in Rouen's settings** under one key, `ibroadcastToken`: `{ token: { access, refresh, expires, life, scope },
  user: { id, name }, premium, formats, checked, since }`. One key, so a backup's keys part (`lib/backup.js` sends any
  key named like a token there) carries the sign-in and the account it is for together. Tokens are never logged, never
  sent to the page, and never in the debug answers.
- **The account** (iBroadcast's `status` mode, with `supported_types`): its name, whether it is Premium, and the file
  types iBroadcast takes. Read when the sign-in completes, and again when the page asks and six hours have passed: one
  reading at a time, and one that failed is not tried again for five minutes, whatever the page asks. While it is read
  the state says `describing`, and the page goes on asking until it has it.
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
  under the album its own entry names where that album lists it, else the first to list it (a track whose entry names an
  album that doesn't list it would otherwise be lost: the review; Mandarin has the same flaw).
- **When it is read:** once the sign-in completes; on **Read library now**; and, while the plugin's service runs, every
  ten minutes, read again only when iBroadcast's `status.lastmodified` has moved on. One reading at a time; Read library
  now during the ten minutes' look (which may read nothing) reads after it. A reading under way when the person signs
  out keeps nothing.
- **What the page says:** albums, tracks, how many are lossless (FLAC, WAV, AIFF), their total size, and when it was
  read. Without Premium, iBroadcast streams only 128 kbps MP3 copies, and the page says so: the drive will need Premium
  to give Roon the original files.

### 3.3 The routes (`lib/ibroadcast/service.js`, under the plugin's prefix)

    GET  /api/ibroadcast/status          { connected, user: { name }, premium, formats, since, library }, or signed out
                                         { connected: false, pending?: { url, code, expires_at, error } }
    POST /api/ibroadcast/signin          a code to approve on iBroadcast: the state, its pending among it
    POST /api/ibroadcast/signin/cancel   the sign-in under way let go
    POST /api/ibroadcast/signout         signed out, here and at iBroadcast
    POST /api/ibroadcast/library         Read library now: the state once it is read

Signed in, the state also says `describing` (§3.1). `library` is `{ reading, albums, tracks, lossless, bytes, at, error }`. A failure is answered in iBroadcast's words with
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

## 4. Stage 2 (2.0.6-t2): the drive, proved by hand

### 4.1 The owner's answers (2026-11-20)

1. **Audio analysis must not download the library.** "Users cannot be told to turn off audio analysis for this to
   function … If 1. has no solution then we stop." Roon's background analysis reads every file of a library in full,
   and its setting is the whole library's, not a folder's.
2. **A copy on your drives wins:** "If a copy on your drives then show them over iBroadcast": an album also in the
   library from local files is left off the iBroadcast drive (as Mandarin leaves it out), so Roon shows it once.
3. **iBroadcast's terms:** yes, a whole library may be read through their API.

### 4.2 The way round analysis, to be proved: the drive reads for playing only

Rouen knows what every zone is playing and has queued (the transport API). So the drive answers a read by where it
falls and by whether its track is wanted:

- **The file's start and end** (its metadata, and a tail of 256 KB for tags kept there): always answered. That is what
  Roon's import reads: a FLAC's metadata blocks (to where its first audio frame begins, read from the file itself), an
  MP3's ID3v2 tag; another type's first megabyte.
- **The audio, for a track playing or queued** (now playing in any zone, or among the next three queued in a zone that
  is playing): answered in full, and the file stays open to reads for half an hour after (a seek, a replay).
- **The audio of any other track** (Roon's background analysis): held up to eight seconds, in case Roon's own news that
  it is playing comes after its first read, then **refused** (a read error). Nothing of it is downloaded.

A track is analysed when it is first played, from the one download playing it needed anyway. The probe proves, or
not, on the owner's Core: that Roon imports the drive; what a refused analysis read makes Roon do (quiet, a track
marked broken or hidden, retries without end); that a track never analysed in the background still plays, seeks, and
goes to the next without a gap; and how much each step downloads. **If Roon treats refused reads badly, there is no way
round it, and the work stops** (the owner's words).

### 4.3 How the drive is made

- **A local HTTP server** (`lib/ibroadcast/drive-http.js`), on 127.0.0.1 only, under a random path: each folder a page
  of links, each file answered to `HEAD` (its size, from iBroadcast's library) and to a ranged `GET`, through the read
  rule above (`lib/ibroadcast/drive-reads.js`). A read wanted is fetched from iBroadcast in 256 KB blocks, as a range of
  the original file (`<streaming_server>/orig/<path>?Expires&Signature&file_id&user_id&platform=rouen&version`, as
  Mandarin's `IBroadcastStreams.cs` builds it), kept in memory (up to 256 MB) so a block read twice is downloaded once.
  A refused read is answered 403.
- **rclone mounts it** (`rclone mount :http:`, read-only, no cache of its own, reads in chunks of 64 KB so every read
  passes the rule and a read of a file's start is never a megabyte, one try; a read from the start is answered to where
  the audio begins or 128 KB, whichever is further): rclone's FUSE layer is well proven, and every rule stays in Rouen, where it is tested without FUSE. The image
  gains Debian's `rclone` and `fuse3`. Rouen starts rclone when the drive has albums and stops it (unmounting) when the
  plugin is removed or the drive emptied. The plugin is made at Rouen's start when it is installed (`start` on the
  plugin host, `lib/plugins.js`), so the drive is back up after a restart without the page being opened.
- **The folders:** `Artist / Album (Year) / NN Title.<ext>` (`DN-NN` on a set of several discs), the extension from the
  file's type, names made safe for any file system, two the same told apart.
- **Docker, Rouen and Roon on one machine:** the container gains `--device /dev/fuse --cap-add SYS_ADMIN
  --security-opt apparmor=unconfined` and `-v /mnt/ibroadcast:/ibroadcast:rshared`, and the Core adds `/mnt/ibroadcast`
  as a storage folder. Without them the page says what is missing. Not on Windows (no rclone there): the page says so.
- **The probe's albums:** up to 20, chosen on the plugin's page by searching the library read (§3.2); the drive holds
  only those. The owner picks albums not on the owner's drives, so §4.1's second answer is built in stage 3, by matching
  the drive against the library's local albums.
- **The report** (`GET /api/ibroadcast/drive/report`, and on the page): for each file, what was served of its start,
  its end and its audio, what was refused or held and for how long, and what was downloaded; the last 300 reads, each
  with its place, length and the rule that answered it; and the totals.

### 4.4 Routes (under `/api/ibroadcast`)

    GET  /drive              { available, why, mounted, mount, albums: [{ id, title, artist, tracks }], totals }
    GET  /drive/search?q=    the library's albums matching q (title or artist), up to 30: [{ id, title, artist, year, tracks }]
    POST /drive/albums       { ids }: the probe's albums (up to 20); the drive made again
    GET  /drive/report       the report (§4.3)

## 5. Testing

- `test/lib/fake-ibroadcast.js`: iBroadcast's servers on loopback, ported from Mandarin's `test/fake-ibroadcast.js`
  (the sign-in, the JSON API, the library server), less its upload and streaming servers.
- Unit: the sign-in with its code, slow-down, approval, refusal and expiry; a stale token renewed once and the call made
  again; the renewal due; no token ever in the page's answer; sign out revoking at iBroadcast; the library's tables read
  (discs joined, the trash left out, a track listed twice kept once), kept, and read again only once it changed.
- DOM: the plugin's page signed out, with a code under way, and signed in.
- Stage 2, unit, without FUSE: the folders and names; the read rule (a FLAC's metadata found from its own blocks, the
  tail, a playing or queued track answered, any other held and refused, a block downloaded once); the local server's
  listing, HEAD and ranges as rclone asks them; rclone's arguments and its stop.
