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
 *    Matching by title alone was proposed in v1.9.20 and not taken (the
 *    owner, 2026-10-14): Roon tells the source, so the pairing must be sure.
 *  - A key the Core lists under two sources is unknown: two albums, one of
 *    each, and title and artist cannot tell them apart.
 *  - An album not matched is reported with why, and the Core's albums of the
 *    same title beside it (v1.9.20), so the next case can be read rather than
 *    guessed (GET /api/roon-direct/unmatched).
 */
const { MEDIA } = require("./albumsource");
const { titleOf } = require("../albumkeys");

/** @typedef {"local" | "tidal" | "qobuz"} Source */
/** @typedef {{ source: Source | null, sources: Source[], imageKey: string | null, title: string, artist: string }} Entry */
/** @typedef {{ entries: Map<string, Entry>, byTitle: Map<string, Array<{ artist: string, source: Source | null }>>, read: number, noSource: number }} SourceIndex */
/** @typedef {(title: string, artist: string) => string | null} KeyOf */
/** @typedef {{ source: Source | null, why?: "two sources" | "no source" | "not listed", sources?: Source[] }} Lookup */

/** For the unmatched list only: the Core's albums by title. @param {Map<string, Entry>} entries */
function titlesOf(entries) {
  /** @type {Map<string, Array<{ artist: string, source: Source | null }>>} */
  const byTitle = new Map();
  for (const [key, e] of entries) {
    const t = titleOf(key);
    if (!t) continue;
    let list = byTitle.get(t);
    if (!list) byTitle.set(t, list = []);
    if (!e.sources.length) list.push({ artist: e.artist, source: null });
    for (const source of e.sources) list.push({ artist: e.artist, source });
  }
  return byTitle;
}

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
    if (!source) noSource++;
    const key = keyOf(a.title, a.artist);
    if (!key) continue;
    const had = entries.get(key);
    // An album with no source is listed too: its key is then not matched
    // ("no source"), never left free for a namesake to answer.
    if (!had) { entries.set(key, { source: source || null, sources: source ? [source] : [], imageKey: a.imageKey, title: a.title, artist: a.artist }); continue; }
    if (!source) { had.source = null; had.imageKey = null; continue; }
    if (!had.sources.includes(source)) { had.sources.push(source); had.source = null; had.imageKey = null; }
    else if (had.imageKey !== a.imageKey) had.imageKey = null;   // two covers under one key: none to compare
  }
  return { entries, byTitle: titlesOf(entries), read: albums.length, noSource };
}

/**
 * The source the Core gives an album, by its exact key — or why not.
 * @param {SourceIndex | null} index
 * @param {string[] | string | null | undefined} keys  albumKeys; only the first, exact one is used
 * @returns {Lookup}
 */
function lookup(index, keys) {
  const key = Array.isArray(keys) ? keys[0] : keys;
  if (!index || !key) return { source: null, why: "not listed" };
  const e = index.entries.get(key);
  if (!e) return { source: null, why: "not listed" };
  if (e.source) return { source: e.source };
  return e.sources.length > 1 ? { source: null, why: "two sources", sources: e.sources } : { source: null, why: "no source" };
}

/** @param {SourceIndex | null} index @param {string[] | string | null | undefined} keys @returns {Source | null} */
function sourceOf(index, keys) { return lookup(index, keys).source; }

/**
 * How Rouen's albums fared: matched (by source), not matched (and why), and —
 * of those matched — how many have the cover key the Core's album has.
 * `unmatched` lists each not matched, with the Core's albums of the same
 * title, up to `max`; `resolved` is every answer by exact key, for the hot
 * path (stage1.js), worked out once per report.
 * @param {Array<{ keys: string[], title?: string, artist?: string, imageKey?: string | null }>} records  Rouen's albums
 * @param {SourceIndex} index
 * @param {number} [max]
 */
function matchReport(records, index, max) {
  const limit = max === undefined ? 200 : max;
  const bySource = { local: 0, qobuz: 0, tidal: 0 };
  let matched = 0, twoSources = 0, noSourceHere = 0, notListed = 0, coverSame = 0;
  /** @type {any[]} */
  const unmatched = [];
  /** @type {Map<string, Source | null>} */
  const resolved = new Map();
  for (const r of records) {
    const l = lookup(index, r.keys);
    if (r.keys && r.keys[0]) resolved.set(r.keys[0], l.source);
    if (l.source) {
      matched++;
      bySource[l.source]++;
      const e = index.entries.get(r.keys[0]);
      if (e && e.imageKey && r.imageKey && e.imageKey === r.imageKey) coverSame++;
      continue;
    }
    if (l.why === "two sources") twoSources++;
    else if (l.why === "no source") noSourceHere++;
    else notListed++;
    if (unmatched.length < limit) {
      const t = r.keys && r.keys[0] ? titleOf(r.keys[0]) : "";
      unmatched.push({ title: r.title || "", artist: r.artist || "", why: l.why, sources: l.sources,
        sameTitle: (t && index.byTitle.get(t) || []).slice(0, 5) });
    }
  }
  const report = { albums: records.length, matched, bySource, twoSources, noSource: noSourceHere, notListed,
    left: records.length - matched, coverSame, roonAlbums: index.read, roonWithoutSource: index.noSource, unmatched };
  Object.defineProperty(report, "resolved", { enumerable: false, value: resolved });
  return /** @type {typeof report & { resolved: Map<string, Source | null> }} */ (report);
}

/** For the saved copy (§10.2): plain JSON. @param {SourceIndex} index */
function serialise(index) {
  return { read: index.read, noSource: index.noSource,
    entries: [...index.entries].map(([k, e]) => [k, e.sources, e.imageKey, e.title, e.artist, e.source === null && e.sources.length === 1 ? 1 : 0]) };
}

const SOURCES = ["local", "tidal", "qobuz"];

/**
 * A saved copy read back; null when it is not one (one saved before v1.9.20,
 * without its titles, included: the next read replaces it).
 * @param {any} v
 * @returns {SourceIndex | null}
 */
function deserialise(v) {
  if (!v || !Array.isArray(v.entries) || typeof v.read !== "number") return null;
  /** @type {Map<string, Entry>} */
  const entries = new Map();
  for (const row of v.entries) {
    if (!Array.isArray(row) || typeof row[0] !== "string" || !Array.isArray(row[1])) return null;
    if (!row[1].every((s) => SOURCES.includes(s)) || typeof row[3] !== "string") return null;
    const sources = /** @type {Source[]} */ (row[1]);
    // row[5]: one source, but an album without one shares its key.
    entries.set(row[0], { source: sources.length === 1 && !row[5] ? sources[0] : null, sources,
      imageKey: typeof row[2] === "string" ? row[2] : null, title: row[3], artist: String(row[4] || "") });
  }
  return { entries, byTitle: titlesOf(entries), read: v.read, noSource: Number(v.noSource) || 0 };
}

module.exports = { buildIndex, lookup, sourceOf, matchReport, serialise, deserialise };
