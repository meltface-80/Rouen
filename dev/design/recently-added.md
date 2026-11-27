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

### 3.3 The third run (2.0.6-t13, 2026-11-24, Rouen Lite, 13,067 albums): the forms, proven

- **`ImportDate` is declared `System.DateTime? Sooloos.Broker.Api.AlbumLite::ImportDate`, property type 18** (a
  nullable long). Every one of the 13,067 albums carried one. Its value is a .NET `DateTime`'s `ToBinary`: its two top
  bits its kind (UTC on the owner's server), the rest its ticks since 0001-01-01. Read so, the newest was Zero 7's "When
  It Falls" at 15:46:12 UTC that day, an hour before the owner sent the run, and the next (Hermanos Gutiérrez,
  Khruangbin, The Killers) a few seconds or minutes apart that morning, as albums added one after another are. Read as
  ticks alone, Unix milliseconds, Unix seconds or a `NullDate`, every value gave no date. The owner had not compared
  them with the dates Roon itself shows when this was built; that comparison is the check on the device. The oldest-first page began on 2026-09-15.
- **`OriginalReleaseDate`, `ReleaseDate`, `RecordingStartDate`, `RecordingEndDate` and `ShowPerformanceDate` are
  declared `Sooloos.NullDate`, property type 24** (LengthPrefixed): the form `native-remote.md` §12.12 proved in
  v1.9.57 on a smart playlist's `MinDate` and `MaxDate`, the integer `(year << 16) | (month << 8) | day`.

So §4's first case holds: both dates come with the album, in the library read Rouen already makes, and no call is
added.

## 4. Stage 1 — Recently added from Roon (built in 2.0.6-t15)

**The owner (2026-11-24):** "We are using the Roon reverse code here so the date on the album screen should be coming
from there and therefore the date on the share card should be from the same source. We need to stop relying on API's
wherever possible and use the official API and the reverse code to bridge missing gaps." `roon-native.md` §1 records
the rule.

- The library read (`lib/roon-direct/albums.js`) reads each album's `ImportDate` as `added` (Unix milliseconds,
  `lib/roon-direct/album-dates.js` `addedOf`): the ticks without the kind bits (.NET stores a local `DateTime`'s
  `ToBinary` as UTC ticks too), and no date outside 1990 to 2100, so a form not this one never passes for a date. Its
  raw digits stay on the record (`importDate`) for the probe.
- **Recently added** and the **Added in the last** filter read `albumAddedOf`, which is Roon's date added wherever the
  library in force is Roon's (`al.roon.added`), and Rouen's own evidence (`albumSeenCache`) otherwise: native mode off,
  its library not yet read, Roon's read failed, or an album Roon gave none for. Nothing is stored: Roon's date is read
  with every library read, and Rouen's own dates stay as they were for when Roon's library is not in force, which then
  says nothing new.

## 5. Release dates from Roon (built in 2.0.6-t15)

The same rule, for every date Rouen shows or orders by: the album screen's, the share card's, the Release date sort,
the Decade facet and the random-by-decade picks, which all read Rouen's one date store (`index.js` `setAlbumYear`,
`albumYearCache` and `albumDateCache`, each with its source).

- The library read reads each album's `OriginalReleaseDate`, and its `ReleaseDate` (`album-dates.js` `releasedOf`), as
  `released`: as much of a date as Roon gives ("YYYY-MM-DD", "YYYY-MM" or "YYYY"). The original release, which is what
  Rouen's dates have always meant (never a reissue's); the `ReleaseDate` only where Roon gives no original, or where it
  says more of the same date ("2008" and "2008-11-18" are one release told to the day).
- **Roon is the first source** (`yearSourceRank` "roon", above a file's own tags): each library published with Roon's
  in force (`publishLibrary`) writes Roon's date under each of its albums' keys (`storeRoonDates`,
  `album-dates.js` `storeReleased`; one transaction, one bump of the library's views when anything changed, counted as
  each change is made so a store that fails part way still bumps for it). Nothing ranked below Roon replaces it.
- **Roon's word is its whole word each time.** A date Roon has changed replaces the one it gave (`restate`). A key whose
  stored date is Roon's and that Roon no longer dates is withdrawn (its row deleted), for the other sources' next
  harvest to fill again.
- **One date per key** (the review, 2.0.6-t15). Rouen keeps one date under an album's title and artist
  (`albumYearKey`), and several albums can share one (Weezer's five records called "Weezer"). Where Roon dates them
  differently, it states no one date for the key: the key is left to the other sources, which refuse such a key too
  (`harvestAlbumYears`' ambiguity rule), and a date of Roon's stored there before is withdrawn. Where one says the same
  release more finely ("1969" and "1969-09-26"), the finer is the key's.
- **Native mode off, or Roon's library not read:** nothing of Roon's is written or withdrawn, and the dates Roon gave
  stay in the store as the best known (Rouen keeps one date per key, and Roon's replaced the others'). An install that
  never turned native mode on is exactly as before.
- **The gaps are bridged by the sources Rouen already has**, ranked below Roon as before: an album Roon gives no date
  for keeps theirs; where Roon gives only the year, a day another source states of that same year is kept (the
  existing rule: any source may refine a day, only a better one may contradict it); the day lookups still run for an
  album with a year and no day.
- **The album screen's year** (`/api/album/extras`, `lib/routes/album-extras.js`) is Roon's wherever Roon gave the
  album's date, and MusicBrainz is not asked for it; its date line was already the stored date. The share card reads
  the same answer (2.0.6-t13), so the two show Roon's date together.
- An update the server pushes may carry one of the two release dates alone: it is read with the other as known on the
  connection (`albums.js` `datesOf`), so a remaster's `ReleaseDate` pushed alone never becomes the album's date.
