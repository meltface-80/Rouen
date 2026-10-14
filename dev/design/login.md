# Login — design

Status: **decided by the owner 2026-10-14; built in v1.9.22.** This document is the specification for the
work it describes: code matches it, or this document changes first, in the same commit
(`CLAUDE.md`, "Spec authority").

## 1. Why, and the owner's decisions (2026-10-14)

Anyone who can reach port 3399 can drive Rouen: change its settings, read its API keys back
through a backup, restore a backup, run the one-tap update (`dev/quality.md`, "Security"). The
native remote is about to write to the Roon library itself — hearts, add to library, zone settings,
DSP (`dev/design/native-remote.md` §1.4–1.7) — and the rule since `roon-native.md` §7 is that the
login lands before the first write. The owner kept that rule on 2026-10-14, and chose what it
guards:

1. **The login comes first:** no write to the Core's library is built before it.
2. **It guards settings and the library, not playing.** As with Roon itself, anyone on the network
   can play, pause, skip, seek, change volume, queue, group and transfer zones. Settings, API keys,
   backups, the update, Roon direct, plugins, and every change to the Roon library or to a
   streaming account need the password.
3. **Each device logs in once and stays logged in.**

## 2. What the user sees

- **Off by default**, so every existing install keeps working exactly as before until a password
  is set. Off, nothing below applies.
- **Settings → System → Password:** set one (twice, at least 8 characters), change it (the current
  one first), or remove it (the current one first).
- **With a password set**, a guarded action from a device that has not logged in opens a small
  sheet: "Rouen's password", one field, Log in. Logged in, the action is retried; the device stays
  logged in (§3). Settings shows "Logged in on this device · Log out".
- **Forgotten password:** whoever runs the container can remove it — start it with
  `ROUEN_RESET_PASSWORD=1`; Rouen removes the password and every login at start and logs that it
  did. Nobody on the network can. Once for each value (`loginReset`, never backed up): Docker keeps
  `-e` in the container, so the restart after an update or a restore, with the variable still set,
  must not remove a password set since; Rouen logs that the variable can go. Forgotten again: a new
  value (`=2`).
- The wall display, Shelf's shared links and every read-only screen are unaffected.

## 3. How it works

- **The password** is kept only as a hash: `crypto.scrypt` with a random 16-byte salt, in
  `settings.json` (`login: { salt, hash, N, r, p, setAt }`), worked out off the event loop
  (`crypto.scrypt`, so a guess never holds up playback), compared in constant time
  (`crypto.timingSafeEqual`). A password that cannot be saved changes nothing, in memory either.
- **A login** is a random 32-byte token in an `HttpOnly`, `SameSite=Lax` cookie (`rouen_session`),
  `Path=/`, expiring after 400 days (the longest a browser keeps one); `Secure` only when the request
  came over HTTPS (Rouen is usually plain HTTP on a home network). The server keeps only each
  token's SHA-256, with when it was made, in `data/sessions.json`, so a restart keeps every device
  logged in. Changing or removing the password ends every login (the device that changed it stays
  logged in with the new one). `Lax`, not `Strict` (v1.9.22): a sign-in to Qobuz returns to Rouen
  from Qobuz's own page, and a `Strict` cookie is not sent on that return; `Lax` still keeps it off
  every request another site makes but a plain link.
- **Backups never hold the password** (`lib/backup.js` NEVER_KEYS): a restore never sets, changes or
  removes it.
- **Too many wrong passwords:** after 5 wrong in a minute from one address, that address waits a
  minute from the fifth, then starts afresh; each wait is logged. The current password asked by a
  change or a removal counts the same. Behind a reverse proxy every device is the proxy's address
  and shares the one count.
- **Guarded routes answer 401** (`{ error, login: true }`) to a request without a valid login; the
  client opens the sheet on that answer and retries the request once logged in. A backup's
  download is a link the browser follows, not a request the page makes: on a device not logged in,
  the sheet comes first and the link is followed after. A path is matched as Express routes it —
  any letter case, a trailing slash, HEAD as GET — so no spelling of a guarded route is open.
- **What is guarded** (§1.2): every route that changes settings, keys, sign-ins, backups, the
  update, Roon direct, plugins and their settings (HQPlayer included), Rouen's label database, and
  every route that writes to the Roon library or a streaming account (Qobuz and TIDAL favourites
  today; hearts, add to library, zone settings and DSP to come); every read that hands back a
  secret (a backup's download), the start of a Qobuz sign-in, and the debug routes. **Open:**
  playing, transport, volume, queue, grouping and transfer, radio, shuffle and repeat (today's
  `/api/zone-settings` is those three), rescans, checking for an update (installing one is
  guarded), and Rouen's own lists (its playlists, Smart Playlists, Listen Later until it moves to
  Roon's own, Smart Picks, Discover, shared links). The table is `lib/login-routes.js`.
- **Every write route is classified, as a gate:** a test lists each route that is not a GET — in
  `index.js` and in every module that mounts one — and fails on any that is neither in the guarded
  list nor the open list. A new route must be put in one before it can ship.
- **New code:** `lib/login.js` (the hash, the sessions, the limiter, the guard middleware),
  `lib/login-routes.js` (the table) and `public/login.js` (the sheet, Settings' Password section),
  each under 500 lines with its tests. `index.js` gains only the wiring: the settings persistence
  moves out of it in the same build (`dev/quality.md`'s order, item 2) to `lib/settings.js`. Settings
  → System moves out of `index.html` (at its length baseline) into `public/login.js`, unchanged,
  with the Password section added under Updates.

## 4. Not in this build

- HTTPS: Rouen stays plain HTTP on the home network; the cookie is `Secure` when HTTPS is used in
  front of it.
- Several users or per-user rights: one password for the install.
- The updater's checksum verification (`dev/quality.md`, "Verified updates"): its own build.
