// @ts-check
"use strict";
/*
 * all-zones.js — the routes that act on every zone, or on a group, through Roon's official transport API: moved out of
 * index.js unchanged in v1.9.53 (dev/quality.md, step 5).
 *
 *   POST /api/pause-all                                 pause every zone
 *   POST /api/mute-all { how: "mute" | "unmute" }       mute or unmute every zone that can be
 *   POST /api/ungroup-outputs { output_ids: [...] }     split outputs back out of their group
 */

/** @typedef {{ pause_all(cb: (err: any) => void): void, mute_all(how: string, cb: (err: any) => void): void,
 *              ungroup_outputs(ids: string[], cb: (err: any) => void): void }} Transport */

const MUTE_ALL_MODES = ["mute", "unmute"];

/**
 * @param {{ post: Function }} app
 * @param {{ core: () => { services: { RoonApiTransport: Transport } } | null, outputs: () => Record<string, { display_name?: string }> }} d
 */
function mountAllZones(app, d) {
  /** Roon's answer as the routes give it. @param {string} what @param {any} res @param {boolean} [said] */
  const answer = (what, res, said) => (/** @type {any} */ err) => {
    if (err) {
      const msg = typeof err === "string" ? err : JSON.stringify(err);
      console.warn(`[${what}] failed: ${msg}`);
      return res.status(500).json({ error: msg });
    }
    if (said) console.log(`[${what}] ok`);
    res.json({ ok: true });
  };

  // Pause every zone. No body — Roon's pause_all takes no target.
  app.post("/api/pause-all", (/** @type {any} */ req, /** @type {any} */ res) => {
    const core = d.core();
    if (!core) return res.status(503).json({ error: "Not paired with Roon Core" });
    console.log("[pause-all]");
    core.services.RoonApiTransport.pause_all(answer("pause-all", res));
  });

  // Mute or unmute every zone that can be muted.  body: { how: "mute"|"unmute" }
  app.post("/api/mute-all", (/** @type {any} */ req, /** @type {any} */ res) => {
    const core = d.core();
    if (!core) return res.status(503).json({ error: "Not paired with Roon Core" });
    const how = req.body && req.body.how;
    if (!MUTE_ALL_MODES.includes(how)) {
      return res.status(400).json({ error: "invalid how, allowed: " + MUTE_ALL_MODES.join(", ") });
    }
    console.log(`[mute-all] ${how}`);
    core.services.RoonApiTransport.mute_all(how, answer("mute-all", res));
  });

  // Split outputs back out of their group.  body: { output_ids: [...] }
  app.post("/api/ungroup-outputs", (/** @type {any} */ req, /** @type {any} */ res) => {
    const core = d.core();
    if (!core) return res.status(503).json({ error: "Not paired with Roon Core" });
    const ids = req.body && req.body.output_ids;
    if (!Array.isArray(ids) || ids.length < 1) {
      return res.status(400).json({ error: "output_ids must be a non-empty array of output ids" });
    }
    if (!ids.every((id) => typeof id === "string" && id)) {
      return res.status(400).json({ error: "output_ids must be non-empty strings" });
    }
    if (new Set(ids).size !== ids.length) {
      return res.status(400).json({ error: "output_ids must not repeat" });
    }
    const outputs = d.outputs();
    const names = ids.map((id) => (outputs[id] && outputs[id].display_name) || id);
    console.log(`[ungroup-outputs] ${names.join(", ")}`);
    core.services.RoonApiTransport.ungroup_outputs(ids, answer("ungroup-outputs", res, true));
  });
}

module.exports = { mountAllZones };
