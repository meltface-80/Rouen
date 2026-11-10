# The album view on a phone: Mandarin's, with tabs

Read before working on the album view as a phone held upright shows it (narrower than 720px). Wider screens are
`album-view-landscape.md`'s (three columns) and the two-column card from 720px; the Shelf's own album view is
`album-view.md`'s.

## 1. The request (the owner, 2026-11-09)

> I want better artist bio pages, similar to the style on Mandarin. I also want the album screens to look like that on
> Mandarin. I want to replicate the credits, about screens. I also want versions. Mandarin does this but Rouen will have
> to work with Roon and the reverse code

> I also want Roons signal path to be visible from the now playing screen in a similar means to roon

And on 2026-11-10, of the Versions: **"Follow Roon"** (a version made the main one as Roon makes it: a write to the
library, probed and tried once by hand first) and **"Yes"** (streaming versions listed beside the library's own).
Asked again the same day, "Album layout changes not done yet?": they were not; this is them.

## 2. What is decided, and what is read into the request

- **Mandarin's album screen on a phone**, measured from Mandarin's own code (`public/style.css` 5758–5802, 4382–4403,
  `album-tabs.js`, `AlbumPhone.kt`), is what "look like that on Mandarin" is taken to mean. Its numbers are below.
- **Read into it, not asked:** only the phone held upright changes. The owner chose the three columns for tablets,
  desktops and TVs held sideways (`album-view-landscape.md` §2) and the two-column card from 720px stays; Mandarin's own
  wide layout is not brought over. This replaces, on a phone, the full-bleed cover of v1.7.84 and "portrait screens stay
  as they are for now" of 2026-10-27 (`album-view-landscape.md` §2.1), which the new request supersedes.
- **Now playing** shares the page (`#album-modal.np-mode`) and does not change (the owner, 2026-10-28: "Keep it as it is").
- **The Shelf's album view** (`shelf-back.js`) is a separate page and does not change in this build.

## 3. The screen, top to bottom (a phone held upright, the album view only)

1. **The glow.** The cover, blurred, washing the top of the page (`#modal-ambient`, as before; already Mandarin's).
2. **Back**, the brass disc top-left, and **Share** top-right, as before. (Mandarin has Share in ⋯ since its item 373;
   Rouen keeps its button: not asked.)
3. **The cover**, centred, `min(67vw, 300px)` square, radius 8px, shadow `0 16px 36px rgba(0,0,0,.45)` and a 1px ring;
   64px plus the safe area above it. No fade, no full bleed. The quality badge on it goes (it is on the facts line).
4. **The facts line**, centred, 18px under the cover, 14px `--text-dim`, tabular figures: the release date (the one the
   subtitle showed: to the day where known, else the year), the quality as a chip ("24/192", brass edge when hi-res;
   `album.quality`, as the cover's badge had it, and like it only with UI Settings → Show sample rate on), and the album's length ("43:00", "1:02:15") — the sum of the tracks'
   own lengths when every track has one (native mode, `track-times.js`) and Roon sent every track (not when the page
   says it sent fewer); none otherwise, never a part-sum. A part
   missing drops out with its separator.
5. **The title**, Young Serif (`--font-display`) 400, 30px, line-height 1.13, centred.
6. **The artists**, 17px, brass links, as before. The subtitle's other parts (date, label, catalogue number, kind,
   Pitchfork score) leave this line on a phone: the date for the facts line, the rest for About.
7. **The buttons**: Play now, Queue, heart, ⋯ — as they are.
8. **The tabs: TRACKS · CREDITS · ABOUT.** 13px, 700, letter-spacing .06em, uppercase, `padding: 12px 0 10px`;
   inactive `--text-faint`, active `--text` with a 2px `--accent` line only as wide as its word; centred, gap 18px,
   `padding: 0 44px` (clear of Back and Share), a 1px `--border` line under the row. The row stays at the top of the
   screen as the page scrolls (sticky, under the status bar), with no ground of its own: what scrolls up past the line
   under it is clipped away, so the glow and the page show behind the words, never a track (Mandarin's items 358, 375).
   Every opening of an album is on TRACKS (another copy of it too); Now playing over it and Back return to the tab it
   was left on. A tab tapped with the page scrolled past the tabs shows its start under them. A fourth, **VERSIONS**, shows once the album is known to have another version (v2.0.3-t16, `album-versions.md` §3.1).
9. **TRACKS**: the track rows as they are, without the "TRACKS" heading.
10. **CREDITS**: the credits list as it is (picture, name, roles, tracks; eight, then More), without its heading. None
    known, once the answer is in (not while it is asked, nor when it could not be): "No credits known for this album yet" (Mandarin's words)
11. **ABOUT**: a line with the label (a link to its albums, as before), the catalogue number, the kind, and the
    Pitchfork score with BNM; then "About this album" (the review), More by, Appears on, Similar artists, Similar
    albums, as they are. Nothing at all, once the album's facts are in: "Nothing more is known about this album yet"

## 4. How

- `public/album-phone.js` (new) adds the facts line, the tabs, the About line and the empty notes, keeps the tab and
  the clip, and builds the subtitle's extras, moved out of `public/app.js` (`renderExtras`) unchanged and now marked
  (`.modal-sub-extra`) so a phone can leave them off the artists' line. Its look is `public/album-phone.css`, loaded
  beside it. Both are loaded by `album-view.js`, as `now-disc.js` is (`index.html` is at its length baseline).
- On a phone the page's parts are laid out in one column by `order`, `.modal-info` and `#tab-album` being
  `display: contents` there (as the three columns do), so the tabs are a direct child of the scrolling page and stay.
- No server change.

## 5. Not in this build

- The Versions tab (`album-versions.md`, v2.0.3-t16), the signal path on Now playing (`signal-path.md`, t15), the artist
  page as Mandarin's — each its own build, designed in its own document first.
- Genre chips on About (Rouen's album answer carries no genres), Mandarin's ⋯ order, Share in ⋯.
- The Shelf's album view on a phone.
