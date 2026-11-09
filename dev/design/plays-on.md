# "Plays on" — every record an artist appears on, on their artist page

Status: **stage 0 (the probe, candidate a) proposed 2026-11-09, built in v2.0.3-t1; not yet run on the owner's
Core.** The owner's two decisions (§1) are recorded there. This document is the
specification for the work it describes: code matches it, or this document changes first, in the same
commit (`CLAUDE.md`, "Spec authority"). Anything still open (§5) goes to the owner before the code
that depends on it. It builds on `dev/design/roon-native.md` (the private protocol, how it is used
lightly) and `dev/design/album-credits.md` (where an album's personnel already come from), and reuses
`dev/design/artists.md`'s artist page.

## 1. Goal (the owner's words, 2026-11-09)

> If I press on, let's say, Steve Lukather of Toto, it would be nice if it showed what records he
> plays on and not just his solo records.

Today an artist's page (`dev/design/artists.md`; `showArtistAlbums`, `/api/artist-albums`) has two
sections, both built from each album's **artist-credit line** (`artistLibraryAlbums` over `cCredits`):

- **Albums** — the records credited to that name as the whole credit or its lead (`primary`);
- **Also appears on** — the records where that name is further along the credit line (`featured`):
  collaborations, "A & B", a "feat.".

The credit line is the album's *artist field*. For Steve Lukather it reads **"Toto"** on Toto's
records and **"Michael Jackson"**, **"Boz Scaggs"** and the like on his session work — his name is not
in it, so those records do not appear. What the owner is asking for is the **session and guest**
credits: the detailed personnel ("Steve Lukather – guitar") that sit a layer below the artist field.
Rouen already reads exactly that personnel for an album when its page is opened
(`dev/design/album-credits.md`); this feature asks the question the other way round — *given a name,
which records credit it* — and Roon itself already answers it on its own artist pages.

### The owner's two decisions (2026-11-09)

Asked what "records he plays on" should cover, the owner chose:

1. **Everything Roon knows**, not only records in the library: also records the owner does not own
   that Roon's catalogue (including TIDAL and Qobuz) credits the artist on, shown as "add to library"
   tiles the way a search result is. The fuller picture, at the cost of a catalogue read, not a
   library one.
2. **Performing *and* production/writing**: records the artist played or sang on, *and* records they
   produced, wrote, engineered or arranged — an "involved with" view — with the role shown so "guitar"
   is told apart from "producer".

## 2. What the user sees

On an artist's page, under the existing **Albums** and **Also appears on**, a new section — working
title **"Plays on"** (final wording §5) — of the records that credit this artist in their personnel:

- Each record a tile as the grid's others are, with its cover, title and the record's own lead
  artist, and **the role this artist has on it** ("Guitar", "Producer", "Composer") as a small label
  on or under the tile, so the section reads as "guitar on *Thriller*, producer on *Silk Degrees*".
- A record **already in the library** opens its album page as any tile does.
- A record **not in the library** (decision 1) is shown as an "add to library" tile, exactly as a
  search result's catalogue album is, and its ＋ calls Roon's own Add to library
  (`dev/design/native-remote.md` §9), never a service's.
- Ordered performing credits first, then production, then writing (the credits' own rank order,
  `dev/design/album-credits.md` §3), and within each the most recent records first; a sensible cap
  with **More**/**Less**, as the album page's credits have.
- Hidden until there is something to show, and never shown at all when native mode is off or this
  artist cannot be resolved (§3) — the page is then exactly as today. A record that is also one of the
  artist's own (already under **Albums**) is not repeated here.

This is a native-mode feature: it needs Roon's own catalogue, which only the private protocol gives.
Off, or on and failing, the section simply does not appear — nothing silently degrades to a guess
(`dev/design/roon-native.md` §3).

## 3. Where the records come from

Roon builds an artist page — "Main Albums", "Appears On", "Compositions" — from the Core. Two reads
are candidates; the probe (§4) establishes which gives decision 1's catalogue-wide answer, and both
are read-only.

### 3.1 Resolve the artist to a performer

Every credit Rouen already reads carries its performer as a `PerformerLite` — a name *and* a Core
object id (`lib/roon-direct/credits.js`, `nameOf`). So within one native read the artist's own
records (its album, opened from a credit or its own page) give a `PerformerLite` for the name. Where
that is not to hand, `Library::UnifiedSearch` (already allowlisted, `dev/design/roon-native.md` §4
N2b-1) returns performer results for a name. `Library::GetPerformer(PerformerBase)` (already
allowlisted, read in the N7-0 reads probe) then reads the performer whole. Object ids are per
connection, so the resolve and the records read run in the **same** session.

### 3.2 The records — candidate (a): the library album query, by performer

`AlbumQueryCriteria` already declares, from the upstream catalogue
(`lib/roon-direct/schemas.js`), a performer filter per credit kind:
`RequireMainPerformers` / `RequirePerformers` (performing), `RequireProduction` (making the record),
`RequireComposers` (writing), `RequireConductors`, each a list of `PerformerLite`. So
`Library::VirtualAlbumQuery` — **already on the allowlist, already paged** (`methods.js`
`openAlbumQuery`, `paging.js`) — can be asked for the albums that credit this performer, exactly as
the Locations probe asked it with `RequireLocations` (`dev/design/roon-native.md` §9). Decision 2's
"performing + production/writing" is the union of those criteria.

This is the cheaper read and needs no new allowlist entry, but it is the **Library** query: it almost
certainly returns only records **in the library**, which meets decision 2's role coverage but not
decision 1's "everything Roon knows". It is read as the cross-check and the library half of the
answer.

### 3.3 The records — candidate (b): the performer's page, catalogue-wide

Roon's own artist page, which shows records outside the library, is `Album::GetAlbums` with a
`PerformerAlbumQueryCriteria` and a `GetAlbumsMode` (the "Main Albums" / "Appears On" / "Compositions"
bucket) — named in `dev/design/roon-native.md` §2 as "a performer page's album list", **not yet on the
allowlist**. This is the candidate for decision 1: the catalogue-wide appearances Roon shows. Adding
`Album::GetAlbums`, `PerformerAlbumQueryCriteria` and the `GetAlbumsMode` enum to the allowlist is a
change this design makes (§4), their exact wire forms taken from the upstream catalogue
(`catalog.authoritative.json`, 8b67208) and **said as tried until the owner's server proves them**, as
every native read is.

The probe reads both and reports how each is scoped (library-only vs catalogue-wide), what buckets
`GetAlbumsMode` offers and which the owner's two decisions map to, and what each record carries, so the
build is written against what the server actually sends.

## 4. Stage 0 — the probe (read-only, run by hand)

A new read-only route, in the pattern of the credits and reads probes
(`lib/roon-direct/reads-probe.js`, `route.js`): without `run=1` it connects to nothing and only says
what a run would do.

`GET /api/debug/roon-plays-on?run=1&artist=<name>[&album=<a record of theirs>]` — on one short
connection (or the kept native-mode one), for the artist named:

1. **Resolve** the name to a `PerformerLite` (§3.1): from the given record's credits if `album=` is
   passed, else from `UnifiedSearch`; report how it was resolved, the performer's id and name, and
   `GetPerformer`'s whole performer.
2. **Candidate (a)**: `VirtualAlbumQuery` with `RequirePerformers`, then `RequireMainPerformers`,
   `RequireProduction`, `RequireComposers` in turn (one criterion a query), each paged within a small
   budget; report each query's Count and, for the first page, every record's title, lead artist,
   `ContentSource` (its source) and cover key, and whether the record is one Rouen's library holds.
   The `PerformerLite` list is sent as the Locations list was, and its property type (23 vs 24) is the
   one unknown carried over from the Locations probe (`dev/design/roon-native.md` §9): a criterion the
   Core misreads counts the whole catalogue, or 0 — so a Count equal to the unfiltered control, or 0,
   is reported as "not filtered / misread", never as a real appearance list.
3. **Candidate (b)**, if its signatures are confirmed from the upstream catalogue:
   `Album::GetAlbums` for the performer, for each `GetAlbumsMode` bucket, paged within the budget;
   report each bucket's name, its Count, and the same per-record fields, and whether each record is in
   the library — so the catalogue-wide vs library-only question (§3) is answered on the owner's Core.
4. **Release everything** — every page retained is released, every query disposed, the connection
   closed gracefully — and report the handles opened and released and the run's duration, as every
   probe does (`dev/design/roon-native.md` §3).

Nothing is written to Roon. The verdict the probe hands the owner: which read gives decision 1's
answer, which `GetAlbumsMode` buckets map to decisions 1–2, how an artist is resolved to a performer
in the general case, and what each record carries for the tile and the add-to-library path — enough to
specify the build (§6) exactly.

Methods this stage adds to the allowlist (`methods.js`): `Album::GetAlbums` and its
`PerformerAlbumQueryCriteria` / `GetAlbumsMode` (candidate b). Everything candidate (a) needs —
`VirtualAlbumQuery`, its paging and Dispose, `UnifiedSearch`, `GetPerformer` — is already allowed.

## 5. Still open (for the owner, or for the probe to settle)

1. **Final section wording and placement** — "Plays on", "Appears on (credits)", "Session & guest"? —
   and whether production/writing records sit in the same section (with role labels) or a second one.
   For the owner, once the probe shows how many records a real artist returns.
2. **How complete, and how fast.** A popular session player (a Steve Lukather, a Nile Rodgers) may
   credit hundreds of catalogue records. The probe's Counts tell us the scale; the build then decides
   the cap, the paging budget and whether the read is on demand (when the page opens) and cached, as
   the album credits are. For the owner after the probe.
3. **The performer-list property type** (23 vs 24), unresolved since the Locations probe — settled by
   the probe on the owner's Core (§4.2), not by choosing.
4. **Candidate (a) vs (b)** — whether the library album-query-by-performer already carries catalogue
   appearances, or decision 1 needs `Album::GetAlbums` — settled by the probe (§4.3). The owner chooses
   the build's source on that run, as with every native-mode stage.

New questions go here before the code that depends on them.

## 6. How it will be built (after the probe)

One probe build first (stage 0, this section's §4): a new module
`lib/roon-direct/plays-on-probe.js` (`// @ts-check`, under the 500-line gate, with its tests) and its
route, read-only, run on the owner's Core — nothing shipped as "works" from the fake alone
(`dev/design/roon-native.md` §6). Round-trip tests against the wire fixtures for the new criterion and
call, and a fake-Core handle-lifetime test that fails if any page or query is left open.

Then, on the owner's choice from that run, the feature: the server read (its own module, cached per
artist as the credits are, `dev/design/album-credits.md` §4), a route beside `/api/artist-albums`
feeding the artist page's new section, and the client section with its role labels and add-to-library
tiles. It is a native-mode, private-protocol, new-UI change, so it carries the multi-agent review
(`dev/lessons.md`) its parts each call for. Each piece its own build, each gate green
(`CLAUDE.md`).

## 7. Not in this build

- A walk of the whole library's credits: this reads Roon's answer for one artist on demand, as the
  album credits are read per album, not a background sweep.
- Writing anything to Roon beyond the existing Add to library a non-library tile already uses.
- An artist's own biography, links or bands beyond what `dev/design/artists.md` already shows.
