# The album view — design

Read before working on what a tap on the case in front does, the album view it unfolds into, the tracks chosen on
it, the back of a case, or the Order tab's catalogue order.

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

## 2. The owner's decisions

1. **The three looks stay** — Covers, Spines, the Carousel — and no fourth: the horizontal spines of the extension
   are not wanted (a Stack look was built and shown on 2026-10-27, and withdrawn on this answer).
2. **A tap on the case in front turns it over, and the turn opens the album** in a full-screen album view, animated:
   the case flips, and the view grows out of it.
3. **The view is Rouen's own**: the remote's album screen (`public/index.html` `#album-modal`, `style.css` `.modal`),
   not the extension's — the cover, the title, the artist, the facts, the tracks.
4. **Choosing tracks stays as it was** (v1.9.4, v1.9.66): a hold chooses, a tap adds, Ctrl/⌘- and Shift-click; the
   chosen tracks' buttons in the bar.
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

**The back of the case** keeps the album's name, its facts and its barcode — what the carousel's far side shows,
and what the turn shows for a moment. Its track list, and the booklet of v1.9.4 that a long list unfolded into,
are superseded by the view: every track is in one list, which scrolls. The "as big as the back holds it" measuring
of v1.9.10 goes with the list it measured.

**The Order tab** gains **By catalogue №** (`shelf-pick.js`): every album with a number, in the numbers' natural
order across labels ("HDB 008" before "WARP 61" before "WARP 123"), then by title; albums with no number last, by
artist. No tabs on the spines in this order — a number says nothing about where a run begins. A chip as the other
orders are.

**Not duplicated**: the view carries no Play now or Queue of its own; the bar beneath has them for the album in
front, which the opened album always is, and the chosen tracks' buttons beside them.

**What does not change**: the three looks and their motion, the lane, the queue, the bar; the help dialog's lines
on the case and the tracks updated.

## 4. Open questions

None. The catalogue order is this design's addition beyond the owner's answers, shown in the renders for sanction
with the rest.
