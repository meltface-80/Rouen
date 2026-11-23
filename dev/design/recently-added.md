# Recently added, from Roon — design

## 1. Goal (the owner, 2026-11-23)

> "sortby date added is still not changing. Even if added today the grid should still changed from oldest to newest and
> newest to oldest"

Rouen has dated an album by when Rouen first saw it (`albumSeenCache`: a file's own date where the music folder has one,
else the rebuild an album first turned up in). An album already in the library when Rouen was installed has no such date,
and is held out of the sort, A to Z at the end, in both directions. On a library with no files of its own (Qobuz alone,
every Rouen Lite) that is the whole library, so Recently added is the same list both ways. 2.0.6-t4 fixed the part of
that which was a bug (the first run never ended without files); what remains is that Rouen cannot know when an album was
added before it was there.

Roon can. **The owner's choice (2026-11-23): Recently added is Roon's own date added, with native mode on; Rouen's own
dates stay as the fallback** when native mode is off or Roon's read fails. `CLAUDE.md` and `roon-native.md` §1 apply:
Roon's private protocol is the source where it is proven, method by method.

## 2. What is known

- Roon's `AlbumQueryOrdering` has an `ImportDate` order (`AlbumOrdering` 1), its `Direction` Ascending 1 or Descending 2.
  It has been sent, and read back as sent, in a smart playlist's Focus made on the owner's server (`native-remote.md`
  §12.15, v1.9.60: "Recently added newest first").
- Native mode's library read (`roon-native.md` §10, `lib/roon-direct/albums.js`) asks `Library::VirtualAlbumQuery` with
  no criterion, and pages through it whole.
- **Not known:** whether an album as the server sends it (`AlbumLite`) carries its import date as a field; whether
  `VirtualAlbumQuery` honours an `Ordering` in its criteria (it has only been sent inside a playlist's parameters); and
  whether a query's rows arrive in its order (a smart playlist's items have, `native-remote.md` §12.3).

## 3. Stage 0 — the probe (2.0.6-t5), run by hand

`GET /api/debug/roon-added?run=1` (without `run=1` it asks nothing), over native mode's connection, in its turn with the
other reads, once its library has been read. Read only: nothing is written, in Roon or in Rouen.

1. **The album's fields as the server declares them:** the members of the `AlbumLite` type, and of a query's row
   (`VirtualQueryElement<AlbumLite>`), as declared on this connection, and among them those whose names speak of a date,
   an import or an addition. No call: the declarations are what the connection was sent.
2. **The control:** `VirtualAlbumQuery` with no criterion, its Count.
3. **Newest first:** `VirtualAlbumQuery` with `Ordering` {`ImportDate`, `Descending`} and `UiLanguage` "en". Its Count,
   which must be the control's; then paged through whole, as stage 1 would, each page released and its rows let go from
   the graph once read (a read of the whole library on the connection native mode keeps must not fill it). Each row's
   album is named from the library read by its object id (the server does not send an album's fields twice on one
   connection). Reported: the rows read, how many are albums of the library read, whether the rows came in their
   `Index` order where rows carry one, and the first 20 (title, artist, source, and the row's `Index` where it has one).
4. **Oldest first:** the same with `Ascending`, its first page alone, its first 20.
5. **The verdict, "ordered"** only when both Counts are the control's and came as Counts, the newest-first read is
   whole and every row an album of the library, the oldest-first page did not come in the newest-first order (an order
   ignored gives both reads in the server's own order), and, in a library of at least two pages' worth (twice the
   oldest-first page), at least 90% of the oldest-first page are among the last of the newest-first read (a tie within
   one import, many albums added at once, may fall either side of a page's edge). In a smaller library that last check
   proves nothing (any page is mostly the end), so "ordered" there says it was told by the two directions differing.
   An empty library, one album, a Count that never came, or a short page is "unknown", said as what it was. Anything
   else is said as what it is. The owner compares the first 20 with Roon's own Albums sorted by Date added, newest
   first.
6. Every query opened is disposed once, every page retained is released once (`paging.js`); the lifetime, the time
   taken and whether the connection is still open are reported. A page budget (`&max_pages=`, a whole number; default
   300, 30,000 albums) bounds the newest-first read; reaching it is said, and the verdict is then not "ordered".

**Methods:** none new. `Library::VirtualAlbumQuery`, `VirtualAlbumLiteQuery::RetainPage`, `::ReleasePage`, `::Dispose`,
as stage 1 runs them. New is the `Ordering` member of the `AlbumQueryCriteria` this call sends, an `AlbumQueryOrdering`
inline as a smart playlist's Focus sends it; `AlbumQueryCriteria` is declared on the connection as every album query
declares it (`schemas.js`), so the library read's declaration is unchanged.

### 3.1 What the owner's server showed (2026-11-23, 2.0.6-t6, Rouen Lite, 13,055 albums)

- **`AlbumLite` declares `ImportDate`** (with `OriginalReleaseDate`, `ReleaseDate`, `RecordingStartDate`,
  `RecordingEndDate`, `ShowPerformanceDate`). An album's date added is sent with the album, in the library read Rouen
  already makes: §4's first case. Its form (its declared type, and how its value reads) was not reported.
- **The ordered reads:** both Counts were the control's (13,055); the newest-first read was whole in 131 pages, every
  album one of the library read's, in 6.9 s, every query disposed and page released; rows carry no `Index`. The verdict
  was "not reversed": 25% of the oldest-first page were among the newest-first read's last 100, and the two did not
  come in the same order. Read with the first point: many albums imported at once (a library added in one go) share a
  date, and a tie's order need not reverse, so the end check does not hold on such a library. No longer needed: the
  dates themselves are read (§3.2).
- The probe ran on native mode's connection with it left open and sound (74,077 objects held).

### 3.2 The second run (2.0.6-t7): the form of `ImportDate`

The library read keeps each album's `ImportDate` as it comes (`albums.js` `importOf`: a long or an integer as its
digits, bytes as hex), and the probe adds, for each date-like member, its declaration and property type, and for each
album it lists, its `ImportDate` raw and read every way it may be written: .NET ticks (and a `DateTime`'s `ToBinary`,
its kind in the top two bits), Unix milliseconds, Unix seconds, and a `NullDate`'s integer (`native-remote.md` §12.12);
or, for bytes, as `focus.js` `readNullDate` reads them, each of its integer readings also as a `NullDate` (a `NullDate`
comes as bytes holding that integer). A date outside 1990 to 2100 is left out; the four forms of digits can't be
mistaken for one another within it. With how many of the library's albums carry one. The owner compares the
dates with Roon's own (an album's page, or Albums sorted by Date added); the form that matches is the one §4 reads.

## 4. Stage 1 — the sort (designed once the probe has run)

Built only after the owner has run the probe and its answer is read. What it answers decides the form:

- **If `AlbumLite` carries the import date:** the library read already receives it; each album's date added is Roon's,
  read with its other fields, no call added. It is a date, so it mixes with Rouen's own for an album native mode didn't
  pair, and the Added in the last filter can use it too.
- **Else, if the ordered read is "ordered":** after each whole library read, one `ImportDate` read gives each album its
  place in Roon's order; Recently added sorts the albums paired to Roon's by that place. How an album Rouen holds and
  Roon's read didn't pair is placed, and whether the Added in the last filter changes, go to the owner then.
- **Else:** Recently added stays Rouen's own (2.0.6-t4), and what the probe showed is said to the owner.

Either way: native mode off, its library not yet read, or Roon's read failed, and Recently added is Rouen's own dates,
as before, and says nothing new.
