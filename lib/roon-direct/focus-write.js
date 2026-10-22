// @ts-check
"use strict";
/*
 * focus-write.js — §12.15 (v1.9.60): the Focus members beyond the genres and the order, written as Roon's smart
 * playlist parameters carry them, and read back from the playlist the server lists, to be believed.
 *
 *   a list (sample rates, bit depths, file formats, labels): LengthPrefixed — its length, then a count and each item
 *     (an int or an enum as the protocol's integer, a string as a string), as the server declares its lists (§12.6)
 *   an int? (played, imported in the last N days): the protocol's optional integer
 *   a date (MinDate, MaxDate): LengthPrefixed, holding its NullDate's integer (§12.12)
 *
 * Only what is set is sent: every other member is the server's default, and the server leaves a default out when it
 * sends the Focus back (§12.13), so what reads back is compared as the same sparse shape.
 */
const { BinaryReader, BinaryWriter } = require("./wire");
const { readList } = require("./focus");

/** @typedef {import("./focus-map").Extra} Extra */

const CRITERIA_MODE_OR = 1;   // CriteriaMode Or: Rouen's labels, like its genres, are any-of

/** LengthPrefixed bytes. @param {Buffer} inner */
const prefixed = (inner) => new BinaryWriter().integer(inner.length).bytes(inner).toBuffer();
/** A list of ints (or enums). @param {number[]} xs */
function intList(xs) {
  const w = new BinaryWriter().flexInt(xs.length);
  for (const x of xs) w.integer(x);
  return prefixed(w.toBuffer());
}
/** A list of strings. @param {string[]} xs */
function strList(xs) {
  const w = new BinaryWriter().flexInt(xs.length);
  for (const x of xs) w.string(x);
  return prefixed(w.toBuffer());
}
/** An int?, set. @param {number} n */
const optInt = (n) => new BinaryWriter().boolean(true).integer(n).toBuffer();
/** A NullDate. @param {number} n */
const date = (n) => prefixed(new BinaryWriter().integer(n).toBuffer());
/** An enum. @param {number} n */
const int = (n) => new BinaryWriter().integer(n).toBuffer();

/**
 * The members to send, by short name, each with its bytes; only those set. @param {Extra} e
 * @returns {Array<[string, Buffer]>}
 */
function extraMembers(e) {
  /** @type {Array<[string, Buffer]>} */
  const out = [];
  const list = (/** @type {string} */ name, /** @type {{ require: any[], exclude: any[] }} */ x, /** @type {(xs: any[]) => Buffer} */ w) => {
    if (x.require.length) out.push(["Require" + name, w(x.require)]);
    if (x.exclude.length) out.push(["Exclude" + name, w(x.exclude)]);
  };
  list("FileFormats", e.formats, intList);
  list("SampleRates", e.rates, intList);
  list("BitsPerSample", e.bits, intList);
  if (e.labels.require.length) out.push(["LabelsMode", int(CRITERIA_MODE_OR)]);
  list("Labels", e.labels, strList);
  if (e.played.require !== null) out.push(["RequirePlayedInLastNDays", optInt(e.played.require)]);
  if (e.played.exclude !== null) out.push(["ExcludePlayedInLastNDays", optInt(e.played.exclude)]);
  if (e.imported.require !== null) out.push(["RequireImportedInLastNDays", optInt(e.imported.require)]);
  if (e.imported.exclude !== null) out.push(["ExcludeImportedInLastNDays", optInt(e.imported.exclude)]);
  if (e.dates) out.push(["MinDate", date(e.dates.min)], ["MaxDate", date(e.dates.max)]);
  return out;
}

/** An empty Extra: nothing set. @returns {Extra} */
const none = () => ({ dates: null, formats: { require: [], exclude: [] }, rates: { require: [], exclude: [] }, bits: { require: [], exclude: [] },
  labels: { require: [], exclude: [] }, played: { require: null, exclude: null }, imported: { require: null, exclude: null } });

/**
 * The same members read back from a Focus (focus.js focusFields), or why one can't be read; a member not sent
 * reads as not set. @param {any} graph @param {Record<string, any>} f
 * @returns {{ extra: Extra, labelsMode: number } | { why: string }}
 */
function readExtra(graph, f) {
  const e = none();
  /** A member's key and value by its short name. @param {string} short */
  const get = (short) => { const k = Object.keys(f).find((x) => x.endsWith("::" + short)); return k ? { k, v: f[k] } : null; };
  /** @param {string} short @returns {any[] | null} null: there and not read whole */
  const list = (short) => {
    const m = get(short);
    if (!m || m.v === null || m.v === undefined) return [];
    const l = Buffer.isBuffer(m.v) ? readList(graph, m.k, m.v) : null;
    return l && l.whole ? l.items : null;
  };
  /** @param {string} short @returns {number | null | undefined} undefined: there and not a number */
  const opt = (short) => {
    const m = get(short);
    if (!m || m.v === null || m.v === undefined) return null;
    return typeof m.v === "number" ? m.v : undefined;
  };
  /** @param {string} short @returns {number | null | undefined} */
  const day = (short) => {
    const m = get(short);
    if (!m || m.v === null || m.v === undefined) return null;
    if (!Buffer.isBuffer(m.v)) return undefined;
    try { const r = new BinaryReader(m.v); const n = r.integer(); return r.remaining === 0 ? n : undefined; }
    catch (err) { return undefined; }   // not the date's form: said as unreadable, below
  };
  for (const [name, into] of /** @type {Array<[string, { require: any[], exclude: any[] }]>} */ ([["FileFormats", e.formats],
    ["SampleRates", e.rates], ["BitsPerSample", e.bits], ["Labels", e.labels]])) {
    const req = list("Require" + name), exc = list("Exclude" + name);
    if (!req || !exc) return { why: `its ${name} didn't read whole` };
    into.require = req.map((x) => (name === "Labels" ? String(x) : Number(x)));
    into.exclude = exc.map((x) => (name === "Labels" ? String(x) : Number(x)));
  }
  for (const [name, into, side] of /** @type {Array<[string, any, "require" | "exclude"]>} */ ([["RequirePlayedInLastNDays", e.played, "require"],
    ["ExcludePlayedInLastNDays", e.played, "exclude"], ["RequireImportedInLastNDays", e.imported, "require"],
    ["ExcludeImportedInLastNDays", e.imported, "exclude"]])) {
    const n = opt(name);
    if (n === undefined) return { why: `its ${name} isn't a number` };
    into[side] = n;
  }
  const min = day("MinDate"), max = day("MaxDate");
  if (min === undefined || max === undefined) return { why: "its dates didn't read as dates" };
  if ((min === null) !== (max === null)) return { why: "it has one end of a date range" };
  e.dates = min === null || max === null ? null : { min, max };
  const lm = get("LabelsMode");
  return { extra: e, labelsMode: lm && typeof lm.v === "number" ? lm.v : 0 };
}

/**
 * Whether what reads back is what was sent: lists as sets, the rest as is; labels any-of when there are any.
 * @param {Extra} sent @param {{ extra: Extra, labelsMode: number }} read
 * @returns {string | null}  what differs, or null
 */
function differs(sent, read) {
  const set = (/** @type {any[]} */ xs) => JSON.stringify([...new Set(xs.map(String))].sort());
  const r = read.extra;
  for (const k of /** @type {Array<"formats" | "rates" | "bits" | "labels">} */ (["formats", "rates", "bits", "labels"])) {
    if (set(sent[k].require) !== set(r[k].require) || set(sent[k].exclude) !== set(r[k].exclude)) return k;
  }
  if (sent.labels.require.length && read.labelsMode !== CRITERIA_MODE_OR) return "labels (not any-of)";
  for (const k of /** @type {Array<"played" | "imported">} */ (["played", "imported"])) {
    if (sent[k].require !== r[k].require || sent[k].exclude !== r[k].exclude) return k;
  }
  if (JSON.stringify(sent.dates) !== JSON.stringify(r.dates)) return "dates";
  return null;
}

module.exports = { extraMembers, readExtra, differs, none };
