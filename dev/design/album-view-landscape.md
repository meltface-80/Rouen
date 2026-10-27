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
3. **Now playing,** which opens the same album view: the same three columns.
4. **The artist's biography** in the middle column: Roon's own when native mode is on, else the Wikipedia article
   reached through the artist's MusicBrainz identity (the album credits' identities, `dev/design/album-credits.md`),
   never a search by name. Nothing when neither has one. (The album view had an artist biography until it was
   removed: a Wikipedia search by name found the wrong article for less famous names, `public/app.js`.)
5. **The Shelf:** a Shelf album opens the same view as the Library's, and the case's flip, growing into the view,
   stays.
6. Unchanged: a phone, any portrait screen, the tablet's bar along the foot, the desktop's buttons.

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
| The cover, square, the column's width | **About this album**: the review, whole (not clamped), whose words and the link to read on, as now | **Tracks**: every track, a set's discs under their headings, choosing tracks as now (a hold, a tap, Ctrl/⌘ and Shift) |
| The title, the artist, the date · label | **About the artist**: their picture (the credits' kept picture), the biography (§2.4), its source and link | |
| Play now, Shuffle, Queue, the heart, ⋯ | | |
| Credits (eight, More for the rest) | | |
| More by this artist, Appears on (three or six, More) | | |
| Similar artists, Similar albums (three or six, More) | | |

"Three or six": a row of three tiles where the column holds three, two rows (six) where the screen is tall enough to
keep the rest of the column in view; More shows the rest, as it does now. A section with nothing to show is not drawn;
a middle column with neither a review nor a biography gives its room to the other two.

The close (×) and Share keep their corners; the previous/next album arrows stay on the cover's edges.

## 5. Now playing

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

## 7. Built in this order

Each its own branch from `dev`, sanctioned from renders of the real page at 1920×1080, 1440×900, 1366×1024 and
1180×820 before it ships:

1. The three columns in the remote's album view, and the move of the album view out of `app.js`, `style.css` and
   `index.html` that makes them possible.
2. Now playing in three columns (§5).
3. The artist's biography (§2.4): Roon's through native mode (`Library::GetPerformer`, read by the reads probe of
   v1.9.70-t3, §16.4 of `native-remote.md`), else Wikipedia through MusicBrainz.
4. The Shelf opens the shared view (§6).
5. The fixed mini transport (§8), once its screenshot has come.

## 8. The fixed mini transport (waiting on the owner)

On tablets and phones, upright and on their side, a fixed mini transport like Mandarin's, the album view above it.
Built once the owner's screenshot of Mandarin's has come (§2, open).
