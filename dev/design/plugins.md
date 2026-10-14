# Plugins — design

Status: **written 2026-10-14 from the owner's request and answers (below); built in v1.9.19, not yet run on the owner's install.** This
document is the specification for the work it describes: code matches it, or this document changes
first, in the same commit (`CLAUDE.md`, "Spec authority").

## 1. Goal (the owner's words, 2026-10-14)

> I want hqpweb to be in a state that it's code is written so that it's like a plugin to Rouen.
> I want hqpweb to be an enabled/disabled feature in settings. Off by default for new installs,
> retain current state for existing. The top message needs to have a dismiss function. Tick in a
> box to never show again and a hide button. The settings page and toggle switch remains part of
> Rouen, but when toggled off, the whole page is blank as if the feature is never there and no
> background resources are to touch it. When on, the page shows all the settings etc and the
> hqpweb service can be used.

The owner's answers to the questions that followed (2026-10-14):

1. "Don't show this again" is remembered **on every device** — a Rouen setting, not the browser's.
2. Once the credit box is dismissed, a **small "Built on hqpweb" line with its link stays** on the
   HQPlayer page while the feature is on; the credit also stays in `lib/hqp/LICENSE`, the CHANGELOG
   and the release titles (`CLAUDE.md`).
3. Off, Settings → HQPlayer shows **only the switch** (and one line saying what turning it on
   does): no credit box, no side-menu entry, no HQPlayer code running.

HQPlayer control is the first plugin. Nothing here is specific to it except §5.

## 2. What a plugin is

A feature Rouen can be without. It has:

- **an id** (`hqplayer`) and a **display name** (`HQPlayer`);
- **a switch**, kept in Rouen's settings under a key of its own. Off unless that key is `true`, so a
  new install has it off and an existing one keeps what it had (for HQPlayer the key is the one it
  has used since v1.8.74, `hqpEnabled`: nothing is migrated);
- **a server part**: a service created only when the plugin is on, with routes under its own
  prefix (`/api/hqp`), and a `close()` that stops everything it started;
- **a client part**: scripts and a stylesheet of its own under `public/<id>/`, loaded only when the
  plugin is on.

Rouen keeps, for every plugin and whatever its state, only: the Settings list row, a Settings page
holding the switch, and the switch's two routes.

## 3. Server

`lib/plugins.js` — the plugin host:

- `GET /api/plugins` → `[{ id, name, enabled }]`, for the client's loader;
- `POST /api/plugins/:id { enabled }` → saves the switch and answers the new state. Either way a
  service held from before is `close()`d and dropped: off, nothing of it runs; on, the next request
  makes a fresh one from the settings as they are now. A plugin's `close()` stops what it started
  as switching it off from its own settings would (HQPlayer's drains: a change still being watched
  finishes, and is rolled back if it stopped playback);
- every request under a plugin's prefix is checked against the switch's setting first: off →
  **404** `{ error: "<name> is off" }`, before any of the plugin's code runs, and a service still
  held from before is `close()`d and dropped. So off, no route of it can open a connection or a
  timer.
- A plugin's service is created on the first request that finds it on; one that is off is never
  created (its module is still `require`d: loading code is not running it).

`index.js` registers the plugin and mounts the host; it holds nothing else of the plugin.

## 4. Client

`public/plugins.js` — the loader, loaded before `app.js` (it inserts the Settings rows, the pages
and the side-menu entries that `app.js` collects and binds when it starts, as `random-pick-sheet.js`
inserts its sheet):

- **Settings → Plugins** (the owner's idea, 2026-10-14: every plugin in one place, with more to
  come): a row in the Settings list, before Setup, and a page listing the plugins as Setup lists
  its pages. For each plugin it knows (a short table: id, name, icon, the one-line description,
  its scripts and stylesheet) it inserts its row on that page, and its own page holding only the
  switch and that line, whose Back returns to Plugins;
- it asks `GET /api/plugins` at start, and again each time Settings opens (another device may
  have flipped a switch). For a plugin that is on, it adds the stylesheet and the scripts (in
  order, each file once per page life; one that failed to load is asked for again next time); the
  last registers it with `RouenPlugins.register(id, api)`, and its `start()` is called;
- the switch: turning it on loads the files first and only then posts `POST /api/plugins/:id` —
  on and unable to load, it would be on for every device and working on none; turning it off posts,
  then calls the plugin's `stop()`: it ends its timers and hides its side-menu entry and its part
  of the Settings page (and shows Home if its screen was open), and nothing of it runs again until
  it is turned on;
- app.js tells it through `RouenPlugins` what it told the screen directly before: another screen
  took the grid (`leave`), back from a view that borrowed it (`resume`), Settings opened
  (`settingsOpened`), its side-menu entry tapped (`show`);
- a plugin reaches the rest of the app through `window.RouenHost` (the shared grid, the
  full-screen walls' entry ritual, the bottom sheet, the confirm dialog, the banner, the zone in
  use — listed beside it in `app.js`) and the `window.__` bridges the app already had (toasts,
  Home, a Settings page, the confirm dialog) — never by reaching into `app.js`'s closures.

## 5. HQPlayer as a plugin

- Server: `lib/hqp/` as it is; `lib/hqp/plugin.js` describes it to the host (id, name, prefix,
  setting key, how to create the service). The service's own `enabled` field is the same setting
  (`hqpEnabled`), so `POST /api/hqp/settings { enabled: false }` from a page built before v1.9.19
  turns the plugin off too; the page's switch is `POST /api/plugins/hqplayer`.
- Client: the HQPlayer screen, its Settings section and its side-menu entry move out of `app.js`
  and `index.html` into `public/hqp/*.js` (each under 500 lines, `// @ts-check`), and its CSS out of
  `style.css` into `public/hqp/hqp.css`, behaviour unchanged.
- **The credit box** at the top of the HQPlayer page, shown only while the plugin is on, gains a
  **Hide** button and a **"Don't show this again"** tickbox. Hide alone hides it until Rouen is next
  opened; with the box ticked it is saved (`hqpCreditHidden`, `POST /api/hqp/settings
  { credit_hidden: true }`) and hidden on every device. Hidden either way, one line stays under the
  switch: "Built on hqpweb, by statelycurmudgeon" with its link.

## 6. Testing

- The host: off → every prefixed route 404s and no service exists; on → created; off again →
  `close()`d (its poller stopped); the switch saved; a new install off, an existing `true` kept.
- The loader (DOM): off → no HQPlayer script requested, no `/api/hqp` request made, no side-menu
  entry, the page holds only the switch and its line; on → loaded, the page full, the menu entry
  there; on → off in one page life → the menu entry gone, the page back to the switch, no further
  `/api/hqp` request.
- The credit box: Hide; Hide with the box ticked saved and gone after a reload; the small line.
- The HQPlayer screen's existing DOM tests run unchanged against the moved code, with the plugin
  on (their stubs answer `/api/plugins`).
