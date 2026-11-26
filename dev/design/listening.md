# What counts as a play — design

Status: **designed 2026-11-26 from the owner's decisions (§1); built in 2.0.6-t20.** This document is the specification for
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
4. **The history's albums read in the background** (§6): after the upgrade, the track lists the plays from before
   need are read from Roon, a few seconds apart, so those plays count for whole albums too.

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
- **A pause ended the track:** the pause finished the row and the resume started another, so a track paused half way
  was two half plays. Under a 95% rule it would never be one.

## 3. The rule

### 3.1 A track play

A track is **played** when the time actually listened reaches **95% of its length**, measured as `elapsed` is today
(seeks forward of 30 seconds or more are not listening, so skipping to the end never counts). Roon reports a zone's
position once a second: the report of a track's last second often never comes, so one second is allowed for it, and a
track first reported within two seconds of its start is heard from its start (its first report is often at 1 or 2;
a track first seen later, as when Rouen starts mid-track, is credited only with what is seen). A length Roon sends
only after the first report is taken when it comes. A track with no length from Roon (a radio stream, some live
inputs) is never a track play. The row is still written when
the track starts, for Recently played and the queue history; it gains `heard` (seconds listened) and `played` (0 or
1), written when the track ends: the next track, the same track starting again from its beginning once played through
(repeat one: a play of its own, including when Roon goes through "loading" back to the start, or the track is taken
back to its start while paused), a stop, the zone gone, the Core gone. **A pause, or Roon loading, does not end it**
(§2): what is heard before and after adds up. Rouen stopping or restarting mid-track ends it unrecorded.

### 3.2 An album play: one listening

An album is **played** when, in one **run** of it on one zone, every one of its tracks has been played (§3.1).

- **A run** is the album's tracks played on one zone with no other track between them. Pauses, stops of under 12
  hours, a track repeated, and tracks out of order (shuffle within the album) do not end it. It ends on: a track of
  another album (played or skipped), a track that cannot be matched to a library album (§3.3), 12 hours with nothing
  finishing on the zone, the zone or the Core gone, and Rouen restarting (runs are kept in memory).
- **Its tracks:** the album's track list by position, as Roon lists it (`album_track_list`, kept whenever Rouen opens
  an album: `album_tracks`, which the share import reads, keeps one row per title and cannot say two tracks of one
  title). For an album Rouen has no list of, the list is read once through the public browse API, as the album view
  reads it, when a track of a run of it is first played (a track sampled below 95% costs no read; a read that fails is
  tried again after six hours, not on every track). An album that still has no list is never played. Never a guess.
- **Which tracks:** each title heard marks one position not yet marked: first one with the same title, else one it
  matches by its keys (index.js `trackTitleKeys`, so a remaster suffix on one side does not hide a match). Two tracks
  of one album with the same title (a reprise, a classical work's "I. Allegro" twice) need hearing twice.
- An album played completes **once per run**: the run then starts again, so listening to it twice through counts two.
- A run that ends short is not an album play, whatever its tracks were. Sampling two or three tracks of a pick never
  is one.

### 3.3 Which album: its identity, not its title

A play belongs to **the library album it was played from**, matched by the album's `image_key` (already in every
row) where the cover names one album, then by title and the album's credit containing the track's artist, then by
title alone where only one library album has it. An album's identity is index.js's `albumKey` of its title and credit
(`listenKey`; `raw|title|credit` for a title `albumKey` cannot key, punctuation only), the key `album_tracks` and
Listen later use: two library records with one key (two editions under one name) are one album here, as they are
there. A catalogue album's credit, which Roon's search gives as links (`[[id|Name]]`), is read as its names. Nothing is
counted for an album a play cannot be matched to (`album_key` ''); it still shows in Recently played. A play recorded
before the library is there is matched when it is (each time the library changes, for the rows not matched yet); one
matched to none is not tried again, so an album added to the library later does not take the plays from before it was
there. Two albums sharing a title never share a play.

## 4. What is kept

- `plays` gains `heard INTEGER` and `played INTEGER DEFAULT 0` (§3.1), and `album_key TEXT`: the library album the
  row was matched to (§3.3), written when the row is ('' when none; null until the library is there). `completed` (the
  old rule) is no longer written; it is read once, for the rows from before (§6).
- A new table `album_track_list (akey, n, title)`: each album's tracks by position (§3.2).
- A new table `album_plays (id, ts, zone, album_key, title, image_key, tracks, profile)`: one row per album play
  (§3.2). `profile` is `profiles.md`'s, null until profiles are built.
- The run in progress is kept in memory per zone, as `scrobbleState` is; a restart of Rouen ends every run.
- A table `listening_meta` keeps the last play row from before this version (§6) and whether the history has been read.
- Backups never hold play history (`lib/backup.js`): neither table is in one, as `plays` is not. Album plays are pruned
  with plays, after 400 days.

## 5. Everywhere (the owner, 2026-11-26)

Every reader that counts plays counts **track plays** (`played = 1`) by album identity, and **album plays** where it
asks how often an album was played:

| Reader | Today | Then |
|---|---|---|
| Library's play counts and the Most played and Last played sorts | rows by title | album plays; Last played: the latest album play, else the latest track play |
| Library's Played / Never played / not played in N months, and whether there is any history | any row by title | a track play (or an album play) |
| Home's "not played", the random album and the "unheard" pick | any row by title since a cutoff | no album play and no track play since the cutoff |
| Album of the day's "played today" | any row by title today | an album play today |
| Which album a shared track sits on (`playsForTrack`) | rows | **unchanged**: any row says where a track was played from |
| The artists you play (the share card's and Discover's seeds) | rows by artist | track plays by artist |
| Listen later's "played through" | finished tracks (old rule) by title | an album play |
| Smart Picks' seeds | rows by title, per album owned | album plays by album identity, per album owned, as before; `smart-picks.md` §3 replaces the rule itself in its own build |
| The queue screen's played / skipped mark | the old rule | a track play (a stream with no length: 30 seconds, as before) |
| **Recently played, the queue history's list** | rows | **unchanged**: what was started |

So a play count (whole albums) and "played" (any track to 95%) can differ: an album half heard is Played, with a count
of 0.

## 6. Plays from before this version

Rouen never kept how long a track was heard, so the 95% rule cannot be applied to old rows. They are read as:

- **Which rows:** every row written before this version first started (the highest row id then, kept).
- **A track play** where `completed = 1` (the old rule: 30 seconds heard, and half the track or four minutes). It is
  the best Rouen has. Marked once, when this version first starts.
- **Matched to their album** by §3.3, once the library is there.
- **Their albums' track lists read in the background** (the owner, 2026-11-26: "Read lists in background"): every
  album the history holds a run of two played tracks or more of, with no list kept, read through the public browse
  API one album every four seconds, most recent first. Three reads failing in a row (the Core gone) stop the pass
  until the library is next published; it starts again then, without the albums already read.
- **An album play** where a run of them (§3.2, from the rows' order, zone and times) covers every track of the album.
  Read once the lists are there, after the zone handlers; marked done so it never runs again. Listen later is not
  asked about these: its entries were taken off by the old rule when those plays happened.

## 7. Tests

Each written first, failing, and broken on purpose once (`CLAUDE.md`, "Tests"):

- Two library albums titled "Greatest Hits": a play of one counts for it alone. (The user's report.)
- Three tracks of a ten-track album heard to 95%: three track plays, no album play.
- Every track heard to 95% with a pause and one track repeated: one album play. Twice through: two.
- A track of another album in the middle: no album play.
- A seek to the last few seconds: not a track play. A pause half way: one row, and a play.
- Old rows: `completed` read as a track play; the lists read in the background, three failures stopping it; a complete
  run of them as an album play; read once.
- A reprise, a movement title twice, a remaster suffix; a 15-second track first reported at 1; repeat one through
  "loading"; a length that comes late; the real album key of two "Greatest Hits".

## 8. Open

Nothing. The 12-hour gap (§3.2) is this design's: say if another suits better.
