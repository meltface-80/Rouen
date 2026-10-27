# Shelf focus: Format, Favourites and Genres from Roon

The owner, 2026-10-27: "Additional focus filters for the shelf. Format - all from Roon reverse code. Favourites -
all from Roon reverse code (already implemented). Genres - allow A to Z/Z to A and by #N. Genres must come from
Roon using reverse code." Asked how far each goes, the owner chose:
- Format: **all three groups**: the file formats, the quality groups and the exact resolutions;
- Genres: **every genre Roon gives** an album, not only its top-level ones;
- Favourites: **a Favourites tab** of its own.

First shipped in v1.9.70-t5.

## 1. The tabs

The Shelf's focus picker gains two tabs, **Format** and **Favourites**, placed before **Order**. With the eight tabs
that makes, the tabs sit in rows: each at least as wide as its label and badge, the rows filled out. A wide
picker (a phone on its side) keeps them in one row; a desktop's side pane (300–660px) has two. Equal columns
were tried and cut "Favourites" and its badge short there.

Each new tab behaves like the ones already there:
- its tiles narrow the shelf;
- each tile's count is the number of albums it would leave, given what the other tabs have chosen;
- a choice shows among the chosen chips and is cleared by Clear.

- **Format**: tiles under headings, as §3 says. An album sits under every tile its format puts it under. Choosing
  several tiles keeps the albums under any of them.
- **Favourites**: one tile, "Favourites", that keeps the albums hearted in Roon for Rouen's profile.
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
| `GenreObjects`, else `Genres` | every genre the server gives the album: each GenreLite's `Name`, or the names | `album-facts.js` `genresOf` |
| `IsFavorite` | the heart, for Rouen's profile (already read since native favourites) | `albums.js` |

Nothing new is asked of the server, so `lib/roon-direct/methods.js` and `dev/design/roon-native.md` are
unchanged. An AlbumFormat sent by reference is let go from the graph once read, as the album itself is. The
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

Whether a server sends `AlbumFormat` and `GenreObjects` in the library's pages is not yet proven on the owner's
server; the fake core sends them, and the fakes are not evidence. The tally makes the answer visible either way.

## 3. Format: keys, groups and names

Each album is sent `fx`: [file format, sample rate, bits, channels, MQA rate, lossy bit rate, streaming 1/0,
mixed 1/0], or null. `public/shelf-format.js` turns it into the tiles it sits under:

- **Formats**: `file:N`, named as Roon names the FileFormat: FLAC, AAC, ALAC, MP3, WAV, OGG, AIFF, WMA, TIDAL,
  DSD (DSF), DSD (DFF), Qobuz, KKBox, Unknown format. Sorted by name.
- **Quality**, in this order, at most one of the first four:
  - DSD: a DSF or DFF file, or a rate of 2.8224 MHz or more;
  - Lossy: AAC, MP3, OGG or WMA, or a lossy bit rate;
  - Hi-Res: over 48 kHz, or over 16 bits;
  - CD quality: 44.1 or 48 kHz at 16 bits or fewer;
  - then any of MQA (an MQA rate), Multichannel (more than two channels), Streaming and Mixed formats.
- **Resolution**: one tile for each rate and depth: "96 kHz / 24-bit"; for DSD, DSD64, DSD128 and so on
  (a rate that is no multiple of 2.8224 MHz is shown in MHz). PCM by rate then bits, DSD after.
- **Not known**: albums with no facts at all.

A group with no tiles is not shown.
