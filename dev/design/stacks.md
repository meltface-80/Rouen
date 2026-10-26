# The Stack — a fourth look for the Shelf — design

Read before working on the Shelf's looks, its Stack rows or their expanded panel, or the Order tab's catalogue order.

## 1. The request (the owner, 2026-10-26)

> I want this type of alternative view added to Shelf — Stacks: virtual crate digging for Roon
> (community.roonlabs.com/t/stacks-virtual-crate-digging-for-roon/326578). The spine has more room for full album
> details inc catalogue numbers etc.

The extension's screenshots: every album a full-width horizontal spine coloured from its cover, artist and title at
the left, duration and catalogue number at the right in a monospaced face, a sort bar above; a tap opens the album
with its cover, tracks and credits. The point, for the owner: a spine lying flat has room a standing spine has not.

## 2. The owner's decisions (2026-10-26)

1. **Where it lives**: a fourth look on the Shelf page, beside Covers, Spines and Carousel — not a page of its own.
   It shares the lane's narrowing and order: the same list, the same chips, Reset and Undo.
2. **The right side of a spine**: the catalogue number and the year.
3. **A tap**: expands the album in place, as the extension does — the cover, the tracks, label · catalogue № · kinds
   · year, Play now and Queue — rather than opening the album page or turning a case over.

As every new piece of the Shelf's UI, the layout is sanctioned from renders of the real page before it ships
(catalogue.md §2.3 did the same).

## 3. The look as built (v1.9.67-t5)

**The look** (`public/shelf-stack.js`, `shelf-stack.css`; `shelf.js` makes it with the hub and steps aside). Chosen
from the fourth button in the looks group (title "Stack"), kept per device as the others are (`rra-shelf-look`
"stack"). In this look the stage is a list that scrolls as a page does — the finger, the wheel, a trackpad — and the
shelf's own motion (the spring, the spin, the held swipe, the drag) is off: the stage's pointer, wheel and key handlers
hand over to the stack, and a case never turns.

**A row** is one album, as wide as the stage, as tall as two lines of text (2.75rem), coloured from its cover as the
standing spines are (`spineColour`: the cover's average, darkened a touch; a stand-in colour from the title until the
cover has been seen — the same 500px cover the Covers look fetches, read for its colour only, one per row in view,
cached by the browser). Left to right: the brass tab where a run begins in the order chosen (a letter by artist, the
label's name by label, the decade by year — the standing spines' divider cards, lying down), the artist in bold
capitals, the title; at the right, in even figures, the label (dim; not on a stage narrower than 900px), the year,
and the catalogue number in a monospaced face, as a shop's stock list prints it. A phone held upright (560px and
narrower) stacks the artist over the title. Only the rows in view and a margin are in the document (a library of
thirteen thousand albums is thirteen thousand rows); the list's height is the whole stack's, so the scrollbar is true.

**The row in front** is the shelf's `p`: a brass edge and a lighter face. It is what the bar's Play now and Queue act
on and what "n of N" counts, as the front case is in the other looks. The arrow keys move it (Shift: ten; the row is
scrolled into view), Enter opens it, S and the Spin button pick a row at random, scroll to it and say so ("Landed on
…"); a tap on a row brings it to the front and opens it.

**Open** (one at a time): the row's panel unfolds beneath it, pushing the rows below down — never over them. Its
height is half the stage's (11rem to 22rem). At the left, the cover, as tall as the panel; at the right, the title
in the display face, the artist, one line of facts (label · catalogue № · kinds · year, the back of the case's line
with the year added), Play now and Queue (the bar's own, for this album), and the track list read as the back of a
case reads it (`/api/album`, cached per album; "Reading the tracks…" meanwhile; the back's own words when Roon is
away), in two columns on a wide stage, scrolling inside the panel when longer than it. A tap on the open row's spine
folds it away; a tap on another row opens that one instead; the choices changing (a chip, Reset, an order) folds it
away and keeps the front row where the shelf keeps it.

**The Order tab** gains **By catalogue №** (`shelf-pick.js`): every album with a number, in the numbers' natural order
across labels ("WARP 61" before "WARP 123"; "HDB 008" before "WARP 61"), then by title; albums with no number last,
by artist. No tabs on the spines in this order — a number says nothing about where a run begins. It is a chip as the
other orders are, and shows in every look.

**What does not change**: the three looks, the lane, the queue, the bar, the help dialog (one line added: the
stack scrolls, a tap opens). Nothing is written to Roon; nothing is read that the Shelf did not read before.

## 4. Open questions

None. The catalogue order and the label at the right of a row are this design's additions beyond the owner's three
answers, shown in the renders for sanction with the rest.
