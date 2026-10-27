# The Stack and the opened view — design

Read before working on the Shelf's looks, its Stack rows, the opened album (a case turned over, a row opened), the
tracks chosen on it, or the Order tab's catalogue order.

## 1. The request (the owner, 2026-10-26)

> I want this type of alternative view added to Shelf — Stacks: virtual crate digging for Roon
> (community.roonlabs.com/t/stacks-virtual-crate-digging-for-roon/326578). The spine has more room for full album
> details inc catalogue numbers etc.

The extension's screenshots: every album a full-width horizontal spine coloured from its cover, artist and title at
the left, duration and catalogue number at the right in a monospaced face, a sort bar above; a tap opens the album
in a full view — its cover, its tracks, its credits. The point, for the owner: a spine lying flat has room a standing
spine has not.

And on 2026-10-27:

> Use the opened view style I uploaded for all variants of the shelf. So tapping to show the reverse animates the
> flip and expands to that full view, retaining individual track selection like my current version.

## 2. The owner's decisions

1. **Where it lives** (2026-10-26): a fourth look on the Shelf page, beside Covers, Spines and Carousel — not a page
   of its own. It shares the lane's narrowing and order: the same list, the same chips, Reset and Undo.
2. **The right side of a spine**: the catalogue number and the year.
3. **A tap**: expands the album in place, as the extension does — rather than opening the album page.
4. **The opened view is every look's** (2026-10-27): in Covers, Spines and the Carousel a tap on the case in front
   still turns it over, and the turn unfolds it into the same full view; the tracks are chosen on it exactly as they
   were on the back of the case (v1.9.4). That supersedes the booklet of v1.9.4: the opened view holds every track.

As every new piece of the Shelf's UI, the layout is sanctioned from renders of the real page before it ships
(catalogue.md §2.3 did the same).

## 3. As built (v1.9.67-t5)

**The opened view** (`public/shelf-back.js`, `shelf.css` `.bk`; the markup one function, `backHTML`, whichever look
draws it). The cover at the left, as tall as the view allows (42% of its width at most); at the right the artist in
brass capitals, the title in the display face, one line of facts — label · catalogue № · kinds · year, the back of
the case's line with the year added — and the track list, numbered, each disc of a set under its own heading, in
two columns where there is room, as big as the room lets it be (`fitTracks`, v1.9.10's measuring: one column or
two, grown until a title would be cut), and in one column, scrolling inside the view, when a box set needs more
than it holds (two columns would spill sideways). "Reading
the track list…" meanwhile; the view's own words when Roon is away. The foot keeps the barcode and "Tap to turn
back". The cover is drawn only once the album has been opened: the carousel's far side shows the name alone and
fetches nothing, as before.

**In Covers, Spines and the Carousel** (`shelf.js` render, `shelf.css` `.it.flipped`): a tap on the case in front
turns it over (the box's half-second turn, as always) and, a moment into the turn, the case grows to the stage less
a margin (up to 1280px wide), stood square in front of the shelf rather than where the look places it; its spines
are not drawn meanwhile. The carousel lies flat while a case is open, so the view is not tilted with the ring, and
tilts back after. Turned back (a tap on the view away from the tracks, a swipe, the arrow keys, Enter), it folds
down to a case over the turn. Reduced motion: no transitions, as the shelf's rule is.

**Choosing tracks** (unchanged from v1.9.4/v1.9.66): a long press on a track chooses it, a tap adds or takes away,
Ctrl/⌘-click chooses at once, Shift-click a run; the chosen tracks' Play now, Play next and Queue are the bar's.
Turning the case back, moving the shelf, Escape or the bar's × end it. New: a finger sliding up or down the list
scrolls it (the stage takes every touch for the shelf, so the browser never does) — a slide more up or down than
along is the list's, not the shelf's — a press that slid is not a tap, the faded cases beside the view are not
there to be tapped, and the wheel over the list is the list's, not the shelf's. The live-library refresh waits
while an album is open, in any look.

**The Stack** (`public/shelf-stack.js`, `shelf-stack.css`; `shelf.js` makes it with the hub and hands over to it).
The fourth button in the looks group ("Stack"), kept per device as the others (`rra-shelf-look` "stack"). The
stage is a list that scrolls as a page does — the finger, the wheel, a trackpad: the browser scrolls it (`touch-action:
pan-y`, no pointer capture), and the shelf's own motion is off: the spring, the spin, the held swipe, the drag.
**A row** is one album, as wide as the stage, two lines of text tall (2.75rem), coloured from its cover as the
standing spines are (`spineColour`; a stand-in colour from the title until the cover has been seen — the same
500px cover the Covers look fetches, read for its colour only, one per row in view, cached by the browser). Left
to right: the brass tab where a run begins in the order chosen (a letter by artist, the label's name by label, the
decade by year — the standing spines' divider cards, lying down), the artist in bold capitals, the title; at the
right, in even figures, the label (not on a stage narrower than 900px), the year, and the catalogue number in a
monospaced face. A phone held upright (560px and narrower) stacks the artist over the title and drops the year.
Only the rows in view and a margin are in the document (a library of thirteen thousand albums is thirteen
thousand rows); the list's height is the whole stack's, so the scrollbar is true. **The row in front** is the
shelf's `p`: a brass edge. It is what the bar's Play now and Queue act on and what "n of N" counts. The arrow keys
move it (Shift: ten; Home, End), Enter opens and closes it, S and the Spin button pick a row at random, scroll to
it and say so ("Landed on …"). **Open** (one at a time): a tap on a row brings it to the front and unfolds the
opened view beneath it — half the stage's height, 11rem to 22rem — pushing the rows below down, never over them.
A tap on the open row, or on the view away from its tracks, folds it away; a tap on another row opens that one
instead; the choices changing (a chip, Reset, an order) folds it away and keeps the row in front where the shelf
keeps it. The tracks are chosen on it exactly as above (the stage's gesture handling is shared: `shelf-back.js`
`backOf()` answers the Stack's open row while the look is the Stack).

**The Order tab** gains **By catalogue №** (`shelf-pick.js`): every album with a number, in the numbers' natural
order across labels ("HDB 008" before "WARP 61" before "WARP 123"), then by title; albums with no number last, by
artist. No tabs on the spines in this order — a number says nothing about where a run begins. A chip as the other
orders are; it shows in every look.

**Not the bar's business, and not duplicated**: the opened view carries no Play now or Queue of its own; the bar
beneath the shelf has them for the album in front, which the opened album always is.

**What does not change**: the three looks' motion, the lane, the queue, the bar, the help dialog (its lines on the
back of the case and the Stack updated).

## 4. Open questions

None. The catalogue order and the label at the right of a row are this design's additions beyond the owner's
answers, shown in the renders for sanction with the rest.
