# The album view on landscape screens: three columns

Read before working on the album view, Now playing, or the Shelf's album view on a desktop, a TV or a tablet held on
its side.

## 1. The request (the owner, 2026-10-27)

> Desktops/TV - large landscape viewing. Most things like album views are more set for portrait screens. Go through
> all screens and list those that don't view well on landscape screens.

> Need to make the album view page view better on landscape screens. Both shelf albums and library albums should be
> using the same album view screen which is the main library view screens. [With photos of a TV and an iPad:]
> Totally different and neither fits the screen well.

> Ideally an album view screen on tablets and desktop/TV should all be seen on the screen. So that's album cover,
> track list unless super long and then that part is scrollable, album review, credits, albums by same artist (show 3
> or 6 with a more button), similar artists (show 3 or 6 with a more button).

> Phone screens, portrait screens do not touch. Just landscape desktop/TV and tablets for album view screens. Library
> and Shelf albums to use the same album view screen. Tablets bottom bar remains, desktop button layout remains.
> Tablet screens, phone screen, portrait and landscape are to have a fixed minitransport bar like the 5th screenshot
> which is from Mandarin. The album view screens for tablets in landscape view are to show above this and where ever
> possible be all seen in that area above the mini transport bar and the top of the screen. Album views screens on
> the home screen, remote, library sections are to be the same for landscape screens except phones.

Then, with a screenshot of a three-pane music app (an artist's photo and biography, the album's cover and review, the
play queue):

> I'm thinking for album view screens they show similar to this. Three sections. Tracks on the right. Album and artist
> review in the middle. Album art in the left with the credits, albums by same artist, artists and albums similar.

## 2. The owner's decisions

Asked, 2026-10-27:

1. **Where:** desktop/TV and tablet landscape screens only. Not a phone on its side. Portrait screens stay as they
   are for now.
2. **The album's title, artist, date and its Play / Shuffle / heart buttons:** in the left column, under the art.
3. **Now playing,** which opens the same album view: the same three columns. *Withdrawn by the owner, 2026-10-28,
   after it was built (v1.9.70-t11, never merged): "Do not implement a 3 column now playing screen. Keep it as it
   is." Now playing stays as it is on every screen (§5).*
4. **The artist's biography** in the middle column: Roon's own when native mode is on, else the Wikipedia article
   reached through the artist's MusicBrainz identity (the album credits' identities, `dev/design/album-credits.md`),
   never a search by name. Nothing when neither has one. (The album view had an artist biography until it was
   removed: a Wikipedia search by name found the wrong article for less famous names, `public/app.js`.)
5. **The Shelf:** a Shelf album opens the same view as the Library's, and the case's flip, growing into the view,
   stays.
6. Unchanged: a phone, any portrait screen, the tablet's bar along the foot, the desktop's buttons.
7. **A desktop and a TV, from the first build on the owner's TV** (2026-10-28): "shrink the middle column and space
   the other two better … show the credits in rows, 2 rows of 4 max with a more button", so the other albums and the
   similar artists and albums show better too. **A tablet keeps the column widths as they are** ("Tablet, keep column
   widths as they are"). Built in v1.9.70-t12 (§4.2).

Open:

- **The mini transport on tablets and phones**, fixed, "like the 5th screenshot, from Mandarin": the screenshot did
  not arrive. Asked again; nothing in §8 is built before it comes.

## 3. Which screens

The three columns are drawn where the screen is wider than tall, at least 1000px wide and at least 600px tall:
`(orientation: landscape) and (min-width: 1000px) and (min-height: 600px)`. That takes in an iPad on its side
(1024×768, 1180×820, 1366×1024), every desktop window that size or larger, and a TV (1920×1080); it leaves out a phone
on its side (844×390, 932×430: under 600px tall) and every portrait screen, which keep the album view as it is. A
desktop window made smaller than that gets the album view as it is today.

## 4. The layout

The view is the whole screen, not a card over the page: from the top of the screen down to the mini transport (and,
on a tablet, the bar along the foot under it), the same on every screen of §3. Nothing scrolls the page: each column
scrolls on its own when what it holds is taller than the screen, so the cover and the buttons stay in view while a
long track list or a long review scrolls.

| Left (about 26%: 280–420px) | Middle (the rest) | Right (about 34%: 340–560px) |
|---|---|---|
| The cover, square, the column's width | **About this album**: the review, whole (not clamped), whose words and the link to read on, as now | **Tracks**: every track, a set's discs under their headings, choosing tracks as now (a hold, a tap, Ctrl/⌘ and Shift), each with its length at its right (v1.9.70-t14, from the server through native mode: `native-remote.md` §16.6) |
| The title, the artist, the date · label | **About the artist**: their picture (the credits' kept picture), the biography (§2.4), its source and link | |
| Play now, Shuffle, Queue, the heart, ⋯ | | |
| Credits (eight, More for the rest) | | |
| More by this artist, Appears on (three or six, More) | | |
| Similar artists, Similar albums (three or six, More) | | |

"Three or six": three tiles, More for the rest, as the album view has them (v1.9.70-t10: the left column holds a row
of three at every width of §3). A section with nothing to show is not drawn; a middle column with neither a review
nor a biography stays, empty (§4.1).

The close (×) and Share keep their corners; the previous/next album arrows stay on the cover's edges.

### 4.2 A desktop and a TV (v1.9.70-t12, §2.7)

On anything but a touch screen — `not all and (hover: none) and (pointer: coarse)`, nested in §3's rule: a desktop,
a TV with a mouse, and a TV's own browser driven by its remote (which says no pointer, or a coarse one that hovers) —
over §4.1. A tablet (a coarse pointer that doesn't hover) keeps all of §4.1.

- The left column `clamp(340px, 30vw, 580px)`, the tracks' `clamp(400px, 34vw, 660px)`, the middle the rest
  (left, middle, tracks): at 1920 wide 576, 531 and 653; at 1440 432, 380 and 490.
- The cover is a square no taller than 36% of the screen (`36cqh`, `36vh` where cqh is unknown), at the column's left
  edge: as wide as the column it was 576px on a TV and put the credits under the fold. So at 1920×1080 the cover, the
  title, the buttons and all eight credits are on screen, none under the mini player.
- The credits a grid of four across, a picture (64px) over each name and its parts, eight before More — the eight
  `album-credits.js` already shows before More, now two rows.
- **Open, asked of the owner:** the credits in rows of four on a tablet too (its left column is 280px: four tiles of
  about 63px)? The owner limited only the tablet's column widths. Until answered a tablet keeps them a row each, as
  before.
- The other albums and the similar artists and albums keep their three across, now larger.

## 5. Now playing

**Stays as it is** (the owner, 2026-10-28; §2.3). What follows was the plan, kept for the record: built in
v1.9.70-t11 and taken out of it before it merged.

The same three columns (§2.3). Left: the cover, then what Now playing shows under it now (the track, the artist, the
album, the seek bar, the transport, the device and the volume). Middle: about the album and about the artist, as in
§4. Right: the queue, as in the owner's example, in place of the album's tracks (the Now playing / Queue tabs go: both
are on screen at once). The size button (shrink to a card) stays on a desktop.

## 6. One album view

Every album opened on a screen of §3 opens this view: from Home, the Library, the remote, Search, an artist's page,
the Artists screen, Now playing, and the Shelf. The Shelf is a page of its own (`public/shelf.html`), so the view's
markup, code and styles leave `index.html`, `app.js` and `style.css` for modules both pages load (`public/album-view.js`
with its CSS), which is also the move out of those three files the length rules ask of any change to them
(`dev/quality.md`). On the Shelf the case's flip grows into it (§2.5). On a phone or a portrait screen the Shelf keeps
its own view for now (§2.6).

### 4.1 As built (v1.9.70-t10)

- `public/album-view.css`, under the rule of §3, over `style.css`'s two columns. The body is a grid of three
  columns: the left `clamp(280px, 24vw, 420px)`, the right `clamp(340px, 32vw, 560px)`, the middle the rest. The info
  column, its tab pane and the side column are laid out through (`display: contents`), so the cover, the title, the
  artist and date, the buttons, the credits, More by, Appears on, Similar artists and Similar albums are the left
  column's rows one to nine; the review and the tracks span every row, held at the top (`position: sticky`), as tall as
  the screen above the mini player and, on a tablet, the bar (`--album-foot`), less a 16px gap, each scrolling on its
  own. The body scrolls the left column.
- The columns start 72px down, under the × and Share (the × sat on the cover's corner otherwise, as it once did on
  the card: v1.8.75). The cover is as tall as its column is wide, said outright (a box that clips has no automatic
  minimum height in a grid).
- An album with no review keeps its middle column, empty. The review comes after the view opens, so a layout that gave
  its room away until then jumped on every album, and a review that is only a link held a whole column (the review of
  v1.9.70-t10). The artist's biography (§7.3) will fill it for most albums.
- The held columns' height is the panel's (`cqh`; the panel a size container), not the screen's: an iOS home-screen
  app's `dvh` leaves out the safe-area insets the panel covers, and they would be taken off twice.
- Show more is checked again when the screen crosses into or out of the three columns (a tablet turned round), and
  every scroller of the view, the tracks' and the review's too, starts at the top when an album opens; Back from Now
  playing puts the tracks back where they were (`album-view.js`).
- The album view's markup (with Now playing's, which shares it) left `index.html` for `public/album-view.js`, which
  inserts it where its tag stands, before `app.js` runs, as `random-pick-sheet.js` does (§6).

## 7. Built in this order

Each its own branch from `dev`, sanctioned from renders of the real page at 1920×1080, 1440×900, 1366×1024 and
1180×820 before it ships:

1. The three columns in the remote's album view, and the move of the album view out of `app.js`, `style.css` and
   `index.html` that makes them possible. Built in v1.9.70-t10 (§4.1): the markup moved; the code and styles move as
   the steps after it touch them.
2. ~~Now playing in three columns (§5).~~ Withdrawn by the owner (§2.3).
3. The artist's biography (§2.4): Roon's through native mode (`Library::GetPerformer`, read by the reads probe of
   v1.9.70-t3, §16.4 of `native-remote.md`), else Wikipedia through MusicBrainz.
4. The Shelf opens the shared view (§6).
5. The fixed mini transport (§8), once its screenshot has come.

## 8. The fixed mini transport (waiting on the owner)

On tablets and phones, upright and on their side, a fixed mini transport like Mandarin's, the album view above it.
Built once the owner's screenshot of Mandarin's has come (§2, open).

## 9. What views badly on a landscape screen (the survey, 2026-10-27)

Every screen rendered from the real pages at 1920×1080, 1440×900, 1366×1024 and 1180×820, with a mouse and, at the
two iPad sizes, as a touch screen (the fakes' data: one album's tracks and review stand in for every album's). Worst
first:

1. **The album view** (from Home, the Library, Search, an artist's page): with a mouse, a card about 960px wide at
   every size, half of a TV's width left to the blurred wall; inside it, the review comes only after the credits,
   under the cover, below the fold. On a tablet the two columns fill the screen, and the mini transport and the bar
   cover the last tracks and the start of the review. §4 and §7.1 answer it.
2. **The Shelf's album view**: another layout from the Library's (no credits, no similar artists), the track list
   stretched across the whole width with its right third empty on a TV. §6 and §7.4 answer it.
3. **Now playing**: the cover and a small column of controls in the middle of the screen, wide empty margins either
   side on a TV, and nothing about the album or the queue beside them. §5 and §7.2 answer it.
4. **The queue**: rows the full width of the screen, the title at the left and its length at the far right, 1,600px
   apart on a TV; the mini transport covers the last rows.
5. **The Artists screen**: each letter's artists on rows of their own, at most five a row before the next letter, so
   on a TV about two thirds of the screen is empty; the letter strip sits against the scrollbar.
6. **An artist's page**: the biography a narrow paragraph in the middle; the members a list the screen's width; the
   albums six to a row with a third of the width empty; on a tablet the albums start under the mini transport.
7. **The mini transport with a mouse**: a card at the bottom right, over whatever is under it on every screen (the
   last tracks, tiles, rows). §8 is for tablets and phones; the desktop's is the owner's to say.
8. **Home on a TV**: its rows end about a third short of the right edge.
9. **The Shelf's choices open on a TV**: the front case's caption under the cover (the artist and the title) is
   overlapped by its format, year and catalogue number lines.
10. **Small ones**: Search keeps Home's date and greeting above its results; the mini transport stays bright over
    Settings while the rest of the page is dimmed.

Fine as they are: the Library's wall (seven to nine columns, the width filled), the Shelf's spines, the zone sheet,
Settings' list.
