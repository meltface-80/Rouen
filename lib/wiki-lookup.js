// @ts-check
"use strict";
/*
 * wiki-lookup.js — an album's Wikipedia article and its artist's, for the album view, the share card and the wall
 * display. Moved out of index.js in v2.0.3-t12 (dev/quality.md, "Splitting the monoliths"), unchanged but for two
 * things (lib/lookup-once.js says why):
 *   - the album view's lookup and the share card's, a second or two apart, are one lookup: the card waits for the
 *     view's answer instead of asking Wikipedia four or five times more;
 *   - a lookup that failed in a way that may pass (Wikipedia's 429, a time limit) is not remembered as "no article":
 *     the next ask tries again. What one half found (the album's article, when the artist's failed) is still shown.
 *
 *   fetchWikipedia(title, artist) → { album, artist } | null   remembered for the album
 *   fetchWikiArtist(name, albumTitle) → the artist's article | null   (the wall display's bios: their own cache)
 */
const wikiMatch = require("./wiki-match");
const { lookupOnce, mayPass } = require("./lookup-once");

/**
 * Strip ONE trailing parenthetical qualifier from a Wikipedia title: "Camel (band)" → "Camel". Lets the title-identity
 * check accept music qualifiers while still demanding the article IS the artist.
 * @param {string} t
 */
function wikiTitleBase(t) {
  return String(t || "").replace(/\s*\([^()]*\)\s*$/, "").trim();
}

/**
 * @param {{ httpJson: (url: string, headers: Record<string, string>) => Promise<any>, normalize: (s: string) => string,
 *           namesEqualLoose: (a: string, b: string) => boolean, userAgent: string, debug?: boolean,
 *           cache?: Map<string, any> }} d
 *   namesEqualLoose: the same name, "The" or not (index.js's, which it uses elsewhere); cache: the albums' answers
 *   (index.js's wikiCache), one of its own when none is given
 */
function createWikiLookup(d) {
  const wikiCache = d.cache || new Map();
  const normalize = d.normalize;
  const namesEqualLoose = d.namesEqualLoose;

  // Wikipedia: search + first-paragraph extract via the MediaWiki API.
  /** @param {string} query @param {number} [limit] @returns {Promise<any[]>} */
  async function wikiSearch(query, limit = 5) {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search` +
      `&srsearch=${encodeURIComponent(query)}&srlimit=${limit}&format=json&origin=*`;
    const data = await d.httpJson(url, { "User-Agent": d.userAgent });
    return (data && data.query && data.query.search) || [];
  }
  /** @param {string} pageTitle @returns {Promise<{ title: string, description: string, url: string } | null>} */
  async function wikiExtract(pageTitle) {
    const url = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts|info` +
      `&exintro=true&explaintext=true&redirects=1&inprop=url` +
      `&titles=${encodeURIComponent(pageTitle)}&format=json&origin=*`;
    const data = await d.httpJson(url, { "User-Agent": d.userAgent });
    const pages = (data && data.query && data.query.pages) || {};
    const page = pages[Object.keys(pages)[0]];
    if (!page || !page.extract) return null;
    return {
      title:       page.title,
      description: page.extract,
      url:         page.fullurl ||
                   `https://en.wikipedia.org/wiki/${encodeURIComponent(String(page.title).replace(/ /g, "_"))}`
    };
  }

  /** @param {string} title @param {string} artist */
  async function fetchWikiAlbum(title, artist) {
    if (!title) return null;
    const artistFirst = normalize(artist || "").split(" ")[0];
    const candidates  = await wikiSearch(`${title} ${artist || ""} album`);

    for (const c of candidates) {
      const ext = await wikiExtract(c.title);
      if (!ext) continue;

      const lead     = ext.description.slice(0, 400);
      const headNorm = normalize(ext.description.slice(0, 800));

      // (1) The article must actually be about THIS album: its Wikipedia title
      //     must name the album, as whole words, BEFORE the disambiguator (see
      //     lib/wiki-match.js). Reading the disambiguator too is what showed
      //     Runnin' Wild for Airbourne's self-titled album — "Runnin' Wild
      //     (Airbourne album)" contains "Airbourne", and for a self-titled
      //     record the album name is the act's name, so every album they ever
      //     made matched and the first search result won.
      if (!wikiMatch.albumPageTitleMatches(title, c.title)) continue;

      // (2) Reject person biographies.  These slipped through before because a
      //     musician's bio mentions "albums" ("recorded five studio albums").
      //     Tell-tale signs: a birth/death date in parentheses, or "is/was a …
      //     singer/musician/band" in the lead.
      const personBirthDeath = /\(\s*(born\s+)?\d{1,2}\s+\w+\s+\d{4}\b/i.test(lead)
                            || /\b\d{4}\s*[–—-]\s*\d{4}\b/.test(lead);
      const personDescriptor = /\b(is|was)\s+(an?\s+)?(scottish|american|english|british|irish|welsh|canadian|australian|[a-z]+)?\s*(singer|songwriter|musician|guitarist|drummer|rapper|composer|producer|vocalist|bassist|pianist|dj|band|duo)\b/i.test(lead);
      if (personBirthDeath || personDescriptor) continue;

      // (3) Confirm it reads like a release: "… is/was the … album/EP/record …"
      if (!/\b(is|was)\b[^.]{0,80}\b(album|ep|record|mixtape|soundtrack|single)\b/i.test(lead)) continue;

      // (4) If we know the artist, prefer an article that mentions them.
      if (artistFirst && artistFirst.length > 2 && !headNorm.includes(artistFirst)) continue;

      return { ...ext, source: "Wikipedia" };
    }
    return null;
  }

  // Full-text confirmation that the candidate artist article is connected to
  // the album being played: Wikipedia's search index covers whole articles
  // (including discography sections), so searching `"artist" "album"` and
  // requiring the candidate among the hits confirms THIS article's subject
  // made THAT album. An error that will not pass counts as NOT confirmed — for
  // bios, wrong is worse than missing. One that may pass (a 429, a time limit)
  // is thrown, so the lookup is not remembered as finding nothing (v2.0.3-t12).
  /** @param {string} pageTitle @param {string} artist @param {string} albumTitle */
  async function wikiArticleMentionsAlbum(pageTitle, artist, albumTitle) {
    try {
      const hits = await wikiSearch(`"${artist}" "${albumTitle}"`, 10);
      const want = normalize(pageTitle);
      return hits.some((h) => normalize(h.title) === want);
    } catch (/** @type {any} */ e) {
      if (d.debug) console.error("[wiki:artist] album cross-check:", e.message);
      if (mayPass(e)) throw e;
      return false;
    }
  }

  /** @param {string} name @param {string} [albumTitle] */
  async function fetchWikiArtist(name, albumTitle) {
    if (!name) return null;
    // Split multi-artist credits on Roon's spaced " / " separator (and commas).
    // The slash must be spaced: bare slashes are part of names (AC/DC).
    const primary = name.split(/\s+\/\s+|,/)[0].trim();
    const candidates = await wikiSearch(`${primary} band musician singer`);
    for (const c of candidates) {
      if (/\b(album|song|tour|discography)\b/i.test(c.title)) continue;
      // The article title must BE the artist (one parenthetical qualifier like
      // "(band)"/"(musician)" allowed) — near-name matches and disambiguation
      // pages are rejected outright rather than risking someone else's bio.
      if (/\(disambiguation\)/i.test(c.title)) continue;
      if (!namesEqualLoose(wikiTitleBase(c.title), primary)) continue;
      const ext = await wikiExtract(c.title);
      if (!ext) continue;
      if (/\bmay (also )?refer to\b/i.test(ext.description.slice(0, 200))) continue; // disambiguation body
      const head = ext.description.slice(0, 800);
      if (!/\b(band|musician|singer|songwriter|group|musical|guitarist|drummer|pianist|composer|rapper|vocalist|recording artist|duo|trio|quartet|ensemble|orchestra)\b/i.test(head)) continue;
      // When the caller knows which album is playing, the article must also be
      // connected to that album — the strongest identity signal available.
      if (albumTitle && !(await wikiArticleMentionsAlbum(c.title, primary, albumTitle))) continue;
      return { ...ext, name: ext.title, source: "Wikipedia" };
    }
    return null;
  }

  /**
   * The album's article and its artist's. One lookup per album at a time; a failure that may pass is not remembered,
   * and what the other half found is still answered (lib/lookup-once.js).
   * @param {string} title @param {string} artist
   */
  function fetchWikipedia(title, artist) {
    if (!title) return Promise.resolve(null);
    const key = normalize(title) + "||" + normalize(artist || "");
    return lookupOnce(wikiCache, key, async () => {
      const [album, artistInfo] = await Promise.allSettled([
        fetchWikiAlbum(title, artist),
        artist ? fetchWikiArtist(artist, title) : Promise.resolve(null)
      ]);
      const got = (/** @type {PromiseSettledResult<any>} */ r) => (r.status === "fulfilled" ? r.value : null);
      const result = got(album) || got(artistInfo) ? { album: got(album), artist: got(artistInfo) } : null;
      const passing = [album, artistInfo].find((r) => r.status === "rejected" && mayPass(r.reason));
      for (const r of [album, artistInfo]) {
        if (r.status === "rejected" && d.debug) console.error("[wiki]", r.reason && r.reason.message);
      }
      // Asked again next time; what the other half found is shown meanwhile.
      if (passing && passing.status === "rejected") throw Object.assign(passing.reason, { value: result });
      return result;
    });
  }

  return { fetchWikipedia, fetchWikiArtist };
}

module.exports = { createWikiLookup, wikiTitleBase };
