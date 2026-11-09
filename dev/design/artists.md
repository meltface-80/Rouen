# The touch bar's order, the menu in it, and the Artists screen

The owner, 2026-10-27: "On the home screen move the settings hamburger to the top right of the screen. On the
bottom bar, move the home button to the left. The bottom bar order will be this: Home - Library - Artists - Shelf
(when enabled) - Search. Auto equal spacing based on the icons."

Asked, the owner chose:
- **Artists:** a new screen listing every album artist, A to Z, each with a picture and an album count. A tap opens
  that artist's page.
- **Shelf:** always on, so always in the bar. It has no switch, and none is added.
- **The menu:** at the top left of Home only, where the side menu opens from (the owner corrected "top right" to
  "top left" the same day). From any other screen, it was reached by going to Home first. Replaced on 2026-11-09
  (below): the menu is the bar's first button.
- **Scope:** phones and tablets only. A desktop (mouse) keeps its top bar as it is.

First shipped in v1.9.70-t6.

The owner, 2026-11-09: "I also want the hamburger button to move to the bottom bar. Place it on the far left. I've
tested with Mandarin and although 6 buttons wouldn't be the first choice, it does work." Shipped in v2.0.3-t8: §1
and §2 below are as changed by it.

## 1. The bar

The touch layout's row along the foot of the screen (`public/touchnav.js`, v1.9.14) holds, left to right:
**Menu · Home · Library · Artists · Shelf · Search**. Menu is its first button again (v2.0.3-t8), as it was before
v1.9.70-t6 and as Mandarin's bar has it (its item 296).

Every button takes an equal share of the row's width, with its icon centred in that share, so the icons are evenly
spaced across the screen. Should a button ever be absent, the rest share the row equally. Six buttons fit a phone
320px wide with each label whole and clear of its neighbours'.

| Button | Does | Lit (accent) |
|---|---|---|
| Menu | the side menu (§2) | never: it is not a screen |
| Home | Home, as before; a second tap scrolls Home to the top | on Home |
| Library | the Library wall, as before | on the Library wall |
| Artists | the Artists screen (§3); a second tap scrolls it to the top | on the Artists screen |
| Shelf | the Shelf page, as the side menu's Shelf does (`window.__openShelf`) | never: it is another page |
| Search | as before | while a field is open |

Each button but Menu first closes what covers the screen (an album's page), as before. Menu goes nowhere by
itself, so it closes nothing (§2).

## 2. The menu

The menu is the bar's first button, on the far left: the three lines over the word "Menu". It opens the same side
menu (`#menu-toggle`'s), from every screen the bar is on: Home, the Library, Artists, every other grid screen, an
album's page and Now playing's Queue tab. Home has no ☰ of its own any more, and its greeting is back at the left
edge.

The side menu opens over whatever is on screen, the bar included, and closing it leaves that screen as it was. Over
an album's page (or Now playing's Queue tab), an entry that goes to another screen first closes that page, as the
bar's other buttons do; otherwise the screen chosen would open underneath it, out of sight. Four entries close
nothing: Settings and Pitchfork, which open over the page and give it back when closed; "Rescan library", which goes
nowhere; and "Wall display", which is another page altogether and comes back to this one as it was left. An entry
added later closes the page unless it is added to those four.

"Leaves that screen as it was" has one exception, and it is the page's own rule rather than the menu's: a search
field that is open (Home's search, the Library's filter, "Search labels") closes on any tap outside it, and the tap
on Menu is one, as a click on the ☰ is on a desktop.

The entries were written when the menu was reached from Home alone, and two things follow from reaching it
everywhere:

- **"Labels" is a destination.** It is a switch in `app.js` (on the Labels list or a label's page it turns Labels
  off and draws random albums), and it left an artist's page or the "Not played" wall standing behind the list.
  Chosen from the bar's menu away from Home, the screen it was chosen from is left first, by the same way every
  full wall is entered (`RouenHost.enterFullWall`), so the entry always shows the Labels list and ‹ from it goes
  Home.
- **A second tap on Menu is not a choice.** The menu slides in over the bar, so an entry (or the dimmed page, which
  closes the menu) arrives where the Menu button was. For half a second after Menu is tapped, a tap in that same
  place is taken as the same tap again and does nothing. A tap anywhere else, a tap there later, and the
  keyboard's Enter are choices as ever.

Escape closes the top layer only: the side menu, Settings or Pitchfork if one is open over an album's page, and the
page itself on the next press. (Until v2.0.3-t8 the album's page heard every Escape, which could not matter while
nothing but the share card opened over it.)

The bar is not on Now playing's album tab (it has its own transport), so the menu is not reached from there.
Mandarin's bar stays on its Now playing; Rouen's does not, and that was not asked for.

A desktop (a mouse) has no bar and keeps the menu in its top bar.

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
