// @ts-check
"use strict";
/*
 * playlist-edit-probe.js — the route of the playlist edit probe (2.0.4-t12, dev/design/playlist-edit.md §3), run by hand:
 *   GET /api/debug/roon-playlist-edit          says what a run does; touches nothing
 *   GET /api/debug/roon-playlist-edit?run=1    makes a trial playlist, moves and removes its items, deletes it
 */

/**
 * @param {any} app
 * @param {{ run(): Promise<any> } | null | undefined} probe  lib/roon-direct/playlist-edit-probe.js
 */
function mountPlaylistEditProbe(app, probe) {
  app.get("/api/debug/roon-playlist-edit", async (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    if (req.query.run !== "1") {
      return res.json({ ran: false, design: "dev/design/playlist-edit.md §3",
        how: "Add run=1: makes a playlist named \"Rouen edit trial <time>\" with two of your albums, moves its third track before " +
          "its first (MoveItems), removes its first (RemoveItems), reads it back after each, and deletes it. Nothing else is touched." });
    }
    if (!probe) return res.status(503).json({ error: "Native mode isn't available here." });
    try {
      const out = await probe.run();
      if (out && out.error && out.status) return res.status(out.status).json({ error: out.error });
      res.json(out);
    } catch (e) {
      res.status(500).json({ error: String((e && /** @type {any} */ (e).message) || e) });
    }
  });
}

module.exports = { mountPlaylistEditProbe };
