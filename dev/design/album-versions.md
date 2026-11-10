# An album's versions

Read before working on the album view's Versions: what Roon sends of an album's other versions (`native-remote.md`
§16.7, the reads that found it), how Rouen reads them (`lib/roon-direct/versions.js`), how the album view shows them
(`public/album-versions.js`), and how a version is made the default one (§6, a write to the library, not yet built).

## 1. The request

The owner, 2026-11-09: "I also want versions. Mandarin does this but Rouen will have to work with Roon and the reverse
code". Asked how, 2026-11-10, the owner chose:
- **"Follow Roon"**: a version is made the default one as Roon makes it, a write to the library, found and read by a
  read-only probe first and tried once by hand on the owner's server before anything ships (`roon-native.md` §3).
- **"Yes"**: the streaming versions (TIDAL, Qobuz) are listed beside the library's own copies.
- **"Tracks + Make main"**: a tap on a copy hidden as a duplicate opens that copy's tracks, playable, with "Make this
  the default version" (called the main version until 2026-11-10, §6.2). The button waits for the hand-tried write
  (§6); t16 lists, opens and plays.

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

What makes a copy the default one is `DuplicateOf`, a member of `AlbumEdit` (and `AlbumEditInfo`): a copy hidden as a
duplicate is a duplicate of the default one. The catalogue has no other method for it (§6).

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
- **A mark**: "Playing now" is not read; the one opened is marked **This version**. A copy Roon holds as a duplicate
  carries no mark (the owner, 2026-11-10: "No need to show hidden or anything similar"): to Rouen's reader it is a
  version like any other, and Roon's word for it, hidden, says nothing they need.

A tap on any other row opens its sheet (§3.3); the one opened does nothing.

### 3.3 A version's sheet

A sheet over the album view (from the bottom on a phone, centred above 720px, as the signal path's card): its name and
line as the row says them, **Play** and **Shuffle**, then its tracks (number, title, length) read from the server
(`Library::GetAlbumTrackLitesIncludingHidden` on that copy, 2.0.3-t21). The owner, 2026-11-10: "each entry must show
their track lists". t16 read them with `GetAlbumTrackLites`, which leaves hidden tracks out; a copy held as a duplicate
has only hidden tracks, so its sheet said "Your server gave no tracks for this album" (the owner's 1973 copy). The
IncludingHidden read is the catalogue's twin of the proven one, not yet run on a server: its argument (the copy by its
object) and answer are read as the proven one's, and a refusal falls back to the plain read (§4). A copy's tracks a user
hid are listed too, as its Play plays them (`PlayAlbum`'s include-hidden is true). The album's own page keeps the plain
read, so it shows what Roon's own page does. Closed by its ×, a tap outside or Escape. Play and Shuffle play
the whole copy on the chosen zone (`Transport::PlayAlbum`, hidden tracks included); believed once the zone plays what
it wasn't, as a smart playlist's play is (`native-remote.md` §12.3), and said under the buttons when not.

### 3.4 When

Asked when an album opens (native mode on). While the server says the album is still loading its versions
(`IsLoading`, or `AlternateVersionsReady` false), asked again after 5 seconds, three times at most: the streaming
versions come late (§2).

## 4. How

- `lib/roon-direct/versions.js` (new): `read(title, artist)` — the album found as `track-times.js` finds it, then
  `GetAlbum`, sent in the connection's turn and its answer waited for outside it; the versions in plain terms, kept
  per connection so an album is asked once (until it is complete). Nothing is let go from the graph (the review:
  what arrives while the call is out is not all the answer's, and a hidden copy let go would stall the next library
  read that names it once it is made the default one); `noRoom` bounds it. A library copy the library read already let go
  is said from what that read kept of it. `tracks(title, artist, id)` and `play(title, artist, id, zoneId, shuffle)`
  find the copy by its id from that read: a copy the answer brought by its `LibraryAlbumId` or `RoonReleaseId`, one
  only the library read saw by its object on this connection (asked again on a new one). Read only, but for the play.
- Routes (`lib/routes/album-versions.js`): `GET /api/album/versions?title=&artist=`, `GET
  /api/album/version-tracks?title=&artist=&id=`, `POST /api/album/version-play {title, artist, id, zone_id, shuffle}`.
- `public/album-versions.js` and `.css` (new), loaded by `album-view.js`; `album-phone.js` gains the tab.
- New on the allowlist (`roon-native.md` §4), 2.0.3-t21: `Library::GetAlbumTrackLitesIncludingHidden(AlbumBase)`, a
  version's tracks (§3.3); the catalogue's, not yet run on a server, its argument and answer read as those of
  `GetAlbumTrackLites` (proven). Refused, the plain read is asked instead and the log says so.
- New on the allowlist (`roon-native.md` §4), t16: `Transport::PlayAlbum(Zone, Sooid, PlayParameters, AlbumBase, bool
  favoritesonly, bool includehidden, ResultCallback<PlayFeedback>)` — upstream's generated client's, heard playing;
  its arguments read as `PlayPlaylist`'s, proven (§12.4): the Zone by its object, the profile's id, PlayParameters
  with Shuffle alone, the album by its object, false, true.

## 5. The probe for §6 (read only, this build)

`GET /api/debug/roon-album-versions?run=1&title=&artist=`: the album's versions as §4 reads them, then each library
copy's `AlbumEditInfo` (`Library::GetMultiAlbumEditInfo`, proven by `catalogue.md` t3) with its `DuplicateOf`,
`IsUserHidden` and `Version` in every layer. It shows which copy each duplicate names, and that the default one names
none, before the write in §6 is designed on it. Without `run=1` it reads nothing.

## 6. Make this the default version (next build, after §5's run)

### 6.1 What §5's run found (the owner's server, 2026-11-10, The Dark Side of the Moon)

| Copy | `DuplicateOf` | `IsUserHidden` | `Version` |
|---|---|---|---|
| 50th Anniversary, FLAC 192/24 (the one shown) | none | false | "50th Anniversary" (file and edit) |
| "oan, EAC - FLAC", FLAC 44.1/16 | the 50th Anniversary, edit layer only | false | "oan, EAC - FLAC" |
| "The Dark Side of the Moon (1973)", FLAC 96/24 | the 50th Anniversary, edit layer only | false | none |

So: every other copy names the default one directly (no chains); the default names none; the link is a user's edit,
in no file's tags or Roon's metadata; and a copy is hidden only because it is a duplicate (`IsUserHidden` false
throughout). Undone exactly by making the 50th Anniversary the default again.

### 6.2 The owner's answers (2026-11-10)

- **Swap the default version.** "None of the versions should be hidden for a start. Swapping the default version is
  needed." Asked again, plainly: no "Hidden" or anything like it is shown (§3.2), and each version shows its tracks and
  plays from its sheet (§3.3).
- **Every other copy follows the new default**, as Roon holds them now: each names the default directly.
- **No "Are you sure?"**: the old default stays in the list, and making it the default again undoes it.
- **The trial**: the 1973 96/24 copy made the default, checked in Roon by the owner, then the 50th Anniversary made the
  default again by the same route.

### 6.3 The write

`Library::Edit(LibraryEdit, ResultCallback)`, upstream's proven write (title, rating, genres and labels, set and
restored live; `docs/plans/2026-06-12-metadata-edit-findings.md` upstream): a `LibraryEdit` by value whose `Albums` is
an `IList<AlbumEdit>`, LengthPrefixed; each `AlbumEdit` by value, keyed by its `long AlbumId` (the `AlbumLite`'s
`AlbumId`, never the object's id), with one member: `DuplicateOf`, an `EditOptionalRef<AlbumLite>` by value —

- on the new default: `ClearEdits` true (its `DuplicateOf` is in the edit layer alone, so it is left with none);
- on each other copy of the group (the old default among them): `EditValue`, the new default's `AlbumLite` by
  reference (its object on this connection).

One copy a call, in this order: the new default cleared first, then the others pointed at it. Roon's order within one
call is unknown, and this one never hides every copy if it stops part way: after the first call two copies show,
never none (pointing the old default at the new one first would make each a duplicate of the other).

Unproven, so tried by hand before anything ships: an `EditOptionalRef<T>` whose `T` is an object (upstream ran only
strings, ints and string lists), and `ClearEdits`. Upstream found `EditOptionalVal<bool>` edits never answered, so each
call is waited for 15 s at most and said unanswered after; nothing is sent after a call that wasn't answered.

### 6.4 The trial (a build of its own, run by hand)

`POST /api/debug/roon-album-make-default {title, artist, id, confirm: true}` — the copy named by the id the versions
read gives it, a copy of the library's group only. Without `confirm` it sends nothing and says what it would send. It
answers with each call's result and a fresh §5 read of every copy's `DuplicateOf` after, so the owner's check in Roon
and Rouen's read are compared. Only then does the button ship: **Make this the default version** on a version's
sheet, for a copy of the library's group other than the one shown; never for a streaming release or the library's
other releases (§7).

## 7. Not in this build

- Make this the default version (§6): the trial first, then the button.
- A track of a version played on its own, or added to the queue: its sheet plays the whole copy.
- Adding a streaming version to the library from here.
- The Shelf's album view.
