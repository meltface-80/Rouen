// @ts-check
"use strict";
/*
 * login-routes.js — which requests need Rouen's account (dev/design/login.md
 * §3). The owner, 2026-10-14 (v1.9.26): all of Rouen. Every request under
 * /api/, whatever its method, needs the account's login — the library, the
 * zones, playing, the settings — except the account's own four:
 *
 *   GET  /api/login          whether there is an account, and this device's login
 *   POST /api/login          a login
 *   POST /api/login/setup    the account made (only while there is none)
 *   POST /api/logout         a login ended
 *
 * The pages and their files (HTML, scripts, styles, icons) are not under
 * /api/ and stay open: they hold nothing of the user's, and iOS fetches a
 * home-screen icon without the page's cookie. A route mounted anywhere else
 * must be one of PAGES — a test reads every route index.js and lib/ mount and
 * fails on any other, so data cannot be served outside /api/ unnoticed.
 *
 * (v1.9.22 to v1.9.25 guarded settings and the library only, with a table of
 * guarded and open routes; that table went with the owner's change.)
 *
 * A path is compared as Express routes it: letter case ignored, a trailing
 * slash and doubled slashes ignored; and HEAD is a GET. Otherwise "/API/zones"
 * or "/api//zones/" would miss the prefix and still reach the route.
 */

/** The account's own routes: [method, path]. */
const OPEN = Object.freeze([
  ["GET", "/api/login"],
  ["POST", "/api/login"],
  ["POST", "/api/login/setup"],
  ["POST", "/api/logout"],
]);

/** Routes outside /api/ that serve a page, and nothing of the user's. */
const PAGES = Object.freeze(["/display", "/shelf"]);

/** As Express routes it: any case, doubled and trailing slashes ignored. @param {string} path */
const routed = (path) => String(path || "").toLowerCase().replace(/\/{2,}/g, "/").replace(/(.)\/+$/, "$1");
/** @param {string} method */
const methodOf = (method) => { const m = String(method || "").toUpperCase(); return m === "HEAD" ? "GET" : m; };

/**
 * Whether a request needs the account's login.
 * @param {string} method  as Express gives it
 * @param {string} path    the request's path, no query
 */
function needsLogin(method, path) {
  const m = methodOf(method), p = routed(path);
  if (p !== "/api" && !p.startsWith("/api/")) return false;
  return !OPEN.some(([om, op]) => om === m && op === p);
}

module.exports = { needsLogin, OPEN, PAGES, routed };
