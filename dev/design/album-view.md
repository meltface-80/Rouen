# The album view — design

Read before working on what a tap on the case in front does, the album view it unfolds into, the tracks chosen on
it, the back of a case, the Order tab's catalogue order, or (since v1.9.68) the Shelf's one look, its spines and
its bar.

## 1. The request (the owner, 2026-10-26 and 27)

> I want this type of alternative view added to Shelf — Stacks: virtual crate digging for Roon
> (community.roonlabs.com/t/stacks-virtual-crate-digging-for-roon/326578). The spine has more room for full album
> details inc catalogue numbers etc.

> Use the opened view style I uploaded for all variants of the shelf. So tapping to show the reverse animates the
> flip and expands to that full view, retaining individual track selection like my current version.

> Do not implement the horizontal stack layout on the shelf, but do adopt a similar style but in MusicD Rouen style
> the expanded rear cover as I requested. I don't want the horizontal albums like the one I shared. Retain the three
> existing shelf views. But when the album is tapped I want it to flip around and have animation to open to a full
> screen album view similar to the Rouen remote screen.

Then, on 2026-10-27, with a screenshot of the Shelf on an iPad:

> I want the shelf type selector and the spin button and the album count indicator to be moved from the top of the
> screen into the bottom bar. I want the bottom bar to be reworked so it is slimmer. I want the albums in the book
> screen to be the default only type of shelf view, which means removing the other two completely; having the screen
> almost fully available allows the spines to be almost full height of the screen, to maximize space for album
> year, album format, the catalog number and obviously the artist and album name. I think we need to make them
> slightly thinner as well as taller, which will also allow the writing to be reduced in size without being too
> small to read, allowing for maximum length of album names and band names.

> When the album cover is tapped and it opens up the album view screen, I think it would be best to put the play
> controls on that album page underneath the album art; also list under those buttons the album review and other
> albums by the same artist — only that for now.

> [On a phone held upright, where the spines could not be tall:] Do what best suits a smartphone screen size.

## 2. The owner's decisions

1. **One look, the spines** (v1.9.68; until then the three looks — Covers, Spines, the Carousel — stayed, and no
   fourth: the horizontal spines of the extension are not wanted, a Stack look built and shown on 2026-10-27 was
   withdrawn on that answer).
2. **A tap on the case in front turns it over, and the turn opens the album** in a full-screen album view, animated:
   the case flips, and the view grows out of it.
3. **The view is Rouen's own**: the remote's album screen (`public/index.html` `#album-modal`, `style.css` `.modal`),
   not the extension's — the cover, the title, the artist, the facts, the tracks.
4. **Choosing tracks stays as it was** (v1.9.4, v1.9.66): a hold chooses, a tap adds, Ctrl/⌘- and Shift-click; the
   chosen tracks' buttons in the bar until v1.9.68, then under the cover with the album's Play now and Queue.
6. **The play controls under the cover, then the album's review and the artist's other albums, "only that for now"**
   (v1.9.68).
7. **The count, the order and Spin in the bar, which is slimmer** (v1.9.68); the head row they stood in goes.
8. **The spines as tall as the screen allows, thinner, the writing smaller but read**: the artist, the title, the
   year, the format and the catalogue number (v1.9.68).
5. **The right side of a spine** (2026-10-26, for the Stack): the catalogue number and the year. Kept where the Shelf
   shows facts: the catalogue number at the foot of the standing spine (v1.9.67-t1), the year in the view's line.

The layout is sanctioned from renders of the real page before it ships, as every new piece of the Shelf's UI.

## 3. As built (v1.9.67-t5)

**The turn and the view** (`public/shelf.js` turnOver and render; `public/shelf-back.js` setOpen;
`public/shelf-open.css`). A tap on the case in front turns it over, as always (the box's half-second turn). The
album view is open exactly while a case is turned over at the front — render says which, every frame — and is a
layer over the whole screen above the bar (`#open`: the lane, the shelf and its head, the queue, the corner pills
all beneath it; the bar beneath the view, as it is beneath the shelf). It grows out of the case: scaled up from
where the case stands, a moment into the turn, and shrinks back into it as the case turns back. The arrow keys with
the view open move to the next album and the view changes album without closing (the case in front is always the
one shown). Reduced motion: no transition.

**The view itself**, the remote's album screen in the Shelf's own type and tokens. On a phone (narrower than
720px): the cover edge to edge at the top, fading into the ground; under it, centred, the title in the display
face, the artist, one line of facts — label · catalogue № · kinds · year, the back of the case's line (v1.9.67)
with the year added — then "Tracks" over a hairline and the rows. From 720px up: the cover a column at the left
(32% of the width, 200–360px, square and flat, no fade, staying in view as the tracks scroll), the title, the
artist, the facts and the tracks at the right. The rows are the remote's: a hairline between each, the number in
even figures at the left, the title wrapping rather than cut; a set lists each disc under its own heading, numbered
from 1 (v1.9.4). "Reading the track list…" until the Core answers; the view's own words when Roon is away. An album
with no cover shows its name on a plain sleeve, as the shelf does. Back is a chevron on a dark scrim at the top left
on a phone (the view is a screen you came to), × from 720px up (a card over the page), as the remote's album screen
has it.

**Closing**: Back; a tap on the view away from the tracks (as a tap on the back of the case turned it over again);
Escape; moving the shelf (a swipe, the Spin, the choices changing, the playing record brought to the front).

**Choosing tracks** (unchanged): a long press on a track chooses it (500 ms, as the remote's; a tick for its
number, its buttons up in the bar), a tap adds or takes away, Ctrl/⌘-click chooses at once, Shift-click a run; the
last one taken away ends it, and so do Escape, the bar's ×, closing the view and moving the shelf off the album —
what is chosen is always the album at the front. A plain tap on a track while nothing is chosen does nothing (it
turned the case back when the tracks were on the back; on a full screen it would be a surprise). A finger that
slides scrolls the list (the browser's own scroll: the view is not the stage) and is no tap. The presses are the
view's own (`shelf-back.js`); the stage's pointer is the shelf's alone now.

**The back of the case** keeps the album's name, its facts and its barcode — what the carousel's far side showed,
and what the turn shows for a moment. Its track list, and the booklet of v1.9.4 that a long list unfolded into,
are superseded by the view: every track is in one list, which scrolls. The "as big as the back holds it" measuring
of v1.9.10 goes with the list it measured.

**The Order tab** gains **By catalogue №** (`shelf-pick.js`): every album with a number, in the numbers' natural
order across labels ("HDB 008" before "WARP 61" before "WARP 123"), then by title; albums with no number last, by
artist. No tabs on the spines in this order — a number says nothing about where a run begins. A chip as the other
orders are.

**Not duplicated** (t5; changed in v1.9.68, §4): the view carried no Play now or Queue of its own; the bar beneath
had them for the album in front, which the opened album always is, and the chosen tracks' buttons beside them.

**What does not change** (t5): the three looks and their motion, the lane, the queue, the bar; the help dialog's
lines on the case and the tracks updated.

## 4. As changed (v1.9.68)

Sanctioned from renders of the real page (iPad on its side with the choices folded and open, the album view, a
phone), sent to the owner on 2026-10-27.

**One look.** The covers and the carousel are removed, with their selector (`#looks`), their CSS and their storage:
a device that kept another look (`rra-shelf-look`) opens on the spines; the key is no longer read. The head row
over the shelf (the count, the order, the looks, Spin) goes; the corner pills (Remote, Wall Display) stay where they
were, and the shelf stands under them (`shelf-ways.js` cornersBelow: no case or divider card reaches up beside a
pill shown over the stage).

**The spines** (`public/shelf.js` layout, `public/shelf-faces.js`). The case is as tall as the stage less the
pills' strip, a divider card, the ledge and the 3% the front case gains drawn forward. The cover up to 55% of the
width (52% on a stage taller than wide). A spine is 7.2% of the case's height, at most 11% of the width — thinner
than before against a taller case, the writing (27% of the spine's width) smaller but read. Two lines along it:
the artist in capitals and the title; then the year and the format, with the catalogue number at the foot (t6),
not shown narrower than a tablet (t6). The disc that marked the foot of a spine goes, its room given to the names.
A divider card stands up to 1.5 spine widths over its spine in perspective, and the case is placed so it stays on
the stage.

**The format** (`lib/album-quality.js` albumFormatLabel; the `fm` of each album in `/api/shelf/albums`): the files'
container and numbers ("FLAC 24/96", "FLAC 16/44.1"), a lossy file's container alone ("MP3"); for an album whose
facts a service gave, the service and what it states ("Qobuz 24/96", "TIDAL Hi-Res", "TIDAL AAC" — a tier is the
service's word, never taken for a file type); the service's name alone when it stated nothing ("Qobuz"); and
nothing when nothing is known. A local album whose only facts are a service's says nothing: they describe the
service's copy, not the files that play. The shelf's kept answer is made again when its albums' formats, read
afresh on each ask, no longer match it (`lib/shelf-routes.js`): they move with every file walk, service harvest and
source change, which index.js keeps no stamp of, and its library revision moves for far more than the shelf shows.

**A phone held upright** (the owner: "what best suits a smartphone"). Where the stage is taller than the cover is
wide (by more than 18% of the cover), the case is a tall card: the cover square at its top, and under it the
album's names on the cover's colour, darkened — the title in the display face, the artist in capitals, year ·
format, then label · catalogue № · kinds (the album view's line). The spines stand the card's full height and are
as wide as a spine that tall needs to be read. A stage about as wide as tall (an iPad on its side, the choices
folded) keeps the square case and no card. The card carries the catalogue number on a phone, where the spines do
not: it is the album in front, read whole, as the album view is.

**The bar** (`public/shelf-bar.css`). One row: previous, play/pause and next; what is playing; the count ("11 of
34") over the order's name, and Spin; the zone and the volume. About half of Mandarin v0.8.28's sizes (2.9rem
buttons, a 3.3rem play/pause), under 5rem tall. Under 44rem of column the order's name and Spin's word give way;
under 36rem (a phone) the count, the order and Spin take a slim row of their own above the rest, so what is playing
keeps its room; under 22rem what is playing shows its cover alone.

**The album view** (`public/shelf-back.js`, `public/shelf-about.js`, `public/shelf-open.css`). Under the cover,
in this order: the album's Play now and Queue — or, while tracks are chosen, theirs in the same place — then
**About this album**, the review as the remote's album page has it (`/api/album/extras`: the description, whose
words they are when another source's, and the link to read on; Pitchfork's words never leave the server, only its
link; "From Wikipedia" links to the article, as the remote's does), then **More by** the album's artist
(`/api/album/more`), each album a cover and its title. A tap on one turns the shelf to it — found by its offset, as a
reissue shares its title and artist with the album open — and opens it; one the shelf does not hold (the choices
narrow it) says so in a toast and nothing moves. Both are read once per album, when its view first opens, each on
its own: one that fails leaves the other standing, and is asked again when the album is next opened after a few
seconds (as the track list is); a section with nothing to show is not drawn. "Reading about this album…" until
they come.

**Closing** changes with what the view holds: the column under the cover is now full of things to tap (the buttons,
the review's link, the other albums), so a tap away from the tracks no longer closes it — a tap on the cover or on
the title and its facts does, with Back, Escape and moving the shelf as before. From 720px the cover's column carries them, the title, the facts and the tracks beside
it, × at the top right (the cover holds the top left); on a phone, one column: the cover, the title and the facts,
the buttons, the tracks, then the review and the other albums.

## 5. As changed (v1.9.68-t2)

The owner, 2026-10-27, with screenshots of a phone (sanctioned from renders: an iPad on its side, a phone, each with
the volume sheet open):

> Change the volume bar on the shelf to match the remote style and centre it. As the spines are taller put the album
> details in a single line of text. Top to bottom: artist name, album name, album version (deluxe, limited edition
> etc). Bottom to top: catalogue number, release year, format. Apply this to all screen types appropriately.

**One line along the spine** (`public/shelf-faces.js`, `shelf.css`). Reading down from the top: the artist (bold
capitals), the album, its version (italic, fainter). At the foot, read up from it: the catalogue number lowest (bold),
the year above it, the format above that — so, reading down, the format, the year, the number. The writing is a third
of the spine's width (it was 27% on two lines). A long name gives way with an ellipsis, the version first, then the
album, then the artist; the foot never. The catalogue number stays off the spines narrower than 720px (t6, the
owner); there the card and the album view carry it.

**The version** (`lib/album-version.js` splitVersion; `v: [title, version]` in `/api/shelf/albums`): taken off the
end of the title, part by part, while each part names an edition — a trailing (…), […] or " - …" with a word such as
Deluxe, Edition, Remaster(ed), Expanded, Anniversary, Limited, Special, Collector's, Bonus, Reissue, Version, Mono,
Stereo, Legacy, Definitive, Super, Box Set, Hi-Res. Anything else in brackets is the record's own and stays in the
title ("Music for the Masses (Instrumental)", "(What's the Story) Morning Glory?"); "Live" is a kind, not a version.
The album view keeps the whole title.

**The phone's card** in the same order: the artist, the album and its version under the cover; at the card's foot
the format, the year and the catalogue number, the number lowest. Its label and kinds line goes (the album view has
them).

**The volume sheet** (`shelf.html`, `shelf-bar.css`, `shelf-volume.js`): the remote's (`style.css` .vol-sheet) in
the brass — the speaker and the level, the slider with its two ends under it (0 and 100, or −80 and 0 for a dB
volume), a round − and + — centred over the shelf's column, just above the bar, up to 30rem wide.

## 6. Open questions

None. The catalogue order (t5) and the phone's card (v1.9.68, on "what best suits") are this design's additions
beyond the owner's words, shown in renders with the rest.
