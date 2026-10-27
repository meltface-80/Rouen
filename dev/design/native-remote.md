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
| DSP | `AudioDeviceCommonConfig::GetDspConfig`, `DspConfigItem::SetEnabled` (allowed, §15.9), `DspConfig::LoadPreset` / `AddItem` / `Apply`, `DspPresets::*` (`DspConfig::SetEnabled` withdrawn, §15.8) | catalogue | N3 |
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
the server's own before any heart is written. (Retired in v1.9.63, the owner: hearts are always on, §13.)

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

**What the owner sees** (until v1.9.63, when the status board replaced it, §13; its route stays as a diagnostic):
Settings → Native mode → "Add to library — check", a button: "Check now"
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

### 12.11 What the owner's server showed of a date (2026-10-22, v1.9.56), and reading one (v1.9.57)

The probe, run by the owner after they made a smart playlist in Roon, **"roon track 1970"**, read it whole:
- **a track Focus** (`TrackCriteria`, a `TrackQueryCriteria`, not an album one), ordered Random (`TrackOrdering`
  16), its year range in **`MinDate` and `MaxDate`, four bytes each** (`Sooloos.NullDate`, sent LengthPrefixed);
- every list empty; `LanguagePreferences` ["en", ">en"].

Also seen: Roon's own "r&b random" carries its genre twice, as `RequireGenres` ["R&B"] (by name) and as
`RequireGenreObjects` (the `GenreLite`), where the Folk Rouen made carries the object alone. Whether the update
(§12.10) wants the names too is one more form to try.

**Reading a date (v1.9.57).** No source gives a `NullDate`'s form, so the probe (`focus.js` `readNullDate`) says
one as what it can be: its four bytes as hex (a value of the owner's own Focus, not protocol framing; the probe's
one exception to "never protocol bytes"), and read in every form this wire's values take — the protocol's own
integer (a flex int), optional integer (a flag, then a flex int) and long, and a fixed 32-bit int either way round
— each also as a .NET date's days since 0001-01-01 and a Unix date's days since 1970. A reading that doesn't take
the bytes whole, or a day outside the years 1 to 9999, is null. The reading that gives the playlist's year shows
the form. Then Decade maps exactly (an album Focus has `MinDate` and `MaxDate` too), and §12.7.1's Decade row
moves from "not made" to "made". **Writing one** then declares the `NullDate` members LengthPrefixed (24), as
the server declares them and as the genre lists already are (`schemas.js` declares them 23, upstream's
generator default, until then).

### 12.12 What the owner's server showed (2026-10-22, v1.9.57): a date's form, and the update tries

**A `NullDate` is the protocol's own integer** (a flex int) of `(year << 16) | (month << 8) | day`, its bytes
sent LengthPrefixed. Month or day 0 is "not given". Read as the integer (and as a long, the same value for these
bytes), "roon track 1970"'s dates give its years:
- `MinDate` `bdc88000` → 129,105,920 = `0x07B20000` → **1970-00-00** (from the start of 1970);
- `MaxDate` `bdec981f` → 129,698,847 = `0x07BB0C1F` → **1979-12-31**.

So the playlist the owner made as "1970" is the 1970s, as Rouen's Decade facet means "1970". As day counts, the
integer is past the year 9999 and the only other whole reading (optional integer) gives the years 3230 and 4854:
neither is the form.

**Decade then maps exactly**: Rouen's decade D is `MinDate` = flexInt(`D << 16`) and `MaxDate` =
flexInt(`((D + 9) << 16) | (12 << 8) | 31`), each LengthPrefixed. Decades side by side are one range (the first's
`MinDate`, the last's `MaxDate`); decades with a gap between them are not one range, and are not made (said why).
That build declares the `NullDate` members 24 in `schemas.js` and moves §12.7.1's Decade row to "made".

**The update tries (§12.10).** Try 2 (`omit=profile`) and try 3 (`carry=description,folder`) each answered "an
update … was sent and not shown … restart Rouen". That answer is given only after an earlier try of the same name
went "unknown", so **try 1 (`omit=playlistId`) was not refused**: the server either took it or didn't answer, and
Rouen didn't read the change back. Tries 2 and 3 were not sent. Not yet known: try 1's own answer (which of the
two "unknown"s), and what Roon shows — a second "Folk - My Dynamic Playlist" (taken as a new playlist), or Folk
sorted by artist (taken, and the read-back missed it). Rouen is to be restarted before any further try.

### 12.13 The update taken (2026-10-22, v1.9.57), and a value object's defaults (v1.9.58)

**Try 1 is the form.** After a restart, the owner sent try 1 again (`omit=playlistId`, order Artist). The server
**took it**: the playlist is named by the first argument (the Playlist by reference), and a `PlaylistId` inside
the parameters is what it refused as "InvalidArgument". Roon lists one "Folk - My Dynamic Playlist" (the owner's
Roon app, and the probe: 3 smart playlists), with the same 2,813 tracks, its genre (Folk, `GenresMode` 1), its name
and its profile. Its Focus's order now reads `Ordering: { Direction: 1 }`, and before the update it read
`{ Ordering: 4, Direction: 1 }`. So the update was applied in place. N2e-3b sends this form: the Playlist, then
the parameters with the `Profile`, the `Name` and the Focus, and no `PlaylistId`.

**A value object leaves out its members at their default.** Artist is `AlbumOrdering` 0, so the server wrote
no `Ordering` at all. The same is seen elsewhere: "r&b random" carries no `GenresMode` (And, 0) and Folk no
`LabelsMode`. Rouen's read-back took the missing order as unknown, and answered `"updated": "unknown"` for an update
that had worked. From v1.9.58 a member missing from a value object that was sent reads as its default (0): an
order of Artist, a direction of Default. Only a value object decoded as its type is read so: one not sent, of a type
not known, or by reference is still not read as one of defaults. The fake server writes the order, its direction and
`GenresMode` sparse in the same way, and refuses an update with a `PlaylistId` in its parameters, so the tests see
what the owner's server does. (Other members are still written whole by the fake; reading every value object's
defaults from its schema is left until a member beyond these is compared.)

**Logged.** An update that fails with no answer read is now said in Rouen's log (`docker logs`) as well as in the answer.

**Proven (2026-10-22, v1.9.58).** The owner sent three updates to Folk in the form above (`omit=playlistId`),
one at a time: Title, then Artist, then Title again. Each answered `"updated": true`, and its order read back as
sent (4, then 0 with the member left out, then 4), Direction Ascending, the genre Folk, 228 albums and 2,813 tracks
before and after. **`Playlists::UpdatePlaylist` is proven**: the Playlist by reference, then the parameters with
the `Profile`, the `Name` and the album Focus, and no `PlaylistId`. N2e-3b builds on it.

**The owner's answers (2026-10-22), for N2e-3b:**
1. **An Edit Roon can't hold is refused, said why.** A moved playlist's Edit that adds what doesn't map exactly
   (§12.7.1: a filter Roon's Focus can't hold, or a limit that cuts) isn't saved: Save says why ("Roon's smart
   playlists can't hold Played"), and the playlist stays as it is in Roon. There is never a second copy.
2. **Deleting a moved playlist in Rouen deletes it in Roon**, after the usual confirm: it is one playlist.
   Deleting a smart playlist is tried once by hand first, as the make and the update were.

N2e-3b is built in this order, each its own build: Roon's tiles with their cover art (read only); Decade mapped
exactly (§12.12); the move, with one tile for a playlist Rouen made or moved; Edit through the update; Delete,
after its hand test.

### 12.14 N2e-3b-1 — Roon's tiles with their cover art (v1.9.59), read only

The smart playlist list (`smart.js`) carries each playlist's cover art, from its `Images` member (sent with every
playlist, §12.2's member list), and the tile draws one cover, or a mosaic of two to four, as Rouen's own playlist
tiles do, through `/api/image/<key>` (the path Listen Later's covers already take). `playlists.js` `imagesOf`:
- **the list**: a `DataList<Image>` by reference to the list the server pushed (as an album's list members come), or
  a LengthPrefixed list read as a Focus list is (`focus.js` `readList`). An inline one isn't read (an inline value
  carries only its declared members, and a DataList declares none): said, no art.
- **each Image**, a reference or inline, its broker key read as an album's is (`objects.js` `imageKeyFrom`, moved
  from `locations.js`); the first four, each once.
- **None**, said for the probe: no `Images` sent; the list not arrived; its Images not arrived; a list cut short (the
  keys read still drawn); none naming a broker key. The tile is then as before.

The form of `Images` on the owner's server is not yet seen, so the probe says, for each playlist, the keys read or
why none (`images: { keys, why }`). The fake server sends the list by reference and its Images as objects. Not done
here: covers that arrive after the list was answered are drawn the next time the screen opens, not at once.

### 12.15 Rouen matches Roon: every filter Roon can hold (v1.9.60)

**The owner (2026-10-22), on "1970" not reaching Roon:** it was never sent. Folk reached Roon by the one test link
(§12.8), and the automatic move (N2e-3b) wasn't built. "I want this to work both ways. Make Rouen compliant with
what Roon needs to make it work." And, asked: filters use **Roon's own data** (its play history, import dates,
labels), not Rouen's. So:
- **The album limit is dropped.** Roon's smart playlists have none (`AlbumQueryCriteria` has no limit). A Dynamic
  Playlist made in Roon holds every album its Focus matches, and the answer says the limit it had. This replaces
  §12.8's answer 2 ("a limit that cuts keeps a Dynamic Playlist in Rouen").
- **Every filter Roon's Focus can hold is made**, each mapped as below; one Roon can't hold still stops the make,
  said why.

| Rouen (`view`) | Roon's `AlbumQueryCriteria` | How |
|---|---|---|
| Genre | `Require/ExcludeGenreObjects`, `GenresMode` Or | as §12.7 |
| Decade | `MinDate`, `MaxDate` (NullDate, §12.12) | decades side by side, included: one range, `MinDate` (D<<16), `MaxDate` ((D+9)<<16 \| 12<<8 \| 31). An excluded decade, or a gap: not made |
| Source | `Require/ExcludeFileFormats`: Qobuz 15, TIDAL 12 | the sources allowed (those included, or all; less those excluded), as one list: without Local, the services allowed required; with Local, the services not allowed excluded, and KKBox 17 too when sources were picked (Rouen has none of its albums). None left: not made |
| Format | `Require/ExcludeFileFormats` | FLAC 1, MPEG 4 (MP3), WAVE 5, OGG 6, AIFF 7, DSF 13, DSDIFF 14; any other (MP4, AAC, Hi-Res, Lossless…): not made, as Rouen doesn't know which of Roon's it is. Formats required together with services required: not made (one list, any-of) |
| Sample rate | `Require/ExcludeSampleRates` (Hz) | as is |
| Bit depth | `Require/ExcludeBitsPerSample` | as is |
| Record label | `Require/ExcludeLabels`, `LabelsMode` Or | by name |
| Album type (v1.9.67, §12.19) | `Require/ExcludeTypes` (`AlbumType`, LengthPrefixed) | album → Main 0, single 1, live → Show 2, compilation 3, other 4, ep → ExtendedPlay 6, soundtrack 7. Remix: not made (Roon has no such type) |
| Added in the last | `Require/ExcludeImportedInLastNDays` | the widest window of each (they nest) |
| Played | `Require/ExcludePlayedInLastNDays` | never: excluded in 36,500 days; played: required in 36,500; not in 6/12 months: excluded in 180/360 days (Rouen's months are 30 days) |
| Sorts | `Ordering`: Recently added → ImportDate 1 | oldest first ascending, as Rouen's and as Release date → Date. Most played: not made (Rouen's ascending is least played first; which way Roon's MostPlayed runs isn't known, and a read-back can't tell). Last played, and Label & catalogue № (v1.9.67): not made (no album order) |
| Channels, Starts with | — | not made: Roon's channel layout names and a first-letter filter aren't known |

Each list is sent LengthPrefixed (24), declared so as the server declares its lists (§12.6), a count then each
item (an int, an enum as an int, a string); each `int?` as the protocol's optional integer; each date LengthPrefixed
holding its integer. None of these members has been sent before: **a make is believed only when every member sent
reads back from the playlist's Focus as sent** (lists in any order), and the answer gives Roon's album count beside
Rouen's (Roon's data may differ). A refusal changes nothing and is said.

This table replaces §12.7.1's list of what is made. The update test (§12.9) keeps its four orders. Not in this build: the automatic move (N2e-3b-3, next), so a
Dynamic Playlist reaches Roon by the make link (§12.7) until then; and Rouen's Edit for a moved playlist.

### 12.16 N2e-3b-3 — the move: Rouen's Dynamic Playlists become Roon's (v1.9.61)

As §12.8's answer 1 and §12.13 settle it ("Roon's becomes the one copy", automatic, as Listen Later's, §10.4), with
§12.15's mapping. `lib/roon-direct/smart-move.js`, run by `lib/routes/smart-playlists.js` (the Dynamic Playlists'
routes, moved out of `index.js` unchanged):

- **When.** With native mode on: once a connection, and again after every save of a Dynamic Playlist (a playlist
  created or edited in Rouen goes to Roon at once). Asked for on every open of the Dynamic Playlists screen, of
  Settings → Native mode, and every 5 minutes. One move at a time; each make in its turn (the maker's). A playlist
  that couldn't be asked about (the connection went, or is being checked) is tried again at the next chance; one
  refused or unknown waits for a change or a restart (the maker's own rule, §12.7.2). A playlist edited or deleted
  in Rouen while the move runs is not sent as it was (each is checked against Rouen's list before it is asked about);
  the save moves it again.
- **Each Dynamic Playlist, in turn:** mapped (§12.15); one Roon can't hold stays Rouen's, its reason kept. A smart
  playlist of that name Roon already lists **with the same Focus** (genres and how they combine, any-of; order and
  direction; every other filter read back: one judge with the make's belief) is already moved: "Folk - My Dynamic Playlist", made by the test (§12.8), is found so and not made
  again. One of that name with another Focus, or not smart, stays Rouen's, said ("rename one of them"). Any other
  is made, and believed only as §12.15 says.
- **Moved, or found there:** Rouen's own copy leaves `smartPlaylists`, and is kept, whole, in `roonSmartMoved`
  (settings.json) beside Roon's PlaylistId, in one write: the record of what moved, and a copy to restore from by
  hand; the newest 1,000 records are kept. Saving a playlist that moved meanwhile (its editor still open) is refused,
  said, rather than made a second Rouen copy. `roonSmartMoved` names this Core's playlists, so it is never backed up (as `radioZones`); a restore that
  brings Rouen's copies back has them found in Roon again on the next move, one record each.
- **One tile.** Roon's smart playlist list marks each PlaylistId in `roonSmartMoved` `moved: true`; its tile shows
  where Rouen's own stood, before "In Roon", and opens, plays (and, next, is edited) as Roon's. The screen reads Roon's
  list fresh on each open, as the move changes both lists together. With every one moved,
  the screen doesn't say "No Dynamic Playlists yet". With native mode off, a moved playlist isn't shown: Roon's copy
  is the one copy (the owner's choice).
- **Settings → Native mode → "Rouen's Dynamic Playlists on your server"**, a status line as Listen Later's: moving
  (how far), every one in Roon (how many moved), or how many stay Rouen's own, each with why.

Not in this build: Rouen's Edit of a moved playlist (through `UpdatePlaylist`, §12.13: refused, said, for what Roon
can't hold; built in §12.18, for every smart playlist), and Delete (after its hand test).

**Proven (2026-10-22, v1.9.60).** The owner made "1970" by the make link: Decade 1970, Recently added newest
first, limit 25. **`MinDate`/`MaxDate` written LengthPrefixed are taken** and read back as sent: `made: true`.
Roon holds 673 albums and 7,614 tracks, where Rouen's own Decade matched 382 albums. Roon's count agrees with its
own "roon track 1970" (7,693 tracks, the same decade by tracks). Rouen's Decade counts an album only once it has
found a year for it (`albumYearOf`). The owner chose Roon's data (§12.15), so Roon's is the playlist. The probe
read every playlist's `Images` (§12.14) as a `DataList<Image>` by reference, four broker keys each: cover art on
the owner's server is proven too.

### 12.17 Covers named by the server's own keys don't load (v1.9.61), and the fix (v1.9.62)

**The owner (2026-10-22, v1.9.61):** the "In Roon" tiles stay blank, and `/api/image/tzqgaaaa` (one of Folk's
cover keys the probe read, §12.14) shows nothing. `/api/image` asks the official API's image service, which serves
its own keys (each library album's `image_key`, of another form); a key the server names an `Image` by in its own
protocol (`broker:///image/<key>.jpg`) is not one of them. So every cover §12.14 gave a tile failed to load, and a
mosaic of failed images draws an empty frame.

**The fix.** The library already pairs each of the server's albums with the official list's row (`library.js`,
§3.2), and an album's own cover key comes with it (`imageKeyOf`). `nativeView` keeps, for each paired album, its
own key → the official row's `image_key` (`covers`), on the library view (`showLibrary`). Roon's smart playlist
list (`/api/roon-smart`) gives each playlist's covers through that map: a key no library album has is left out
(fewer covers, or the plain tile), and `imagesSent` says how many the server named. That a playlist's Images are its
albums' covers is what the server's own app shows; if they aren't, `imagesSent` shows covers sent and none given,
and this is not the fix.

The review (v1.9.62): a tile's four are chosen after each key is given (up to 24 read), so covers no library album
has don't take a mosaic's place, and one sleeve shows once; the first pairing wins when two albums share a key;
with no translator the keys pass as they came. Listen Later's covers named by the server's own key (§10.4) take the
same translation: its library album's, or none rather than one that can't load. **Still open:** a library album
the official list has no row for keeps its own key (`library.js`), and its tile has no cover; and a playlist cover
of an album outside the library has none. Both need the server's own images served, by a method not yet found in
the catalogue (`RemoteBroker::GetImageUrl` is the client's own, not a call to the server).

**Proven (2026-10-22, v1.9.61–v1.9.62).** On the owner's server: "1970" and "Folk - My Dynamic Playlist" were found
in Roon with the same Focus and became one tile each; Settings said every Dynamic Playlist is one of the server's
smart playlists (2 moved from Rouen); a Dynamic Playlist made in Rouen reached Roon, and Roon's own smart playlists
showed in Rouen ("two way smart/dynamic playlists working", the owner); and the tiles' covers showed once given as
their library albums' official keys (§12.17). Next (§12.13's order): Rouen's Edit of a moved playlist, through
`UpdatePlaylist`; then Delete, after its hand test.

### 12.18 N2e-3b-4 — Edit: any of Roon's smart playlists, in Rouen's editor (v1.9.66-t16)

**The owner's answers (2026-10-24):** "A playlist created in Roon must be editable in Rouen. The same applies to Roon's
Smart Playlists." So Edit is not only for the playlists Rouen moved to Roon (§12.16): **every** smart playlist Roon
lists is edited from its page in Rouen, starting from the Focus Roon holds now. A rename is allowed, and believed on
read-back like every other change. §12.13's answer 1 stands: an edit Roon can't hold is refused, with the reason
given, and there is never a second copy.

**Giving it to the editor** (`lib/roon-direct/focus-unmap.js`, the inverse of `focus-map.js`). The playlist's album
Focus is read as the editor's view: its genres (any of them, as Rouen's are), its decades, sources, formats, sample
rates, bit depths, labels, Played and Added filters, and its order and direction. It is believed only by round trip:
the view, mapped forward again, must be the very Focus Roon holds — the same genres, how they combine, the same order
and direction, and every other filter. Anything the editor can't show whole is refused, and named, rather than shown
approximately and saved back changed:
- a track Focus ("roon track 1970", §12.11);
- a member Rouen's editor has no facet for (favourites only, album types, tags, performers…);
- two or more genres that must all match (`GenresMode` And); one genre is the same either way;
- an order Rouen hasn't got, or a date range that isn't whole decades;
- a Played or Added filter the editor has no choice for (Played: any, never, not in 6 or 12 months; Added: the last 7,
  30, 90 or 365 days), even one that maps exactly: the editor would open with it on and unseen (the review).

Genres written by name beside their objects (`RequireGenres`, as Roon's own app writes them, §12.11) are accepted
when they name the same genres; a save sends the objects alone, as the proven make does. A direction of Default (0)
is shown as ascending. Its `UiLanguage` is sent again as read. `LanguagePreferences` is not shown and is left to the
server's default on a save, as §12.9 left it: carrying it means sending a list in a form not yet tried. A filter value
Rouen's own library has no album for (a genre, a label) shows no chip, and is kept as it is.

**Saving** (`lib/roon-direct/smart-edit.js`; `POST /api/smart-playlists` with the id `roon:<PlaylistId>`; the page
asks `GET /api/roon-smart/edit?id=`):
- The view is mapped as the move maps it (§12.15). One Roon can't hold is refused: "Roon's smart playlists can't hold
  …. It stays as it is in Roon." Rouen's own play order and album limit aren't offered for one of Roon's (Roon holds
  every album it matches, and plays it with Shuffle).
- The save starts from the Focus the editor was given: the target's id is `roon:<PlaylistId>.<stamp>`, the stamp a hash
  of the name and view it was given, so each device's editor is its own and a restart doesn't matter. If the playlist
  changed in Roon since (its Focus or its name), it is not overwritten: "open it again".
- An order and direction left as they were keep Roon's own: a Default stays Default, never made Ascending, and a
  Random keeps its `RandomSeed`. The order's other members Roon's own playlists carry (§12.2:
  `OrderVariousArtistsByAlbumTitle`) are sent again as read; one Rouen can't encode stops the save, named.
- A name another playlist has is refused, as is a playlist of another profile. Each genre is the `GenreLite` the
  playlist holds, else the one the server has sent of that name.
- Sent once in §12.13's proven form: `Playlists::UpdatePlaylist`, the Playlist by reference, then the parameters with
  the Profile, the Name and the album Focus, and no `PlaylistId`. Believed once the playlist reads back, by its own
  object, with the name sent, smart, its profile kept (or, for one that named none, the one the parameters named; read
before the send, as the server's push changes the same object), and every filter sent (`focusDiffers`, the make's
judge). Taken
  and not shown, or not answered: "unknown", said, and not sent again until Rouen restarts.
- For a playlist Rouen moved there, its record in `roonSmartMoved` (§12.16) takes the new name and Focus, so the copy
  to restore from by hand stays current.

Not yet known, and to be checked in Roon by the owner: that the server takes a rename this way (the update's
read-back is what believes it), and which way a Default direction runs for each order (it is shown as ascending, and
kept as Default unless changed). Delete is next, after its hand test (§12.13's answer 2).

Also in this build: the wall-display section of `public/app.js` moved, unchanged, into `public/wall-display.js`
(dev/quality.md's order for `app.js`).

### 12.19 Album type in a Focus, both ways (v1.9.67)

With the Library's Album type facet (`dev/design/catalogue.md`, a user's request), a Dynamic Playlist can name the
kinds of release it holds. Roon's Focus holds the same as `RequireTypes` / `ExcludeTypes`, lists of `AlbumType`
(the catalogue's enum: Main 0, Single 1, Show 2, Compilation 3, Other 4, Unknown 5, ExtendedPlay 6, Soundtrack 7),
declared LengthPrefixed (24) in `schemas.js` from this build, as the owner's server declares every Require/Exclude
list (§12.2; upstream's generator wrote 23, as it did for the dates, §12.11). The map (`focus-map.js`): album → Main,
single → Single, live → Show, compilation → Compilation, other → Other, ep → ExtendedPlay, soundtrack → Soundtrack;
**Remix has no Roon type**, so a playlist with it stays Rouen's, said. The read-back (`focus-write.js`) compares the
lists as sets with the rest, so a make or a save is believed only when the types read back as sent. The editor's
reading of a Roon smart playlist (`focus-unmap.js`, §12.18) shows the types it holds; one that names Unknown (5) is
refused, named, as no kind of Rouen's. The fake server declares and writes back `RequireTypes` (its sixth Focus member,
as the owner's server lists it) and `ExcludeTypes`.

The Label & catalogue № order has no Roon order (`AlbumOrdering` has none), so a Dynamic Playlist in that order stays
Rouen's, said, as Last played does (§12.15). Not yet proven on the owner's server: a Focus sent with types; it is
believed as every other member is, by its read-back, and refused otherwise.

## 13. The Native mode pane: Hearts always on, a status board, playlists copied by themselves (the owner, 2026-10-22)

**The owner's decisions (2026-10-22, on v1.9.62):**
1. **Hearts are always on** with native mode: the switch is removed, and so is its route
   (`POST /api/roon-direct/hearts`). §8's "off until turned on" is retired: the read before the writes still
   happens (hearts wait for the library read on the connection, §8.4), and Settings no longer asks. The profile
   chooser stays, shown only when the server has several profiles.
2. **A status board replaces** the Add to library check, the Copy button and the Listen Later and Dynamic Playlists
   status lines: one row per thing native mode does, each with a light — **green** (its last read or write worked),
   **red** (failing now, with a one-line reason), **grey** (not used yet on this connection). The owner chose three
   lights over two: an unused feature is neither proven working nor failing.
3. **Rouen's own playlists are copied by themselves**, as Listen Later's and the Dynamic Playlists' moves are: once a
   connection, once the library has been read on it, and again after each save of one of Rouen's own playlists. The
   chances to begin are the moves' own: each save, every 5 minutes, each read of Roon's playlist list
   (`GET /api/roon-playlists`) and each ask of the status board; each is gated as above, so a chance with nothing new
   does nothing. The
   copy is §11's: a playlist Roon already has by name is left alone, and Rouen's own kept, said on the board. One
   copied whole (every track found) then **leaves Rouen's own list**, as Listen Later's and the Dynamic Playlists'
   do: run again on every connection, a copy kept in Rouen would make again a playlist renamed or deleted in Roon.
   One copied with tracks not found keeps Rouen's own, said (red) with how many, and still said so when a later copy
   finds Roon has its name; one changed in Rouen while the copy ran (a track added, a rename) keeps Rouen's own too, and
   one deleted meanwhile is not made. Its leaving is a save of Rouen's list, but not a change to copy again; a failure
   is tried again at the next chance on the same connection. "Once the library has been read" is the library read on
   *this* connection (stage1's `readOn()`), not native mode merely active: a copy before that read would make the
   playlist and then find its tracks refused. An add to one of Rouen's own that was taken off the list while the add
   read its albums puts it back, so nothing added is lost. An empty one is not copied (nothing to copy, and an album
   add may be filling it). One made in Roon but kept in Rouen (tracks not found, changed meanwhile, or made and not
   shown) is never made again while Rouen runs, whatever it is renamed to, and is said as it was; after a restart the
   name check stands in for that.

**The rows** (`lib/roon-direct/health.js`, pure; served by `GET /api/native/status`):

| Row | Green | Red | Grey |
|---|---|---|---|
| Connection | up, keepalives answered | down by a fault, the last reason; three keepalives missed | not running; connecting; a planned reconnect (nightly, asked for) |
| Library | read on this connection, no fallback | the read fell back, or native mode turned itself off, why | not read yet on this connection |
| Hearts | album and track hearts on, the favourites read | a kind fell back on this connection, or a profile to choose | waiting for the library read |
| Listen Later | Roon's list read, nothing left on Rouen's own | the list can't be read, or albums left on Rouen's own, why | not read yet |
| Dynamic Playlists | Roon's smart playlists read, every one of Rouen's moved | the list can't be read, or one stays Rouen's (each why) | not read yet |
| Playlists | Roon's playlists read, every one of Rouen's in Roon | the list can't be read, or one couldn't be copied (each why) | not read yet |
| Add to library | the last add was taken | the last add wasn't sent, why | none asked for since Rouen started |
| Playback controls (v1.9.65, §14.3) | the last control went through the server | the last one wasn't seen through the server, why | none used since Rouen started; native mode off |
| Catalogue numbers and kinds (v1.9.67-t6, catalogue.md §4) | the walk of the server's edit info read whole: albums, changes; with how many albums hold a number and a kind, and what each source gave | cut short after N albums, why; or read whole but not kept, why — each tried again | under way; not read yet (after the library read); native mode off (what was last read stands) |

The board reads what each feature already keeps (the link's status, stage1's read, marks' fallbacks, the moves'
progress) and asks the cheap reads it needs (Roon's Listen Later and smart playlists, each cached by its module);
it writes nothing itself. It is shown while native mode is on, asked for on each open of the pane and at most every
30 s while it stays open. Each ask also asks for the moves (Listen Later's, the Dynamic Playlists', the playlists'
copy), each gated as before, as the status lines it replaces did on every open of the pane (§12.16). The routes the
old blocks used stay as read-only diagnostics with no page of their own: `GET /api/roon-later/move`,
`GET /api/roon-smart/move`, `GET /api/roon-playlists/copy`, and §9.1's check (`/api/roon-direct/find`), whose
machinery in find.js is shared with Add to library.

## 14. N3 — zones and transport, and device settings read only (the owner, 2026-10-22)

**The owner's decisions (2026-10-22, on v1.9.63):**
1. **Zones and transport come next**, ahead of genres, artist pages and DSP (§5's N3, as first ordered in §1.5).
2. **Device settings, read only for now.** This amends §1.7, which left device setup out entirely: Rouen may now
   *show* each audio device's settings as the server has them (exclusive mode, DSD, volume-control type, sample-rate
   limits, and the rest). Nothing about a device is *changed* from Rouen; that waits for a decision of its own, one
   setting at a time, each tried by hand first.

**What is known (the upstream catalogue, `roon-internal-api/src/catalog/catalog.json`, and its later examples):**
- Transport is fire-and-forget calls on the **Zone object**, no arguments: `Zone::Play`, `PlayPause`, `Pause`,
  `Unpause`, `Stop`, `Next`, `Previous`; `Zone::Seek(int, ResultCallback)` answers. Shuffle, repeat and Roon Radio are
  `Zone::SetShuffle(bool)`, `SetLoop(LoopMode)`, `SetAutoSwim(bool)`. Upstream's `live-pause.ts` sends `Zone::Pause()`
  to the zone named through its endpoint, as §12.3's `zoneFor` finds one; §2's table counts Pause and Standby live.
- Volume is on the **Endpoint**: `SetVolumeDouble(double, ResultCallback)`, `IncrementVolumeDouble`, `SetMute(bool)`,
  `Standby()`, `ConvenienceSwitch(ResultCallback)`.
- Device settings: `AudioDeviceCommonConfig::GetConfigInfo(ResultCallback<AudioDeviceCommonConfigInfo>)` and
  `GetDspConfig(ResultCallback<DspConfig>)` are reads; `RaatAudioDevice`'s `SetMaxBitsPerSample`, `SetDisableVolume`
  and the rest are writes (not taken, decision 2).
- **Not known:** how a Zone object carries its state — playing or paused, what plays, the play position, shuffle,
  loop, Radio, crossfade, volume levelling — and how an Endpoint carries its volume, mute and standby; nor which audio
  device objects the root graph holds, and with what. Each is a member the server pushes, kept up by UPDATEOBJ (§2:
  "live, field names unproven").

### 14.1 N3-0 — the zones probe (v1.9.64), read only, run by hand

`GET /api/debug/roon-zones?run=1` (without `run=1` it says what a run would do and asks nothing). It **makes no call**:
it reads what the connection already holds, as the server pushed it (`lib/roon-direct/zone-probe.js`).

1. **The types held:** every type in the graph whose name says zone, endpoint, transport, display, output, source
   control, audio device, DSP or queue, with how many of each are loaded — so the device objects are found by what
   the server sends, not guessed.
2. **Each native Zone, beside its official zone:** every member as sent (said as `smart-probe.js`'s `describe` says
   a value: never bytes, a list by its count and first five, an object by its type and name), its `ZoneId` as hex,
   and the official API's zone it matches by §12.3's `zoneFor` (and how: id, name or endpoints) with that zone's
   state, now-playing line, seek position, settings and its outputs' volume and mute — so each member can be read
   against what it means.
3. **Each Endpoint**, every member as sent, and the official output of the same name.
4. **Each audio device** (a type ending `AudioDevice`, and any `AudioDeviceCommonConfig` held), every member as sent.
5. **What moves:** every object of those kinds, and every object a zone or an endpoint names by reference (the
   position may be carried by one of those), read again three seconds later, outside the turn (hearts and reads go
   on meanwhile). Each member that changed is listed with both values — compared whole, not as shown, so a change
   deep in a struct still shows — beside the official zones' seek positions read at the same moments, paired by the
   zone's id. A playing zone's position shows itself so. A second read that fails is said under `moves`; the first
   stands.

It needs native mode on and connected, not the library read: it reads nothing of the library. Answers with names,
counts and values. Its size is bounded: at most 20 of each kind shown, 200 objects watched, 40 said to have moved,
strings to 200 characters, lists to their first five.

With it, the official API's zone reads (`/api/zones`, `/api/outputs`, `/api/zone-state`) leave `index.js` unchanged for
`lib/routes/zones.js` (`dev/quality.md`: the official-API code a native feature will stand beside goes first).

**Then (each its own build, after the probe has been run on the owner's server):**
- **N3-1, device settings read:** `GetConfigInfo` and `GetDspConfig` on the objects 14.1 finds, shown read only in
  Settings, each tried, not trusted (§3.3).
- **N3-2, transport native:** play, pause, next, previous, stop, seek, shuffle, repeat, Radio and volume through the
  calls above, on the zone §12.3 finds; the official API's routes stay the fallback when native mode is off or a call
  fails, and a change is believed once the zone shows it (the official zone, as §12.3 believes a play, until the
  probe proves the native members).
- Open for the owner once 14.1 has run: whether the zone list and now-playing themselves move to the native graph,
  or stay the official API's with only the controls native.

### 14.2 What the owner's server showed (2026-10-22, v1.9.64, run twice: stopped, then playing)

One zone, **Stereo Fives** (a Sonos Five, `EndpointType` 10 Sonos, `VolumeControlType` 3 Other), one endpoint.
- **The zone match is proven:** the native Zone's `ZoneId`, as hex, *is* the official `zone_id` (`matchedBy: "id"`,
  both runs). §12.4's open point is closed: transport finds its zone by id.
- **Position:** `Zone::SeekPosition`, whole seconds, pushed live: 7 → 9 in the 3 s, the official `seek_position`
  7 → 9 alike. `SignalPath::ProcessingSpeed` moves too (660× → 909×; nothing official carries it).
- **Volume:** `Endpoint::VolumeDouble` 12 (`MaxVolumeDouble` 100, `VolumeStepDouble` 1, soft limit 100) = the official
  volume 12, on the same scale. Mute is left out (false), as the official `is_muted`.
- **Shuffle, repeat, Radio:** `AutoSwim` true = the official `auto_radio`; shuffle and loop left out = off, as the
  official settings. Also sent: `VolumeLevelingDefaultAdjustment` −5, `VolumeLevelingTargetLevel` −23,
  `SleepTimerDurationMinutes` 30, the allowed flags (`IsPlayAllowed`, `IsPauseAllowed`, `IsSeekAllowed`,
  `IsNextAllowed`, `IsPreviousAllowed`). Now playing is its own object (`NowPlaying`, a `TransportItem`).
- **State is not yet readable natively.** Stopped, `State` was 3 (the catalogue's `ZoneState`: Playing 0, Loading 1,
  Paused 2, Stopped 3) = official "stopped". Playing, it read **1 (Loading)** while the official zone said playing
  and its position moved. Why: Playing is 0, a member's default, which the server leaves out (§12.13), and
  `objects.js` lays each push over the object it holds — so the Loading that came before stays. Every member that
  returns to its default goes stale the same way (`IsPauseAllowed` once stopped). Reading state natively needs
  Rouen to tell a whole object pushed from fields alone, on the zone, as hearts once needed it on albums (§8).
- **Devices** (read only, as decided): two Sonos (Stereo Fives, enabled; TV Speaker (Beam)), five AirPlay (TV Speaker,
  Living Room (Apple TV), Stereo Fives (Sonos Five), 65" QLED, Lewis's TV (Fire TV)), one Roon Ready
  (`RaatServerAudioDevice` "Default Output", an Android phone, Disabled); each with an `AudioDeviceCommonConfig`
  (`SupportsDspConfig` true). What the graph holds of a device is who it is (address, model, enabled); its settings
  are `AudioDeviceCommonConfig::GetConfigInfo`'s answer (`AudioDeviceCommonConfigInfo`: output channels, mixing,
  external volume and source control, MQA, auto-sleep) — N3-1. Exclusive mode, DSD and sample-rate limits belong
  to USB and Roon Ready devices: on Sonos and AirPlay they are absent, not hidden.

### 14.3 N3-2 — transport through the server itself (v1.9.65; the owner's answers, 2026-10-22)

**The owner's decisions:**
1. **Controls native; state stays the official API's for now.** What plays, play/pause and the position are read
   from the official zone as today (it is right); they move native in a later build, once §14.2's stale-default
   problem is solved and proven.
2. **When a native control isn't seen to take, the safe ones are sent again through the official API**: play,
   pause, stop, volume, mute, shuffle, repeat, Radio (twice does no harm). **Next, previous and seek are only
   said**, never sent again, so a slow server can't skip two tracks. The play/pause *toggle* and a *relative* volume
   step are said only, too (this design's reading of the owner's rule, found while building and in review: sent
   twice, a toggle undoes itself and a step moves twice); "volume" in the rule is a volume set to a value.

**The calls** (the catalogue's strings, as upstream's generated client sends them; never run by Rouen before this
build). On the **Zone** (found as §12.3's `zoneFor` finds it: by its id first, proven by §14.2, else by name or its
endpoints; the zone, or the zone of the output named): `Play()`, `Pause()`,
`PlayPause()`, `Stop()`, `Next()`, `Previous()` and `SetShuffle(bool)`, `SetLoop(LoopMode)`, `SetAutoSwim(bool)` — no
answer; `Seek(int, ResultCallback)` — answers. On the **Endpoint** (the output's, only among the zone's own endpoints: by its
`EndpointId` as hex when that is the official `output_id`, as a zone's is — not yet proven for outputs — else by name): `SetVolumeDouble(double, ResultCallback)` and `IncrementVolumeDouble(double, ResultCallback)` — answer (only for an output whose official volume has a value to watch;
one that only steps goes to the official API);
`SetMute(bool)` — no answer. Arguments: an int or an enum a flexInt, a bool one byte, a double 8 bytes little-endian
(LoopMode: Disabled 0, Loop 1, LoopOne 2). The allowlist gains these thirteen.

**Believed** when the official zone shows it within 3 s (taken after the call has its turn): play — playing or
loading; pause — paused; stop — stopped or paused; play/pause — a state other than before (from loading too); next — another track
playing (its line, or one fewer left in the queue); previous — another track, or the position moved back;
seek — the position within 3 s of the target; volume — the value within one step of the target (relative: moved
the right way, or already at its limit); mute — as asked; shuffle, repeat, Radio — the settings as asked.

**Not sent** (native mode off, not connected, the connection being checked, the zone or its endpoint not found, a
volume that isn't a number, the server refusing a call that answers, or its turn not come within 0.5 s — a library
read can hold the connection's turn for a minute, and a control must not wait behind it): the official API takes it,
every control alike — nothing reached the server, so nothing can happen twice (a control whose turn comes later
sends nothing). **Overtaken**: a control not seen when a newer one for the same zone or output has followed is not
sent again — it would undo the newer (a volume dragged 10 → 20 → 30 put back to 20). **Sent, not seen in 3 s**: the safe ones go again through the official API;
next, previous, the toggle, seek and a volume step answer an error saying the server took it and the zone didn't show
it, and that Rouen didn't send it again. Each answer says `via` (`roon` or `official`), and why when it fell back, for the log.

**Where:** `lib/roon-direct/transport.js` (the calls, the zone and endpoint found, and what counts as seen; pure
where it can be), `lib/routes/transport.js` (`/api/control`, `/api/seek`, `/api/volume` moved out of `index.js`
unchanged but for the native-first transport they now call; `/api/zone-settings` stays in `index.js`, its
Roon Radio hand-over untouched, and calls the same transport for its change). The status board gains an eighth
row, **Playback controls**: green when the last control went native and was seen, red when it fell back (why),
grey when none since Rouen started.

### 14.4 What the owner's server showed (2026-10-22, v1.9.65)

The owner, on v1.9.65-test, on Stereo Fives: "Playback controls all green, status board looks right." So, on the
owner's server:
- **§14.3's thirteen calls are proven**: play, pause, the play/pause toggle, stop, next, previous, seek, volume set
  and stepped, mute, shuffle, repeat and Roon Radio, each sent to the Zone or Endpoint found by §14.2's id match and
  seen in the official zone within 3 s (the board's Playback controls row green; the last, a volume).
- **The status board (§13) is proven** whole: connection, library (12,966 albums), hearts (3 favourites), Listen
  Later (5), Dynamic Playlists (5, every one the server's own), playlists (13) green; Add to library grey (none asked
  for since the start).
- Still open (§14.2): reading the zone's state natively — the controls stay native and the state official until
  then; device settings, read only (N3-1); and §5's N3 rest (zone settings beyond shuffle, repeat and Radio; grouping
  and transfer; DSP).

## 15. N3, the rest — zone settings, DSP, device settings, grouping (the owner, 2026-10-22, on v1.9.65 Latest)

**The owner's decisions:**
1. **All four, in this order:** zone settings (crossfade, volume levelling, sleep timer, the zone's name), DSP (on and
   off, presets, headroom, EQ), device settings, grouping and transfer.
2. **Device settings become changeable**, lifting §14's "read only for now" (which amended §1.7): shown read only
   first, then each setting made changeable one at a time, each tried by hand before it is built in.

**What each needs first.** Zone settings are not in the official API at all — crossfade, levelling and the sleep
timer are read only from the server's own Zone — so reading them needs §14.2's stale defaults solved: a member back at
its default is left out of a push, and `objects.js` lays each push over the object it holds. Hearts solved it for
albums by their identity member (a push that carries `AlbumId`, which never changes, is the whole album, §8): whether
a Zone pushed whole carries its `ZoneId` (and an Endpoint its `EndpointId`), and in which push (PUSHOBJ 3 or
UPDATEOBJ 5), is not known. DSP and device settings are answers to reads Rouen has never sent
(`AudioDeviceCommonConfig::GetDspConfig`, `GetConfigInfo`). So, first:

### 15.1 N3-3a — the settings probe (v1.9.66), read only, run by hand

§14.1's `GET /api/debug/roon-zones?run=1`, with two additions, each asked for:
- **`&watch=N`** (1 to 60 seconds): every push to a zone, an endpoint, or an object either names, and to any object
  of the probe's kinds that comes meanwhile (a zone made by grouping, a `DspConfig`), while the owner changes things
  in Roon's own app — each with its time, its object, its kind (PUSHOBJ 3 or UPDATEOBJ 5), whether it carried the
  object's identity member (null for a type whose identity member isn't known), and the members it carried as
  `describe` says them. At most 200 pushes. It calls nothing. `watch=0`, an empty one and anything but whole seconds
  are refused.
- **`&settings=1`**: for each audio device's `AudioDeviceCommonConfig` (at most 20), `GetConfigInfo` (its answer, a
  value, decoded by the graph's own reader) and `GetDspConfig` (its answer, a `DspConfig` object the server then
  pushes: its members, and its items' as `describe` says them). Reads; nothing is changed. The allowlist gains these
  two. An answer the graph can't decode is given as its first 256 bytes in hex, for the design to read — the one
  place the probe gives bytes, and given too when bytes follow the value. `GetDspConfig`'s object is waited for as
  pushed since its call (1.5 s); when it doesn't come, what the graph already held is given, said so
  (`pushedWithAnswer: false`). Each device's two reads are its own: a refusal or a failure is said for that read
  alone — but once a call goes unanswered (the connection uncertain), nothing more is sent, each read left said
  skipped, and `calls` counts only what was sent (the review).

`objects.js` tells its watchers which kind of push it read (the third argument; hearts' watcher ignores it).

### 15.2 What the probe found (the owner's run, 2026-10-23), and N3-3a′ — the DSP chain read (v1.9.66-t3)

**Proven on the owner's server**, all eight audio devices (two Sonos, six AirPlay), 16 calls, none refused:
- `AudioDeviceCommonConfig::GetConfigInfo` answers by value, an `AudioDeviceCommonConfigInfo` the graph decodes:
  what each device supports (`SupportsOutputChannels`, `SupportsOutputMixing`, `SupportsMQACapabilities`,
  `SupportsExternalVolumeControl`, …) and, where set, its value (`OutputChannels` "2.0", `OutputMixing`
  "downmix_only", `MQACapabilities` "none", with the `Supported…` lists to choose from). An AirPlay device's
  answer carries the `Supports…` flags but no values: left out, as a member at its default is (§14.2).
- `AudioDeviceCommonConfig::GetDspConfig` answers by reference, and the `DspConfig` it names is pushed with the
  answer every time (no `pushedWithAnswer: false`). The Sonos devices' DSP is on (`IsEnabled`, `AutoApply`) with two
  items before the chain and three in it; the AirPlay devices' is off and empty (`IsEnabled` left out: false). Each
  can add `peq`, `parametric_equalizer`, `convolution`, `audeze_presets`, `speaker_setup`.

**Not yet known**: the run found no zones — Roon had none at that moment (`zones` and `unmatched` both empty), so the
watch had nothing to watch and §14.2's question (whether a Zone pushed whole carries `ZoneId`) is still open. Zone
settings wait on a run with a zone playing. Nor does the run show what a `DspConfigItem` holds: the probe's
`describe` stops two levels down, at `{ object: "DspConfigItem" }`.

**v1.9.66-t3, the DSP chain read** (read only, run by hand, with `&settings=1`; no call added): beside each device's
`dspConfig`, a `dsp` section with the `DspConfig` whole, under the server's own member names — its lists, their items
and the presets, each object it names given whole to four levels, at most 30 items a list (a list cut short or longer
says so), an object met twice named the second time, not repeated. Everything in it is already in the graph, pushed
with the `DspConfig`; what it names and is still arriving is waited for (the read's 1.5 s), and a `DspConfig` the
server didn't push with its answer is said (`pushedWithAnswer: false`). It is read on its own, so a fault in it leaves
the DSP read beside it as it was. And when neither connection has a zone the probe says so (`note`): no zone could be
matched or watched, though the outputs, devices and DSP still were (the review). What it is for: the DSP controls the
catalogue names — `DspConfig::SetEnabled(bool)`, `DspConfigItem::SetEnabled(bool)`, `DspConfig::LoadPreset` — are
each built only once their objects are read and one has been tried by hand (§15, the owner's decision 2).

### 15.3 What the zone runs found (the owner, 2026-10-23), and N3-3a″ — the recorder (v1.9.66-t4)

**Proven**: a `Zone` carries its settings — `VolumeLevelingDefaultAdjustment` (−5), `VolumeLevelingTargetLevel`,
`SleepTimerDurationMinutes` (30), `AutoSwim` (the official API's auto radio), and once volume levelling is on,
`VolumeLeveling` (2, Album) with `SupportsVolumeLevelingDefaultAdjustment` and `SupportsVolumeLevelingTargetLevel`. In
the run before, with levelling off, `VolumeLeveling` and the two `Supports…` were left out: a member at its default is
not sent (§14.2), and so is a capability that is off. `Crossfade` was left out in both (off). Between the two runs
the owner turned levelling on and the target from −23 to −14, and the same `Zone` (the same oid) held the new values:
the changes reached Rouen's copy. And the DSP chain whole (§15.2): before it, headroom (−3 dB) and sample-rate
conversion; in it, crossfeed (BS2B), a 7-band parametric EQ and headphone EQ; no presets. Each item says
`SupportsSetEnabled` but none says whether it is on: whether the absence means off is asked of the owner.

**Not yet known**, still: how a setting going back to its default reaches Rouen — the one thing §14.2 needs. Both
30-second watches were empty: the changes were made outside the window, which is too short to aim at by hand.

**v1.9.66-t4, the recorder** (read only, run by hand; no call): `?record=start` (with `&minutes=N`, 1 to 15, 10 if not
given) starts recording every update the server sends about the probe's kinds (§15.1's `KINDS`: zones, endpoints,
devices, DSP…) on the connection open then, and answers at once; the owner then uses Roon's own app as they like, and
`?record=1` reads what came — each update with its time, object, kind (PUSHOBJ or UPDATEOBJ), identity member and
members, as the watch says them. At most 300 updates kept, the rest counted (`more`); an update that carries nothing
but a zone's `SeekPosition` (one a second while playing) is counted, not kept (`seekOnly`), and so is one that carries
no member at all (`stubs`; from t5, `seekOnly` is counted in `same`, §15.4). It stops at its time or when the connection
changes — looked for every 5 s, and said as such even when the time runs out after it — and starting again starts
afresh. A fault reading an update never reaches the connection's own reading: counted, the first five said with what
failed. It is kept in memory only (a finished recording lets its connection's graph go), and nothing records unless
asked (the review).

### 15.4 The recording (the owner, 2026-10-23, v1.9.66-t4): a Zone is pushed whole — and N3-3a‴, changes only (t5)

**Proven, §14.2's question answered.** Every update the server sent about a zone was the zone whole: an UPDATEOBJ
carrying its `ZoneId` (identity true), about once a second while it played, each with every member not at its
default — `SeekPosition`, `WaveformData`, the `Is…Allowed`, `AutoSwim`, the levelling members, `SleepTimerDurationMinutes`.
When the owner turned volume levelling off (27.5 s), `VolumeLeveling` and its two `Supports…` dropped out of the next
whole push — the adjustment and target stayed — and came back (`VolumeLeveling` 2) when it went on again (30.2 s). And
`State`: a paused zone says 2; a playing one leaves it out (Playing, 0, the default). So the rule hearts use for an
album (§8) holds for a zone: **a push carrying `ZoneId` is the whole zone, and a member it leaves out has gone back
to its default** — the graph, which merges, must drop it. Zone settings and zone state can be read natively on that
rule (the builds after §15). A new zone (the owner's iPad, enabled during the recording) arrived as a PUSHOBJ, whole,
with its own `VolumeLevelingTargetLevel` (−23: levelling targets are per zone).

**Not caught**: crossfade, the sleep timer, DSP. The whole-zone tick filled the recorder's 300 in about two minutes,
so what came after was only counted; and the repeated pause-and-resume from 46 s on (playback restarted, by its
`OutputSignalPathElement` pushes) is what a setting change looks like from here, without saying which.

**v1.9.66-t5, changes only**: the recorder keeps an update only when something in it differs from what is known of
its object, and says what (`changed`): a member's value, compared whole as pushed — a buffer by its bytes, a struct or
list in full, not as the probe describes it, which shortens — or a member come; and, in an update carrying its identity
member (a whole object), a member known and absent (`dropped`): gone back to its default, whether a whole or a partial
update set it. The rest are counted (`same`; t4's `seekOnly` is among them). An object's first update in a recording is
always kept (`first`): `held`, compared with what Rouen held of it when the recording began — held, not known, for the
graph merges and never drops a member, so it may hold one already gone (the review) — or `new`. What is held leaves the
queue out and takes at most half the bound, so neither crowds the other out. A list's items are said (`items`). A tick
is compared by whether it is there, not by its value, so a stop, which drops it, is kept: a zone's `SeekPosition` and
`WaveformData`, and any member found changing on every update of its object, never more than 3 s apart, 30 times over
25 s or more (a countdown, if a sleep timer has one), from then on, said in `ticking` (past 50, counted: `tickingMore`)
(the review: an unknown tick would fill the 300 again; a slider dragged and left is not one). What is known is bounded
(1000 objects): past that, an object's updates are all kept, counted and marked `untracked`, so none is lost. An update
that faults is noted nowhere, so it is not taken as known.

### 15.5 The second recording (the owner, 2026-10-23 18:07, v1.9.66-t5): crossfade, the sleep timer, DSP — proven

The owner recorded for 135 s on the iPad's zone while changing crossfade, the sleep timer and DSP in Roon's own app,
and said afterwards what each was (crossfade set to 10 seconds; the run of pauses at 110–124 s was DSP on the iPad).

**Proven, each a member of the whole Zone (§15.4: absent means default):**

- **Crossfade** is `CrossFade` (capital F), in seconds: set to 10 s it came as `CrossFade: 10` (67.5 s); turned off, it
  dropped out (73.1 s). Each change paused playback for a moment and started it again (`State` 2, then absent).
- **The sleep timer** is three members. Set (86.8 s): `IsSleepTimerEnabled: true`, `SleepTimerDurationMinutes: 45`
  (was 30) and `SleepTimerExpiration`. Cancelled (95.1 s): `IsSleepTimerEnabled` and `SleepTimerExpiration` dropped
  out; `SleepTimerDurationMinutes` stayed at 45, the length last chosen, and is in every zone's push (30 on a new
  zone), so it says nothing on its own about a timer running.
- **A time** is a .NET `DateTime.ToBinary()` of a UTC time, as a decimal string: bit 62 set (Kind UTC), the rest
  100 ns ticks since 0001-01-01. `SleepTimerExpiration` 5250969802705036672 is 18:53:47.76 UTC, the moment it was set
  plus 45 minutes; `Transport::LastPlaybackActivity` decodes to the second of the update that carried it.
- **Volume levelling** (§15.4) and its target are per zone: −23 on the iPad's, −14 on TV Speaker's.
- **`State`**: 1 starting, absent playing (0), 2 paused, 3 stopped. **Volume**: an endpoint at 0 leaves out
  `VolumeDouble` and `Volume`, as at its default.
- **A zone is remade, not reused**: the iPad's came three times in 40 s as the device was enabled again, each a new
  object with its own `ZoneId`. A zone is followed by its `ZoneId`, never its oid.

**DSP: no update reaches Rouen.** Turning DSP off and on for the iPad paused and restarted its zone eight times
(110–124 s, the position held at 56 s), and nothing else came: no `DspConfig` or other DSP object. The probe had never
asked for that device's DSP (`GetDspConfig`); the server pushes an object only to a connection that has it (§15.2's
DspConfig came with the answer). So DSP is read by asking `GetDspConfig` for the devices of the zones shown, and is
followed by its pushes after that; whether those pushes arrive is the next thing to prove, before anything is shown.

**The recorder** said a change to `Transport::SongcastDirectSubnets` on every Transport update, whose list was the same
(192.168.0.0): the server sends it as a new object each time, and a reference is compared by the object it names. Of
no consequence to what was found; to be compared by what the list holds when the recorder is next changed.

### 15.6 N3-3b — a zone's settings in the zone sheet, read only (v1.9.66-t6; the owner, 2026-10-23)

**The owner's decisions:** the settings go in the **zone sheet** — the main remote's "Play on" popover, under its
zones and above its actions — and **in the Shelf's zone menu too**, at its foot ("both now"). The release of 1.9.66
is held; this is the next test build. Volume levelling's `2` is **Album** (the owner's TV Speaker, set so in Roon).

**The graph keeps a whole Zone and a whole Endpoint whole.** `objects.js` drops what a push carrying `ZoneId`
(`EndpointId`) leaves out — the rule §15.4 proved — for those two types only, and only for a push read to its end (one
cut short is never taken for whole). Every other type is laid over what is held, as before. So what the graph holds
of a zone is the zone as last sent, and a member gone back to its default is gone (§14.2's `State` left at Loading is
fixed with it).

**What is read** (`lib/roon-direct/zone-settings.js`; nothing asked of the server, nothing changed), for the zone the
official API names by `zone_id` — the Zone whose `ZoneId` as hex is that id (§14.2; a zone is followed by its id, never
its oid, §15.5). A zone remade is a new object with the same `ZoneId`, and the old one stays in the graph: the newest,
the last the graph took in, is read (the review):
- **Crossfade:** `CrossFade` seconds; absent, off.
- **Volume levelling:** `VolumeLeveling`; absent (or 0), off; 2, Album; any other value said as Roon's number, not
  named until the owner's server shows it. With it the target (`VolumeLevelingTargetLevel`, said in LUFS) and the
  default adjustment.
- **Sleep timer:** on only when `IsSleepTimerEnabled`; then when it ends (`SleepTimerExpiration`, a UTC
  `DateTime.ToBinary`; a local or unspecified time is no time) and the length chosen (`SleepTimerDurationMinutes`).

`GET /api/roon/zone-settings?zone_id=` answers `{native: false, why}` when native mode is off or no connection is
open, `{native: true, found: false}` when no Zone has that id, else the three settings.

**Shown** (`public/zone-settings.js`, one script for both pages): each time the sheet opens, a "Zone settings" section
read afresh for the zone the sheet has chosen (the main remote's selected zone; the Shelf's checked one), three rows
and "Read from your server. Change them in Roon for now." Native mode off, the zone not found or no answer: nothing
is shown, and the sheet is as it was. The main remote loads it from `roon-settings.js` (index.html is at its length
baseline, as the native pane before it); the Shelf by its own tag. Styled inline (style.css at its baseline).

**Open, found in the review:** transport's `zoneFor` (smart.js) takes a zone by its id only when one object has it,
so after a zone is remade it falls back to its name, then its endpoints (which name the live zone) — usually still
found, but by a weaker match. To be made to take the newest, as here, in the next build that touches transport.
**Closed, not changed (2026-10-24, the owner's "loose ends first"):** the premise isn't what was recorded. §15.5's
recording shows a remade zone as a new object **with its own `ZoneId`**, so one object per id is what the server has
shown, and `zoneFor`'s match by id holds. Taking the newest of several (tried, v1.9.66-t16 draft, never pushed) would
be a guess at which is live: after a reconnect the graph's order is the push's, and a stale zone pushed last would be
taken, where today's fall-back follows the endpoints to the live one (the review). If a zone is ever seen twice with
one id, the endpoints' `Zone` reference is what names the live one.

**Next:** changing them (crossfade, levelling, the sleep timer), each call tried by hand first; then DSP (§15.5).

### 15.7 N3-3c — zone settings and DSP changed from the zone sheet (v1.9.66-t7; the owner, 2026-10-23)

**Proven before it (the owner, on v1.9.66-t6):** §15.6's section showed every setting correctly, on the main remote and
on the Shelf, as each was changed in Roon's own app.

**The owner's decisions:** the controls are built straight in, each **checked** as transport is (§14.3): sent once,
believed only when the server shows it, else said as not taken. Changeable now: **crossfade, the levelling mode, the
levelling target, the sleep timer — and DSP**.

**The calls** (the upstream catalogue's strings, `catalog.authoritative.json` at 8b67208; never run by Rouen before
this build), each on the zone's own Zone object (the newest with its id, §15.6):
- `Zone::SetCrossFade(int)`, no answer: seconds; 0 is off.
- `Zone::SetVolumeLeveling(VolumeLeveling)`, no answer: the catalogue's enum, **Off 0, Track 1, Album 2, Auto 3** (its
  Album 2 is what the owner's server sent, §15.6, so its names are taken for the rest).
- `Zone::SetVolumeLevelingTargetLevel(double)`, no answer: the target in LUFS.
- `Zone::SetSleepTimer(bool?, int?, ResultCallback)`, answered: on, `(true, minutes)`; off, `(false, null)`. A nullable
  bool is one byte (0, 1, 2 for null), a nullable int a presence byte and the int (upstream's serializer and its test).
- **DSP** (withdrawn in t8: the wrong control, read the wrong way — §15.8), for each output in the zone: the output's
  Endpoint → its `Device` → the device's `CommonConfig` →
  `AudioDeviceCommonConfig::GetDspConfig` (answered with the DspConfig, §15.2) → `DspConfig::IsEnabled` (absent:
  off, §15.2) — read when the sheet opens, as these are calls. Changed by `DspConfig::SetEnabled(bool, ResultCallback)`,
  answered, on the DspConfig just read.

**Believed** when the server shows it within 3 s: a zone setting when the Zone, pushed whole, holds the value asked
(crossfade and the mode exactly, absent as 0; the target within 0.5; the timer on with that length, or off); DSP when
`GetDspConfig`, asked again, has `IsEnabled` as asked (withdrawn in t8: asked again, it sends no push, §15.8). **Not sent** (native mode off, not connected, the connection
being checked, the zone or output not found, a value not offered, the turn not come within 0.5 s): said, nothing
changed. **Sent, not seen:** said ("your server took it, but the zone didn't show it"); never sent again — there is no
official API to fall back to for any of these. A setting changed is shown as the server then holds it.

**The choices offered** (each with the current value too when it is not among them): crossfade Off, 1–10 seconds;
levelling Off, Track, Album, Auto; target −14, −16, −18, −20, −23 LUFS; sleep timer Off, 15, 30, 45, 60, 90, 120
minutes; DSP on or off for each output whose device has a DSP config (withdrawn in t8, §15.8). The server sends any value within its bounds
(crossfade 0–30 s, target −40–0 LUFS, sleep 0–720 minutes), so a zone's current value outside the lists can be kept;
outside them, nothing is sent (the review: the lists are the page's, the bounds the server's). None of the targets
offered is the default a whole zone leaves out: a zone made fresh was pushed with −23 (§15.5), so a target set is seen.

**What the review settled** (its DSP parts withdrawn in t8, §15.8)**:** a call that fails before anything leaves Rouen (the connection already closed, too many
calls waiting) is not sent, not "sent and not seen"; an output whose DSP can't be read is shown as "Can't read" with
why, beside the others, and one failing never hides the rest; whether a DSP is on is read from its pushes during the
answer laid together, a stub adding nothing; a setting changed shows the section afresh only if the sheet still shows
that zone, and keeps the DSP rows as read rather than asking the server again. Left as it is: zone-controls.js keeps
its own copy of transport's turn rule (§14.3) rather than reshaping transport in this build.

**Where:** `lib/roon-direct/zone-controls.js` (the calls, the waits, what counts as seen),
`POST /api/roon/zone-settings {zone_id, crossfade | leveling | target | sleep}` (one change a request); the controls in
`public/zone-settings.js`, in place of §15.6's read-only rows. (t7's DSP reads, `GET`/`POST /api/roon/zone-dsp` and the
DSP rows are withdrawn in t8, §15.8.)

### 15.8 What t7's DSP did wrong (the owner, 2026-10-23, on v1.9.66-t7), and t8 — the master gone, the recorder sharpened

**The owner's test of t7:** crossfade, volume levelling and the sleep timer all work. DSP showed "On" and did nothing
when tapped; MUSE showed no DSP active; afterwards both Sonos zones said "Can't read". MUSE has **no DSP master
switch**: it turns DSP on and off item by item.

**Two faults, each proven by the owner's probe (`?run=1&settings=1`):**
- **Read the wrong way.** The server pushes a DspConfig, with its items, only the first time a connection asks
  `GetDspConfig`; asked again on the same connection it answers the reference alone (the probe's `pushedWithAnswer:
  false` for both devices). §15.7 read on/off only from the push that came with the answer, so every read after the
  first had nothing to read ("Can't read"), and a change could never be seen. The DspConfig is held by the graph after
  that first push, and its later updates come as pushes (below).
- **The wrong control.** `DspConfig::IsEnabled` is a master MUSE never shows; it was on for both devices whatever the
  items were, and the taps did not leave it off. What MUSE shows are the `DspConfigItem`s in `BeforeItems`, `Items`
  and `AfterItems` — headroom, sample-rate conversion, crossfeed (BS2B), parametric EQ, headphone EQ, convolution —
  each with its own `IsEnabled` and `SupportsSetEnabled`, and the catalogue's `DspConfigItem::SetEnabled(bool,
  ResultCallback)`.

**The owner's recording (20:02, t7):** toggling Headroom on the TV Speaker several times, the server sent the item
(`DspConfigItem` 1335848) once with `IsEnabled: true` and all its members, and a `DspConfig` update with each tap; the
recorder counted 3 other updates as the same and did not say whose. So turned off, the item most likely came **without
`IsEnabled`** — whole, its default left out, as a Zone is (§15.4) — and the graph, which merges every type but Zone and
Endpoint, kept the `true` it had: why the probe said Stereo Fives' Headroom on (−3 dB) while MUSE showed nothing on.
Likely, not proven: the recorder could not show an update that leaves a member out of a type not known to be whole.

**The owner's decisions:** DSP item by item, as MUSE shows it — **proven first**. t8 removes the master and sharpens
the recorder; one more recording proves how an item turned off is sent; the item switches are the build after it.

**t8:**
- The DSP row is gone from the zone sheet; `GET`/`POST /api/roon/zone-dsp` are gone; `DspConfig::SetEnabled` leaves
  the allowlist (forty-six signatures), so the master can't be sent again.
- **The recorder** (`push-log.js`): an update of a DSP type (`Dsp*`: the DspConfig, its items and their parts — the
  types under study, none known to be pushed whole) that newly leaves out a member known of its object is kept and
  says it (`leftOut`), the member kept as known — such an update may be partial — and one left out again is the same.
  A member left out that comes again is said (`back`). Only DSP types (the review): a type sending partial updates by
  turns would otherwise be kept on every update and fill the recording. The updates counted the same are said by
  object (`sameBy`, by oid, named when read; at most 50, the rest counted). A reference to a list none of whose items
  is a reference is compared by what it holds when the list is already held as its referrer's update comes — as in
  the owner's recording, which described each new `AddItemTypes` list's items with its DspConfig; one not yet held is
  compared by which object it is, as before. So §15.5's `SongcastDirectSubnets` and this recording's `AddItemTypes`,
  sent as a new list each time, no longer read as changed.

**Next, to prove:** a recording while one item is turned on and off, each tap said: off should come as `leftOut:
["IsEnabled"]` and on as `back: ["IsEnabled"]`. If so, `DspConfigItem` is whole, the graph is to drop what its pushes
leave out (as for Zone and Endpoint, §15.6), and the item switches read the graph as held after the first
`GetDspConfig` and follow its pushes.


### 15.9 N3-4 — each DSP item on or off from the zone sheet (v1.9.66-t9; the owner, 2026-10-23)

**Proven (the owner's recording, 21:11, on v1.9.66-t8):** with Headroom on TV Speaker turned off, on, off, on in MUSE,
its `DspConfigItem` came each time with every member it has: off as `leftOut: ["IsEnabled"]`, on as `back:
["IsEnabled"]` with `IsEnabled: true`. **A DspConfigItem update is the item whole; off is `IsEnabled` left out.** The
recording before it (21:08), on a connection that had never asked `GetDspConfig`, had no DSP update at all for the same
taps: **the server sends a device's DSP updates only to a connection that has asked for its DspConfig.** On the fresh
read, Stereo Fives' Headroom had no `IsEnabled` (off, as MUSE showed): §15.8's "on (−3 dB)" was the merged graph's
stale `true`. Each change paused the zone's playback for a moment and started it again, in Roon's own app as well.

**The owner's decision:** an **on/off switch for each item**, as MUSE names it, for each output in the zone; nothing
more of an item (its values are changed in MUSE).

**The graph:** a `DspConfigItem` push carrying its part (the member naming what it is — `HeadroomAdjustment` and the
rest, by reference; the catalogue's twelve, `objects.js` DSP_PARTS) is the item whole (IDENTITY, as a Zone's `ZoneId`,
§15.6): what it leaves out is dropped. The part never changed in the owner's recordings yet came in every update, so
an update is the whole item — one that can't be switched, or stops being switchable, included (the review). The
recorder says such an item's update as whole (`dropped`, not `leftOut`).

**What is read** (`lib/roon-direct/zone-dsp.js`, calls, when the sheet opens): for each output of the zone (§15.7's
endpoints, at most 8), its Endpoint → `Device` → `CommonConfig` → `GetDspConfig`, asked at every read — answered
with the reference, and with the object only the first time on a connection; asked each time, so a new connection is
followed too. Each output's call takes the connection's turn on its own; what came is waited for outside it (the
review: a zone setting or transport changed meanwhile is not kept waiting). The DspConfig is then read as the graph
holds it (waited for up to 1.5 s): the items of `BeforeItems`, `Items` and `AfterItems`, in that order, each with
- its **name**, from the part it carries: `HeadroomAdjustment` Headroom management, `SampleRateConversion` Sample rate
  conversion, `BS2B` Crossfeed, `ParametricEqualizer` Parametric EQ, `PEQ` Procedural EQ, `OpenHeadphoneDatabase`
  Headphone EQ, `Convolution` Convolution, `SpeakerSetup` Speaker setup, `AudezePresets` Audeze presets,
  `AudezeSpatializer` Audeze spatializer, `Radiance` Radiance, `SonarworksSR` Sonarworks (the catalogue's parts); any
  other by its member's name;
- **on** when `IsEnabled` is true; **can** when `SupportsSetEnabled` is true.
An output with no DspConfig, or whose lists or items are not all held (never pushed, fewer than its count), or whose
device or its settings are named and not yet held, is said "Can't read" with why; one output failing never hides the
rest. An output whose device shares no settings has no items. The DspConfig's own `IsEnabled` (§15.8's master) is not read.

**Changing:** `DspConfigItem::SetEnabled(bool, ResultCallback)` (the catalogue's string, 8b67208; answered), on the
item, sent only when it is an item of an output of that zone — found in what a read on this connection found, the
outputs not read on it read first (the review: no call for an item already found) — and can be switched. An output
that can't be read is said as the reason when the item isn't found (a closed connection said as such). Believed when the graph's item shows
`IsEnabled` as asked (absent as off) within 3 s. **Not sent** and **sent, not seen** as §15.7; never sent twice.

**Routes:** `GET /api/roon/zone-dsp?zone_id=` → `{native, found, outputs: [{output, id, items: [{id, name, on, can}]}
| {output, id, why}]}`; `POST /api/roon/zone-dsp {zone_id, item, on}` (`item` the item's id as read) → 200 seen, 409
sent and not seen, 503 not sent, 400 refused.

**Shown** (`public/zone-settings.js`): under the zone's settings, read after them, a "DSP" group for each output with
items (titled with the output's name when the zone has more than one): a switch for each item that can be switched, an
item that can't said On or Off; "Can't read" with why for an output not read; nothing for an output with no items.
Beneath: "Each change pauses playback for a moment." A switch changed shows what the server then holds; one not taken
is said, and the switch goes back. A setting changed above keeps the DSP rows as read, and what a kept switch says goes
to the section's status line as it then is (found in the build's own test: the line is remade with the section). One
switch taken clears only its own "Sending…", never what another has said (the review).

### 15.10 The DSP window (v1.9.66-t10; the owner, 2026-10-23, on v1.9.66-t9)

**Proven (the owner, on v1.9.66-t9):** every switch worked, on the phone and the iPad, and MUSE agreed.

**The owner's decision:** the items listed in the zone sheet were hard to see. As Roon shows DSP behind its MUSE
button, the zone sheet gets a **DSP** entry that opens a **window of its own**, where the items are shown. Crossfade,
volume levelling and the sleep timer stay in the zone sheet as they are.

**The zone sheet** (both pages): under the sleep timer, one row "DSP" with what is on beside it, as MUSE's button
lights — "Off" when nothing is on, the item's name when one is, "N on" when more are, "Can't read" when an output
couldn't be read and nothing read is on — and "›", cut short with "…" if long. It is read with the sheet (§15.9's
GET), shown only when an output of the zone has items or couldn't be read; when the window's script didn't load, the
row says so ("Couldn't load — reload the page") rather than leaving DSP out (the review). Tapped, it closes the zone sheet and opens the window, as "Group zones…"
and "Device power…" do.

**The window** (`public/zone-dsp.js`): a sheet of its own, laid out as the main remote's other sheets (`.lib-sheet`:
from the foot of the screen at every width — on a wide one its corners all rounded and lifted 24px off the foot,
followed as the screen turns — above the transport bar), its styles inline so the Shelf, which has no style.css, shows
it the same. Titled "DSP", with a close button; closed also by tapping outside it or Escape. Its keys are its own
(the review): Escape closes it and nothing behind it (an album or Now Playing open behind on the main remote, the
Shelf's picks), and Tab goes round its own controls. Closed, focus goes back to the zone sheet's button. Read afresh when it opens (§15.9's GET; "Reading your server…" meanwhile; nothing read: said). For each
output with items, its name as a heading, then a row for each item — its name, and a switch (or On / Off for one that
can't be switched) — taller and larger than the zone sheet's rows, made to be tapped; an output not read is said with
why, in the open, not in a title. Beneath: "Each change pauses playback for a moment." and a status line. A switch
works as §15.9 says (sent once, shown as the server then holds it, not taken said and the switch as it was; one
switch clears only its own "Sending…").

**Where:** `public/zone-dsp.js` (new: the window), loaded by `zone-settings.js` beside it (the main remote loads
zone-settings.js from roon-settings.js; the Shelf by its tag); `zone-settings.js` keeps the row and opens the window.

### 15.11 N3-5 — the DSP items' settings: what the catalogue offers, and the recording first (v1.9.66-t11)

**The owner's decisions (2026-10-23, on t10):** the items' own settings next — **Headroom management, Crossfeed,
Sample rate conversion and Parametric EQ**, all four — each **recorded first**, then built as checked controls (sent
once, believed only when the server shows it, as §15.7's).

**What the catalogue offers** (8b67208), each on the item's part, answered (`ResultCallback`):
- `HeadroomAdjustmentItem::SetGainDb(double)`, `SetClippingIndicator(bool)` — the probe read `GainDb` −3, `MinGainDb`
  −30, `GainDbStep` 0.1.
- `BS2BItem::SetPreset(string)`, `SetCutFrequency(int)`, `SetFeedLevelDb(double)` — presets default, cmoy, meier,
  custom; cut 300–2000 Hz; feed 1–15 dB.
- `SampleRateConversionItem::SetSampleRateConversionMode(string)` (none, max_sample_rate, custom),
  `SetSRCFilterType(string)` (four), `SetDSDModulator(string)`, `SetDsdOutputRate(int)`, `SetDsdToPcmFilter(string)`,
  `SetDsdToPcmGain(double)`, `SetDsdOutputGainAdjustmentDb(double)`, `SetAllowDSDProcessing(bool)`,
  `SetParallelDSDModulator(bool)`; a custom rule's `SampleRateConversionRule::SetOutputSampleRate(int?)`.
- `ParametricEqualizerItem::SetSpec(ParametricEqualizerSpec, bool)` — the bands, sent whole — `LoadPreset`,
  `ResetToDefault`.
Headphone EQ (Roon's online database) and Convolution (a file uploaded) are left for later.

**Open, for the recording:** how each change comes — the part pushed whole or in part, and a value at its default
(0 dB, say) left out as `IsEnabled` is (§15.9); a band's members and how a band added comes; whether `SetSpec`'s bool
saves.

**t11, the recorder:** each item's part — by type, the catalogue's services: HeadroomAdjustmentItem, BS2BItem,
SampleRateConversionItem and its SampleRateConversionRule, ParametricEqualizerItem, PEQItem and its PEQFilter, and the
rest (settings-probe.js DSP_PART_TYPES) — is recorded and watched for what it leaves out, as a DspConfig is (§15.8);
the zones probe's own kinds are as they were, so lists of them don't crowd its watch (the review). A DSP update's
values are said in full (`values`): a spec's bands, which come as a list's bytes inside it (focus.js readList), each
with its members; −∞ said as text; past 6000 characters, its length and digest. Either namespace (`Sooloos.` or
`Roon.`) is taken.

**The recording asked of the owner:** the probe's settings read first (`?run=1&settings=1`: the connection is sent DSP
updates only after it asks, §15.9), then `?record=start&minutes=15`, then in MUSE, on one output, noting the order:
Headroom −3 → −6 → 0 → −3 and the clipping indicator on and off; Crossfeed's preset default → cmoy → custom, its cut
frequency and feed level changed; Sample rate conversion's mode none → max sample rate → none, and its filter changed;
Parametric EQ on, a band's gain, frequency and Q changed, a band added; then everything put back.

### 15.12 N3-5a — Headroom, Crossfeed and Sample rate conversion settings (v1.9.66-t12; the owner, 2026-10-23)

**Proven (the owner's recording, 23:39, on t11),** each change made in MUSE on TV Speaker:
- **Each part is pushed whole, a setting at its default left out** — as a DspConfigItem is (§15.9): Headroom at 0 dB
  came with no `GainDb`; the clipping indicator off, with no `ClippingIndicator`; a sample rate rule back to "same as
  input", with no `OutputSampleRate`. Every update carried the part's other members, never changing (`MinGainDb`,
  `MinCutFrequency`, `SupportedSampleRateConversionModes`, `InputSampleRate`).
- **Headroom** (`HeadroomAdjustmentItem`): `GainDb` −3 → −6 → −9 → (left out: 0) → −3; `ClippingIndicator` true, then
  left out.
- **Crossfeed** (`BS2BItem`): `Preset` default → cmoy (the server set `FeedLevelDb` 6, cut 700) → meier (cut 650, feed
  9.5) → custom, which adds `SupportsCutFrequency` and `SupportsFeedLevelDb` (only custom's values can be changed);
  `CutFrequency` 650 → 660; `FeedLevelDb` 9.5 → 9.1.
- **Sample rate conversion** (`SampleRateConversionItem`): `SampleRateConversionMode` none → max_sample_rate → custom
  (adds `SupportsSampleRateConversionRules`) → none; each `SampleRateConversionRule` (one an input rate, its
  `SupportedOutputSampleRates`) `OutputSampleRate` 48000, 44100, then left out (same as input); `SRCFilterType` through
  its four; `DsdToPcmFilter` lowpass_24khz → 30 → 50 (where the recording's 300 kept updates ran out).
- Each change paused playback a moment, as a switch does (§15.9). Parametric EQ's are to be recorded alone, playback
  paused, the zone's own updates having filled this one.

**The owner's decisions:** in the DSP window, an item's settings **open beneath it when its name is tapped** (tapped
again, they close); numbers by **− value + buttons**, in steps of 0.5 dB (headroom, feed level) and 10 Hz (cut
frequency); choices from the server's own lists.

**The graph:** each part named here is whole when pushed with the member it always carries (objects.js IDENTITY):
`HeadroomAdjustmentItem` `MinGainDb`, `BS2BItem` `MinCutFrequency`, `SampleRateConversionItem`
`SupportedSampleRateConversionModes`, `SampleRateConversionRule` `InputSampleRate`.

**What is read** (`lib/roon-direct/dsp-parts.js`, pure, with each item of §15.9 as `settings`, from its part as held):
- headroom: gain (`GainDb`, absent 0), its least (`MinGainDb`), its step; most 0 (no member says otherwise; MUSE's
  is 0); the clipping indicator (absent off), each only where its `Supports…` is true;
- crossfeed: the preset and the server's presets; cut frequency and feed level with their bounds, changeable only
  where `SupportsCutFrequency` / `SupportsFeedLevelDb` (custom);
- sample rate conversion: the mode and its modes; the filter and its types; the DSD to PCM filter and its values; in
  custom, each rule: its input rate, output (absent: same as input) and outputs — all of them or none: a list of rules
  cut short, or a rule not held, is none, said as not yet sent (the review).
A list not held is offered as the value alone; a value the server didn't send is said "Not set", never shown as the
first choice. The DSD modulator is left until it is recorded: no member says it can be changed (the review). Settings
are read only for an answer, not for every wait or search inside the connection's turn (the review).

**Changing** (`lib/roon-direct/dsp-settings.js`; the catalogue's strings, 8b67208; each answered, on the part, or the
rule): `HeadroomAdjustmentItem::SetGainDb(double)`, `SetClippingIndicator(bool)`; `BS2BItem::SetPreset(string)`,
`SetCutFrequency(int)`, `SetFeedLevelDb(double)`; `SampleRateConversionItem::SetSampleRateConversionMode(string)`,
`SetSRCFilterType(string)`, `SetDsdToPcmFilter(string)`;
`SampleRateConversionRule::SetOutputSampleRate(int?)` (a nullable int: a presence byte and the int; null for same as
input). Sent only for an item of an output of the zone (§15.9's finding), its own part, a rule of its own; a value
from the server's list, or a number within its bounds on the 0.1 grid, and only where the part says it can be
changed. Believed when the part shows it within 3 s (a number within 0.05; custom only with all its rules held, so
the answer can offer them — the review). Not sent, and sent not seen, as §15.7.
`POST /api/roon/zone-dsp/setting {zone_id, item, setting, value[, rule]}` → 200 / 409 / 503 / 400, the item as then
held.

**Shown** (`public/zone-dsp-settings.js`, loaded beside zone-dsp.js): a tapped item's settings beneath it, drawn
afresh at each opening, each a row — a select for a choice, − value + for a number (disabled only at a bound, a value
off the step clamped to it, or where it can't be changed: crossfeed's cut and feed unless custom, said), a switch for
the clipping indicator — sent on change, shown as the server then holds it, said and put back when not. An item with
nothing it can change opens nothing. The window's Tab goes round its selects too (the review).

### 15.13 Parametric EQ: saved, but not sent to Rouen (the owner, 2026-10-24, on v1.9.66-t12), and t13 — the bands read in full

**Proven (two recordings and a read after a restart, on TV Speaker):**
- MUSE's Parametric EQ switch comes as §15.9's: `IsEnabled` on the `DspConfigItem` (1335852), then left out.
- A band changed in MUSE pauses playback a moment each time (thirteen in the first recording, three in the second),
  so the change reaches the server; but **no `ParametricEqualizerItem` update came** to Rouen's connection in either
  recording — not while editing, not after MUSE was closed — though Headroom's, Crossfeed's and SRC's parts all came
  (§15.12). The DspConfig came again many times (241, then 54), always the same.
- **The server saved it:** after `docker restart`, a fresh connection's `GetDspConfig` gave TV Speaker's
  `ParametricEqualizerItem` (1344111) a `Spec` with `YAxisMinDb` −24, `YAxisMaxDb` 12 and `GainDb` −3.1, none of which
  any earlier read had (Stereo Fives' spec, 1331560, still has none).
- So: a parametric EQ's spec is **saved, but not sent to other connections** as it changes. A later `GetDspConfig` on
  the same connection answers by reference only (§15.9), so it doesn't bring the new spec either. How Rouen is to see
  a spec changed, its own `SetSpec` included, is open: settled by a `SetSpec` tried by hand before anything is built
  on it.

**t13 (read only):**
- The zones probe's DSP read (§15.2) says a DSP part's own structs in full, as the recorder does (`deep-value.js`,
  from push-log.js): a spec with each band's members, which `describe()` stopped short of ("ParametricEqualizerBand").
  One past 6000 characters, and any other kind of value, is said as before, so the read stays bounded (the review).
- The same probe asked again while one runs — a browser asking again as it waits, the owner's — is given that run's
  answer instead of "A probe is already running."; a different ask is still refused while one runs, and so is one
  with a watch, whose watch is to begin when it is asked (the review).

### 15.14 N3-5b — a Parametric EQ band's gain, tried by hand (v1.9.66-t14; the owner, 2026-10-24)

**What the t13 read showed** (TV Speaker, after a restart, beside the owner's MUSE): the spec
(`ParametricEqualizerSpec`) carries `YAxisMinDb`, `YAxisMaxDb`, `GainDb` (the EQ's own gain, −3.1) and `Bands`, a
list, each band (`ParametricEqualizerBand`) with `Type`, `Frequency`, `GainDb`, `Q`, `Order` and `IsEnabled` — a
member at its default left out, as the parts' are (§15.12). The types MUSE names: `low_shelf` (Low shelf),
`equalize_frequency` (Peak/dip), `band_stop` (Band stop: its `GainDb` kept, not shown), `high_pass` (High pass; `Order`
1 is 6 dB/octave), `high_shelf` (High shelf), `low_pass`. Stereo Fives' spec is the server's default: five bands at
0 dB, a high pass and a low pass with no `IsEnabled` (off). Bands 2–7 matched MUSE; band 1 the owner changed after the
read, which Rouen's copy then didn't show (§15.13).

**The owner's decision:** before any control is built, one change is tried by hand on TV Speaker, Rouen restarted
first and MUSE left alone until it is done, since Rouen's copy may be older than MUSE's.

**t14, the try** (`lib/roon-direct/peq-try.js`, `GET /api/debug/roon-peq?zone=&band=&gain=[&send=1][&save=0]`):
- The zone's one Parametric EQ item, found by a read on this connection (zone-dsp.js); its part's spec as held.
- One band's `GainDb` changed — a shelf or a peak/dip, −24 to 24 dB on the 0.1 grid — every other member as held.
- `ParametricEqualizerItem::SetSpec(ParametricEqualizerSpec, bool, Base.ResultCallback)` (the catalogue's, 8b67208;
  the allowlist's fifty-seventh), the spec written with the members the server itself declared for each type, in its
  order (the graph's types: no list of Rouen's own to drift), a list as its length, count and items. The bool is sent
  true unless `save=0`: what it means is what the try is to show.
- Two checks before anything is sent: the bands held, written again under the server's own type ids, are the very
  bytes it sent (else a member was passed over unread, and the band would go back short: the review); and the spec
  written reads back, by the same reader, as the spec meant. A value Rouen can't write as declared (a type the server
  never declared, a reference) is refused, never guessed. Each type is the server's own by its full name, never one
  of the same short name in the other namespace (the review); a list's items by the codec focus.js reads them with.
- Without `send=1`: the spec it would send (`sends`), beside the bands held, to be compared with MUSE; nothing reaches
  the server, not even a type's declaration (the review). With it: sent once, the answer said, and — when it was taken,
  or may have been — each update of the item or its part for 5 s after (or that none came), and the spec as then held.
  One refused or never sent is said so, not waited on (the review).
- The zone's DSP not read (the connection busy, an output not read) is said, not taken for "no Parametric EQ"; a band
  empty, or without a type, is said (the review).

**Open, for the try:** whether `SetSpec` is taken; whether MUSE then shows the band and every other band unchanged;
whether the server sends the change back to the connection that made it; what the bool does.

**Proven (the owner's try, 2026-10-24, on t14, TV Speaker):** the preview's `held` matched MUSE band for band; band 2
→ −11.0 dB sent with the bool true: **taken**, and MUSE then showed band 2 at −11.0 with every other band and the EQ's
own gain as they were. **Nothing came back** to the connection that sent it in 5 s: the server tells no connection of a
spec's change, its sender's included. What the bool does when false is not tried; t15 sends true, as the try did.

### 15.15 N3-5c — Parametric EQ in the DSP window (v1.9.66-t15; the owner, 2026-10-24)

**The owner's decisions:**
- **A fresh read for each change:** the spec is read on a short connection of Rouen's own before each change — so a
  change is made on the spec as the server holds it now, and a band changed in MUSE before it is kept — and after it, to
  see it taken. Each change takes a few seconds. A band changed in MUSE in those same few seconds (between Rouen's read
  and its send) can still be put back: the server offers no way to send a change of one band alone (the review).
- **Controls:** each band's gain, frequency and Q by − value +, and each band on or off. A band's type, and bands added
  or removed, stay in MUSE.
- **Steps and bounds:** gain 0.5 dB, frequency 1/12 octave (rounded to whole Hz, at least 1 Hz), Q 0.1; gain −24 to
  24 dB, frequency 20 Hz to 20 kHz, Q 0.1 to 10. A value off the step goes to the next one on it. The steps are the
  window's; what Rouen accepts and sends is any value within the bounds on the server's own grid — 0.1 dB, 1 Hz, 0.1 —
  since MUSE's own values are on it (−11.8 dB), and a value is believed within half that grid (the review).

**Which settings a band has** (as MUSE shows them, §15.14): gain on a shelf or a peak/dip; Q on those and a band stop;
frequency and on/off on every type. A high or low pass's slope (`Order` × 6 dB/octave) is shown, not changed. The EQ's
own gain (the spec's `GainDb`) is shown, not changed.

**The fresh read** (`lib/roon-direct/peq-fresh.js`): a connection opened for it (its own client id, as stage 0's probe
opened one: session.js `connectFirst`), the root read (`readRoot`), the output's `AudioDeviceCommonConfig` waited for as
the server sends it, `GetDspConfig` asked (a read, on the allowlist), the EQ's part waited for, its spec read whole
(peq-spec.js `plainOf`, exact: bands read short are refused), and the connection closed. One read at a time; the same
read asked again before it starts shares it (a panel opened and closed again queues no read after read), while one
asked once it has started is a new read (a read after a change begins after it); a read past 20 s is said too slow and
its connection closed (the review). The output
is the one whose DSP holds the item (zone-dsp.js `locate`, which now says its CommonConfig); the part, the item's
`ParametricEqualizer`. The ids are the server's own, the same on every connection (§15.13's reads across restarts).

**A change** (`lib/roon-direct/peq.js`, `peq-spec.js`): the item located on the zone; the spec read afresh; the one
band's one setting checked (a band of the spec, a setting of its type, within the bounds on its grid) and changed on a
copy, under the member's own full name or, left out, the one the server declared; written with the link's declarations
and read back before it is sent; `ParametricEqualizerItem::SetSpec(spec, true)` sent once in the link's turn; the spec
read afresh again and believed when it shows the value (within half its grid; on/off exactly). Not sent, sent and not
seen, as §15.7: the bands then read are shown, not as sent. Changes to one EQ are made one at a time, read to read: two
close together would otherwise each send the spec as it was before the other (the review). A request that can't be met
(not an EQ, a setting the band hasn't, a value out of bounds) is answered 400, not as the server out of reach. The hand
try (§15.14) now checks, changes and encodes through peq-spec.js too (`check`, `changed`, `encode`).

**Routes:** `GET /api/roon/zone-dsp/peq?zone_id=&item=` → 200 `{ item: { id, gain, bands } }`, or 503 `{ why }`;
`POST /api/roon/zone-dsp/peq {zone_id, item, band, setting: gain|frequency|q|on, value}` → 200 / 409 / 503 / 400 (a
request that can't be met, as above). A GET for an item that isn't an EQ is 400 too.

**Shown** (`public/zone-dsp-peq.js`, loaded beside zone-dsp-settings.js, drawn with its rows): the EQ's name opens its
bands beneath it, as the other items' settings (§15.12), each opening read afresh ("Reading the EQ from your
server…"): the EQ's own gain; each band a row with its number, type and an On/Off switch, then its gain, frequency and
Q as − value +, disabled only at a bound. A band of a type Rouen doesn't know is said On or Off, with no switch (the
review). A change disables the panel, says it is sending, and draws the bands as the server then holds them; one not
taken is said on the window's status line.

**Proven (the owner, 2026-10-24, on t15, TV Speaker):** the bands read in the window match MUSE; a change in MUSE shows
in Rouen when the EQ is opened again; changes made in Rouen were each taken and seen (every `POST
/api/roon/zone-dsp/peq` answered 200, 1–2 s each; each fresh read about 0.6 s) and MUSE showed them once its EQ screen
was opened again — MUSE, like Rouen, is not told of a spec's change while its screen is open.

**The owner's decision — DSP ends here (2026-10-24):** most DSP is set once and left, and is best set in Roon's own app
on a tablet or desktop; Parametric EQ is what gives a phone-only listener a way into DSP. So no more DSP work: the
DSD modulator, Headphone EQ, Convolution and the rest stay in MUSE. Next, in the owner's order: device settings, then
grouping and transfer.

**The owner's decision — grouping and transfer stay as they are (2026-10-24):** Rouen already groups, ungroups and
transfers through the official API (`group_outputs`, `ungroup_outputs`, `transfer_zone`), and the owner finds it good
enough; the native calls (`Transport::LinkEndpoints` / `UnlinkEndpoints` / `Transfer`, §2's table) are not built.

## 16. Full native mode — everything but DSP (the owner, 2026-10-27)

**The owner's words:** "My plan here is to use Native Mode as default and slowly I'll just turn off the original
mode and it'll just be native mode only"; then "Do what is needed to do full native mode except for the DSP we have
not tackled". So §5's phases are finished, every feature given its native path, and the official API kept only as
the fallback while native mode is off or failing — until the owner turns it off.

### 16.1 What still goes through the official API (an inventory of v1.9.70-t1's code, 2026-10-27)

With native mode on, these still use the official API alone:
1. **Zone state:** the zone list, what plays, play/pause state, the position, volume shown, outputs (`subscribe_zones`,
   `subscribe_outputs`); native transport is believed by this feed (§14.3).
2. **The queue:** read, the next track's waveform peek, play from here (`subscribe_queue`, `play_from_here`).
3. **Playing:** an album, a track, play next, add to queue, play-multi, play-unheard, the shortcuts, Random Album
   Radio's top-up and resume, history replays (browse action menus, `album-open.js`, `loadAlbumSession`).
4. **Album pages:** tracks, discs (`loadAlbumSession`), the now-playing album lookup, the stale-offset search,
   Dynamic Playlist track lists, add-albums-to-playlist, share import.
5. **Grouping, transfer, standby, convenience switch, pause all, mute all.**
6. **Genres, tags, Roon's label tree,** the album → genre harvest and filtered random picks.
7. **Ordinary Roon playlists:** list, page, play, play a track, cover mosaics; native playlist writes believe this list.
8. **Covers** (`RoonApiImage.get_image`), and covers by the server's own keys (§12.17's open point).
9. **TIDAL and Qobuz browsing and playing through Roon** (`streaming.js`).
10. **The library walk** (`buildAlbumIndex`), its change watch and the import check: the native list is laid over the
    official one and keyed by its offsets, and native re-reads follow the official watch.
11. **Artist pages' facts** (members, photo, biography): Rouen's own sources (`album-credits.md` §7) — the server's
    own (`Library::GetPerformer`) not read.
12. Roon Radio switched off when Rouen's own radio starts (`change_settings`), and radio's resume (`control`): they
    bypass the native transport.

**Stays official by its nature:** the pairing, the extension's status line and its settings page inside Roon. They are
the extension's identity, and native mode finds the server by the pairing (`stage1.js`). Not native work.

### 16.2 The methods (the upstream catalogue at 8b67208)

| Need | Method | Upstream status |
|---|---|---|
| Zone state | the Zone pushed whole (§15.4): `State`, `SeekPosition`, `NowPlaying` (a `TransportItem`), `Queue`, the allowed flags; the Endpoint's `VolumeDouble`, mute | members proven §14.2, §15.4–15.5; `NowPlaying`'s own members not yet read |
| The queue | `Queue::GetItems(ResultCallback<IList<TransportItem>>)` read; `Queue::PlayFromHere(TransportItem)`, `RemoveItems`, `MoveItems`, `RemoveAll` | not run |
| Playing | `Transport::PlayAlbum(Zone, Sooid, PlayParameters, AlbumBase, bool, bool, cb)`, `PlayTrack(s)`, `PlayAlbums`; `PlayParameters.Priority` for now / next / queue | `PlayAlbum` **heard playing** upstream (`live-play.ts`); Rouen's `PlayPlaylist` proven (§12.4) with the same `PlayParameters` |
| Album pages | `Library::GetAlbum(AlbumBase, cb)` (an `Album`: tracks, credits, genres, labels, review, image), `GetAlbumTrackLites(AlbumBase, cb)` | not run |
| Artists | `Library::GetPerformer(PerformerBase, cb)` (a `Performer`: `Members`, `MemberOf` as `PerformerRelationship`s, `Biography`, `YearsActive`, `Photo`, `Type` Individual/Group) | not run |
| Genres, tags | `Library::GetToplevelGenres(GetGenreParameters, cb)`, `GetGenre`, `GenreQuery`; `GetAllTagLites(Profile, cb)`, `TagQuery`; `LabelQuery` | not run |
| Covers | an `Image` object's members (`Url`, `Sizes`, `ImageId`) | not read |
| Grouping, transfer | `Transport::LinkEndpoints(Zone, IEnumerable<Endpoint>, cb)`, `UnlinkEndpoints`, `Transfer(Zone, Zone, cb)` | not run |
| Standby, switch, pause all | `Endpoint::Standby()`, `ToggleStandby()`, `ConvenienceSwitch(cb)`; `Transport::PauseZones()` | `Standby` **run live** upstream (`live-standby.ts`) |
| Streaming | `Tidal::` / `Qobuz::` services (`GetPerformer`, `GetPerformerMainAlbumLites`, …); `UnifiedSearch` (proven, §9.1) | not run |

### 16.3 The order

Each build its own branch into `dev`, each new method a line of this design and of the allowlist before it is sent,
reads before writes, every write tried by hand (or believed only when the server shows it) before it replaces the
official path, the official path the fallback throughout.

1. **N7-0, the reads probe (v1.9.70-t3), read only, run by hand** (§16.4): every new read above, once, on the owner's
   server. It settles the forms the rest depend on: what a `NowPlaying` and a queue item carry, an album and its
   tracks, a performer's members (and whether a former member is told from a current one — the owner wants current
   members only, `album-credits.md` §7), genres, tags, an image's members.
2. **N3-6, zone state native:** the zone list, now playing, state, position, volume and mute from the graph, by
   §15.4's whole-push rule; native transport believed by it; the official feed the fallback.
3. **N4, playing native:** album, track, next and queue (`PlayAlbum`, `PlayTrack(s)`, `PlayParameters`), Random Album
   Radio and the shortcuts with them; Roon Radio's hand-over through the native transport.
4. **N5, album pages and the queue native:** `GetAlbum`, its tracks; the queue read and changed.
5. **N6, the rest of the library:** genres, tags, labels, artist pages (members, photo, biography) from the server,
   covers by the server's own keys, ordinary playlists read natively, then the library list read without the official
   walk (keyed by the server's own album ids, not offsets) and its change watch.
6. **N8, devices:** standby, the convenience switch, pause all, mute all; device settings shown read only (§14's
   decision 2), each made changeable only one at a time, each tried by hand first (§15's decision 2).
7. **N9, TIDAL and Qobuz through the server's own services.**

**Open for the owner** (asked with the probe; nothing below is built before the answer):
- **Grouping and transfer.** The owner kept them on the official API (§15.15, 2026-10-24). With the official API to be
  turned off, they would need `LinkEndpoints` / `UnlinkEndpoints` / `Transfer`: in, or left as they are until then?
- **Device settings** changeable one at a time (§15's decision 2), or shown read only for now?

### 16.4 N7-0 — the reads probe (v1.9.70-t3), read only, run by hand

`GET /api/debug/roon-native-reads` says what a run would do and asks nothing. With `?run=1` (and optionally
`&title=&artist=` for the album — the title alone matches by the title — else the library's first; `&zone_id=` for
the zone, an id no zone has said so, else the first playing, else the first), in native mode's turn, on its
connection, each read once, every answer given whole (settings-probe.js's `answer` and `whole`), each step in its own
try so one refused, or one that throws, leaves the others:
1. **The zone** (no call): its `NowPlaying` and `Queue` objects whole, as the graph holds them.
2. `Queue::GetItems` on that queue — the items it answers, whole (at most 20).
3. `Library::GetAlbum(AlbumBase, cb)` for the album (its object id, as every by-reference argument) — whole.
4. `Library::GetAlbumTrackLites(AlbumBase, cb)` for it — whole.
5. `Library::GetPerformer(PerformerBase, cb)` for the album's first main performer (the first `PerformerLite` of step
   3's `MainPerformers`, else its `Performers`; a list member read as every list member is, `focus.js` `readList`) —
   whole: `Members`, `MemberOf`, `Biography`, `YearsActive`, `Photo`, `Type`. Read from the `Album` answered, loaded;
   else the library read's `AlbumLite`, if still held (it seldom is: each is let go once read); else skipped, said why.
6. `Library::GetToplevelGenres(GetGenreParameters { IncludeHidden: false }, cb)` — whole.
7. `Library::GetAllTagLites(Profile, cb)` for the profile chosen — whole.
8. **An image** (no call): the album's `Image` object whole, from step 3.

Nothing is written; no read here is new as a kind (each is a call with an answer, as `GetTrackEditInfo`); an answer the
graph can't read is given as its first bytes. The answer says, per step, the object called and what was sent with it,
what came, and how long; an object it names that the server didn't push with it (only held from before) is said so,
and a list's items alike. Once a call goes unanswered nothing more is sent — not even a struct's type declaration, so
each call's arguments are built only once the connection is known to be certain (the review).

**What no debug answer shows (v1.9.70-t9).** A walk "whole" follows references as far as they go, and t4's reached
the server's Roon account (`UserId`, `Token`, `FirstName`, `LastName`, `Email`) and its remote-access status (the
home's `ExternalIPAddress`, the machine's `PhysicalAddress`). The owner pasted it into a conversation. Every answer
under `/api/debug` now goes through `lib/roon-direct/withhold.js`, mounted in `index.js` before any route: every
member of an `Account` or a `RemoteAccessStatus`, whatever it is called; any member named as above, or whose name
says token, password, secret or credential; and a change the push recorder lists under such a name. Each is replaced
by "(withheld by Rouen)" where it says something (a string or a number); true/false, null and "" stay. The devices'
LAN addresses (`IPAddress`) stay: finding a device needs them. An answer the graph couldn't read, given as hex, can't
be told apart by name and is not covered.

### 16.5 What the owner's server showed (2026-10-27, v1.9.70-t3), and t4

The owner ran §16.4 with `title=The Number of the Beast&artist=Iron Maiden`, on Stereo Fives, paused.

**Proven:**
- **Zone state is all there, natively.** The Zone matched by its id carries `State` (2, paused), `SeekPosition`,
  `NowPlaying`, `Queue`, the allowed flags, Roon Radio and the levelling members; its Endpoint `VolumeDouble` (40,
  the official 40), `SourceControls` and **`LinkCandidates`** — the outputs it can be grouped with (Stereo Fives,
  TV Speaker), what grouping will need.
- **What plays:** `NowPlaying` is a `TransportItem` (`TransportItemId`, `IsCurrent`) whose `Tracks` is a
  `DataList<TransportTrack>`; each `TransportTrack` names its `Track`, a `TrackLite` with `Title`, `LengthSeconds`,
  `TrackNumber`, `MediaNumber`, `Format` ("FLAC 44.1kHz 16bit"), `SampleRate`, `BitDepth`, `HasLyrics`, the file's
  `ContentLocation`, its `Album` (an `AlbumLite` by reference — for the one playing, named and not pushed) and its
  **`Credits`** inline (a `DataList<Credit>`, each with its Role, Type and Performer's name: "Primary Artist" Joe
  Bonamassa, "Toy Piano" Kevin Shirley). So now playing can be drawn natively: title, artist (the Primary Artist
  credits, or the album's `PerformedBy`), album, length, quality.
- **The queue is history and what's to come in one:** the `Queue` object says `Count` 8000, `CurrentItemIndex` 7980,
  `TrackCountRemaining` 20, `LengthSecondsRemaining` 6396. `Queue::GetItems` answered the whole of it — 8,000 items, a
  LengthPrefixed list of references, in 10.5 s, 2,067 of them already held and not pushed again. What Rouen's queue
  sheet shows is the items from `CurrentItemIndex` on; reading all 8,000 for 20 is not how it is built (N5 looks for
  a paged read: `Queue::ItemsQuery`, or the items from the current one).
- **`Library::GetAlbum(AlbumBase)` answers by reference** (to an Album object of its own, 29445748), but the Album
  hadn't been pushed within the 2.5 s waited.

**Not read:** straight after GetAlbum the connection closed ("connection closed: probe finished" — the session closed
under the probe), so GetAlbumTrackLites, GetPerformer, GetToplevelGenres and GetAllTagLites are still untried, and the
performer's members unknown. Why it closed, the answer couldn't say. The likeliest reading: the 8,000 items' objects
(each item its TransportTrack, TrackLite, credits and lists) took the graph near its cap or past it, and the link's
health check closed and reopened the connection (`link.js` `check`: "the Core's objects reached the cap Rouen keeps").
Not proven; t4 shows it. ("probe finished" itself rules out the server dropping the line: that would read "the
connection closed". It is Rouen's own link closing the session — its check, the nightly reconnect, or a cycle.)

**t4 (v1.9.70-t4), the probe changed, still read only:**
1. The connection's state is said before the reads and after each step: objects held, the cap, `overflowed`,
   messages that couldn't be read, a call unanswered, the keepalives (sent, answered, missed: three missed and the
   link's check closes the connection), whether the connection is still the link's, and, once it isn't, the link's
   own last reason (`lastDown`).
2. The order: the album, its tracks, its performer and image, the genres, the tags first; the zone (no call) next; the
   queue's items last, and **only with `&queue=1`**.
3. `GetAlbum` waited for up to 8 s; an Album still not come is looked for again at the end (`albumLater`).
