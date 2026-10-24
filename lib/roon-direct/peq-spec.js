// @ts-check
"use strict";
/*
 * peq-spec.js — a Parametric EQ's spec as plain data, and back (dev/design/native-remote.md §15.14, §15.15): moved out
 * of peq-try.js (v1.9.66-t14) in t15, unchanged, so the hand try and the EQ's own controls (peq.js) write it one way;
 * and (t15) its bands as the window shows them, and one band's setting changed on it, within the owner's bounds.
 *
 * A spec is read as plain data — an inline struct's members by their full names, a list's bytes as its items — and
 * written back with the members the server itself declared for each type (the graph's types, in its order), each band
 * an inline value as it came. Pure: nothing sent (inlineStruct declares a type only through the `g` it is given).
 */
const { BinaryReader, BinaryWriter } = require("./wire");
const { inlineStruct } = require("./methods");
const { ObjectGraph, P, field, isRef, shortType, codecFor } = require("./objects");
const { readList, elementOf, FOCUS_ENUMS } = require("./focus");

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

/** A band's types, as MUSE names them (§15.14). */
const TYPES = Object.freeze(/** @type {Record<string, string>} */ ({ low_shelf: "Low shelf", equalize_frequency: "Peak/dip",
  band_stop: "Band stop", high_pass: "High pass", high_shelf: "High shelf", low_pass: "Low pass" }));
/**
 * Each band setting the window changes (the owner, §15.15): its member, the types it is one of (MUSE shows a gain on
 * shelves and peaks, a Q on those and band stops), its bounds and grid, and its value when the server leaves it out.
 * The grid is what a value may be — MUSE's own are on 0.1 dB (−11.8) — not the window's step (0.5 dB for a gain).
 * @type {Readonly<Record<string, { member: string, types: string[], min?: number, max?: number, grid?: number, absent: any }>>}
 */
const BAND_SETTINGS = Object.freeze({
  gain: { member: "GainDb", types: ["low_shelf", "high_shelf", "equalize_frequency"], min: -24, max: 24, grid: 0.1, absent: 0 },
  frequency: { member: "Frequency", types: Object.keys(TYPES), min: 20, max: 20000, grid: 1, absent: null },
  q: { member: "Q", types: ["low_shelf", "high_shelf", "equalize_frequency", "band_stop"], min: 0.1, max: 10, grid: 0.1, absent: null },
  on: { member: "IsEnabled", types: Object.keys(TYPES), absent: false },
});
/** @param {any} v */
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** A spec's bands, as plain data, or null. @param {Record<string, any>} spec */
function bandList(spec) {
  const k = keyOf(spec, "Bands");
  return k && Array.isArray(spec[k]) ? spec[k] : null;
}

/**
 * A spec's bands as the window shows them: each band's type and its values, a value left out at its default, and
 * which settings it has. Null when the spec has no list of bands.
 * @param {Record<string, any>} spec
 */
function bandsOf(spec) {
  const bands = bandList(spec);
  if (!bands) return null;
  return bands.map((b, i) => {
    if (!b || typeof b !== "object") return { n: i + 1, empty: true };
    const type = get(b, "Type");
    const can = Object.fromEntries(Object.entries(BAND_SETTINGS).map(([s, d]) => [s, typeof type === "string" && d.types.includes(type)]));
    return { n: i + 1, type: typeof type === "string" ? type : null, label: (typeof type === "string" && TYPES[type]) || "Band",
      frequency: num(get(b, "Frequency")), gain: num(get(b, "GainDb")) ?? 0, q: num(get(b, "Q")), order: num(get(b, "Order")),
      on: get(b, "IsEnabled") === true, can };
  });
}

/** One band setting's value on a spec, its default when left out; undefined when there is no such band. @param {Record<string, any>} spec @param {number} n @param {string} setting */
function valueOf(spec, n, setting) {
  const bands = bandList(spec), d = BAND_SETTINGS[setting];
  const b = bands && Number.isInteger(n) && n >= 1 ? bands[n - 1] : undefined;
  if (!d || !b || typeof b !== "object") return undefined;
  const v = get(b, d.member);
  return v === undefined || v === null ? d.absent : v;
}

/**
 * Why one band's setting can't be changed to a value, or null: a band of the spec, a setting of its type, a value
 * within the owner's bounds on its grid (§15.15).
 * @param {Record<string, any>} spec @param {number} n @param {string} setting @param {any} value
 * @returns {string | null}
 */
function check(spec, n, setting, value) {
  const d = Object.prototype.hasOwnProperty.call(BAND_SETTINGS, setting) ? BAND_SETTINGS[setting] : null;
  if (!d) return "Which setting?";
  const bands = bandList(spec);
  if (!bands) return "Your server sent this Parametric EQ without its bands.";
  if (!Number.isInteger(n) || n < 1 || n > bands.length) return `This Parametric EQ has ${bands.length} bands.`;
  const b = bands[n - 1];
  if (!b || typeof b !== "object") return `Band ${n} is empty.`;
  const type = get(b, "Type");
  if (typeof type !== "string") return `Band ${n} has no type your server sent.`;
  if (!d.types.includes(type)) return `A ${TYPES[type] || type} band has no ${setting === "q" ? "Q" : setting}.`;
  if (setting === "on") return typeof value === "boolean" ? null : "On or off.";
  const lo = /** @type {number} */ (d.min), hi = /** @type {number} */ (d.max), grid = /** @type {number} */ (d.grid);
  const ok = typeof value === "number" && Number.isFinite(value) && value >= lo - 1e-9 && value <= hi + 1e-9 && Math.abs(value / grid - Math.round(value / grid)) < 1e-6;
  const unit = setting === "gain" ? " dB" : setting === "frequency" ? " Hz" : "";
  return ok ? null : `${setting === "q" ? "Q" : setting[0].toUpperCase() + setting.slice(1)} is ${lo}${unit} to ${hi}${unit}, in ${grid}${unit}.`;
}

/**
 * The spec with one band's setting changed, a copy; every other member as it was. The member's full name is the
 * band's own, or (left out) the one the server declared for its type.
 * @param {any} graph  the server's types @param {Record<string, any>} spec @param {number} n @param {string} setting @param {any} value
 */
function changed(graph, spec, n, setting, value) {
  const why = check(spec, n, setting, value);
  if (why) throw new Error(why);
  const next = structuredClone(spec);
  const b = /** @type {any[]} */ (bandList(next))[n - 1];
  const member = BAND_SETTINGS[setting].member;
  const def = declared(graph, String(b.$type));
  const key = keyOf(b, member) || (def && def.members.map((/** @type {any} */ m) => m.name).find((/** @type {string} */ k) => k.endsWith("::" + member)));
  if (!key) throw new Error(`Your server hasn't said where a band's ${member} goes.`);
  b[key] = value;
  return next;
}

/** Whether a spec shows one band's setting at a value (a number within half its grid). @param {Record<string, any>} spec @param {number} n @param {string} setting @param {any} value */
function shows(spec, n, setting, value) {
  const v = valueOf(spec, n, setting);
  if (setting === "on") return v === value;
  return typeof v === "number" && Math.abs(v - value) < (BAND_SETTINGS[setting].grid || 0.1) / 2;
}

/**
 * A spec's bytes to send: written with the server's declarations, by `g` (the connection's to send; local() for a
 * preview), and read back by the same reader before anything is sent — bytes that don't hold the spec meant throw.
 * One encoder for the window's changes (peq.js) and the hand try (peq-try.js): the review.
 * @param {{ defineType(name: string, members: any[]): number }} g @param {any} graph @param {Record<string, any>} spec
 */
function encode(g, graph, spec) {
  const w = writer(g, graph);
  const bytes = w.struct(spec);
  if (text(w.readBack(bytes)) !== text(spec)) throw new Error("The EQ Rouen wrote doesn't read back as meant; nothing was sent.");
  return bytes;
}

module.exports = { declared, keyOf, get, local, servers, shortly, plainOf, writer, text, said, TYPES, BAND_SETTINGS, bandsOf, valueOf, check,
  changed, shows, encode };
