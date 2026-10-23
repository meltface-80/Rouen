// @ts-check
"use strict";
/*
 * zone-controls.js — N3-3c (dev/design/native-remote.md §15.7, v1.9.66-t7): a zone's crossfade, volume levelling, its
 * target and the sleep timer changed on your server's own Zone, as Roon's own apps do. Each change is sent once, in the
 * connection's turn, and believed only when the server shows it within WAIT_MS: the Zone, pushed whole, holding the
 * value asked. Nothing is ever sent twice, and there is no official API to fall back to for any of these.
 * t7's DSP on/off is gone in t8 (§15.8): it was DspConfig's own IsEnabled, a master MUSE never shows, and it was read
 * from pushes the server sends only once a connection.
 *
 * Each change answers one of:
 *   { seen: true, settings }         sent, and the server showed it (what it now holds)
 *   { notSent: why }                 nothing reached the server
 *   { seen: false, why }             sent (or maybe sent), not shown in time: said, not sent again
 */
const { BinaryWriter } = require("./wire");
const { SIG } = require("./methods");
const { settingsOf, zoneById } = require("./zone-settings");

const WAIT_MS = 3000, POLL_MS = 100, TURN_MS = 500;
/** VolumeLeveling, the catalogue's enum (§15.7). */
const LEVELING = Object.freeze(/** @type {Record<string, number>} */ ({ off: 0, track: 1, album: 2, auto: 3 }));
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

/**
 * @param {{ link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>, on: () => boolean,
 *           log?: (line: string) => void, now?: () => number, waitMs?: number, pollMs?: number, turnMs?: number }} deps
 */
function createZoneControls(deps) {
  const log = deps.log || (() => {});
  const now = deps.now || Date.now;
  const waitMs = deps.waitMs ?? WAIT_MS, pollMs = deps.pollMs ?? POLL_MS, turnMs = deps.turnMs ?? TURN_MS;

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
  };
}

module.exports = { createZoneControls, planOf, shows, LEVELING };
