// @ts-check
"use strict";
/*
 * settings-probe.js — N3-3a (dev/design/native-remote.md §15.1, v1.9.66): the zones probe's two additions, each asked
 * for by hand.
 *
 *   watchPushes   every push to the objects watched, and to any object of the probe's kinds that comes meanwhile (a
 *                 DspConfig read, a zone made by grouping), for a while: when, which object, its kind (PUSHOBJ 3 or
 *                 UPDATEOBJ 5), whether it carried its identity member (a Zone's ZoneId, an Endpoint's EndpointId; null
 *                 for a type whose identity member isn't known), and the members it carried.
 *                 It calls nothing. What it settles: how a member back at its default reaches Rouen (§14.2).
 *   readSettings  each audio device's AudioDeviceCommonConfig asked GetConfigInfo (an answer by value, decoded by the
 *                 graph's own reader) and GetDspConfig (an answer by reference: the DspConfig object the server then
 *                 pushes, waited for as it comes with the answer). Reads; nothing is changed. Once a call goes
 *                 unanswered (the connection's uncertain), the rest are not sent: said skipped.
 *
 *   dspDetail     (v1.9.66-t3, §15.2) a device's DSP config whole — its lists, their items, the presets, under the
 *                 server's own names — from what was pushed with it: no call added.
 *
 * Values are said as smart-probe.js's describe() says them; an answer the graph can't decode is given as its first
 * HEX_MAX bytes in hex, for the design to read (the one place this probe gives bytes).
 */
const { BinaryReader } = require("./wire");
const { SIG } = require("./methods");
const { P, field, isRef, waitFor } = require("./objects");
const { describe, member } = require("./smart-probe");

const MAX_PUSHES = 200, MAX_DEVICES = 20, HEX_MAX = 256, MAX_ITEMS = 30, WHOLE_DEPTH = 4;
/** The types the zones probe lists and watches: what a zone, its outputs and their devices may be carried by. */
const KINDS = /Zone|Endpoint|Transport|Display|Output|SourceControl|AudioDevice|Dsp|Queue/;
/** The member that names an object for good, by its type: a push carrying it is the whole object (§15). */
const IDENTITY = /** @type {Record<string, string>} */ ({ Zone: "ZoneId", Endpoint: "EndpointId" });
/** The push kinds, as frame.js numbers them. @type {Record<number, string>} */
const KIND = { 3: "PUSHOBJ", 4: "PUSHSTUB", 5: "UPDATEOBJ" };
/** A member's short name. @param {string} k */
const short = (k) => k.slice(k.lastIndexOf("::") + 2);
/** A type's short name. @param {string} t */
const typeShort = (t) => t.replace(/^Sooloos\.Broker\.Api\./, "");
/** How an object is named. @param {any} o */
const nameOf = (o) => `${typeShort(o.typeName)} "${field(o, "Name") ?? String(o.oid)}"`;
/** Every member of an object (or of the fields one push carried), described. @param {any} graph @param {Record<string, any>} fields */
const membersOf = (graph, fields) => Object.fromEntries(Object.keys(fields).filter((k) => k !== "$items" && k !== "$count")
  .map((k) => [short(k), describe(graph, fields[k])]));

/**
 * Every push to the objects watched, and to any object of KINDS meanwhile, for `ms`. Calls nothing; the watcher is gone
 * when it returns.
 * @param {any} graph @param {any[]} objs @param {number} ms
 * @returns {Promise<{ seconds: number, pushes: any[], more: number }>}
 */
async function watchPushes(graph, objs, ms) {
  const watched = new Set(objs.map((o) => String(o.oid)));
  const isWatched = (/** @type {any} */ o) => watched.has(String(o.oid)) || KINDS.test(typeShort(o.typeName));
  const t0 = Date.now();
  /** @type {any[]} */
  const pushes = [];
  let more = 0;
  const w = (/** @type {any} */ o, /** @type {Record<string, any>} */ pushed, /** @type {number | undefined} */ cmd) => {
    if (!isWatched(o)) return;
    if (pushes.length >= MAX_PUSHES) { more++; return; }
    const id = IDENTITY[typeShort(o.typeName)];
    pushes.push({ ms: Date.now() - t0, object: nameOf(o), kind: KIND[cmd ?? -1] || String(cmd),
      identity: id ? Object.keys(pushed).some((k) => k.endsWith("::" + id)) : null, members: membersOf(graph, pushed) });
  };
  graph.watchers.add(w);
  try {
    await new Promise((r) => { setTimeout(r, ms); });
  } finally {
    graph.watchers.delete(w);
  }
  return { seconds: Math.round(ms / 1000), pushes, more };
}

/**
 * An answer, decoded by the graph's own reader: a value (a struct, or null), or the object it names once pushed; else
 * its bytes. The object is waited for as it comes with the answer (pushed since the call: `fresh`), not as the graph
 * held it before; when it doesn't come, what the graph held is given, said so.
 * @param {any} graph @param {Buffer} payload @param {number} waitMs @param {Set<string>} [fresh]  oids pushed since the call
 */
async function answer(graph, payload, waitMs, fresh) {
  const r = new BinaryReader(payload);
  /** @type {any} */
  let v;
  let why = null;
  // Not silent: the reader's error is said in the answer, beside its bytes.
  try { v = graph.readValue(r, P.Object); } catch (e) { why = String(e && /** @type {any} */ (e).message); v = undefined; }
  const trailing = why === null ? r.remaining : 0;
  const bytes = () => ({ undecoded: true, why, bytes: payload.length, hex: payload.subarray(0, HEX_MAX).toString("hex") });
  if (trailing > 0) return Object.assign(bytes(), { why: `${trailing} byte(s) after the value` });
  if (v && isRef(v)) {
    const key = String(v.$ref);
    // waitFor waits while its read answers undefined.
    const o = await waitFor(waitMs, () => { const x = graph.get(v.$ref); return x && x.loaded && (!fresh || fresh.has(key)) ? x : undefined; });
    const held = o || graph.get(v.$ref);
    if (!held || !held.loaded) return { object: "named, never pushed", oid: key };
    return Object.assign({ object: typeShort(held.typeName), oid: key, members: membersOf(graph, held.fields) },
      o ? {} : { pushedWithAnswer: false });
  }
  if (v && typeof v === "object" && "$type" in v) return describe(graph, v);
  if (v === null || (v !== undefined && typeof v !== "object")) return { value: v };
  return bytes();
}

/**
 * An object named by reference, whole: its type, every member under the server's own name — one it names given whole
 * too — and a list's items each the same, to WHOLE_DEPTH levels and MAX_ITEMS a list (a list cut short says so).
 * Below that, describe()'s way; a value, as smart-probe.js decodes one. An object met before is named, not repeated.
 * @param {any} graph @param {any} ref @param {Set<string>} seen @param {number} [depth] @param {string} [name]
 * @returns {any}
 */
function whole(graph, ref, seen, depth = 0, name = "") {
  if (!isRef(ref)) return member(graph, name, ref, 0);
  const key = String(ref.$ref), o = graph.get(ref.$ref);
  if (!o || !o.loaded) return { object: "named, never pushed", oid: key };
  if (depth >= WHOLE_DEPTH) return describe(graph, ref);
  if (seen.has(key)) return { object: typeShort(o.typeName), oid: key, seen: true };
  seen.add(key);
  const out = /** @type {Record<string, any>} */ ({ object: typeShort(o.typeName), oid: key, members: Object.fromEntries(Object.keys(o.fields)
    .filter((k) => k !== "$items" && k !== "$count").map((k) => [short(k), whole(graph, o.fields[k], seen, depth + 1, k)])) });
  const items = o.fields.$items;
  if (Array.isArray(items)) {
    out.count = items.length;
    if (o.fields.$count === -1) out.cut = "Not all of this list arrived.";
    if (items.length > MAX_ITEMS) out.more = items.length - MAX_ITEMS;
    out.items = items.slice(0, MAX_ITEMS).map((/** @type {any} */ x) => whole(graph, x, seen, depth + 1));
  }
  return out;
}
/** Whether a read whole still names an object the server hasn't pushed. @param {any} v @returns {boolean} */
const missing = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? String(x) : x)).includes('"named, never pushed"');

/**
 * A device's DSP config whole (v1.9.66-t3, §15.2) — its lists, their items, the presets, under the server's own
 * names — from the graph, waited for while what it names is still arriving. Calls nothing.
 * @param {any} graph @param {string} oid  the DspConfig's @param {number} waitMs
 */
async function dspDetail(graph, oid, waitMs) {
  const read = () => whole(graph, { $ref: BigInt(oid) }, new Set());
  // waitFor waits while its read answers undefined.
  return (await waitFor(waitMs, () => { const d = read(); return missing(d) ? undefined : d; })) || read();
}

/**
 * Each audio device's settings and DSP, read through its AudioDeviceCommonConfig, in the caller's turn; what was sent
 * counted as sent. Once the connection is uncertain (a call unanswered), nothing more is sent (the review).
 * @param {any} s  the session @param {any[]} devices  audio device objects (each with its CommonConfig)
 * @param {{ waitMs?: number }} [opts]
 * @returns {Promise<{ rows: any[], calls: number }>}
 */
async function readSettings(s, devices, opts = {}) {
  const waitMs = opts.waitMs ?? 1500;
  const rows = [];
  let calls = 0;
  for (const d of devices.filter((x) => isRef(field(x, "CommonConfig"))).slice(0, MAX_DEVICES)) {
    const cfg = field(d, "CommonConfig").$ref;
    /** @type {Record<string, any>} */
    const row = { device: field(d, "Name") ?? null, type: typeShort(d.typeName), config: String(cfg) };
    for (const [key, sig] of /** @type {Array<[string, string]>} */ ([["configInfo", SIG.configInfo], ["dspConfig", SIG.dspConfig]])) {
      if (s.g.uncertain()) { row[key] = { skipped: "An earlier call went unanswered; nothing more was sent." }; continue; }
      /** @type {Set<string>} */
      const fresh = new Set();
      const seen = (/** @type {any} */ x) => { fresh.add(String(x.oid)); };
      s.graph.watchers.add(seen);
      try {
        calls++;
        const res = await s.g.call(cfg, sig, Buffer.alloc(0));
        row[key] = res.success ? await answer(s.graph, res.payload, waitMs, fresh) : { refused: res.status };
      } catch (e) {
        row[key] = { error: String(e && /** @type {any} */ (e).message) };
      } finally {
        s.graph.watchers.delete(seen);
      }
    }
    // The DSP config whole (§15.2): on its own, so a fault here leaves the read above as it was (the review).
    const dc = row.dspConfig;
    if (dc && dc.object === "DspConfig") {
      try {
        row.dsp = Object.assign(await dspDetail(s.graph, dc.oid, waitMs), dc.pushedWithAnswer === false ? { pushedWithAnswer: false } : {});
      } catch (e) {
        row.dsp = { error: String(e && /** @type {any} */ (e).message) };
      }
    }
    rows.push(row);
  }
  return { rows, calls };
}

module.exports = { watchPushes, readSettings, answer, dspDetail, MAX_PUSHES, KINDS, short, typeShort, nameOf, membersOf };
