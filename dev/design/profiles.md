# Profiles — design

Status: **§13 (profiles are Roon's, both ways) designed 2026-11-26; P3-probe built in 2.0.8-t1; the release held for it.** Earlier: **designed 2026-11-26 from the owner's decisions (§1, §9, §10); P1a built in 2.0.7-t2, P1b's Smart Picks in 2.0.7-t3, P2 in 2.0.7-t4, Listen later per profile in 2.0.7-t5 (§11, §12).** This document is the
specification for the work it describes: code matches it, or this document changes first, in the same commit
(`CLAUDE.md`, "Spec authority"). It builds on `login.md` (the one
account), `listening.md` (what counts as a play) and `smart-picks.md` (seeds and tuning), and on
`native-remote.md` §8.4 (Roon's profiles, as native mode reads them).

## 1. The owner's words (2026-11-26)

> "I am likely to add profiles within Rouen so maybe this is a good time to add profiles (is there a way to link
> these profiles to the profiles within Roon? … make profiles better than Roon)"

> "Currently Rouen has the option to create an account which is a global account. Profiles would be selectable from
> within the Rouen UI. Each profile would then have the capacity to record that profile's listening habits etc and
> suggest smart picks etc based on that individual profile user's listening. Profiles would be selectable from the
> side menu with a profile icon towards the top."

and, asked: **a play started outside Rouen counts for the zone's profile** (§4).

## 2. What a profile is

- **People under the one account.** The account (`login.md`) still guards all of Rouen; a profile is who is
  listening, not a login. No password per profile.
- **A profile:** a name, an avatar (an initial on a colour, or a picture), and optionally **its Roon profile** (§5).
- **Each device has its profile,** kept on the device like the login, chosen from the side menu (§6). A device that
  has never chosen is on the first profile.
- **The first profile** is made when this version first starts, named after the account, and holds everything Rouen
  has kept so far: every play, Smart Picks, Listen later, the tuning. A household of one sees no change.

## 3. What is a profile's own, and what is shared

| A profile's own | Shared by everyone |
|---|---|
| Its listening: track plays and album plays (`listening.md`), so its play counts, Last played sort, Home's "not played", stats, Recently played (its own plays and those that counted for no one, §10.1) | The library, the zones, the queue history (it is the zone's) |
| Smart Picks: seeds, Tune, the day's picks, "Not for me", the artists already shown (`smart-picks.md`) | Rouen's settings, other than Tune and the profile's own (§2) |
| The share card's "artists you play" (in P1b, §10.7) | The account and the logins; Discover, built from everyone's listening (§10.2) |
| Through its Roon profile (§5): hearts, add to library, Roon's Listen later | Roon's own library and its other profiles' data; Roon's playlists (§10.17) |
| Listen later: the albums it put aside (§12) | Listen later's albums no profile put aside: everything there before 2.0.7-t5, and what Roon's own app or Guest adds (§12) |

## 4. Whose listening a play is

Each play (`listening.md` §4) is written with a profile, or none:

1. **Started from Rouen:** when a device starts something on a zone (an album, a track, a playlist, Radio, Play from
   here), that zone's listening counts for the device's profile **until another device starts something there, or
   the zone has played nothing for 30 minutes**.
2. **Otherwise, the zone's profile** (the owner, 2026-11-26): each zone's settings gain **"Listening here counts
   for"**: a profile, or no one. A zone's profile is the first profile until someone changes it, so nothing changes
   for a household of one.
3. **No one:** the play is still in Recently played and the queue history, and counts for nobody's play counts or
   picks.

**Guest** (§9.1) is a profile whose listening always counts for no one.

## 5. Linking a Rouen profile to a Roon profile

Native mode already reads your server's profiles by name (`native-remote.md` §8.4) and acts for one, chosen in
Settings → Native mode. With profiles:

- **Each Rouen profile can link one Roon profile** (Settings → Profiles → the profile → Roon profile), offered when
  the server has more than one. The choice in Settings → Native mode stays: it is what the library is read for, what
  the household's own work in Roon is done for, and what a profile with no link acts as (§10.14).
- **What a device does in Roon as its own, it does for its profile's Roon profile:** hearts, add to library and
  Roon's Listen later. **Roon's playlists stay the household's** (§10.17): listed, made and played for the Native mode
  choice on every device, as are the Dynamic Playlists and Rouen's playlists moved onto Roon's. Plays go through the
  public extension API or carry the Native mode choice: Roon counts them as it counts any extension's.
- **A profile with no link, and Guest,** act for the Roon profile chosen in Settings → Native mode, as before
  profiles (§10.14). Native mode off: Rouen's own hearts and Listen later, as before.
- **Roon's own play counts are not read.** How Roon counts a play is not known, and its per-profile play data has
  never been read (`PlayInfo`, unread in every probe). Rouen's count is the 95% rule (`listening.md`), the same on
  every profile.

## 6. What it looks like

- **The side menu:** at its top, the profile's avatar and name. A tap opens the list of profiles; choosing one
  switches this device, and Home, Smart Picks and the play counts redraw for it. "Manage profiles" opens Settings →
  Profiles.
- **Settings → Profiles:** add, rename, avatar, its Roon profile (native mode on), remove (§9.3). Guest is always
  in the list, cannot be removed or renamed, and has no Roon profile.
- **A zone's settings:** "Listening here counts for", on Settings → Audio Devices → the zone's page, whether native mode
  is on or off (§10.3).
- At phone width, the menu's avatar row is one line, 44 px tall, the name cut short with an ellipsis.

## 7. Better than Roon

- **Listening that is real:** 95% of a track, a whole album in one sitting (`listening.md`). Roon's count is not known
  to make that difference.
- **Plays from anywhere count for someone:** the zone's profile, for what Roon's own app or a schedule starts.
- **Picks you can steer and see:** Tune and Why these picks, per profile (`smart-picks.md` §5–6).
- **Guest** (§9.1): listening that counts for no one (visitors, a party, an evening of sampling).

## 8. Code, data and builds

- A `profiles` table (id, name, avatar, roon_profile, made); `profile` columns on `plays`, `album_plays` and the Smart
  Picks tables; Tune kept per profile. Existing rows: the first profile. Backups carry them; a restore keeps them.
- `lib/profiles/` (new modules, under 500 lines each, `// @ts-check`): the store, attribution (§4), the routes.
  `public/profiles.js` (new): the menu's picker and Settings → Profiles. Nothing appended to `index.js` or
  `public/app.js`.
- Each request carries the device's profile (a cookie beside the login's). A device whose profile was removed is on
  the first profile.
- **Builds:** after `listening.md` and `smart-picks.md`: P1, profiles, the picker and attribution (§2–4, §6); P2, the
  Roon link (§5); Guest in P1. New UI, settings persistence and native mode's writes: the
  multi-agent review (`dev/lessons.md`).

## 9. The owner's answers (2026-11-26)

1. **Guest: yes.** Built in, always in the side menu's list; anything played while a device is on Guest, or on a zone
   whose "Listening here counts for" is Guest, counts for no one. It has no Smart Picks of its own.
2. **"That was me": not now.** Plays are not moved between profiles after the fact; added later if wrong attribution
   turns out to matter.
3. **Removing a profile moves its listening** (plays, album plays) to a profile chosen at the removal; its picks, Tune
   and "Not for me" go with it. The first profile can be removed only while another exists.
4. **No PIN.** The account guards Rouen; a profile is who is listening, not a lock.

## 10. The owner's answers, the second round (2026-11-26)

1. **Recently played is the profile's own:** its plays, and the plays that counted for no one (Guest, a zone that
   counts for no one). Everyone's plays are still in the queue history, which is the zone's.
2. **Discover stays one build, from everyone's listening.** Smart Picks is the one made for each profile.
3. **"Listening here counts for" is on the zone's Audio Devices page,** always shown. Rouen keeps it by Roon's zone id
   (with the zone's name, to show it when the zone is gone).
4. **In steps, each tried on the owner's box before the next:**
   - **P1a:** profiles, the side menu's picker, Guest, Settings → Profiles (add, rename, colour, remove with its
     listening moved), each play written for a profile (§4), and the play counts, Last played, Home's rows and
     Recently played read for the device's profile.
   - **P1b:** Smart Picks, Tune, "Not for me", the artists already shown and Rouen's own Listen later, per profile.
   - **P2:** the Roon profile link (§5).

5. **Guest's plays shape nothing:** "everyone's" listening (Discover, Radio's "not played in 30 days", Smart Picks
   until P1b, the share card until P1b, Listen later's "played through") is every profile's, never no one's.
6. **Backups carry the profiles:** names, colours, which is first, and each zone's "Listening here counts for"; never
   their plays (play history is never in a backup).
7. **The share card's "artists you play" goes per profile in P1b,** with Smart Picks.
8. **Settings → Profiles sits after Audio Devices,** and Radio's "not played in 30 days" stays the household's.
9. **"Send each day's picks to" Library applies to every profile's picks** (the owner, 2026-11-26: "Every profile's"):
   each profile's five are favourited. One setting for the household, as before.
10. **Only active profiles get a daily build** ("Active ones"): the first, and every profile with plays, or chosen on a
    device, in the last 30 days. A profile nobody uses costs no lookups.
11. **P1b in two builds:** Smart Picks, Tune, "Not for me", the artists already shown, Why these picks and the share
    card first (2.0.7-t3); Rouen's own Listen later after (2.0.7-t4), as it reaches into most screens.
12. **Guest shows nothing personal** (the owner, 2026-11-26): no Smart Picks, no Why these picks, and share-card
    suggestions from nobody's listening; showing the first profile's would show a visitor that person's listening.
13. **Removing a profile, as built** (the owner, 2026-11-26, settling §9.3's "its picks, Tune and 'Not for me' go with
    it"): its "Not for me" moves; its picks of the day go (the other profile has its own five); its Tune moves only to a
    profile that never tuned, otherwise the other keeps its own.

14. **A profile with no link, and Guest, act as the Native mode choice** (the owner, 2026-11-26, "Act as the first's":
    "Use the Roon profile chosen in Settings → Native mode, as today. Nothing stops working for a profile not yet
    linked"), replacing §5's first wording, under which hearts and Roon's Listen later waited until a link was made.
15. **The server's profiles' hearts come from the same read** (the owner, 2026-11-26, "Yes, from the same read"): an
    album's `IsFavorite` carries every Roon profile's value, so the one library read gives each profile's hearts; a
    read that can't say leaves them unsaid, never guessed. Shown on a one-profile server only so far.
16. **P2 before Rouen's own Listen later per profile** (the owner, 2026-11-26, "Go to P2"): P2 is 2.0.7-t4, and §10.11's
    Listen later moves to 2.0.7-t5. The owner's server has one Roon profile ("Just one"), so P2 is shown there to
    change nothing; the two-profile paths are the fake Core's evidence only.
17. **Roon's playlists are the household's** (the owner, 2026-11-26, "The household's": "Playlists stay as today on
    every device: the Native mode choice's Roon profile. P2 then links hearts, add to library and Roon's Listen later
    only. Nothing is hidden from anyone"), replacing §5's first wording ("the playlists it makes, and the playlists it
    plays"). In Roon each playlist belongs to one profile, so a device listing its own profile's would not see the
    Dynamic Playlists and Rouen playlists moved onto the Native mode choice's.
18. **Listen later per profile: Roon's list, tagged** (the owner, 2026-11-26, "Roon's list, tagged": "Roon's Listen
    later stays the one store, so Roon's app still shows everything. Rouen remembers which profile put each album
    there, and each profile sees its own"); **albums no profile put aside are everyone's** ("Every profile": "They're
    the household's: every profile sees them until one of them takes the album off or plays it through"); **Guest sees
    the shared ones, and what it puts aside is shared** ("The shared ones").
19. **Played through hides, never writes to Roon** (the owner, 2026-11-26, "Hide it, keep Roon's"): an album a profile
    put aside and played through leaves that profile's Listen later in Rouen, and stays on Roon's list, as only a
    removal by hand writes to Roon (`native-remote.md` §10.4). Shared albums are as today: off Rouen's own list once
    played through, never off Roon's.

## 11. As built

### P1a (2.0.7-t2)

- **Store** (`lib/profiles/store.js`): `profiles` (id, name, colour, made, roon_profile), `zone_profiles` (zone id,
  its name, a profile's id or `guest`) and `profiles_meta`, in the history database beside the plays. The first
  profile is made at the first start of 2.0.7-t2, named after the account (or "Me" with accounts off, or before the
  one-time account choice; it can be renamed). The first stands for the plays kept before profiles (`profile` NULL),
  every zone not given one and every device that hasn't chosen; removing it hands that role to the profile its plays
  go to. Names are 1–40 characters, unique ignoring case, never "Guest";
  the avatar is the name's initial on one of eight colours (a picture is not built).
- **A play's profile:** `plays` gains a `profile` column; `album_plays` had one. A profile's id, `''` for no one (Guest,
  a zone counting for no one), NULL before profiles. The scrobbler writes it when a track begins, the album run when
  the run is settled (`lib/profiles/attribution.js`, §4). "Played nothing for 30 minutes" is measured from the zone's
  last report of playing: paused or stopped half an hour, it forgets who started it, whoever resumes it.
- **Started from Rouen:** the play routes (`lib/profiles/routes.js` PLAY_ROUTES: albums, tracks, playlists, Radio
  switched on, Play from here, Versions, streaming, Transfer) claim their zone for the device's profile **before** they
  act, so the first track is already its own (some answer only once the zone shows the track), and give it back when
  they refuse (400, 401, 403, 404, 503). Queueing ("Queue", "Play next", the queue history's routes) claims nothing:
  it adds to the listener's queue. Shortcuts (Siri, the home screen's) carry no profile and claim nothing: what they
  start counts for the zone's own. A removed profile is forgotten wherever it held a zone.
- **Each device's profile:** a cookie, `rouen_profile`, a year, set by `POST /api/profiles/current`; none, or a removed
  profile, is the first. Every request runs with it (`lib/profiles/context.js`, an AsyncLocalStorage), and the reads
  made for a screen ask for it: the play counts and Last played (and the Library view's cache, keyed by it), Home's
  "not played" and its six months' gate, the library's "played" filters, Pick unheard, the album of the day's "played
  today", and Recently played (its own and no one's, §10.1). Everyone's, as before: Discover, Radio's "not played in
  30 days" (the household's radio), Listen later's "played through" (until 2.0.7-t5); the share card's taste and Smart
  Picks were too until P1b (below); Listen later's "played through" is per profile since 2.0.7-t5 (§12).
- **Guest** reads only what counted for no one; it has no Smart Picks (P1b: none shown at all, §10.12).
- **Screens** (`public/profiles.js`): the side menu's row under its head (44 px, the name cut with an ellipsis), the
  picker ("Who's listening?", the profiles and Guest, Manage profiles); choosing reloads the page, Home's kept rows
  dropped first. Settings → Profiles, after Audio Devices: rename, colour, remove (its plays moved to a profile chosen
  there), Add; Guest listed. Audio Devices → a zone: "Listening here counts for", native mode on or off.
- **Removing** moves the profile's plays and album plays (and, for the first, the plays before profiles) and its zones
  to the chosen profile, in one transaction. The last profile can't be removed.
- **Backups** (`lib/backup.js`, the "profiles" part, §10.6): restoring puts each profile back under its own id (the
  plays name them by it) and keeps a profile made since; a name a kept profile has taken meanwhile gets " (restored)";
  the zones' settings are the backup's. Unlike the other parts it adds rather than replaces, so no plays are left
  naming no profile.
- **An album played** is whose its tracks were (the zone's latest track row of that album), not whoever holds the zone
  when its run settles.
- **On Guest** the side menu's row says "Guest · plays count for no one", so empty play counts don't read as loss.
- **Not built in P1a:** P1b, P2 (the Roon link), a picture as avatar. A zone's setting is kept by Roon's zone id
  (§10.3): grouping or ungrouping makes a new zone, which counts for the first profile until set.

### P1b, Smart Picks (2.0.7-t3)

- **Tables** (`lib/smart-picks/tables.js`, moved out of index.js's schema): `smart_picks`, `smart_pick_seen` and
  `smart_pick_blocks` keyed by profile too, `profile` with no default (a write that forgets it fails). An install from
  before is made again once, its rows the first profile's, and the last Why these picks becomes the first's.
- **The build** goes through the active profiles (§10.10) one after another, each with its own seeds (its plays), its
  Tune, its "Not for me" and artists already shown, its picks and its Why these picks (`why:<profile>`); a profile that
  has today's set, or was tried today (`built:<day>:<profile>`), is left alone; one profile's failure stops no other's
  (`lib/smart-picks/daily.js`). A profile first chosen after the day's build gets its set at the next timer tick or
  when its device asks. A Rebuild, a Tune change and a "Not for me" are the device's profile's, and a Tune change
  or Rebuild builds that profile only. Picks go to the library or Listen later for every profile as the one setting
  says (§10.9); each profile's on its own Listen later since 2.0.7-t5 (§12), where a Rebuild and a "Not for me" take
  only that profile's picks off.
- **Tune** is kept per profile (settings `smartPicksTunes`); the one Tune kept before profiles becomes the first's
  once, and the old setting goes.
- **Guest** (§10.12): no picks (the Smart Picks screen says to choose a profile; Home's row is hidden), no Why these
  picks, its Tune, Rebuild and "Not for me" refused with those words, and the share card's suggestions from nobody's
  listening (Deezer's order).
- **The share card's "artists you play"** is the device's profile's, each profile's graph built once a day when first
  asked for (`lib/smart-picks/daily.js`).
- **A removed profile:** its "Not for me" and artists shown go to the profile chosen (where that one has the same, its
  own is kept), its picks of the day go, and its Tune goes to the chosen profile when that one was never tuned.
- **Active** is kept by a `seen` time on each profile, written at most once an hour when a device reads as it.
- **Each active profile adds its own lookups** (MusicBrainz, ListenBrainz, Qobuz or TIDAL) to the daily build, and a
  Rebuild waits for a build under way to end.

### P2, the Roon link (2.0.7-t4)

- **The link** (`lib/profiles/store.js` `setRoon`, the routes' `roonProfile`): one Roon profile per Rouen profile, or
  none; only one of the server's profiles as native mode last read them (refused otherwise, and refused with native
  mode not in use); taking a link off always works; a refused change writes nothing. Backups carry it, no link
  included; a backup from before links keeps the link a profile has.
- **Settings → Profiles** shows "Roon profile" under each profile when the server has two or more: "As in Settings →
  Native mode (its name)" first, then the server's profiles; a link the server no longer has shows as "Not on your
  server now: as in Native mode". With one, or native mode not in use, nothing is shown.
- **Where a device acts as its own** (`lib/profiles/index.js` `DEVICE_ROUTES`): only in its hearts, add to library and
  Listen later routes, and the album view, Shelf and Smart Picks that show them; there the device's link is carried by the request
  (`lib/profiles/context.js`). Nothing else a request sets going acts for it.
- **Whom those act for** (`lib/roon-direct/stage1.js` `actingFor`): the device's link, when the server has that profile
  and more than one, and a choice is made in Settings → Native mode (with none, hearts wait for it, as before);
  otherwise the Native mode choice. A one-profile server runs exactly as before, whatever is linked. Only hearts, add
  to library and Roon's Listen later take it (`services.js`); everything else is the Native mode choice's.
- **Always the Native mode choice:** the library read, search, playlists (§10.17), every background job (`index.js`
  `bgRun` runs each as the household's, whichever request queued it), and the moves onto Roon's of Rouen's own Listen
  later, Dynamic Playlists and playlists (`asHousehold`: run outside the request that set them going). Smart Picks
  sent to Listen later went on the Native mode choice's Roon list; since 2.0.7-t5, a linked profile's go on its own (§12).
- **Hearts:** the read keeps every profile's value (`favBy`, from the same `IsFavorite`); the Native mode choice's is
  still `favorite`. A heart for another profile is kept and checked by the next read against that profile's value, and
  a heart set in Roon's app for any profile shows at once (one Rouen set, shown back, is not counted as made elsewhere;
  two reads are compared by which profiles have the heart, not by how they are written). The Shelf's hearts and its
  favourites count are the asking device's, and its last answer is kept for each Roon profile.
- **Roon's Listen later** is read and kept per Roon profile (`lib/roon-direct/later.js`), so one device's list never
  stands in for another's; a linked device's is read the first time its album view asks (the household's is kept read
  by the route's timer, as before).

## 12. Listen later per profile (2.0.7-t5)

From the owner's answers (§10.18, §10.19). The list itself stays where it is: Roon's own with native mode in use, Rouen's
own otherwise, and Rouen's own moved onto Roon's as before (`native-remote.md` §10.4). What is added is **whose** each
album is.

- **A tag** (`listen_later_owners`): an album's key (Rouen's album key, its library album's when the library has it,
  else its own; as written for a title Rouen's key can't name), Roon's AlbumId when Roon's list gave it, the profile
  that put it aside, when, and whether that profile has played it through. A profile's id, or `''` for "shared" (put
  aside on Guest).
- **Who sees an album** (the Listen later screen, Home's row, the album view's button, Smart Picks' "on Listen later"):
  - **no tag**, or a shared tag: everyone, Guest included (everything on the list before 2.0.7-t5, and what Roon's own
    app adds);
  - otherwise, each profile whose tag it has, not played through. Guest sees only the first kind.
  - An album found on Roon's list by its AlbumId or by its key is the same album. One whose tag can't be matched to
    an entry (a catalogue album Roon names otherwise) shows as no one's, so it is never hidden from the one who put it
    aside.
- **Putting an album aside** tags it for the device's profile (`''` on Guest), and puts it on the list if it isn't
  there yet. Already there for someone else: only the tag is added; nothing is sent to Roon. Put aside again after
  playing it through: shown again.
- **Taking it off by hand:**
  - shared (no tag, or a shared tag): off the list for everyone, as today;
  - another profile also has it (its tag, not played through): only this profile's tag goes, and it stays on the list
    for the others;
  - otherwise: off the list, and its tags go.
- **Played through** (`listening.md`: an album play, counted for the profile): that profile's tag is marked played
  through, and the album leaves its Listen later in Rouen. It stays on Roon's list (§10.19); on Rouen's own list, it
  is taken off once no one sees it any more (no tag left that isn't played through), and its tags with it. Shared
  albums: as today (off Rouen's own list once any profile has played it through since it was put there, never off
  Roon's, where they stay shown): the owner's choice in §10.19 ("Shared albums (no profile) stay as today") settles
  §10.18's "until one of them … plays it through" for Roon's list. Guest's plays change nothing (§10.5).
- **Smart Picks sent to Listen later** are tagged for the profile whose picks they are ("picks"; one put aside again
  by hand stays a pick). A discarded day's picks (Rebuild) and "Not for me" hide only that profile's tags, as played
  through does, so a pick it turned down is shown to no one rather than becoming everyone's; an album leaves Rouen's
  own list only when no other profile has it; Roon's list is never changed by them (`native-remote.md` §10.4).
- **A profile removed:** its tags go to the profile its listening moves to (where that one already has the album,
  its own tag is kept, and shown again if the removed profile still wanted it).
- **Tidy-up:** after each whole read of the household's Roon list, tags of albums on neither list go (taken off in
  Roon's own app): put back there, the album is everyone's. A removal Roon's list didn't take keeps the tags.
- **A restore** leaves out tags naming a profile the install hasn't (another install's, or one removed since).
- **Backups** carry the tags with the Listen later list (the "later" part).
- **Linked devices (§5):** a device linked to another Roon profile reads and changes that profile's Roon list, which
  is its own already: tags are the household's list's, and a linked profile's Smart Picks go on its own Roon list.

### Listen later per profile, as built (2.0.7-t5)

- **Tags** (`lib/listen-later/owners.js`, `listen_later_owners`): key, profile (`''` shared), Roon's AlbumId when known,
  title, artist, source (`picks` or `album`), when, and played through. An album's key is its library album's when the
  library has it (`tagKey`), so the routes and the store name it alike.
- **The routes** (`lib/routes/listen-later.js`) filter the list, the album view's and Smart Picks' "on Listen later" by
  the asking device's profile (`viewer`); put aside when already on Roon's list, only the tag is written; taken off
  while another profile has it, only the tag goes; a removal that fails keeps the tags.
- **The store** (`lib/listen-later/store.js`, moved out of `index.js` unchanged first): "played through" checks the
  profile's own tags against its own plays (`albumPlayedSince` for that profile); "Not for me" and a discarded day hide
  the profile's own pick tags, on Roon's list too, and take an entry off Rouen's own list only when no one else has
  it. The household's entries keep the rules from before.
- **Smart Picks' puts** carry the profile whose build it is; a removed profile's tags move with its listening
  (`movers`); the backup's "later" part carries `laterTags`, and one from before restores none, keeping those there are.
- `lib/roon-direct/later.js` gives the matching entry (`entryOf`), the list as last read (`entries`) and the AlbumId a
  change was sent for.
- **The review:**
  - A tag keeps the album's own key beside its library key, so a pick still matches once the library has it.
  - Put aside again, a pick stays a pick.
  - A removal Roon's list didn't take keeps the tags.
  - One sent and not shown is tagged, as Roon may hold it.
  - After each whole read of the household's Roon list, tags of albums on neither list go, so an album put back in
    Roon's own app is everyone's; an entry leaving Rouen's own list takes its tags with it.
  - A restore leaves out tags naming a profile the install hasn't.
- **Linked devices (§5):** a device acting for a Roon profile of its own reads its own list, which is that profile's
  already: no tags are written or read there. A linked profile's Smart Picks go on its own Roon list
  (`profiles.asRoonOf`), untagged.


## 13. Profiles are Roon's, both ways (the owner, 2026-11-26, the third round)

**Status: designed; P3-probe built (2.0.8-t1).** 2.0.7 is held for it (the owner: "Hold 2.0.7"; "I haven't merged dev
in to main yet. Make these changes before"): no `dev` → `main` merge and nothing marked Latest until these builds are in
and the owner has tried them. Versions on `dev` only count up (`dev/release.md`) and `dev` was already 2.0.7, so these
builds are 2.0.8-tN, and the release that carries them is 2.0.8, with 2.0.7 in it as 2.0.6 is in 2.0.7. Once built, this section replaces §3's
"Through its Roon profile" and the playlists row, §5's "A profile with no link, and Guest", §10.14 and §10.17.

### 13.1 The owner's words

> "I hearted an album under Me and then selected Test profile and the album shows hearted under that profile. This
> is wrong behaviour. If Roon profiles are meant to come through they don't, I added test123 in Roon. … Each profile
> should only show their own hearted albums, playlists, play history, smart/dynamic playlists etc."

and, asked:

1. **Hearts:** "Link each one". A profile shows only its own Roon profile's hearts; none is ever borrowed.
2. **Roon's profiles and Rouen's:** "I want Roon profiles to show up in Rouen. I want Rouen created profiles to show
   in Roon. Two way".
3. **Playlists:** "All playlists are individual. If I create a playlist I could share it with other profiles. If l
   make a playlist and keep it just to my profile, it only shows for me." A shared playlist is **play only** for the
   others: only its maker changes it.
4. **New Roon profiles sooner:** a "Read Roon's profiles again" button.
5. **Guest:** "None". No hearts, no add to library, no Roon Listen later, no playlists; it browses and plays.
6. **Me and Test** (profiles made before this): **"Pair once"**. A one-time screen pairs each Rouen profile with a
   Roon profile; one left unpaired is created in Roon under its name. Plays, picks, Tune and Listen later stay with
   each Rouen profile.
7. **Removing a profile in Rouen:** "Rouen only". It leaves Rouen as today (§9.3, its listening moved); the Roon
   profile stays in Roon, whose own app deletes it.

### 13.2 What the user sees

- **The side menu's list is Roon's profiles, plus Guest.** Each Roon profile is a Rouen profile, paired by its
  ProfileId. One added in Roon appears after the next read of the server's profiles: at connect, at the nightly
  reconnect, or on **Settings → Profiles → "Read Roon's profiles again"** (one reconnect, as the nightly one).
- **Add a profile in Rouen** creates it in Roon (`Account::CreateProfile`, its name), and it is paired at once.
  **Rename** in Rouen renames it in Roon (`Profile::Edit`). A rename made in Roon shows in Rouen at the next read.
  The avatar's colour stays Rouen's.
- **Each profile's own, through its Roon profile:** hearts, add to library, Roon's Listen later, and its playlists
  and Dynamic Playlists (13.4). With no Roon profile (Guest, or a profile whose creation in Roon hasn't been
  confirmed), none of these are offered, and the page says why; nothing falls back to another profile's.
- **Native mode is not tied to a profile** (the owner, 2026-11-26: "Native mode is not tied to any profile. It's on,
  simple as that"; "I don't want this profile selector here for favourites"): Settings → Native mode's "Whose
  favourites" is gone, with its route. What still names a Roon profile on the wire without being anyone's (the library
  read, search, every background job) goes as the Roon profile paired with Rouen's first profile, else the server's
  first; never shown, and never where a heart, an add, Listen later or a playlist is written.
- **The pairing screen** shows once, at the first start of this build, when a Rouen profile has no Roon profile. Each
  Rouen profile gets a menu of the server's Roon profiles not yet paired, or "Create in Roon". Nothing is written
  until it is confirmed. Until then, those profiles have no hearts or playlists (as Guest).

### 13.3 Removing

As today (§9.3) in Rouen: the listening moves to a profile chosen at the removal. The pairing goes; the Roon profile
is not touched.

**A Roon profile deleted in Roon's own app** (asked, not yet answered; built the way that loses nothing, until the owner
says otherwise): the Rouen profile stays, with its listening, shown "Not in Roon now", and with no hearts, add, Listen
later or playlists until it is paired again (13.2's pairing) or created in Roon (P3b). The other way proposed, that it
leaves Rouen's list with its listening moved to the first profile, is one change away.

### 13.4 Playlists, each profile's own

- **A profile lists its own Roon profile's playlists** (`Playlist::Profile`), and the playlists shared with it.
- **Made in Rouen:** made for the device's Roon profile; Rouen's Dynamic Playlists too, each made for its maker's.
- **Sharing is Rouen's setting** (Roon's playlists have one owner and no sharing): the playlist's ⋯ gets "Share with
  other profiles", on or off, kept by Rouen by Roon's PlaylistId. A shared playlist is shown to every profile but
  Guest, and plays for all of them; only its owner's devices offer edit, rename, delete and "Add to playlist" for
  it. In Roon's own app, playlists show as Roon shows them.
- **The playlists and Dynamic Playlists already on Roon stay their owner's** (the Native mode choice, the owner's main
  profile), unshared, until shared from Rouen.

### 13.5 The protocol, method by method (`roon-native.md`)

| What | Call | Evidence |
|---|---|---|
| The server's profiles, names | the root graph's `Profile` objects (`ProfileId`, `Name`) | proven (§5) |
| Read them again | the link's reconnect, as the nightly one | proven (`link.js`) |
| Create a profile | `Account::CreateProfile(ProfileCreate { Name, … }, ResultCallback<Profile>)` | **proven** (P3-probe, 2026-11-26) |
| Rename it | `Profile::Edit(ProfileEdit { Name, … }, ResultCallback)` | **proven** (P3-probe, 2026-11-26) |
| Whose a playlist is | `Playlist::Profile`, on the root graph's playlists | absent on all 9 of the owner's: kept by Rouen instead (P3c) |
| A playlist made for a profile | `Playlists::CreatePlaylist(Profile, …)`, `CreatePlaylistFromParameters` | proven for the Native mode choice; another profile's to be shown |

`Profile::Delete` is not used (13.1, 7). `Playlists::SetProfile` is not used.

### 13.6 Builds, in order, each tried on the owner's server before the next

1. **P3-probe** (by hand, `GET /api/debug/roon-profile-probe?run=1`, as the playlist-edit trial; built in 2.0.8-t1,
   `lib/roon-direct/profile-probe.js`, waiting for the owner's run): first, read-only, the server's profiles and how
   many of the graph's playlists belong to each, by profile id; then it creates a profile named "Rouen probe" and the
   time, reads it back, renames it, and reports each step. The probe's profile is left for the owner to delete in Roon
   (Rouen never deletes one), and the answer names it from the moment it exists. A second run within ten minutes is
   refused, so a link followed again makes no second profile. **Run on the owner's server, 2026-11-26 19:45:**
   `Account::CreateProfile` answered Success and its Profile arrived, named as asked and on the Account's own list;
   `Profile::Edit` answered Success and the new name read back. **Both proven** (`roon-native.md`). The server's 9
   playlists name no profile (`Playlist::Profile` absent on every one; MENZIES 0, test123 0): Roon keeps no owner for
   them here, so P3c keeps each playlist's owner in Rouen, by Roon's PlaylistId.
2. **P3a, nothing new from Roon** (built in 2.0.8-t2): "Read Roon's profiles again"; each Roon profile shown as a Rouen
   profile; the pairing, pairing only (no creation); Settings → Native mode's "Whose favourites" gone; Guest and
   unpaired profiles with no hearts, add or Roon Listen later. Their playlists are P3c's, with everyone's.
3. **P3b, after the probe** (built in 2.0.8-t3): create and rename in Roon; the pairing screen's "Create in Roon".
4. **P3c:** playlists and Dynamic Playlists per profile, Guest's none, and sharing (13.4). How it lists another profile's
   playlists follows the probe's playlist report.

New UI, settings persistence and Roon's private protocol: each build gets the multi-agent review (`dev/lessons.md`).

### P3a, as built (2.0.8-t2)

- **Nobody** (`lib/roon-direct/session.js` `NOBODY`): what a device on Guest, or on a profile paired with none, acts as in
  its own routes (`lib/profiles/index.js` middleware, `asRoonOf`). `profileFor`/`profileObjectFor` give none for it, so
  nothing falls back to the server's first; hearts (`heartsOff`, `heartOf`), adds (`adder.js`) and Roon's Listen later
  (`later.js`, `listen-later.js`) are refused for it, with `WHY_NOBODY`. A pairing your server no longer has acts as
  nobody too (`stage1.js` `actingFor`).
- **The household's Roon profile** (`session.js` `household`, set by `lib/profiles`): Rouen's first profile's pairing.
  The library read, search and background work go as it; none paired, as the server's first, and the household's
  writes (playlists, Dynamic Playlists, Listen later's move) on a server of several wait with `WHY_HOUSEHOLD`. The
  read's own hearts are the profile it was read as (`readAs`): a pairing changed later needs no read again, every
  profile's hearts coming with it (§10.15).
- **Settings → Native mode** has no "Whose favourites"; `POST /api/roon-direct/profile` and `setProfile` are gone. The
  choice saved before is carried once to Rouen's first profile (2.0.8-t6, the owner, 2026-11-26: "Unable to heart
  albums", every profile left unpaired by the update): `roon-sync.js` `carry`, the first time a device's own route or
  Settings → Profiles asks, when the first profile has none and no other has that one; remembered (`profiles_meta`
  `roon_choice_carried`), so a first profile unpaired by hand stays so. A profile with no Roon profile shows the album's
  heart dimmed, a tap saying why (`album-actions.js`).
- **The update itself** (the owner, 2026-11-26: "When this ships as a latest version and people update I need it to pull
  through their Roon profiles and have them named accordingly in Rouen"): with no choice saved (a server of one Roon
  profile never had one), the first profile is paired with the server's first, as native mode acted then; decided only
  once the server's profiles are read. It takes that Roon profile's name unless it was renamed in Rouen (its name
  still the one it was made with: the account's, or "Me"). Every Rouen profile then paired, the sync adds Roon's others
  under their own names (13.2). An install updated from 2.0.5 opens on Roon's profiles, named as in Roon, the first
  holding every play kept before; each other starts its plays from the update (Roon's own play counts are not read, §5).
- **Pairing and Roon's profiles in Rouen** (`lib/profiles/roon-sync.js`): one-to-one, checked before anything is
  written; once every Rouen profile is paired, `GET /api/profiles` adds each Roon profile no one is paired with,
  numbered when its name is taken; one removed from Rouen is remembered (`profiles_meta` `roon_removed`) and not added
  back until a profile is paired with it again; one gone from the server is "gone", kept.
- **Settings → Profiles:** the pairing note while a profile has none; each profile's Roon profile whenever native mode
  is in use (a server of one included), offering only those not paired elsewhere; "Not in Roon now"; "Read Roon's
  profiles again" (`POST /api/profiles/roon-reread`, one reconnect).
- **The review** (code-review, high): a device with none puts nothing aside, on Rouen's own list either (it would be moved
  onto the household's), and adds nothing by a service favourite in its place (`routes/listen-later.js`, `library-add.js`);
  it asks for no read of Roon's list (`later.js`). `readAs` follows only a read that succeeds, and a read as another Roon
  profile starts hearts awaiting a read again (`marks.reset`). `roonProfiles().chosen` stays the household's, for
  index.js's Listen later tags. A Roon profile whose name Rouen can't take is added as "<name> (Roon)" or "Roon profile",
  one that can't be added at all is said in the log, and the page never fails for it; a removal refused hides nothing.

### P3b, as built (2.0.8-t3)

- **Made in Roon** (`lib/roon-direct/profile-write.js` `create`): `Account::CreateProfile` with the name, believed when its
  Profile arrives; **renamed** (`rename`): `Profile::Edit`, believed when the Name reads back; a rename to the name it has
  sends nothing. Refused, not sent back or not shown: said, never believed.
- **Roon's profiles as they are now** (`session.js` `liveProfiles`): the Account's own list when the connection holds it,
  else the root's as read at connect. `stage1.js` keeps the root's list up with it, so a profile made in Rouen or in
  Roon's app is a device's own at once, and no write for it falls back to the server's first.
- **Settings → Profiles:** Add makes the profile in Roon first (its name checked by Rouen before), then in Rouen, paired;
  Roon refusing it, nothing is added. Native mode not in use: made in Rouen only, paired later. A rename of a paired
  profile goes to Roon first; refused there, nothing changes. A profile with no Roon profile (or one gone) is offered
  "Create in Roon as "<its name>"" beside the server's unpaired profiles.
