// @ts-check
"use strict";
/*
 * routes.js — the phone's hello (dev/design/android-app.md §4.10, §4.22). Every route needs Rouen's login, as every
 * route does (the app's WebView holds the cookie); nothing here opens a route.
 *
 *   POST /api/phone/hello   {device_id}   → {device_id, away, away_address}
 *
 * Since §4.22 (the owner, 2026-10-31) the phone is never a Roon zone: hello no longer starts a Squeezebox player for it,
 * and that player's routes (the commands long poll, state, audio, now playing, control, /api/debug/phones) went with
 * it. What hello still gives the app is the way to Rouen from away (§4.7): whether this hello came over the tailnet,
 * and Rouen's tailnet address, which the app keeps for when home does not answer. An app from before §4.22 also sends
 * its name and quality; they are no longer needed and are not read.
 */

const ID = /^[0-9a-f]{32}$/;

/**
 * @param {{ post: Function }} app
 * @param {{ away?: (req: any) => boolean, awayAddress?: () => string | null }} deps
 */
function mountPhone(app, deps) {
  app.post("/api/phone/hello", (/** @type {any} */ req, /** @type {any} */ res) => {
    const b = req.body || {};
    if (typeof b.device_id !== "string" || !ID.test(b.device_id)) {
      return res.status(400).json({ error: "device_id (32 hex), please" });
    }
    res.json({ device_id: b.device_id, away: deps.away ? deps.away(req) : false,
      away_address: deps.awayAddress ? deps.awayAddress() : null });
  });
}

module.exports = { mountPhone };
