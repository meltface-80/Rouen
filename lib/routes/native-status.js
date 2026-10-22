// @ts-check
"use strict";
/*
 * native-status.js — the Native mode status board's route (v1.9.63, dev/design/native-remote.md §13).
 *
 *   GET /api/native/status   { rows: [{ id, name, light: "green" | "red" | "grey", line }] }
 *
 * It gathers what each feature keeps and the cheap reads the rows need (each module's own, cached), and writes
 * nothing; the rows are lib/roon-direct/health.js's. A read that throws is a red row of its own, never the board's end.
 */
const { boardRows } = require("../roon-direct/health");

/**
 * @param {{ get: Function }} app
 * @param {{ native: () => any, nativePlaylists: () => any, laterRows: () => number, smartRows: () => number,
 *           userRows: () => number, kick?: Array<() => void> }} d
 *   native: native mode (stage1); nativePlaylists: lib/playlists-native.js's; laterRows, smartRows, userRows: how many
 *   Listen Later albums, Dynamic Playlists and playlists Rouen still holds of its own; kick: the moves and the copy asked
 *   for, as the pane's status lines asked on every open before the board (§12.16)
 */
function mountNativeStatus(app, d) {
  /** A read, its throw said as the read's own failure. @template T @param {() => Promise<T>} fn @param {(why: string) => T} failed */
  const tried = async (fn, failed) => { try { return await fn(); } catch (e) { return failed(String(e && /** @type {any} */ (e).message)); } };

  app.get("/api/native/status", async (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    const n = d.native();
    const status = n.status();
    const on = !!(status.on && status.active);
    const np = d.nativePlaylists();
    // Each on its own: one that throws doesn't keep the others from their chance (the review), and is logged.
    if (on) {
      for (const k of d.kick || []) {
        try { k(); } catch (e) { console.error("[native-status] a move couldn't start: " + /** @type {any} */ (e).message); }
      }
    }
    const [laterRead, smartRead, plRead] = on ? await Promise.all([
      tried(() => n.listenLater.list(), (why) => ({ notRead: why })),
      tried(() => n.smart.list(), (why) => ({ notSent: why })),
      tried(() => np.list(), (why) => ({ available: /** @type {const} */ (false), why })),
    ]) : [null, null, null];
    res.json({ rows: boardRows({
      status,
      later: { read: laterRead, move: on ? n.listenLater.moveProgress() : null, rouen: d.laterRows() },
      smart: { read: smartRead, move: on ? n.smartMove.progress() : null, rouen: d.smartRows() },
      playlists: { read: plRead, copy: on ? np.copyProgress() : null, rouen: d.userRows() },
      add: n.adder.lastAdd(),
    }) });
  });
}

module.exports = { mountNativeStatus };
