// @ts-check
"use strict";
/*
 * settings.js — Rouen's settings, as stored (data/cache/settings.json).
 * Moved out of index.js unchanged in v1.9.22 (dev/quality.md's order, item 2).
 *
 *  - One object, read from disk once and kept: every reader holds the same
 *    object, and a save mutates it in place, so no reader is left with an old
 *    copy and no save reads before it writes.
 *  - `version` moves on every save, whichever device made it: one of the live
 *    revisions the screens follow (index.js's liveRevisions).
 *  - Frozen once a backup has been restored and the server is about to
 *    restart: a write from something still running on the old values (a token
 *    refresh, a Smart Picks run) would put back part of what the restore just
 *    replaced, so every write is refused.
 */
const nodeFs = require("node:fs");

/**
 * @param {{ file: string, dir: string, fs?: { readFileSync: Function, writeFileSync: Function, mkdirSync: Function, renameSync: Function },
 *           warn?: (line: string) => void, error?: (line: string, why: string) => void }} o
 */
function createSettingsStore(o) {
  const fs = o.fs || nodeFs;
  const warn = o.warn || ((line) => { console.warn(line); });
  const error = o.error || ((line, why) => { console.error(line, why); });
  /** @type {Record<string, any> | null} */
  let cache = null;
  let version = 0;
  let frozen = false;

  /** @returns {Record<string, any>} */
  function load() {
    if (cache) return cache;
    try {
      cache = JSON.parse(fs.readFileSync(o.file, "utf8")) || {};
    } catch (e) {
      cache = {};   // none saved yet, or unreadable: the defaults, and the next save writes a whole file
    }
    return /** @type {Record<string, any>} */ (cache);
  }

  /** @param {Record<string, any>} patch @returns {boolean} */
  function save(patch) {
    if (frozen) {
      warn("[settings] write refused — restarting after a restore");
      return false;
    }
    try {
      const cur = load();           // the cache after the first call — no disk read
      Object.assign(cur, patch);    // in place, so the cache stays the one object
      fs.mkdirSync(o.dir, { recursive: true });
      // Whole or not at all (v1.9.26, the review): a file cut short by a crash
      // reads as no settings, and since the account lives here that would hand
      // it to the next device to open Rouen.
      fs.writeFileSync(o.file + ".tmp", JSON.stringify(cur, null, 2));
      fs.renameSync(o.file + ".tmp", o.file);
      version++;
      return true;
    } catch (e) {
      error("[settings] save failed:", String(e && /** @type {any} */ (e).message));
      return false;
    }
  }

  return {
    load,
    save,
    /** Moves on every save (and on a restore, bump). */
    version: () => version,
    /** A restore replaced the whole file: the screens follow it. */
    bump() { version++; },
    /** No more writes: the server restarts on what is on disk now. */
    freeze() { frozen = true; },
    frozen: () => frozen,
  };
}

module.exports = { createSettingsStore };
