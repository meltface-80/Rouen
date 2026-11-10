# An album's versions

Read before working on the album view's Versions: what Roon sends of an album's other versions (`native-remote.md`
§16.7, the reads that found it), how Rouen reads them (`lib/roon-direct/versions.js`), how the album view shows them
(`public/album-versions.js`), and how a version is made the main one (§6, a write to the library, not yet built).

## 1. The request

The owner, 2026-11-09: "I also want versions. Mandarin does this but Rouen will have to work with Roon and the reverse
code". Asked how, 2026-11-10, the owner chose:
- **"Follow Roon"**: a version is made the main one as Roon makes it, a write to the library, found and read by a
  read-only probe first and tried once by hand on the owner's server before anything ships (`roon-native.md` §3).
- **"Yes"**: the streaming versions (TIDAL, Qobuz) are listed beside the library's own copies.
- **"Tracks + Make main"**: a tap on a copy hidden as a duplicate opens that copy's tracks, playable, with "Make this
  the main version". The make-main button waits for the hand-tried write (§6); this build lists, opens and plays.

## 2. What Roon sends (the owner's reads of 2026-11-10, t13's probe)

`Library::GetAlbum(AlbumBase)` (proven) answers with an `Album` whose `AlternateAlbumVersions` is a struct of three
list objects, each of `AlternateAlbumVersion` structs:

| List | What it holds (The Dark Side of the Moon) |
|---|---|
| `LibraryGroupVersions` | The library's copies grouped as one album: the one opened (its `Album` named, never pushed: the object asked for), and two copies `IsDuplicate` and `IsHidden` (96/24, and "oan, EAC - FLAC" 44.1/16) |
| `LibraryOtherVersions` | The library's other releases of it, not grouped (none here) |
| `StreamingVersions` | TIDAL's or Qobuz's releases (two here, 96/24 and 192/24; none in a later read, while Roon still had the album `IsLoading`) |

An `AlternateAlbumVersion`: `Album` (an `AlbumLite` by reference, pushed with the answer), `Version` (a string, when
the copy has one: "50th Anniversary"), `TrackCount`, `Formats` (strings: "FLAC 192kHz 24bit"), `ContentSources` and
`ContentLocations` (a copy's folder, `RelativePath`). The `AlbumLite` adds `Title`, `ContentSource` (1 library, 128
TIDAL, 256 Qobuz), `IsDuplicate`, `IsHidden`, `LibraryAlbumId` (a library copy's) or `RoonReleaseId` (a streaming
one's), and `AlbumFormat`.

What makes a copy the main one is `DuplicateOf`, a member of `AlbumEdit` (and `AlbumEditInfo`): a copy hidden as a
duplicate is a duplicate of the main one. The catalogue has no other method for it (§6).

## 3. The screen

### 3.1 Where

On a phone held upright (`album-phone.md`), a fourth tab: **TRACKS · CREDITS · ABOUT · VERSIONS**. From 720px up,
where there are no tabs, a **Versions** section in the side column after Credits (in the three columns of
`album-view-landscape.md`, whose left column places its parts row by row, at the foot of that column). Either is there only once the
server has said the album has another version: an album with only itself shows no tab and no section. Native mode
only (the official API carries no versions).

### 3.2 A row a version

In Roon's order, the library's group first, then the library's other releases, then the streaming ones. Each row:

- **Its name**: its `Version` ("50th Anniversary"); else its title when it differs from the album's; else its
  folder's own name (the last part of its `RelativePath`); else "Version n".
- **Its line**: its format as Roon says it, "bit" said "-bit" ("FLAC 192kHz 24-bit"), its track count ("10 tracks"),
  and where it is: "Library", "TIDAL" or "Qobuz".
- **A mark**: "Playing now" is not read; the one opened is marked **This version**, and a hidden duplicate
  **Hidden**.

A tap on any other row opens its sheet (§3.3); the one opened does nothing.

### 3.3 A version's sheet

A sheet over the album view (from the bottom on a phone, centred above 720px, as the signal path's card): its name and
line as the row says them, **Play** and **Shuffle**, then its tracks (number, title, length) read from the server
(`Library::GetAlbumTrackLites` on that copy, proven). Closed by its ×, a tap outside or Escape. Play and Shuffle play
the whole copy on the chosen zone (`Transport::PlayAlbum`, hidden tracks included); believed once the zone plays what
it wasn't, as a smart playlist's play is (`native-remote.md` §12.3), and said under the buttons when not.

### 3.4 When

Asked when an album opens (native mode on). While the server says the album is still loading its versions
(`IsLoading`, or `AlternateVersionsReady` false), asked again after 5 seconds, three times at most: the streaming
versions come late (§2).

## 4. How

- `lib/roon-direct/versions.js` (new): `read(title, artist)` — the album found as `track-times.js` finds it, then
  `GetAlbum`; the versions in plain terms, kept per connection so an album is asked once (until it is complete);
  what the read brought into the graph let go once read. `tracks(title, artist, id)` and `play(title, artist, id,
  zoneId, shuffle)` find the copy by its id from that read (a library copy by its `LibraryAlbumId`, a streaming one by
  its `RoonReleaseId`). Read only, but for the play.
- Routes (`lib/routes/album-versions.js`): `GET /api/album/versions?title=&artist=`, `GET
  /api/album/version-tracks?title=&artist=&id=`, `POST /api/album/version-play {title, artist, id, zone_id, shuffle}`.
- `public/album-versions.js` and `.css` (new), loaded by `album-view.js`; `album-phone.js` gains the tab.
- New on the allowlist (`roon-native.md` §4): `Transport::PlayAlbum(Zone, Sooid, PlayParameters, AlbumBase, bool
  favoritesonly, bool includehidden, ResultCallback<PlayFeedback>)` — upstream's generated client's, heard playing;
  its arguments read as `PlayPlaylist`'s, proven (§12.4): the Zone by its object, the profile's id, PlayParameters
  with Shuffle alone, the album by its object, false, true.

## 5. The probe for §6 (read only, this build)

`GET /api/debug/roon-album-versions?run=1&title=&artist=`: the album's versions as §4 reads them, then each library
copy's `AlbumEditInfo` (`Library::GetMultiAlbumEditInfo`, proven by `catalogue.md` t3) with its `DuplicateOf`,
`IsUserHidden` and `Version` in every layer. It shows which copy each duplicate names, and that the main one names
none, before the write in §6 is designed on it. Without `run=1` it reads nothing.

## 6. Make this the main version (next build, after §5's run)

`Library::Edit(LibraryEdit, ResultCallback)` with an `AlbumEdit` per copy: the chosen copy's `DuplicateOf` cleared,
and the old main and every other copy of the group made duplicates of it. Designed here from §5's answer, then tried
once by hand on the owner's server (`roon-native.md` §3: reads before writes), the owner checking in Roon, before the
button ships. Never sent by this build.

## 7. Not in this build

- Make this the main version (§6).
- A track of a version played on its own, or added to the queue: its sheet plays the whole copy.
- Adding a streaming version to the library from here.
- The Shelf's album view.
