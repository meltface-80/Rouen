// @ts-check
"use strict";
/*
 * focus.js — N2e-2a (dev/design/native-remote.md §12.5, v1.9.52): a smart playlist's Focus lists, read.
 *
 * A Focus (AlbumQueryCriteria, TrackQueryCriteria) carries its lists — genres, tags, performers, labels,
 * formats, years… — as LengthPrefixed values, which the graph keeps as their bytes (objects.js). Their form
 * is upstream's, run live by its Library::Edit (client.ts): a count, then each item in its element type's own
 * encoding — a string as a string, an int or an enum as an integer, a long as a long, and an object
 * (GenreLite, TagLite, PerformerLite, Location, AlbumLite) as any Object member is: by reference (its object
 * id), inline, or null. Which reader an element type takes is objects.js's codecFor, as a DataList's is.
 *
 * Read only. A list that doesn't read whole (bytes left over, or cut short) is said so, with what was read.
 */
const { BinaryReader } = require("./wire");
const { codecFor } = require("./objects");

const LIST = /^System\.Collections\.Generic\.IList<(.+?)> /;
/** The Focus's enums, read as an integer: the catalogue's AlbumType, FileFormat, ImageSize (upstream's struct schemas). */
const FOCUS_ENUMS = ["AlbumType", "FileFormat", "ImageSize"];

/**
 * The element type of a list member, as declared, by the member's full name ("System.Collections.Generic.IList<string>
 * …::RequireLabels" → "string"), or null when the member isn't a list. @param {string} fullName
 */
function elementOf(fullName) {
  const m = LIST.exec(fullName);
  return m ? m[1] : null;
}

/**
 * One Focus list, read from its bytes.
 * @param {{ readValue(r: BinaryReader, t: number): any }} graph  the session's graph, which reads an Object as every member's
 * @param {string} fullName  the member's full name, which gives the element type
 * @param {Buffer} bytes
 * @returns {{ type: string, count: number | null, items: any[], whole: boolean } | null}
 *   null: not a list member; count null: the list itself null (the count written as -1)
 */
function readList(graph, fullName, bytes) {
  const el = elementOf(fullName);
  if (!el) return null;
  const type = el.replace(/^(Sooloos|Roon)\.Broker\.Api\./, "");
  const r = new BinaryReader(bytes);
  /** @type {any[]} */
  const items = [];
  let count = 0;
  try {
    count = r.integer();
    if (count < 0) return { type, count: null, items, whole: r.remaining === 0 };
    // Every item takes a byte at least: a count past what is left is not this form, and isn't read as it.
    if (count > r.remaining) return { type, count, items, whole: false };
    const codec = codecFor(el, FOCUS_ENUMS);
    for (let i = 0; i < count; i++) items.push(graph.readValue(r, codec));
  } catch (e) {
    // Only a read past the end lands here as "not whole" — the bytes cut short; what was read is kept. Anything else
    // (a fault of Rouen's own) is not the server's bytes, and is not said as if it were.
    if (!(e instanceof RangeError)) throw e;
    return { type, count, items, whole: false };
  }
  return { type, count, items, whole: r.remaining === 0 };
}

/**
 * A playlist's album Focus members, by their full names, whether it came inline or as an object of its own; or null.
 * @param {any} graph @param {any} p  the Playlist object
 * @returns {Record<string, any> | null}
 */
function focusFields(graph, p) {
  const key = Object.keys(p.fields || {}).find((k) => k.endsWith("::AlbumCriteria"));
  const raw = key ? p.fields[key] : undefined;
  const o = raw && typeof raw === "object" && "$ref" in raw ? graph.get(raw.$ref) : null;
  const f = o && o.loaded ? o.fields : raw;
  return f && typeof f === "object" && !Buffer.isBuffer(f) ? f : null;
}

/**
 * One of a Focus's genre lists, each a GenreLite sent, by name and object; [] when not sent (the default, an empty list);
 * null when it is there and can't be read whole, or names a genre not sent (the review, v1.9.55).
 * @param {any} graph @param {Record<string, any>} f  focusFields' @param {"RequireGenreObjects" | "ExcludeGenreObjects"} member
 * @returns {Array<{ name: string, oid: bigint }> | null}
 */
function genreList(graph, f, member) {
  const key = Object.keys(f).find((k) => k.endsWith("::" + member));
  if (!key) return [];
  const list = Buffer.isBuffer(f[key]) ? readList(graph, key, f[key]) : null;
  if (!list || !list.whole) return null;
  /** @type {Array<{ name: string, oid: bigint }>} */
  const out = [];
  for (const x of list.items) {
    const g = x && typeof x === "object" && "$ref" in x ? graph.get(x.$ref) : null;
    const name = g && g.loaded ? Object.keys(g.fields).find((k) => k.endsWith("::Name")) : undefined;
    if (!g || !name || typeof g.fields[name] !== "string") return null;
    out.push({ name: g.fields[name], oid: g.oid });
  }
  return out;
}

module.exports = { readList, elementOf, focusFields, genreList };
