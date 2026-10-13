// @ts-check
"use strict";
/*
 * albumsource.js — what the album pages by Location say about an album's
 * source (stage 0, v1.9.16; dev/design/roon-native.md §9.1). Pure functions
 * over what locations.js gathered: no calls, no graph.
 *
 * Two questions, each answered from the Core's own answers in one session:
 *  1. Are a source's albums, paged from its Locations, exactly the albums its
 *     tracks belong to (same object ids, same session)? That is option (b)
 *     proved end to end, not only by counts.
 *  2. Does each album's own ContentSource name the source of the Location it
 *     was paged from? ContentSource is a MediaSource (the upstream's
 *     catalog.authoritative.json: Local 1, Tidal 128, Qobuz 256, among
 *     others). deep-roon-mcp (René Bouwmeester, Apache-2.0; 0.4.5, aeea5e9)
 *     reads an album's source from it, and notes that the plain Source says
 *     Local for a streaming album in the library. Facts only, no code. If it
 *     agrees here, stage 1 could read an album's source from the album itself
 *     (§9.1, option c).
 */

/** MediaSource values that name a source (the catalogue's enum). */
const MEDIA = Object.freeze({ 1: "local", 128: "tidal", 256: "qobuz" });

/**
 * The source a Location stands for, by its category and type as the
 * catalogue names them and the owner's Core reported them (v1.9.12, v1.9.13):
 * a watched folder (category 100) or iTunes (300) is local files; type 406 is
 * TIDAL ("TIDAL" and "TIDAL Library" both), 407 Qobuz. Never by name: the
 * library's TIDAL albums are under "TIDAL Library", not "TIDAL".
 * @param {{ category?: any, type?: any }} d
 * @returns {"local" | "tidal" | "qobuz" | null}
 */
function sourceOfLocation(d) {
  if (d.category === 100 || d.category === 300) return "local";
  if (d.type === 406) return "tidal";
  if (d.type === 407) return "qobuz";
  return null;
}

/** A pushed value as text, whatever its shape (a number, null, a reference, an inline object). @param {any} v */
function show(v) {
  if (v === undefined || v === null) return "absent";
  if (typeof v === "object") return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
  return String(v);
}

/** How many of each value; a missing one counts as "absent". @param {any[]} values */
function tally(values) {
  /** @type {Record<string, number>} */
  const t = {};
  for (const v of values) { const k = show(v); t[k] = (t[k] || 0) + 1; }
  return t;
}

/**
 * Whether each paged album's ContentSource names its Location's source. An
 * album paged from two Locations of one source counts once.
 * @param {Array<{ oid: string, source: string, contentSource: any }>} albums
 */
function contentSourceVerdict(albums) {
  /** @type {Map<string, { source: string, contentSource: any }>} */
  const once = new Map();
  for (const a of albums) if (!once.has(a.oid)) once.set(a.oid, a);
  const n = once.size;
  if (!n) return "unknown: no album was paged";
  let agree = 0, absent = 0;
  /** @type {string[]} */
  const wrong = [];
  for (const a of once.values()) {
    if (a.contentSource === undefined || a.contentSource === null) absent++;
    else if (/** @type {any} */ (MEDIA)[a.contentSource] === a.source) agree++;
    else wrong.push(`${a.source} album says ${show(a.contentSource)}`);
  }
  if (absent === n) return `absent: none of the ${n} albums paged carried a ContentSource`;
  if (agree === n) return `agrees: every one of the ${n} albums paged says the source of its Location`;
  if (!wrong.length) return `incomplete: ${agree} of ${n} agree, the other ${absent} carry none`;
  return `disagrees: ${agree} of ${n} agree, ${wrong.length} name another source, ${absent} carry none (${wrong.slice(0, 5).join("; ")})`;
}

/**
 * Per source: the albums paged from its Locations against the albums its
 * tracks belong to. Every source either side found is listed; a source the
 * Locations did not give whole is not passed in here at all (the caller
 * marks it partial). A source with no albums by Location counts as none.
 * @param {Record<string, Set<string>>} fromLocations
 * @param {Record<string, Set<string>>} fromTracks
 */
function crossCheck(fromLocations, fromTracks) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const source of new Set([...Object.keys(fromLocations), ...Object.keys(fromTracks)])) {
    const L = fromLocations[source] || new Set(), T = fromTracks[source];
    if (!T) { out[source] = { fromLocations: L.size, fromTracks: null }; continue; }
    let same = 0;
    for (const k of L) if (T.has(k)) same++;
    out[source] = { fromLocations: L.size, fromTracks: T.size, same, onlyLocations: L.size - same, onlyTracks: T.size - same };
  }
  return out;
}

/**
 * The answer to question 1, in a line. A source marked partial (its
 * Locations not read whole) is named, never counted as agreeing.
 * @param {Record<string, any>} check  crossCheck's result, with partial sources added
 */
function crossVerdict(check) {
  const rows = Object.entries(check);
  if (!rows.length) return "unknown: no source to compare";
  const partial = rows.filter(([, r]) => r.partial);
  const known = rows.filter(([, r]) => !r.partial && r.fromTracks !== null);
  const aside = partial.length ? ` (not compared: ${partial.map(([s]) => s).join(", ")})` : "";
  if (!known.length) return "unknown: no source was read whole both ways" + aside;
  const bad = known.filter(([, r]) => r.onlyLocations || r.onlyTracks);
  if (!bad.length) return `same: for ${known.map(([s]) => s).join(", ")}, the albums paged by Location are exactly the albums of that source's tracks` + aside;
  return "differ: " + bad.map(([s, r]) => `${s} ${r.onlyLocations} only by Location, ${r.onlyTracks} only by tracks`).join("; ") + aside;
}

module.exports = { MEDIA, sourceOfLocation, show, tally, contentSourceVerdict, crossCheck, crossVerdict };
