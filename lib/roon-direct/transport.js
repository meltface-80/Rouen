// @ts-check
"use strict";
/*
 * transport.js — N3-2 (dev/design/native-remote.md §14.3, v1.9.65): play, pause, next, previous, stop, seek,
 * volume, mute, shuffle, repeat and Roon Radio sent to your server itself, on its Zone and Endpoint objects, as
 * its own apps send them. What the zone does is still read from the official API (the owner, §14.3: native state
 * waits for §14.2's stale defaults), and a control is believed once the official zone shows it within WAIT_MS.
 *
 * Each control answers one of:
 *   { seen: true }               sent, and the official zone showed it
 *   { notSent: why }             nothing reached the server (off, not connected, not found, refused): safe to
 *                                send through the official API, whatever it was
 *   { seen: false, why }         sent (or maybe sent), not shown in time: the route decides (§14.3: the safe ones
 *                                again through the official API; next, previous, the toggle and seek only said)
 */
const { BinaryWriter } = require("./wire");
const { SIG } = require("./methods");
const { field } = require("./objects");
const { zoneFor } = require("./smart");

const WAIT_MS = 3000, POLL_MS = 100;
/** How long a control waits for its turn (a library read can hold it for a minute, the review): then the official API. */
const TURN_MS = 500;
/** LoopMode, as the catalogue has it; the official API's words for it. */
const LOOP = Object.freeze({ disabled: 0, loop: 1, loop_one: 2 });
/** The official commands and the Zone method each is. @type {Record<string, keyof typeof SIG>} */
const COMMAND = Object.freeze({ play: "zonePlay", pause: "zonePause", playpause: "zonePlayPause", stop: "zoneStop",
  next: "zoneNext", previous: "zonePrevious" });
const NONE = Buffer.alloc(0);
const w = () => new BinaryWriter();
/** @param {any} v */
const hex = (v) => (Buffer.isBuffer(v) ? v.toString("hex") : null);

/**
 * @typedef {{ value: number | null, min: number | null, max: number | null, step: number, muted: boolean }} OutputLook
 * @typedef {{ state: string | null, line: string | null, left: number | null, seek: number | null,
 *             settings: { shuffle: boolean, loop: string, auto_radio: boolean }, outputs: Record<string, OutputLook> }} Look
 */

/** What an official zone shows, to tell a control by. @param {any} z @returns {Look | null} */
function look(z) {
  if (!z) return null;
  const np = z.now_playing || null;
  const tl = (np && np.three_line) || {};
  const s = z.settings || {};
  /** @type {Record<string, OutputLook>} */
  const outputs = {};
  for (const o of z.outputs || []) {
    const v = o.volume || null;
    outputs[o.output_id] = { value: v && typeof v.value === "number" ? v.value : null, min: v && typeof v.min === "number" ? v.min : null,
      max: v && typeof v.max === "number" ? v.max : null, step: v && typeof v.step === "number" && v.step > 0 ? v.step : 1, muted: !!o.is_muted };
  }
  const lines = [tl.line1, tl.line2, tl.line3];
  return {
    state: z.state || null,
    // Three lines when there are; else the one line (the review: three empty lines joined are never empty).
    line: !np ? null : lines.some(Boolean) ? lines.join("\u0000") : (np.one_line && np.one_line.line1) || null,
    left: typeof z.queue_items_remaining === "number" ? z.queue_items_remaining : null,
    seek: np && typeof np.seek_position === "number" ? np.seek_position : null,
    settings: { shuffle: !!s.shuffle, loop: s.loop === "loop" || s.loop === "loop_one" ? s.loop : "disabled", auto_radio: !!s.auto_radio },
    outputs,
  };
}

/**
 * Whether the official zone shows a control taken (§14.3's table). Pure.
 * @param {{ kind: string, arg?: any, output?: string }} c @param {Look} before @param {Look} after
 */
function shows(c, before, after) {
  const out = c.output ? after.outputs[c.output] : null;
  const was = c.output ? before.outputs[c.output] : null;
  switch (c.kind) {
    case "play": return after.state === "playing" || after.state === "loading";
    case "pause": return after.state === "paused";
    case "stop": return after.state === "stopped" || after.state === "paused";
    // A toggle: any state other than before (§14.3; from loading too, the review).
    case "playpause": return after.state !== before.state;
    case "next": return after.line !== before.line || (after.left !== null && before.left !== null && after.left < before.left);
    // Back a track, or back to the start of this one.
    case "previous": return after.line !== before.line || (after.seek !== null && before.seek !== null && after.seek < before.seek);
    case "seek": return after.seek !== null && Math.abs(after.seek - c.arg) <= 3;
    case "volume": {
      if (!out || out.value === null) return false;
      const lo = out.min ?? -Infinity, hi = out.max ?? Infinity;
      return Math.abs(out.value - Math.min(hi, Math.max(lo, c.arg))) <= out.step;
    }
    case "volumeBy": {
      if (!out || !was || out.value === null || was.value === null) return false;
      if (c.arg > 0) return out.value > was.value || (was.max !== null && was.value >= was.max);
      return out.value < was.value || (was.min !== null && was.value <= was.min);
    }
    case "mute": return !!out && out.muted === c.arg;
    case "settings": return Object.keys(c.arg).every((k) => after.settings[/** @type {"shuffle"} */ (k)] === c.arg[k]);
    default: return false;
  }
}

/**
 * The output's Endpoint, only among the zone's own endpoints (§14.3): by its id as hex when that is the official
 * output_id (as a zone's is; not yet proven for outputs), else by name.
 * @param {any} graph @param {any} zone the native Zone @param {{ output_id: string, display_name?: string }} o
 * @returns {{ endpoint: any, by: string } | { notSent: string }}
 */
function endpointFor(graph, zone, o) {
  const mine = graph.ofType("Endpoint").filter((/** @type {any} */ e) => { const r = e.loaded && field(e, "Zone"); return r && r.$ref === zone.oid; });
  const byId = mine.filter((/** @type {any} */ e) => hex(field(e, "EndpointId")) === String(o.output_id).toLowerCase());
  if (byId.length === 1) return { endpoint: byId[0], by: "id" };
  const named = mine.filter((/** @type {any} */ e) => field(e, "Name") === o.display_name);
  if (named.length === 1) return { endpoint: named[0], by: "name" };
  return { notSent: `Rouen couldn't tell which of your server's outputs is "${o.display_name || o.output_id}".` };
}

/**
 * @param {{ link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>, on: () => boolean,
 *           zone: (id: string) => any, log?: (line: string) => void, now?: () => number, waitMs?: number, pollMs?: number,
 *           turnMs?: number }} deps
 *   zone: the official zone now, by its id or one of its outputs' ids (index.js's, read anew on every poll)
 */
function createTransport(deps) {
  const log = deps.log || (() => {});
  const now = deps.now || Date.now;
  const waitMs = deps.waitMs ?? WAIT_MS, pollMs = deps.pollMs ?? POLL_MS, turnMs = deps.turnMs ?? TURN_MS;
  /** The last control, for the status board (§14.3). @type {{ ok: boolean, why: string | null, at: number, what: string } | null} */
  let last = null;

  /**
   * One control: found, sent in its turn, then watched for in the official zone.
   * @param {string} id  the zone or output id the control names
   * @param {{ kind: string, arg?: any, output?: string }} c
   * @param {(s: any, zone: any) => { calls: Array<[keyof typeof SIG, Buffer, boolean]>, oid: bigint } | { notSent: string }} plan
   *   the calls, on which object; each [method, arguments, whether it answers]
   * @returns {Promise<{ seen: true } | { notSent: string } | { seen: false, why: string }>}
   */
  async function control(id, c, plan) {
    const done = (/** @type {any} */ r) => {
      last = { ok: r.seen === true, why: r.seen === true ? null : r.notSent || r.why, at: now(), what: c.kind };
      return r;
    };
    if (!deps.on()) return done({ notSent: "Native mode is off." });
    /** @type {Look | null} */
    let before = null;
    let handed = false, started = false, abandoned = false;
    /** @type {any} */
    const turn = deps.inTurn(async () => {
      if (abandoned) return { notSent: "skipped" };   // the official API has taken it meanwhile: nothing is sent
      started = true;
      const s = deps.link ? deps.link.session() : null;
      if (!s) return { notSent: "Native mode isn't connected to your server right now." };
      if (s.g.uncertain()) return { notSent: "The connection to your server is being checked." };
      const z = deps.zone(id);
      if (!z) return { notSent: "The official API doesn't list that zone now." };
      const m = zoneFor(s.graph, z);
      if (!("zone" in m)) return { notSent: m.notSent };
      const p = plan(s, m.zone);
      if ("notSent" in p) return p;
      before = look(z);   // taken once the control has its turn (§14.3)
      try {
        for (const [method, args, answers] of p.calls) {
          if (answers) {
            // An answered call is its plan's only one (seek, a volume): refused, nothing was done.
            const asked = s.g.call(p.oid, SIG[method], args);
            handed = true;
            const res = await asked;
            if (!res.success) return { notSent: `Your server refused it (${res.status}).` };
          } else {
            if (!s.g.callNoReply(p.oid, SIG[method], args)) return handed ? { maybe: "The connection closed while it was being sent." }
              : { notSent: "The connection closed before it could be sent." };
            handed = true;
          }
        }
      } catch (e) {
        // An answered call that never came back may still have been taken: watched for, never assumed not sent.
        const why = String(e && /** @type {any} */ (e).message);
        return handed ? { maybe: why } : { notSent: why };
      }
      return { sent: true };
    });
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const late = new Promise((r) => {
      timer = setTimeout(() => { if (!started) { abandoned = true; r({ notSent: "Native mode was busy reading your server; the official API took it." }); } }, turnMs);
    });
    /** @type {any} */
    const sent = await Promise.race([turn, late]);
    clearTimeout(timer);
    if (sent.notSent) return done({ notSent: sent.notSent });
    const from = /** @type {Look} */ (/** @type {unknown} */ (before));
    for (const until = now() + waitMs; ;) {
      const after = look(deps.zone(id));
      if (after && shows(c, from, after)) return done({ seen: true });
      if (now() >= until) break;
      await new Promise((r) => { setTimeout(r, pollMs); });
    }
    const why = (sent.maybe ? sent.maybe + " " : "") + `The zone didn't show it within ${Math.round(waitMs / 1000)} s.`;
    log(`${c.kind}: sent to your server, not seen: ${why}`);
    return done({ seen: false, why });
  }

  /** The Zone's own call(s). @param {Array<[keyof typeof SIG, Buffer, boolean]>} calls */
  const onZone = (calls) => (/** @type {any} */ s, /** @type {any} */ zone) => ({ calls, oid: zone.oid });
  /** The output's Endpoint call. @param {string} outputId @param {[keyof typeof SIG, Buffer, boolean]} call */
  const onEndpoint = (outputId, call) => (/** @type {any} */ s, /** @type {any} */ zone) => {
    const z = deps.zone(outputId);
    const o = z && (z.outputs || []).find((/** @type {any} */ x) => x.output_id === outputId);
    if (!o) return { notSent: "The official API doesn't list that output now." };
    const e = endpointFor(s.graph, zone, o);
    return "notSent" in e ? e : { calls: [call], oid: e.endpoint.oid };
  };

  return {
    /** The last control since Rouen started, or null (the status board). */
    lastControl: () => (last ? Object.assign({}, last) : null),
    /** @param {string} id @param {string} command  play | pause | playpause | stop | next | previous */
    command(id, command) {
      const m = COMMAND[command];
      if (!m) return Promise.resolve({ notSent: `"${command}" isn't a control native mode sends.` });
      return control(id, { kind: command }, onZone([[m, NONE, false]]));
    },
    /** @param {string} id @param {number} seconds  from the start of the track */
    seek(id, seconds) {
      const s = Math.max(0, Math.round(seconds));
      return control(id, { kind: "seek", arg: s }, onZone([["zoneSeek", w().integer(s).toBuffer(), true]]));
    },
    /** @param {string} outputId @param {"absolute" | "relative"} how @param {number} value */
    volume(outputId, how, value) {
      const by = how === "relative";
      if (!Number.isFinite(value)) return Promise.resolve({ notSent: "That volume isn't a number." });
      // An output whose volume has no value (it only steps) can't be watched: the official API takes it (the review).
      const z = deps.zone(outputId);
      const o = z && (z.outputs || []).find((/** @type {any} */ x) => x.output_id === outputId);
      if (!o || !o.volume || typeof o.volume.value !== "number") return Promise.resolve({ notSent: "This output's volume can't be watched; the official API takes it." });
      return control(outputId, { kind: by ? "volumeBy" : "volume", arg: value, output: outputId },
        onEndpoint(outputId, [by ? "endpointVolumeBy" : "endpointVolume", w().double(value).toBuffer(), true]));
    },
    /** @param {string} outputId @param {boolean} on */
    mute(outputId, on) {
      return control(outputId, { kind: "mute", arg: on, output: outputId }, onEndpoint(outputId, ["endpointMute", w().boolean(on).toBuffer(), false]));
    },
    /** @param {string} id @param {{ shuffle?: boolean, loop?: string, auto_radio?: boolean }} patch */
    settings(id, patch) {
      /** @type {Array<[keyof typeof SIG, Buffer, boolean]>} */
      const calls = [];
      if (typeof patch.shuffle === "boolean") calls.push(["zoneShuffle", w().boolean(patch.shuffle).toBuffer(), false]);
      if (patch.loop !== undefined) {
        const n = LOOP[/** @type {keyof typeof LOOP} */ (patch.loop)];
        if (n === undefined) return Promise.resolve({ notSent: `"${patch.loop}" isn't a repeat mode.` });
        calls.push(["zoneLoop", w().integer(n).toBuffer(), false]);
      }
      if (typeof patch.auto_radio === "boolean") calls.push(["zoneRadio", w().boolean(patch.auto_radio).toBuffer(), false]);
      if (!calls.length) return Promise.resolve({ notSent: "Nothing to change." });
      return control(id, { kind: "settings", arg: patch }, onZone(calls));
    },
  };
}

module.exports = { createTransport, look, shows, endpointFor, LOOP };
