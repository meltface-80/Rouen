# Roon-native library — design

Status: **agreed in outline, not started.** The owner's answers to §8 are recorded there (2026-10-12);
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
| Is an album local / TIDAL / Qobuz | Query criteria `RequireIsLocal` / `RequireIsTidal` / `RequireIsQobuz` (and `Exclude…`) on `TrackQueryCriteria`; `Album.GetAlbums(profileid, source, mode, criteria, cb)` | **Not run live** (generated) |
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
  work inside the Core.
- **Reads before writes.** No mutating call ships until the read path has run on the owner's Core.
- **Fail closed on a Roon update.** Handshake or decode failure disables the feature until the next
  Rouen release says the new Roon version is known-good; it does not retry in a loop.

## 4. Scope by stage

Each stage is its own version and its own review. A stage starts only when the previous one has
run on the owner's Core.

| Stage | Delivers | Methods allowed | Replaces |
|---|---|---|---|
| **0 — probe** | `GET /api/debug/roon-direct`: handshake, broker id check, then counts of albums with `RequireIsLocal` / `IsTidal` / `IsQobuz`. Read-only, run by hand. On the 8-album test library the right answer is 2 / 6 / 0 | handshake, `GetAlbums` | nothing |
| **1 — source from Roon** | Badges and the Source focus read from the Core; the `/music` walk and service favourites no longer decide source when Roon direct is on | `GetAlbums` with source criteria | `albumSource()` inference |
| **2 — Roon favourites** | The heart in Rouen = Roon's favourite, read back from the Core | `FavoriteOrBan(album)` | Qobuz/TIDAL favourite calls |
| **3 — add to library** | "Add to library" on a TIDAL/Qobuz album found in Rouen calls Roon | `UnifiedSearch`, `AddToLibrary(album)` | add-via-service-favourite |
| **4 — retire workarounds** | Service sign-ins and the `/music` mount become optional extras for what Roon cannot provide (§5), or go | — | — |

### Module layout (all under the 500-line gate, `// @ts-check`)

```
lib/roon-direct/
  frame.js, reader.js, writer.js     wire format        (ported from upstream src/proto, MIT)
  connection.js                      socket, handshake, keepalive, budget
  client.js                          object graph, handle lifetime — the risky part
  methods.js                         the §4 allowlist, typed by hand, nothing generated
  source.js                          album → local / tidal / qobuz, pure, tested
  index.js                           start/stop, health, fallback
```

Ported, not depended on: upstream is not on npm, TypeScript, and changes under us. Each ported file
names its upstream path and commit; `THIRD_PARTY_NOTICES` carries the MIT notice.

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

Nothing. New questions go here before the code that depends on them.
