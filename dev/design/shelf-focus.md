# Shelf focus: Format, Favourites and Genres from Roon

The owner, 2026-10-27: "Additional focus filters for the shelf. Format - all from Roon reverse code. Favourites -
all from Roon reverse code (already implemented). Genres - allow A to Z/Z to A and by #N. Genres must come from
Roon using reverse code." Asked how far each goes, the owner chose:
- Format: **all three groups**: the file formats, the quality groups and the exact resolutions;
- Genres: **every genre Roon gives** an album, not only its top-level ones;
- Favourites: **a Favourites tab** of its own.

First shipped in v1.9.70-t5.

The owner, later the same day, showing Rouen's Format tab beside Mandarin's: "This is how I want Rouen format focus
on the shelf to be like. All tiles on the shelfs focus/filter must have their titles in the centre. Except genre,
labels and favourites as they should have small album art covers on them. Also, genres aren't coming through to the
genre tile on the shelf focus panel." Then: "Also do Mandarin's two lines, evenly spaced focus selector panel." The
three groups gave way to Mandarin's tiles (§3), and the tabs to Mandarin's rows (§1), in v1.9.70-t7; the genres'
fault is in §2.

## 1. The tabs

The Shelf's focus picker gains two tabs, **Formats** and **Favourites**, placed before **Order**. The eight tabs
sit as Mandarin's do (v1.9.70-t7): two rows of four in one rounded bar, every tab the same width, the label in the
middle, the chosen tab outlined in the accent (brass), and its count of choices a small badge in its top right
corner, inside the tab, in the band over the word's line so it never covers the word. A short screen (520px tall or
less: a phone on its side) keeps the two rows, each lower, so a tile stays in reach above Show N albums. (One row of
eight was tried there, and cut "Favourites" short: the review.) The labels are a size smaller in a narrow picker (480px or less), so "Favourites" and
its badge fit a phone's quarter of the bar.

Each new tab behaves like the ones already there:
- its tiles narrow the shelf;
- each tile's count is the number of albums it would leave, given what the other tabs have chosen;
- a choice shows among the chosen chips and is cleared by Clear.

- **Formats**: Mandarin's flat tiles, as §3 says, with no headings. An album sits under one tile. Choosing
  several tiles keeps the albums under any of them.
- **Favourites**: one tile, "Favourites", that keeps the albums hearted in Roon for Rouen's profile. It is drawn as
  a genre's tile is (v1.9.70-t7): up to three of the hearted albums' covers, its name at the foot.
- **Tile sizes** (the owner, the same day): Years, Types and Formats tiles are one size at every width
  (the same columns, the scrollbar's room kept so a longer list draws them no narrower), each title in the middle
  of its tile with its lines centred. Genres, Labels and Favourites keep their tiles with three covers, their name
  at the foot. Every other tile has its title in the middle: the Order tiles too, title and note (v1.9.70-t7).
  In the middle up and down as well as across, in every browser: the title has a box of its own over the whole
  tile that centres it (v1.9.70-t8; until then Safari put it at the top). A word is never broken across lines: a
  long one ("Compilations", "Multichannel") is set smaller, by the tile's width, to fit.
- **Genres**: three sort buttons above the tiles: **#N** (most albums first, as before), **A → Z** and **Z → A**.
  The order chosen is remembered on that device (`localStorage` "shelf-genre-sort"); without storage it holds for
  the visit.

## 2. Where the facts come from

From your Roon server, over native mode's connection, with no call of its own. The library read
(`lib/roon-direct/albums.js`, the VirtualAlbumQuery's pages) is already sent each album's AlbumLite. Three of its
members carry what these tabs need:

| Member | What it gives | Read by |
|---|---|---|
| `AlbumFormat` | an AlbumFormat object (by reference or inline): `Format` (the catalogue's FileFormat), `SampleRate`, `BitsPerSample`, `Channels`, `MQASampleRate`, `LossyBitRate`, `IsStreaming`, `IsMixed` | `album-facts.js` `formatOf` |
| `GenreObjects`, else `Genres` | every genre the server gives the album: a DataList of GenreLites (by reference, or inline), each one's `Name`; or the names | `album-facts.js` `genresOf` |
| `IsFavorite` | the heart, for Rouen's profile (already read since native favourites) | `albums.js` |

Nothing new is asked of the server, so `lib/roon-direct/methods.js` and `dev/design/roon-native.md` are
unchanged. An AlbumFormat or a GenreObjects list sent by reference is let go from the graph once read, as the
album itself is; the GenreLites a list names are shared between albums, and kept. As with an AlbumFormat, the
server sends a list once a connection, so in case it shares one between albums, or names it again in an album sent
again whole, `album-facts.js` keeps the genres each list said, by object id, for that connection (the review).

**The genres' fault (v1.9.70-t5 to t6).** The owner's server sends `GenreObjects` as a reference to a DataList
object of the album's own, whose items are the GenreLites (the reads probe of v1.9.70-t4). v1.9.70-t5 read only a
list sent inline, as the fake server sent it, so every album came with no genres and the Genres tab was empty. Since
v1.9.70-t7 both forms are read, and the fake server sends the reference form. The
server sends an object once a connection, so in case it shares one AlbumFormat between albums, or names it again
in an album's update, `album-facts.js` keeps what each one read said, by object id, for that connection.

The Shelf uses these facts while native mode's library is in force. `lib/roon-direct/library.js` hangs the
server's album on each record it pairs. It is not enumerable, so a saved snapshot doesn't carry it, and it is
read live:
- a library read that gives the same list again (each new connection reads it) does not redo the screens, so it
  copies what it read onto the albums the records already hold rather than replacing them;
- every favourite that changes (a heart in Rouen, or one the server pushes from its own apps), and every format,
  genre or favourite a read finds moved, is counted (`stage1.js` `factsRev`). The count is in the Shelf's state
  key, and the library's revision is moved within 20 s, so an open Shelf asks again.

Then:
- the Genres tab is Roon's genres alone. An album the server sent none for has none.
- with native mode off, Genres falls back to the official API's genres, as before. Format and Favourites have no
  facts then, and the tabs say to turn native mode on (Settings → Native mode) rather than guess.
- with native mode on but no AlbumFormat or genres in any page, the tab says the server sent none. `/api/shelf/albums`
  carries `facts` ({native, albums, withFormat, withGenres, favourites}) for exactly that. An empty genre list
  counts as none. The facts are part of the answer's signature, so a page holding the same shelf still gets them.

The owner's server sends both on its AlbumLites (the reads probe of v1.9.70-t4: The Number of the Beast's
`AlbumFormat` {Format 1, SampleRate 44100, BitsPerSample 16, Channels 2, LossyBitRate 959, FormatString "FLAC 44/16"}
and `GenreObjects` British Metal, Heavy Metal, New Wave of British Heavy Metal, Pop/Rock). An AlbumLite the
server has no file for (a streaming album it suggests) carries an AlbumFormat with only an empty FormatString:
no facts, so under no Formats tile. That the library read's pages carry them as the album pages do is the same type, not yet
seen; the tally makes the answer visible either way.

## 3. Formats: Mandarin's tiles

Each album is sent `fx`: [file format, sample rate, bits, channels, MQA rate, lossy bit rate, streaming 1/0,
mixed 1/0], or null. `public/shelf-format.js` names the one tile it sits under, by Mandarin's rules
(`ShelfFormats.cs`, v1.9.70-t7; the three groups of v1.9.70-t5 are gone):

- **DSD**: a DSF or DFF file, or a rate of 64 × 44.1 kHz (2.8224 MHz) or more. Named by the rate's whole multiple of
  44.1 kHz (of 48 kHz for a rate of the 48 kHz family: 3.072 MHz is DSD64) and the channels as SACD says them:
  "DSD64 2CH", "DSD128 Multichannel". Plain "DSD" for a rate not known, or below DSD64 (a DSF whose rate is given as
  PCM's); no "2CH" when the channels aren't known, rather than claim stereo (the review).
- **PCM**: a file that is not lossy, with its bits or its rate known. "bits/rate", the rate in kHz as short as it
  goes: "16/44.1", "24/96", "24/88.2". The rate alone where the bits aren't known ("96 kHz"); the bits alone where
  the rate isn't ("24-bit"). A streamed album (TIDAL, Qobuz) whose rate is known is under its resolution too.
- **Multichannel**: more than two channels adds " Multichannel" to the name: "24/192 Multichannel".
- **Lossy**: AAC, MP3, OGG or WMA, by the file alone, named so: "MP3". `LossyBitRate` is not a sign of loss: it is
  the average bit rate of any file, and the owner's FLAC 44/16 album carries 959 (the reads probe, v1.9.70-t4).
- **The rest**: the file format's name as Roon names it (FLAC, ALAC, WAV, AIFF, TIDAL, Qobuz, KKBox …), for an album
  nothing else is known of.
- An album with no facts, or a file format Rouen has no name for, is under no tile.

The tiles in order: PCM by bits, then by rate (the bits not known after those that are), stereo before
multichannel; then DSD by rate; then the rest by name. A tile is shown only when an album is under it, with how
many albums it would leave.
