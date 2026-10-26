// @ts-check
"use strict";
/*
 * labels-settings.js — the Labels switch and the label-folder depth, moved out of index.js unchanged in v1.9.67
 * (dev/quality.md: a session that touches index.js moves code out of it).
 *
 *   GET  /api/settings/labels               { enabled, count, scanning }
 *   POST /api/settings/labels               body: { enabled }  — switched on, the scan runs now
 *   GET  /api/settings/label-folder-depth   { depth }
 *   POST /api/settings/label-folder-depth   body: { depth: 0–6 }  — changed with Labels on and a Core paired, a rescan
 *
 * The scan's own gate lives inside runLabelsIndexScan, at the boundary between the /music tag read (which other
 * features are built on) and the label lookups (which are the network traffic the switch is about).
 */

/**
 * @param {{ get: Function, post: Function }} app
 * @param {{ enabled: () => boolean, setEnabled: (on: boolean) => void, index: () => { count: number, building: any, builtAt: number },
 *           save: (patch: Record<string, any>) => boolean, rescan: (force?: boolean) => Promise<any>,
 *           bgRun: (what: string, fn: () => Promise<any>) => Promise<any>, depth: () => number, setDepth: (n: number) => void,
 *           paired: () => boolean, log: (line: string) => void, debug?: boolean }} d
 */
function mountLabelsSettings(app, d) {
  app.get("/api/settings/labels", (/** @type {any} */ req, /** @type {any} */ res) => {
    const index = d.index();
    res.json({ enabled: d.enabled(), count: index.count, scanning: !!index.building });
  });
  app.post("/api/settings/labels", (/** @type {any} */ req, /** @type {any} */ res) => {
    const body = req.body || {};
    if (body.enabled === undefined) return res.status(400).json({ error: "enabled required" });
    const was = d.enabled();
    const on = !!body.enabled;
    d.setEnabled(on);
    d.save({ labelsEnabled: on });
    // Switched on: the cache may be empty or stale, so build it now instead of
    // leaving an empty Labels screen until the 12-hour timer comes round.
    if (on && !was) {
      d.bgRun("labels (enabled)", () => d.rescan(true))
        .catch((e) => console.error("[labels] scan after enable failed: " + e.message));
    }
    res.json({ ok: true, enabled: on });
  });

  // Label-folder depth — for libraries organised in label folders. 0 = off (use
  // the file's label tag). Saving a new value triggers a rescan so the change
  // takes effect (the file pass overrides cached labels that differ).
  app.get("/api/settings/label-folder-depth", (/** @type {any} */ req, /** @type {any} */ res) => {
    res.json({ depth: d.depth() });
  });
  app.post("/api/settings/label-folder-depth", (/** @type {any} */ req, /** @type {any} */ res) => {
    const depth = parseInt((req.body && req.body.depth), 10);
    if (!Number.isFinite(depth) || depth < 0 || depth > 6) {
      return res.status(400).json({ ok: false, error: "depth must be 0–6" });
    }
    const changed = depth !== d.depth();
    d.setDepth(depth);
    const saved = d.save({ labelFolderDepth: depth });
    console.log("[settings] label folder depth set to " + depth + ", persisted=" + saved);
    // Re-derive file labels from folders (or tags). This setting only means
    // anything to the label pipeline, so with Labels off there is nothing to
    // re-run — and nothing to write into the labels log about it.
    const index = d.index();
    const rescanning = changed && d.paired() && d.enabled();
    if (rescanning && !index.building) {
      index.builtAt = 0;
      d.log("[labels] rescan triggered by label-folder-depth change → " + depth);
      d.rescan().catch((e) => { if (d.debug) console.error("[labels] rescan error:", e.message); });
    }
    res.json({ ok: true, saved, rescanning });
  });
}

module.exports = { mountLabelsSettings };
