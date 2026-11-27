// @ts-check
"use strict";
/*
 * lite.js — Rouen, or Rouen Lite (dev/design/rouen-lite.md §2.1, §3): the same server, told it runs inside the Android
 * APK by ROUEN_LITE=1 in its environment. Rouen Lite is an extension of its own in Roon (the owner, 2026-11-23): its own
 * extension_id and name, so it can run beside a Docker Rouen without the two fighting over one authorisation.
 *
 * Rouen's own extension_id never changes (CLAUDE.md): Roon keys an extension's authorisation on it, so a new one would
 * have every user enable Rouen again. test/unit/lite.test.js pins it.
 */

const ROUEN_ID = "com.musicd.roon.random-albums";
const LITE_ID = "com.musicd.roon.rouen-lite";

/** Whether this server is Rouen Lite. @param {Record<string, string | undefined>} [env] */
const isLite = (env = process.env) => env.ROUEN_LITE === "1";

/**
 * The extension as Roon is told it: its id, and the name it is shown by (with the version after it).
 * @param {Record<string, string | undefined>} [env]
 */
function identity(env = process.env) {
  return isLite(env) ? { extension_id: LITE_ID, name: "Rouen Lite" } : { extension_id: ROUEN_ID, name: "Rouen" };
}

module.exports = { identity, isLite, ROUEN_ID, LITE_ID };
