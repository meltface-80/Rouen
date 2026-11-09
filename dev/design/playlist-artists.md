# A playlist's track artists, and its Sort

Status: **built in v2.0.3-t4; the native read not yet run on the owner's server for an ordinary
playlist (§3).** This document is the specification for the work it describes: code matches it, or this
document changes first, in the same commit (`CLAUDE.md`, "Spec authority"). It builds on
`dev/design/native-remote.md` §11–§12 (Roon's playlists over native mode, and the item read proven for
smart playlists).

## 1. Goal (a user's request, relayed by the owner, 2026-11-09)

> In playlist, instead of composers it would be nice to have artist for each song and maybe a chance to
> choose to have the artists in alphabetic order. It will make it a lot easier to find a specific number
> or artist when you have large playlists.

The owner asked for it to be planned, probed and built.

## 2. Why the line shows composers

A Roon playlist opened in Rouen is read through Roon's official extension API (the `playlists` browse
hierarchy, `/api/playlist`). Each track comes back as a row with a `title` and one `subtitle` line, and
Rouen shows that line under the title. Roon fills it as it sees fit; for many tracks it is the
**composers** ("David Paich" under Toto's *Rosanna*). The official API gives no other field, so it cannot
be fixed there.

Native mode already reads a playlist's items from the server itself (`Playlist::VirtualItemsQuery`,
`lib/roon-direct/playlist-items.js`, proven on the owner's server for smart playlists, `native-remote.md`
§12.2). Each item is a `Track`, whose `PerformedBy` is the track's own artist line ("Toto"); the album's
is used when the track carries none.

## 3. The probe

`GET /api/debug/roon-playlist-artists?run=1&title=<name>&offset=<n>` (read only; without `run=1` it says
what a run would do). It reads the playlist through the official API and over native mode, and returns
the first 40 rows as `{ title, line, artist, album }`: `line` is the official API's line, `artist` what
the server names. Also: how many rows the server named (`named`), and of those how many the official line
already gave (`lineIsArtist`) and how many it did not (`lineDiffers`), with the time each read took.

What a run settles on the owner's server: that an ordinary playlist (not only a smart one) is found by
name and read; how often the official line is not the artist; the time a long playlist takes.

## 4. What the user sees

On a Roon playlist's page, and on Rouen's own playlists:

- **Sort**, above the tracks: **Playlist order** · **Artist** · **Title**, one pressed. *Artist* orders
  the tracks A→Z by artist (a lead "The " ignored, then by title); *Title* A→Z by title (then artist);
  *Playlist order* puts them back. A row with no artist goes after those with one. The choice is kept on
  the device (browser storage) and applies to the next playlist opened. Tapping a row plays that track,
  whatever the order.
- **Each track's own artist** on a Roon playlist, with native mode on: the page opens as before, with the
  official line, and each line is replaced by the track's artist when the server answers (re-sorted if
  sorting). A row the server cannot name keeps its line. Sorted, each row keeps the number of its place
  in the playlist, not its place on the screen. With native mode off, or the playlist
  not found on the server, nothing changes but the Sort, which sorts on the lines shown (on Rouen's own
  playlists, the artist before " · ").

Not in this build: Roon's smart playlists and Rouen's Dynamic Playlists, whose tracks arrive a page at a
time; the shared playlist file still carries the official line.

## 5. How it is built

- **The read** — `lib/roon-direct/playlist-artists.js`, made with native mode's other services. The
  chosen profile's playlist **of exactly the name** the official API lists (else the one of that name
  ignoring case); none, or two of one name, gives no artists — never a guess. Then its items a page of
  100 at a time, to the playlist's count or 1,000 tracks (the official read's own ceiling,
  `PLAYLIST_ITEMS`), **each page in a turn of its own** on the connection, so a pause or a skip never
  waits behind a long playlist; the read stops at the first page that does not arrive whole.
- **Room on the connection** (the review). A page brings some 3,800 objects that stay in the
  connection's graph until the next connection (overnight, or native mode turned off and on), and the
  smart playlists' pages need the same room (`smart.js` stops under 50,000 objects left). So no page is
  read here with under **70,000** left — five of `smart.js`'s pages always kept for it — and the answer
  says `capped`. On the owner's server (some 99,000 of room after the library read) that is roughly
  700 tracks of playlists read per connection; a playlist past it keeps its official lines beyond the
  rows read. Answers are kept per playlist for the connection, read again only when the playlist's
  track count changes or after an hour; an answer with a track that did not arrive, or with no Count
  sent, is not kept. One read per playlist at a time. Methods added to the allowlist: **none**.
- **Matching rows** — `alignTracks` / `alignArtists`: each official row takes the server's track at its
  own place when the titles agree (compared as letters and digits, any script); else, only when the
  whole playlist was read, the track of that title when every track of that title has one artist (a
  partial list cannot say that); else none.
- **The route** — `POST /api/playlist/track-artists { title, tracks: [row titles] }` → `{ status,
  artists }` in `lib/routes/roon-playlist.js` (with `/api/playlist` and its play routes, moved out of
  `index.js` unchanged in the same build). Any status but `ok` (`off`, `none`, `failed`) comes with why
  and no list.
- **The page** — `public/playlist-tracks.js` (the Roon playlist's row, moved out of `public/app.js`
  unchanged in the same build): `enhance(ol, …)` adds the Sort and, for a Roon playlist, asks for the
  artists once the rows are drawn, applying them only while the same playlist is on screen. Rows are
  moved, never rebuilt, so each keeps its cover and its tap. Its stylesheet is its own
  (`playlist-tracks.css`).

## 6. Not in this build

- Writing anything to Roon.
- Sorting or naming the tracks of smart and Dynamic Playlists (§4).
- A search within a playlist.
