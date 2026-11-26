// @ts-check
"use strict";
/*
 * tune.js — Smart Picks' Tune (dev/design/smart-picks.md §5, 2.0.7-t1): what the controls are, what a saved Tune may
 * hold, and what each control does to the seeds (seeds.js) and to the ranking (rank.js).
 *
 *   Listening window  5 stops, Recent … All time: the half-life of an album play (14, 45, 90, 365 days; All time:
 *                     every play weighs 1). Middle (90 days) by default.
 *   Adventure         5 stops, Close … Far: candidates ranked by similarity (Close), by distance (Far, how it was
 *                     before Tune), or a blend of the two orders. Far by default (the owner, 2026-11-26: untouched,
 *                     Smart Picks is as it was).
 *   Genres, Decades   each Never / Less / As I listen / More: × 0, 0.5, 1, 2.
 *   Artists           More from X (always a seed) / Never start from X (never a seed); one or the other.
 *
 * Kept as one record (settings `smartPicksTune`; per profile once profiles.md is built). Only what differs from
 * "As I listen" is stored, so Reset is the empty record.
 */

/** @typedef {"never" | "less" | "more"} Level  "as" (As I listen) is never stored */
/**
 * @typedef {{ window: number, adventure: number, genres: Record<string, Level>, decades: Record<string, Level>,
 *   more: Array<{ canon: string, name: string }>, never: Array<{ canon: string, name: string }> }} Tune
 */

const WINDOW_DAYS = [14, 45, 90, 365, Infinity];
const WINDOW_LABELS = ["Recent", "6 weeks", "3 months", "A year", "All time"];
const ADVENTURE_LABELS = ["Close", "Near", "Middle", "Wide", "Far"];
const MIDDLE = 2;
/** Adventure's default: Far, the ranking before Tune. */
const FAR = 4;
const LEVEL_FACTOR = { never: 0, less: 0.5, as: 1, more: 2 };
const LEVELS = ["never", "less", "as", "more"];
const MAX_KEYS = 60;
const MAX_ARTISTS = 100;
const MAX_NAME = 200;

/** @returns {Tune} */
function defaultTune() {
  return { window: MIDDLE, adventure: FAR, genres: {}, decades: {}, more: [], never: [] };
}

/** @param {unknown} v @param {string} what */
function stop(v, what) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 4) throw new Error(what + " must be 0-4");
  return n;
}

/** @param {unknown} v @param {string} what @param {(k: string) => boolean} keyOk */
function levels(v, what, keyOk) {
  /** @type {Record<string, Level>} */
  const out = {};
  if (v == null) return out;
  if (typeof v !== "object" || Array.isArray(v)) throw new Error(what + " must be an object");
  const entries = Object.entries(/** @type {Record<string, unknown>} */ (v));
  if (entries.length > MAX_KEYS) throw new Error("too many " + what);
  for (const [k, lv] of entries) {
    if (!keyOk(k)) throw new Error("not a " + what.replace(/s$/, "") + ": " + JSON.stringify(k).slice(0, 80));
    if (LEVELS.indexOf(String(lv)) === -1) throw new Error(what + " must be never, less, as or more");
    if (lv !== "as") out[k] = /** @type {Level} */ (lv);
  }
  return out;
}

/** @param {unknown} v @param {string} what @param {(name: string) => string} canonArtist */
function artists(v, what, canonArtist) {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new Error(what + " must be a list");
  if (v.length > MAX_ARTISTS) throw new Error("too many artists in " + what);
  /** @type {Map<string, { canon: string, name: string }>} */
  const out = new Map();
  for (const a of v) {
    const raw = typeof a === "string" ? a : a && typeof a === "object" && typeof a.name === "string" ? a.name : "";
    const name = raw.trim().slice(0, MAX_NAME);
    const canon = name ? canonArtist(name) : "";
    if (!canon) throw new Error("not an artist in " + what + ": " + JSON.stringify(name).slice(0, 80));
    if (!out.has(canon)) out.set(canon, { canon, name });
  }
  return [...out.values()];
}

/**
 * A Tune from what was sent or saved, every field checked before any is taken (a refused one changes nothing).
 * Throws with the reason. @param {any} raw @param {(name: string) => string} canonArtist @returns {Tune}
 */
function parseTune(raw, canonArtist) {
  if (raw == null) return defaultTune();
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("tune must be an object");
  const t = {
    window: raw.window === undefined ? MIDDLE : stop(raw.window, "window"),
    adventure: raw.adventure === undefined ? FAR : stop(raw.adventure, "adventure"),
    genres: levels(raw.genres, "genres", (k) => k.length > 0 && k.length <= 80),
    decades: levels(raw.decades, "decades", (k) => /^(\d{0,3}0s|unknown)$/.test(k)),   // seeds.js decadeOf's names
    more: artists(raw.more, "more", canonArtist),
    never: artists(raw.never, "never", canonArtist),
  };
  const never = new Set(t.never.map((a) => a.canon));
  if (t.more.some((a) => never.has(a.canon))) throw new Error("an artist can't be both More and Never");
  return t;
}

/** The saved Tune, or "As I listen" where nothing usable was saved. @param {any} saved @param {(name: string) => string} canonArtist */
function loadTune(saved, canonArtist) {
  try { return parseTune(saved, canonArtist); }
  catch (e) {
    // A hand-edited settings file can't stop the build: it reads as never tuned, and the Tune sheet shows it so.
    console.warn("[picks] the saved Tune was ignored: " + /** @type {Error} */ (e).message);
    return defaultTune();
  }
}

/**
 * One artist moved: "more", "never" or "none" (neither). @param {Tune} t @param {string} name @param {string} as
 * @param {(name: string) => string} canonArtist @returns {Tune}
 */
function withArtist(t, name, as, canonArtist) {
  const n = String(name || "").trim().slice(0, MAX_NAME);
  const canon = n ? canonArtist(n) : "";
  if (!canon) throw new Error("not an artist: " + JSON.stringify(n).slice(0, 80));
  if (["more", "never", "none"].indexOf(as) === -1) throw new Error("as must be more, never or none");
  const keep = (/** @type {Array<{ canon: string, name: string }>} */ list) => list.filter((a) => a.canon !== canon);
  const out = Object.assign({}, t, { more: keep(t.more), never: keep(t.never) });
  if (as === "more" || as === "never") {
    if (out[as].length >= MAX_ARTISTS) throw new Error("too many artists in " + as);
    out[as] = out[as].concat([{ canon, name: n }]);
  }
  return out;
}

/** The half-life the Listening window gives, in days (Infinity: All time). @param {Tune} t */
const halfLifeOf = (t) => WINDOW_DAYS[t.window];

/**
 * What chooseSeeds needs of a Tune: the genre and decade factors, and the artists.
 * @param {Tune} t
 * @returns {{ genre: (g: string) => number, decade: (d: string) => number, more: string[], never: Set<string> }}
 */
function seedTune(t) {
  return {
    genre: (g) => LEVEL_FACTOR[t.genres[g] || "as"],
    decade: (d) => LEVEL_FACTOR[t.decades[d] || "as"],
    more: t.more.map((a) => a.canon),
    never: new Set(t.never.map((a) => a.canon)),
  };
}

/** How a Tune reads, for Why these picks: only what differs from "As I listen". @param {Tune} t */
function describeTune(t) {
  const parts = [];
  if (t.window !== MIDDLE) parts.push("Listening window: " + WINDOW_LABELS[t.window]);
  if (t.adventure !== FAR) parts.push("Adventure: " + ADVENTURE_LABELS[t.adventure]);
  const word = { never: "Never", less: "Less", more: "More" };
  for (const [g, lv] of Object.entries(t.genres)) parts.push(g + ": " + word[lv]);
  for (const [d, lv] of Object.entries(t.decades)) parts.push(d + ": " + word[lv]);
  if (t.more.length) parts.push("More from " + t.more.map((a) => a.name).join(", "));
  if (t.never.length) parts.push("Never start from " + t.never.map((a) => a.name).join(", "));
  return parts;
}

module.exports = { defaultTune, parseTune, loadTune, withArtist, halfLifeOf, seedTune, describeTune,
  WINDOW_DAYS, WINDOW_LABELS, ADVENTURE_LABELS, LEVEL_FACTOR, MIDDLE, FAR };
