# A playlist's track artists, and its Sort

Status: **built in v2.0.3-t4; the native read not yet run on the owner's server for an ordinary
playlist (§3). Playing in the order shown (§7) built in v2.0.3-t11; how long a long playlist takes to
send is not yet measured on the owner's server.** This document is the specification for the work it
describes: code matches it, or this document changes first, in the same commit (`CLAUDE.md`, "Spec
authority"). It builds on `dev/design/native-remote.md` §11–§12 (Roon's playlists over native mode, and
the item read proven for smart playlists).

## 1. Goal (a user's request, relayed by the owner, 2026-11-09)

> In playlist, instead of composers it would be nice to have artist for each song and maybe a chance to
> choose to have the artists in alphabetic order. It will make it a lot easier to find a specific number
> or artist when you have large playlists.

The owner asked for it to be planned, probed and built.

## 2. Why the line shows composers

A Roon playlist opened in Rouen is read through Roon's official extension API (the `playlists` browse
hierarchy, `/api/playlist`). Each track comes back as a row with a `title` and one `subtitle` line, and
Rouen shows that line under the title. Roon fills it as it sees fit; for many tracks it is the
**composers** ("David Paich" under Toto's *Rosanna*). The official API gives no other field, so it cannot
be fixed there.

Native mode already reads a playlist's items from the server itself (`Playlist::VirtualItemsQuery`,
`lib/roon-direct/playlist-items.js`, proven on the owner's server for smart playlists, `native-remote.md`
§12.2). Each item is a `Track`, whose `PerformedBy` is the track's own artist line ("Toto"); the album's
is used when the track carries none.

## 3. The probe

`GET /api/debug/roon-playlist-artists?run=1&title=<name>&offset=<n>` (read only; without `run=1` it says
what a run would do). It reads the playlist through the official API and over native mode, and returns
the first 40 rows as `{ title, line, artist, album }`: `line` is the official API's line, `artist` what
the server names. Also: how many rows the server named (`named`), and of those how many the official line
already gave (`lineIsArtist`) and how many it did not (`lineDiffers`), with the time each read took.

What a run settles on the owner's server: that an ordinary playlist (not only a smart one) is found by
name and read; how often the official line is not the artist; the time a long playlist takes.

## 4. What the user sees

On a Roon playlist's page, and on Rouen's own playlists:

- **Sort**, above the tracks: **Playlist order** · **Artist** · **Title**, one pressed. *Artist* orders
  the tracks A→Z by artist (a lead "The " ignored, then by title); *Title* A→Z by title (then artist);
  *Playlist order* puts them back. A row with no artist goes after those with one. The choice is kept on
  the device (browser storage) and applies to the next playlist opened. Tapping a row plays that track,
  whatever the order. **Play now** and **Queue** follow the Sort (§7, since v2.0.3-t11; until then they
  played the playlist's own order whatever was pressed).
- **Each track's own artist** on a Roon playlist, with native mode on: the page opens as before, with the
  official line, and each line is replaced by the track's artist when the server answers (re-sorted if
  sorting). A row the server cannot name keeps its line. Sorted, each row keeps the number of its place
  in the playlist, not its place on the screen. With native mode off, or the playlist
  not found on the server, nothing changes but the Sort, which sorts on the lines shown (on Rouen's own
  playlists, the artist before " · ").

Not in this build: Roon's smart playlists and Rouen's Dynamic Playlists, whose tracks arrive a page at a
time; the shared playlist file still carries the official line.

## 5. How it is built

- **The read** — `lib/roon-direct/playlist-artists.js`, made with native mode's other services. The
  chosen profile's playlist **of exactly the name** the official API lists (else the one of that name
  ignoring case); none, or two of one name, gives no artists — never a guess. Then its items a page of
  100 at a time, to the playlist's count or 1,000 tracks (the official read's ceiling until 2.0.4-t1; the
  rows past it keep the official read's line), **each page in a turn of its own** on the connection, so a pause or a skip never
  waits behind a long playlist; the read stops at the first page that does not arrive whole.
- **Room on the connection** (the review). A page brings some 3,800 objects that stay in the
  connection's graph until the next connection (overnight, or native mode turned off and on), and the
  smart playlists' pages need the same room (`smart.js` stops under 50,000 objects left). So no page is
  read here with under **70,000** left — five of `smart.js`'s pages always kept for it — and the answer
  says `capped`. On the owner's server (some 99,000 of room after the library read) that is roughly
  700 tracks of playlists read per connection; a playlist past it keeps its official lines beyond the
  rows read. Answers are kept per playlist for the connection, read again only when the playlist's
  track count changes or after an hour; an answer with a track that did not arrive, or with no Count
  sent, is not kept. One read per playlist at a time. Methods added to the allowlist: **none**.
- **Matching rows** — `alignTracks` / `alignArtists`: each official row takes the server's track at its
  own place when the titles agree (compared as letters and digits, any script); else, only when the
  whole playlist was read, the track of that title when every track of that title has one artist (a
  partial list cannot say that); else none.
- **The route** — `POST /api/playlist/track-artists { title, tracks: [row titles] }` → `{ status,
  artists }` in `lib/routes/roon-playlist.js` (with `/api/playlist` and its play routes, moved out of
  `index.js` unchanged in the same build). Any status but `ok` (`off`, `none`, `failed`) comes with why
  and no list.
- **The page** — `public/playlist-tracks.js` (the Roon playlist's row, moved out of `public/app.js`
  unchanged in the same build): `enhance(ol, …)` adds the Sort and, for a Roon playlist, asks for the
  artists once the rows are drawn, applying them only while the same playlist is on screen. Rows are
  moved, never rebuilt, so each keeps its cover and its tap. Its stylesheet is its own
  (`playlist-tracks.css`).

## 6. Not in this build

- Writing anything to Roon.
- Sorting or naming the tracks of smart and Dynamic Playlists (§4).
- A search within a playlist.

## 7. Playing in the order shown (v2.0.3-t11)

The owner, 2026-11-09:

> Sort-by order doesnt change the playback order. Roon doesn't have this so the reverse code cannot be
> used. Anyway to get around this

Roon has no "play these tracks in this order", in the official API or in what native mode has proven. It
can play a whole playlist, in the playlist's order, or one track of it. So the way round is to send the
tracks **one at a time, in the order on the screen**: the first one Roon accepts with what was pressed
(Play now, or Queue), every one after it queued behind. What is in Roon's queue afterwards is the sorted
list, and it plays in that order.

How it is done below (a Stop, a count, what ends the sending) was chosen in the building, not asked of the
owner first; §7.5 lists what each choice costs, and each can be changed.

### 7.1 What the user sees

- **Playlist order pressed** (or a page with no Sort): a Roon playlist is played by Roon's own single
  action, at once, as before. A playlist made in Rouen is sent as before, with one fault fixed: Play now
  goes to the first track Roon accepts (it went to the first tried, so with the first track gone from the
  library the rest were queued behind whatever was on and nothing played).
- **Artist or Title pressed, a Roon playlist**: Play now (or Queue) says "Sending 5 tracks in the order
  shown…", and the button pressed becomes **Stop · 2 of 5**, counting the tracks tried, with the other
  button waiting. On a narrow button the count is shortened ("Stop · 2/5", then "Stop"), never cut. The
  Stop looks the same whichever button it was. The first track starts as soon as Roon has it; the rest
  arrive behind it over the following seconds or minutes. When all are sent the buttons come back and a
  toast says so ("Sent all 5 tracks in the order shown", or how many of them and why not the rest).
  **Stop** ends the sending ("Stopping…" while the track in flight lands); what has been sent stays in
  the queue.
- The sending is done by Rouen's server, not the page: the phone can lock, or the page be left, and it
  goes on. A page opened again on that playlist while it runs shows the Stop and the count again.
- With another zone picked while it runs, the buttons are that zone's (Play now and Queue); back on the
  run's zone they are its Stop again.
- **Artist or Title pressed, a playlist made in Rouen**: its tracks are sent from the page, as they
  always were, now in the order on the screen. It has no Stop and needs the page open (§7.5).

### 7.2 The run (`lib/ordered-play.js`)

- `start(zone, tracks, kind, send, meta)` answers at once with the run's status; the tracks are then
  sent one after another, each waiting for Roon's answer to the one before.
- **One thing is sent to a zone at a time.** Each run, and each `takeOver` (below), waits for what the
  zone was given before it. Starting a run ends the one running (`"replaced"`, a value only the log
  shows: by then the zone's status is the new run's), and the new one sends nothing until the old one's
  track in flight has landed, so a late track of the old run cannot land in the new queue.
- **The kind goes to the first track Roon accepts**, not the first tried. "Accepts" is all that can be
  known: the request for it did not fail.
- **A track Roon refuses** (gone from the playlist, renamed since the page was read) is counted and the
  run goes on. **Five refusals in a row** end it (the playlist deleted, Roon gone), with `stopped:
  "failures"`.
- `stop(zone, why, id)` ends it after the track in flight; `why` is `"user"` (the Stop button). With an
  `id`, a run the zone has been given since is left going. A Stop that lands as the last track goes is a
  run that finished.
- `takeOver(zone, why, fn)`: something else for the zone that a run must not go on queueing behind. The
  run is ended (`why`, `"other"`), `fn` waits for the track in flight, and whatever the zone is given
  next waits for `fn`.
- A run never ends as a rejection, whatever a send throws.
- A finished run is kept for an hour, or until the zone's next, so the page can read how it ended. Runs
  are in memory: a restart of Rouen ends one where it stood, and the page puts its buttons back when the
  server no longer knows the run.
- Each run's end is logged: how many tracks, how long its own sending took, how many refused and the
  first reason.

### 7.3 The routes (`lib/routes/roon-playlist.js`)

- `POST /api/playlist/play-ordered { offset, title, zone_or_output_id, kind, tracks: [{ index, title }] }`
  → `{ ok, job }`. `kind` is `play_now` or `queue`; `title` is required (it is what says the offset still
  points at this playlist, for every track of a run minutes long); `tracks` is 1 to `PLAYLIST_ITEMS`
  (10,000 since 2.0.4-t1; 1,000 before) rows, each with the index the official read gave it. Each is sent as a tap on that row is
  (`invokePlaylistTrackAction`): the row at that index when it still has that title, else the row of
  that title (the playlist edited since the page was read), and refused when no row has it.
- `GET /api/playlist/play-ordered/status?zone=` → `{ job }`, or `null` when the zone has had none. The
  job: `id`, `kind`, `total`; `sent` (tracks tried so far), `queued` (those Roon accepted), `failed`
  (those it refused) and `first_error`; `done`, `stopped` (`null`, `"user"`, `"other"`, `"failures"`),
  `seconds`, and the playlist's `offset` and `title`. A path of its own, so the request trace
  (`lib/http-trace.js`) leaves the poll out of the debug log and keeps the start and the Stop.
- `POST /api/playlist/play-ordered/stop { zone_or_output_id, id }` → `{ job }` once it has ended; when
  `id` is another run's than the zone's, that run is left and is what the answer carries.
- **A Play now on the zone takes the run's place**: `/api/playlist/play` and `/api/playlist/play-track`
  with `kind: "play_now"` go through `takeOver`. The run is ended (`"other"`) and its track in flight
  lands before Roon is asked, so nothing of the run is queued behind what was just asked for; a run
  started while that Play now is out waits for it. A Queue leaves the run going.

### 7.4 The page (`public/playlist-play.js`)

- Which order: the rows as they stand in the list when the button is pressed (`ol.dataset.sort` other
  than `order`; each row's place in the playlist is the `__order` the Sort gave it). With native mode's
  artists still arriving, that is the order on the screen at that moment.
- It asks for the run's status every 1.5 s while it watches one, and once as a Roon playlist's page
  opens, to take up a run already going for a playlist **of that name** on the zone in use (the offset is
  a hint that moves). Twenty polls failing one after another (30 s) and it stops asking and says so, and
  that the tracks may still be going; the run itself goes on.
- The Stop is sent with the run's id, and is not armed for the first 0.8 s (the second tap of a double
  tap is not a Stop). While the start is out both buttons are off.
- A run ended by a Play now on the zone (`"other"`) is said as a Stop is: how far it had got. A run
  another run replaced says nothing: the new one says its own piece.
- The count is written only when it changes, and its row is marked not to be read out as it changes; the
  toasts carry the start and the end.
- A playlist made in Rouen (`own`): the loop moved out of `public/app.js`, sending `/api/play-track`
  for each track in the order on the screen, the kind to the first accepted.

### 7.5 What it costs, and its limits

- **Time, and Roon's work.** Each track is seven requests to Roon (nine when the playlist's place in
  Roon's list has moved since the page opened), and one of the seven reads the playlist's level again.
  Since 2.0.4-t1 (the walk moved out of `index.js`, `lib/provider/public/playlist-open.js`) it reads only
  as far as the track's own row, a few rows to spare, and the rest only when the track isn't among them
  (the playlist edited since the page was read). So the rows Roon sends still grow with the square of the
  playlist's length, but half as fast: about 125,000 for 500 tracks, 500,000 for 1,000. Not tried on a
  real server. Expect a second or so a track, more for a long playlist. Not measured on the owner's
  server; each run's log line gives the time.
- **The debug log.** Each track's seven requests are in it, as any play action's are: a long run fills
  much of the log file. The status poll is left out.
- **A playlist longer than 10,000 tracks** is read to 10,000 (the page says so), and sorted it plays the
  rows shown. In Playlist order Roon's own action plays all of it. Until 2.0.4-t1 the ceiling was one
  load of 1,000 rows, which the playlist's Play row made 999 tracks, and the page never said so (the
  test for "cut short" was tracks against 1,000): gert_mogensen's 1,515-track playlist, 2026-11-10.
- **Other things that play to the zone do not end a run.** Only the two playlist routes above and the
  Stop do. An album played from elsewhere in Rouen, Roon Radio, a Dynamic Playlist, Android Auto's
  albums, or anything done in Roon's own apps, while a run is going, will have the run's remaining
  tracks queued behind or among it, and Rouen's other queue-filling actions (several albums at once, a
  Dynamic Playlist) do not know a run is going. The Stop is on the playlist's page, and scrolls away with
  a long list; the page opened again shows it at the top.
- **A Play now waits for the run's track in flight**, as it must: usually a second, at worst the 90 s
  Roon is given to answer a request. A Play now that then fails (the playlist changed) has still ended
  the run; the page says how far it had got.
- **A sorted Play now or Queue on a second playlist** while a first is still being sent to the same zone
  ends the first where it stood, with nothing said of it.
- **A Queue from anywhere during a run** lands among the run's tracks, wherever it arrives.
- **The run is known by the zone's id as the page sent it.** Rouen's pages always send the zone's id;
  another caller naming the same zone by an output's id would be a second run beside the first.
- **Shuffle** in Roon, if on for the zone, shuffles the queue whatever order it was sent in.
- **Rouen's own playlists** are still sent from the page: no Stop, a phone that locks part-way stops the
  sending there, and their Play now does not end a Roon playlist's run on the zone. Moving them onto the
  server's run is a build of its own (it needs the album-track action passed out of `index.js`).
- Smart and Dynamic Playlists have no Sort (§4), so nothing here applies to them.

## 8. Finding a track, and Shuffle (2.0.4-t4, t5; gert_mogensen and the owner, 2026-11-10)

- **Shuffle** (t4; gert_mogensen: "And maybe a Shuffle play in playlist?"): a square button with Roon's shuffle mark
  after Queue on a Roon playlist's page, Roon's own Shuffle of the whole playlist (its Play menu's, `kind: "shuffle"`
  to `/api/playlist/play`), sorted or not. Like Play now it ends a run going on the zone. Square, so Play now and Queue
  keep their width on a phone; the run button's count takes its shorter form there ("Stop · 999/1000"), until t10's
  36 px round buttons (§9) gave the long one ("Stop · 999 of 1000") room again.
- **Find** (t5; the owner: "the search function from the bottom bar when pressed will only then search within that
  playlist"): the bar's Search, pressed on a playlist's page, opens a field over the rows (`touchnav.js` asks
  `RouenPlaylistFind.here()`); what is typed keeps the rows whose title or artist has every word of it (case and
  accents ignored), and says "2 of 1,515". A glass at the end of the Sort row opens it too, on a desktop only: on a
  phone or tablet it was the bar's Search twice over (the owner, 2026-11-10, t8: "the new search magnifying glass is
  duplicate to the one at the bottom of the screen"), so it is not shown where the bar is. × or Escape clears and
  closes it. **Play now and Queue still play the whole playlist** in the Sort's order while a find is typed (the owner's
  choice): the rows left out are hidden, not gone. `public/playlist-find.js`, loaded by `playlist-tracks.js`.
- **A–Z** (t6; gert_mogensen: "it would be nice if i could jump to the letter S"). Shown only when the playlist is
  sorted by Title or Artist (the owner's choice), and only when its rows run past the screen. From t8 (the owner,
  2026-11-10, the strip of t6 seen on a phone) it is a slider rather than a strip of letters:
  - a thin line down the right edge, from the first row (or the top of the screen, once the rows have scrolled up
    under it) to just above the mini player;
  - on it a circle holding the letter of the top row on screen, which moves down the line as the list is scrolled
    (the owner's choice: it follows the scroll), its place on the line the place in the list;
  - a long press on the circle takes hold of it; drawn down or up the line, the list moves with the finger as it goes
    (the owner's choice: live, not on letting go), and the top row's letter shows in a larger circle just above the
    finger, so the finger does not hide it. Letting go leaves the list where it is. A finger that moves before the
    press has lasted (about a third of a second) does nothing;
  - the letter is the Sort's own key (a lead "The " off), accents off: A–Z; each digit its own (the owner's choice: a
    title starting "2" shows "2"), where the Sort puts it, before A; anything else "#". Rows a find hid take no
    place on the line.
  - While the keyboard is open (`dev/design/artists.md` §1) it is not shown.
  `public/playlist-az.js`, loaded by `playlist-tracks.js`.

## 9. The top of the page held while the tracks scroll (2.0.4-t10; the owner, 2026-11-10)

The owner, with screenshots of a 50-track playlist on a phone and an iPad: "I want the top section of the playlist
screen to be fixed but reduced in size on the phone app and phone sizes screens, tablets can display the play options
and sort options on a single line and that'll reduce the height of the bar and show more tracks on the screen. The same
I guess for desktop sized screen." Asked what the fixed top holds on a phone, the owner chose: the name, the buttons
and the Sort.

- **One block, held.** What a playlist's page has above its rows — the line saying what it is, Play now · Queue ·
  Shuffle · ⋯, the Sort and the find — is one block (`.playlist-top`), held at the top while the rows scroll under it:
  under the page's heading on a touch screen, under the bar with a mouse. The parts are moved into it as each page
  adds them, not rebuilt (`public/playlist-top.js`, `playlist-top.css`, loaded by `playlist-tracks.js`); all four
  playlist pages have it.
- **Smaller.** Play now, Queue, Shuffle and ⋯ are 36 px tall in it, the Sort's chips 34 px.
- **A phone or a tablet (touch):** the heading — the ‹ and the name on its line — is held at the very top too. The
  name is on **one line**, smaller (20 px at the default title size), cut with … when long; this replaces 2.0.3-t9's
  name in two lines. The count ("50 Tracks") goes beside the name when that is all the page's line says; a longer
  line (a Dynamic Playlist's "Albums · album order · …", a Roon smart playlist's) stays a line of its own in the block.
- **A tablet or a desktop (720 px and wider):** the buttons (150 px each) and the Sort on one line; the line saying
  what the page is, and an open find, a line each.
- The A–Z slider (§8) starts under the block.
