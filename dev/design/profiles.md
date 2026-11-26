# Profiles — design

Status: **designed 2026-11-26 from the owner's decisions (§1); not built; §9 open.** This document is the
specification for the work it describes: code matches it, or this document changes first, in the same commit
(`CLAUDE.md`, "Spec authority"). Nothing in §9 is built before the owner answers it. It builds on `login.md` (the one
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
| Its listening: track plays and album plays (`listening.md`), so its play counts, Last played sort, Home's "not played", stats, Recently played | The library, the zones, the queue history (it is the zone's) |
| Smart Picks: seeds, Tune, the day's picks, "Not for me", the artists already shown (`smart-picks.md`) | Rouen's settings, other than Tune and the profile's own (§2) |
| The share card's and Discover's "artists you play" | The account and the logins |
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

A **Guest** profile (§9.1) would be a profile whose listening always counts for no one.

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
- **Settings → Profiles:** add, rename, avatar, its Roon profile (native mode on), remove (§9.3).
- **A zone's settings:** "Listening here counts for".
- At phone width, the menu's avatar row is one line, 44 px tall, the name cut short with an ellipsis.

## 7. Better than Roon

- **Listening that is real:** 95% of a track, a whole album in one sitting (`listening.md`). Roon's count is not known
  to make that difference.
- **Plays from anywhere count for someone:** the zone's profile, for what Roon's own app or a schedule starts.
- **Picks you can steer and see:** Tune and Why these picks, per profile (`smart-picks.md` §5–6).
- Proposed, for the owner (§9.1–9.2): **Guest**, listening that counts for no one (visitors, a party, an evening of
  sampling); **"That was me"**, moving a stretch of plays from one profile to another after the fact.

## 8. Code, data and builds

- A `profiles` table (id, name, avatar, roon_profile, made); `profile` columns on `plays`, `album_plays` and the Smart
  Picks tables; Tune kept per profile. Existing rows: the first profile. Backups carry them; a restore keeps them.
- `lib/profiles/` (new modules, under 500 lines each, `// @ts-check`): the store, attribution (§4), the routes.
  `public/profiles.js` (new): the menu's picker and Settings → Profiles. Nothing appended to `index.js` or
  `public/app.js`.
- Each request carries the device's profile (a cookie beside the login's). A device whose profile was removed is on
  the first profile.
- **Builds:** after `listening.md` and `smart-picks.md`: P1, profiles, the picker and attribution (§2–4, §6); P2, the
  Roon link (§5); then whatever of §9 the owner chooses. New UI, settings persistence and native mode's writes: the
  multi-agent review (`dev/lessons.md`).

## 9. Open (for the owner)

1. **A Guest profile:** built in, listening never counted? Recommended.
2. **"That was me":** moving plays between profiles after the fact (from Recently played: a stretch, to a profile)?
3. **Removing a profile:** its listening deleted, or moved to another profile? Recommended: moved, to a profile
   chosen at the removal.
4. **A PIN per profile:** none is recommended (the account already guards Rouen; a profile is who is listening, not a
   lock). Say if one is wanted, for example so a child cannot switch to a parent's.
