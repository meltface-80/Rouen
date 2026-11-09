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
`Album::GetAlbums`, `PerformerAlbumQueryCriteria` and the `GetAlbumsMode` enum is a change a **later
build** makes, once their exact wire forms are sourced from the upstream catalogue
(`catalog.authoritative.json`, 8b67208) — **said as tried until the owner's server proves them**, as
every native read is. The owner chose (2026-11-09) to build candidate (a) first (which needs no new
method) and add (b) once its signature is in hand.

## 4. Stage 0 — the probe (candidate a; read-only, run by hand)

A read-only route in the pattern of the credits and reads probes
(`lib/roon-direct/reads-probe.js`, `route.js`): without `run=1` it connects to nothing and only says
what a run would do. Built in v2.0.3-t1 (`lib/roon-direct/plays-on-probe.js`).

`GET /api/debug/roon-plays-on?run=1&artist=<name>[&album=<a record of theirs>][&max_pages=N]` — on
native mode's connection, for the artist named:

1. **Resolve** the name to a performer (§3.1): a library album that is the artist's — the first whose
   lead artist is exactly the name, or the one `album=` names — gives its `MainPerformer`
   (`GetAlbum` then `performerOf`). The resolved performer's name **must be the artist asked for**, or
   it is refused: a record they only appear on would otherwise resolve to its lead. An artist who
   leads no library album cannot be resolved here, and the probe says so — that case is candidate (b)'s.
   Reported: how it resolved, the performer's id and name.
2. **The control**: `VirtualAlbumQuery` with no criterion, its Count every album the profile sees.
3. **The performer filter**, each credit kind the owner chose (decision 2): `VirtualAlbumQuery` with
   `RequireMainPerformers`, then `RequirePerformers`, `RequireProduction`, `RequireComposers` in turn
   (one criterion a query), each counted and — when it looks filtered — its first page sampled within a
   small budget. The query returns a record by its object id only; its title, artist, source and cover
   come from the library record Rouen already holds for that id (the album objects were dropped from the
   graph after the library read, and the server does not push their fields again on the connection —
   v2.0.3-t2, the owner's first run). That id→record join is how the feature will turn a performer's
   records into tiles. The
   `PerformerLite` list is sent **LengthPrefixed**, exactly as `RequireLocations` is, and declared the
   same way in the stock `AlbumQueryCriteria` schema (`schemas.js`) — one declaration the control
   shares, since a type can be declared only once a connection (`remoting.js`). Each Count is weighed
   against the control (`verdictOf`): "filtered" only on a Count strictly between 0 and the control; a
   criterion the Core ignores or misreads counts the whole library, 0, or more, and is reported as
   such, never as a real appearance list.
4. **Release everything** — every page retained is released, every query disposed — and report the
   handles opened and released and the run's duration, as every probe does
   (`dev/design/roon-native.md` §3).

Nothing is written to Roon. The verdict the probe hands the owner: whether the library album-query-by-
performer filters on their Core (settling the property type, §5.3), which credit kinds return records
and how many, and what each record carries for the tile — enough to specify the feature's library half,
and to size candidate (b).

Methods this stage adds to the allowlist (`methods.js`): **none**. Candidate (a) reuses
`VirtualAlbumQuery`, its paging and Dispose, and `GetAlbum`/`GetPerformer`, all already allowed; it
only declares the four Require performer lists `AlbumQueryCriteria` sends as LengthPrefixed in
`schemas.js`, as `RequireLocations` already is. `Album::GetAlbums` (candidate b) joins the allowlist in
its own later build.

## 5. Still open (for the owner, or for the probe to settle)

1. **Final section wording and placement** — "Plays on", "Appears on (credits)", "Session & guest"? —
   and whether production/writing records sit in the same section (with role labels) or a second one.
   For the owner, once the probe shows how many records a real artist returns.
2. **How complete, and how fast.** A popular session player (a Steve Lukather, a Nile Rodgers) may
   credit hundreds of catalogue records. The probe's Counts tell us the scale; the build then decides
   the cap, the paging budget and whether the read is on demand (when the page opens) and cached, as
   the album credits are. For the owner after the probe.
3. **The performer-list property type.** Resolved by analogy, not left open: the list is declared and
   sent LengthPrefixed (the 24 the Locations probe proved for `RequireLocations`, which `refList`
   writes), not the upstream's unchecked 23. The probe (§4 step 3) confirms on the owner's Core that the
   Core applies it; a Count equal to the control or 0 would say it does not.
4. **Candidate (b).** The catalogue-wide read (`Album::GetAlbums`) that decision 1 ("everything Roon
   knows") needs is its own later build, once its wire signature is sourced from the upstream catalogue.
   This build is candidate (a), the library half; the owner chose that sequencing (2026-11-09). Whether
   the library query alone already carries any catalogue appearances is reported by this probe's run.

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
