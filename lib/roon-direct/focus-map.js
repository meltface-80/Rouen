// @ts-check
"use strict";
/*
 * focus-map.js — one of Rouen's Dynamic Playlists as the album Focus of a Roon smart playlist, or what stops it
 * (dev/design/native-remote.md §12.7.1, v1.9.53; every filter Roon can hold, §12.15, v1.9.60).
 *
 * The owner (§12.15): Rouen matches what Roon needs. Every filter Roon's Focus can hold is made, with Roon's own data
 * behind it (its play history, import dates, labels); the album limit is dropped, as Roon's smart playlists have
 * none. A filter Roon can't hold (Channels, Starts with, a format it has no name for, a gap between decades) still
 * stops it, and is named. Rouen's random track order is how it plays, said as "use Shuffle in Roon".
 *
 * Pure: nothing here reads the server or Rouen's settings.
 */

/** Roon's AlbumOrdering for each of Rouen's sorts that maps (the catalogue's enum): Recently added runs oldest first
 * ascending in Rouen, as Release date does (index.js), and so is ImportDate as Date is. */
const ORDERING = Object.freeze({ album: 4, artist: 0, year: 2, random: 7, added: 1 });
/** Roon's OrderingDirection. */
const ASCENDING = 1, DESCENDING = 2;
/** Rouen's sorts that don't map, and why. */
const SORT_NOT = Object.freeze({ lastplayed: "its Last played order (Roon has no such album order)",
  label: "its Label & catalogue № order (Roon has no such album order)",
  // Rouen's ascending is least played first; which way Roon's MostPlayed runs isn't known, and a read-back can't tell.
  plays: "its Most played order (which way Roon's runs isn't known yet)" });
/** Roon's AlbumType for each kind Rouen's Album type facet names (v1.9.67, §12.19); Remix has no Roon type. */
const ALBUM_TYPE = Object.freeze({ album: 0, single: 1, live: 2, compilation: 3, other: 4, ep: 6, soundtrack: 7 });
/** Rouen's facets Roon's Focus can't hold: what the page calls them, and why (§12.15). */
const FACET_NOT = Object.freeze({ chan: ["Channels", "Roon's channel layout names aren't known"], letter: ["Starts with", "Roon has no first-letter filter"] });
/** Roon's FileFormat for each format Rouen's file scan names (music-metadata's container, upper-cased). */
const FORMAT = Object.freeze({ FLAC: 1, MPEG: 4, WAVE: 5, OGG: 6, AIFF: 7, DSF: 13, DSDIFF: 14 });
/** Roon's FileFormat for a source: the services are formats in Roon's Focus. */
const TIDAL = 12, QOBUZ = 15, KKBOX = 17;
/** "Ever", in days: Roon's played filters count days back. */
const EVER_DAYS = 36500;
/** Rouen's month, in days (playedTitleSet). */
const MONTH_DAYS = 30;

/**
 * @typedef {{ name: string, view?: Record<string, any>, limit?: number, mode?: string, order?: string }} Dynamic
 *   a Dynamic Playlist as Rouen keeps it (settings.json smartPlaylists)
 * @typedef {{ require: number[], exclude: number[] }} Ints
 * @typedef {{ dates: { min: number, max: number } | null, formats: Ints, types: Ints, rates: Ints, bits: Ints,
 *             labels: { require: string[], exclude: string[] }, played: { require: number | null, exclude: number | null },
 *             imported: { require: number | null, exclude: number | null } }} Extra
 *   the members beyond the genres and the order (§12.15); dates as the NullDate's integer (§12.12)
 * @typedef {{ include: string[], exclude: string[], ordering: number, direction: number, seed: number | null, sort: string,
 *             extra: Extra }} Mapped
 */

/** A NullDate's integer (§12.12). @param {number} y @param {number} m @param {number} d */
const nullDate = (y, m, d) => (y << 16) | (m << 8) | d;

/** A facet's selection, split into what it includes and what it excludes ("!"). @param {any} sel */
function split(sel) {
  const all = Array.isArray(sel) ? sel.map(String) : [];
  return { inc: all.filter((x) => !x.startsWith("!")), exc: all.filter((x) => x.startsWith("!")).map((x) => x.slice(1)) };
}

/** A facet's numbers, or null when one isn't a whole number. @param {string[]} xs */
function ints(xs) {
  const out = xs.map((x) => Number(x));
  return out.every((n) => Number.isInteger(n) && n > 0) ? out : null;
}

/**
 * Its Decade as one date range, or why not. @param {string[]} inc @param {string[]} exc
 * @returns {{ dates: { min: number, max: number } | null } | { why: string }}
 */
function decades(inc, exc) {
  if (exc.length) return { why: "an excluded decade (Roon's Focus holds one date range)" };
  if (!inc.length) return { dates: null };
  const ds = ints(inc);
  if (!ds || ds.some((d) => d % 10 !== 0)) return { why: "a decade Rouen doesn't know" };
  const sorted = [...new Set(ds)].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 10) return { why: "decades with a gap between them (Roon's Focus holds one date range)" };
  }
  return { dates: { min: nullDate(sorted[0], 0, 0), max: nullDate(sorted[sorted.length - 1] + 9, 12, 31) } };
}

const SOURCES = Object.freeze(["local", "qobuz", "tidal"]);
/** A streaming source's Roon file format: the services are formats in Roon's Focus. */
const SERVICE = /** @type {Record<string, number>} */ ({ qobuz: QOBUZ, tidal: TIDAL });

/**
 * Its Source and Format as Roon's file formats, or why not. The sources an album may come from are worked out first
 * (those included, or all; less those excluded), then said as one list: without Local, the services allowed, required;
 * with Local, the services not allowed, excluded (KKBox too, when sources were picked: Rouen has none of its albums).
 * @param {any} source @param {any} format
 * @returns {{ formats: Ints } | { why: string }}
 */
function fileFormats(source, format) {
  const s = split(source), f = split(format);
  for (const x of s.inc.concat(s.exc)) if (!SOURCES.includes(x)) return { why: `a source Rouen doesn't know ("${x}")` };
  for (const x of f.inc.concat(f.exc)) {
    if (/** @type {any} */ (FORMAT)[x] === undefined) return { why: `the format "${x}" (Rouen doesn't know which of Roon's formats it is)` };
  }
  const allowed = (s.inc.length ? s.inc : SOURCES).filter((x) => !s.exc.includes(x));
  if (!allowed.length) return { why: "no source left once its exclusions are taken" };
  /** @type {number[]} */
  const require = [], exclude = [];
  if (!allowed.includes("local")) require.push(...allowed.map((x) => SERVICE[x]));
  else {
    exclude.push(...SOURCES.filter((x) => x !== "local" && !allowed.includes(x)).map((x) => SERVICE[x]));
    if (s.inc.length) exclude.push(KKBOX);
  }
  const fmtInc = f.inc.map((x) => /** @type {number} */ (/** @type {any} */ (FORMAT)[x]));
  // One list, any of it: formats required together with services required would read as either, not both (§12.15).
  if (require.length && fmtInc.length) return { why: "a format together with a streaming source (Roon's Focus holds them in one list, any of it)" };
  require.push(...fmtInc);
  exclude.push(...f.exc.map((x) => /** @type {number} */ (/** @type {any} */ (FORMAT)[x])));
  const uniq = (/** @type {number[]} */ xs) => [...new Set(xs)];
  return { formats: { require: uniq(require), exclude: uniq(exclude) } };
}

/**
 * Its Played filter as Roon's day counts. @param {string} played
 * @returns {{ require: number | null, exclude: number | null } | null}  null: one Rouen doesn't know
 */
function playedDays(played) {
  if (played === "any") return { require: null, exclude: null };
  if (played === "never") return { require: null, exclude: EVER_DAYS };
  if (played === "played") return { require: EVER_DAYS, exclude: null };
  const months = Number(played);
  return Number.isInteger(months) && months > 0 ? { require: null, exclude: months * MONTH_DAYS } : null;
}

/**
 * @param {Dynamic} sp
 * @param {number | null} matched  how many albums its Focus matches in Rouen's library now; null when not yet known
 * @param {string | null} unavailable  why Rouen itself can't use it now (Labels off), or null
 * @returns {{ focus: Mapped, notes: string[] } | { why: string[] }}
 */
function mapFocus(sp, matched, unavailable) {
  const v = sp.view || {};
  /** @type {string[]} */
  const why = [];
  if (unavailable) why.push(unavailable);
  for (const [id, [what, because]] of Object.entries(FACET_NOT)) {
    const sel = v[id];
    if (Array.isArray(sel) && sel.length) why.push(`its ${what} filter (${because})`);
  }
  const sort = String(v.sort || "album");
  if (/** @type {any} */ (SORT_NOT)[sort]) why.push(/** @type {any} */ (SORT_NOT)[sort]);
  else if (/** @type {any} */ (ORDERING)[sort] === undefined) why.push(`its "${sort}" order (Rouen doesn't know it)`);
  const g = split(v.genre), d = split(v.decade);
  const dec = decades(d.inc, d.exc);
  if ("why" in dec) why.push(`its Decade filter: ${dec.why}`);
  const fmt = fileFormats(v.source, v.format);
  if ("why" in fmt) why.push(`its Source or Format filter: ${fmt.why}`);
  const rate = split(v.rate), bits = split(v.bits), added = split(v.added), type = split(v.type);
  // Each kind as Roon's AlbumType (§12.19); one Roon hasn't (Remix) stops it, named.
  for (const t of type.inc.concat(type.exc)) {
    if (/** @type {any} */ (ALBUM_TYPE)[t] === undefined) why.push(t === "remix" ? "its Remix type (Roon has no such album type)" : `its "${t}" album type (Rouen doesn't know it)`);
  }
  const types = { require: type.inc.map((t) => /** @type {number} */ (/** @type {any} */ (ALBUM_TYPE)[t])), exclude: type.exc.map((t) => /** @type {number} */ (/** @type {any} */ (ALBUM_TYPE)[t])) };
  const rates = { require: ints(rate.inc), exclude: ints(rate.exc) }, depth = { require: ints(bits.inc), exclude: ints(bits.exc) };
  const addedInc = ints(added.inc), addedExc = ints(added.exc);
  if (!rates.require || !rates.exclude) why.push("its Sample rate filter: a rate Rouen doesn't know");
  if (!depth.require || !depth.exclude) why.push("its Bit depth filter: a depth Rouen doesn't know");
  if (!addedInc || !addedExc) why.push("its Added in the last filter: a window Rouen doesn't know");
  const played = playedDays(String(v.played || "any"));
  if (!played) why.push(`its Played filter ("${v.played}", which Rouen doesn't know)`);
  if (why.length || "why" in dec || "why" in fmt || !played || !rates.require || !rates.exclude || !depth.require || !depth.exclude
    || !addedInc || !addedExc) return { why };
  const label = split(v.label);
  const widest = (/** @type {number[] | null} */ xs) => (xs && xs.length ? Math.max(...xs) : null);
  /** @type {string[]} */
  const notes = [];
  const limit = Number.isFinite(sp.limit) ? Number(sp.limit) : null;
  if (limit !== null && (matched === null || matched > limit)) {
    notes.push(matched === null
      ? `Roon's smart playlists have no album limit: Roon holds every album it matches, not ${limit}.`
      : `Roon's smart playlists have no album limit: Roon holds all ${matched} albums it matches, not ${limit}.`);
  }
  if (sp.order === "random") notes.push("Rouen plays it in random order: in Roon, play it with Shuffle.");
  // Roon's RandomSeed is an int: a seed past it is brought into range, not wrapped to a negative one (the review).
  const seed = Number.isFinite(Number(v.seed)) && Number(v.seed) > 0 ? (Math.floor(Number(v.seed)) % 2147483647) || 1 : 1;
  return { focus: { include: g.inc, exclude: g.exc, ordering: /** @type {any} */ (ORDERING)[sort], direction: v.dir === "desc" ? DESCENDING : ASCENDING,
    seed: sort === "random" ? seed : null, sort, extra: {
      dates: dec.dates, formats: fmt.formats, types, rates: { require: rates.require, exclude: rates.exclude },
      bits: { require: depth.require, exclude: depth.exclude }, labels: { require: label.inc, exclude: label.exc }, played,
      imported: { require: widest(addedInc), exclude: widest(addedExc) } } }, notes };
}

module.exports = { mapFocus, ORDERING, nullDate, ALBUM_TYPE };
