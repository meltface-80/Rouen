# Profiles — design

Status: **designed 2026-11-26 from the owner's decisions (§1, §9); not built.** This document is the
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
| The share card's "artists you play" | The account and the logins; Discover, built from everyone's listening (§10.2) |
| Through its Roon profile (§5): hearts, add to library, Listen later, playlists it makes | Roon's own library and its other profiles' data |

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

- **Each Rouen profile can link one Roon profile** (Settings → Profiles → the profile → Roon profile). The choice in
  Settings → Native mode becomes the first profile's link.
- **What a device does in Roon, it does for its profile's Roon profile:** hearts, add to library, Listen later, the
  playlists it makes, and the playlists it plays through native mode (`Transport::PlayPlaylist` carries a profile,
  `native-remote.md` §12.3). Every other play Rouen starts goes through the public extension API, which carries no
  profile: Roon counts those as it counts any extension's.
- **A profile with no link,** or native mode off: hearts and Roon's Listen later wait, as they do today when no
  profile is chosen; Rouen's own Listen later is kept for the profile.
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
  today", and Recently played (its own and no one's, §10.1). Everyone's, as before: Discover, the share card's taste,
  Smart Picks (P1b), Radio's "not played in 30 days" (the household's radio), Listen later's "played through".
- **Guest** reads only what counted for no one; it has no Smart Picks.
- **Screens** (`public/profiles.js`): the side menu's row under its head (44 px, the name cut with an ellipsis), the
  picker ("Who's listening?", the profiles and Guest, Manage profiles); choosing reloads the page, Home's kept rows
  dropped first. Settings → Profiles, after Audio Devices: rename, colour, remove (its plays moved to a profile chosen
  there), Add; Guest listed. Audio Devices → a zone: "Listening here counts for", native mode on or off.
- **Removing** moves the profile's plays and album plays (and, for the first, the plays before profiles) and its zones
  to the chosen profile, in one transaction. The last profile can't be removed.
- **Not built in P1a:** P1b (Smart Picks, Tune, Listen later per profile), P2 (the Roon link), a picture as avatar.
