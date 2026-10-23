// @ts-check
"use strict";
/*
 * zone-controls.js — N3-3c (dev/design/native-remote.md §15.7, v1.9.66-t7): a zone's crossfade, volume levelling, its
 * target and the sleep timer changed on your server's own Zone, and each output's DSP turned on or off — as Roon's own
 * apps do. Each change is sent once, in the connection's turn, and believed only when the server shows it within
 * WAIT_MS: the Zone, pushed whole, holding the value asked; the DSP config, asked again, on or off as asked. Nothing is
 * ever sent twice, and there is no official API to fall back to for any of these.
 *
 * Each change answers one of:
 *   { seen: true, settings | dsp }   sent, and the server showed it (what it now holds)
 *   { notSent: why }                 nothing reached the server
 *   { seen: false, why }             sent (or maybe sent), not shown in time: said, not sent again
 */
const { BinaryWriter } = require("./wire");
const { SIG } = require("./methods");
const { field, isRef, shortType } = require("./objects");
const { answer } = require("./settings-probe");
const { settingsOf, zoneById, hex } = require("./zone-settings");

const WAIT_MS = 3000, POLL_MS = 100, TURN_MS = 500, DSP_POLL_MS = 400, READ_TURN_MS = 5000;
/** VolumeLeveling, the catalogue's enum (§15.7). */
const LEVELING = Object.freeze(/** @type {Record<string, number>} */ ({ off: 0, track: 1, album: 2, auto: 3 }));
const NONE = Buffer.alloc(0);
const w = () => new BinaryWriter();
/**
 * A call that failed before anything left Rouen — the connection already closed, or too many calls waiting
 * (remoting.js's two refusals) — was not sent; any other failure may have been taken, and is watched for (the review).
 * @param {any} e @returns {{ notSent: string } | { maybe: string }}
 */
const failed = (e) => {
  const why = String(e && e.message);
  return /^(connection closed:|already \d+ calls waiting)/.test(why) ? { notSent: why } : { maybe: why };
};

/**
 * What a change sends, and how its arguments are checked: within the bounds Rouen sends (crossfade 0–30 s, target −40–0
 * LUFS, sleep 0–720 minutes) — the page offers its lists inside them, with a zone's current value even when outside the
 * list (§15.7). Pure.
 * @param {{ crossfade?: any, leveling?: any, target?: any, sleep?: any }} c  exactly one of them
 * @returns {{ kind: string, value: any, call: [keyof typeof SIG, Buffer, boolean] } | { notSent: string }}
 */
function planOf(c) {
  const keys = ["crossfade", "leveling", "target", "sleep"].filter((k) => c[/** @type {"sleep"} */ (k)] !== undefined);
  if (keys.length !== 1) return { notSent: "One change at a time, please." };
  const kind = keys[0], v = c[/** @type {"sleep"} */ (kind)];
  if (kind === "crossfade") {
    if (!Number.isInteger(v) || v < 0 || v > 30) return { notSent: "Crossfade takes whole seconds, 0 (off) to 30." };
    return { kind, value: v, call: ["zoneCrossfade", w().integer(v).toBuffer(), false] };
  }
  if (kind === "leveling") {
    if (typeof v !== "string" || LEVELING[v] === undefined) return { notSent: "Levelling is off, track, album or auto." };
    return { kind, value: v, call: ["zoneLeveling", w().integer(LEVELING[v]).toBuffer(), false] };
  }
  if (kind === "target") {
    if (typeof v !== "number" || !Number.isFinite(v) || v < -40 || v > 0) return { notSent: "The target is in LUFS, −40 to 0." };
    return { kind, value: v, call: ["zoneLevelTarget", w().double(v).toBuffer(), false] };
  }
  // the sleep timer: minutes, 0 off. On is (true, minutes); off is (false, null) — a nullable bool one byte (0, 1, 2
  // for null), a nullable int a presence byte and the int (upstream's serializer, §15.7).
  if (!Number.isInteger(v) || v < 0 || v > 720) return { notSent: "The sleep timer takes whole minutes, 0 (off) to 720." };
  const args = v > 0 ? w().integer(1).integer(1).integer(v) : w().integer(0).integer(0);
  return { kind, value: v, call: ["zoneSleep", args.toBuffer(), true] };
}

/**
 * Whether the zone's settings (zone-settings.js settingsOf) show the change. Pure.
 * @param {string} kind @param {any} value @param {ReturnType<typeof settingsOf>} s
 */
function shows(kind, value, s) {
  switch (kind) {
    case "crossfade": return s.crossfade.seconds === value;
    case "leveling": return s.leveling.value === LEVELING[value];
    case "target": return typeof s.leveling.target === "number" && Math.abs(s.leveling.target - value) <= 0.5;
    case "sleep": return value > 0 ? s.sleep.on && s.sleep.minutes === value : !s.sleep.on;
    default: return false;
  }
}

/** The zone's own endpoints, as transport takes them (§14.3). @param {any} graph @param {any} zone */
const endpointsOf = (graph, zone) => graph.ofType("Endpoint").filter((/** @type {any} */ e) => { const r = e.loaded && field(e, "Zone"); return r && r.$ref === zone.oid; });

/**
 * An output's DSP config: GetDspConfig on its device's CommonConfig (§15.2), and whether it is on, read from the push
 * that came with the answer — the object as the server sent it for this answer — not from what the graph held, which
 * merges (a DspConfig turned off leaves `IsEnabled` out, §15.2). null when no push came: not known, not guessed.
 * @param {any} s  the session @param {any} endpoint
 * @returns {Promise<{ oid: bigint, on: boolean | null } | { none: string }>}
 */
async function dspOf(s, endpoint) {
  const dev = isRef(field(endpoint, "Device")) ? s.graph.get(field(endpoint, "Device").$ref) : null;
  const cfg = dev && isRef(field(dev, "CommonConfig")) ? field(dev, "CommonConfig").$ref : null;
  if (cfg === null) return { none: "This output's device has no settings your server shares." };
  /** @type {Map<string, Record<string, any>>} */
  const pushed = new Map();
  /** @type {Set<string>} */
  const fresh = new Set();
  // Every push of it during the answer, laid one over the other; a stub (PUSHSTUB, no members) adds nothing (the review).
  const watch = (/** @type {any} */ o, /** @type {Record<string, any>} */ fields, /** @type {number | undefined} */ cmd) => {
    fresh.add(String(o.oid));
    if (shortType(o.typeName) !== "DspConfig" || cmd === 4) return;
    pushed.set(String(o.oid), Object.assign(pushed.get(String(o.oid)) || {}, fields));
  };
  s.graph.watchers.add(watch);
  try {
    const res = await s.g.call(cfg, SIG.dspConfig, NONE);
    if (!res.success) return { none: `Your server refused to say (${res.status}).` };
    const a = /** @type {any} */ (await answer(s.graph, res.payload, 1500, fresh));
    if (!a || a.object !== "DspConfig") return { none: "Your server sent no DSP config for this output." };
    const p = pushed.get(String(a.oid));
    const on = p ? Object.keys(p).some((k) => k.endsWith("::IsEnabled") && p[k] === true) : null;
    return { oid: BigInt(a.oid), on };
  } finally {
    s.graph.watchers.delete(watch);
  }
}

/**
 * @param {{ link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>, on: () => boolean,
 *           log?: (line: string) => void, now?: () => number, waitMs?: number, pollMs?: number, turnMs?: number, dspPollMs?: number }} deps
 */
function createZoneControls(deps) {
  const log = deps.log || (() => {});
  const now = deps.now || Date.now;
  const waitMs = deps.waitMs ?? WAIT_MS, pollMs = deps.pollMs ?? POLL_MS, turnMs = deps.turnMs ?? TURN_MS;
  const dspPollMs = deps.dspPollMs ?? DSP_POLL_MS;

  /**
   * `fn` in the connection's turn, or not at all: a turn not come within `ms` (a library read can hold it a minute) is
   * given up, and `fn` then runs to nothing (transport's rule, §14.3).
   * @template T @param {(s: any) => Promise<T>} fn @param {number} ms
   * @returns {Promise<T | { notSent: string }>}
   */
  async function inTurn(fn, ms) {
    let started = false, abandoned = false;
    const turn = deps.inTurn(async () => {
      if (abandoned) return { notSent: "skipped" };
      started = true;
      const s = deps.link ? deps.link.session() : null;
      if (!s) return { notSent: "Native mode isn't connected to your server right now." };
      if (s.g.uncertain()) return { notSent: "The connection to your server is being checked." };
      return fn(s);
    });
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const late = new Promise((r) => {
      timer = setTimeout(() => { if (!started) { abandoned = true; r({ notSent: "Native mode is busy reading your server; try again in a moment." }); } }, ms);
    });
    const out = await Promise.race([turn, late]);
    clearTimeout(timer);
    return /** @type {any} */ (out);
  }
  const off = () => (deps.on() ? null : { notSent: "Native mode is off." });

  return {
    /**
     * One change to a zone's settings.
     * @param {string} zoneId @param {{ crossfade?: any, leveling?: any, target?: any, sleep?: any }} change
     */
    async set(zoneId, change) {
      const no = off();
      if (no) return no;
      const p = planOf(change);
      if ("notSent" in p) return p;
      /** @type {any} */
      const sent = await inTurn(async (s) => {
        const z = zoneById(s.graph, zoneId);
        if (!z) return { notSent: "Your server doesn't list that zone now." };
        const [method, args, answers] = p.call;
        try {
          if (answers) {
            const res = await s.g.call(z.oid, SIG[method], args);
            if (!res.success) return { notSent: `Your server refused it (${res.status}).` };
          } else if (!s.g.callNoReply(z.oid, SIG[method], args)) {
            return { notSent: "The connection closed before it could be sent." };
          }
        } catch (e) {
          // An answered call that never came back may still have been taken: watched for, never assumed not sent.
          return failed(e);
        }
        return { sent: true };
      }, turnMs);
      if (sent.notSent) return { notSent: sent.notSent };
      for (const until = now() + waitMs; ;) {
        const s = deps.link ? deps.link.session() : null;
        const z = s && s.graph ? zoneById(s.graph, zoneId) : null;
        if (z && shows(p.kind, p.value, settingsOf(z))) return { seen: true, settings: settingsOf(z) };
        if (now() >= until) break;
        await new Promise((r) => { setTimeout(r, pollMs); });
      }
      const why = (sent.maybe ? sent.maybe + " " : "") + `Your server took it, but the zone didn't show it within ${Math.round(waitMs / 1000)} s.`;
      log(`zone ${p.kind}: sent, not seen: ${why}`);
      return { seen: false, why };
    },

    /**
     * Each output of the zone, and whether its DSP is on (calls, read when the sheet opens).
     * @param {string} zoneId
     */
    async readDsp(zoneId) {
      const no = off();
      if (no) return { native: false, why: no.notSent };
      /** @type {any} */
      const out = await inTurn(async (s) => {
        const z = zoneById(s.graph, zoneId);
        if (!z) return { native: true, found: false, outputs: [] };
        const outputs = [];
        for (const e of endpointsOf(s.graph, z).slice(0, 8)) {
          // One output's read failing (unanswered, the connection gone) is said for it, not lost for the rest (the review).
          const d = await dspOf(s, e).catch((/** @type {any} */ err) => ({ none: `Your server didn't say (${err && err.message}).` }));
          outputs.push(Object.assign({ output: field(e, "Name") ?? null, id: hex(field(e, "EndpointId")) },
            "none" in d ? { dsp: null, why: d.none } : { dsp: d.on }));
        }
        return { native: true, found: true, outputs };
      }, READ_TURN_MS);
      return out.notSent ? { native: true, found: false, why: out.notSent, outputs: [] } : out;
    },

    /**
     * An output's DSP on or off: its config read afresh, SetEnabled sent, then read again until it shows.
     * @param {string} zoneId @param {string} output  the output's name @param {boolean} on
     */
    async setDsp(zoneId, output, on) {
      const no = off();
      if (no) return no;
      if (typeof on !== "boolean") return { notSent: "DSP is on or off." };
      /** @type {any} */
      const sent = await inTurn(async (s) => {
        const z = zoneById(s.graph, zoneId);
        if (!z) return { notSent: "Your server doesn't list that zone now." };
        const named = endpointsOf(s.graph, z).filter((/** @type {any} */ e) => field(e, "Name") === output);
        if (named.length !== 1) return { notSent: `Rouen couldn't tell which of the zone's outputs is "${output}".` };
        const d = await dspOf(s, named[0]);
        if ("none" in d) return { notSent: d.none };
        try {
          const res = await s.g.call(d.oid, SIG.dspEnabled, w().boolean(on).toBuffer());
          if (!res.success) return { notSent: `Your server refused it (${res.status}).` };
        } catch (e) {
          return Object.assign(failed(e), { endpoint: named[0] });
        }
        return { sent: true, endpoint: named[0] };
      }, turnMs);
      if (sent.notSent) return { notSent: sent.notSent };
      for (const until = now() + waitMs; ;) {
        /** @type {any} */
        // A read that fails is no sight of it yet: it was sent, so it is said as sent and not seen, never as not sent.
        const got = await inTurn(async (s) => dspOf(s, sent.endpoint), turnMs).catch(() => null);
        if (got && got.on === on) return { seen: true, dsp: on };
        if (now() >= until) break;
        await new Promise((r) => { setTimeout(r, dspPollMs); });
      }
      const why = (sent.maybe ? sent.maybe + " " : "") + `Your server took it, but its DSP didn't show it within ${Math.round(waitMs / 1000)} s.`;
      log(`zone dsp: sent, not seen: ${why}`);
      return { seen: false, why };
    },
  };
}

module.exports = { createZoneControls, planOf, shows, LEVELING };
