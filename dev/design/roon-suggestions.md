# Suggestions from Roon — design

Read before working on Smart Picks, the share card's "If you like this", or anything else Rouen suggests.

## 1. The request (the owner, 2026-11-24)

> "Still not working as I want … Firstly, where do smart picks and share card suggestions come from? Using official
> API and reverse code and Roon search via Rouen, they must come from Roon and not Qobuz or other means. Let's start
> from scratch … Let's not fix what currently implemented. Let's work on a new method and replace what's currently
> failing."

The rule of `roon-native.md` §1 (the owner, 2026-11-24): outside services are gap-fillers, not sources. A suggestion
is Roon's: Roon names the artist, Roon names the album, Roon has the album, and a tap opens the album Roon named.

## 2. What it replaces, and why it failed

Until this design (2.0.6-t16), neither feature asked Roon anything:

| Feature | Seeds | Similar artists | The album suggested | Its cover |
|---|---|---|---|---|
| Smart Picks (`index.js` `buildSmartPicks`) | the library's artists, weighted by plays | ListenBrainz, by MusicBrainz artist ids | Qobuz's (or TIDAL's) own catalogue search, with Rouen's own sign-in | the service's |
| The share card's "If you like this" (`/api/similar`, `lib/similar.js`) | the artist playing | Deezer | Deezer's album list | Deezer's |
| Discover (new releases, `lib/newreleases.js`) | the artists you play | — | MusicBrainz's release groups | Deezer's or the Cover Art Archive's |

A tap then asked Roon's search for the outside service's strings (2.0.6-t12 to t16): Roon spells titles and credits
its own way, so an album the outside service named was often not one Roon could find by those words. Fixing the last
step could never make the first steps Roon's. Discover is not part of the owner's request; it stays as it is until
the owner asks.

## 3. What Roon has (proven, read only)

- **`Library::GetPerformer(PerformerBase)`** (`native-remote.md` §16.5, v1.9.70-t4): a `Performer` with **`SimilarTo`**
  (23 on the owner's server for the artist read), `MemberOf`, `CollaboratorWith`, `Genres`. Roon's own similar
  artists. Its members' form (PerformerLites by reference, their names, whether they carry anything that says they
  are in the library) was said by count alone.
- **`Library::GetAlbum(AlbumBase)`** (§16.5): an `Album` with **`SeeAlso`**, Roon's own "See also" for the album. Its
  contents were not read.
- **`Library::UnifiedSearch`** (§9.1, v1.9.32; `find.js`): Roon's own search, answering top results, a top album, a
  top library album and the album list, each album marked in the library or not, with its `ContentSource` (TIDAL,
  Qobuz) and `AlbumId`. The add (§9.2) is built on it.

Not known, and asked by §4's probe: what a `SimilarTo` performer carries (its name; whether `GetPerformer` answers for
a performer not in the library, and with what — an album list?); what `SeeAlso` holds (albums? in the library or the
catalogue? by reference?); what `UnifiedSearch` answers for an artist's name (its performers; its albums, in what
order; which of them are that artist's).

## 4. Stage 0 — the probe (2.0.6-t17), run by hand

`GET /api/debug/roon-suggest?run=1[&title=&artist=]` over native mode's connection, in its turn, once its library has
been read. Read only: nothing is written, in Roon or in Rouen. The album: the one named, else the album playing in
the first playing zone (by its title and artist, found in the library read), else the library's first.

1. **`GetAlbum`** for the album: its `SeeAlso` given whole — each item, and each object an item names, whole.
2. **`GetPerformer`** for its main performer (`reads-probe.js` `performerOf`): its `SimilarTo` given whole.
3. **For each of the first three of `SimilarTo`:** `GetPerformer` for it (a performer not in the library may be
   refused, or answer differently: said as it comes), given whole; then **`UnifiedSearch`** for its name: the result
   object's own members and its albums (title, credit, source, in the library or not, `AlbumId`), in the order
   Roon gives them, the first 15; each result object disposed once, as `find.js` disposes it.
4. The connection's state before and after each step, as `reads-probe.js` says it; every step on its own (one
   refused or unanswered leaves the others; once the connection is uncertain nothing more is sent). Nothing runs
   when the graph has too little room left (`find.js` `noRoom`).

**Methods:** none new. `GetAlbum`, `GetPerformer` (here also on a performer named by `SimilarTo`, the one argument not
yet tried), `UnifiedSearch` and its `Dispose`, all read only.

## 5. Stage 1 — the new method (designed once the probe has run; the owner's answers, 2026-11-24)

- **Smart Picks seeds: "Both, mixed"** — mostly the artists played recently in Roon's zones (Rouen's play history),
  with some from the rest of the library. Each seed's similar artists: Roon's `SimilarTo`.
- **The share card: "Similar + See also"** — the playing album's `SeeAlso` first, then albums by the playing artist's
  `SimilarTo` to fill the list.
- **"Only new to me"** — no album already in the library is suggested (`UnifiedSearch` says which are).
- **Which album of a similar artist: "Roon's first listed"** — the first of that artist's albums in Roon's own order,
  passing over compilations and live albums where Roon marks them as such.
- **Opening one:** each suggestion keeps Roon's own identity for its album (what the probe shows is stable: its
  `AlbumId`, or the search that found it and its place there), so a tap opens exactly that album in the album view,
  with nothing matched by words. How, is decided with the probe's answer in hand.
- **Taken out:** ListenBrainz and MusicBrainz (Smart Picks' similar artists and seeds' ids), Qobuz's and TIDAL's own
  catalogue searches, and Deezer (the share card's), from these two features. Native mode off: no suggestions, said
  so, rather than outside ones (to be confirmed with the owner when stage 1 is designed).
