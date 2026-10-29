// @ts-check
"use strict";
/*
 * routes.js — the phone's API, version 1 (dev/design/android-app.md §4.10, v1.9.72-t5). Every route needs Rouen's
 * login, as every route does (the app's WebView holds the cookie and the player sends it); nothing here opens a route.
 *
 *   POST /api/phone/hello      {device_id, name, quality}         → {device_id, zone_name, seq, open}
 *   GET  /api/phone/commands   ?device_id&after&wait              → {seq, commands}  (409: hello again)
 *   POST /api/phone/state      {device_id, session, position, state}
 *   GET  /api/phone/audio      ?device_id&session                 → the session, as it is made
 *   GET  /api/phone/now        ?device_id                         → what Roon shows for the phone's zone
 *   POST /api/phone/control    {device_id, op}                    → asks Roon, on the phone's zone
 *   GET  /api/debug/phones                                        → every phone and its player
 */

const ID = /^[0-9a-f]{32}$/;
const QUALITIES = new Set(["opus", "lossless"]);
const STATES = new Set(["playing", "paused", "buffering", "stopped", "ended"]);
const OPS = new Set(["play", "pause", "playpause", "next", "previous", "stop"]);

/** The official zone Roon shows for a name. @param {Record<string, any>} zones @param {string} name */
function zoneNamed(zones, name) {
  return Object.values(zones || {}).find((z) => z && (z.display_name === name
    || (z.outputs || []).some((/** @type {any} */ o) => o && o.display_name === name))) || null;
}

/**
 * @param {{ get: Function, post: Function }} app
 * @param {{ devices: ReturnType<typeof import("./devices").createDevices>, zones: () => Record<string, any>,
 *   control: (zoneId: string, op: string, done: (err: any) => void) => void }} deps
 */
function mountPhone(app, deps) {
  const D = deps.devices;
  /** @param {any} v */
  const id = (v) => (typeof v === "string" && ID.test(v) ? v : null);

  app.post("/api/phone/hello", (/** @type {any} */ req, /** @type {any} */ res) => {
    const b = req.body || {};
    const name = typeof b.name === "string" ? b.name.trim().slice(0, 60) : "";
    if (!id(b.device_id) || !name || !QUALITIES.has(b.quality)) {
      return res.status(400).json({ error: "device_id (32 hex), name and quality (opus or lossless), please" });
    }
    const out = D.hello({ device_id: b.device_id, name, quality: b.quality });
    if (!out) return res.status(503).json({ error: "Rouen is not paired with a Roon Core yet." });
    res.json(out);
  });

  app.get("/api/phone/commands", async (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    const dev = id(req.query.device_id);
    const after = /^\d{1,12}$/.test(String(req.query.after)) ? Number(req.query.after) : NaN;
    const wait = req.query.wait === undefined ? 25000 : /^\d{1,6}$/.test(String(req.query.wait)) ? Number(req.query.wait) : NaN;
    if (!dev || Number.isNaN(after) || Number.isNaN(wait)) return res.status(400).json({ error: "device_id, after and wait, please" });
    const p = D.poll(dev, after, wait);
    if (!p) return res.status(409).json({ error: "Say hello first." });
    res.json(await p);
  });

  app.post("/api/phone/state", (/** @type {any} */ req, /** @type {any} */ res) => {
    const b = req.body || {};
    const dev = id(b.device_id);
    if (!dev || !Number.isInteger(b.session) || b.session < 0 || typeof b.position !== "number" || !(b.position >= 0)
      || !STATES.has(b.state)) {
      return res.status(400).json({ error: "device_id, session, position and state, please" });
    }
    if (!D.report(dev, { session: b.session, position: b.position, state: b.state })) return res.status(409).json({ error: "Say hello first." });
    res.json({ ok: true });
  });

  app.get("/api/phone/audio", (/** @type {any} */ req, /** @type {any} */ res) => {
    const dev = id(req.query.device_id);
    const n = /^\d{1,9}$/.test(String(req.query.session)) ? Number(req.query.session) : NaN;
    if (!dev || Number.isNaN(n)) return res.status(400).json({ error: "device_id and session, please" });
    const sess = D.session(dev, n);
    if (!sess) return res.status(404).json({ error: "That session is no longer kept." });
    res.status(200);
    res.set("Content-Type", sess.quality === "lossless" ? "audio/flac" : "audio/ogg");
    res.set("Cache-Control", "no-store");
    sess.pipeTo(res);
  });

  app.get("/api/phone/now", (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    const dev = id(req.query.device_id);
    const name = dev && D.zoneName(dev);
    if (!name) return res.status(409).json({ error: "Say hello first." });
    const z = zoneNamed(deps.zones(), name);
    const np = z && z.now_playing, l = (np && np.three_line) || {};
    res.json({ zone_id: z ? z.zone_id : null, state: z ? z.state || null : null, title: l.line1 || null,
      artist: l.line2 || null, album: l.line3 || null, image_key: (np && np.image_key) || null,
      length: np && typeof np.length === "number" ? np.length : null,
      seek: np && typeof np.seek_position === "number" ? np.seek_position : null });
  });

  app.post("/api/phone/control", (/** @type {any} */ req, /** @type {any} */ res) => {
    const b = req.body || {};
    const dev = id(b.device_id);
    if (!dev || !OPS.has(b.op)) return res.status(400).json({ error: "device_id and op (" + [...OPS].join(", ") + "), please" });
    const name = D.zoneName(dev);
    if (!name) return res.status(409).json({ error: "Say hello first." });
    const z = zoneNamed(deps.zones(), name);
    if (!z) return res.status(404).json({ error: "Roon does not show " + name + " yet: enable it in Roon, Settings → Audio." });
    deps.control(z.zone_id, b.op, (/** @type {any} */ err) => {
      if (err) return res.status(502).json({ error: typeof err === "string" ? err : "Roon refused it." });
      res.json({ ok: true });
    });
  });

  app.get("/api/debug/phones", (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    res.json({ design: "dev/design/android-app.md §4.9, §4.10", phones: D.list() });
  });
}

module.exports = { mountPhone, zoneNamed };
