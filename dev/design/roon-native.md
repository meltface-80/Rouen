# Roon-native library — design

Status: **stage 0 (the probe) built in v1.9.11, run on the owner's Core with v1.9.12 and, with its Locations probe, v1.9.13
(2026-10-13; results in §9.1); its album pages run with v1.9.16, and its sample page of the largest Locations with v1.9.17. Stage 1 (§10), OK'd by the owner on 2026-10-14, built in v1.9.18 and run on the owner's Core the same day; v1.9.20 follows that run (§10.3).** The owner's answers to §8 are recorded there (2026-10-12);
any question still open goes to the owner before code that depends on it. This document is the specification for the work it describes: code matches it,
or this document changes first, in the same commit (see `CLAUDE.md`, "Spec authority").

## 1. Goal (the owner's words, 2026-10-12)

> All the information/data of the library comes from Roon. Favouriting in Rouen fires Roon's
> favourite. Adding a TIDAL or Qobuz album in Rouen adds it to Roon directly, not via the
> streaming service and then into Roon.

And on 2026-10-14: *"I want Rouen to become as closely possible to being a native UI to Roon as
Roon Remote is."* So Roon's private protocol becomes the source wherever it has been proven, area by
area, each read-only before any write; the public extension API stays as the fallback for whatever
is off, failing, or not yet moved (§3, and `CLAUDE.md`).

That means retiring three workarounds:

| Workaround today | Why it exists | What it gets wrong |
|---|---|---|
| A `/music` path mounted into the container, walked for tags | The extension API never says whether an album is local | Badges are a name-match between file tags and Roon's metadata, which Roon rewrites |
| Qobuz and TIDAL sign-ins inside Rouen | The only way to learn which albums are streamed, and to favourite/add | A second account view that can disagree with Roon's; tokens to keep alive |
| Source inferred by elimination (`albumSource()` / `unclaimedIsLocal()`, `index.js` ~4380–4455) | Same | **Reported 2026-10-12: a test library of 2 local + 6 TIDAL albums showed 4 as local.** Any album the extension's own lookups fail to claim falls through to "local" whenever Roon's services are not detected, or matches a local title by name |

The fault is structural, not a bug in the matcher: the public extension API (port 9330) carries no
source for an album, so every answer Rouen gives is an inference. No amount of matching fixes an
inference. The fix is to ask the Core.

## 2. The source: Roon's internal protocol

`arthursoares/roon-api-reverse-engineering` **v0.1.1** (MIT, © 2026 Arthur Soares): a TypeScript
client for the protocol Roon's own desktop app speaks to the Core — `Sooloos.Broker.Remoting`,
binary, raw TCP **port 9332**. Decoded from Roon's decompiled assemblies; 146 services / 1,509
methods catalogued; typed wrappers generated for all of them.

### What it offers this design (from `src/catalog/catalog.json`)

| Need | Method / field | Upstream status |
|---|---|---|
| Is an album local / TIDAL / Qobuz | Query criteria `RequireIsLocal` / `RequireIsTidal` / `RequireIsQobuz` (and `Exclude…`) on `TrackQueryCriteria`, used by `Library.VirtualTrackQuery`. **Corrected in v1.9.11:** this table first named `Album.GetAlbums`, which is a performer page's album list (`GetAlbumsMode`, `PerformerAlbumQueryCriteria`) and takes no source criterion; and `AlbumQueryCriteria` has no source flags at all, only `RequireLocations` (Location objects). An album's source is its tracks' | **Not run live**. The path it runs on is: the upstream's `VirtualAlbumQuery` (run live) and its history export's Count → pages → `Dispose` lifecycle (run live) |
| Favourite an album (Roon's heart) | `Library.FavoriteOrBan(profileid, album: AlbumBase, state, cb)` | **Run live** — album favourite UI-confirmed |
| Add a streaming album to the library | `Library.AddToLibrary(album: AlbumBase)` (also `(profile, album)`) | **Not run live** |
| Find a streaming album to add | Core `UnifiedSearch` | **Run live** (in-library scope validated) |
| Roon's own Listen Later | `Library.SetListenLaterState(...)`, `GetListenLater(...)` | Not run live |
| TIDAL / Qobuz favourites, as Roon sees them | `Tidal.GetFavoriteAlbums`, `Qobuz.GetFavoriteAlbums` | Not run live |
| Play history | bounded history reads (`history-export.ts`) | Run live |

### What it costs — stated by its author and by Roon's CTO

1. **It will break.** Private, unversioned; Roon changes it in lockstep with its own client. Any
   Roon update can break it without warning.
2. **It can hurt the Core.** The protocol assumes trusted callers: handles must be released,
   subscriptions torn down, callbacks completed. A reverse-engineered client may not get those
   right, and the cost is memory/compute leaked *inside the user's Core*.
3. **Little of it is proven.** One person, one Core. Favourite, play, pause, standby, a metadata
   edit, search and history were run live; the other ~1,500 methods were generated, never run.
4. **No authentication.** Anyone on the LAN can drive the Core with it. Rouen adding it does not
   create that exposure, but Rouen must never widen it (no proxying of raw calls to the browser).
5. **It needs the Core's 16-byte server broker id**, which upstream reads off a packet capture.
   *Hypothesis to test first:* it is the `core_id` UUID the public API already hands Rouen at
   pairing. If it is not, the feature needs a way to find it without the user running tcpdump.
   Upstream's own notes (v1.9.11 reading) sharpen it: discovery gives the Core's `unique_id` as a
   textual UUID whose wire bytes are in .NET Guid order (first three groups byte-reversed), and
   node-roon-api pairs with the Core it found by that `unique_id`. So the probe tries, in turn, an
   id given by hand (`&broker=`) when there is one, then the `core_id` in .NET order, then as
   written.
6. **It is TypeScript and not published to npm.** Rouen is plain JavaScript with no build step.

## 3. Principles for using it "lightly"

- **The private protocol is the source wherever it has been proven; the public API is the
  fallback** (owner, 2026-10-14; before then the public API was the foundation). Pairing, zones,
  transport, browse and images stay on the public API until an area is moved, each move a stage of
  its own: proven read-only on the owner's Core, then switched on. Whatever is off or failing falls
  back to the public API's way, so Rouen always works without it.
- **Optional, and off until proven.** Settings → Roon → "Roon direct (experimental)". Off: Rouen
  behaves exactly as today. On and failing: Rouen says so plainly and falls back to today's
  behaviour; nothing silently degrades to a guess presented as fact.
- **One connection, a short allowlist of methods.** A module may call only the methods named in
  §4; adding one is a spec change. No generated 12,000-line API is vendored.
- **Every handle released, every subscription closed** — pinned by tests against recorded
  replies, and a connection-level budget (max in-flight calls, timeouts) so a stall cannot pile up
  work inside the Core. What "released" means, as found in v1.9.11: a query is let go by its own
  `Dispose()`, a retained page by `ReleasePage(n)` — both sent without waiting, because the Core
  never answers them, and each exactly once (releasing twice corrupts the Core's count). The
  protocol's general release command (`GCOBJS`) is listed upstream but its format was never worked
  out, so objects the Core pushes on its own (the graph) cannot be released one by one: stage 0
  opens one short connection per run and closes it gracefully — writes flushed before the FIN, so
  the last `Dispose` is not lost — on the assumption that the Core drops a client's objects when
  its connection closes. That assumption is unverified; it is why stage 0 is a one-off by hand and
  not a connection Rouen keeps open.
- **Reads before writes.** No mutating call ships until the read path has run on the owner's Core.
- **Checked after every update, closed on any failure** (owner, 2026-10-14, §8.5). After a Rouen or
  a Roon Core update, nothing read before it is used until a read-only check has passed; a failure
  of that check, or of anything else, turns the feature off and says why. It does not retry in a
  loop.

## 4. Scope by stage

Each stage is its own version and its own review. A stage starts only when the previous one has
run on the owner's Core.

| Stage | Delivers | Methods allowed | Replaces |
|---|---|---|---|
| **0 — probe** | `GET /api/debug/roon-direct?run=1` (without `run=1` it connects to nothing): handshake with each broker-id candidate, then what the Core pushes on connect (profiles, the Library's own album and track totals, the storage Locations), then per source a track query with `RequireIsLocal` / `IsTidal` / `IsQobuz` and its Count; a source with at most 2,000 tracks is paged through and the albums its tracks belong to are counted. Then (v1.9.13, the Locations probe, §9.1) an album query with no criterion as a control, and one per Location the Core pushed with `RequireLocations` = [that Location]; only each query's Count is read. A failed control asks about no Location; a Location's query object that never arrives stops the rest. The verdict is "filtered" only when two Counts the Core sent as numbers differ, one of them between 0 and the control (see §9.1). Then (v1.9.16, the owner's choice, §9.1) each Location that stands for a source (category 100 or 300: local; type 406: TIDAL; 407: Qobuz) and holds at most 2,000 albums is paged, every page released, within a budget of 60 pages in all: its albums (its rows' Data, each page waited on until their fields arrive) are checked, by object id in the same session, against the albums its source's tracks belong to — only when every Location of that source was read whole, and only when those tracks were; otherwise one page is read as a sample, as it is (v1.9.17) for a Location of more than 2,000 albums — and each album's own `ContentSource` is read against its Location's source, with its cover's image key and its title and artist reported for the first few (what stage 1 would match Rouen's albums by). Read-only, run by hand. On the 8-album test library the right answer is 2 / 6 / 0 | GETSVC on the root service; `Library::VirtualTrackQuery`; `VirtualTrackLiteQuery::RetainPage`, `::ReleasePage`, `::Dispose`; `Library::VirtualAlbumQuery`; `VirtualAlbumLiteQuery::RetainPage`, `::ReleasePage` (v1.9.16), `::Dispose` (signatures in `lib/roon-direct/methods.js`) | nothing |
| **1 — source from Roon** (§10, v1.9.18) | Badges and the Source focus read from the Core: each album's `ContentSource`, matched to Rouen's album by title and artist; an album not matched keeps today's inference | GETSVC on the root service; `Library::VirtualAlbumQuery` (no criterion); `VirtualAlbumLiteQuery::RetainPage`, `::ReleasePage`, `::Dispose` — all already run in stage 0 | `albumSource()` inference, for the albums matched |
| **2 — Roon favourites** | The heart in Rouen = Roon's favourite, read back from the Core | `FavoriteOrBan(album)` | Qobuz/TIDAL favourite calls |
| **3 — add to library** | "Add to library" on a TIDAL/Qobuz album found in Rouen calls Roon | `UnifiedSearch`, `AddToLibrary(album)` | add-via-service-favourite |
| **4 — retire workarounds** | Service sign-ins and the `/music` mount become optional extras for what Roon cannot provide (§5), or go | — | — |

### Module layout (all under the 500-line gate, `// @ts-check`)

```
lib/roon-direct/                      as built for stage 0 (v1.9.11)
  wire.js, frame.js                  wire format: flex integers, reader, writer, frames
  connection.js                      socket, handshake, graceful close
  remoting.js                        calls, method/type declarations, pings, the budget
  objects.js                         the pushed object graph (capped in size)
  schemas.js                         the by-value structs sent, member for member
  methods.js                         the §4 allowlist, typed by hand, and the guard that refuses the rest
  brokerid.js                        broker-id candidates from the core_id
  probe.js, route.js                 stage 0
  locations.js                       stage 0's Locations probe (v1.9.13), and its album pages (v1.9.16)
  paging.js                          a query's pages, retained, gathered, released (tracks and albums, v1.9.16)
  albumsource.js                     what the album pages say: against the tracks, and ContentSource (v1.9.16)
  session.js                         one connection: handshake, root service, graph (shared, v1.9.18)
  albums.js                          stage 1: the whole album list read (v1.9.18)
  source.js                          stage 1: matching Rouen's albums to Roon's, by title and artist (v1.9.18)
  stage1.js                          stage 1: the switch, the reads, the check after an update (v1.9.18)
  LICENSE                            the upstream's MIT notice
```

Ported, not depended on: upstream is not on npm, TypeScript, and changes under us. Each ported file
names its upstream path and commit (8b67208); `lib/roon-direct/LICENSE` carries the MIT notice.
`source.js` and the start/stop/fallback module (`stage1.js`) came with stage 1. The one change to the captured
ConnectRequest: its client name ("HQ-00452", the machine it was captured on) is "RouenApp", the
same length, so no length byte in the template moves.

## 5. What Roon cannot provide

Roon never gives an extension — public or internal API — the audio. So:

- **Waveforms** need the samples: local files through `/music`, streaming through the service's own
  signed URLs (the Qobuz/TIDAL sign-ins). Retire both and waveforms go.
- **File-tag dates and labels** come from the `/music` walk today. Roon's album objects may carry
  both; unverified until stage 0/1.

## 6. Testing

- Wire format: round-trip tests against upstream's captured fixtures (`captured_signatures.json`,
  `search-collections.json`), copied with attribution.
- `source.js`: pure, fixture-driven, including the reported 2 + 6 library.
- Handle lifetime: a fake Core that records every handle opened and fails the test if one is
  still open at teardown.
- Each test broken on purpose once (`dev/quality.md`).
- **The fake is not evidence.** Stage 0 on the owner's Core is the authority; nothing ships as
  "works" from the fake alone.

## 7. Security

Rouen gains the ability to change the user's Roon library. That raises the stakes on the gap
already noted in `dev/quality.md` ("Security"): anyone who can reach port 3399 can drive Rouen.
**The optional login lands before stage 2** (the first write). *Kept by the owner on 2026-10-14
as the native remote widens to writes: the login comes first, guarding settings and the library
(`dev/design/native-remote.md` §1.6, `dev/design/login.md`).*

## 8. Decisions (owner, 2026-10-12)

1. **Waveforms stay.** The `/music` path and the Qobuz/TIDAL sign-ins are kept, as optional extras,
   for waveforms only. Once Roon direct is on and working, nothing else reads them for library data.
2. **Stage 0 probe:** explained to the owner; to run on the owner's Core when built.
3. **Listen Later moves to Roon's own** (`SetListenLaterState` / `GetListenLater`) once the write path
   is approved — a stage of its own after stage 2.
4. **Profile picker.** Favourites, Listen Later and add-to-library act for the Roon profile chosen in
   Settings → Roon; the list comes from the Core.
5. **Opt-in, always.** Roon direct is off until the user turns it on. Both versions are recorded when
   the user opts in. **Changed on 2026-10-14 (the owner, as Rouen moves towards a native Roon UI):**
   after any update — a new Rouen version, a new Roon Core version, or another Core — it no longer
   turns itself off. It runs a read-only check first; until that passes nothing read before the
   update is used. Passed: it stays on and the new versions are recorded. Failed: it turns off and
   says why (6). A write (stage 2 on) stays off until the check has passed. (Before: any update
   turned it off until the user turned it on again.)
6. **Auto-revert.** If Roon direct fails (handshake, decode, timeout, a call the Core rejects), Rouen
   switches it off by itself and goes back to today's behaviour, and says so in Settings → Roon.

## 9. Still open

1. **How stage 1 reads an album's source** (from v1.9.11; for the owner once stage 0 has run). The
   source criteria exist on tracks only, so either (a) every source's track query is paged and each
   track's album collected — exact, but a library of 13,000 albums is some 150,000 tracks to page
   at every sync — or (b) `AlbumQueryCriteria::RequireLocations` is used, if the Locations the
   Core reports (stage 0 lists them) include TIDAL and Qobuz as locations. Stage 0's answer says
   which is possible; the choice is the owner's.

   **What stage 0 found (v1.9.12, the owner's Core, 2026-10-13).** The broker id was the core_id in
   .NET order, accepted first time. Library: 25 albums, 382 tracks. Per source, from tracks: local
   19 albums / 226 tracks, TIDAL 6 / 156; Qobuz's query returned a query id but no Count was ever read (whether its
   object arrived was not recorded; a 0 sent sparsely, as no member at all, is the likely story,
   not proven). Every page released, every query
   disposed. The Locations, as category/type: TIDAL 400/406, TIDAL Library 400/406, QOBUZ 400/407,
   Iron & Wine 100/104 (226 files), Internet Media 500/501, Metadata Service 500/502, Offline
   500/503. So TIDAL and Qobuz ARE Locations, and (b) may be possible.

   **The Locations probe (v1.9.13) tests (b) before stage 1 relies on it.** What it cannot know in
   advance is how the Core reads an `IList<Location>` inside the criteria struct: Rouen had not sent one, and the upstream has not.
   It is sent the way the one list encoding run live on this protocol was (upstream, `Library::Edit`):
   the member declared LengthPrefixed (24), its value flexInt(length) + flexInt(count) + the
   elements, each in its element type's own encoding — for a by-reference object such as a Location,
   its object id alone, as in the official client's captured collection arguments. The upstream's generated
   schema says 23 for every list member, but its own notes call that an unchecked default; this is
   the one property type `schemas.js` changes. A misread criterion has three
   faces, none of which may pass as a filter: every Location counts the whole library ("ignored"),
   every Location counts 0, or one counts more than the library ("misread"). So the verdict is
   "filtered" only when two Counts the Core sent as numbers differ and one of them lies strictly
   between 0 and the control's. A query object with no Count member is read as 0 after a grace of
   3 s and marked inferred; an inferred 0 is never evidence for "filtered" (a late Count reads as
   one). A Count that is there but is not a count, or no query object at all, is an error. Without
   a control nothing is judged, so a failed control asks about no Location. One limitation: the
   control is declared with the same AlbumQueryCriteria type, so a Core that refused the type
   itself would fail the control too, and the run could not tell that from album queries failing.
   The recommendation to the owner: consider (b) only on a "filtered" verdict whose counts agree with
   the track-derived ones above. The choice stays the owner's.

   **What the Locations probe found (v1.9.13, the owner's Core, 2026-10-13): "filtered".** Control
   25; Iron & Wine 19, TIDAL Library 6, every other Location 0 — exactly the track-derived 19 local
   and 6 TIDAL, and 19 + 6 = 25. The library's TIDAL albums are under "TIDAL Library", not "TIDAL",
   so a Location is read by its category and type, never its name. Every Location that certainly
   holds nothing (Internet Media, Metadata Service, Offline) also came with no Count member at all:
   the Core sends a Count of 0 by leaving it out, which explains v1.9.12's Qobuz. 11 queries opened
   and disposed, 5 pages retained and released, 26 s.

   **A correction, and what it does not show.** v1.9.13 wrote here and in `schemas.js` that
   `RequireLocations` declared as the generated 23 rather than 24 "would be misread". That was never
   shown. deep-roon-mcp (below) ships the same bytes at 23 — its `structArg` refuses any other — but
   nothing in it shows its storage filter was checked against a Core either. So: 24 ran on the
   owner's Core and is kept; whether 23 would also filter is not known.

   **A second source: deep-roon-mcp** (René Bouwmeester, Apache-2.0, 0.4.5 at aeea5e9, built on the
   same upstream; facts only, no code taken). It reads an album's source from its `ContentSource`, a
   MediaSource (the catalogue's enum: Local 1, Tidal 128, Qobuz 256, among others), and notes that
   the plain `Source` says Local for a streaming album in the library (its measurement, 12 Oct
   2026). If `ContentSource` holds on the owner's Core, stage 1 could take an album's source from
   the album itself: (c). It reads a page's items as its rows (`VirtualQueryElement<…>`, `Data`)
   and waits for their fields, which come after them. It also reads the Focus panel
   (`Library::GetAlbumQueryInfo`), whose `Locations` histogram gives every Location's album count in
   one call; not on the allowlist, and not needed while (b)'s per-Location count is one call each.

   **The owner's choice (2026-10-13): probe the album pages first.** v1.9.16 pages each source's
   Locations and answers both: whether the albums paged by Location ARE the albums of that source's
   tracks (by object id, one session: `pagesVerdict` — "same", "differ", or "unknown", with the
   sources not compared named), and whether each album's `ContentSource` names its Location's source
   (`contentSourceVerdict` — "agrees"; "incomplete" when the rest carry none; "disagrees" only when
   one names another source; "absent"). The rules, each from the review of its first draft:
   - a page's items are its rows' `Data`, and only those: any album the Core pushes while the query
     is open is counted in `via`, never taken for an item (an earlier Location's late push would
     pass for this one's);
   - a page is whole only when each album's Title has arrived; an album whose fields never come is
     left out of the ContentSource verdict and said so;
   - a source is compared only when every one of its Locations that holds albums was read whole
     (exactly its Count) and its tracks were read whole; otherwise it is "not compared", with why. A
     source with no tracks is a whole, empty set. Every source either side found is compared, so
     albums only the tracks found are a difference, not hidden;
   - where there is nothing to compare with, one page is read, as a sample of `ContentSource`;
   - a page that comes short ends that Location's reading; 60 album pages in all, at most;
   - a Count already read stands whatever its Location's paging does.

   Stage 1's method — (b), or (c) — is chosen on that run, by the owner.

   **What the album pages found (v1.9.16, the owner's Core, 2026-10-13).** The library had grown to
   13,013 albums: the owner's Qobuz library (Location "qobuz Library", type 407) holds 12,944.
   Iron & Wine 19 + TIDAL Library 5 + qobuz Library 12,944 = 12,968, the unfiltered control's Count
   and Rouen's own album count alike. TIDAL: "same" — its 5 albums by Location are its tracks' 5.
   Local: the 19 albums by Location are the 19 its tracks named, title for title, but were not
   compared, as 225 of its 226 tracks were seen. `ContentSource` agreed for all 24 albums paged
   (19 Local = 1, 5 TIDAL = 128); the plain `Source` said 1 for the TIDAL albums too, so it cannot
   tell a source. Pages came as rows alone (`albumsPushed` 0): those albums had been pushed by the
   track pages before. Not known: Qobuz — over the 2,000 a probe compares, its Location was not
   paged at all — and whether an album not pushed before arrives with its fields.

   **The owner's choice (2026-10-13): stage 1 is the source, for Focus's counts and the tiles'
   source icons** (Home and the grid screens) — "the rest we will bring in slowly". v1.9.17 reads one
   page of a Location over the limit, so the qobuz Library's albums show what they say, and reports
   each paged album's cover key and title for the matching.

   **What the sample page found (v1.9.17, the owner's Core, 2026-10-13).** The qobuz Library's first
   page, 100 albums: `ContentSource` 256 (Qobuz) on all 100, their Title arrived for all 100, and 99
   of them were pushed during that page — not seen earlier in the session — with their fields. So an
   album not pushed before arrives whole. `contentSourceVerdict`: agrees, all 124 albums paged (19
   Local = 1, 5 TIDAL = 128, 100 Qobuz = 256); the plain `Source` said 1 for every one. Local and
   TIDAL again "same" by Location and by tracks. Every album carried a cover key (124 of 124, none
   unresolved); the keys are short ids such as `obaaaaaa` and `vrvnaaaa`. Whether they equal the
   public API's `image_key` is not shown, and stage 1 does not depend on it (§10.3). 12 queries
   opened and disposed, 8 pages retained and released, 16.8 s. Not explained: the Core's Library
   total says 13,013 albums, the album query with no criterion 12,968 (Rouen's own count too).

   So §10 proposes option (c) for stage 1: an album's source is its own `ContentSource`. The choice
   is the owner's.

New questions go here before the code that depends on them.

## 10. Stage 1 — the source, from Roon (proposed 2026-10-13; OK'd 2026-10-14; built in v1.9.18)

The owner's answers to §10.6 are recorded there.

### 10.1 What the user sees

With Roon direct on and its last read whole, every album Rouen can match to an album the Core
lists takes that album's source (Local, Qobuz or TIDAL), and that one answer drives both:
- **Focus → Source**: "Local albums", "Qobuz" and "TIDAL" are counted from it (`libFacetDefs`);
- **the source icon on tiles**: Home's rows, the Library grid, and every other grid that draws one
  (`withSource`, read by the client's `sourceBadge`). An album whose source Roon gave is badged
  even where today's rule would hide every badge as uninformative.

An album not matched keeps today's inference (`albumSource`), unchanged — never a guess presented
as Roon's answer. Off, Rouen behaves exactly as without stage 1.

### 10.2 The read

- One short connection per read, closed gracefully (§3: no connection is kept open). *Since
  v1.9.21 every read runs on the native remote's one connection, kept open
  (`dev/design/native-remote.md` §4).*
- One `VirtualAlbumQuery` with no criterion (stage 0's control), paged through its whole Count,
  100 albums a page (about 130 pages for 12,968 albums) with `paging.js`: each page retained, its
  rows' `Data` read once their fields have arrived, released; the query disposed at the end.
- Kept per album: title, artist, `ContentSource`, cover key. Nothing else. Each page's albums are
  dropped from Rouen's own copy of the object graph once read, so its size cap holds over 130 pages.
- When: once after Rouen pairs with the Core, then after each rebuild of Rouen's album index (the
  library changed), and not more often than once every 30 minutes. Estimated one to three minutes
  for this library; each read records its real duration. *Since v1.9.21: also on every new session
  of the kept connection, and at most once a minute (`native-remote.md` §4).*
- The result is saved in the data volume (`data/roon-sources.json`, keyed by the Core's id), so a
  restart shows Roon's sources as soon as Rouen has paired and found nothing updated, rather than
  today's for the minutes the read after pairing takes. Not before pairing (only then is the Core's
  version known), not while a check after an update is due (§10.4), and deleted when Roon direct
  turns off.
- A read is tied to what it was started for: turning Roon direct off or on, or an update found at
  pairing, discards a read already running, and the read asked for meanwhile follows at once.
- A read is whole only if the Count arrived: a Count left out reads as 0 (a sparse 0) only of a
  Library that holds no albums; an album has arrived once its Title, or for an album with an empty
  title its ContentSource, has. Each page's albums and rows are dropped from Rouen's copy of the
  graph once read; covers, which albums may share, are kept.
- A read is whole only when every album of the Count arrived with its fields. Anything less is a
  failure (§10.4); a partial read is never used.

### 10.3 Matching an album

- By title and artist, through `albumKeys()`, as the rest of Rouen identifies an album: its exact
  key, and only that. A key the Core gives two or more albums of different sources, or an album
  with no `ContentSource` (1, 128 or 256), is not matched.
- **The owner's first run (v1.9.18, 2026-10-14)** matched the sources right, but a handful of Qobuz
  albums kept no Q on the Library screen and fell out of Focus → Qobuz: they were not matched, and
  an album not matched kept Rouen's own inference — which, with no service signed in to Rouen, says
  local by elimination for any album no favourite claims.
- **While Roon direct is in force, Rouen's own inference is not asked (the owner, 2026-10-14).** An
  album not matched has no source — no badge, in no source's Focus count — rather than a guess from
  Rouen's file tags and service favourites; Focus's "every album came from your own files" note is
  not sent either. Off, Rouen is as before. (This changes §10.6's answer 3, which left an album
  not matched to today's inference.)
- **Matching by title alone was proposed and not taken** (v1.9.20; the owner: "I thought Roon
  direct now tells us where it came from"). The pairing between Rouen's albums and the Core's must
  be sure. Why the handful are not matched is read from the list below on the owner's install
  before anything else changes; the cover key (next) is the candidate for a pairing that is.
- The cover key is not used to match yet. Each read reports, of the albums matched, how many also
  have a cover key equal to Rouen's `image_key` (`coverSame`, in `GET /api/roon-direct`): if they
  are the same identity in both lists, it can pair every album exactly.
- Settings → Roon shows the outcome: "Matched 12,961 of 12,968 albums — Local 19 · Qobuz 12,937 ·
  TIDAL 5." and "7 not matched, so shown with no source", with a link to every one not matched,
  why ("not listed", "two sources", "no source"), and the Core's albums of the same title beside
  it (`GET /api/roon-direct/unmatched`, up to 200).

### 10.4 On, off and failure (§8.5, §8.6)

- **Settings → Roon → "Roon direct (experimental)"**: a page in the Settings list after Services,
  with a switch, off by default, and a status line beneath it: the last read's time and match line,
  the last check after an update, or why it is off.
- **Above the switch, "Read this first" (v1.9.20, the owner's wording, after deep-roon-mcp's README
  with Rouen's names):** unofficial, not made, endorsed or supported by Roon Labs; Roon's internal
  protocol through Arthur Soares' roon-api-reverse-engineering (linked), which Roon Labs allows for
  tinkering with your own system; Brian Luczkiewicz (Roon Labs): "not hardened for 3rd party use",
  can change with any Roon update, misuse can leak memory or compute in the Core; read Arthur's
  Roon Community thread (linked) first; at your own risk, no warranty (Rouen's licence, linked);
  if the Core misbehaves, turn Roon direct off and restart the Core; report problems to Rouen
  (its issues, linked), not to Roon's support; keep port 9332 on your own network; a Roon update
  can break it until Rouen is updated; off, only Roon's official extension API is used.
- Turning it on records Rouen's version and the Core's version (`display_version`, from the public
  API) and starts a read.
- At start, and each time Rouen pairs with a Core: if Rouen's version, the Core's version or the
  Core itself differs from what was recorded, Roon's sources are set aside and a read runs as the
  check (§8.5, as changed on 2026-10-14). Whole: it stays on, the new versions are recorded, and
  Settings says "Checked after Roon Core updated from … to …: passed." Not: it turns off, as below,
  naming the update.
- Any failure — handshake, decode error, a timeout, a call the Core refuses, a read not whole, the
  graph cap reached — turns it off, deletes the saved sources, and says what failed and when. No
  retry; turning it on again tries once more. *Since v1.9.21 (`native-remote.md` §3.3) a failed
  read falls back instead — the official API's list and Rouen's own answers, the saved sources
  deleted, why shown — and the next session or library change reads again; only the check after an
  update still turns it off.*
- Stored with the other settings (`savePersistedSettings`): `roonDirect: { on, rouenVersion,
  coreVersion, coreId, offReason, offAt, lastRead, checked }`.
- Turning it on is refused, with why, when Rouen is not paired or does not know the Core's
  address; a Core paired without one turns it off the same way.
- The stage 0 probe (`/api/debug/roon-direct`) stays as it is, whatever the switch says.

### 10.5 How it is built

- One version (v1.9.18 at the time of writing). New modules, each `// @ts-check` and under 500
  lines with its tests: `lib/roon-direct/source.js` (matching; pure), `lib/roon-direct/albums.js`
  (the read), `lib/roon-direct/stage1.js` (on, off, the recorded versions, the check, revert), the routes in
  `lib/roon-direct/route.js`, and `public/roon-settings.js` (the Settings section, built in
  script, loaded before `app.js`; `index.html` is at its baseline). `lib/roon-direct/session.js`
  holds the connection probe.js and albums.js share. `index.js` gets only the hooks: `albumSource`
  and the tile's badge (`albumBadge`) ask stage 1 first, and pairing and index rebuilds tell it.
- The feature move this change owes `index.js` (CLAUDE.md, "Code"): the self-updater's wiring —
  its options, its scheduled check and its three routes — to `lib/update-routes.js`, the first item
  in `dev/quality.md`'s order.
- Tests, against the fake Core and with the read stood in for: a whole library paged and
  matched; a key with two sources; an unmatched album and an unknown `ContentSource` with no
  source (Rouen's inference not asked, v1.9.20); a short page, a refused page, a missing Count and more albums than the Count each a
  failure with every page released; a failure turning it off; the check after a Rouen update, a
  Core update and another Core, passing and failing; a read running when an update is found or the
  switch is flipped; the saved sources deleted when off; a DOM test for the Settings section. Each
  broken on purpose once.
- Before it is pushed: the multi-agent review (`dev/lessons.md`) — private protocol, settings
  persistence, new UI.

### 10.6 The owner's answers (2026-10-14)

1. This design, as a whole: yes, build it.
2. When it reads — after pairing and after each library change, at most every 30 minutes: yes.
3. Matching by title and artist, with an album not matched, or matched to two sources, left to
   today's inference: yes. (Changed by the owner the same day, v1.9.20: while Roon direct is in
   force, an album not matched has no source; §10.3.)

Asked with them, and answered the same day: the goal is now a native Roon UI (§1), so the private
protocol becomes the source wherever proven (§3, `CLAUDE.md`); and after an update Roon direct
checks itself rather than turning off (§8.5).
