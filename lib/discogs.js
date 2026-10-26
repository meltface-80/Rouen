// @ts-check
"use strict";
/*
 * discogs.js — what Rouen asks Discogs. The label lookup and the label-logo search moved here from index.js in
 * v1.9.67-t2 (dev/quality.md); the release lookup grew then to keep the release's catalogue number and format
 * too (dev/design/catalogue.md §4: for an album whose tags gave no catalogue number, the label scan's Discogs
 * pass looks the release up and keeps its catno, label and format, never above a tag).
 *
 *   createDiscogs(deps)                 the client: one request at a time, 1.1 s apart (a token allows 60/min)
 *     .wait()                           the limiter, for a caller that builds its own request
 *     .release(title, artist)           → { label, catno, type } for the release that matches the title, or null
 *                                         when nothing came back; THROWS on a failed request, so a caller can
 *                                         tell a miss (cache it) from an error (try again later)
 *     .logo(labelName)                  → { logo, reason }  a label's cover image, or why not
 *   releaseFromResults(results, title, artist, deps)   pure: the match and what is kept of it
 *   typeFromFormats(formats)            pure: Discogs' format descriptions → a kind (lib/release-facts.js TYPES)
 *   sanitizeDiscogsSearchTerm(name)     pure
 */

const { catalogueNumber } = require("./release-facts");

/**
 * Strip leading AND trailing non-alphanumeric chars before Discogs queries. Discogs Elasticsearch treats ~ as a
 * fuzzy operator and unbalanced brackets like "[PIAS]" → "PIAS]" trip range-query parsing.
 * @param {string} name
 */
function sanitizeDiscogsSearchTerm(name) {
  return name.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "").trim() || name;
}

/**
 * Discogs describes a release by its formats ("Vinyl", "LP", "Album", "Reissue"; "Vinyl", "12\"", "EP"; "CD",
 * "Compilation"). The descriptions that say what kind of release it is, the most telling first: a compilation on
 * LP is a compilation; a DJ mix is a remix; a 7" is a single whatever else it says. A 12" or 10" alone says
 * nothing (an EP or a single), nor does "Reissue" or "Promo"; Live and Soundtrack are not formats on Discogs.
 */
/** @type {Array<[string, string[]]>} */
const FORMAT_KINDS = [
  ["compilation", ["compilation"]],
  ["remix", ["mixed", "partially mixed", "mixtape", "dj mix"]],
  ["ep", ["ep", "mini-album"]],
  ["single", ["single", "maxi-single", "7\""]],
  ["album", ["album", "lp"]],
];

/** @param {any} formats  the result's `format` (strings) @returns {string | null} */
function typeFromFormats(formats) {
  const words = (Array.isArray(formats) ? formats : formats ? [formats] : []).map((f) => String(f).trim().toLowerCase());
  for (const [id, names] of FORMAT_KINDS) if (names.some((n) => words.includes(n))) return id;
  return null;
}

/**
 * The release that matches the title (its title holds "Artist - Title"): one whose title IS the artist's and the
 * album's first, since a catalogue number is an edition's — "Geogaddi" over "Geogaddi (Remixes)" — then one
 * whose title holds the album's (as the label lookup always matched), else Discogs' first. What is kept of it: its first label unless that
 * is plainly not one, its catalogue number tidied (Discogs writes "none" for a release without one), and its
 * kind from its formats.
 * @param {any} results  the search answer's `results`
 * @param {string} title @param {string} artist  may be empty
 * @param {{ normalize: (s: string) => string, isLikelyNotALabel: (s: string) => boolean }} d
 * @returns {{ label: string | null, catno: string | null, type: string | null } | null}  null when nothing came back
 */
function releaseFromResults(results, title, artist, d) {
  if (!Array.isArray(results) || !results.length) return null;
  const normTitle = d.normalize(title);
  const normArtist = artist ? d.normalize(artist) : "";
  const exact = new Set(normArtist ? [normTitle, normArtist + " " + normTitle] : [normTitle]);
  const titled = results.filter((r) => r && d.normalize(r.title || "").includes(normTitle));
  const match = titled.find((r) => exact.has(d.normalize(r.title || ""))) || titled[0] || results[0];
  if (!match) return null;
  const first = Array.isArray(match.label) ? match.label[0] : null;
  const label = first && !d.isLikelyNotALabel(first) ? String(first) : null;
  return { label, catno: catalogueNumber({ catalognumber: match.catno }), type: typeFromFormats(match.format) };
}

/**
 * @param {{ token: () => string, http: (url: string, headers: Record<string, string>, timeoutMs?: number) => Promise<any>,
 *           userAgent: string, normalize: (s: string) => string, isLikelyNotALabel: (s: string) => boolean,
 *           labelGroupKey: (s: string) => string, debug?: boolean, now?: () => number,
 *           sleep?: (ms: number) => Promise<void> }} d
 */
function createDiscogs(d) {
  const now = d.now || Date.now;
  const sleep = d.sleep || ((/** @type {number} */ ms) => new Promise((r) => { setTimeout(r, ms); }));
  let lastReq = 0;
  /** Callers take their turn: two that arrive together (the scan's pass and the logo picker) used to both see the
   * gap elapsed and both fire, and Discogs' 429 now counts against the pass (the review). */
  let turn = Promise.resolve();
  const headers = () => ({ "Authorization": "Discogs token=" + d.token(), "User-Agent": d.userAgent });
  function wait() {
    const mine = turn.then(async () => {
      const elapsed = now() - lastReq;
      if (elapsed < 1100) await sleep(1100 - elapsed);
      lastReq = now();
    });
    turn = mine.catch(() => {});   // the next caller waits for this one whatever became of it
    return mine;
  }
  return {
    wait,
    /** @param {string} title @param {string} [artist] */
    async release(title, artist) {
      if (!title || !d.token()) return null;
      await wait();
      const params = new URLSearchParams({ type: "release", release_title: title });
      if (artist) params.set("artist", artist);
      let json;
      try {
        json = await d.http("https://api.discogs.com/database/search?" + params, headers());
      } catch (e) {
        if (d.debug) console.error("[labels:discogs]", e.message);
        throw e;
      }
      return releaseFromResults(json && json.results, title, artist, d);
    },
    /**
     * A label's logo: Discogs searched by the label's name, the best name match's cover image. Moved from index.js
     * unchanged. @param {string} labelName @returns {Promise<{ logo: string | null, reason: string }>}
     */
    async logo(labelName) {
      if (!d.token()) return { logo: null, reason: "no-token" };
      await wait();
      const searchTerm = sanitizeDiscogsSearchTerm(labelName);
      const url = "https://api.discogs.com/database/search?type=label&q=" + encodeURIComponent(searchTerm) + "&per_page=5";
      try {
        const json = await d.http(url, headers(), 10000);
        const results = json && json.results;
        if (!Array.isArray(results) || !results.length) return { logo: null, reason: "empty" };
        const normTarget = d.labelGroupKey(labelName);
        let match = results.find((r) => d.labelGroupKey(r.title || "") === normTarget);
        if (!match) match = results.find((r) => d.labelGroupKey(r.title || "").startsWith(normTarget));
        if (!match) match = results[0];
        const img = match.cover_image || match.thumb || null;
        if (!img || img.endsWith(".gif") || /no[-_]image|no[-_]label|spacer|avatar|default[-_]label/i.test(img)) {
          return { logo: null, reason: "filtered" };
        }
        return { logo: img, reason: "ok" };
      } catch (e) {
        // 429 = rate limited — handled with a cooldown by the caller, don't log per-attempt.
        if (/HTTP 429/.test(e.message || "")) return { logo: null, reason: "rate" };
        if (d.debug) console.error("[labels:discogs:logo]", e.message);
        return { logo: null, reason: "error" };
      }
    },
  };
}

module.exports = { createDiscogs, releaseFromResults, typeFromFormats, sanitizeDiscogsSearchTerm };
