// @ts-check
"use strict";
/*
 * transport.js — playing, seeking and volume: the routes, moved out of index.js in v1.9.65 unchanged but for the
 * transport they call, and that transport (dev/design/native-remote.md §14.3): native first, the official API
 * otherwise.
 *
 *   POST /api/control   { zone_or_output_id, command }           play | pause | playpause | stop | previous | next
 *   POST /api/seek      { zone_or_output_id, seconds }
 *   POST /api/volume    { zone_or_output_id, value? | relative? | mute? }
 *
 * Each answers { ok, via: "roon" | "official", why? }: where it went, and why it fell back. The native-first
 * transport has the official API's shape (control, seek, change_volume, mute, change_settings; a callback of
 * (err, { via, why? })), so index.js's /api/zone-settings calls it too, its Roon Radio hand-over untouched.
 */

/**
 * Sent again through the official API when native mode sent it and the zone didn't show it (the owner, §14.3):
 * twice does no harm. Next, previous, the play/pause toggle, seek and a relative volume step are only said (a step
 * sent twice moves twice, the review). An absolute volume is "volume"; a step is "volumeBy".
 */
const SAFE = new Set(["play", "pause", "stop", "volume", "mute", "settings"]);

/**
 * @param {{ official: () => any, native: () => ReturnType<typeof import("../roon-direct/transport").createTransport> | null,
 *           log?: (line: string) => void }} d
 *   official: the official API's transport service (RoonApiTransport) now, or null when not paired
 */
function createNativeFirst(d) {
  const log = d.log || ((/** @type {string} */ line) => { console.log("[transport] " + line); });
  /** @param {(cb: (err: any) => void) => void} send @param {(err: any, via: any) => void} cb @param {string | null} why */
  const officially = (send, cb, why) => {
    const t = d.official();
    if (!t) return cb("Not paired with Roon Core", { via: "official" });
    send((/** @type {any} */ err) => cb(err, why ? { via: "official", why } : { via: "official" }));
  };
  /** The newest control asked for, by the zone or output it is for. @type {Map<string, number>} */
  const latest = new Map();
  /**
   * @param {string} what  the control, as §14.3 names it @param {string} said  how an error names it
   * @param {string} target  the zone or output it is for: a newer control for it makes an older one's resend stale
   * @param {(n: NonNullable<ReturnType<typeof d.native>>) => Promise<any>} natively
   * @param {(t: any, cb: (err: any) => void) => void} official @param {(err: any, via: any) => void} reply
   */
  function run(what, said, target, natively, official, reply) {
    // The route's answer may throw (a response already sent): logged, never an unhandled rejection (the review).
    const cb = (/** @type {any} */ err, /** @type {any} */ via) => {
      try { reply(err, via); } catch (e) { log(`${what}: the answer failed: ${/** @type {any} */ (e).message}`); }
    };
    const gen = (latest.get(target) || 0) + 1;
    latest.set(target, gen);
    const n = d.native();
    const send = (/** @type {(err: any) => void} */ done) => official(d.official(), done);
    if (!n) return officially(send, cb, null);
    natively(n).then((r) => {
      if (r.seen === true) return cb(null, { via: "roon" });
      if (r.notSent !== undefined) return officially(send, cb, r.notSent);
      // A newer control for the same zone or output since: sending this one again would undo it (a volume dragged
      // 10 → 20 → 30 put back to 20, the review). Not seen because it was overtaken, not because it failed.
      if (latest.get(target) !== gen) return cb(null, { via: "roon", why: "A newer control followed it." });
      if (SAFE.has(what)) {
        log(`${what}: not seen from your server; sent again through the official API (${r.why})`);
        return officially(send, cb, r.why);
      }
      cb(`Your server took the ${said}, but the zone didn't show it in time, so Rouen didn't send it again. ${r.why}`, { via: "roon" });
    }, (/** @type {any} */ e) => {
      // A throw before anything was sent (transport.js answers a send's own failures): the official API takes it.
      log(`${what}: native mode couldn't send it: ${e && e.message}`);
      officially(send, cb, String(e && e.message));
    });
  }
  return {
    /** @param {string} id @param {string} command @param {(err: any, via: any) => void} cb */
    control: (id, command, cb) => run(command, command === "playpause" ? "play/pause" : command, id,
      (n) => n.command(id, command), (t, done) => t.control(id, command, done), cb),
    /** @param {string} id @param {string} how @param {number} seconds @param {(err: any, via: any) => void} cb */
    seek: (id, how, seconds, cb) => run("seek", "seek", id, (n) => n.seek(id, seconds), (t, done) => t.seek(id, how, seconds, done), cb),
    /** @param {string} outputId @param {"absolute" | "relative"} how @param {number} value @param {(err: any, via: any) => void} cb */
    change_volume: (outputId, how, value, cb) => run(how === "relative" ? "volumeBy" : "volume", "volume step", "volume " + outputId,
      (n) => n.volume(outputId, how, value),
      (t, done) => t.change_volume(outputId, how, value, done), cb),
    /** @param {string} outputId @param {"mute" | "unmute"} how @param {(err: any, via: any) => void} cb */
    mute: (outputId, how, cb) => run("mute", "mute", "mute " + outputId, (n) => n.mute(outputId, how === "mute"), (t, done) => t.mute(outputId, how, done), cb),
    /** @param {string} id @param {any} patch @param {(err: any, via: any) => void} cb */
    change_settings: (id, patch, cb) => run("settings", "change", "settings " + id, (n) => n.settings(id, patch),
      (t, done) => t.change_settings(id, patch, done), cb),
  };
}

/**
 * @param {{ post: Function }} app
 * @param {{ core: () => any, zones: () => Record<string, any>, outputs: () => Record<string, any>,
 *           transport: ReturnType<typeof createNativeFirst> }} d
 */
function mountTransport(app, d) {
  // Playback control.  body: { zone_or_output_id, command }
  // command ∈ play | pause | playpause | stop | previous | next
  app.post("/api/control", (/** @type {any} */ req, /** @type {any} */ res) => {
    if (!d.core()) return res.status(503).json({ error: "Not paired with Roon Core" });
    const { zone_or_output_id, command } = req.body || {};
    if (!zone_or_output_id) return res.status(400).json({ error: "zone_or_output_id required" });
    const allowed = ["play", "pause", "playpause", "stop", "previous", "next"];
    if (!allowed.includes(command)) {
      return res.status(400).json({ error: "invalid command, allowed: " + allowed.join(", ") });
    }
    d.transport.control(zone_or_output_id, command, (/** @type {any} */ err, /** @type {any} */ via) => {
      if (err) return res.status(500).json({ error: typeof err === "string" ? err : JSON.stringify(err) });
      res.json(Object.assign({ ok: true }, via));
    });
  });

  // Seek within the current track.  body: { zone_or_output_id, seconds }
  // Absolute seek to a position in seconds from the start of the track.
  app.post("/api/seek", (/** @type {any} */ req, /** @type {any} */ res) => {
    if (!d.core()) return res.status(503).json({ error: "Not paired with Roon Core" });
    const { zone_or_output_id } = req.body || {};
    const seconds = Number(req.body && req.body.seconds);
    if (!zone_or_output_id) return res.status(400).json({ error: "zone_or_output_id required" });
    if (!Number.isFinite(seconds) || seconds < 0) return res.status(400).json({ error: "seconds must be a non-negative number" });
    d.transport.seek(zone_or_output_id, "absolute", Math.round(seconds), (/** @type {any} */ err, /** @type {any} */ via) => {
      if (err) return res.status(500).json({ error: typeof err === "string" ? err : JSON.stringify(err) });
      res.json(Object.assign({ ok: true }, via));
    });
  });

  // Volume.  body: { zone_or_output_id, value?, mute?, relative? }
  //   value:    absolute volume to set (uses output's native scale)
  //   relative: signed delta to add (e.g. +5, -5)
  //   mute:     true/false
  // For a zone, applies to every output in the zone.
  app.post("/api/volume", (/** @type {any} */ req, /** @type {any} */ res) => {
    if (!d.core()) return res.status(503).json({ error: "Not paired with Roon Core" });
    const { zone_or_output_id } = req.body || {};
    if (!zone_or_output_id) return res.status(400).json({ error: "zone_or_output_id required" });

    // Figure out which outputs to target
    const zone = d.zones()[zone_or_output_id];
    const targetOutputs = zone
      ? (zone.outputs || []).map((/** @type {any} */ o) => o)
      : (d.outputs()[zone_or_output_id] ? [d.outputs()[zone_or_output_id]] : []);
    if (targetOutputs.length === 0) return res.status(404).json({ error: "no outputs found" });

    const t = d.transport;
    /** @type {Promise<any>[]} */
    const tasks = [];

    if (req.body.mute !== undefined) {
      const how = req.body.mute ? "mute" : "unmute";
      for (const o of targetOutputs) {
        tasks.push(new Promise((resolve, reject) => {
          t.mute(o.output_id, how, (/** @type {any} */ err, /** @type {any} */ via) => (err ? reject(err) : resolve(via)));
        }));
      }
    } else if (req.body.value !== undefined) {
      const v = parseFloat(req.body.value);
      for (const o of targetOutputs) {
        tasks.push(new Promise((resolve, reject) => {
          t.change_volume(o.output_id, "absolute", v, (/** @type {any} */ err, /** @type {any} */ via) => (err ? reject(err) : resolve(via)));
        }));
      }
    } else if (req.body.relative !== undefined) {
      const v = parseFloat(req.body.relative);
      for (const o of targetOutputs) {
        tasks.push(new Promise((resolve, reject) => {
          t.change_volume(o.output_id, "relative", v, (/** @type {any} */ err, /** @type {any} */ via) => (err ? reject(err) : resolve(via)));
        }));
      }
    } else {
      return res.status(400).json({ error: "value, relative, or mute required" });
    }

    Promise.all(tasks)
      // One answer for every output: native only when each went native.
      .then((vias) => res.json(Object.assign({ ok: true }, vias.find((x) => x && x.via === "official") || vias[0])))
      .catch((/** @type {any} */ err) => res.status(500).json({
        error: typeof err === "string" ? err : JSON.stringify(err)
      }));
  });
}

module.exports = { createNativeFirst, mountTransport, SAFE };
