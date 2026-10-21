# Native remote — design

Status: **approved by the owner 2026-10-14 (merged as #223); N1a built in v1.9.21; widened and reordered by the owner the same day (§1.4–1.7); N2a, hearts (§8), answered by the owner and built in v1.9.27.** This document is the
specification for the work it describes: code matches it, or this document changes first, in the
same commit (`CLAUDE.md`, "Spec authority"). It builds on `dev/design/roon-native.md` (the
protocol, its principles, stages 0 and 1) and replaces that document's later stages (2–4).

## 1. Goal and the owner's decisions (2026-10-14)

> I want Rouen with Roon Direct on to be a fully functioning Native Roon Remote but using my
> Rouen UI.

1. **Scope: everything Rouen does** goes through the Core's internal protocol while Roon direct is
   on — the library, album and artist pages, covers, playing, the queue, zones, transport and
   volume, search, Focus, hearts, Listen Later, add to library. Roon's official extension API is
   the fallback: when Roon direct is off, or for one feature while its native path fails.
2. **One connection kept open**, as Roon Remote keeps one, closed and opened again every night
   and after any error, so whatever it holds in the Core stays bounded (§4).
3. **Files over 850 lines are brought under 850 as part of this work** (`CLAUDE.md`,
   `dev/quality.md`): each phase moves the official-API code it stands beside out of `index.js`
   and `public/app.js` (§6).

**Later the same day, after N1a worked on the owner's Core:**

> What we need now is to increase what native control we have like adding albums to the roon
> library adding albums to favorites to show as a favorite in roon directly. Direct access to
> zones and their settings. Basically everything Roon Remote does I want Rouen to do.

4. **The goal widens to everything Roon Remote does**, not only what Rouen already did.
5. **Order (the owner's pick):** the login, then hearts and add to library, then zones and their
   transport, then zone settings, then the rest (native play, album pages, queue, search, artists)
   — §5.
6. **The login comes first** (`roon-native.md` §7, kept): no write to the Core's library is built
   before it. As built in v1.9.22 it guarded settings and the library and left playing open; **since
   v1.9.26 (the owner, the same day) it is a mandatory account — a username and a password — that
   guards all of Rouen**, playing included. Its design: `dev/design/login.md`.
7. **Zone settings: the zone basics and DSP; not device setup.** In: a zone's name, crossfade,
   volume levelling, sleep timer, grouping and transfer; DSP on and off, its presets, headroom and
   EQ. Out: device setup (exclusive mode, DSD, volume-control type, sample-rate limits, "force max
   volume") — a wrong setting there can mean silence or full-scale output to an amplifier.

Why the change of course: stage 1 kept Rouen's own picture of the library — built through the
official API — and paired each album with the Core's by title and artist. A handful never paired,
and an unpaired album had no true answer. A native remote has nothing to pair: Rouen's library
**is** the Core's list, each album carrying the Core's own identity, source and details.

**Opt-in (the owner, 2026-10-20; built in v1.9.32):** whether an install has native mode at all
is chosen once — at install, or at the first start after v1.9.32 — on the choice sheet of
`login.md` §5, and that choice is permanent until Rouen and its data volume are removed. Chosen,
native mode is on and its Settings switch stays, to flip between it and the official API; not
chosen, it (and hearts with it) is never offered, and the switch is gone.

## 2. What the protocol is known to do (research, 2026-10-14)

From Arthur Soares' roon-api-reverse-engineering (read, not run): what its own client has run
against a Core ("live"), what Roon's own app was seen calling ("captured"), and what is only a
signature in the catalogue. Rouen's own runs (stage 0, v1.9.11–v1.9.18) are counted as live.

| Need | Native call | Evidence | Plan |
|---|---|---|---|
| The library's albums | `Library::VirtualAlbumQuery` + pages | **live (Rouen, v1.9.18)** | N1a |
| An album's tracks and details | `GetAlbum`, `GetExtendedTrackInfo`; `GetAlbumTrackLites` | captured; catalogue | N5, tried in the build (§3.3) |
| Covers | — none known returns image bytes | — | official API's image service (§3.4) |
| Play an album | `Transport::PlayAlbum` (with `ResultCallback<PlayFeedback>`) | **live, audio confirmed** | N4 |
| Play next / add to queue / play from here | `PlayParameters.Priority` (Next 3, Queue 4), `IsFromHere` | catalogue | N4 |
| Play a track | `PlayTrack`, `PlayTracks` | captured | N4 |
| Zones, outputs, now playing | the root graph's Zone/Endpoint objects, kept up by UPDATEOBJ | **live** (field names of now playing unproven) | N3 |
| Pause, standby, convenience switch | `Zone::Pause`, `Endpoint::Standby`, `ConvenienceSwitch` | **live** | N3 |
| Play, next, previous, stop | `Zone::Play`, … | upstream's web client | N3 |
| Volume | `Endpoint::SetVolumeDouble` | captured | N3 |
| Seek, mute, shuffle, repeat, Roon Radio | `Seek`, `SetMute`, `SetShuffle`, `SetLoop`, `SetAutoSwim` | catalogue (no reply: confirmed by the next update) | N3 |
| Queue: read, remove, move, clear | `Queue::ItemsQuery`/`GetItems`, `RemoveItems`, `MoveItems`, `Clear` | catalogue; remove/move encoding checked elsewhere | N5 |
| Search | `UnifiedSearch` | **live (library)**; TIDAL/Qobuz results unknown | N6 |
| Artists | `VirtualPerformerQuery`, `GetPerformer`, `BrowsePerformerAlbums` | captured | N6 |
| Focus (genres, labels, …) | `Library::GetAlbumQueryInfo` | catalogue | N6 |
| Play history | `VirtualHistoryQuery` | **live** | N6 |
| Heart, Listen Later, add to library | `FavoriteOrBan`, `SetListenLaterState`, `AddToLibrary` | live once, needs re-proving; catalogue | N2, after the login |
| Releasing objects | `GCOBJS` | **format unknown** | §4: reconnect instead |
| A zone's name, crossfade, volume levelling, sleep timer | `Zone::SetName`, `SetCrossFade`, `SetVolumeLeveling`, `SetSleepTimer` | catalogue (no reply but the sleep timer's) | N3 |
| Grouping, transfer | `Transport::LinkEndpoints` / `UnlinkEndpoints`; `Transfer` | encoding checked elsewhere; captured | N3 |
| DSP | `AudioDeviceCommonConfig::GetDspConfig`, `DspConfig::SetEnabled` / `LoadPreset` / `AddItem` / `Apply`, `DspPresets::*` | catalogue | N3 |
| Device setup | `AudioDevice::BeginSetup`, `AudioDeviceSetup::*` | catalogue | **not taken** (§1.7) |

Two things no amount of building fixes, said plainly: **covers have no native path** (Rouen keeps
the official image service for them), and **objects cannot be released one by one** in the Core
(Rouen bounds them by reconnecting).

## 3. How it works

### 3.1 One interface, two providers
Every screen's server route asks one **provider** for its data and actions, never the official API
or the internal protocol directly: `library` (albums, an album, artists, Focus, search), `play`
(album, track, next, queue, from here), `zones` (zones, outputs, now playing, transport, volume),
`queue`, `marks` (hearts, Listen Later, add to library). `lib/provider/public/*` is today's
official-API code, moved out of `index.js` behind it unchanged; `lib/provider/native/*` is the new
code. Roon direct on: native; off, or one feature failing: public, for that feature. The routes and
the screens do not change shape.

### 3.2 The library is the Core's
With Roon direct on, Rouen's album index is built from the Core's album list (the read stage 1
already does), each album keeping the Core's object, its source (`ContentSource`), title, artist
and cover key. Nothing is paired to find its source. The index rebuilds after each read; a read
runs at connection, after a library change, and on Rescan.

Built in N1a (v1.9.21, `lib/roon-direct/library.js`): what the screens read (`albumIndex`) is the
Core's list; the official API's list, as walked, is kept beside it (`publicIndex`) for everything
that keeps the snapshot in step with Roon. Until playing and album pages go native (N4, N5), an
album is still opened through the official API, at the offset of that list's row with the same
title and artist — the same strings first, then the same once normalised as an album open compares
them, never a title that normalises to nothing ("+", "=", "στίγμα" in the owner's library would
otherwise all be one album). The same title and artist twice: one row each, in order, which copy
each is the official list cannot say (N4 ends it). A Core album with no row: an offset far past
that list's end (from 1,000,000, so the list's growing never reaches one a tile still holds), which
an open turns into Roon's search by title and artist, and which is never taken as evidence that the
library changed. Roon's search, and the check that an offset holds the album asked for, tell a title
that normalises to nothing by its own string. A read that finds the list the screens already have
publishes nothing (v1.8.68's rule); only the official list's walk dates albums as newly added.

### 3.3 Calls not yet proven are tried, not trusted
For each call marked "captured" or "catalogue" above, the build uses it and checks what comes
back against what it must hold (an album's tracks: titles and numbers that add up; a play: the
zone's now playing changing). A call that fails or answers wrongly drops that one feature back to
the official API for the rest of the connection, and **Settings → Roon → Native status** says,
feature by feature, which runs native and which fell back, and why. So nothing waits on a
separate probe build, and nothing wrong is shown as Roon's answer.

The library's read (N1a) falls back the same way: a read that fails puts back the official API's
list and Rouen's own source answers, deletes the saved sources and says why; it stays on, and the
next session or library change reads again. This replaces `roon-native.md` §10.4's "any failure
turns it off" for reads. Only the check after a Rouen or Roon update still turns it off when it
fails (the owner's answer, 2026-10-14) — read on a connection opened for it, never one held from
before, and failed too when that connection cannot be opened. A read cut short by a planned
reconnect is not a failure: the next session reads again.

### 3.4 Covers
The official API's image service stays. First tried: whether it accepts the Core's own cover key
(v1.9.18's `coverSame` count, from the owner's install, says whether the two keys are one key). If
it does, covers need nothing else. If not, a native album's cover comes from the official API's
key for the same album where one is known, and a placeholder where not — the only place anything
is still matched, and only for a picture.

N1a: the owner's probe (2026-10-14) shows the Core's keys in another form from the official API's
("obaaaaaa"), so each album takes its official row's key (§3.2), and only an album without a row
tries the Core's own.

### 3.5 What stays Rouen's own
Record labels, waveforms (from `/music` or the services' streams), Smart Picks, Discover, bios,
Last.fm, Shelf, the wall display and the HQPlayer plugin are Rouen's features, not Roon's: they
keep working, fed by whichever provider is on.

## 4. The connection

`lib/roon-direct/link.js`: one connection, opened when Roon direct is on and Rouen is paired;
answers the Core's pings; holds the root graph (zones, outputs, profiles), kept up to date by the
Core's updates. Closed and opened again **every night at 04:00**, after any error or decode
failure, when the graph passes its cap, and on a Core or Rouen update (with stage 1's check, §8.5
of `roon-native.md`). Every query it opens is disposed and every page released, as now. Settings →
Roon shows the connection: up since, objects held, last reconnect and why. Off: closed, nothing of
it runs.

**Keepalives (v1.9.24).** The server reaps a connection it has heard nothing from for about 30 s
("no keepalive from … in 34289ms; reaping dead peer to release its held session", the owner's
server log, 2026-10-14): any request counts — the library read's calls kept each session alive
until the read ended — and answering the server's own pings does not. Every connection sends a
keepalive, a PING asking for an answer, every 10 s from the moment it is up (`roon-native.md` §3).
A server that has answered them and then misses three in a row is a dead line: closed and opened
afresh, rather than trusted until TCP gives up minutes later; one that never answers one is not
(it may still count them). Native status says when three in a row go unanswered. (v1.9.21 to
v1.9.23 sent none: every session ended 34 s after its library read's last call, and was opened,
and the library read, again — 53 times in an hour.)

**Each object is sent once a connection** (v1.9.28; the v1.9.17 probe saw album pages come "as rows
alone", their albums sent before): a later read on the same connection is given rows for albums it
was sent already. Rouen lets an album's object go once read (memory), so each such album is taken
from what that connection has been sent of it, with whatever the server has sent of it since. That
record is the server's word alone, kept apart from the list the screens and hearts use: a heart
Rouen sets is never read back as the server's (that would confirm a heart the server did not keep,
§8.3). It is kept for the connection whatever happens to a read — a read that fails adds what it
did read, since none of it is sent again there, and neither a fallback nor native mode turned on
again forgets it — and is dropped only with the connection. Objects a track heart's query brings
are kept for the connection. (v1.9.24's keepalives made later reads on
one connection possible; before, every read was on a fresh one, and v1.9.27 failed every read
after the first: "0 of 12968 albums arrived with their details".)

Built in N1a (v1.9.21): a drop is retried after 30 s, doubling to 5 minutes; a call left
unanswered, a message that could not be read or the graph's cap reached is checked every minute
and closes it at once for a fresh one. Every new session is read afresh (each object id belongs to
one connection); library changes are read at most once a minute, each read being one query on the
open connection rather than a connection of its own.

## 5. Phases

Each phase is one or more builds, each with its native calls tried on the owner's Core through
Native status (§3.3), and each moving the official-API code it replaces out of the monoliths.

| Phase | Native with Roon direct on | Moves out of `index.js` / `app.js` |
|---|---|---|
| **N1a** (v1.9.21) | the link (§4); the library from the Core (§3.2); Native status for both | the official API's album open, page and play actions (`lib/provider/public/`) |
| **L** | the login (`dev/design/login.md`) — no native call | settings persistence (`dev/quality.md`'s order, item 2) |
| **N2** (§8) | hearts (album and track) and add to library, for the profile chosen in Settings → Roon (`roon-native.md` §8.4); each shown as the Core has it (`IsFavorite`); Listen Later moves to Roon's own | the service favourite routes' Roon side |
| **N3** | zones, outputs, now playing, transport, volume, mute, shuffle, repeat, Roon Radio, standby; grouping and transfer; zone settings and DSP (§1.7) | zone, transport and volume routes; radio's transport calls |
| **N4** | playing an album, a track, next and queue (`PlayAlbum`, `PlayTrack`, `PlayParameters`), by the Core's own album | the play routes |
| **N5** | album pages (`GetAlbum`, its tracks); the queue: read, remove, move, clear, play from an item | the album page route and the album index build; queue routes |
| **N6** | search, artists, Focus counts, genres, play history; then the public provider only as fallback | what is left |

(Before the owner's reordering, N1b was playing an album and N1c album pages: they are N4 and N5
now.)

## 6. Files

New code: modules under 500 lines, `// @ts-check`, with tests against the fake Core
(`test/lib/fake-roon-core.js`, extended per call), which is not evidence (§2's "live" column is).
Each phase moves its feature's official-API code into `lib/provider/public/` unchanged, and
`public/app.js`'s screens it touches into `public/<screen>.js`, ratcheting the baselines in the
same commit, until no file is over 850 lines.

## 7. For the owner

Answered: the plan, N1 first, covers, calls tried inside the builds and the nightly reconnect
(approved with #223); the wider goal, the order, the login and the zone settings (§1.4–1.7,
2026-10-14).

## 8. N2 — hearts, then add to library (proposed 2026-10-14; answered by the owner the same day, §8.6)

The first writes to the Core's library. The login (L, v1.9.22; the mandatory account since v1.9.26)
is in; every route below is under `/api/` and so needs the account's login (`lib/login-routes.js`).

### 8.1 What the user sees

- **A heart on the album view, on the left of the action row, before Play Now** (the owner,
  2026-10-14): Play Now and Queue narrow to make room, ⋯ stays on the right. Outlined, or filled
  in the accent when your server has the album as a favourite. Tapped: filled at once, and put back
  with a toast ("Your server didn't take that") if the server does not confirm it (§8.3).
- **Tracks: long-press to select, then "Add to favourites"** in the selection menu the album
  view's long-press already opens (Play now, Play next, Add to end of queue, Add to playlist…) —
  the owner, 2026-10-14. One or several tracks at once; "Remove from favourites" beside it — *both
  always offered, as built in v1.9.27: the album view's tracks still come from the official API,
  which says nothing of a track's heart, so whether every selected one already is one is not known
  on the page (N5 can narrow it).* The same confirmation rules.
- No heart on Now playing (not asked for).
- **What it shows is your server's own state**, for the profile Rouen acts for (§8.4): a heart set
  in Roon's own apps shows here, and one set here shows there.
- **Native mode off** (or hearts fallen back, §8.3): no heart. The official extension API has no
  way to set one, and a heart that only Rouen knew of is what the owner asked to be rid of.
- Not in N2: Ban (Roon's "not for me"), hearts on artists and works, a Favourites filter on the
  library (N6, with Focus).

### 8.2 The calls

| What | Call | Evidence |
|---|---|---|
| Heart an album / take it off | `Library::FavoriteOrBan(Sooid profile, IEnumerable<AlbumBase>, FavoriteBanState, ResultCallback)`, each album an inline `AlbumLink { AlbumId: long, Broker }` value, the collection length-prefixed; state None 0, Favorite 1 | upstream's web client, from a byte-for-byte diff against Roon's own app; UI-confirmed there. The single-`AlbumBase` form by session object answered "Success" once upstream and was later found ignored: not used |
| Heart a track | `FavoriteOrBan(Sooid, TrackBase, …)`, the track by its session object | captured from Roon's own app |
| Is it a heart now | the album's and the track's `IsFavorite`, a `ProfileData<bool>` (count, then profile id + 0/1 pairs; no entry for the profile means not a favourite) | upstream's web client reads it; to be shown on the owner's Core |
| Add an album to the library | `Library::AddToLibrary(Profile, IEnumerable<AlbumBase>)` | catalogue only; sends no answer |

`AlbumId` is the album's stable id, a field of the album objects the library read already
receives (upstream reads it there; Rouen does not keep it yet, and N2 starts to); the
`AlbumLink` type is declared once per session (DEFTYPE) with all three of its members, as upstream's
generated schema has them. N2a (v1.9.27) adds the two `FavoriteOrBan` forms and the album's track
query (§8.3) to `methods.js`'s allowlist — `roon-native.md` §3: adding one is a spec change, and
this section is it, recorded in its §4; `AddToLibrary` comes with N2b.

### 8.3 Tried, not trusted (§3.3) — as built in v1.9.27

- **Changed elsewhere** (v1.9.28, the owner's report: a heart taken off in Roon stayed in Rouen): the
  server pushes an album's changed `IsFavorite` to a client it believes holds the album; native mode
  watches the session for it (`objects.js` watchers, beside the one read or heart running) and takes
  it at once, counting it in Settings → Native mode. Whether the owner's server sends them is shown
  by that count (for the connection open now); if not, a change made elsewhere shows at the next
  library read. How the server writes such an update is not yet seen: one carrying `IsFavorite` is
  read for it; one that is the whole album again — known by its `AlbumId`, which never changes, so
  no update of a field carries it — without `IsFavorite` is a sparse struct, so no one's favourite,
  and the graph's merged copy drops the `IsFavorite` it held. Any other update (a rename) says
  nothing of the favourite, and a read lays its fields over the album known. A favourite pushed
  while a read runs is the later word, laid over that read's result.
- **Hearts and pushes.** A heart is awaited from before its call (the server may push the album
  ahead of its answer) until its call fails or is not answered, a push shows it (confirmed, not
  counted as changed elsewhere), or the next read. A push showing otherwise while the heart is
  still unanswered is from before it, and changes nothing; once answered, it was changed elsewhere
  since, and the heart is no longer Rouen's to check.
- **What the page shows** is what the library read found (each album's `IsFavorite` for the
  profile, §8.4, kept on its record), plus the hearts Rouen has set since, and favourites the server
  pushes as they change (**Changed elsewhere**, above); one the server does not push shows after the
  next read of the library (at connection, after a library change, on Rescan). An album view open
  and shown asks for its heart again every 2 s (v1.9.29, the owner: a heart changed in Roon showed
  only once the view was opened again), a look-up in what Rouen holds, nothing sent to the server;
  an answer asked for before a tap, or while a tap is on its way, is not painted over it. An `IsFavorite` left out of an album is "not a favourite" (a sparse struct
  leaves its default out, as a Count of 0 is); one that is there but cannot be read is no answer,
  and that album offers no heart.
- **An album heart** is believed on the call's "Success" — the album objects are dropped from the
  session once read, so no update of one is expected — and checked at the next library read, which
  must show it. A refusal, or a read that shows otherwise, turns album hearts off for the rest of
  the connection, with the reason in Settings → Native mode; the next connection tries again.
- **A track heart** needs the tracks themselves, which the album view still takes from the official
  API (N5 moves them): a track query filtered by the album's title and artist
  (`AlbumTitleTextFilter`, `AlbumPerformedByTextFilter`), one page held, the tracks kept whose
  Album is this album's object on the connection (v1.9.28: the album object itself was sent, and let
  go, by the library read, and is not sent again; its id is kept on the album's record), tracks named
  by the page's rows counted with those sent. They must be **the same titles as the album view's, whatever
  their order** (the query's order is not the album's), and a picked title must be unique on the
  album; otherwise that album's track hearts are refused, with why, and nothing is sent. Each track
  is hearted by its session object while the page is held, and believed when the Core pushes the
  track again showing it (its `IsFavorite` cleared first, so an update that leaves it out reads as
  "not a favourite"). A refusal, or no such update within 5 s, turns track hearts off for the
  connection, as above. The page is released and the query disposed whatever happens, and what it
  brought is let go from the graph.
- **One at a time:** a heart and a library read each watch what the Core pushes on the one session;
  they take turns (`stage1.js`), so a heart waits for a read running, and the next read for it.
- **Not written** on a connection with a call left unanswered (the link is about to replace it).

Add to library (N2b) sends no answer at all, so it will be believed only when the album appears in
the library's next read (§3.2): until then the button says "Added — waiting for your server", as
Smart Picks' does today for a service favourite.

### 8.4 The profile, and reads before writes

Hearts belong to a Roon profile (`roon-native.md` §8.4, the owner, 2026-10-12: the profile chosen in
Settings). Settings → Native mode lists the server's profiles by name when it has more than one;
the chosen one is kept, the library is read again for it (its favourites are that profile's), and
hearts wait until one is chosen. With one profile, that one.

**Reads before writes** (`roon-native.md` §3): `IsFavorite` is read for the first time in the same
build as the first write. So hearts are **off until turned on** in Settings → Native mode, which
first shows how many albums the read found hearted for the profile, for the owner to check against
the server's own before any heart is written.

### 8.5 How it is built

*As built in v1.9.27 (the plan here named `lib/provider/native/marks.js`, `lib/routes/marks.js` and
`public/hearts.js`; changed in the build so that neither `index.js` nor `style.css`, both over 850
lines, had to be touched):* `lib/roon-direct/marks.js` (the calls, the read-back, the fallback, per
kind and per connection), made by `stage1.js` on the list it has read and the link it reads over;
`lib/roon-direct/profile-data.js` (the `ProfileData<bool>` reader); the routes in
`lib/roon-direct/route.js` beside native mode's own (guarded, as every `/api/` request is since v1.9.26); and
`public/album-actions.js` — the album view's action row moved out of `public/app.js` with the heart
added, its styles in the page's body, and the selection menu's items moved out of `index.html` with
"Add to favourites" and "Remove from favourites" added. The fake server learns `FavoriteOrBan`
(`test/lib/fake-roon-hearts.js`), reading what is sent strictly, and pushes a track's update but not
an album's, as §8.3 expects of the real one. Settings → Native mode says when a kind of heart fell
back, and why, and how many were sent.

### 8.6 Questions for the owner

**Answered 2026-10-14:** where the hearts go (§8.1: the album view's row, left of Play Now; tracks
through long-press and the selection menu; not Now playing). Hearts first, add to library after
(N2a, N2b), as recommended, the owner not objecting. The profile: settled already by the owner's
2026-10-12 decision (`roon-native.md` §8.4), so the picker is built (§8.4); an earlier draft of this
section took "the first profile" instead, which was not the recommendation and was corrected in the
review before release.

## 9. N2b — add to library (the owner's answers, 2026-10-14)

"Adding a TIDAL or Qobuz album in Rouen adds it to Roon directly, not via the streaming service and
then into Roon" (`roon-native.md` §1). Today Rouen's "+ Add" (Smart Picks and Listen Later on Home)
favourites the album on the service with Rouen's own sign-in, and waits for Roon to import it.

**The owner's answers (2026-10-14):**
1. **Two steps.** Neither call is proven: upstream ran `UnifiedSearch` live only on albums already
   in the library, and lists `Library::AddToLibrary` among its "presumed" call sites (neither
   captured from Roon's app nor probed live). So first a build that only searches (N2b-1, §9.1),
   run on the owner's server; then, with what it shows, the add (N2b-2, §9.2).
2. **The fallback is today's way:** native mode off or the add failing, "+ Add" favourites the album
   on the service as now.
3. **Where:** where "+ Add" is today — Smart Picks and Listen Later. Elsewhere later, with search (N6).

### 9.1 N2b-1 — Roon's own search, read-only (v1.9.32)

**What the owner sees:** Settings → Native mode → "Add to library — check", a button: "Check now"
(v1.9.35: the longer "Check your server can find your picks" was cut off at both ends on a phone,
an action button never wrapping; the row's own label says what is checked). It takes the Smart Picks and
Listen Later albums that are on TIDAL or Qobuz and not in the library (no `offset`), at most 20 (the
limit and the services are the server's, given to the page with the check's progress: one source),
asks the server's own search for each in turn, and lists what came back as it comes: found on that
service (the album Roon would add), already in the library, found only on another source, or not
found, with the albums it did find for that last case. Nothing is written; nothing runs unless the
button is pressed. With nothing to ask, it says how many albums it looked at, how many of them are
in the library, and how many aren't on a service it takes (v1.9.35: a bare "nothing to check"
couldn't be told from a misread list).

**The check runs on Rouen (v1.9.33, the review):** `POST /api/roon-direct/find` begins it and answers
at once; `GET /api/roon-direct/find` gives the last check begun as far as it has got (running, its
findings so far, an error if it stopped), and the page follows it once a second. Twenty searches in
one request outlived a proxy's timeout, and a lost answer read as "nothing was checked" while the
check ran on. Pressed again while one runs, the page follows that one; a reply that is not the
check (a login page, a proxy's error) says the check may still be running, never that none ran.

**The call:** `Library::UnifiedSearch(SearchParameters, ResultCallback<UnifiedSearchResults>)` on the
link's session, `SearchParameters` an inline struct of ProfileId (the profile chosen, §8.4), Terms
("title artist"), MaxCount 20, MaxTopResultCount 10 — the members upstream's client sends. The
answer is a reference to a `UnifiedSearchResults` object the server pushes, walked as upstream walks
it, for albums only: its top results (`TopSearchResult`, an inline struct: `Album`, `LibraryAlbum`),
`TopAlbum`, `TopLibraryAlbum` and `Albums` (lists, and `AlbumLiteVersions` objects holding albums).
An album reached through a `Library…` member is in the library. Then
`UnifiedSearchResults::Dispose()`, sent without waiting, once (catalogue only, as the queries'
`Dispose` is proven): nothing is left held in the server.

**Sent once a connection (§4):** an album the library read was sent and let go comes back from the
search as a bare reference, never sent again — or as a later push of one field (a favourite), which
puts that field alone back in the graph. Either way it is taken from what the connection has been
sent (`stage1.js`'s record of the server's word), which is also how it is known to be in the
library, with whatever the graph holds of it since laid over it (a title pushed alone is the
server's later word, as `albums.js` lays a push over a known album). So no check begins, and no
search runs, on a connection whose library has not been read whole on it (after the nightly
reconnect, a change of profile, or a read there that failed, which records what it saw): there a
library album sent in full could not be told from the catalogue's. An album in the graph that was
not sent whole (`albums.js` `sentWhole`) and is not known is waited for, not read as an album with
no title.

Everything else the search sends is **kept** in the graph; only the result object itself is let go.
Were an album let go, and later added to the library, the next library read would be given its row
alone and come short; were an album's `AlbumLiteVersions` let go, the next search naming it would
have it by reference only, and wait for ever. The cost: what a search sends and the walk never
reaches (artists, tracks, works and their lists) stays until the connection closes. The check logs
the graph's size after each run, to read against its cap (200,000 objects), and no check begins
once fewer than 25,000 objects of room are left (`find.js` `noRoom`): a graph at its cap fails the
next library read. (v1.9.33 to v1.9.36 refused past half the cap, set without a real library's
numbers: on the owner's server a fresh read of 12,962 albums leaves 101,006, so nothing could run.) How much a
search sends on a real server is not known yet; that log line is how it will be. (An album taken
out of the library since the last read on the connection, and named by a search, is known neither
from the read nor from the graph, and its result reads "incomplete" until the next connection: an
honest answer, at the cost of a second record of what was sent.)

**When it has all arrived:** the result object pushed with its fields (`objects.js` `loaded` — a
search that finds nothing may leave every member out, as a sparse struct leaves out a default, and
is "not found", not waited on; an object of a type never declared is not loaded), every list and
versions object it names likewise (a list cut short, or a query with fewer items than its count, is
waited on), and every album in it sent whole or known. A result still missing pieces after 4 s is reported as such, with what
had arrived.

**One at a time:** each search takes its turn with reads and hearts (`stage1.js` `inTurn`), and one
check runs at a time. Native mode off, not connected, or the connection being checked: no search.

**What it is matched by:** the album's title and artist, as hearts match (`keyOf`); "found on TIDAL"
means an album of that title and artist whose `ContentSource` is TIDAL's (128; Qobuz 256) and that
carries an `AlbumId` — what an add would name it by. A catalogue album's credit comes with each artist as a link,
`[[4707962|June McDoom]]` (the owner's server, v1.9.36's probes); it is read as the names alone
(`find.js` `plainCredit`, v1.9.38) before it is matched or shown — v1.9.32 to v1.9.37 compared the
linked form, and could never have found a catalogue album.

### 9.2 N2b-2 — the add (the owner's answers, 2026-10-21; v1.9.41)

§9.1's check found nothing to ask about on the owner's server (Rouen's own lists held library albums
only), so the search has never been run on a catalogue album there. **The owner's answers:**

1. **One build**, the search first and then the add: the owner waives "reads before writes"
   (`roon-native.md` §3) for `AddToLibrary` alone, the search being proven on library albums and the
   add sending nothing back. An add is believed only once the album shows in the library.
2. **Native mode on: Roon's own add** (Roon then keeps the service's favourites in step itself).
   **Native mode off: today's way**, the service favourite with Rouen's own sign-in, which Roon
   imports later. An add that native mode cannot send (below) falls back to today's way too (§9's
   answer 2), and says why.
3. **Where:** the TIDAL and Qobuz album pages (§10.3), and the "+ Add" of Smart Picks and Listen
   Later on Home.

**What the user sees.** A TIDAL or Qobuz album page for an album not in the library offers
"＋ Add to library" where one in it says "In your library — open it there". Tapped, it shows "…",
then "Added — waiting for your server" (native) or "Added to TIDAL favourites — waiting for Roon"
(today's way, the toast saying why when native mode was on), and turns into "In your library —
open it there" once the album is in the library, opening it under Roon's own title and credit for
it (the album view checks an album's identity by them, and an edition named otherwise is refused).
A native add that has not shown after 3 minutes says "Not in your library yet — your server may not
have taken it", and can be tapped again. An album your server's search finds already in the
library, where Rouen's copy can't yet say where, says "Already in your library", nothing sent.
Smart Picks and Listen Later keep their buttons ("＋ Add", "✓ Added — waiting for Roon", "▶ Play"),
now through the same call: a native add shows "✓ Added — waiting for your server" and becomes
"▶ Play" once the album is in the library.

**How it adds, native mode on** (`lib/roon-direct/adder.js`), in its turn with reads, hearts and
searches (`stage1.js` `inTurn`):
1. Roon's own search (§9.1's call and walk, `find.js` `locate`) for "title artist".
2. The album to add: of the search's albums with the same title and artist (`keyOf`), one already in
   the library means "already in your library", and nothing is sent; else those on the service
   asked (ContentSource 128 TIDAL, 256 Qobuz) with an `AlbumId`, the first in the order the search
   gives them (its top results first, as Roon's own app shows them). None: not sent (below).
3. `Library::AddToLibrary(Profile, IEnumerable<AlbumBase>)`: the Profile chosen in Settings →
   Native mode by its object (a server with several profiles and none chosen: not sent, as hearts
   wait for one, §8.4), as `GetListenLater` takes it (proven, §10.2); the album as hearts'
   album form names one, an inline `AlbumLink { AlbumId, Broker }` in a length-prefixed collection —
   the form upstream matched byte for byte to Roon's own app for an `IEnumerable<AlbumBase>` (§8.2);
   the search's session object is not used, the single-object form having been found ignored for
   hearts. Sent without waiting: the call has no callback, and the server sends nothing back. A
   connection closed before it could be sent is "not sent", never "waiting".
4. Believed when the album is in Rouen's library, the official API's that every Play opens (the
   library watch follows it); the page asks `GET /api/library/add` every 3 s while it waits. Not
   there after 3 minutes: "not taken", logged, and nothing else is done — no service favourite
   after a call that may yet take. Kept in memory only: after a restart, "+ Add" shows again, and a
   second add of an album since imported finds it in the library and sends nothing.

**Not sent, today's way instead** (the answer saying why, except for native mode off, which needs no
explaining): native mode off (whatever its state: on but checking after an update, or not yet read,
is native mode on, and says why), not connected, the connection being checked, the search not
answered, no profile chosen among several, the library not yet read on this connection (a library album could not
be told from the catalogue's, §9.1), too little room left in the graph (`find.js` `noRoom`), the
search refused or not all arrived, the album not found on that service, or found with no
`AlbumId`. Today's way needs the service's album id: a Smart Pick's or Listen Later entry's own,
else found by Rouen's own search of that service by title and artist (`albumsearch.js`
`pickAlbumId`, with the candidates built as the waveform's Qobuz lookup builds them — `candidatesOf`,
one builder for both); Rouen not signed in to that service, or its search not finding the album, is
an error naming both reasons. A service favourite made after a native add was not taken takes over
from it: the old "not taken" is no longer said.

**The routes** (`lib/library-add.js`): `POST /api/library/add {title, artist, service, album_id?}`
→ `{ok, via: "roon" | "service", state, why?}`; `GET /api/library/add?title=&artist=` →
`{state: "in-library" | "waiting" | "not-taken" | "none", offset?}`. The service favourite routes
(`/api/qobuz/favorite` and `/unfavorite`, `/api/tidal/…`) move out of `index.js` into
`lib/routes/service-favourites.js` unchanged (`dev/quality.md` order, step 5), and the Home
buttons' code out of `public/app.js` into `public/album-actions.js` (`RouenLibraryAdd`), shared with the album
pages.

## 10. N2c — Roon's streaming services and its Listen Later, read first (the owner, 2026-10-21)

The owner, after the check (§9.1) found nothing to ask about — Rouen's own Listen Later holds only
library albums, and the TIDAL and Qobuz albums they had put on Listen Later were on **Roon's**:

> Rouen is to become a native roon remote. Every function must be the same. […] I should be able
> to browse Qobuz or Tidal libraries even if those albums are not in my roon library and I should
> be able to add them to my library which is a different thing than adding an album as a favorite.
> Adding a album in my library or not to listen later should show in the Roon remote app listen
> later and this applies to playlist etc.

So: TIDAL and Qobuz are browsed through Roon, whatever is in the library; "add to library" is
Roon's own (§9.2), not a service favourite; Listen Later is Roon's own list, shared with Roon's
apps (`roon-native.md` §8, decision 3, which this brings forward), library album or not; and
playlists after. The order the owner agreed: **N2c-0** this read-only probe; **N2c-1** browsing
TIDAL and Qobuz in Rouen; **N2b-2** the add; **N2c-1b** a native search of TIDAL and Qobuz (§10.3);
**N2c-2** Roon's Listen Later in place of Rouen's own
(what becomes of the albums on Rouen's own list is asked when it is built); then playlists.

### 10.1 N2c-0 — the probe (v1.9.36), read only, run by hand

Two halves, each a URL that does nothing without `?run=1`, answers with names, counts and hints —
never protocol bytes — and runs one at a time.

**`GET /api/debug/streaming-browse?run=1` — what Roon's official browse offers for TIDAL and
Qobuz** (`lib/streaming-browse-probe.js`, mounted with the other browse diagnostics). The official
API's browse root lists each service Roon is signed in to (Rouen already reads it to know which,
`probeRoonServices`). For each of TIDAL and Qobuz found there, a walk on its own browse session:
each level's first 25 items (title, subtitle, hint), up to 3 levels below the service, at most 8,
3 and 2 lists opened on a level at the first, second and third, depth first (so pages are met
before the budget runs out), going back up a level with `pop_levels` after each, 400 browse and load
calls a service in all. A page that opens with a menu — its first item an `action_list` named
"Play …" ("Play Album", "Play Artist", "Play Playlist"; the English the browse API answers in) — has
that menu opened and its actions listed, the question being which an extension is offered there
("Add to Library", "Listen Later", …): at most 2 menus of each name, 6 a service. A list that fails
to open is recorded and the walk goes on; three in a row (a Core gone quiet) stop that service's
walk, as does a failure to get back to a level, rather than each path waiting out its own deadline. **Safety, the probe's one rule:** in Roon's browse API, opening an item whose hint
is `action` carries it out (plays, queues, adds). The walk opens only items whose hint is `list` or
`action_list` (which opens a menu, carrying nothing out), never `action` and never `input` (a search
prompt); and no zone is given, so nothing could play even by mistake. Each item is found afresh on
its level by title, paged through as `findItemByTitle` pages (the browse API's item keys belong to the
load that gave them; the probe keeps its own lookup so every call counts against its budget).

**`GET /api/debug/roon-listen-later?run=1` — Roon's own Listen Later**, over native mode's
connection, for the profile chosen in Settings → Native mode (`lib/roon-direct/listen-later.js`):
`Library::GetListenLater(Profile, IList<string>, ResultCallback<DataList<ListenLaterItem>>)`, the
catalogue's string — never run by upstream's client nor captured from Roon's app, so how its second
argument is read is this design's: a by-reference argument (the Profile object, as a track's object
is sent to `FavoriteOrBan`) and a collection argument framed as hearts' album list is (length, count,
items), each item a string. It is sent first with an empty list (the languages Roon would translate
names into: none is no change); refused, it is sent once more with `["en"]`, and each status is
reported. The answer, expected as a reference to a pushed `DataList<ListenLaterItem>`, is walked as
the search's is (§9.1: waited for up to 4 s, its albums sent whole, or known from the library read on
the same connection with anything pushed of them since laid over — so, like the check, it runs only
once the library has been read on it, and not once fewer than 25,000 objects of room are left). Everything it sends is
kept, the list too: named again on the same connection it would come as a bare reference. Each
item: its `DataType`, `State`, `Timestamp` (as .NET ticks, the top two bits read as `ToBinary`'s
kind should the server write it that way), `Text`, and what it names — an album's title, artist,
source and whether it is in the library; a track's title; an artist's name. The list's own count
and how many items arrived are both given. An answer of another
shape is described (not a reference; how long), not decoded. It takes its turn with reads, hearts
and checks (`inTurn`). Nothing is written: `SetListenLaterState` waits for N2c-2.

Expected on the owner's server: the TIDAL album and the Qobuz album they put on Roon's Listen Later
on 2026-10-21, neither in the library.

### 10.2 What the owner's server showed (2026-10-21)

**Browse (v1.9.36):** TIDAL (What's New, TIDAL Rising, Playlists, Genres, Your Favorites) and Qobuz
(New Releases, Playlists, Taste of Qobuz, My Qobuz) are both on the official browse root and walk as
Roon's own app shows them, albums in the library or not; an album's subtitle is its credit with each
artist a link (`[[id|Name]]`). **No menu offers "Add to Library" or Listen Later to an extension**:
an album's "Play Album" holds Play Now, Add Next, Queue and Start Radio; a playlist's adds Shuffle; an
artist's holds Shuffle and Start Radio. So browsing and playing TIDAL and Qobuz can be built on the
official API (N2c-1); adding to the library (N2b-2) and Listen Later (N2c-2) need Roon's own methods.

**Listen Later (v1.9.37; v1.9.36's room rule refused it, §9.1):** `GetListenLater` answered
"Success" at the first form, with no languages, and a `DataList<ListenLaterItem>` of the three albums
the owner had put on Roon's Listen Later that morning — a TIDAL album and a Qobuz album not in the
library, and a Qobuz album in it — each as an inline item: `DataType` "album", `State` 1, its
`Timestamp` (plain UTC ticks) and its `Album`. Reading Roon's Listen Later is proven.


### 10.3 N2c-1 — TIDAL and Qobuz in Rouen, through Roon (the owner's answers, 2026-10-21)

**The owner's answers:** each service keeps its own entry in the side menu, the one there today;
each opens **Roon's** sections for it (§10.2's tree), with **Rouen's search box kept** at the top,
since Roon's TIDAL and Qobuz sections carry no search of their own; it is there **whether native
mode is on or not** (browsing and playing are the official API's); Rouen's own service browsers'
♥ Favourite goes once Add to library (N2b-2) and Roon's Listen Later (N2c-2) arrive — until then
those browsers stay as global search's TIDAL and Qobuz sections open them.

**What the user sees.** TIDAL (or Qobuz) in the side menu opens a screen titled with the service:
a search box, then the service's sections as Roon names them (What's New, TIDAL Rising, Genres, Your
Favorites; New Releases, Taste of Qobuz, My Qobuz …). A section opens its level: lists as rows, and
albums and playlists as tiles with Roon's covers (`/api/image/<image_key>`), in the order Roon gives
them, sixty at a time with More for the rest; the screen's Back goes up a level, and at the top level the top bar's Back goes Home as on
every screen. An album or a playlist opens a page: its cover, title and credit (read as names, §9.1), the
action row Rouen's album view has (Play Now and Queue on the row; Play Next, Shuffle, Radio behind ⋯
— whichever Roon's menu holds), and its tracks, each played by a tap; an artist's page shows the
lists it holds beside its menu (Albums, Singles …), as a level does. A page reads up to 500 items
and says how many there are past that. An album that is in the library (by its exact title and
credit first, as Listen later matches, so another edition is not opened in its place) says so, and
opens Rouen's own album view from there. The search box asks Roon's own search
(the official API's `search` hierarchy, with the zone, as the album open's fallback already does) and
shows its sections the same way, read in the zone chosen so that a play from it walks the very
results shown; whether Roon's search answers with TIDAL and Qobuz albums as well as
the library's is tried, not trusted (§3.3): the screen shows whatever Roon answers, and the owner's
report decides the next step.

**Search: the owner's answer (2026-10-21, after v1.9.39).** Through the official API, Roon's
search is Roon's whole search, the library's copy of an album first: on the TIDAL screen, "Iron
maiden" listed the library's albums, and one the owner holds through Qobuz opened as the library's,
not TIDAL's. Roon offers extensions no search of a service's own, and no way to the TIDAL copy of
an album in the library. The owner chose a **native search**: with native mode on, Roon's own
search (`UnifiedSearch`, §9.1, proven on the owner's server) gives the screen's service's albums
alone, those in the library included. Opening one needs Roon's own album page (its tracks, its
play), never run, so a read-only probe comes first (**N2c-1b**, after N2b-2), run on the owner's
server as N2c-0 was. Until then the search box stays the official API's.

**Not changed in N2c-1.** The two side-menu entries still show only while Rouen's own TIDAL or
Qobuz sign-in is connected (`app.js` `loadTidalStatus`, `loadQobuzStatus`), as they did before;
browsing through Roon does not need that sign-in, so whether they should show whenever Roon offers
the service is the owner's to decide, and is asked with this build.

**How it is built.**
- *Where a page is.* An item's key belongs to the load that gave it, so a page is named by the path
  of titles from the browse root (`["TIDAL", "What's New", "Albums", "New", "Dopamine Chamber"]`),
  each step with its position on its level, to tell two items of one title apart: walked from the
  root on every request, as the album open walks to an offset (`index.js` `loadAlbumSession`), the
  position tried first and the title the proof. A search's path starts from its terms.
- *A level of one album* (v1.9.40, the owner: an album found by Roon's search opened a level
  holding that album alone, so its tracks took a second tap): a level whose only item is a list
  named as the level is entered at once, and the answer says the step taken (`entered`). The
  screen adds the step to its path, so its plays walk it, and Back goes up past that level too.
- *Server* (`lib/provider/public/streaming.js`, the official API's code, beside the album open):
  `GET /api/streaming/level?service=&path=&offset=&count=` (a level's items, or a page's actions and
  tracks, with whether the album is in the library), `POST /api/streaming/play` and
  `/api/streaming/play-track` (`{service, q?, path, kind, zone_or_output_id}`, a track also with its
`pos` and `title` on the level or page that lists it, the title the proof), walking with the
  zone on every step, as the playlists do, then choosing from the page's menu exactly as the album
  view does (`album-open.js` `drillActionMenu`, `matchAction`). A page is a level whose first item
  is an `action_list` named "Play …" with no credit, the album view's own rule: a track is an
  `action_list` too, and carries its artist. A play is sent once: the button or row tapped is busy
  until Roon has answered. Only `action` items named by the
  kind asked for are ever carried out; a level is never opened past a page.
- *Client* (`public/streaming.js`, its own script): the screen enters the grid through
  `RouenHost.enterFullWall` and draws there; an answer that lands after the grid has gone to another
  screen draws nothing. The side menu's two entries open it by their `data-target` (two hidden
  buttons the script makes), so `app.js` gains no logic; the action row is `album-actions.js`'s.
- *The monoliths* (`CLAUDE.md`): `index.js` mounts the module, so the official API's browse
  primitives (`browse`, `load`, the session pool) move out of it into `lib/provider/public/`
  unchanged; `index.html` gains the script tag and the two entries' targets, so markup moves out of
  it to its owning script; both baselines ratchet.
