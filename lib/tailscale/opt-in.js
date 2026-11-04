// @ts-check
"use strict";
/*
 * opt-in.js — whether Rouen's built-in Tailscale runs (dev/design/android-app.md §4.7, v2.0.1-t3).
 *
 * The owner, 2026-11-04, after a user's firewall showed Rouen 2.0 beta2 reaching Tailscale's control server, its log
 * server and its relays round the world, though they had never set up Away from home: it is off until it is wanted.
 * Until v2.0.1-t3 it was on unless switched off (Mandarin's default), so every install started the engine.
 *
 * On when its switch (the stored setting `tailscaleEnabled`) is on; off when it is off. Never set, it is on only for an
 * install that is signed in already (so nobody's Away from home stops working with the update) or that is given
 * TS_AUTHKEY to sign in by itself. Sign in, in Settings, switches it on (node.js login).
 */
const fs = require("node:fs");
const path = require("node:path");

/**
 * Whether the engine's state holds a signed-in profile: tsnet's FileStore, `tailscaled.state`, a JSON map of state
 * keys to base64 bytes, whose `_profiles` is the JSON map of login profiles; a profile signed in has its node's id.
 * An engine started and never signed in (NeedsLogin) has no such profile.
 * @param {string} dir  the engine's state directory @param {typeof fs} [fsx] @returns {boolean}
 */
function signedIn(dir, fsx = fs) {
  try {
    const state = JSON.parse(fsx.readFileSync(path.join(dir, "tailscaled.state"), "utf8"));
    const raw = state && state._profiles;
    if (typeof raw !== "string") return false;
    const profiles = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    return Object.values(profiles || {}).some((p) => !!(p && p.NodeID));
  } catch (e) {
    return false;   // no state yet, or one this cannot read: taken as never signed in, so it stays off until wanted
  }
}

/**
 * Whether it runs. @param {unknown} setting  the stored `tailscaleEnabled`
 * @param {{ dir: string, authKey?: string, fs?: typeof fs }} o @returns {boolean}
 */
function enabledFrom(setting, o) {
  if (setting === true || setting === false) return setting;
  return !!o.authKey || signedIn(o.dir, o.fs);
}

module.exports = { signedIn, enabledFrom };
