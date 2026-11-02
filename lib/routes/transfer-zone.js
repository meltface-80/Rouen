// @ts-check
"use strict";
/*
 * lib/routes/transfer-zone.js — move the currently playing queue from one zone to another, through the official API's
 * transfer_zone. Moved out of index.js unchanged in v1.9.72-t71 (dev/quality.md, step 5).
 *
 *   POST /api/transfer-zone  { from_zone, to_zone }  → { ok: true } | { ok: true, noop: true } | { error }
 *
 * index.js reassigns `core` and `zones`, so both are read through getters.
 */

/** @param {{ post: Function }} app @param {{ core: () => any, zones: () => Record<string, any> }} d */
function mountTransferZone(app, d) {
  // Transfer zone: move the currently playing queue from one zone to another.
  // body: { from_zone, to_zone }
  app.post("/api/transfer-zone", (/** @type {any} */ req, /** @type {any} */ res) => {
    const core = d.core(), zones = d.zones();
    if (!core) return res.status(503).json({ error: "Not paired with Roon Core" });
    const { from_zone, to_zone } = req.body || {};
    if (!from_zone || !to_zone) return res.status(400).json({ error: "from_zone and to_zone required" });
    if (from_zone === to_zone) return res.json({ ok: true, noop: true });

    const fromName = (zones[from_zone] && zones[from_zone].display_name) || from_zone;
    const toName   = (zones[to_zone]   && zones[to_zone].display_name)   || to_zone;
    console.log(`[transfer-zone] ${fromName} → ${toName}`);

    core.services.RoonApiTransport.transfer_zone(from_zone, to_zone, (/** @type {any} */ err) => {
      if (err) {
        const msg = typeof err === "string" ? err : JSON.stringify(err);
        console.warn(`[transfer-zone] failed: ${msg}`);
        return res.status(500).json({ error: msg });
      }
      console.log(`[transfer-zone] ok`);
      res.json({ ok: true });
    });
  });
}

module.exports = { mountTransferZone };
