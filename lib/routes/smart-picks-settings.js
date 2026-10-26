// @ts-check
"use strict";
/*
 * smart-picks-settings.js — Smart Picks' settings: when the daily build runs, and where the five adjacent picks
 * go. Moved out of index.js unchanged in v1.9.67-t4 (dev/quality.md: a session that touches index.js moves code
 * out of it).
 *
 *   GET  /api/settings/smart-picks   { enabled, hour, dest, dests, auto_add, service_ready }
 *   POST /api/settings/smart-picks   body: { enabled?, hour? (0–23), dest? (one of dests) | auto_add? }
 *
 * Every field is validated before ANY is applied, so a refused request changes nothing — not a new hour left live
 * in memory and unsaved. auto_add is the pre-v1.8.67 switch, still honoured for a page loaded before the upgrade:
 * on was "library", off was "ask". smartPicksAutoAdd is still written, kept in step with the destination, so a
 * downgrade to a build that knows only the boolean keeps the user's choice as near as it can be expressed.
 */

/**
 * @typedef {{ enabled: boolean, hour: number, dest: string }} SmartPicksSettings
 * @param {{ get: Function, post: Function }} app
 * @param {{ get: () => SmartPicksSettings, set: (v: SmartPicksSettings) => void, dests: () => string[],
 *           serviceReady: () => boolean, start: () => void, stop: () => void, save: (patch: Record<string, any>) => boolean }} d
 *   start/stop: the daily timer, so switching the feature on takes effect now rather than after a container
 *   restart — and switching it off really does stop the clock rather than leaving it ticking against a gate
 */
function mountSmartPicksSettings(app, d) {
  app.get("/api/settings/smart-picks", (/** @type {any} */ req, /** @type {any} */ res) => {
    const v = d.get();
    res.json({ enabled: v.enabled, hour: v.hour, dest: v.dest, dests: d.dests(), auto_add: v.dest === "library", service_ready: d.serviceReady() });
  });
  app.post("/api/settings/smart-picks", (/** @type {any} */ req, /** @type {any} */ res) => {
    const body = req.body || {};
    const v = d.get();
    if (body.dest !== undefined && d.dests().indexOf(body.dest) === -1) {
      return res.status(400).json({ error: "dest must be one of " + d.dests().join(", ") });
    }
    if (body.hour !== undefined) {
      const h = Number(body.hour);
      if (!Number.isFinite(h) || h < 0 || h > 23) return res.status(400).json({ error: "hour must be 0-23" });
      v.hour = Math.trunc(h);
    }
    if (body.dest !== undefined) v.dest = body.dest;
    else if (body.auto_add !== undefined) v.dest = body.auto_add ? "library" : "ask";
    const wasOn = v.enabled;
    if (body.enabled !== undefined) v.enabled = !!body.enabled;
    d.set(v);
    if (body.enabled !== undefined) { if (v.enabled) d.start(); else d.stop(); }
    void wasOn;
    d.save({ smartPicksEnabled: v.enabled, smartPicksHour: v.hour, smartPicksDest: v.dest, smartPicksAutoAdd: v.dest === "library" });
    res.json({ ok: true, enabled: v.enabled, hour: v.hour, dest: v.dest, auto_add: v.dest === "library" });
  });
}

module.exports = { mountSmartPicksSettings };
