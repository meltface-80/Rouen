# Native remote — design

Status: **approved by the owner 2026-10-14 (merged as #223); N1a built in v1.9.21.** This document is the
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

Why the change of course: stage 1 kept Rouen's own picture of the library — built through the
official API — and paired each album with the Core's by title and artist. A handful never paired,
and an unpaired album had no true answer. A native remote has nothing to pair: Rouen's library
**is** the Core's list, each album carrying the Core's own identity, source and details.

## 2. What the protocol is known to do (research, 2026-10-14)

From Arthur Soares' roon-api-reverse-engineering (read, not run): what its own client has run
against a Core ("live"), what Roon's own app was seen calling ("captured"), and what is only a
signature in the catalogue. Rouen's own runs (stage 0, v1.9.11–v1.9.18) are counted as live.

| Need | Native call | Evidence | Plan |
|---|---|---|---|
| The library's albums | `Library::VirtualAlbumQuery` + pages | **live (Rouen, v1.9.18)** | N1a |
| An album's tracks and details | `GetAlbum`, `GetExtendedTrackInfo`; `GetAlbumTrackLites` | captured; catalogue | N1c, tried in the build (§3.3) |
| Covers | — none known returns image bytes | — | official API's image service (§3.4) |
| Play an album | `Transport::PlayAlbum` (with `ResultCallback<PlayFeedback>`) | **live, audio confirmed** | N1b |
| Play next / add to queue / play from here | `PlayParameters.Priority` (Next 3, Queue 4), `IsFromHere` | catalogue | N2 |
| Play a track | `PlayTrack`, `PlayTracks` | captured | N2 |
| Zones, outputs, now playing | the root graph's Zone/Endpoint objects, kept up by UPDATEOBJ | **live** (field names of now playing unproven) | N2 |
| Pause, standby, convenience switch | `Zone::Pause`, `Endpoint::Standby`, `ConvenienceSwitch` | **live** | N2 |
| Play, next, previous, stop | `Zone::Play`, … | upstream's web client | N2 |
| Volume | `Endpoint::SetVolumeDouble` | captured | N2 |
| Seek, mute, shuffle, repeat, Roon Radio | `Seek`, `SetMute`, `SetShuffle`, `SetLoop`, `SetAutoSwim` | catalogue (no reply: confirmed by the next update) | N2 |
| Queue: read, remove, move, clear | `Queue::ItemsQuery`/`GetItems`, `RemoveItems`, `MoveItems`, `Clear` | catalogue; remove/move encoding checked elsewhere | N3 |
| Search | `UnifiedSearch` | **live (library)**; TIDAL/Qobuz results unknown | N4 |
| Artists | `VirtualPerformerQuery`, `GetPerformer`, `BrowsePerformerAlbums` | captured | N4 |
| Focus (genres, labels, …) | `Library::GetAlbumQueryInfo` | catalogue | N4 |
| Play history | `VirtualHistoryQuery` | **live** | N4 |
| Heart, Listen Later, add to library | `FavoriteOrBan`, `SetListenLaterState`, `AddToLibrary` | live once, needs re-proving; catalogue | N5, after the login |
| Releasing objects | `GCOBJS` | **format unknown** | §4: reconnect instead |

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
that keeps the snapshot in step with Roon. Until album pages and playing go native (N1b, N1c), an
album is still opened through the official API, at the offset of that list's row with the same
title and artist — the same strings first, then the same once normalised as an album open compares
them, never a title that normalises to nothing ("+", "=", "στίγμα" in the owner's library would
otherwise all be one album). The same title and artist twice: one row each, in order, which copy
each is the official list cannot say (N1b ends it). A Core album with no row: an offset far past
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
| **N1b** | playing an album (`PlayAlbum`), by the Core's own album | the play routes' album side |
| **N1c** | album pages (`GetAlbum`, its tracks) | the album page route; the album index build and upkeep |
| **N2** | zones, outputs, now playing, transport, volume, play track / next / queue | zone, transport and volume routes; radio's transport calls |
| **N3** | the queue: read, remove, move, clear, play from an item | queue routes and queue history |
| **N4** | search, artists, Focus counts, genres, play history | search, artist, facet and genre code |
| **N5** | hearts, Listen Later, add to library — after the optional login (`roon-native.md` §7) | the service favourite routes' Roon side |
| **N6** | the public provider only as fallback; the `/music` mount and service sign-ins optional extras | what is left |

## 6. Files

New code: modules under 500 lines, `// @ts-check`, with tests against the fake Core
(`test/lib/fake-roon-core.js`, extended per call), which is not evidence (§2's "live" column is).
Each phase moves its feature's official-API code into `lib/provider/public/` unchanged, and
`public/app.js`'s screens it touches into `public/<screen>.js`, ratcheting the baselines in the
same commit, until no file is over 850 lines.

## 7. For the owner

1. This plan, as a whole, and N1 as the first build.
2. Covers through the official API's image service (§3.4), there being no native way.
3. Calls not yet proven tried inside the builds, each feature falling back on its own and Settings
   saying which (§3.3), instead of separate probe builds.
4. The nightly reconnect at 04:00 (§4).
