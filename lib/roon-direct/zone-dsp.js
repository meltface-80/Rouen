// @ts-check
"use strict";
/*
 * zone-dsp.js — N3-4 (dev/design/native-remote.md §15.9, v1.9.66-t9): each DSP item of a zone's outputs, as MUSE shows
 * them — headroom, sample-rate conversion, crossfeed, the EQs, convolution — read from your server and turned on or
 * off, one at a time, as Roon's own apps do.
 *
 * Read: each output's DspConfig asked for (GetDspConfig) at every read — the server sends a device's DSP, and its later
 * updates, only to a connection that has asked (§15.9) — then read as the graph holds it, where a DspConfigItem's
 * update is the item whole (objects.js IDENTITY): IsEnabled left out is off. Each output's call takes the connection's
 * turn on its own, and what came is waited for outside it, so a zone setting or transport changed meanwhile is not
 * kept waiting (the review).
 * Changed: DspConfigItem::SetEnabled, sent once, in the connection's turn, only for an item of an output of that zone
 * — found in what a read on this connection found, or read first — that can be switched, and believed only when the
 * item shows it within WAIT_MS. Never sent twice; there is no official API to fall back to.
 *
 * A change answers one of:
 *   { seen: true, item }   sent, and the server showed it (the item as it now holds it)
 *   { notSent: why }       nothing reached the server
 *   { seen: false, why }   sent (or maybe sent), not shown in time: said, not sent again
 */
const { BinaryWriter } = require("./wire");
const { SIG } = require("./methods");
const { field, isRef, waitFor, shortType, DSP_PARTS } = require("./objects");
const { answer } = require("./settings-probe");
const { zoneById, hex } = require("./zone-settings");
const { failed, turnRunner } = require("./zone-controls");
const { settingsOf } = require("./dsp-parts");

const WAIT_MS = 3000, POLL_MS = 100, TURN_MS = 500, READ_TURN_MS = 5000, HELD_MS = 1500, MAX_OUTPUTS = 8;
/** A DspConfig's three lists of items, in the order MUSE shows them. */
const LISTS = ["BeforeItems", "Items", "AfterItems"];
/** An item's name, by the part it carries (objects.js DSP_PARTS, the catalogue's), as MUSE names it (§15.9). */
const PARTS = Object.freeze(/** @type {Record<string, string>} */ ({
  HeadroomAdjustment: "Headroom management", SampleRateConversion: "Sample rate conversion", BS2B: "Crossfeed",
  ParametricEqualizer: "Parametric EQ", PEQ: "Procedural EQ", OpenHeadphoneDatabase: "Headphone EQ", Convolution: "Convolution",
  SpeakerSetup: "Speaker setup", AudezePresets: "Audeze presets", AudezeSpatializer: "Audeze spatializer", Radiance: "Radiance",
  SonarworksSR: "Sonarworks",
}));
/** An item's own members, which name no part. */
const OWN = new Set(["SupportsSetEnabled", "SupportsRemove", "IsEnabled"]);
const NONE = Buffer.alloc(0);
const NOT_ALL = "Your server hasn't sent all of this output's DSP.";

/**
 * The object a member names: the object, held; "missing" when it is named and not held (not yet pushed); null when
 * nothing is named.
 * @param {any} graph @param {any} o @param {string} name
 */
function follow(graph, o, name) {
  const v = field(o, name);
  if (!isRef(v)) return null;
  const x = graph.get(v.$ref);
  return x && x.loaded ? x : "missing";
}
/** The zone's own endpoints, as transport takes them (§14.3). @param {any} graph @param {any} zone */
const endpointsOf = (graph, zone) => graph.ofType("Endpoint").filter((/** @type {any} */ e) => { const r = e.loaded && field(e, "Zone"); return r && r.$ref === zone.oid; });

/**
 * An item as the window reads it: its own, and its settings from its part as held (§15.12). One shape for every answer
 * (the review). @param {any} graph @param {any} o
 */
function withSettings(graph, o) {
  const st = settingsOf(graph, o);
  return st ? Object.assign(itemOf(o), { settings: st }) : itemOf(o);
}

/**
 * A DspConfigItem as read: its id, its name, whether it is on and whether it can be switched. A part carried inline is
 * named as one carried by reference (the review). Pure.
 * @param {any} o @returns {{ id: string, name: string, on: boolean, can: boolean }}
 */
function itemOf(o) {
  const part = DSP_PARTS.find((k) => field(o, k) != null);
  const other = Object.keys(o.fields).map((k) => k.slice(k.lastIndexOf("::") + 2)).find((n) => !OWN.has(n));
  return { id: String(o.oid), name: part ? PARTS[part] : other || "DSP item", on: field(o, "IsEnabled") === true, can: field(o, "SupportsSetEnabled") === true };
}

/**
 * A DspConfig's items, as the graph holds them, or why not: a list or an item not held (never pushed, or cut short).
 * With `full`, each with its settings — only for an answer, not for every wait or search (the review). Pure over the graph.
 * @param {any} graph @param {any} cfg @param {boolean} [full]
 * @returns {{ items: Array<any> } | { why: string }}
 */
function itemsOf(graph, cfg, full) {
  if (!cfg || !cfg.loaded) return { why: NOT_ALL };
  const items = [];
  for (const list of LISTS) {
    const l = follow(graph, cfg, list);
    if (l === null) continue;   // a list this config doesn't carry: no items of it
    // a list cut short reads fewer items than its count (objects.js says -1), never taken for the whole (the review)
    if (l === "missing" || !Array.isArray(l.fields.$items) || l.fields.$items.length !== l.fields.$count) return { why: NOT_ALL };
    for (const x of l.fields.$items) {
      const o = isRef(x) ? graph.get(x.$ref) : null;
      if (!o || !o.loaded || shortType(o.typeName) !== "DspConfigItem") return { why: NOT_ALL };
      items.push(full ? withSettings(graph, o) : itemOf(o));
    }
  }
  return { items };
}

/**
 * Where an output's DSP is asked: its device's CommonConfig; none (an output whose device shares no settings has no
 * items); or why not, when the device or its settings are named and not yet held (the review: never taken for none).
 * @param {any} graph @param {any} endpoint
 * @returns {{ common: any } | { none: true } | { why: string }}
 */
function commonOf(graph, endpoint) {
  const dev = follow(graph, endpoint, "Device");
  if (dev === null) return { none: true };
  if (dev === "missing") return { why: "Your server hasn't sent this output's device yet." };
  const common = follow(graph, dev, "CommonConfig");
  if (common === null) return { none: true };
  if (common === "missing") return { why: "Your server hasn't sent this output's device settings yet." };
  return { common };
}

/**
 * @param {{ link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>, on: () => boolean,
 *           log?: (line: string) => void, now?: () => number, waitMs?: number, pollMs?: number, turnMs?: number,
 *           heldMs?: number }} deps
 */
function createZoneDsp(deps) {
  const log = deps.log || (() => {});
  const now = deps.now || Date.now;
  const waitMs = deps.waitMs ?? WAIT_MS, pollMs = deps.pollMs ?? POLL_MS, turnMs = deps.turnMs ?? TURN_MS;
  const heldMs = deps.heldMs ?? HELD_MS;
  const inTurn = turnRunner(deps);
  /** Per connection, each CommonConfig's DspConfig as a read found it (the review: a change needs no call to find its item). */
  const found = new WeakMap();

  /**
   * One output's DSP: GetDspConfig on its CommonConfig in a turn of its own; what came waited for outside it.
   * @param {bigint} endpointOid
   * @returns {Promise<{ items: Array<ReturnType<typeof itemOf>>, common?: string } | { why: string }>}
   */
  async function outputDsp(endpointOid) {
    /** @type {any} */
    const asked = await inTurn(async (s) => {
      const e = s.graph.get(endpointOid);
      if (!e || !e.loaded) return { why: "Your server doesn't list this output now." };
      const c = commonOf(s.graph, e);
      if (!("common" in c)) return c;
      try {
        return { s, common: c.common.oid, res: await s.g.call(c.common.oid, SIG.dspConfig, NONE) };
      } catch (err) {
        return { why: `Your server didn't say (${err && /** @type {any} */ (err).message}).` };
      }
    }, READ_TURN_MS);
    if (asked.notSent) return { why: asked.notSent };
    if (asked.none) return { items: [] };
    if (asked.why) return { why: asked.why };
    const { s, res } = asked;
    if (!res.success) return { why: `Your server refused to say (${res.status}).` };
    const a = /** @type {any} */ (await answer(s.graph, res.payload, heldMs));
    if (!a || a.object !== "DspConfig") return { why: "Your server sent no DSP for this output." };
    const cfg = s.graph.get(BigInt(a.oid));
    /** @type {any} */
    let last = { why: NOT_ALL };
    const got = await waitFor(heldMs, () => { last = itemsOf(s.graph, cfg); return "items" in last ? last : undefined; });
    if (!got) return last;
    if (!found.has(s)) found.set(s, new Map());
    found.get(s).set(String(asked.common), cfg.oid);
    return Object.assign(itemsOf(s.graph, cfg, true), { common: String(asked.common) });
  }

  /**
   * Whether an item is one of the zone's outputs' items: found in what a read on this connection found, or, an output
   * not read on it, read first (calls, each in a turn of its own). For a switch and for a setting (dsp-settings.js); with
   * the output's CommonConfig, where a Parametric EQ is read afresh (peq.js, §15.15).
   * @param {string} zoneId @param {string} itemId
   * @returns {Promise<{ here: true, common?: string } | { notSent: string }>}
   */
  async function locate(zoneId, itemId) {
    /** @type {any} */
    const where = await inTurn(async (s) => {
      const zone = zoneById(s.graph, zoneId);
      if (!zone) return { notSent: "Your server doesn't list that zone now." };
      const unread = [];
      for (const e of endpointsOf(s.graph, zone).slice(0, MAX_OUTPUTS)) {
        const c = commonOf(s.graph, e);
        const cfg = "common" in c && found.has(s) ? found.get(s).get(String(c.common.oid)) : undefined;
        const d = cfg === undefined ? null : itemsOf(s.graph, s.graph.get(cfg));
        if (d && "items" in d && d.items.some((x) => x.id === itemId)) return { here: true, common: String(/** @type {any} */ (c).common.oid) };
        if (!d || !("items" in d)) unread.push(e.oid);
      }
      return { unread };
    }, turnMs);
    if (where.notSent) return { notSent: where.notSent };
    if (where.here) return { here: true, common: where.common };
    let why = null;
    for (const oid of where.unread) {
      const d = await outputDsp(oid);
      if ("items" in d) { if (d.items.some((x) => x.id === itemId)) return { here: true, common: d.common }; } else why = d.why;
    }
    // not among them: said as such, or, when an output couldn't be read, why (the review: a closed connection said)
    return { notSent: why || "That DSP item isn't one of this zone's outputs' now." };
  }

  return {
    locate,

    /**
     * Each output of the zone, and its DSP items (calls, read when the sheet opens).
     * @param {string} zoneId
     */
    async read(zoneId) {
      if (!deps.on()) return { native: false, why: "Native mode is off." };
      /** @type {any} */
      const z = await inTurn(async (s) => {
        const zone = zoneById(s.graph, zoneId);
        if (!zone) return { found: false };
        return { found: true, outputs: endpointsOf(s.graph, zone).slice(0, MAX_OUTPUTS)
          .map((/** @type {any} */ e) => ({ oid: e.oid, output: field(e, "Name") ?? null, id: hex(field(e, "EndpointId")) })) };
      }, READ_TURN_MS);
      if (z.notSent) return { native: true, found: false, why: z.notSent, outputs: [] };
      if (!z.found) return { native: true, found: false, outputs: [] };
      const outputs = [];
      for (const o of z.outputs) {
        // One output's read failing is said for it, not lost for the rest.
        const d = await outputDsp(o.oid);
        outputs.push(Object.assign({ output: o.output, id: o.id }, "items" in d ? { items: d.items } : { why: d.why }));
      }
      return { native: true, found: true, outputs };
    },

    /**
     * One DSP item on or off: found among the zone's outputs' items as read on this connection (an output not read on
     * it is read first), then sent and watched for.
     * @param {string} zoneId @param {string} itemId  as read @param {boolean} on
     */
    async set(zoneId, itemId, on) {
      if (!deps.on()) return { notSent: "Native mode is off." };
      if (typeof on !== "boolean") return { notSent: "A DSP item is on or off." };
      if (typeof itemId !== "string" || !/^\d{1,20}$/.test(itemId)) return { notSent: "Which DSP item?" };
      const where = await locate(zoneId, itemId);
      if ("notSent" in where) return where;
      /** @type {any} */
      const sent = await inTurn(async (s) => {
        const o = s.graph.get(BigInt(itemId));
        if (!o || !o.loaded) return { notSent: "That DSP item isn't one of this zone's outputs' now." };
        if (!itemOf(o).can) return { notSent: "Your server doesn't let this item be turned on or off." };
        try {
          const res = await s.g.call(BigInt(itemId), SIG.dspItemEnabled, new BinaryWriter().boolean(on).toBuffer());
          if (!res.success) return { notSent: `Your server refused it (${res.status}).` };
        } catch (e) {
          // An answered call that never came back may still have been taken: watched for, never assumed not sent.
          return failed(e);
        }
        return { sent: true };
      }, turnMs);
      if (sent.notSent) return { notSent: sent.notSent };
      for (const until = now() + waitMs; ;) {
        const s = deps.link ? deps.link.session() : null;
        const o = s && s.graph ? s.graph.get(BigInt(itemId)) : null;
        if (o && o.loaded && itemOf(o).on === on) return { seen: true, item: withSettings(s.graph, o) };
        if (now() >= until) break;
        await new Promise((r) => { setTimeout(r, pollMs); });
      }
      const why = (sent.maybe ? sent.maybe + " " : "") + `Your server took it, but the item didn't show it within ${Math.round(waitMs / 1000)} s.`;
      log(`zone dsp item: sent, not seen: ${why}`);
      return { seen: false, why };
    },
  };
}

module.exports = { createZoneDsp, itemOf, itemsOf, withSettings, PARTS };
