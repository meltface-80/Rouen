# Album credits

The owner, 2026-10-27, with two screenshots of Mandarin's album page: "Look at Mandarin and how the album pages
have credits for the members of the band for the album at its time of release. I want that same feature in
Rouen." On where they come from: "Tags, MusicBrainz and direct using the reverse engineered code for native mode
with Roon. Credits are already on Roon so access to them should be easy." On pictures: the same as Mandarin's.

Mandarin's feature is the model: its bug list items 129 (the server finds the credits and who each act is) and
132 (the album page shows them), `server/Mandarin.Server/Credits/` and `public/app/album-credits.js` there. What
differs here is said where it differs.

## 1. What the page shows

Under the album's tracks, a **Credits** section: one row a person or group, each with
- a round picture (theirs once found, else their first letter);
- the name;
- their parts in order (instruments and voices, then writing, then making the record, then its sleeve), and,
  when they are not on every track, which: "tracks 1–3, 5" (runs of three or more as a range), "track 4".

The rows come in that order too: those who play and sing first, then who wrote it, who made the record, its art.
Within each, those on the most tracks first, then by name. Eight at first; **More** shows the rest, **Less** hides
them again. A tap on a row opens that name's artist page, whose Back returns to the album, as the album page's
own artist links do.

Hidden until there is something to show. Nothing shows for an album no source can say anything of. An answer
for an album no longer open is dropped. Not on Now playing (as "More by" is not).

On a phone the section follows the tracks, before "About this album". From 720px up it heads the left-hand column
under the cover, where "About this album" and "More by" already sit. Same rows either way.

## 2. Where the credits come from

Three sources, each read when an album's page first asks (§4), merged into the one list.

### 2.1 Your Roon server (native mode on)

Roon already holds the credits it shows on its own album pages. Rouen reads them over native mode's connection,
read only, as `dev/design/roon-native.md` allows, from two calls:

- `Library::GetMultiAlbumEditInfo` for the one album: the call t3 proved and t4 runs (`catalogue.md` §4). Its
  `AlbumEditInfo` carries `Credits`, an `EditListInfo<Credit>`, the album-wide ones.
- `Library::GetTrackEditInfo(AlbumBase, ResultCallback<IList<TrackEditInfo>>)`, the album as the connection's
  own object. **New to the allowlist in this build: never run upstream nor captured.** Each `TrackEditInfo`
  carries its `TrackNumber` and `MediaNumber` and its own `Credits`.

A `Credit` (the catalogue, `catalog.authoritative.json` at 8b67208) is `{ Role: string, Type: CreditType,
Performer: PerformerLite }`, CreditType being Unknown 0, Composer 1, Conductor 2, MainPerformer 3, Performer 4,
Ensemble 5, Production 6. Rouen takes each list's `Values`, what Roon shows (its own edits and the file's layer
already applied), and leaves the other layers.

Read as this design reads them, each said as tried until the owner's server proves them:
- the argument: the album's object id, as every by-reference argument Rouen sends;
- the answer: a LengthPrefixed collection of inline `TrackEditInfo` structs, else the collection bare (the
  album edit info's reader, `edit-info.js` `readAnswer`);
- a credit's name: its Performer, a `PerformerLite` the server sends by reference, named by its `Name` member
  when the server has sent the object. A credit whose performer came without a name is left out, and counted.
- a track's place: its `MediaNumber` and `TrackNumber`, numbered through the album in that order (disc 1's
  tracks, then disc 2's), as the album page numbers them.

The role is Roon's `Role` as written (first letter capitalised); an empty one takes its Type's name ("Composer",
"Conductor", "Performer", "Ensemble", "Producer" for Production). A credit's Type also places a role Rouen's list
does not know (§3): Composer with the writers, Production with those who made the record, the rest with those
who play.

A call refused, an answer that can't be read, native mode off or not connected, or the library not yet read on
the connection: Roon gives nothing this time, the other sources stand, and the debug read (§6) says why. Nothing
is written to Roon. When it couldn't be asked at all (native mode off, not connected, the library not yet read, the
connection being checked), it is asked again once it can be, ten minutes on at the earliest (§4); the tracks' read
refused while the album's answered is a failure, asked again the next day.

### 2.2 The files' own tags (albums in /music)

For an album the label scan found on disk (`localAlbumDirs`), every audio file in its folder is read with
music-metadata, and each track's credits taken from its tags as Mandarin's `CreditRules.FromTags` takes them:
- PERFORMER "Name (drums, percussion)": the name and each part; no brackets, "Performer";
- the ID3 credit lists (TMCL, TIPL, IPLS): each role and its names;
- PRODUCER, ENGINEER, MIXER, DJMIXER, ARRANGER, REMIXER (TPE4), LYRICIST (TEXT), WRITER, COMPOSER (TCOM, ©wrt),
  CONDUCTOR (TPE3), ENSEMBLE, ORCHESTRA, under their own and their iTunes / TXXX names.

A name tag holding several names ("A; B", "A / B") is several names. A track's number is its place through the
album from its disc and track tags (disc 2's after the highest track number disc 1's files have), so a file that
can't be read leaves its number empty rather than moving every later track up; files with no track tag come after
every numbered one. An album in several folders (CD1, CD2) is read from the folder the scan kept for it: the debug
read says which folder, and how many of its files couldn't be read.

### 2.3 MusicBrainz

The album's MusicBrainz release, then its relations, as Mandarin asks for them (`inc=artists+recordings+artist-
credits+artist-rels+recording-level-rels+work-rels+work-level-rels`): who played and sang on each recording, who
wrote each work, who made the record and its sleeve. Mandarin's `CreditRules.FromRelease` and `RolesOf`
throughout: an instrument or vocal relation names its parts by its attributes ("guest", "solo", "additional" and
the like say how, not what, and are left off); a producer is "Producer", "Co-producer", "Executive producer" or
"Assistant producer"; the other types by Mandarin's table.

Which release:
1. the files' own (MUSICBRAINZ_ALBUMID, as Picard writes it), the one most of the tracks carry;
2. else, for any album, one found by name, since Rouen has no identification scan of its own (Mandarin takes its
   scan's applied match). A release search by title and artist, keeping only a release whose title and artist
   are the album's as Rouen compares names (`lib/albumkeys.js`) **and** whose track count is the album's as
   Roon gives it. None that agrees on all three: no release, and MusicBrainz gives nothing.

One request at a time, 1.1 s apart, in the queue every other MusicBrainz lookup of Rouen's waits in (`mbWait`).
A release since merged or removed (404) gives nothing; anything else is asked again the next day.

### 2.4 Merged

Mandarin's `CreditRules.Merge`: one row a name (compared as Rouen compares artist names), every role it has in
any source (the same role twice, whatever its case, once), on the tracks any source puts it, or on every one
when a source credits it with the whole album or it is on every track. A name in a script Rouen's keys drop (they
keep a–z and 0–9 only: Japanese, Cyrillic, Greek…) is compared as written, lower-cased, rather than left out. The name as written comes from the first
source that has it in this order: your server, MusicBrainz, the tags. So Roon's spelling wins, as on its own page.

## 3. The order

Mandarin's ranks, by role: players and singers 0, writers 1 (Composer, Lyricist, Writer, Librettist, Translator),
those who made the record 2 (Producer and its kinds, Engineer and its kinds, Mixing, Mastering, Editor,
Programming, Remixer, DJ mix, Arranger, Vocal arranger, Orchestrator), the sleeve 3 (Design, Illustration,
Graphic design, Photography, Art direction, Creative direction, Liner notes). Compared without regard to case, so
Roon's "Recording Engineer" ranks as "Recording engineer". A role none of these names: its Roon Type's place
(§2.1), else with those who play. A row's roles in rank order, and the row at its first role's rank.

## 4. When, and kept

An album's credits are found the first time its page asks, and kept (`album_credits` in the labels database,
keyed by the album's key): the rows, which sources gave something, and when. The page asks once, waits up to 8 s
for the first read, and is told "pending" past it; it asks once more 6 s later. A kept answer is given at once.

Read again after 30 days, so a library's new tags and MusicBrainz's new entries arrive; a source that failed (not
"gave nothing": failed) is asked again the next day; your server, when it couldn't be asked then and can be now, ten
minutes on. Roon is asked in its turn on the connection while the files are read and MusicBrainz asked (MusicBrainz
needs only the files' release id), so a slow turn doesn't hold the other two back. A library album's credits are not found in the background
in this build: only the albums opened.

## 5. Pictures

Mandarin's `CreditFinder.LookUp` and its picture order, for each name on an album opened:
1. its MusicBrainz artist: the release's own id for it where MusicBrainz gave the credit, else found by name
   (`artist/?query=artist:"…"`, the first whose name is the one asked, a leading "The" aside);
2. its picture: FanArt.tv's first artist portrait (with the FanArt.tv key, Settings → API keys), else
   Wikidata's (its P18, from the MusicBrainz entry's Wikidata link, as Wikimedia Commons serves it 640 wide),
   else Deezer's (a name search, the first of that name with a picture of its own).

Looked up in the background, one name a turn, MusicBrainz's at its pace; the names of the album just opened first.
Kept (`credit_acts`): the name, its MusicBrainz id, the picture's address and where it came from, and when.
Looked up again after 90 days; one MusicBrainz could not be reached for is asked again the next day. The page shows
the round initial until a picture is found, and the picture from the next time the album is opened.

## 6. The routes

- `GET /api/album/credits?title=&artist=&tracks=N`: `{ credits: [{ name, roles, tracks, photo, source }],
  status }`. `tracks` is empty when on every track. `photo` is the picture's address or null. `status` is
  "ok", or "pending" (still being read; ask again). `N` is the album's track count as the page has it (§2.3).
- `GET /api/debug/album-credits?title=&artist=`: what each source gave the album and why one gave nothing (native
  mode off; no folder; no release found and what was searched; the calls' statuses and the answer's form; credits
  left out for a performer with no name), the merged rows, and the pictures' state. For the owner's server to
  prove §2.1.

## 7. The band's current members, on its artist page

The owner, 2026-10-27, on the same build: "On the album artist page it should only show the current active members
of the band which might be different to the artists on the album at the time of the recording." So two lists, never
mixed:
- the album page's credits (§1) are who played on that record, when it was made;
- an artist page, for a band, shows a **Members** section: the band's members now, and only them. One who has left
  is not shown, however many of its albums they are on; one who left and came back is (their latest stint is open).

From MusicBrainz: the band's artist entry asked with its artist relations (`inc=artist-rels+url-rels`), its "member
of band" relations from the members' side (direction backward). A member is current when a stint of theirs has
neither an end date nor is marked ended. Their parts are that stint's attributes, read as the credits' are (an
instrument or a voice; "original", "founder" and the like say how, and are left off). A person, or an act MusicBrainz
lists no members for, has no Members section.

The band is found as §5 finds a name (its MusicBrainz id from a release's credit where one was read, else by name),
looked up when its artist page is first opened and kept with its picture (`credit_acts`), again after 90 days. Each
member a row as the credits' (§1): a round picture (found as §5 finds them, once the section has shown) or their
initial, the name, their parts; a tap opens their artist page. Under the page's own heading, before the albums.

`GET /api/artist/members?name=` → `{ members: [{ name, roles, photo }], status }` ("pending" while being looked up).

## 8. Not in this build

- A walk of the whole library: credits are found as albums are opened.
- The Shelf's album view and the Now playing screen.
- The rest of Mandarin's artist page (items 130, 131): an act's years, its links, a person's bands, former members.
- Roon's own performer pictures (`PerformerLite`'s Photo and Avatar), which would need a route for Roon images
  by a private object: Mandarin's sources stand meanwhile.
