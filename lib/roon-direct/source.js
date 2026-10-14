// @ts-check
"use strict";
/*
 * source.js — stage 1's matching (dev/design/roon-native.md §10.3): which
 * source each of Rouen's albums is, by the album the Core lists under the
 * same title and artist. Pure: no Core, no index, no files.
 *
 *  - An album's source is its own ContentSource (Local 1, TIDAL 128, Qobuz
 *    256; v1.9.16 and v1.9.17 on the owner's Core: all 124 albums paged agreed
 *    with their Location). Any other value, or none, names no source.
 *  - The key is the caller's (Rouen's albumKeys: "title||artist", canonical),
 *    its first and exact form only: a looser form could reach another album.
 *  - A key the Core gives albums of two sources is unknown (null): Rouen's
 *    own inference decides for it. Of one source, that source.
 *  - Rouen's index is built from the same Core, so its titles and artists are
 *    expected to be the Core's; that is what each read's match rate shows.
 */
const { MEDIA } = require("./albumsource");

/** @typedef {"local" | "tidal" | "qobuz"} Source */
/** @typedef {{ source: Source | null, imageKey: string | null }} Entry */
/** @typedef {{ entries: Map<string, Entry>, read: number, noSource: number }} SourceIndex */
/** @typedef {(title: string, artist: string) => string | null} KeyOf */

/**
 * @param {Array<{ title: string, artist: string, contentSource: number | null, imageKey: string | null }>} albums  albums.js's read
 * @param {KeyOf} keyOf
 * @returns {SourceIndex}
 */
function buildIndex(albums, keyOf) {
  /** @type {Map<string, Entry>} */
  const entries = new Map();
  let noSource = 0;
  for (const a of albums) {
    const source = a.contentSource === null ? undefined : /** @type {Source | undefined} */ (/** @type {any} */ (MEDIA)[a.contentSource]);
    const key = keyOf(a.title, a.artist);
    if (!source || !key) { noSource++; continue; }
    const had = entries.get(key);
    if (!had) entries.set(key, { source, imageKey: a.imageKey });
    else if (had.source !== source) entries.set(key, { source: null, imageKey: null });
    else if (had.imageKey !== a.imageKey) had.imageKey = null;   // two covers under one key: none to compare
  }
  return { entries, read: albums.length, noSource };
}

/**
 * The source Roon gives this key, or null (not listed, or listed under two).
 * @param {SourceIndex | null} index
 * @param {string | null | undefined} key
 * @returns {Source | null}
 */
function sourceOf(index, key) {
  if (!index || !key) return null;
  const e = index.entries.get(key);
  return e ? e.source : null;
}

/**
 * How Rouen's albums fared: matched (by source), left to Rouen's own guess,
 * and — of those matched — how many have the cover key Roon's album has.
 * @param {Array<{ key: string | null, imageKey?: string | null }>} records  Rouen's albums
 * @param {SourceIndex} index
 */
function matchReport(records, index) {
  const bySource = { local: 0, qobuz: 0, tidal: 0 };
  let matched = 0, twoSources = 0, coverSame = 0;
  for (const r of records) {
    const e = r.key ? index.entries.get(r.key) : undefined;
    if (!e) continue;
    if (!e.source) { twoSources++; continue; }
    matched++;
    bySource[e.source]++;
    if (e.imageKey && r.imageKey && e.imageKey === r.imageKey) coverSame++;
  }
  return { albums: records.length, matched, bySource, twoSources, left: records.length - matched, coverSame,
    roonAlbums: index.read, roonWithoutSource: index.noSource };
}

/** For the saved copy (§10.2): plain JSON. @param {SourceIndex} index */
function serialise(index) {
  return { read: index.read, noSource: index.noSource, entries: [...index.entries].map(([k, e]) => [k, e.source, e.imageKey]) };
}

/**
 * A saved copy read back; null when it is not one.
 * @param {any} v
 * @returns {SourceIndex | null}
 */
function deserialise(v) {
  if (!v || !Array.isArray(v.entries) || typeof v.read !== "number") return null;
  /** @type {Map<string, Entry>} */
  const entries = new Map();
  for (const row of v.entries) {
    if (!Array.isArray(row) || typeof row[0] !== "string") return null;
    const s = row[1];
    if (s !== null && s !== "local" && s !== "tidal" && s !== "qobuz") return null;
    entries.set(row[0], { source: s, imageKey: typeof row[2] === "string" ? row[2] : null });
  }
  return { entries, read: v.read, noSource: Number(v.noSource) || 0 };
}

module.exports = { buildIndex, sourceOf, matchReport, serialise, deserialise };
