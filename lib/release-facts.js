// @ts-check
"use strict";
/*
 * release-facts.js — an album's catalogue number and what kind of release it is (v1.9.67, a user's request: "my main
 * goto way to sort electronic music vinyls" — browse by label and catalogue number, and by album, EP or single).
 *
 * Read from the files' own tags by the /music walk (index.js runFileMetadataScan: CATALOGNUMBER and RELEASETYPE,
 * as MusicBrainz Picard and beets write them), kept by album key beside the file facts (the badge's keys, so an
 * album is found by its title and artist in both modes), and read by the Shelf, the Library's Focus and sort, and
 * the album page. Nothing is guessed: an album whose tags say nothing has no kind and no number. Discogs's and
 * Roon's own values come in later builds (dev/design/catalogue.md), each ranked below a tag the owner wrote.
 *
 *   releaseType(common)       what the tags say the release is, as one of TYPES' ids, or null
 *   catalogueNumber(common)   the tag, tidied, or null
 *   naturalCompare(a, b)      a shop's order for labels and catalogue numbers: numbers as numbers, case alike —
 *                             "WARP 61" before "WARP 123", "ZIQ028" before "ZIQ110"; the Shelf collates the same way
 *   createReleaseFacts(deps)  the cache: set(key, facts, src), replaceSource(src, entries), get(key), forKeys(keys),
 *                             clear(src), load(rows), version()
 */

/** What a release can be — its id, its name, and its name for many — in the order they are shown. The one vocabulary:
 * the Shelf is sent it (lib/shelf-routes.js `kinds`) rather than keeping a copy. */
const TYPES = Object.freeze([
  ["album", "Album", "Albums"], ["ep", "EP", "EPs"], ["single", "Single", "Singles"], ["compilation", "Compilation", "Compilations"],
  ["live", "Live", "Live"], ["soundtrack", "Soundtrack", "Soundtracks"], ["remix", "Remix", "Remixes"], ["other", "Other", "Other"],
]);
const TYPE_IDS = new Set(TYPES.map(([id]) => id));
/** Each kind's name. */
const TYPE_NAMES = Object.freeze(Object.fromEntries(TYPES.map(([id, one]) => [id, one])));
/** The kinds as the Shelf is sent them. */
const KINDS = Object.freeze(TYPES.map(([id, one, many]) => Object.freeze({ id, one, many })));

/**
 * MusicBrainz's secondary types that say more than the primary (Picard writes "album; compilation"), first match
 * wins; then its primary types.
 */
const SECONDARY = [["compilation", "compilation"], ["soundtrack", "soundtrack"], ["live", "live"], ["remix", "remix"],
  ["dj-mix", "remix"], ["mixtape", "remix"]];
const PRIMARY = { album: "album", lp: "album", ep: "ep", single: "single", broadcast: "other", other: "other" };

/**
 * What the tags say the release is. RELEASETYPE holds one value or several ("album", "ep", "album; compilation",
 * or a list); COMPILATION (iTunes') says compilation on its own.
 * @param {{ releasetype?: any, compilation?: any } | null | undefined} common  music-metadata's common tags
 * @returns {string | null}
 */
function releaseType(common) {
  if (!common) return null;
  const raw = common.releasetype;
  const words = (Array.isArray(raw) ? raw : raw ? [raw] : []).flatMap((v) => String(v).split(/[;,/]/))
    .map((w) => w.trim().toLowerCase()).filter(Boolean);
  for (const [word, id] of SECONDARY) if (words.includes(word)) return id;
  for (const w of words) if (PRIMARY[w]) return PRIMARY[w];
  if (common.compilation === true) return "compilation";
  return null;
}

/** A value that is a kind, as read back from elsewhere (settings, the database). @param {any} v */
const isType = (v) => typeof v === "string" && TYPE_IDS.has(v);

/**
 * The catalogue number as tagged, tidied: one line, one space between its parts, nothing when the tag only says
 * there is none.
 * @param {{ catalognumber?: any } | null | undefined} common
 * @returns {string | null}
 */
function catalogueNumber(common) {
  if (!common) return null;
  const raw = common.catalognumber;
  const first = Array.isArray(raw) ? raw.find((v) => String(v).trim()) : raw;
  if (first === undefined || first === null) return null;
  const s = String(first).replace(/\s+/g, " ").trim();
  if (!s || /^(none|n\/?a|unknown|-+)$/i.test(s) || s.length > 40) return null;
  return s;
}

/** One collation for labels and catalogue numbers, here and on the Shelf (shelf-pick.js): "en", numbers as numbers, case alike. */
const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
/** @param {string} a @param {string} b */
const naturalCompare = (a, b) => natural.compare(a, b);
const compareCatalogue = naturalCompare;

/** Better evidence replaces worse: a tag the owner wrote, then Roon's identification, then a Discogs match. */
const RANK = { file: 3, roon: 2, discogs: 1 };

/**
 * @typedef {{ catno: string | null, type: string | null, src: string }} ReleaseFacts
 * @param {{ save?: (key: string, f: ReleaseFacts) => void, remove?: (src: string) => void }} [deps]
 *   save: write one record (the labels database); remove: drop a source's records
 */
function createReleaseFacts(deps = {}) {
  /** @type {Map<string, ReleaseFacts>} */
  const cache = new Map();
  /** Moves whenever what is held changes: the Shelf's kept answer follows it. */
  let version = 0;
  /** @param {string} key @param {any} f @returns {ReleaseFacts | null} what is worth keeping of it */
  const tidy = (key, f) => {
    if (!key || !f) return null;
    const catno = typeof f.catno === "string" && f.catno.trim() ? f.catno.trim() : null;
    const type = isType(f.type) ? f.type : null;
    return catno === null && type === null ? null : { catno, type, src: "" };
  };
  const same = (/** @type {ReleaseFacts | undefined} */ a, /** @type {ReleaseFacts} */ b) => !!a && a.catno === b.catno && a.type === b.type && a.src === b.src;
  return {
    /**
     * Kept when its source ranks at least as high as what is held (a tie keeps the first writer, as the file facts
     * do: a set's discs are walked twice under one key). @param {string} key @param {{ catno?: any, type?: any }} f
     * @param {string} src @returns {boolean} whether it was kept
     */
    set(key, f, src) {
      const rec = tidy(key, f);
      if (!rec) return false;
      rec.src = src;
      const prev = cache.get(key);
      if (prev && (RANK[prev.src] || 0) >= (RANK[src] || 0)) return false;
      cache.set(key, rec);
      version++;
      if (deps.save) deps.save(key, rec);
      return true;
    },
    /**
     * A source read whole again (the /music walk): what it says now replaces what it said before — a corrected tag
     * replaces the old number, a tag removed removes it — and what another source holds is kept as `set` keeps it.
     * Published at once, after the read, so a walk cut short changes nothing (the review).
     * @param {string} src @param {Map<string, { catno?: any, type?: any }>} entries  by key, as the source read them
     * @returns {number} how many records changed: added, replaced or removed
     */
    replaceSource(src, entries) {
      let changed = 0;
      for (const [key, prev] of cache) {
        if (prev.src === src && !entries.has(key)) { cache.delete(key); changed++; }
      }
      if (changed && deps.remove) deps.remove(src);   // the rows dropped; the rows kept are written again below
      for (const [key, f] of entries) {
        const rec = tidy(key, f);
        if (!rec) continue;
        rec.src = src;
        const prev = cache.get(key);
        if (prev && prev.src !== src && (RANK[prev.src] || 0) >= (RANK[src] || 0)) continue;
        if (!same(prev, rec)) changed++;
        cache.set(key, rec);
        if (deps.save) deps.save(key, rec);
      }
      if (changed) version++;
      return changed;
    },
    /** @param {string} key */
    get: (key) => cache.get(key) || null,
    /** The first found of an album's keys (its srcKeys, as the badge and the file facts are looked up). @param {string[]} keys */
    forKeys(keys) {
      for (const k of keys || []) { const f = cache.get(k); if (f) return f; }
      return null;
    },
    /** Loaded from the database at start, as saved: no ranking, no write. @param {Array<{ key: string, catno?: any, rtype?: any, src?: any }>} rows */
    load(rows) {
      for (const r of rows || []) {
        if (!r || typeof r.key !== "string") continue;
        cache.set(r.key, { catno: typeof r.catno === "string" && r.catno ? r.catno : null, type: isType(r.rtype) ? r.rtype : null, src: String(r.src || "") });
      }
      version++;
    },
    /** A source's records dropped (a service disconnected). @param {string} src @returns {number} how many */
    clear(src) {
      let n = 0;
      for (const [k, f] of cache) if (f.src === src) { cache.delete(k); n++; }
      if (n) { version++; if (deps.remove) deps.remove(src); }
      return n;
    },
    size: () => cache.size,
    version: () => version,
  };
}

module.exports = { TYPES, TYPE_NAMES, KINDS, releaseType, catalogueNumber, naturalCompare, compareCatalogue, createReleaseFacts, isType };
