// @ts-check
"use strict";
/*
 * peq-try.js — N3-5b (dev/design/native-remote.md §15.14, v1.9.66-t14): one change to a zone's Parametric EQ, tried by
 * hand before anything is built on it, as smart-update.js's was (§12.9).
 *
 * A parametric EQ is changed whole: ParametricEqualizerItem::SetSpec(ParametricEqualizerSpec, bool) carries every band.
 * So the spec sent is the one Rouen holds, with one band's gain changed; and Rouen's copy is as the server sent it when
 * Rouen asked, not as MUSE has changed it since (§15.13). The preview shows the bands held and the spec it would send,
 * to be compared with MUSE; it sends nothing — not even a type's declaration (the review). With send=1, sent once.
 *
 * The spec is written with the members the owner's server itself declared for it (the graph's types, in its order),
 * each band an inline value as it came. Two checks before anything is sent: the bands held, written again under the
 * server's own type ids, are the very bytes it sent (else Rouen didn't read them whole, and won't send them back
 * short: the review); and the spec written reads back, by the same reader, as the spec meant. What came back — the
 * call's answer, and each update of the item for WAIT_MS after — is said, for the design (§15.13).
 */
const { BinaryReader, BinaryWriter } = require("./wire");
const { SIG, inlineStruct } = require("./methods");
const { ObjectGraph, P, field, isRef, shortType, codecFor } = require("./objects");
const { readList, elementOf, FOCUS_ENUMS } = require("./focus");
const { deep } = require("./deep-value");
const { failed, turnRunner } = require("./zone-controls");

const WAIT_MS = 5000, TURN_MS = 500, GAIN_LIMIT = 24;
/** The band types whose gain MUSE shows (§15.13): a shelf, a peak/dip. */
const GAIN_TYPES = Object.freeze(["low_shelf", "high_shelf", "equalize_frequency"]);

/** The server's own declaration of a type, by its full name, as the graph holds it (the review: never another of the same short name). @param {any} graph @param {string} name */
function declared(graph, name) {
  for (const t of graph.types.values()) if (t.name === name) return t;
  return null;
}
/** A member's full name on a value, by its short name. @param {Record<string, any>} v @param {string} short */
const keyOf = (v, short) => Object.keys(v).find((k) => k.endsWith("::" + short));
/** A plain value's member, by its short name, as objects.js field() reads an object's. @param {Record<string, any>} v @param {string} short */
const get = (v, short) => field(/** @type {any} */ ({ fields: v }), short);
/** Types declared here only, never on the connection: a preview's, and the check against the server's own bytes. */
const local = () => { const ids = new Map(); return { defineType: (/** @type {string} */ name) => { if (!ids.has(name)) ids.set(name, 1000 + ids.size); return ids.get(name); } }; };
/** The server's own type ids, by name: to write what it sent as it sent it. @param {any} graph */
const servers = (graph) => ({ defineType: (/** @type {string} */ name) => { const d = declared(graph, name); if (!d) throw new Error(`Your server hasn't declared ${shortType(name)}.`); return d.id; } });
/** A value, its members under their short names, to be read. @param {any} v @returns {any} */
const shortly = (v) => (Array.isArray(v) ? v.map(shortly) : v && typeof v === "object"
  ? Object.fromEntries(Object.keys(v).map((k) => [k === "$type" ? k : k.split("::").pop(), k === "$type" ? shortType(String(v[k])) : shortly(v[k])])) : v);

/**
 * A value as plain data: an inline struct's members by their full names, a list's bytes as its items. One that can't be
 * read whole is refused, never guessed.
 * @param {any} graph @param {string} fullName @param {any} v
 * @returns {any}
 */
function plainOf(graph, fullName, v, exact = false) {
  if (Buffer.isBuffer(v)) {
    const l = readList(graph, fullName, v);
    const whole = () => new Error(`Rouen can't read ${fullName.split("::").pop()} whole.`);
    if (!l || !l.whole || l.count === null) throw whole();
    const items = l.items.map((x) => plainOf(graph, "", x, exact));
    // written again under the server's own ids, the very bytes it sent: else a member was passed over unread
    if (exact && !writer(servers(graph), graph).list(fullName, items).subarray(-v.length).equals(v)) throw whole();
    return items;
  }
  if (v && typeof v === "object" && !isRef(v)) {
    if (!("$type" in v)) throw new Error("Your server sent a value of a type it never declared.");
    return Object.fromEntries(Object.keys(v).map((k) => [k, k === "$type" ? v[k] : plainOf(graph, k, v[k], exact)]));
  }
  if (isRef(v)) throw new Error("The spec names another object; Rouen doesn't write that.");
  return v;
}

/**
 * Writes plain data back as the server declared it: each struct under the server's own member list (a type of the
 * same name and members, declared by `g`: the connection's, methods.js inlineStruct, or local/servers above), a list as
 * its length, count and items.
 * @param {{ defineType(name: string, members: any[]): number }} g @param {any} graph  the server's types
 */
function writer(g, graph) {
  /** The types written, by name, so the bytes can be read back. @type {Map<string, any>} */
  const used = new Map();
  /** @param {number} t @param {string} fullName @param {any} v @returns {Buffer} */
  function value(t, fullName, v) {
    const w = new BinaryWriter();
    const num = typeof v === "number" && Number.isFinite(v);
    if ((t === P.Int || t === P.Char || t === P.Enum) && Number.isInteger(v)) return w.integer(v).toBuffer();
    if (t === P.Bool && typeof v === "boolean") return w.boolean(v).toBuffer();
    if (t === P.Double && num) return w.double(v).toBuffer();
    if (t === P.String && (typeof v === "string" || v === null)) return w.string(v).toBuffer();
    if ((t === P.NullableInt || t === P.NullableEnum) && (v === null || Number.isInteger(v))) return (v === null ? w.boolean(false) : w.boolean(true).integer(v)).toBuffer();
    if (t === P.NullableDouble && (v === null || num)) return (v === null ? w.boolean(false) : w.boolean(true).double(v)).toBuffer();
    if ((t === P.LengthPrefixed || t === P.ByteArray) && Array.isArray(v) && elementOf(fullName)) return list(fullName, v);
    if (t === P.Object && v === null) return w.long(0).toBuffer();
    if (t === P.Object && v && typeof v === "object" && "$type" in v) return struct(v);
    throw new Error(`Rouen can't write ${fullName.split("::").pop() || "a value"} as your server declared it.`);
  }
  /** A list as its length, count and items, each by the codec focus.js readList reads it with. @param {string} fullName @param {any[]} v */
  function list(fullName, v) {
    const inner = new BinaryWriter().integer(v.length);
    const codec = codecFor(/** @type {string} */ (elementOf(fullName)), FOCUS_ENUMS);
    for (const x of v) inner.bytes(value(codec, "", x));
    const b = inner.toBuffer();
    return new BinaryWriter().integer(b.length).bytes(b).toBuffer();
  }
  /** @param {Record<string, any>} v */
  function struct(v) {
    const def = declared(graph, String(v.$type));
    if (!def) throw new Error(`Your server hasn't declared ${shortType(String(v.$type))}.`);
    used.set(def.name, def);
    const values = Object.keys(v).filter((k) => k !== "$type").map((k) => {
      const m = def.members.find((/** @type {any} */ x) => x.name === k);
      if (!m) throw new Error(`${shortType(def.name)} has no member ${k}.`);
      return /** @type {[string, Buffer]} */ ([k, value(m.propType, k, v[k])]);
    });
    return inlineStruct(g, { name: def.name, members: def.members.map((/** @type {any} */ m) => [m.name, m.propType]) }, values);
  }
  /**
   * The bytes, read back by a graph that knows the types as we declared them: what they hold, as plain data.
   * @param {Buffer} bytes
   */
  function readBack(bytes) {
    const scratch = new ObjectGraph();
    for (const def of used.values()) {
      const id = g.defineType(def.name, def.members);
      scratch.types.set(id, { id, name: def.name, members: def.members });
    }
    const r = new BinaryReader(bytes);
    const v = scratch.readValue(r, P.Object);
    if (r.remaining) throw new Error("The spec written has bytes left over.");
    return plainOf(scratch, "", v);
  }
  return { struct, list, readBack };
}

/** Plain data as text, its keys in order, so two can be compared. @param {any} v @returns {string} */
const text = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : typeof x === "bigint" ? String(x) : x));

/** A band as said: its type, frequency, gain and Q. @param {Record<string, any>} b @param {number} n */
const said = (b, n) => ({ band: n, type: get(b, "Type") ?? null, frequency: get(b, "Frequency") ?? null, gainDb: get(b, "GainDb") ?? null,
  q: get(b, "Q") ?? null, on: get(b, "IsEnabled") === true });

/**
 * @param {{ zoneDsp: { read(zoneId: string): Promise<any> }, link: { session(): any } | null,
 *           inTurn: <T>(fn: () => Promise<T>) => Promise<T>, on: () => boolean, zones: () => any[], log?: (line: string) => void,
 *           waitMs?: number, turnMs?: number }} deps
 */
function createPeqTry(deps) {
  const log = deps.log || (() => {});
  const waitMs = deps.waitMs ?? WAIT_MS, turnMs = deps.turnMs ?? TURN_MS;
  const inTurn = turnRunner(deps);
  let busy = false;

  /**
   * The zone's one Parametric EQ item, as a read on this connection finds it.
   * @param {string} zone  its name or id
   */
  async function find(zone) {
    const z = (deps.zones() || []).find((x) => x.zone_id === zone || x.display_name === zone);
    if (!z) return { error: `No zone called ${zone} now.` };
    const d = await deps.zoneDsp.read(z.zone_id);
    if (!d.native) return { error: d.why || "Native mode is off." };
    if (!d.found) return { error: d.why || "Your server doesn't list that zone now." };
    const peqs = (d.outputs || []).flatMap((/** @type {any} */ o) => (o.items || []).filter((/** @type {any} */ it) => it.name === "Parametric EQ")
      .map((/** @type {any} */ it) => ({ output: o.output, item: it.id })));
    // an output not read says why, rather than its EQ said absent (the review)
    const unread = (d.outputs || []).find((/** @type {any} */ o) => o.why);
    if (!peqs.length && unread) return { error: `${unread.output}: ${unread.why}` };
    if (peqs.length !== 1) return { error: peqs.length ? "That zone has more than one Parametric EQ; Rouen tries one at a time." : "That zone has no Parametric EQ now." };
    return { zone: z.display_name, zoneId: z.zone_id, ...peqs[0] };
  }

  return {
    /**
     * One band's gain changed: previewed, or (send) sent once and what came back said.
     * @param {{ zone: string, band: number, gain: number, save: boolean, send: boolean }} a
     */
    async run(a) {
      if (!deps.on()) return { error: "Native mode is off." };
      if (!Number.isInteger(a.band) || a.band < 1) return { error: "band takes a band's number, from 1." };
      if (!(Number.isFinite(a.gain) && Math.abs(a.gain) <= GAIN_LIMIT && Math.abs(a.gain * 10 - Math.round(a.gain * 10)) < 1e-6)) {
        return { error: `gain takes dB, −${GAIN_LIMIT} to ${GAIN_LIMIT}, in 0.1 dB.` };
      }
      if (busy) return { error: "A try is already running." };
      busy = true;
      try {
        const where = await find(a.zone);
        if ("error" in where) return where;
        /** @type {any} */
        let seen = null;
        const out = /** @type {any} */ (await inTurn(async (s) => {
          const item = s.graph.get(BigInt(where.item));
          const ref = item && item.loaded ? field(item, "ParametricEqualizer") : null;
          const part = isRef(ref) ? s.graph.get(ref.$ref) : null;
          if (!part || !part.loaded) return { notSent: "Your server hasn't sent this Parametric EQ yet." };
          const specKey = Object.keys(part.fields).find((k) => k.endsWith("::Spec"));
          if (!specKey) return { notSent: "Your server sent this Parametric EQ without its bands." };
          /** @type {any} */
          let next, bytes, before;
          try {
            const held = plainOf(s.graph, specKey, part.fields[specKey], true);
            const bandsKey = keyOf(held, "Bands");
            const bands = bandsKey ? held[bandsKey] : null;
            if (!Array.isArray(bands) || a.band > bands.length) return { notSent: `This Parametric EQ has ${Array.isArray(bands) ? bands.length : "no"} bands.` };
            before = bands[a.band - 1];
            if (!before || typeof before !== "object") return { notSent: `Band ${a.band} is empty.` };
            const type = get(before, "Type");
            if (typeof type !== "string") return { notSent: `Band ${a.band} has no type your server sent.` };
            if (!GAIN_TYPES.includes(type)) return { notSent: `Band ${a.band} is a ${type}, which has no gain to change.` };
            const bandDef = declared(s.graph, String(before.$type));
            const gainKey = keyOf(before, "GainDb") || (bandDef && bandDef.members.map((/** @type {any} */ m) => m.name).find((/** @type {string} */ k) => k.endsWith("::GainDb")));
            if (!gainKey) return { notSent: "Your server hasn't said where a band's gain goes." };
            next = structuredClone(held);
            next[/** @type {string} */ (bandsKey)][a.band - 1][gainKey] = a.gain;
            // written here only for the preview, nothing declared on the connection (the review); on the connection to send
            const w = writer(a.send ? s.g : local(), s.graph);
            bytes = w.struct(next);
            // read back before anything is sent: bytes that don't hold the spec meant are never sent
            if (text(w.readBack(bytes)) !== text(next)) return { notSent: "The spec Rouen wrote doesn't read back as meant; nothing was sent." };
          } catch (e) {
            return { notSent: String(e && /** @type {any} */ (e).message) };
          }
          const preview = { zone: where.zone, output: where.output, item: where.item, part: String(part.oid), save: a.save,
            change: { before: said(before, a.band), gainDb: a.gain }, held: deep(s.graph, specKey, part.fields[specKey]), sends: shortly(next),
            bytes: bytes.length, readBack: "The spec Rouen would send reads back as meant." };
          if (!a.send) return Object.assign({ sent: false, next: "Compare the bands held with MUSE: Rouen's copy is from when it asked your server (§15.13). If they match, add &send=1 to send it once." }, preview);
          seen = { s, part: String(part.oid), item: where.item, pushes: [], t0: Date.now() };
          seen.w = (/** @type {any} */ o, /** @type {Record<string, any>} */ pushed, /** @type {number | undefined} */ cmd) => {
            const oid = String(o.oid);
            if (seen.pushes.length < 20 && (oid === seen.part || oid === seen.item)) {
              seen.pushes.push({ afterMs: Date.now() - seen.t0, object: `${shortType(o.typeName)} ${oid}`, kind: cmd,
                values: Object.fromEntries(Object.keys(pushed).map((k) => [k.split("::").pop(), deep(s.graph, k, pushed[k])])) });
            }
          };
          s.graph.watchers.add(seen.w);
          try {
            const res = await s.g.call(part.oid, SIG.dspPeqSpec, Buffer.concat([bytes, new BinaryWriter().boolean(a.save).toBuffer()]));
            log(`peq try: SetSpec band ${a.band} → ${a.gain} dB, save ${a.save}: ${res.success ? "taken" : `refused (${res.status})`}`);
            return Object.assign({ sent: true, answer: res.success ? "taken" : `refused (${res.status})` }, preview);
          } catch (e) {
            // An answered call that never came back may still have been taken: said, never sent again. One the connection
            // never took (closed, or full) is said not sent.
            const f = failed(e);
            return Object.assign({ sent: !("notSent" in f) }, f, preview);
          }
        }, turnMs));
        // only what reached the server is waited on and said to be checked (the review): not one never sent, nor refused
        if (seen) {
          const reached = out.sent && (out.answer === "taken" || !!out.maybe);
          if (reached) await new Promise((r) => { setTimeout(r, waitMs); });
          seen.s.graph.watchers.delete(seen.w);
          if (!reached) return out;
          const part = seen.s.graph.get(BigInt(seen.part));
          const key = part ? Object.keys(part.fields).find((k) => k.endsWith("::Spec")) : null;
          out.cameBack = seen.pushes.length ? seen.pushes : `Nothing came back about this Parametric EQ within ${Math.round(waitMs / 1000)} s.`;
          out.heldNow = key ? deep(seen.s.graph, key, part.fields[key]) : null;
          out.next = "Check MUSE: the band's gain as sent, and every other band as it was.";
        }
        return out;
      } finally {
        busy = false;
      }
    },
  };
}

module.exports = { createPeqTry, plainOf, writer, GAIN_TYPES };
