// @ts-check
"use strict";
/*
 * album-facts.js — what an album's AlbumLite says of its format and its genres, as the library read is sent it
 * (dev/design/shelf-focus.md §2, v1.9.70-t5): no call, nothing new on the wire — members of the objects the
 * VirtualAlbumQuery's pages already push. Pure: the graph and the object in, plain values out.
 *
 *   AlbumFormat   an AlbumFormat (by reference, or inline): Format (the catalogue's FileFormat), SampleRate,
 *                 BitsPerSample, Channels, MQASampleRate, LossyBitRate, IsStreaming, IsMixed, FormatString
 *   GenreObjects  the album's genres as GenreLite objects, each by reference with its Name: in a DataList of the
 *                 album's own, by reference — the form the owner's server sends (the reads probe of v1.9.70-t4; read
 *                 since v1.9.70-t7: until then only a list inline was read, and every album came with no genres) — or
 *                 a list inline; else Genres, their names
 *
 * Either may not come (a member at its default is left out, or the server sends neither in a library page): then
 * null, and the Shelf says so rather than guessing (shelf-focus.md §2).
 */
const { field, isRef, memberOf, fullNameOf } = require("./objects");
const { readList } = require("./focus");

/**
 * @typedef {{ file: number | null, rate: number | null, bits: number | null, channels: number | null, mqa: number | null,
 *             lossy: number | null, streaming: boolean, mixed: boolean, text: string | null }} AlbumFormat
 */

/** A number as sent (an int, a long), or null. @param {any} v */
const num = (v) => (typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : null);

/** The members of a value that is an object by reference (the graph's), or inline (a struct); else null. @param {any} graph @param {any} v */
function membersOf(graph, v) {
  if (isRef(v)) { const o = graph.get(BigInt(v.$ref)); return o && o.loaded ? o.fields : null; }
  return v && typeof v === "object" && !Buffer.isBuffer(v) && "$type" in v ? v : null;
}

/**
 * The formats read by reference, per graph (one a connection), by object id. An AlbumFormat is let go once read
 * (albums.js), and the server sends an object once a connection: one it shares between albums, or names again in an
 * album's update, is read from here. @type {WeakMap<object, Map<string, AlbumFormat>>}
 */
const readFormats = new WeakMap();

/**
 * An album's format, from its AlbumFormat; null when none came.
 * @param {any} graph @param {any} album  the AlbumLite object @returns {AlbumFormat | null}
 */
function formatOf(graph, album) {
  const v = field(album, "AlbumFormat");
  let held = readFormats.get(graph);
  if (!held) readFormats.set(graph, (held = new Map()));
  const f = membersOf(graph, v);
  if (!f) return (isRef(v) && held.get(String(v.$ref))) || null;
  const out = formatFrom(f);
  if (isRef(v)) held.set(String(v.$ref), out);
  return out;
}

/** An AlbumFormat's members as plain values. @param {any} f @returns {AlbumFormat} */
function formatFrom(f) {
  const m = (/** @type {string} */ k) => memberOf(f, k);
  const text = m("FormatString");
  return { file: num(m("Format")), rate: num(m("SampleRate")), bits: num(m("BitsPerSample")), channels: num(m("Channels")),
    mqa: num(m("MQASampleRate")), lossy: num(m("LossyBitRate")), streaming: m("IsStreaming") === true, mixed: m("IsMixed") === true,
    text: typeof text === "string" && text ? text : null };
}

/**
 * The objects of an album's own that its AlbumFormat and GenreObjects name by reference, to let go once read (the
 * library read keeps nothing per album). The GenreLites its list names are shared, and kept.
 * @param {any} album @returns {bigint[]}
 */
function ownRefs(album) {
  return ["AlbumFormat", "GenreObjects"].map((n) => field(album, n)).filter(isRef).map((v) => BigInt(v.$ref));
}

/**
 * The items of a list member: a DataList by reference (its object's items, once pushed), or a list inline (its bytes,
 * read by focus.js's readList as every list member is), or an array; else null.
 * @param {any} graph @param {any} album @param {string} name @param {any} v
 */
function itemsOf(graph, album, name, v) {
  if (isRef(v)) { const o = graph.get(BigInt(v.$ref)); return o && o.loaded && Array.isArray(o.fields.$items) ? o.fields.$items : null; }
  if (Buffer.isBuffer(v)) return (readList(graph, fullNameOf(album.fields, name), v) || { items: null }).items;
  return Array.isArray(v) ? v : null;
}

/**
 * An album's genres, by name, as the server has them: its GenreObjects (each a GenreLite's Name), else its Genres;
 * null when neither came.
 * @param {any} graph @param {any} album @returns {string[] | null}
 */
function genresOf(graph, album) {
  for (const name of ["GenreObjects", "Genres"]) {
    const v = field(album, name);
    if (v === undefined) continue;
    const items = itemsOf(graph, album, name, v);
    if (!items) continue;
    /** @type {string[]} */
    const out = [];
    for (const x of items) {
      const n = typeof x === "string" ? x : memberOf(membersOf(graph, x), "Name");
      if (typeof n === "string" && n.trim() && !out.includes(n.trim())) out.push(n.trim());
    }
    return out;
  }
  return null;
}

/**
 * A read that gave the list last read again (stage1.js): what it says of each album is copied onto the objects last
 * read, which the screens' records hold (library.js), so a heart made later reaches the Shelf (shelf-focus.md §2).
 * True when a favourite, a format or a genre moved.
 * @param {Array<import("./albums").RoonAlbum>} held @param {Array<import("./albums").RoonAlbum>} fresh @returns {boolean}
 */
function adopt(held, fresh) {
  let moved = false;
  held.forEach((h, i) => {
    const f = fresh[i];
    if (h.favorite !== f.favorite || JSON.stringify([h.format, h.genres]) !== JSON.stringify([f.format, f.genres])) moved = true;
    Object.assign(h, f);
  });
  return moved;
}

module.exports = { formatOf, ownRefs, genresOf, adopt };
