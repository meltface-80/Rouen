# Smart Picks' seeds, balance and tuning — design

Status: **designed 2026-11-26 from the owner's decisions (§1); §3 and §6 built in 2.0.6-t22; §5 (Tune) in 2.0.7-t1; §11 (the album found and added through Roon) in 2.0.8-t9.** This document is the specification for
the work it describes: code matches it, or this document changes first, in the same commit (`CLAUDE.md`, "Spec
authority"). It covers **which of your artists Smart Picks starts from**. Where its similar artists and albums come
from (ListenBrainz, MusicBrainz, Qobuz or TIDAL) is unchanged: Roon's own (`roon-suggestions.md`) is on hold (the
owner, 2026-11-24: "Do nothing. It's currently doing more or less what I want"). It is built on `listening.md` (what
counts as a play) and, per profile, on `profiles.md`.

## 1. Why, and the owner's decisions

A user (2026-11-26), with about 11,000 albums and listening that is mostly classical, jazz, fusion, ECM and ACT:

> "I'm finding Smart Picks consistently concentrates on 1980s pop and 1960s/70s soul, despite these accounting for
> what I'd estimate is less than 10% of my listening. … Taylor Dayne, 'Because you play Michael Bolton'; Peter &
> Gordon, 'Because you play The Association'; The Hues Corporation, 'Because you play Diana Ross'; Julie Andrews,
> 'Because you play Barbra Streisand'. None of those starting artists has featured in my listening over the last few
> days. … Could Smart Picks distinguish exploratory listening from sustained interest … and better balance across
> listening styles?"

The owner (2026-11-26): weight adjusters for Smart Picks ("multiple sliders to set based on artists, years, tastes
etc"), and, asked:

1. **The controls: "Go with what you suggest"**: a few with plain meanings (§5), not many free sliders.
2. **Per profile** (`profiles.md`): each profile its own seeds, tuning and picks.
3. **Famous artists may seed, at reduced weight: "Yes, I think".**
4. **What counts as listening: the 95% rule** (`listening.md` §3).

## 2. Why it went wrong (2.0.6-t19, `index.js` `libraryArtistProfile`, `smartPickSeeds`)

- **Seeds are the 24 artists with the most plays per album owned, over all time.** No recency: the user's last week
  weighs no more than three years ago.
- **Every started track is a play.** Sampling two or three tracks of a pick is a strong preference, and a pick added
  and sampled becomes an artist with one album and some plays: the top of plays-per-album. The feedback loop the
  user feared is real.
- **Plays are matched to albums by title.** A play of any "Greatest Hits" counts for every "Greatest Hits" in the
  library ("Gold", "The Very Best Of", "Love Songs" the same). Artists present through such compilations, often one
  album each, rise to the top of plays-per-album. This fits the user's four seeds; it is checked against their
  library through §6 before it is called the cause.
- **Classical and jazz lose twice:** the famous-artist filter takes Bach, Mozart, Miles Davis and Coltrane out of the
  seeds entirely, and a large catalogue or a long classical credit divides the plays.

## 3. The seeds

### 3.1 What a seed is scored on

**Album plays** (`listening.md` §3.2) of the library albums crediting the artist (the album's credit, as today:
`splitCreditIntoArtists`), matched by the album's identity (`listening.md` §3.3).

- Each album play weighs **0.5 + 0.5 × 2^(−age / 90 days)**: every album play counts at least half; recent ones count
  up to twice as much. (The owner's "Both, mixed", 2026-11-24: recent listening and the rest of the library.)
- One album's weights are summed, then **square-rooted**: an album played twenty times does not drown out an artist
  played across five albums.
- An artist's score is the sum over its albums. **Nothing is divided by albums owned.**
- **Track plays outside any album's run** (a playlist, Radio, shuffle across the library) count too, a tenth of an
  album play each, at most one per artist per day: listening that never plays whole albums still says something,
  and a burst of it cannot. As built: each weighed by age as an album play is, all of an artist's together summed,
  square-rooted and counted a tenth, so one track is a tenth of an album play and a year of daily radio never
  outweighs albums listened to. The day is the local one. A track from outside the library counts in its artist's
  own albums' genres and decades, not "Other". A one-track release played whole is that album play, not a track
  play as well.
- **Tracks of a run that ended short count for nothing.** Sampling a pick is never a preference. "Outside any run"
  is read from the plays as recorded (`lib/listening/store.js` `trackPlaysAlone`): a track played (95%) whose zone
  played no other track of its album just before or after it, within a run's twelve hours. A track counts for the
  library artists its own credit names (the track's artist, not the album's), and only for artists of the library.
- **An album Smart Picks has suggested** (any day's, from `smart_picks`) seeds nothing from its tracks until it has an
  album play.

### 3.2 Famous artists (the owner, 2026-11-26)

An artist in the sitewide chart of the world's most-played artists (the hub chart, as today) **may seed, at a quarter
of its score**. Candidates in that chart are still never suggested ("famous is not a discovery"): that is unchanged.

### 3.3 Balance across styles

The seed slots (24, as today) are shared out by **Roon's top-level genre** of the albums that scored (Classical, Jazz,
Pop/Rock, R&B, …: the first level of Roon's genres, which Rouen already keeps per album), **in proportion to each
genre's share of the total score**. A genre with 5% or more of the score has at least one slot. Within a genre,
seeds are dealt **round-robin across decades** (the album's original release year, Roon's date where native mode
gives it, `recently-added.md` §3.3), highest score first in each. An album in two genres counts half to each.

As built: Roon's top-level genres are what Rouen already keeps per album (the genre harvest walks the first level of
Roon's genres); an album with none counts as "Other". The listening a genre's share is made from counts each album
once, however many artists it credits (a third to each of three). An artist is a candidate in its main genre, where
most of its score is, so one stray track elsewhere doesn't take it away; a decade is the artist's most-played decade.
A genre at 5% or more has a slot at least; under 5%, only what its share rounds to (the largest remainders), so
occasional listening still has a chance: 3% of 24 slots may round to one, 1% to none. A genre gets no more slots
than it has artists, and the slots never pass the cap (more genres at 5% than slots: the smallest give theirs up).
Slots left (an artist already chosen for another genre) go to the best-scored artists left, whatever their genre.

A library that is 40% classical and 25% jazz by listening gets about ten classical seeds and six jazz ones, spread
over the decades played.

### 3.4 With too little listening

A new install, or listening that is all playlists: the track plays of §3.1 alone; then, as before, the most-owned
artists not in the hub chart. As built, the top-up fills whatever slots listening leaves, not only when there are no
album plays at all: fewer artists listened to than the 24 slots means the rest are the most-owned.

## 4. Unchanged

The similar artists (ListenBrainz, by MusicBrainz ids), the ranking by distance and the round-robin over seeds
(`diversifySmartCandidates`), the 120 days a shown artist is left out, "Not for me", the album found on Qobuz or TIDAL
(through Roon since 2.0.8-t9, §11), the destinations (library, Listen later, ask), the daily build at its hour, and Rebuild.

## 5. Tune (Settings → Smart Picks → Tune), per profile

| Control | Steps | What it changes |
|---|---|---|
| **Listening window** | slider, 5 stops: Recent … All time; middle by default | the half-life of §3.1 (14, 45, 90, 365 days; All time: every album play weighs 1) |
| **Adventure** | slider, 5 stops: Close … Far; Far by default (the owner, 2026-11-26) | how candidates are ranked: Close by similarity to the seeds; Far by distance (fewest seeds first, today's); between, the two blended. Famous candidates are never suggested at any stop. |
| **Genres** | your top genres by listening (up to 10), each **Never / Less / As I listen / More** | the genre's share in §3.3 × 0 / 0.5 / 1 / 2 |
| **Decades** | the decades you play, each Never / Less / As I listen / More | the same, for decades: a decade's seeds dealt that many times as often (Never: none) |
| **Artists** | from each pick's "Because you play X": **More from X** / **Never start from X**; listed here to remove | More: X always among the seeds; Never: X never a seed (a "Not for me" on a pick is unchanged: that artist is never suggested) |

**Reset to "As I listen"** puts every control back. A change rebuilds today's picks, as Rebuild does. Three- and
four-way chips rather than sliders for genres and decades: ten sliders do not fit a phone's width, and they promise
more precision than the scores have.

As built (2.0.7-t1):

- **Where:** a sheet in the confirm dialog's look, above Settings, opened from Settings → Setup → Smart Picks → Tune
  and from a Tune button beside Why these picks on the Smart Picks screen. Each pick card gains a Tune button: the
  artists that pick came from, each with **More from X** and **Never start from X** (tapped again, taken back). Those
  come from Why these picks' record, which now keeps each pick's starting artists; a build before 2.0.7-t1 has none,
  and the sheet says so. Whether each is set is the server's answer, matched as it matches names ("The Necks" is
  "Necks"), never the sheet's guess. The stops are named Recent, 6 weeks, 3 months, A year, All time, and Close, Near,
  Middle, Wide, Far.
- **Saving:** the sheet's controls are a draft; **Save** keeps the whole Tune and rebuilds today's picks. **Reset** puts
  the sheet back to "As I listen" and is kept by Save. A pick's More / Never is saved, and rebuilds, at the tap. A Tune
  is checked whole before any of it is taken. A rebuild a Tune change asks for favourites nothing in the streaming
  library, whatever the destination: its picks show with Add, and the next daily build sends its own as set (the
  owner, 2026-11-26: "Show, don't add"); Listen later is unchanged. A Tune one saved while Rouen isn't paired, or with Smart Picks off, is kept and
  said to wait. A change made while a build runs (which reads the Tune it started with) waits for that build, then
  today's picks are built again, once however many changes came meanwhile.
- **Listening window:** the half-life of the album plays and of the tracks played on their own alike (§3.1); the
  "last 90 days" Why these picks counts stays 90 days.
- **Adventure:** Far by default, so an install that never opens Tune ranks as before (the owner, 2026-11-26: "Default
  Far"; §4's "the ranking by distance" unchanged). Far is the order before Tune (fewest seeds first, then score); Close is the most seeds first, then
  score; between, each candidate's places in the two orders are blended, Far's weighing stop/4. The round-robin over
  seeds (§4) still follows.
- **Genres:** a genre's share × its factor before the slots are shared (§3.3); Never also keeps every artist whose main
  genre it is from being a seed by any route, the top-ups included; an artist not played is judged by the genre and
  decade most of its own albums are in. Listed: the ten largest by the listening as it is
  untuned, then any set before that is no longer among them.
- **Decades:** within a genre's round-robin, each round deals a decade ⌊(round+1)·f⌋ − ⌊round·f⌋ seeds: As I listen one,
  More two, Less one every other round; Never: no artist whose decade (where it is most played) it is.
- **Artists:** More from X is a seed first, whatever its genre or decade is set to, and counts against the 24; an artist
  is More or Never, never both. "Not for me" on a pick is unchanged.
- **Stored:** one Tune for the install (settings `smartPicksTune`, in backups): the two stops, and of the genres,
  decades and artists only what differs from "As I listen";
  per profile once `profiles.md` is built. A saved Tune that doesn't parse reads as untuned rather than stopping the build.
- **Why these picks** says the Tune a build was made with ("Tuned: …"), a More from X seed under "More from (Tune)",
  and All time as every album play counting 1.

## 6. Why these picks

The Smart Picks screen gains **"Why these picks"**: the day's seeds grouped by genre, each with its score, its album
plays (the last 90 days and all time), the days its tracks were played on their own, the albums they came from, and
"reduced: widely played" where §3.2 applied, and "not found on MusicBrainz, so not used" for a seed that could not be
identified; then the next artists in line that were not chosen, and the numbers the scores are made with. ("Never",
§5's, comes with Tune.) The same as JSON at `GET /api/smart-picks/why`, for a report: the last build's, kept with
the Smart Picks cache (a month), and written only by a build that kept its picks. Each seed shows its three most
played albums; the next in line are the twelve best scored not chosen.

As built: the button sits before the picks on the Smart Picks screen and opens a sheet in the confirm dialog's look,
from its own script (`public/smart-picks-why.js`, which watches the album grid for the Smart Picks list), so
`public/app.js` is untouched. It is how §3 is proven on a real library, not only on the tests'
fakes, and it answers the user without screenshots.

## 7. Where it reaches

All of it is Rouen's server and screens: Docker's test image; the Rouen app, which shows the Docker Rouen's screens,
with no app update; Rouen Lite, which carries the same server, on `test-lite`. In the same version on all three.

## 8. Code and builds

- `lib/smart-picks/seeds.js` (new, under 500 lines, `// @ts-check`): scoring (§3.1–3.2), balance (§3.3), tuning
  (§5), the why (§6); `lib/smart-picks/input.js` gathers what it scores from what index.js holds.
  `libraryArtistProfile` and `smartPickSeeds` are replaced by them (2.0.6-t22), and the candidates' helpers
  (`collectSmartCandidates`, `rankSmartCandidates`, `diversifySmartCandidates`, `smartPickExcluded`,
  `smartPickReason`) move unchanged into `lib/smart-picks/rank.js`; `index.js`'s length baseline is ratcheted down in
  the same commit.
- `public/smart-picks-tune.js` (new): the Tune sheet; `public/smart-picks-why.js` (new): Why these picks.
- As built (2.0.7-t1): `lib/smart-picks/tune.js` holds what a Tune is and what each control does; `seeds.js` takes the
  window and the factors, `rank.js` the Adventure. Tune's routes are in `lib/routes/smart-picks-actions.js`, with Rebuild
  and "Not for me", moved out of `index.js` unchanged.
- **Builds, in order:** `listening.md` (what counts as a play, everywhere); then §3 and §6; then §5; profiles
  (`profiles.md`) after, carrying all of it per profile.

## 9. Tests

Each written first, failing, and broken on purpose once:

- The user's case: a library whose plays are mostly classical and jazz album plays, plus "Greatest Hits" by four
  pop artists sharing one title and one play: the seeds are mostly classical and jazz; no pop artist is a seed
  through a title it shares.
- Three tracks sampled from a pick, ten times over: that artist is not a seed.
- Bach with fifty album plays: a seed, at a quarter.
- Genres 40/25/35: seed slots about 10/6/8; a genre at 5% has one even where its share rounds to none; 1% has none.
- Every Tune control moves the seeds as §5 says; Reset puts them back.

## 10. Open

None. The numbers (90 days, a tenth, a quarter, the square root, 5%) are this design's: they are shown in Why these
picks, so they can be judged on a real library and changed here.

## 11. The album found and added through Roon (2.0.8-t9)

The owner (2026-11-26), after a day with no picks because Rouen's own Qobuz sign-in had lapsed: "How can we avoid
having to rely on Qobuz being logged in or used. With native mode can we replace this."

Until 2.0.8-t9 a pick's album came from Qobuz's or TIDAL's own catalogue search with Rouen's sign-in
(`resolveSmartAlbum`), and the destination "library" made it a favourite there (`autoAddSmartAlbum`). With neither
signed in the day's build was skipped and marked tried, so nothing came until the next day even once one was.

**With native mode in use** (its library read, `stage1.js` `active`), Roon does both, with your server's own sign-in
to TIDAL and Qobuz:

1. **Found.** Your server's own search (`Library::UnifiedSearch`, `find.js`, proven for an album's title and artist
   since v1.9.32) is asked for the candidate artist's name, and read whole as `find.js` reads any search. The album:
   the first of its albums in Roon's order (top results, top album, then the album list) that is **credited to that
   artist** (the same `canonArtist` the candidates are keyed by), **not in the library**, and **on TIDAL or Qobuz with
   an `AlbumId`**. A search for an artist's name alone was never probed (`roon-suggestions.md` §4 stays on hold): each
   build logs how many candidates Roon's search found an album for, of those it asked, so a search that never finds
   an artist's albums shows in the log.
2. **Kept as a pick** under Roon's title, its service (the source Roon gave), **no service album id** (Roon's
   `AlbumId` is not the service's: a tap, Listen later and an add find it by title and artist, as each already does
   for an album without one), and a cover from Deezer's album search by title and artist, else none. Roon's own
   cover key for a catalogue album doesn't load (`native-remote.md` §12.17, still open); Deezer is the gap-filler
   Discover already uses for covers, and only for the picture.
3. **Added** (destination "library"): through "Add to library" (`library-add.js`), for the pick's profile's Roon
   profile (`profiles.asRoonOf`, as Listen later's put is): your server's own add, else, when native mode can't send
   it, the service favourite with Rouen's sign-in where there is one. A profile with no Roon profile to add as (one
   whose Roon profile was deleted): the service favourite, as before 2.0.8-t9, where Rouen is signed in and the album
   has the service's id; a Roon-found album, which has none, is left to be added by hand. A service that answers "too
   many requests" stops the build, as before.

**Native mode not in use, or its search can't answer** (not connected, the connection with too little room left —
`find.js` `noRoom` — or the search refused or cut short): Rouen's own Qobuz and TIDAL search, as before, where signed
in. A search that answered with nothing is kept a week as a miss, as before; one that couldn't answer is not kept.
Roon's misses are kept apart from the services' (`alb-roon:`): a miss of Roon's must not stop Rouen's own Qobuz,
signed in later, from being asked. Why Roon's search didn't answer is said once a build, not once a candidate.

**Neither:** the build is skipped, said once a day in the log, and **not marked tried**: it runs at the next check
(every ten minutes after the hour) once native mode or a service is up, the same day; no build job is started
meanwhile. Native mode counts only until ten of its searches have answered with no TIDAL or Qobuz album at all (a
server with its own files only), said once in the log. **A build in which nothing answered** for any candidate tried
(every search refused: no room, not connected, a sign-in failing) is neither kept nor marked tried either: today's
picks, if any, stay, and the next check builds again. An answer kept from before counts as answered. `GET /api/smart-picks`'s
`service_ready` is true while native mode is in use, so the screens no longer ask for Qobuz or TIDAL to be connected
then. A pick with no service album id says `added: null` (not asked), as a pick does when its service couldn't be.

**Cost.** Each search leaves what it sent on native mode's connection (`find.js` §9.1): at most 40 a profile a day
(`smartMaxResolves`, unchanged), the misses cached a week, and none once the connection is short of room.

**Code.** `lib/smart-picks/resolve.js` (new, `// @ts-check`): the album found (Roon, then Qobuz, then TIDAL) and
added, moved out of `index.js` (`resolveSmartAlbum`, `autoAddSmartAlbum`, `smartPicksServiceReady`), whose length
baseline is ratcheted down in the same commit. `find.js` gains `albumsBy(name)`: one search for a name, in its turn,
its albums as found.

**Tests** (each written first, failing, and broken on purpose once): with native mode in use and no service signed
in, a candidate's album comes from Roon's search: the first credited to the artist, not in the library, on a service
with an `AlbumId`, its service the source Roon gave and no service id; an album in the library, by another artist, or
without an `AlbumId` is passed over; Roon unable to answer falls to Rouen's Qobuz search, and nothing is cached; Roon
answering nothing is cached; with neither, the build is skipped and not marked tried; the add goes through Add to
library for the pick's profile; `service_ready` is true with native mode in use.

**2.0.8-t10 (the owner, 2026-11-26, on the first picks Roon found).**

- **Opening a pick:** Roon's search found nothing for "Pink Flag (2006 Remastered Version) Wire", yet found the album
  for "Pink Flag Wire". The album view's search (`lib/provider/public/album-search.js`) asks again without a trailing
  edition in brackets when the whole title finds nothing. The album taken is still matched against the whole title
  first, as Roon titles it.
- **Covers:** Deezer is asked for the title without that edition, and an album matches with or without it: Roon's
  "Pink Flag (2006 Remastered Version)" is Deezer's "Pink Flag". A Roon-found album kept without a cover (2.0.8-t9's
  picks) gets one on its next find. A service's own album keeps the picture its service gave.
- **Rebuild and Tune run now**, beside the background queue, not behind it: after a restart the queue held the genre
  walk for about twenty minutes while the Rebuild's toast said a minute. As the household, as the queue's jobs run; a
  failure is said as theirs are. The scheduled and post-sync builds stay in the queue.

**2.0.8-t11 (the owner, 2026-11-27: "Need to normalise the search. Remove things like 25th edition etc and then it finds
it").** The Chameleons' "Script Of The Bridge - 25th Anniversary Edition": Roon's search for it with its edition found
another artist's "25th Anniversary Edition" and not theirs, and Deezer had no cover by that title. A title's edition is
now taken off as `lib/album-edition.js` says, the same two rules the library is keyed by: a bracketed chunk at the end,
and a dash and what follows it when that names an edition ("Selected Ambient Works - Volume II" stays), as often as
either is there. The album view's search and the cover's both use it; the album found is still matched against the
whole title first. And on a phone a pick's text stays beside its cover, whatever the title's length: it had asked for
its whole width and, wrapping allowed, dropped under the cover. Smart Picks' card styles moved out of `style.css`
into `public/picks.css`, unchanged but for that.

