// @ts-check
"use strict";
/*
 * display-settings.js — the Wall Display's switch and its refresh interval in Settings, moved out of index.js
 * unchanged in v1.9.67-t3 (dev/quality.md: a session that touches index.js moves code out of it).
 *
 *   GET  /api/settings/display   { enabled, seconds }   — the /display page polls this to honour the toggle live
 *   POST /api/settings/display   body: { enabled?: boolean, seconds?: 5–60 }   — a value out of range leaves the old
 */

/**
 * @param {{ get: Function, post: Function }} app
 * @param {{ get: () => { enabled: boolean, seconds: number }, set: (v: { enabled: boolean, seconds: number }) => void,
 *           save: (patch: Record<string, any>) => boolean }} d
 */
function mountDisplaySettings(app, d) {
  app.get("/api/settings/display", (/** @type {any} */ req, /** @type {any} */ res) => {
    res.json(d.get());
  });
  app.post("/api/settings/display", (/** @type {any} */ req, /** @type {any} */ res) => {
    const b = req.body || {};
    const v = d.get();
    if (typeof b.enabled === "boolean") v.enabled = b.enabled;
    if (b.seconds != null) {
      const s = parseInt(b.seconds, 10);
      if (Number.isFinite(s) && s >= 5 && s <= 60) v.seconds = s;
    }
    d.set(v);
    const ok = d.save({ displayEnabled: v.enabled, displaySeconds: v.seconds });
    res.json({ ok, enabled: v.enabled, seconds: v.seconds });
  });
}

module.exports = { mountDisplaySettings };
