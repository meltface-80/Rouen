// @ts-check
"use strict";
/*
 * display-settings.js — the Wall Display's switch and its refresh interval in Settings, moved out of index.js
 * unchanged in v1.9.67-t3 (dev/quality.md: a session that touches index.js moves code out of it).
 *
 *   GET  /api/settings/display   { enabled, seconds }   — the /display page polls this to honour the toggle live
 *   POST /api/settings/display   body: { enabled?: boolean, seconds?: 5–60 }   — a value out of range leaves the old
 *
 * Rouen Lite (dev/design/rouen-lite.md §4, 2.0.6-t8; the owner: "Wall display wasn't removed as requested") has no wall
 * display: it is off whatever was saved (the saved value is left alone), GET says so with lite: true, and turning it on
 * is refused. Its menu entry, the Shelf's button and the idle switch to it all follow this switch, so all go with it.
 */

/**
 * @param {{ get: Function, post: Function }} app
 * @param {{ get: () => { enabled: boolean, seconds: number }, set: (v: { enabled: boolean, seconds: number }) => void,
 *           save: (patch: Record<string, any>) => boolean, lite?: boolean }} d  lite: Rouen Lite's (from the environment)
 */
function mountDisplaySettings(app, d) {
  const lite = d.lite !== undefined ? d.lite : require("../lite").isLite();
  // Off in Lite from the start, so /display and its content (index.js reads the same switch) answer as when it is off.
  if (lite && d.get().enabled) d.set(Object.assign(d.get(), { enabled: false }));
  app.get("/api/settings/display", (/** @type {any} */ req, /** @type {any} */ res) => {
    res.json(lite ? Object.assign(d.get(), { enabled: false, lite: true }) : d.get());
  });
  app.post("/api/settings/display", (/** @type {any} */ req, /** @type {any} */ res) => {
    const b = req.body || {};
    if (lite && b.enabled === true) return res.status(409).json({ error: "Rouen Lite has no wall display." });
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
