# Roon-native library — design

Status: **stage 0 (the probe) built in v1.9.11, run on the owner's Core with v1.9.12 and, with its Locations probe, v1.9.13
(2026-10-13; results in §9.1); its album pages run with v1.9.16; a sample page for the largest Locations added in v1.9.17, not yet run.** The owner's answers to §8 are recorded there (2026-10-12);
any question still open goes to the owner before code that depends on it. This document is the specification for the work it describes: code matches it,
or this document changes first, in the same commit (see `CLAUDE.md`, "Spec authority").

## 1. Goal (the owner's words, 2026-10-12)

> All the information/data of the library comes from Roon. Favouriting in Rouen fires Roon's
> favourite. Adding a TIDAL or Qobuz album in Rouen adds it to Roon directly, not via the
> streaming service and then into Roon.

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

- **The public extension API stays the foundation.** Pairing, zones, transport, browse, images:
  unchanged. The internal protocol is an *additional* source, used only for what the public API
  cannot answer.
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
- **Fail closed on a Roon update.** Handshake or decode failure disables the feature until the next
  Rouen release says the new Roon version is known-good; it does not retry in a loop.

## 4. Scope by stage

Each stage is its own version and its own review. A stage starts only when the previous one has
run on the owner's Core.

| Stage | Delivers | Methods allowed | Replaces |
|---|---|---|---|
| **0 — probe** | `GET /api/debug/roon-direct?run=1` (without `run=1` it connects to nothing): handshake with each broker-id candidate, then what the Core pushes on connect (profiles, the Library's own album and track totals, the storage Locations), then per source a track query with `RequireIsLocal` / `IsTidal` / `IsQobuz` and its Count; a source with at most 2,000 tracks is paged through and the albums its tracks belong to are counted. Then (v1.9.13, the Locations probe, §9.1) an album query with no criterion as a control, and one per Location the Core pushed with `RequireLocations` = [that Location]; only each query's Count is read. A failed control asks about no Location; a Location's query object that never arrives stops the rest. The verdict is "filtered" only when two Counts the Core sent as numbers differ, one of them between 0 and the control (see §9.1). Then (v1.9.16, the owner's choice, §9.1) each Location that stands for a source (category 100 or 300: local; type 406: TIDAL; 407: Qobuz) and holds at most 2,000 albums is paged, every page released, within a budget of 60 pages in all: its albums (its rows' Data, each page waited on until their fields arrive) are checked, by object id in the same session, against the albums its source's tracks belong to — only when every Location of that source was read whole, and only when those tracks were; otherwise one page is read as a sample, as it is (v1.9.17) for a Location of more than 2,000 albums — and each album's own `ContentSource` is read against its Location's source, with its cover's image key and its title and artist reported for the first few (what stage 1 would match Rouen's albums by). Read-only, run by hand. On the 8-album test library the right answer is 2 / 6 / 0 | GETSVC on the root service; `Library::VirtualTrackQuery`; `VirtualTrackLiteQuery::RetainPage`, `::ReleasePage`, `::Dispose`; `Library::VirtualAlbumQuery`; `VirtualAlbumLiteQuery::RetainPage`, `::ReleasePage` (v1.9.16), `::Dispose` (signatures in `lib/roon-direct/methods.js`) | nothing |
| **1 — source from Roon** | Badges and the Source focus read from the Core; the `/music` walk and service favourites no longer decide source when Roon direct is on | **Open — §9.1**: decided by what stage 0 reports | `albumSource()` inference |
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
  LICENSE                            the upstream's MIT notice
```

Ported, not depended on: upstream is not on npm, TypeScript, and changes under us. Each ported file
names its upstream path and commit (8b67208); `lib/roon-direct/LICENSE` carries the MIT notice.
`source.js` and the start/stop/fallback module come with stage 1. The one change to the captured
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
**The optional login lands before stage 2** (the first write).

## 8. Decisions (owner, 2026-10-12)

1. **Waveforms stay.** The `/music` path and the Qobuz/TIDAL sign-ins are kept, as optional extras,
   for waveforms only. Once Roon direct is on and working, nothing else reads them for library data.
2. **Stage 0 probe:** explained to the owner; to run on the owner's Core when built.
3. **Listen Later moves to Roon's own** (`SetListenLaterState` / `GetListenLater`) once the write path
   is approved — a stage of its own after stage 2.
4. **Profile picker.** Favourites, Listen Later and add-to-library act for the Roon profile chosen in
   Settings → Roon; the list comes from the Core.
5. **Opt-in, always.** Roon direct is off until the user turns it on, and it **turns itself off again
   after any update — a new Rouen version OR a new Roon Core version** — so the user opts in again
   knowingly. Both versions are recorded when the user opts in; either changing switches it off.
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
   each paged album's cover key and title for the matching below. Stage 1's design is written, and
   put to the owner, after that run. Two things it must settle, known now:
   - *Matching.* Stage 1 must find, for each album the Core lists, the same album in Rouen's index
     (built through the public API, which gives each album an `image_key`). The cover key and the
     title and artist are the candidates; that they match is not yet shown. An album not matched
     keeps today's inference, never a guess.
   - *§8.* Opt-in, off after any Rouen or Core update, auto-revert on any failure — stage 1 is the
     first stage those apply to.

New questions go here before the code that depends on them.
