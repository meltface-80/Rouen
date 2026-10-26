# Catalogue numbers, labels and kinds of release — design

Read before working on the Shelf's Labels, Types or Order, the Library's Album type focus or its Label & catalogue №
sort, or anything that reads an album's catalogue number or kind.

## 1. The request (a user, relayed by the owner, 2026-10-26)

> What I miss in Roon is an easy way to browse on catalogue number. It would be awesome to add the cat nr in the spine of
> the shelf (book view), and add the possibility to sort by label / cat nr. This is my main go-to way to sort electronic
> music vinyls and something I miss in Roon.

And a second: sort and focus by album type — albums, LPs, EPs and so on. The owner: Roon's own support for labels is
weak and this needs improving; keep the feel of the Shelf's sort/focus pane and add these as further ways to narrow the
shelf; add them to the Library's Focus and Sort where missing; it must work with native mode off and on; the layout to be
sanctioned from renders before it is built.

## 2. The owner's decisions (2026-10-26)

1. **The version**: 1.9.67-t1 (the next test build after the stable 1.9.66; "v1.1.97-t1" was a typo — it would sort
   below 1.9.66, so the updater would never offer it and the CHANGELOG gate refuses it).
2. **Where catalogue numbers and kinds come from**: the files' tags, Discogs, and Roon's own values — all three, in that
   order of builds (§4). A tag the owner wrote outranks Roon's identification, which outranks a Discogs match
   (`lib/release-facts.js` RANK; Roon has the same preference as a setting, `AlbumPreferLocalCatalogNumber`).
3. **The Shelf as rendered** (five renders of the real page, 2026-10-26): the catalogue number at the foot of the spine;
   divider cards where each label begins when filed by label, tiered when two sit side by side; Labels and Types tabs
   beside Genres, Artists and Years; Random grown into an Order tab (A → Z by artist, by label and catalogue №, by year,
   random); label · catalogue № · kind on the back of the case.
4. **The Library screen too**: Album type in Focus, Label & catalogue № in Sort, and the catalogue number and kind on the
   album page beside the label. Dynamic Playlists can hold both (§5).

## 3. What is built (v1.9.67-t1)

**Reading** (`lib/release-facts.js`, pure; `index.js` runFileMetadataScan). The /music walk already parses one file
per album folder for its label, year and format; it now keeps the same file's CATALOGNUMBER and RELEASETYPE too, as
MusicBrainz Picard and beets write them: a kind is MusicBrainz's secondary type where it says more (compilation,
soundtrack, live, remix — dj-mix and mixtape count as remix), else its primary (album, ep, single; broadcast and other as
other), else iTunes' COMPILATION flag; a catalogue number is the tag tidied to one line, and nothing when it only says
there is none. Nothing is guessed: an album whose tags say nothing has no kind and no number. Kept under the badge's
album keys (`albumKeys`, as the file facts are) in the labels database (`album_release`: key, catno, rtype, src), so an
album is found by its title and artist in both modes, native mode's Core list included. A tie keeps the first writer (a
set's second disc). `libraryMetaVersion` moves when the walk writes any, so the Library's and the Shelf's answers follow.

**The Shelf** (`lib/shelf.js`, `public/shelf-pick.js`, `shelf.js`, `shelf-back.js`, `shelf.css`). The one list the
page is sent carries each album's label (an index into a list commonest first, as genres are), catalogue number and kind.
The lane's tabs are Genres · Artists · Years · Labels · Types · Order (one row, two on a lane narrower than 540px).
Labels are tiles as the genre tiles are (a fan of three covers, the name, the count); Types are tiles as the decades are
(Albums, EPs, Singles, Compilations, Live, Soundtracks, Remixes, Other, Unknown — only those the library has). Both
narrow the shelf as genres do, with counts that follow every tap, chips, Clear all and Reset shelf. The Order tab holds
one order at a time: A → Z by artist (the default, no chip), by label and catalogue № (each label together, its
releases in a shop's catalogue order — numbers as numbers, "WARP 61" before "WARP 123" — then by title; albums with no
label last, by artist), by year (oldest first, undated last), random (Shuffle again and Spin as before). An order other
than the artist's is a chip; Undo never takes an order back (it only refiles the shelf). The spines' brass tabs follow
the order: a letter where a new one begins by artist, a divider card with the label's name by label and the decade by
year; a card beside another is raised, so neither hides the other. Every spine with a catalogue number shows it at its
foot, smaller than the title; the back of a case says label · catalogue № · kind under the title.

**The Library** (`index.js` libFacetDefs, libraryView; `public/lib-view.js`, `app.js`). Focus gains **Album type**,
counted per album with TYPES' names in TYPES' order; Sort gains **Label & catalogue №** (the same order as the Shelf's;
descending is the same reversed). The album page's subtitle line shows the catalogue number and the kind after the label
(`/api/album/extras`). A saved view (a Dynamic Playlist) holds both, as every facet and sort is held.

**Moved out, unchanged** (the length rule): the Labels switch and label-folder-depth routes (`lib/routes/labels-settings.js`),
the Discogs, FanArt.tv and Last.fm key routes (`lib/routes/api-keys.js`), and the Library's Sort/Focus vocabulary
(`public/lib-view.js`).

**Discogs** (v1.9.67-t2; `lib/discogs.js`, `lib/labels-discogs-pass.js`). For an album whose tags gave no catalogue
number, the label scan's Discogs pass (pass 4, a token in Settings) looks the release up and keeps its catalogue
number, its kind and, for an album still without a label, its label — one request per album, a second apart
(the client's one limiter, shared with the logo search), after the label misses, five minutes a scan, so a large
library's numbers arrive over a few scan windows. The release taken is the one whose title IS the album's (a catalogue
number is an edition's: "Geogaddi" over "Geogaddi (Remixes)"), else one whose title holds it, else Discogs' first. The
kind comes from Discogs' format descriptions, the most telling first: Compilation; Mixed, Partially Mixed, Mixtape and
DJ Mix are remix; EP and Mini-Album; Single, Maxi-Single and a 7"; Album and LP. A bare 12" or 10" is not guessed at,
and Live and Soundtrack are not Discogs formats. Kept under the album's keys with `src: "discogs"`, so a tag (and, in
t4, Roon) outranks it. An album Discogs has answered about, with something or nothing, is in `release_lookup` and not
asked about again; a failed request is not, so it is asked again next scan; ten failures in a row end the pass. A
Force rescan and a changed token clear `release_lookup`. A label miss Discogs answered with nothing is not asked
again either (the other label sources still are, every scan).

**Ranked fact by fact** (v1.9.67-t2, the review). The cache (`lib/release-facts.js`, table `release_facts`, one row
per key and source) keeps what each source said apart and reads each fact from the best-ranked source that has it:
an album whose tags say "EP" but give no number takes Discogs' number and keeps the tag's kind. `src` is the best
source that contributed a fact. A tie within a source keeps the first writer; a source read whole again
(`replaceSource`) replaces only its own layer.

## 4. The builds after this one

- **Roon's own values** (t3, a read-only probe run by hand; t4, the build): the private protocol holds a
  `CatalogNumber`, `Labels` and a `Type` (AlbumType) per album in its `AlbumEditInfo`
  (`Library::GetMultiAlbumEditInfo(AlbumEditInfoParameters)`, batched). Unproven: the probe reads a few albums'
  edit info and shows it beside the tags; the build then fills what the tags and Discogs left empty, in native mode,
  ranked between them, fact by fact. `dev/design/roon-native.md` §3's rules apply: tried, not trusted; read only; nothing proxied.
  The owner's Roon (2026-10-26, 13,298 albums) counts Main 12,565 · Live 2,285 · Compilations 1,764 · EP 424 ·
  Singles 156 · Soundtracks 147 · Other 6 · Bootleg 4 — more than the library, so Roon gives an album more than one
  type (a live compilation is both), and Bootleg is not in the AlbumType enum §5 maps. Two questions for the probe,
  settled before t4 is written: whether Rouen keeps several kinds per album or the most telling one (as the tag
  mapping picks), and where Roon holds Bootleg. The same Roon shows how far tags alone reach: Rouen t1 read 143
  albums, 30 compilations, 9 live, 2 EPs, 2 soundtracks and 13,112 unknown from the owner's tags.

## 5. Roon's smart playlists (`dev/design/native-remote.md` §12.19)

Album type maps to the Focus's `Require/ExcludeTypes` (AlbumType: album Main 0, single 1, live Show 2, compilation 3,
other 4, ep ExtendedPlay 6, soundtrack 7); Remix has no Roon type, so a playlist with it stays Rouen's, said. The Label
& catalogue № order has no Roon order (AlbumOrdering has none), so a Dynamic Playlist in that order stays Rouen's, said,
as Last played does. Roon's Unknown (5) is no kind of Rouen's, so a Roon smart playlist that names it can't be opened in
Rouen's editor, said.

## 6. Not done, and why

- **No guessing a kind** from the track count or the length: an EP by its tags is an EP; one with no tags is Unknown,
  and the tile says so.
- **Labels from file tags with the Labels switch off**: the walk hands them to the label scan, which only runs with the
  switch on; the Labels tile says so. The switch is about the label scan's network lookups, and changing what it means
  is the owner's call.
- **The catalogue number as a Focus facet**: thousands of values, one album each — the sort and the spine are what
  browsing by catalogue number needs; the Library's search finds one typed.
