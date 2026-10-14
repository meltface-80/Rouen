// @ts-check
"use strict";
/*
 * login-routes.js — which requests need Rouen's password (dev/design/login.md
 * §1.2, §3). The owner, 2026-10-14: settings and the library, not playing.
 *
 *   guarded  settings, API keys and sign-ins, backups, the update, Roon direct,
 *            plugins and their settings (HQPlayer's), Rouen's label database,
 *            writes to a streaming account (Qobuz and TIDAL favourites), the
 *            debug routes, and a backup's download (it holds the keys).
 *   open     playing, transport, volume, queue, grouping and transfer, radio,
 *            shuffle and repeat (/api/zone-settings is those), rescans, and
 *            Rouen's own lists (playlists, Smart Playlists, Listen Later,
 *            Smart Picks, Discover, shared links); the login's own routes,
 *            which check the password themselves.
 *
 * Every route that is not a GET must be named in one list or the other: a
 * test reads every route index.js and lib/ mount and fails on one that is
 * neither. A request that is somehow in neither is guarded unless it is a GET
 * (guard below), so a route added without thought is safe by default.
 *
 * A path is compared as Express routes it (v1.9.22, the review): letter case
 * ignored, a trailing slash and doubled slashes ignored; and HEAD is a GET.
 * Otherwise "/API/backups/x/download/" would miss the guarded entry, fall to
 * an open unknown GET, and still reach the download.
 *
 * Methods: "GET", "WRITE" (any but GET and HEAD), "ANY".
 */

/** @typedef {"guarded" | "open" | "unknown"} Verdict */

/** [method, path] — guarded. @type {Array<[string, RegExp]>} */
const GUARDED = [
  ["WRITE", /^\/api\/settings\//],
  ["WRITE", /^\/api\/backups(\/upload|\/[^/]+|\/[^/]+\/restore)?$/],
  ["GET", /^\/api\/backups\/[^/]+\/download$/],
  ["POST", /^\/api\/update\/apply$/],
  ["WRITE", /^\/api\/plugins\/[^/]+$/],
  ["POST", /^\/api\/roon-direct$/],
  ["WRITE", /^\/api\/hqp(\/|$)/],
  ["WRITE", /^\/api\/labels\/(merge(\/[^/]+)?|logo|rescan|rescan-force)$/],
  ["POST", /^\/api\/(qobuz|tidal)\/(favorite|unfavorite)$/],
  ["WRITE", /^\/api\/qobuz\/oauth\/(disconnect|paste)$/],
  // The sign-in's start and its return: the return stores whatever account
  // the code it carries belongs to, so it is guarded like the paste.
  ["GET", /^\/api\/qobuz\/oauth\/(start|callback)$/],
  ["ANY", /^\/api\/debug\//],
];

/** [method, path] — open to anyone who can reach Rouen. @type {Array<[string, RegExp]>} */
const OPEN = [
  ["POST", /^\/api\/(control|seek|volume|mute-all|pause-all|radio|zone-settings|transfer-zone|group-outputs|ungroup-outputs)$/],
  ["POST", /^\/api\/output\/(standby|convenience-switch)$/],
  ["POST", /^\/api\/(play|play-from-here|play-multi|play-track|play-unheard)$/],
  ["POST", /^\/api\/playlist\/(play|play-track)$/],
  ["POST", /^\/api\/queue\/(history-multi|play-history-next)$/],
  ["POST", /^\/api\/(reindex|library\/rescan)$/],
  ["POST", /^\/api\/(listen-later|smart-playlists|smart-playlists\/delete)$/],
  ["POST", /^\/api\/user-playlists(\/add|\/add-albums|\/delete)?$/],
  ["POST", /^\/api\/(discover\/rebuild|smart-picks\/rebuild|smart-picks\/block)$/],
  ["POST", /^\/api\/share\/(encode|import)$/],
  ["POST", /^\/api\/update\/check$/],
  ["POST", /^\/api\/(login|logout|login\/password|login\/password\/remove)$/],
];

/**
 * @param {Array<[string, RegExp]>} list @param {string} method  "GET" or another @param {string} path
 */
const inList = (list, method, path) => list.some(([m, re]) =>
  (m === "ANY" || m === method || (m === "WRITE" && method !== "GET")) && re.test(path));

/** As Express routes it: any case, doubled and trailing slashes ignored. @param {string} path */
const routed = (path) => String(path || "").toLowerCase().replace(/\/{2,}/g, "/").replace(/(.)\/+$/, "$1");
/** @param {string} method */
const methodOf = (method) => { const m = String(method || "").toUpperCase(); return m === "HEAD" ? "GET" : m; };

/**
 * @param {string} method  as Express gives it
 * @param {string} path    the request's path, no query
 * @returns {Verdict}
 */
function classify(method, path) {
  const m = methodOf(method), p = routed(path);
  if (inList(GUARDED, m, p)) return "guarded";
  if (inList(OPEN, m, p)) return "open";
  return "unknown";
}

/** Whether a request needs the password: guarded, or a non-GET that is in neither list. */
function needsLogin(/** @type {string} */ method, /** @type {string} */ path) {
  const v = classify(method, path);
  return v === "guarded" || (v === "unknown" && methodOf(method) !== "GET");
}

module.exports = { classify, needsLogin, GUARDED, OPEN };
