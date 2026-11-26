// @ts-check
"use strict";
/*
 * profile-probe.js — the route of the profile probe (P3-probe, dev/design/profiles.md §13.6), run by hand:
 *   GET /api/debug/roon-profile-probe          says what a run does; touches nothing
 *   GET /api/debug/roon-profile-probe?run=1    makes a Roon profile "Rouen probe <time>", renames it and deletes it
 */

/**
 * @param {any} app
 * @param {{ run(): Promise<any> } | null | undefined} probe  lib/roon-direct/profile-probe.js
 */
function mountProfileProbe(app, probe) {
  app.get("/api/debug/roon-profile-probe", async (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    if (req.query.run !== "1") {
      return res.json({ ran: false, design: "dev/design/profiles.md §13.6",
        how: "Add run=1: lists your server's profiles and how many playlists each has, then makes a Roon profile named " +
          "\"Rouen probe <time>\" (CreateProfile), renames it to \"… renamed\" (Edit) and deletes it (Delete), reading it back " +
          "after each. Only the profile it makes is deleted; one left is named in the answer." });
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

module.exports = { mountProfileProbe };
