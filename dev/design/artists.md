# The touch bar's order, the menu on Home, and the Artists screen

The owner, 2026-10-27: "On the home screen move the settings hamburger to the top right of the screen. On the
bottom bar, move the home button to the left. The bottom bar order will be this: Home - Library - Artists - Shelf
(when enabled) - Search. Auto equal spacing based on the icons."

Asked, the owner chose:
- **Artists:** a new screen listing every album artist, A to Z, each with a picture and an album count. A tap opens
  that artist's page.
- **Shelf:** always on, so always in the bar. It has no switch, and none is added.
- **The menu:** at the top left of Home only, where the side menu opens from (the owner corrected "top right" to
  "top left" the same day). From any other screen, it is reached by going to Home first.
- **Scope:** phones and tablets only. A desktop (mouse) keeps its top bar as it is.

First shipped in v1.9.70-t6.

## 1. The bar

The touch layout's row along the foot of the screen (`public/touchnav.js`, v1.9.14) holds, left to right:
**Home · Library · Artists · Shelf · Search**. Menu is no longer in it.

Every button takes an equal share of the row's width, with its icon centred in that share, so the icons are evenly
spaced across the screen. Should a button ever be absent, the rest share the row equally.

| Button | Does | Lit (accent) |
|---|---|---|
| Home | Home, as before; a second tap scrolls Home to the top | on Home |
| Library | the Library wall, as before | on the Library wall |
| Artists | the Artists screen (§3); a second tap scrolls it to the top | on the Artists screen |
| Shelf | the Shelf page, as the side menu's Shelf does (`window.__openShelf`) | never: it is another page |
| Search | as before | while a field is open |

Each button first closes what covers the screen (an album's page), as before.

## 2. The menu on Home

On Home, in the touch layout, the ☰ sits at the top left, level with the date over the greeting, which moves right to
keep clear of it. It opens the same
side menu (`#menu-toggle`'s). It is part of Home's page and scrolls away with it. It shows on Home only: not while
Home's search is open (the top bar is back then), and not on any other screen.

## 3. The Artists screen

### 3.1 What it shows

Every album artist in the library: the lead artist of each album's credit, as the Library's Artist order and the
Shelf file albums (`cFirst`, a leading "The" aside). An album counts for an artist exactly as the artist page counts
its own albums: credited to that name as a whole, or with that name first (`artistLibraryAlbums`'s `primary`).
Appearances further along a credit are not counted, and add no name to the list.

The screen's title is "Artists". The names are in A-to-Z order, under a heading for each letter (A … Z, then # for a
name starting with anything else). Each tile has:
- a round picture: the artist's photo once Rouen has one (§3.2), else one of their album covers;
- the name, as the albums credit it;
- "N albums".

A name whose canonical form is empty (all its letters outside a–z and 0–9, such as an all-CJK name) has no artist
page to open, so it is left out, as `/api/artist-albums` leaves it.

### 3.2 Pictures

These are the pictures the album credits keep for names (`credit_acts`, `dev/design/album-credits.md` §5), from
MusicBrainz, FanArt.tv, Wikidata and Deezer. No new source is added.
- A name with a picture kept shows it, over its cover. A picture that fails to load (gone, or refusing to be shown
  on another site) is dropped, and the cover shows.
- A name without one shows one of its album covers.
- The names that come on screen with no picture are asked for, in the credits' background queue (at MusicBrainz's
  pace, the names on screen first; `acts.want`).
- Pictures found while the screen is open are fetched once more about 15 seconds after those names come on screen.
  Any found later show the next time the screen opens.

### 3.3 Moving about

- A tap on a tile opens the artist page (`__showArtistAlbums`).
- That page's Back returns to the Artists screen as it was, at the same scroll position. The artist page keeps the
  screen it was opened from and puts it back, and the Artists screen is drawn into the same shared grid every
  screen uses, entered as the menu's screens are (`RouenHost.enterFullWall`).
- A letter strip down the right edge jumps to that letter's heading.
- The list is read afresh each time the screen opens.

### 3.4 The routes

- `GET /api/artists` → `{ artists: [{ name, albums, cover, photo, letter }], ready }`.
  - `cover` is an album's image key, or null.
  - `photo` is the kept picture's address, or null.
  - `letter` is the heading the artist goes under: A to Z, or #.
  - The list is made once for each state of the library (its revision), and the pictures are read afresh on each
    request.
  - The list is in A-to-Z order (`cFirst`).
  - `ready: false` while the library is still being read, with an empty list.
- `GET /api/artists/photos?n=<name>&n=…` (at most 60 names) → `{ photos: { <name>: <address or null> } }`. The
  names with none are queued for a lookup.
