// @ts-check
"use strict";
/*
 * roon-added-probe.js — the route of the Recently added probe (2.0.6-t5, dev/design/recently-added.md §3), run by hand:
 *   GET /api/debug/roon-added          says what a run does; asks nothing
 *   GET /api/debug/roon-added?run=1    reads your library in Roon's order of date added, newest and oldest first;
 *                                      &max_pages=N bounds the newest-first read (a whole number of 1 or more)
 */

/**
 * @param {any} app
 * @param {{ run(o?: { maxPages?: number }): Promise<any> } | null | undefined} probe  lib/roon-direct/added-probe.js
 */
function mountRoonAddedProbe(app, probe) {
  app.get("/api/debug/roon-added", async (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    if (req.query.run !== "1") {
      return res.json({ readOnly: true, ran: false, design: "dev/design/recently-added.md §3",
        how: "Add ?run=1 to ask your server, over native mode, for your library in Roon's own order of date added: the " +
          "fields an album carries that may hold its date, then every album newest first (a minute or so on a large " +
          "library) and the first page oldest first. Compare its first 20 with Roon's Albums sorted by Date added, " +
          "newest first. Add &max_pages=N to read fewer pages of 100. Nothing is changed." });
    }
    /** @type {number | undefined} */
    let maxPages;
    if (req.query.max_pages !== undefined) {
      maxPages = Number(req.query.max_pages);
      if (!Number.isInteger(maxPages) || maxPages < 1) return res.status(400).json({ error: "max_pages, if given, is a whole number of 1 or more" });
    }
    if (!probe) return res.status(503).json({ error: "Native mode isn't available here." });
    try {
      const out = await probe.run({ maxPages });
      if (out && out.error && out.status) return res.status(out.status).json({ error: out.error });
      res.json(out);
    } catch (e) {
      // Unanswered, refused, or the connection gone: the reason as it came.
      res.status(502).json({ error: "That didn't reach your server: " + String((e && /** @type {any} */ (e).message) || e) });
    }
  });
}

module.exports = { mountRoonAddedProbe };
