# "Plays on" — every record an artist appears on, on their artist page

Status: **stage 0 (the probe, candidate a) built in v2.0.3-t1 and -t2 and run on the owner's Core (§4.1); the library
half built as the artist page's "Appears on" in v2.0.3-t3 (§2, §6). Candidate (b), the catalogue, is not built yet.**
The owner's decisions (§1, §5) are recorded there. This document is the
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

### The owner's two decisions after the probe's run (2026-11-09)

3. **One section.** A single list, every record the artist is credited on apart from their own albums,
   each tile labelled with the roles they have on it — not a section per role.
4. **It replaces "Also appears on".** With native mode on and answering, the new list takes the place of
   "Also appears on"; with native mode off (or not answering) "Also appears on" stays exactly as it is
   today.

## 2. What the user sees

As built in v2.0.3-t3, the library half (candidate a), to decisions 3 and 4:

- On an artist's page, under **Albums**, a section titled **"Appears on"**: every library record your
  server credits the artist on as main performer or performer (**"Played"**), in production
  (**"Produced"**) or as composer (**"Wrote"**), each a tile as the grid's others are (its cover, title,
  the record's own artist), with the artist's roles as a small line under the record's artist —
  "Played · Produced". A record has one tile however many roles it has.
- It **replaces "Also appears on"**. Every album whose artist line names the artist further along
  (what "Also appears on" listed) is kept in it, labelled **"Featured"**, when the server's credits
  do not already list it — so nothing the page showed before is lost.
- The artist's own albums (those under **Albums**) are not repeated.
- Ordered by the record's first role — Played, then Produced, then Wrote, then Featured — and within a
  role by the record's artist, then its title. (The design first said "most recent first" within a
  role; the library's tiles carry no year to sort by, so the order is the grid's own, A→Z, until one
  is read.) The first **24** are shown, then **More (N)** / **Less**, as the album page's credits have.
- The page opens as before, with "Also appears on", and the section takes its place when the server
  answers. Any answer but "ok" — native mode off, the artist not resolvable (they lead no library
  album, §3.1), the server's read failing — leaves the page exactly as before. A read still going
  ("pending") is asked again a few times while the page is up.
- A tile opens its album as any tile does. The count beside Back counts the page's tiles, own and
  appearances.

Not in this build — candidate (b), decision 1: records **not in the library** that Roon's catalogue
credits the artist on, as "add to library" tiles exactly as a search result's catalogue album is, its ＋
calling Roon's own Add to library (`dev/design/native-remote.md` §9), never a service's. They join the
same section, with the same role labels, when (b) is built.

This is a native-mode feature: it needs Roon's own credits, which only the private protocol gives.
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

**A musician who leads no library album (2.0.4-t7).** gert_mogensen (the Roon forum, 2026-11-10): "Appears
on" stays empty for a session musician — Jeff Porcaro, on many records, none of them his. `resolvePerformer`
needs a library album the artist leads, so such an artist was always `unresolved`. When it finds none, the
read now looks in the objects this connection has already loaded for a `Performer` or `PerformerLite`
whose `Name` is the artist's, letters and case compared as the album match compares them: the credits
Rouen read on this connection (an album's Credits tab, a credit tapped) bring their performers with
them, so a musician reached from a credit — the usual way to their page — is found. Exactly one such
object id resolves them; none, or two different ids for one name (two musicians of one name), is still
`unresolved`, and that answer is **not kept**: a later credit read may bring the performer, so the next
visit asks again. Records found this way are not kept either: "exactly one" holds only for what this connection has
loaded, and a second musician of that name may be loaded later (the review, 2.0.4-t7). Nothing is searched for and no method is added: candidate (b)'s catalogue-wide read
remains its own build.

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

### 4.1 The run on the owner's Core (v2.0.3-t2, 2026-11-09)

Steve Lukather, resolved from his own *Luke* to one performer: main performer 8 records, performer 48,
production 6, composer 39, against a control of 13,502 — each filtered, none misread. The records named
were the expected session and band work (*Thriller*, *Behind the Sun*, Toto's albums). Every page
retained was released and every query disposed. That settles §5.3: the performer lists, sent
LengthPrefixed, filter on the Core.

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

1. **Final section wording and placement** — settled by the owner (decisions 3 and 4): one section,
   "Appears on", with role labels, in place of "Also appears on".
2. **How complete, and how fast** — settled for the library half by the run's scale (tens of records,
   not thousands): read on demand when the page opens, every credit kind paged to 5 pages of 100 (an
   artist past that is shown the first 500 a kind and the answer says `capped`), kept per artist until
   the library is read again and for a day at most. The catalogue half (b) decides its own.
3. **The performer-list property type** — confirmed on the owner's Core (§4.1). Resolved by analogy first: the list is declared and
   sent LengthPrefixed (the 24 the Locations probe proved for `RequireLocations`, which `refList`
   writes), not the upstream's unchecked 23. The probe (§4 step 3) confirms on the owner's Core that the
   Core applies it; a Count equal to the control or 0 would say it does not.
4. **Candidate (b).** The catalogue-wide read (`Album::GetAlbums`) that decision 1 ("everything Roon
   knows") needs is its own later build, once its wire signature is sourced from the upstream catalogue.
   This build is candidate (a), the library half; the owner chose that sequencing (2026-11-09). Whether
   the library query alone already carries any catalogue appearances is reported by this probe's run.

New questions go here before the code that depends on them.

## 6. How it is built

Stage 0, the probe (§4): `lib/roon-direct/plays-on-probe.js` and `/api/debug/roon-plays-on`, read-only,
run on the owner's Core (§4.1).

The library half (v2.0.3-t3), on the owner's choices from that run:

- **The server read** — `lib/roon-direct/appears-on.js`, made with native mode's other services
  (`services.js`). Inside the connection's turn, on one session: the artist resolved to a performer as
  the probe does (`resolvePerformer`; an artist who leads no library album is `unresolved`); then one
  `VirtualAlbumQuery` per credit kind (main performers, performers, production, composers), each
  counted, every page read to the cap and released, the query disposed exactly once whatever happens;
  a Count as large as the library is the criterion misread (§4 step 3) and gives nothing; each record
  named from the library records Rouen holds, by object id. Answers: `ok` (the records, each title,
  artist and roles), `unresolved`, `off`, `failed`, or `pending` past the caller's wait (8 s), the read
  going on. Kept per artist per library read (a new read is a new records Map) and for a day at most;
  one read per artist at a time. Only what is so is kept: `ok`, and `unresolved` when the artist's
  album's lead is someone else (an artist found neither as a lead nor among the credits read is
  asked again next visit, §3.1, 2.0.4-t7); a refused or unanswered call, and a
  page that did not arrive in time (a partial list), are `failed` and asked again next time. A kind
  with no Count member is read as 0 after 1.5 s (the server leaves a 0 out; the probe waited 3 s and
  called it unknown — a slow Count would read as 0 here, a risk accepted so an artist with empty kinds
  doesn't hold the connection's turn for seconds). A read whose turn comes more than 30 s after it was
  asked is not made. Methods added to the allowlist: **none**.
- **The route** — `GET /api/artist/appears-on?artist=` in `lib/routes/artist-albums.js` (with
  `/api/artist-albums` and `/api/album/more`, moved out of `index.js` unchanged in the same build):
  the records as the library's own tiles (matched by title and artist, the whole record — cover,
  badges — at its offset as of the request, so never cached by the browser), the artist's own albums
  left out, the "Featured" albums added, roles merged and ordered (§2); any answer but `ok` passed on
  with no list.
- **The page** — `public/artist-view.js` (the artist page, moved out of `public/app.js` unchanged in the
  same build): after the page's first paint it asks the route, and on `ok` paints "Appears on" in place
  of "Also appears on" through the grid's keyed repaint (bio, members and every unchanged tile kept);
  a library change asks again, so offsets stay current.

Catalogue-wide, candidate (b), is its own later build (§3.3, §5.4). Each piece its own build, each gate
green (`CLAUDE.md`); the private-protocol and new-UI parts carry the multi-agent review
(`dev/lessons.md`).

## 7. Not in this build

- A walk of the whole library's credits: this reads Roon's answer for one artist on demand, as the
  album credits are read per album, not a background sweep.
- Writing anything to Roon beyond the existing Add to library a non-library tile already uses.
- An artist's own biography, links or bands beyond what `dev/design/artists.md` already shows.
