// @ts-check
"use strict";
/*
 * smart-picks-why.js — GET /api/smart-picks/why: Why these picks (dev/design/smart-picks.md §6, 2.0.6-t22). The last
 * build's seeds by genre, each with its score and what it came from, and the artists that could not be seeds and why
 * (lib/smart-picks/seeds.js whyOf), as the build kept it; { why: null } before the first build of this version.
 */

/**
 * @param {{ get: Function }} app
 * @param {{ why: () => any }} deps  why: the last build's, or null
 */
function mountSmartPicksWhy(app, deps) {
  app.get("/api/smart-picks/why", (/** @type {any} */ _req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    res.json({ why: deps.why() || null });
  });
}

module.exports = { mountSmartPicksWhy };
