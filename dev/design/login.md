# Login — design

Status: **decided by the owner 2026-10-14; built in v1.9.22 as an optional password guarding settings
and the library; changed by the owner the same day to a mandatory account guarding all of Rouen
(§1.4–1.7), built in v1.9.26; made a one-time choice by the owner on 2026-10-20 (§5), built in
v1.9.32.** Where §1–§4 say the account is mandatory, §5 now decides whether there is one. This document is the specification for the work it describes: code
matches it, or this document changes first, in the same commit (`CLAUDE.md`, "Spec authority").

## 1. Why, and the owner's decisions (2026-10-14)

Anyone who can reach port 3399 could drive Rouen: change its settings, read its API keys back
through a backup, restore a backup, run the one-tap update (`dev/quality.md`, "Security"). The
native remote is about to write to the Roon library itself — hearts, add to library, zone settings,
DSP (`dev/design/native-remote.md` §1.4–1.7) — and the rule since `roon-native.md` §7 is that the
login lands before the first write. The owner kept that rule on 2026-10-14, and chose what it
guards:

1. **The login comes first:** no write to the Core's library is built before it.
2. ~~It guards settings and the library, not playing.~~ *(v1.9.22; replaced by 5.)*
3. **Each device logs in once and stays logged in.**

**Later the same day, after v1.9.22 shipped (the owner's words):**

> Upon initial setup of a new user, or next update a user must create an account. A username and
> password. Once done they have access to Rouen and Roon. If another person on the same network
> tries to access Rouen they'll be asked to login but can't as they don't have the account details.
> No, mandatory account creation and encrypted.

4. **An account: a username and a password.** One per install.
5. **It guards all of Rouen**, playing included: without the account's login a device sees the
   login screen and nothing else.
6. **Mandatory.** A new install, and an existing one at its first start after this update, has no
   way in until the account is made; it cannot be skipped. The first device to open Rouen makes it
   (the owner, 2026-10-14: "Yes, correct") — so it should be the owner's, straight after installing
   or updating.
7. **"Encrypted":** the password is never kept, only a salted scrypt hash of it (§3); what this
   does and does not cover is §4.

## 2. What the user sees

- **No account yet** (a new install, or the first start after this update): every page — the
  remote, the wall display, Shelf — shows one full-screen sheet, "Create Rouen's account":
  username, password, the password again, Create account. It cannot be closed. Made, the device is logged
  in and the page starts.
- **An install that had a v1.9.22 password:** the sheet asks for a username and **that password**
  (proof it is the owner's install, not the first device to arrive); the account is that username
  with that password. Without the password it cannot be made — the same as a forgotten one (below).
- **An account, this device not logged in:** the same sheet, "Log in to Rouen": username,
  password, Log in. It cannot be closed. Logged in, the page starts; the device stays logged in
  (§3).
- **Logged out on another device's change, or after 400 days:** the next request opens the login
  sheet over the page; logged in, the page starts again.
- **Settings → System → Account:** "Logged in as <name>"; change the password (the current one,
  the new one twice); change the username (the new one, and the current password); Log out. There
  is no "remove": the account is mandatory.
- **Forgotten password:** whoever runs the container can remove the account — start it with
  `ROUEN_RESET_PASSWORD=1`; Rouen removes the account and every login at start and logs that it
  did, and the next device to open Rouen makes a new one. Nobody on the network can. Once for each
  value (`loginReset`, never backed up): Docker keeps `-e` in the container, so the restart after an
  update or a restore, with the variable still set, must not remove an account made since; Rouen
  logs that the variable can go. Forgotten again: a new value (`=2`). `0`, `false`, `off` and `no`
  read as off and remove nothing; an account that cannot be removed (the settings not saved) is
  left as it was, and the log says so.

## 3. How it works

- **The account** is kept in `settings.json` as `login: { user, salt, hash, N, r, p, setAt }`: the
  username as typed (trimmed), and the password only as a hash — `crypto.scrypt` with a random 16-byte salt,
  worked out off the event loop (so a guess never holds up playback), compared in constant time
  (`crypto.timingSafeEqual`). A v1.9.22 `login` has no `user`: that is the legacy state of §2. An
  account that cannot be saved changes nothing, in memory either.
- **Usernames:** 1 to 64 characters once trimmed, no control characters; compared without regard
  to letter case (each side trimmed, NFC-normalised and lower-cased). Passwords: 8 to 256
  characters.
- **A login** is a random 32-byte token in an `HttpOnly`, `SameSite=Lax` cookie (`rouen_session`),
  `Path=/`, expiring after 400 days (the longest a browser keeps one); `Secure` only when the request
  came over HTTPS. The server keeps only each token's SHA-256, with when it was made, in
  `data/sessions.json`, so a restart keeps every device logged in. Changing the password ends every
  login (the device that changed it stays logged in); changing the username does not. `Lax`, not
  `Strict` (v1.9.22): a sign-in to Qobuz returns to Rouen from Qobuz's own page, and a `Strict`
  cookie is not sent on that return.
- **The settings are written whole or not at all** (a temporary file, then renamed, since v1.9.26):
  a file cut short by a crash would read as no settings — no account — and hand the install to the
  next device to open Rouen.
- **Backups never hold the account** (`lib/backup.js` NEVER_KEYS): a restore never makes, changes
  or removes it.
- **Too many wrong tries:** after 5 wrong in a minute from one address, that address waits a
  minute from the fifth, then starts afresh; each wait is logged. A try counts from the moment it
  is sent, not when its check ends, so a burst sent at once is held to the same five (v1.9.26, the
  review); at most two passwords are checked at once, from everyone, so a flood of guesses cannot
  hold up the rest of Rouen; and an IPv6 address counts as its /64, since a host on the home
  network can give itself as many addresses there as it likes. A login checked against a password
  changed meanwhile is not issued. A wrong username counts the same
  as a wrong password, and both get the same answer ("Wrong username or password."), so a guess
  does not learn which was wrong. The current password asked by a change, and the old password a
  legacy install's account is made with, count the same. Behind a reverse proxy every device is
  the proxy's address and shares the one count.
- **What is guarded: every request under `/api/`**, whatever its method, except the account's own
  four: `GET /api/login` (whether there is an account, and whether this device is logged in),
  `POST /api/login`, `POST /api/login/setup` (only while there is no account) and
  `POST /api/logout`. A path is matched as Express routes it — any letter case, a trailing or
  doubled slash, HEAD as GET — so no spelling of an `/api/` route is open.
- **What is not:** the pages and their files (HTML, scripts, styles, icons, `/display`, `/shelf`).
  They hold nothing of the user's — the library, the zones and the settings all come through
  `/api/` — and the icons must stay open: iOS fetches a home-screen icon without the page's cookie.
- **Guarded routes answer 401**: `{ error, setup: true }` while there is no account (or only a
  legacy one), `{ error, login: true }` when there is one and the request has no valid login. The
  page opens the matching sheet on either.
- **Plugins** mount under a prefix of their own; the host refuses one that is not `/api/<name>`, so a
  plugin cannot serve anything the login does not reach.
- **The gate, as a test:** a test lists every route `index.js` and `lib/` mount. Each is under
  `/api/` (guarded), one of the account's four, or a page in the list of open pages; any other
  fails it, so a route that would serve data outside `/api/` cannot ship unnoticed.
- **The page:** `public/login.js`, loaded on all three pages before any script that asks `/api/`, asks `GET /api/login` and
  shows the sheet when the answer says so; it wraps `fetch`, so a 401 from any screen opens it too.
  The sheet carries its own styles (the wall display and Shelf do not load `style.css`), added to
  the body, never to `<head>` (`dev/lessons.md`). Once the account is made or the login accepted,
  the page reloads, so every screen starts logged in. An answer that says neither — no account
  field at all, or no answer — shows nothing.
- **Code:** `lib/login.js` (the account, the hash, the sessions, the limiter, the guard),
  `lib/login-routes.js` (what is guarded), `public/login.js` (the sheet, Settings' Account
  section), each under 500 lines with its tests.

## 4. Not in this build, and what "encrypted" covers

- **Stored:** the password is never stored, in any form that can be turned back into it — only its
  salted scrypt hash. The logins are stored only as SHA-256 hashes of their tokens.
- **In transit:** Rouen is plain HTTP on the home network, as it has always been. The password
  crosses the network unencrypted when it is typed (once per device), and the login cookie with
  every request. Anyone able to watch the home network's traffic could read them. HTTPS would
  close that, at the cost of a certificate every device must be told to trust (a self-signed one
  shows a warning, and iOS home-screen apps are particular about it): a build of its own, if the
  owner wants it. The cookie is already `Secure` when Rouen is put behind an HTTPS reverse proxy.
- **Roon itself:** the account guards Rouen. Roon's own apps, and anything else that talks to the
  Roon Core directly, are not affected.
- Several accounts or per-account rights: one account per install.
- The updater's checksum verification (`dev/quality.md`, "Verified updates"): its own build.

## 5. Opt-in: the one-time choice (the owner, 2026-10-20; built in v1.9.32)

The owner, after users objected to the mandatory account: *"I want opt in for user accounts for new
installs and as part of next update. I want opt in for Native Mode for new users and for next
update. … I want users to choose what they have or don't have. One selected as a new user or next
update becomes permanent and only undone by fully uninstalling."* And, asked: fully uninstalling is
removing the container **and its data volume**; every existing install is asked once, accounts
included; native mode chosen stays switchable in Settings (*"the option is permanent but the toggle
switch remains to flipflop between old and native"*).

### 5.1 What the user sees

- **A new install, or the first start after this update:** every page shows one full-screen
  sheet, "Choose how Rouen works", that cannot be closed or skipped. Two questions, each answered
  yes or no, nothing pre-ticked:
  1. **User accounts.** Yes: a username and password, and only people who have them can use Rouen.
     No: anyone who can reach Rouen on the network can use it, as before v1.9.26.
  2. **Native mode**, with its notice (unofficial, not affiliated with the server's makers, may
     break with a server update, at your own risk — the Settings page's notice, shortened). Yes:
     native mode is on, and its Settings switch stays to turn it off and on again. No: native mode,
     and hearts with it, are never offered.
  And a box to tick, "I understand these can't be changed later without removing Rouen and its
  data, and installing it again." Save is offered only when both are answered and the box is
  ticked.
- **Accounts: yes, and none made yet** (a new install): the account sheet of §2 follows at once.
- **An install that has an account** (every install that ran v1.9.26 to v1.9.31): the device
  must **log in first** — the choice is the account owner's, never the first device on the network
  to arrive — then sees the sheet. Choosing no removes the account and ends every login.
- **An install with a v1.9.22 password only** (legacy, §2): the sheet asks for that password too.
- **Afterwards, for ever:** the sheet never appears again and nothing in Rouen changes the
  answers. Settings shows them (System → Choices: "User accounts: on" or "off", "Native mode:
  chosen" or "not chosen") with one line saying how to start again: remove Rouen's container and
  its data volume, then install it again. Accounts off: no Account section, no login sheet.
  Native mode not chosen: no Native mode page in Settings.

### 5.2 How it works

- **Kept** in `settings.json` as `choices: { accounts, native, at, version }`, written once, by
  `POST /api/choices` alone; a second answers 409. **Never in a backup** (`lib/backup.js`
  NEVER_KEYS): a restore cannot make, change or remove the choice. Removing the data volume removes
  it, with every other setting.
- **Until it is made, every guarded request answers 401** `{ choose: true }` — or, on an install
  with an account, `{ login: true }` until this device logs in. Open: the account's four routes of
  §3, and `GET`/`POST /api/choices`. `GET /api/choices` says whether it is made, the answers when
  they are, and whether this device must log in (or give the legacy password) first.
- **`POST /api/choices { accounts, native, understood, current? }`:** both booleans and
  `understood: true`, or 400. With an account: this device logged in, or 401. With a legacy
  password: `current` must be it (the limiter of §3 counts it). The answers, and with "no accounts"
  the account removed, are saved in one write, or nothing changes; then, with "no accounts", every
  login ends. Native mode is told last: chosen, it is turned on (at once if Rouen is paired, else at
  the first pairing, which then reads without the after-an-update check); not chosen, it is turned
  off and can never be turned on (`POST /api/roon-direct {on: true}` answers 409, and a native mode
  that was on is switched off at every start, as its switch would). Chosen on an install where it is
  on already, it is left as it is, its after-an-update check included; chosen where Rouen cannot
  turn it on (paired, but its server's address unknown), it stays off with that reason in Settings
  → Native mode, whose switch turns it on once it can be (the review).
- **Accounts off:** the guard lets every request through; `GET /api/login` says `accounts: false`;
  `POST /api/login/setup` answers 409; `ROUEN_RESET_PASSWORD` logs that there is no account to
  remove.
- **The page:** `public/login.js` asks `GET /api/choices` first and shows the choice sheet when it
  is not made (after the login sheet, on an install with an account); a 401 `{ choose: true }` from
  any screen opens it too (it says `legacy`, so the sheet asks for a v1.9.22 password whichever
  answer arrives first). Once saved, the page reloads; a page whose sheet is up on another device
  asks every 3 s and reloads once the choice is made, and one whose login is refused because the
  choice was "no accounts" reloads too (the review).
- **Code:** `lib/choices.js` (the choice, its guard around the login's, its two routes);
  `lib/roon-direct/stage1.js` told whether native mode was chosen; `public/login.js` the sheet and
  Settings' Choices section.
