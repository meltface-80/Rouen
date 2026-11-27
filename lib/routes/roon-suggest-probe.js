// @ts-check
"use strict";
/*
 * roon-suggest-probe.js — the route of the suggestions probe (2.0.6-t17, dev/design/roon-suggestions.md §4), run by hand:
 *   GET /api/debug/roon-suggest                         says what a run does; asks nothing
 *   GET /api/debug/roon-suggest?run=1[&title=&artist=]  reads Roon's own See also and similar artists for the album (the
 *                                                       one playing, without title), and Roon's search for three of them
 */

/**
 * @param {any} app
 * @param {{ run(o?: { title?: string, artist?: string }): Promise<any> } | null | undefined} probe  lib/roon-direct/suggest-probe.js
 */
function mountRoonSuggestProbe(app, probe) {
  app.get("/api/debug/roon-suggest", async (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    if (req.query.run !== "1") {
      return res.json({ readOnly: true, ran: false, design: "dev/design/roon-suggestions.md §4",
        how: "Add ?run=1 while an album plays to ask your server, over native mode, for Roon's own suggestions around it: " +
          "its See also, its artist's similar artists, and Roon's own search for three of them. Add &title=…&artist=… " +
          "for another album in your library. It takes a few seconds. Nothing is changed." });
    }
    const text = (/** @type {any} */ v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : undefined);
    if (!probe) return res.status(503).json({ error: "Native mode isn't available here." });
    try {
      const out = await probe.run({ title: text(req.query.title), artist: text(req.query.artist) });
      if (out && out.error && out.status) return res.status(out.status).json({ error: out.error });
      res.json(out);
    } catch (e) {
      // Unanswered, refused, or the connection gone: the reason as it came.
      res.status(502).json({ error: "That didn't reach your server: " + String((e && /** @type {any} */ (e).message) || e) });
    }
  });
}

module.exports = { mountRoonSuggestProbe };
