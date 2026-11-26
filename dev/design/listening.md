# What counts as a play — design

Status: **designed 2026-11-26 from the owner's decisions (§1); not built.** This document is the specification for
the work it describes: code matches it, or this document changes first, in the same commit (`CLAUDE.md`, "Spec
authority"). Anything still open (§8) goes to the owner before the code that depends on it. Smart Picks' seeds
(`smart-picks.md`) and profiles (`profiles.md`) are built on it.

## 1. Why, and the owner's decisions (2026-11-26)

A user wrote that Smart Picks kept suggesting 1980s pop and 1960s–70s soul, under 10% of their listening, and asked
whether a few tracks sampled from a pick count as much as sustained listening. They do (§2). The owner's rule:

> "Play 95% of a track should count as a play count so if all tracks of an album have been played 95% or more than
> the album would be marked as a play count increase. Someone who skips through tracks within an album should not
> count as a play count increase."

and, asked (2026-11-26):

1. **An album's play needs one listening:** every track to 95% in one run of the album (§3.2), not added up over
   weeks.
2. **Everywhere:** one meaning of "played" across Rouen (§5). Recently played and the queue history still show what
   was started.
3. **A play started outside Rouen counts for the zone's profile** (`profiles.md` §4).

## 2. What Rouen does today (2.0.6-t19)

- `scrobbleUpdate` (`index.js`) inserts a `plays` row **when a track starts**, keyed by the album's **title**, the
  track's title and artist (Roon's `three_line`), the zone, the album's `image_key` and the track's length.
- While the track plays it adds up the time actually listened (`elapsed`: forward steps of under 30 seconds; a seek
  further is not listening). When the next track starts, `playCounted` (`lib/queue-history.js`) sets `completed = 1`
  if at least 30 seconds were heard and half the track or four minutes.
- **Nearly every reader counts every row, finished or not** (`COUNT(*)`), and groups by the album's title alone, so
  every album of one title shares one play count: a play of any "Greatest Hits" counts for every "Greatest Hits" in
  the library. Only one reader, Listen later's "played through" (`index.js`, `listenLaterNoticePlay`), asks for
  `completed = 1`.
- How long was heard is not kept: `elapsed` is lost once the row is completed or not.

## 3. The rule

### 3.1 A track play

A track is **played** when the time actually listened reaches **95% of its length**, measured as `elapsed` is today
(seeks forward of 30 seconds or more are not listening, so skipping to the end never counts). A track with no length
from Roon (a radio stream, some live inputs) is never a track play. The row is still written when the track starts,
for Recently played and the queue history; it gains `heard` (milliseconds listened) and `played` (0 or 1), written
when the track ends (the next track, a stop, the zone gone, Rouen stopping: whatever ends it today).

### 3.2 An album play: one listening

An album is **played** when, in one **run** of it on one zone, every one of its tracks has been played (§3.1).

- **A run** is the album's tracks played on one zone with no track of another album between them. Pauses, stops of
  under 12 hours, a track repeated, and tracks out of order (shuffle within the album) do not end it. A track of
  another album, or 12 hours with nothing playing on the zone, ends it.
- **Its tracks:** the album's track count from Roon: native mode's `Discs`/`TrackCount` where native mode has the
  album (`native-remote.md`); else the album's track list read once through the public browse API, as the album view
  reads it, when a run first reaches as many played tracks as it could need. Never a guess.
- **Which tracks:** by title and position within the run. Two tracks of one album with the same title (a reprise, a
  classical work's "I. Allegro" twice) are told apart by their place in the album's track list.
- An album played completes **once per run**: the run then starts again, so listening to it twice through counts two.
- A run that ends short is not an album play, whatever its tracks were. Sampling two or three tracks of a pick never
  is one.

### 3.3 Which album: its identity, not its title

A play belongs to **the library album it was played from**, matched by the album's `image_key` (already in every
row), then by title and the album's credit containing the track's artist, then by title alone where only one
library album has it. Nothing is counted for an album it cannot be matched to; it still shows in Recently played.
Two albums sharing a title never share a play.

## 4. What is kept

- `plays` gains `heard INTEGER` and `played INTEGER DEFAULT 0` (§3.1), and `album_key TEXT`: the library album the
  row was matched to (§3.3), written when the row is.
- A new table `album_plays (id, ts, zone, album_key, title, image_key, tracks, profile)`: one row per album play
  (§3.2). `profile` is `profiles.md`'s, null until profiles are built.
- The run in progress is kept in memory per zone, as `scrobbleState` is; a restart of Rouen ends every run.
- Backups carry both tables as they carry `plays` today.

## 5. Everywhere (the owner, 2026-11-26)

Every reader that counts plays counts **track plays** (`played = 1`) by album identity, and **album plays** where it
asks how often an album was played:

| Reader | Today | Then |
|---|---|---|
| Library's play counts and the Last played sort | rows by title | album plays; Last played: the latest album play, else the latest track play |
| Home's "not played", random albums' "not played lately" | any row by title since a cutoff | no album play and no track play since the cutoff |
| Album of the day's "played today" | any row by title today | an album play today |
| Stats and the track lookups by title | rows | track plays |
| The artists you play (the share card's and Discover's seeds) | rows by artist | track plays by artist |
| Listen later's "played through" | finished tracks (old rule) by title | an album play |
| Smart Picks' seeds | rows by title | `smart-picks.md` §3 |
| **Recently played, the queue history** | rows | **unchanged**: what was started |

## 6. Plays from before this version

Rouen never kept how long a track was heard, so the 95% rule cannot be applied to old rows. They are read as:

- **A track play** where `completed = 1` (heard past half the track, the old rule). It is the best Rouen has.
- **An album play** where a run of them (§3.2, from the rows' order, zone and times) covers every track of the
  album. Built once, the first time this version starts, in the background; marked done so it never runs again.
- Matched to their album by §3.3.

## 7. Tests

Each written first, failing, and broken on purpose once (`CLAUDE.md`, "Tests"):

- Two library albums titled "Greatest Hits": a play of one counts for it alone. (The user's report.)
- Three tracks of a ten-track album heard to 95%: three track plays, no album play.
- Every track heard to 95% with a pause and one track repeated: one album play. Twice through: two.
- A track of another album in the middle: no album play.
- A seek to the last few seconds: not a track play.
- Old rows: `completed` read as a track play; a complete run of them as an album play; the build runs once.

## 8. Open

Nothing. The 12-hour gap (§3.2) is this design's: say if another suits better.
