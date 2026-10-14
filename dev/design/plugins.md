# Plugins — design

Status: **written 2026-10-14 from the owner's request and answers (below); built in v1.9.19.** This
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
- `POST /api/plugins/:id { enabled }` → turns it on (creates the service) or off (`close()`s it,
  then drops it), saves the switch, answers the new state;
- every request under a plugin's prefix while it is off → **404** `{ error: "<name> is off" }`,
  before any of the plugin's code runs. So off, no route of it can open a connection or a timer.
- At start, a plugin that is on is created; one that is off is not (its module is still `require`d:
  loading code is not running it).

`index.js` registers the plugin and mounts the host; it holds nothing else of the plugin.

## 4. Client

`public/plugins.js` — the loader, loaded before `app.js` (it inserts the Settings rows and pages
that `app.js` collects when it starts, as `roon-settings.js` does):

- for each plugin it knows (a short table: id, name, icon, the one-line description, its scripts
  and stylesheet), it inserts the Settings list row and a page holding only the switch and that
  line;
- it asks `GET /api/plugins` once at start. For a plugin that is on, it adds the stylesheet and
  the scripts (in order) to the page; each registers itself with `RouenPlugins.register(id, api)`;
- the switch posts `POST /api/plugins/:id`. Turned on: the files are loaded (once per page life)
  and the plugin's `start()` is called. Turned off: the plugin's `stop()` is called — it stops its
  timers, removes its side-menu entry and empties its part of the Settings page — and nothing of it
  runs again until it is turned on;
- a plugin reaches the rest of the app only through `window.RouenHost`, a small object `app.js`
  publishes (the shared grid, leaving other views, the top bar, toasts, the side menu) — never by
  reaching into `app.js`'s closures. What `RouenHost` holds is listed beside it in `app.js`.

## 5. HQPlayer as a plugin

- Server: `lib/hqp/` as it is; `lib/hqp/plugin.js` describes it to the host (id, name, prefix,
  setting key, how to create the service). Its own `enabled` field is no longer the switch: the
  host's is. `POST /api/hqp/settings { enabled }` is refused (the plugin is off when it would mean
  anything, and on when it would not) — the switch is `POST /api/plugins/hqplayer`.
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
