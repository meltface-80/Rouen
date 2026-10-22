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
   gives them (its top results first, as Roon's own app shows them); **no copy there at all, the
   other service's**, by the same rule (`find.js` `pickCopy`, one rule with §9.1's check), the
   button and the toast saying which ("Added from Qobuz — waiting for your server"). The owner's
   answer (2026-10-21), after "Hippies, Thugs and Heroes" on a TIDAL page was refused as "found, but
   not on TIDAL". Why that copy wasn't TIDAL's is not known: the refusal didn't say where the search
   found it (Qobuz, or a source the server didn't name); it says now (v1.9.44). A copy on the service
   asked without an `AlbumId` is not passed over for the other's. Neither: not sent (below).
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
search refused or not all arrived, the album found on neither TIDAL nor Qobuz, or found there with
no `AlbumId` — said with where the search did find it (v1.9.44). Today's way needs the service's album id: a Smart Pick's or Listen Later entry's own,
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
TIDAL and Qobuz in Rouen; **N2b-2** the add; **N2d** playlists made in Rouen, in Roon (§11, the owner
brought it forward, 2026-10-21); **N2c-1b** a native search of TIDAL and Qobuz (§10.3); **N2c-2** Roon's
Listen Later in place of Rouen's own (§10.4, the owner's answers, 2026-10-21); then playlists.

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

**The side menu's entries (the owner, after v1.9.42: "I want native access without additional
logging in to Rouen TIDAL and Qobuz").** Each shows when your server's browse root offers that
service (`GET /api/streaming/services`, asked at load and every 30 s until your server answers),
whatever Rouen's own TIDAL or Qobuz sign-in: browsing and playing them is your server's. N2c-1 had
kept them shown only while Rouen was signed in (`app.js` `loadTidalStatus`, `loadQobuzStatus`), as
before it; that gate goes. Rouen's own service browsers (the top bar's buttons, global search's
TIDAL and Qobuz sections) keep it: they talk to the services with Rouen's sign-in.

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

### 10.4 N2c-2 — Roon's Listen Later in place of Rouen's own (the owner's answers, 2026-10-21; v1.9.45)

The owner, after v1.9.44: "Adding stuff to Roon listen later still doesn't appear in Rouen. Adding
stuff to Rouen listen later doesn't appear in Roon."

**The owner's answers (2026-10-21):**
1. **One build.** Native mode on: Listen Later is Roon's own list, read and changed by your server.
   Each add or removal is believed once `GetListenLater` shows it. Today's way, Rouen's own list,
   applies when native mode is off or the change can't be sent.
2. **The albums on Rouen's own list move onto Roon's by themselves** (the owner, after v1.9.45's
   one-time copy worked: "As it works it can be made an automatic feature"; then "Move it", and a
   status line in place of the button; v1.9.47). Each album is found as an add finds it (below) and
   leaves Rouen's list once Roon's shows it; the ones Roon can't take stay, are listed in Settings →
   Native mode (the page names Roon in its notice only), and are tried again on the next connection.
   v1.9.45 had copied them once, by a button, and kept Rouen's list unused until native mode was off.
3. **Smart Picks sent to Listen Later** (Settings → Setup → Smart Picks) go to Roon's list.

**What the user sees.** With native mode on and Roon's list read on this connection, every place that
shows Listen Later shows Roon's list: the Home row, the Listen later screen, the album view's ⋯
("Listen later" / "Remove from Listen later") and a Smart Pick's "✓ Listen later". Albums in the
library open as today. The others show the cover your server sends, "Not in your library yet — on
TIDAL" (or Qobuz), and Add to library (§9.2). The list is Roon's order, newest first. Only albums are
shown (Rouen's list never held tracks or artists). An item is on the list while its `State` is
Pending (1): the three items the owner's server showed (§10.2) all were. A change made in Roon's app
shows in Rouen the next time the list is read: it is read again when it is asked for and the last
read is over 20 s old; every 20 s while Listen later is looked at (for 10 minutes after any device
asked for the list, each open app's live poll has it read once it is over 20 s old, one try in 20 s
whatever its outcome; v1.9.48: the owner saw a removal made in Roon only once they left the screen
and came back); and every 5 minutes while native mode is on. Each read's list stays in the graph, as
§10.1 keeps it (named again on the connection, it would come as a bare reference): one object a read,
the items being inline (§10.2), so at most three a minute while Listen later is looked at — well within
the 25,000 kept free, and the nightly reconnect starts afresh. Letting it go was tried and taken out
before it shipped (the review): a list the server named again after another would never arrive. When the read finds a different
list, every open screen follows it, as it does a change made on another device. A read that fails for now (a
read already running, the connection being checked) keeps this connection's last list in place rather
than swapping in Rouen's own and back. A list read on another connection says nothing until the list
is read on this one: Rouen's own list answers meanwhile. Smart Picks' puts run alongside the build and
are waited for once, after it.

While Roon's list is in force, Rouen's own list is not shown, and changes only by the move (answer 2)
and by a change Roon's couldn't take (below). Its play-through tidy-up, and Smart Picks' "Not for me" and a discarded day's picks, keep acting on
it as before. **Nothing in this build takes an album off Roon's list but a removal asked for by
hand**: a discarded day or "Not for me" never writes to your library.

**The call** (the catalogue's string, never run upstream nor captured):
`Library::SetListenLaterState(System.Sooid, IEnumerable<AlbumBase>, ListenLaterState, ResultCallback)`.
Its arguments are those of `FavoriteOrBan`'s album form, which is proven (§8): the profile's id (the
one chosen in Settings → Native mode), a collection of inline `AlbumLink { AlbumId, Broker }`, then
the state, an enum. `ListenLaterState` is None 0, Pending 1, Played 2. An add sends Pending. A removal
sends None. Whether Roon's own app takes an album off by None or by Played was never captured, so
this is tried, not trusted (§3.3): it is believed only when the list no longer shows the album.

**Which album is named.** An add looks in the library read on this connection first, by title and
artist as hearts do (§8), for the album's `AlbumId`. Failing that it asks Roon's own search (§9.1) as
an add to the library does (§9.2): an album the search has in the library is named by that copy's
id. Otherwise the copy on the service asked for is named, else the other service's (`find.js`
`pickCopy`). A removal names the album by the id Roon's list gave it. Rouen's own album key (albumKeys: a title's ASCII letters and digits) is needed only by today's way.
An album whose title has none ("+", "÷", "Кино"; v1.9.49) goes on Roon's list, which names it by its
`AlbumId`; where that key is empty, the search's albums, Roon's list and the library are compared by
the title and credit as written, case and spacing aside (`find.js` `asWritten`, `lib/library-exact.js`).
Only Rouen's own list refuses such a title, saying so.

**Believed, and today's way.** A change is believed when the call answers "Success" **and** Roon's
list, read again every second for up to 10 s, shows it: an add when the list holds that `AlbumId`
as Pending, a removal when it no longer does.
- **Not sent** (native mode off, not connected, being checked, the library not read on this
  connection, a profile to choose, the album not found, the call refused): today's way, Rouen's own
  list. When Roon's list is in force, the page says why and that the album went on Rouen's own list,
  shown while native mode is off. Native mode off: nothing is said.
- **Sent and not shown in time**: said plainly ("Your server took it, but its Listen Later didn't
  show it"). Nothing goes on Rouen's list: the change may yet take, and two lists would then disagree.
- A removal of an album not on Roon's list sends nothing and answers that it is off.

**The move (v1.9.47).** Once a connection, when Roon's list has first been read on it (by any screen
asking, or the 5-minute re-read) and Rouen's own list may change (not while Rouen restarts after a
restore): each album on Rouen's own list that Roon's already holds leaves Rouen's list; each other is
found and sent as an add is, and one read at the end, waited for up to 10 s, says which took — those
leave Rouen's list, and the rest stay with why (not found, refused, sent and not shown). One move
runs at a time. On every read of Roon's list, any album still on Rouen's own that Roon's now holds
leaves Rouen's (one shown only after its move gave up, or put on by hand), and a removal through
Rouen takes it off both, so an album taken off Roon's list is never put back by a later move. A move
refused because one is still running, or one that couldn't read Roon's list, is tried again on the
same connection. **Settings → Native mode → "Rouen's Listen later on your server"** is a status line,
no button: moving (how far), everything on your server's list, or how many albums are left on Rouen's
own list with each one's why, tried again each time Rouen connects.

**How it is built.**
- `lib/roon-direct/later.js`: the list (cached), the add and removal, the move. It takes its turn with
  reads, hearts and searches (`stage1.js` `inTurn`), and none of it begins once fewer than 25,000
  objects of room are left (`find.js` `noRoom`).
- `lib/roon-direct/listen-later.js`, the reader (§10.1): it now gives each album's `AlbumId` and cover,
  and reads up to 1,000 items for the list (the probe keeps 100).
- `lib/routes/listen-later.js`: `GET`/`POST /api/listen-later` move out of `index.js` with their JSON,
  and choose Roon's list or Rouen's; the move starts there, and `GET /api/roon-later/move` says how it
  stands (v1.9.47; `POST`/`GET /api/roon-later/copy` before it).
- The client keeps its routes; `setListenLater` moves out of `public/app.js` into
  `public/album-actions.js` (`RouenListenLater.set`) to say the "kept on Rouen's list" answer.
- The Settings block is `public/roon-settings.js`'s.
- The fake server learns `SetListenLaterState` and reads it strictly.

### 10.5 What the owner's server showed (2026-10-21, v1.9.45)

**"The listen later copy worked both ways"** (the owner): Settings → Native mode → "Copy Rouen's
Listen later to your server" put Rouen's albums on Roon's own Listen Later, and Rouen's Listen later
screen shows Roon's list, albums put there in Roon's app included. Proven: `SetListenLaterState`'s
album form as §10.4 sends it (the profile's id, inline `AlbumLink`s, Pending 1), believed by
`GetListenLater` showing it. Then (the owner, the same evening, v1.9.46): "Removing a listen later
album on Rouen that originally was added in Roon removed it automatically from Roon as well" —
the removal (None 0) is proven too; and one removed in Roon's app left Rouen's screen "only once I
moved away from listen later in Rouen and returned to that screen", which v1.9.48's 20-second read
while Listen later is looked at answers.

## 11. N2d — playlists made in Rouen, in Roon itself (the owner's answers, 2026-10-21; v1.9.42)

The owner, after v1.9.41: "Playlists created on Roon appear in Rouen. Doesn't work the other way."
Roon's playlists reach Rouen through the official API (read and play, `/api/playlists`); the ones
made in Rouen are Rouen's own (`/api/user-playlists`, stored on its volume), because the official
API has no playlist write of any kind. Roon's own protocol has a `Playlists` service that does.

**The owner's answers (2026-10-21):**
1. **Native mode on: Roon's own playlists.** New playlist, Add to playlist, Rename and Delete act on
   Roon's playlists, so they show in Roon's apps, and Roon's in Rouen as before. Native mode off:
   Rouen's own playlists, as today.
2. **The playlists already made in Rouen are copied into Roon once**, by "Copy Rouen's playlists to
   your server" in Settings → Native mode (the page names Roon in its notice only, v1.9.23): each a Roon playlist of the same name and tracks, the tracks
   Roon can't find listed; Rouen's copies stay until deleted.
3. **Next**, after v1.9.41: before the native TIDAL/Qobuz search (N2c-1b) and Roon's Listen Later
   (N2c-2).
4. **One build**, as N2b-2: no call is proven, and each change is believed only once Roon's own
   playlist list (the official API's, which Rouen already reads) shows it. What it doesn't show is
   said plainly, and tracks it didn't take go to Rouen's own playlist of that name instead.

### 11.1 What the user sees

- **Add to playlist** (a selection's tracks, or albums), with native mode on and Roon's playlists
  readable: "＋ New playlist…" makes one in Roon; the rows are Roon's playlists that can be changed
  (not read-only), each with its track count. Native mode off, or Roon's playlists not readable (the
  toast says why): the sheet as today, Rouen's own.
- **A Roon playlist's page**: its ⋯ gains Rename and Delete when native mode can change it.
- **The Playlists screen**: Rouen's own playlists still lead; with native mode on each says "In
  Rouen only", so the ones not in Roon can be told apart.
- **Settings → Native mode → "Copy Rouen's playlists to your server"**: each of Rouen's playlists made in
  Roon with its tracks; reported per playlist ("12 of 14 tracks"; the ones not found named). A
  playlist whose name Roon already has is not touched, and said. Rouen's own copies stay.

### 11.2 The calls (`Playlists` service; the catalogue's strings, never run upstream nor captured)

The `Playlists` object is the Library's `Playlists` member, a reference the root graph carries (nothing
asks for it: if the server doesn't push it with the root, it isn't there); its `AllPlaylists` member
lists every Playlist — `Name`, `PlaylistId`
(a Sooid), `IsReadOnly`, `ItemCount`, `TrackCount`, `Profile`. Neither has been seen on the owner's
server: one that does not arrive within 4 s is "not readable", and today's way is used, saying so,
and not waited for again on that connection for a minute.

| What | Call |
|---|---|
| New | `Playlists::CreatePlaylist(Profile, string name, string description, bool overwrite_on_duplicate_name, ResultCallback<Playlist>)` — the Profile by its object, description "", overwrite false |
| Add tracks | `Playlists::InsertTracks(Playlist, IEnumerable<TrackBase>, InsertionPoint, PlaylistItem, ResultCallback<PlaylistInsertionResult>)` — each track by its session object (as a track heart names one, captured from Roon's app), at the End (1), after no item (a null reference) |
| Add albums | `Playlists::InsertAlbums(Playlist, IEnumerable<AlbumBase>, InsertionPoint, PlaylistItem, ResultCallback<PlaylistInsertionResult>)` — each album as hearts' inline `AlbumLink` by its `AlbumId` |
| Rename | `Playlists::Rename(Playlist, string, bool, ResultCallback)` — overwrite false |
| Delete | `Playlists::Delete(Playlist, ResultCallback)` |

The allowlist gains these five (`roon-native.md` §4). A playlist is named to the page by its
`PlaylistId` (hex), never by an object id; with several profiles, a playlist is made for the one
chosen in Settings (none chosen: not made, as hearts wait for one, §8.4).

**A selection's tracks**, in the order picked: each run of tracks from one album found by that
album's track query, as track hearts find their tracks (§8.3: the album's title and artist as text
filters, one page held, the album's own tracks kept by their Album), each picked track by its title
— exact, and unique on the album — and inserted at the end while the page is held; the page released
and the query disposed whatever happens. A track not found so is not sent, and is named in the
answer; an album whose tracks the server didn't give or take is named by its tracks, with why, and
the rest go on. Nothing is sent before the library has been read on this connection (an album's
object belongs to the connection that read it), nor to or as a playlist whose name Roon already has
(a change is believed by its name, §11.3). The query's code moves out of `marks.js` into
`lib/roon-direct/album-tracks.js`, shared by both.

### 11.3 Believed, and today's way

Each change is believed when its call answers "Success" **and** the official API's playlist list,
read again every 2 s for up to 10 s, shows it: one more playlist of the name made or given, one fewer
of a name deleted; an add by the playlist's track count — its subtitle there ("N Tracks"), else the
server's own `TrackCount` — up by the tracks sent, or for albums up at all (Rouen doesn't know how
many tracks an album will bring). A list that can't be read is not taken to say anything: a rename
or a delete is not sent then, and the copy doesn't make a playlist it can't first check for.
Otherwise:
- **not sent** (native mode off, not connected, being checked, the `Playlists` object not readable,
  a profile to choose, the playlist read-only or gone): today's way, Rouen's own playlist of that
  name, the answer saying why (nothing said for native mode off);
- **sent and not shown in time**: said plainly ("Roon didn't show it"); for an add, the tracks also
  go to Rouen's own playlist of that name, as the owner chose, so nothing picked is lost; a rename
  or delete is only said;
- **partly taken** (one album's tracks refused): believed for the rest, and the tracks not taken go
  to Rouen's own playlist of that name.

"Rouen's own playlist of that name" is the one there is, else a new one; the reason Roon didn't take
it is the last thing said. An add takes no more than Rouen's own playlists do (200 tracks, 30
albums, a 60-character name), so what Roon doesn't take always fits. The copy says of a playlist it
made but whose tracks Roon didn't show that it was made in Roon, to check there before copying again.

Everything takes its turn with reads, hearts and searches (`stage1.js` `inTurn`); what the calls
send stays in the graph, and none begins once fewer than 25,000 objects of room are left
(`find.js` `noRoom`).

### 11.4 How it is built

`lib/roon-direct/playlists.js` (the reads and the calls), `lib/roon-direct/album-tracks.js` (the
album's tracks, shared with hearts), `lib/playlists-native.js` (the routes, the official list's
check): `GET /api/roon-playlists` (whether Roon's playlists can be changed here, and
which), `POST /api/roon-playlists/add {id? | name?, tracks? | albums?}`, `/rename {id, name}`,
`/delete {id}`, `/copy` (begun, then followed with `GET /api/roon-playlists/copy`, as §9.1's check
is). The client's Add to playlist sheet moves out of `public/app.js` into `public/playlists-native.js`
with the native rows, the Roon playlist's Rename and Delete, and the "In Rouen only" marks; it asks
for Roon's playlists once in 15 s (the sheet, the screen and a page each want them, and each asking
takes its turn with the library's reads), and again after any change. Its script tag is paid for by
the side menu's two playlist entries, which move out of `index.html` into it. The Settings button is
`public/roon-settings.js`'s, beside the add-to-library check, named "Copy Rouen's playlists to your
server" (that page names Roon in its notice only). The fake server learns the five calls, reading
them strictly.

### 11.5 What the owner's server showed (2026-10-21, v1.9.43)

**"Copy Rouen's playlists to your server" works** (the owner): the `Playlists` object and its
`AllPlaylists` arrive with the root graph; `CreatePlaylist` and `InsertTracks`, as §11.2 sends them
(the Profile and the Playlist by their objects, tracks by their session objects at the End, after a
null item), make the playlist and fill it; and the official API's list shows both, so the copy
believed it. Then (the owner, the same evening): "new playlist created in Rouen shows immediately in
Roon" — the Add to playlist sheet's "＋ New playlist…", the same two calls from a selection. Proven:
create and add tracks. Not yet seen on the owner's server: `InsertAlbums`, `Rename`, `Delete`.

## 12. N2e — Roon's smart playlists and Rouen's Dynamic Playlists as one (the owner, 2026-10-21)

The owner, after v1.9.44: "Roon smart playlists show as regular playlists and not in Rouen's dynamic
playlists" (one, "r&b random", 5007 tracks, opened in Rouen as a single "Not Found" row), and "Rouen
dynamic playlists don't show in Roon at all". Asked, they chose **"Probe, then native"**, and of the
second: "Roon's Smart Playlists and Rouen Dynamic playlists are essentially the same thing. I want
Rouen to tap into Roons focus settings so whatever is created by one will show in the other as the
same with the smart/dynamic focus. A probe using the reverse engineers code should allow this."

**What is known.** The "Not Found" row is not Rouen's: the official browse API answers an extension
with that one placeholder row for a smart playlist (Rouen has said so since v1.7.12; other extension
authors found the same), and the playlists level carries nothing that tells a smart playlist from
another. Roon's own protocol does: a `Playlist`'s `Type` (the catalogue's `PlaylistType`, Smart 15),
its `AlbumCriteria` and `TrackCriteria` (`AlbumQueryCriteria`, `TrackQueryCriteria`: what Roon's apps
call a Focus — genres, tags, formats, years, sources, plays, favourites…), and its items through
`Playlist::VirtualItemsQuery`, which Roon's own app was captured making (upstream's
`captured_signatures.json`), with `VirtualPlaylistItemQuery::RetainPage`. Making one would be
`Playlists::CreatePlaylistFromParameters(PlaylistParameters, …)` and changing one
`Playlists::UpdatePlaylist(Playlist, PlaylistParameters, …)` — `PlaylistParameters` carrying a name and
both criteria — neither run nor captured. Rouen's Dynamic Playlists are its own: a Library sort and
Focus with a limit, kept in settings.json (`smartPlaylists`), their albums from Rouen's own index.

### 12.1 N2e-0 — the probe (v1.9.50), read only, run by hand

`GET /api/debug/roon-smart-playlists?run=1[&name=<a playlist's name>]`, over native mode's
connection, for the profile chosen in Settings → Native mode (`lib/roon-direct/smart-probe.js`).
Without `run=1` it says what a run would do and asks nothing. One run at a time, in its turn with
reads, hearts and searches, and none once fewer than 25,000 objects of room are left. Nothing is
written. It answers with names, counts and values — never protocol bytes:

1. **Every playlist the server lists** (the `Playlists` object's `AllPlaylists`, as §11.2 reads it):
   its name, its `Type` as sent (with the catalogue's name for it), `TrackCount`, `ItemCount`,
   `IsPlayable`, `IsReadOnly`, `SupportsVirtualItemsQuery`, and the names of every member that arrived.
2. **Each smart playlist's criteria** (`Type` Smart, or carrying `AlbumCriteria` or `TrackCriteria`):
   every member as sent, by its short name — a value as it is, a list by its count and first five, an
   object by its type and its `Name` when the server sent one, a nested struct two levels deep. That is
   the Focus, as Roon stores it, that Rouen's Dynamic Playlists would map onto.
3. **One playlist's items** (the one `name` gives, else the first smart one): `VirtualItemsQuery` with
   the profile's id, a `PlaylistItemQueryCriteria` of `UiLanguage` "en" alone, and a page size of 100;
   its `Count`; page 0 retained; up to 25 items, each by its `Track`'s title, album and artist; the page
   released and the query disposed, once each, whatever happens.

The allowlist gains `Playlist::VirtualItemsQuery` and `VirtualPlaylistItemQuery::RetainPage`,
`::ReleasePage` and `::Dispose()`, all reads (`roon-native.md` §4). What the probe sends stays in the
graph, as every read's does.

Expected on the owner's server: "r&b random" with `Type` 15, its criteria, and 5007 items, the first
25 named. **Then** (the owner's answers, asked once the probe has run): Roon's smart playlists listed
with Rouen's Dynamic Playlists and opened and played there through these reads; and Rouen's Dynamic
Playlists made and changed as Roon smart playlists through `CreatePlaylistFromParameters` and
`UpdatePlaylist`, mapping each Dynamic Playlist's Focus onto the criteria the probe shows.

### 12.2 What the owner's server showed (2026-10-21, v1.9.50)

The probe, run by the owner with `&name=r&b random`:
- **15 playlists**: 14 Qobuz playlists (`Type` 12) and **"r&b random", `Type` 15 — Smart**, as the
  catalogue has it: read-only, 5007 tracks, with a `Profile` and `SupportsVirtualItemsQueryV2` members
  the others don't carry, and an `AlbumCriteria` (no `TrackCriteria`).
- **Its Focus** arrived whole as an inline `AlbumQueryCriteria`: `Ordering` {`Ordering` 7 (Random),
  `Direction` 1, `OrderVariousArtistsByAlbumTitle` true, a `RandomSeed`}, `UiLanguage` "en",
  `LabelsMode` 1, and every Require/Exclude list member as a length-prefixed value — all one byte (an
  empty list) but `LanguagePreferences` (8 bytes) and **`RequireGenreObjects` (3 bytes: one genre, by
  reference)**. Decoding those lists (each a count, then its items: a genre, tag or performer by its
  object) is the next probe step.
- **Its items: proven.** `Playlist::VirtualItemsQuery`, as §12.1 sends it, answered a `Count` of 5007;
  page 0 pushed 100 `PlaylistItem`s with their rows, `TrackLite`s and their albums (with their credits,
  works, tags and images); the first 25 named by title, album and artist (Blondie, Fine Young
  Cannibals, Curtis Mayfield, Nina Simone …). The page was released and the query disposed.

**The owner's answers (2026-10-21), after it:** Roon's smart playlists in Rouen in **one build** —
listed with the Dynamic Playlists, opened to their tracks, and played through Roon's own
`Transport::PlayPlaylist`, believed once the zone shows it playing (N2e-1); and of Rouen's Dynamic
Playlists in Roon: **decode the Focus first, then one test** — one Dynamic Playlist the owner picks
made as a Roon smart playlist by hand, checked in Roon, before Rouen does it for all (N2e-2).


### 12.3 N2e-1 — Roon's smart playlists in Rouen: listed, opened, played (v1.9.51)

**What the user sees.** With native mode on, the Dynamic Playlists screen holds Rouen's own as today
and, after them, **"In Roon"**: each Roon smart playlist as a tile (its name; "5007 Tracks"). Opening
one shows its tracks — the first 100 in its own order, title, artist and album each, with More for the
next hundred up to 500 — and **Play** and **Shuffle**, which play the whole smart playlist (not only
what is shown) on the zone chosen in Rouen. The Playlists screen no longer lists a smart playlist (it
opened as a "Not Found" row there: §12) — by its name and, where both lists say it, its track count,
so a playlist that only shares a smart one's name stays. Native mode off, not connected, or Roon's
playlists not readable: the Dynamic Playlists screen is today's, and the Playlists screen too. The
list needs nothing of the library: it shows before the library has been read on a connection.

**Reading** (§12.2, proven): the smart playlists are the Playlists object's that are smart (§12.1:
`Type` 15, or carrying a Focus), read as `playlists.js` reads them (its minute without waiting again
once a server didn't send them), and of those naming a `Profile`, the chosen profile's; a page of items is `Playlist::VirtualItemsQuery` with UiLanguage "en"
and a page size of 100, `Count`, the page retained, its 100 items named, the page released and the
query disposed. A page of 100 brought some 3,800 objects with it on the owner's server (each track's
album, credits, tags and images), and what is sent stays in the graph: so a page is read only when
asked for, at most five a playlist, and none once fewer than 50,000 objects of room are left —
twice the reserve the rest of native mode keeps (`noRoom`), so browsing smart playlists never takes
the room hearts, searches, Listen Later and playlist changes need — which is said. A track the server sent before on the connection comes as a reference and
is named from the graph.

**Playing** (`Transport::PlayPlaylist(Zone, Sooid, PlayParameters, Playlist, PlaylistItem,
ResultCallback<PlayFeedback>)`, the catalogue's string; first sent by v1.9.51, and **proven on the
owner's server**, Play and Shuffle both, §12.4): on the `Transport` object the
graph holds; the **Zone** by its object; the profile's id; a `PlayParameters` of `Shuffle` alone (true
for Shuffle; the struct declared with upstream's full member list); the Playlist by its object; no
item to start from (a null reference). **Which zone**: the native `Zone` that is Rouen's chosen zone —
the one whose `ZoneId`, written as hex, is the official API's `zone_id`; else the one whose `Name` is
the zone's display name; else the one every one of the zone's outputs' endpoints (`Endpoint::Name`,
`Endpoint::Zone`) names. None, or more than one: not played, and said ("Rouen couldn't tell which of
your server's zones is …"). How it matched is logged, for the owner's report.

**Believed** when the call answers "Success" **and** the official API's zone, within 10 s, is playing
what it wasn't just before the call (taken once the play has its turn, not when it was asked): its
state became playing; or its queue grew (`queue_items_remaining`); or its now-playing changed, but
not with exactly one track fewer left, which is the queue moving on by itself as a track ends. Otherwise:
refused — said as the server said it; not shown in time — "Your server took it, but the zone didn't
start playing". Nothing is played any other way in its place.

**How it is built.**
- `lib/roon-direct/smart.js`: the list, a page of items, the play — each in its turn with reads,
  hearts and searches.
- `lib/routes/smart-roon.js`: `GET /api/roon-smart` (the list, or why not), `GET /api/roon-smart/items
  ?id=&page=`, `POST /api/roon-smart/play {id, zone_or_output_id, shuffle}`.
- The allowlist gains `Transport::PlayPlaylist` (a write: it plays; `roon-native.md` §4).
- The client's tiles, page and play are `public/playlists-native.js`'s, beside Roon's own playlists;
  `app.js`'s Dynamic Playlists screen calls it once, at its end, and the Playlists screen leaves out the
  names it says are smart.
- The fake server learns a Transport, zones with endpoints, and `PlayPlaylist`, read strictly.

### 12.4 What the owner's server showed (2026-10-22, v1.9.51)

The owner, on v1.9.51-test: "Roon smart playlists is now showing in Rouen under dynamic playlist.
Plays and shuffles fine." So, on the owner's server:
- **The list** (§12.3's reading) shows Roon's smart playlists under Dynamic Playlists, "In Roon".
- **`Transport::PlayPlaylist` is proven**, with §12.3's arguments: the Zone by its object, the
  profile's id, a `PlayParameters` of `Shuffle` alone (false for Play, true for Shuffle), the Playlist
  by its object and a null `PlaylistItem`. Both played the smart playlist on the zone chosen in
  Rouen, and Rouen believed them (the official zone showed it playing within 10 s).
- Not recorded: which of §12.3's zone matches found the zone (the `[roon-direct]` log line says it).
  Until it is, the ZoneId-as-hex match stays unproven, and the name and endpoint matches stay in place.

### 12.5 N2e-2a — the Focus read in full (v1.9.52), read only, run by hand

The owner's second answer (§12.2): **decode the Focus first, then one test**. The probe (§12.1) gave
each Focus list only as its length (`{bytes: N}`): the graph keeps a LengthPrefixed value as its
bytes. From v1.9.52 it reads each list (`lib/roon-direct/focus.js`) in the form upstream ran live in
`Library::Edit` (`client.ts`): a count, as a flex int, then each item in its element type's own
encoding. That is a string as a string; an `int` or one of the Focus's enums (`AlbumType`,
`FileFormat`, `ImageSize`) as an integer; a `long` as a long; and an object (`GenreLite`, `TagLite`,
`PerformerLite`, `Location`, `AlbumLite`) as any Object member is, by reference, inline, or null.
Which reader an element type takes is `objects.js`'s `codecFor`, the one a `DataList` uses, in either
namespace (`Sooloos.Broker.Api.`, `Roon.Broker.Api.`). A count written as -1 is a null list. A count
past the bytes left isn't this form, and isn't read as it. A Focus sent by reference, as an object of
its own (not seen on the owner's server), is read as an inline one is.

The page shows each list by its element type and count, with up to 25 items each, said as `describe`
says a value. A genre, tag or performer is shown by its type and `Name` when the server sent it, and
as "not sent" when not. A list that doesn't read whole (cut short, or with bytes left over) is
marked `"whole": false`, and what was read is kept. Nothing is written, and the allowlist doesn't
change.

Expected on the owner's server: "r&b random"'s `RequireGenreObjects` read as one `GenreLite` (the
genre it requires, by name if it was sent), `LanguagePreferences` as its strings, and every other
list as `count: 0`.

**Then** (N2e-2b, the one test): one of Rouen's Dynamic Playlists, picked by the owner, is made by
hand as a Roon smart playlist with `Playlists::CreatePlaylistFromParameters(PlaylistParameters,
ResultCallback<Playlist>)`. A `PlaylistParameters` is its `Profile`, `Name`, `Description`,
`PlaylistFolderId`, `AlbumCriteria` and `TrackCriteria` (upstream's struct schema). The owner then
checks it in Roon. The Focus Rouen keeps is a Library view: its sort and direction, and its facets
`genre`, `source`, `decade`, `label`, `format`, `rate`, `bits`, `chan`, `letter` and `added`, and
`played`. Which of these map onto Roon's criteria, how a genre by name becomes a `GenreLite` the
server will take, and what Rouen does with a facet Roon has no criterion for, is designed from what
this probe shows, and put to the owner before any of it is built.

### 12.6 What the owner's server showed (2026-10-22, v1.9.52), and the owner's answers

The probe, run by the owner with `&name=r&b random`, read every list of its Focus **whole**. That
Focus is one genre and an order:
- `Ordering` {`Ordering` 7 (Random), `Direction` 1 (Ascending), `OrderVariousArtistsByAlbumTitle`
  true, `RandomSeed`}, `UiLanguage` "en", `LanguagePreferences` ["en", ">en"], `LabelsMode` 1 (Or).
- `RequireGenreObjects`: one `GenreLite`, **"R&B"**, by reference, its object sent with its `Name`.
- Every other list (types, image sizes, locations, tags, labels, genres by name, performers,
  composers, conductors, production, sample rates, bit depths, channel layouts, file formats,
  ratings, downloaded albums, similar albums) has `count: 0`, and `GenresMode` wasn't sent (the
  default, 0, And).

So the server declares a Focus's lists LengthPrefixed (24), as `schemas.js` already declares
`RequireLocations`; and a genre goes into a Focus as a `GenreLite` object, by reference.

**The owner's answers (2026-10-22):**
1. **The test** is their Dynamic Playlist **"Folk - My Dynamic Playlist"**.
2. **A Dynamic Playlist that uses anything Roon can't express exactly is not made in Roon**, and
   Rouen says which part. The two never quietly differ.
3. **Afterwards, Roon's becomes the one copy**, as with Listen Later (§10.4): each Dynamic Playlist
   that can be is moved into Roon as a smart playlist, and Rouen shows and edits Roon's (N2e-3,
   designed after the test).

How answer 2 is read here (said to the owner when it was asked, and theirs to overrule):
- **The album limit** differs only when it cuts. A Dynamic Playlist whose Focus matches no more
  albums than its limit holds the same albums as Roon's, which has no limit. One that matches more is
  not made: "Rouen plays 100 of its 340 albums; Roon's would play all 340."
- **Rouen's "random" track order** ("Tracks · random") is how a playlist plays, not what it holds.
  The smart playlist holds the same tracks and is played with **Shuffle** in Roon, which Rouen says
  when it makes it.

### 12.7 N2e-2b — the one test: a Dynamic Playlist made as a Roon smart playlist (v1.9.53), by hand

`GET /api/debug/roon-smart-make?name=<a Dynamic Playlist's name>` shows what would be made, and asks
nothing of the server: Rouen's playlist, how its Focus maps (§12.7.1), why not if it can't be made,
and each genre's `GenreLite` as found in what the server has sent. With `&make=1` it is made, once,
on native mode's connection, for the profile chosen in Settings → Native mode, in its turn with
reads, hearts and searches. Nothing in Rouen changes: the Dynamic Playlist stays as it is (N2e-3
decides what happens to it).

#### 12.7.1 The mapping, as far as this test goes

Only what maps **exactly** is made. Everything else stops the make, and is named:

| Rouen | Roon (`AlbumQueryCriteria`) | In this test |
|---|---|---|
| Genre, included | `RequireGenreObjects`, each a `GenreLite` by reference; `GenresMode` 1 (Or), as Rouen's are any-of | made |
| Genre, excluded ("!") | `ExcludeGenreObjects` (an exclude always wins in both) | made |
| Sort: Album name, Artist, Release date, Random | `Ordering`: Title 4, MainPerformerName 0, Date 2, Random 7 (with Rouen's seed); `Direction`: Ascending 1, Descending 2 | made |
| Sort: Recently added, Most played, Last played | Roon's ImportDate, MostPlayed, none: Rouen's added dates and play counts are its own, not Roon's | not made |
| Not played in 6 / 12 months; Never played; Played | Rouen's play history is what Rouen saw, not Roon's | not made |
| Source, Decade, Label, Format, Sample rate, Bit depth, Channels, First letter, Recently added | each designed and proven before it is made (Format, Sample rate, Bit depth and Channels have exact Roon lists; Decade a date range whose form isn't read yet; Source none exact) | not made |
| The album limit | none | not made when the Focus matches more albums than the limit (§12.6) |
| Tracks or Albums; album or random order | an album Focus holds every track of its albums, in album order | made; random order said as "use Shuffle in Roon" |
| A playlist Rouen says is unavailable (Labels off) | — | not made |

`UiLanguage` "en" is sent, as the server's own Focus has it. Nothing else is sent: every member not
named here is the server's default.

**A genre by name becomes a `GenreLite`**: the one the server has sent whose `Name` is the genre,
exactly. Rouen's genre names are Roon's own (harvested from Roon's genres hierarchy). None sent, or
more than one: not made, and said ("Your server hasn't sent Rouen the genre "Folk""). The preview lists
how many genres the server has sent, and up to 20 of their names, for the owner's report.

#### 12.7.2 The call

`Playlists::CreatePlaylistFromParameters(PlaylistParameters, ResultCallback<Playlist>)` (the
catalogue's; never run nor captured) on the `Playlists` object §11 uses. A `PlaylistParameters`
(upstream's struct schema: `PlaylistId`, `Profile`, `Name`, `Description`, `PlaylistFolderId`,
`AlbumCriteria`, `TrackCriteria`) of the `Profile` by reference, the `Name` (the Dynamic Playlist's),
and the `AlbumCriteria` above, inline, its lists LengthPrefixed (the members sent declared 24, as
§12.6 shows the server declares them). A name a Roon playlist already has: not made, and said.

**Believed** when the call answers "Success" **and**, within 15 s, the Playlists object lists a
playlist of that name that is smart (§12.1), whose Focus reads back (`focus.js`) with the genres
sent. The answer then gives what the server says it holds — its `AlbumCount` and `TrackCount` —
beside the number of albums Rouen's Focus matches, so the owner can compare the two; and the owner
checks it in Roon. Refused: said as the server said it. Taken and not shown, or listed with other
genres than were sent: said, and nothing more is tried. No make of that name is sent again until
Rouen restarts, so a reloaded or prefetched `&make=1` can't add a second; the owner looks in Roon
first. The send takes its turn with reads, hearts and searches; the wait for it to show doesn't.

**Refused when ambiguous or unavailable.** Whether Rouen itself can use the Dynamic Playlist (Labels
off) is asked of it as loaded. Until v1.9.54, loading one dropped a facet that was off (it was
read from the settings.json record instead). Since v1.9.54 loading keeps every facet a saved view
can hold (`libSavedFacetIds`), so a label filter stops the make, named, whatever Labels is set to.
Two Dynamic Playlists of the name asked for: not made ("rename one first"). Rouen's random seed is
brought into the range of Roon's `RandomSeed` (an int), never wrapped.

**The shared declaration.** A connection declares `AlbumQueryCriteria` once, for every call that
sends one (`remoting.js` refuses a second, different declaration). Declaring `RequireGenreObjects` and
`ExcludeGenreObjects` 24 therefore changes what the library read declares too, on every connection.
The library read sends neither member (only `UiLanguage`, and the Locations probe `RequireLocations`,
already 24), and a member's declared type governs only how a value sent in it is read. So the server
reads that call as before. A library read that failed after v1.9.53 would show in Settings → Native
mode, and would name this.

**How it is built.** `lib/roon-direct/focus-map.js`: Rouen's Dynamic Playlist → the criteria, or what
stops it (pure). `lib/roon-direct/smart-make.js`: the genres found, the preview, the make, the
belief. `lib/routes/smart-make.js`: the route. The allowlist gains
`Playlists::CreatePlaylistFromParameters` (a write: it adds a playlist to the owner's library;
`roon-native.md` §4). The fake server learns it, read strictly, and the playlist it makes.

### 12.8 What the owner's server showed (2026-10-22, v1.9.53)

The owner ran §12.7's make on **"Folk - My Dynamic Playlist"** (Genre Folk, Album name order; its album limit
raised from 25 to 400 by the owner so it no longer cut: it matched 230 albums, and at 25 the make was refused
as §12.6 says). The preview found the genre among the 648 the server had sent. With `&make=1`:

- **`Playlists::CreatePlaylistFromParameters` is proven**, with §12.7.2's arguments: the Profile by reference,
  the Name, and an album Focus of `Ordering` Title (4) Ascending (1), `UiLanguage` "en", `GenresMode` Or and
  `RequireGenreObjects` one `GenreLite` by reference, the lists declared 24.
- The server listed it as a smart playlist whose Focus read back with **Folk** alone, and said it holds
  **228 albums, 2,813 tracks**. Rouen's own Focus matched **230**.
- The owner, in Roon: it is a smart playlist, its Focus is Genre: Folk, it plays, and nothing about it is
  odd.

**The gap of two albums** is unexplained: Rouen's genres are harvested from Roon's own hierarchy, and an album
that changed genre in Roon since, or that Rouen counts twice, would give it. It matters only while both copies
exist (§12.6, answer 3).

**The owner's answers (2026-10-22), after it — N2e-3, Roon's the one copy (§12.6, answer 3):**
1. **The move is automatic**, as Listen Later's is (§10.4): once a connection, each Dynamic Playlist that maps
   exactly (§12.7.1) is made in Roon and Rouen's own copy removed; one that can't stays in Rouen, its reason
   said; Settings → Native mode says how the move stands.
2. **A limit that cuts keeps a Dynamic Playlist in Rouen**, said why, until the owner raises it to cover its
   matches (as they did for Folk).
3. **Rouen's Edit changes Roon's**: its Focus editor opens on Roon's smart playlist and saves with
   `Playlists::UpdatePlaylist(Playlist, PlaylistParameters, ResultCallback)` — never run, so tried once by hand
   first, as the make was (N2e-3a), before the move is built (N2e-3b).

Taken as settled, said to the owner when asked: a Dynamic Playlist saved in Rouen with native mode on is made
in Roon when it maps exactly, and stays Rouen's, its reason said, when it doesn't. "Folk - My Dynamic Playlist"
already has its Roon copy from §12.8; the move recognises one of the same name, smart, with the same Focus, as
already moved, and only removes Rouen's.

### 12.9 N2e-3a — Roon's update tried once, by hand (v1.9.55)

Before Rouen's Edit changes Roon's smart playlists (§12.8, answer 3), the update itself is tried once on a
playlist the owner checks in Roon, as the make was (§12.7): on **"Folk - My Dynamic Playlist"**, its order
changed from Album name to Artist.

`GET /api/debug/roon-smart-update?name=<a Roon smart playlist>&sort=<album|artist|year|random>[&dir=desc]`
shows what would be sent, asking the server nothing: the playlist's Focus as it reads now (`focus.js`), the
new order, and why not if it can't be. With `&update=1` it is sent once, on native mode's connection, for
the profile chosen, in its turn with reads, hearts and searches.

**What is sent.** `Playlists::UpdatePlaylist(Playlist, PlaylistParameters, ResultCallback)` (the
catalogue's; never run nor captured) on the `Playlists` object: the Playlist by reference, then a
`PlaylistParameters` as the make sends one (§12.7.2): its `PlaylistId` (the playlist's own, so the
parameters name the playlist they change), the `Profile` by reference, the `Name` unchanged, and an album
Focus of the new order, `UiLanguage` "en", and the genres the playlist's Focus holds now, each its
`GenreLite` by reference as read back, with its `GenresMode` as it holds it (And is never sent as Or:
that would change what the playlist holds).

**Only a Focus this test can carry over whole is updated.** The parameters replace the Focus, so a Focus
holding anything but its order, its genres (`RequireGenreObjects`, `ExcludeGenreObjects`), `UiLanguage`,
`GenresMode`, `LabelsMode` and `LanguagePreferences` is not sent, and what it holds is named. A Focus that
doesn't read whole is not sent either, and a genre list that is there and can't be read is not taken
for an empty one. A playlist naming another profile than the one chosen is not sent. `LanguagePreferences` (["en", ">en"] on the owner's server) is not
carried over: it orders the languages titles are shown in, not what the playlist holds, and the preview
says it is left to the server's default. A playlist that isn't smart, or two of one name, is not sent.

**Believed** when the call answers "Success" and, within 15 s, the playlist reads back smart with the new
order (`Ordering` and `Direction`), the same genres and the same `GenresMode`. An order it has already is
not sent: it would read back "updated" whatever the server did. The answer gives its `AlbumCount` and
`TrackCount` before and after: an order alone must not change them. Refused: said. Not shown in time: "unknown", and no update of
that name is sent again until Rouen restarts (§12.7.2). The owner then checks in Roon that the playlist
plays by artist, is still smart, and still has Genre: Folk.

**How it is built.** `lib/roon-direct/smart-update.js`: the Focus read for update, the preview, the send,
the belief. Its route is mounted with the probe's in `lib/roon-direct/route.js`. The allowlist gains
`Playlists::UpdatePlaylist` (a write: it changes a playlist in the owner's library; `roon-native.md` §4).
The fake server learns it, read strictly.

**The owner, 2026-10-22, on v1.9.54 (for N2e-3b):** with Folk made in Roon by the test, the Dynamic Playlists
screen showed it twice: Rouen's tile ("230 Albums", its mosaic) and, under "In Roon", Roon's ("2813 Tracks", no
art), and neither Roon tile ("r&b random" too) had art. "If it is created in Roon it shows as a separate entity.
But if created in Rouen and then shows up in Roon it should show as the same." So N2e-3b also:
- **One tile for a playlist Rouen made or moved**: Roon's version, where Rouen's own stood (not under "In Roon").
  It opens, plays and is edited as Roon's. Rouen remembers which Roon smart playlists it made or moved, by
  their `PlaylistId`, in settings.json. A smart playlist made in Roon stays under "In Roon".
- **Cover art on Roon's tiles**: a playlist's `Images` member (sent with every playlist, §12.2's member list),
  each image's broker key as an album's is read (`locations.js` `imageKeyOf`), shown as Rouen's tiles show
  theirs. None sent: the tile as today.

### 12.10 What the owner's server showed (2026-10-22, v1.9.55), and finding what it refuses (v1.9.56)

The preview read Folk's Focus whole as the make sent it, read back: Genre Folk, `GenresMode` 1 (Or),
`Ordering` 4 (Title) Ascending, `LanguagePreferences` empty, 228 albums, 2,813 tracks. `&update=1` was
**refused, "InvalidArgument"**, with the order Artist (0); and again with Release date (2). So the order isn't
the cause, and nothing changed (a refusal is an answer before any change; neither was "unknown").

What the update sends and the proven make doesn't: the Playlist by reference as the first argument (the form
`InsertTracks`, proven, takes it in), and in the parameters **its own `PlaylistId`**. The `Profile`, `Name`
and the Focus are sent as the make sends them; and an update, unlike a make, may replace the parameters whole,
so may need the `Description` and `PlaylistFolderId` the make leaves out. Not yet known which the server refuses,
so v1.9.56 lets the owner vary the form, one try at a time: `&omit=playlistId`, `&omit=profile` (the parameters
leave it out), `&carry=description,folder` (the playlist's own, as read, carried over), combined as asked. The
`Name` is never left out: a replace could blank it in the owner's library. Each try is sent once, a refusal
changes nothing, and the answer (`tried`) and the log say what was sent.

**Believed** as §12.9 says, and from the playlist sent, read back by its own object, never another of its name:
an update taken as a new playlist (no `PlaylistId`) is said ("now lists 2 playlists named …"), never believed
from the copy. It must still have its name and its profile: a replace that cleared what wasn't sent is not
believed. The tries, in order, the first one taken recorded here and sent by N2e-3b: (1) `omit=playlistId`;
(2) `omit=profile`; (3) `carry=description,folder`; (4) `omit=playlistId&carry=description,folder`.
