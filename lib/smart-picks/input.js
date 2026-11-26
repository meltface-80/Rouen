// @ts-check
"use strict";
/*
 * input.js — what Smart Picks' seeds are made from (dev/design/smart-picks.md §3, 2.0.6-t22), gathered from what
 * index.js holds: the library's albums with their keys, credits, Roon's top-level genres and years; every album played
 * (lib/listening/store.js); the tracks played on their own, each credited to the library artists its own credit names;
 * and the albums Smart Picks has suggested, matched to the library as Listen later matches them, so a pick tried
 * says nothing until it is played whole. seeds.js does the scoring, with Tune's (tune.js, 2.0.7-t1) window and factors;
 * listened() is what the Tune sheet lists: the genres and decades of the listening, as it is without Tune.
 */

const { scoreArtists, chooseSeeds } = require("./seeds");
const { halfLifeOf, seedTune, defaultTune } = require("./tune");

/**
 * @typedef {{ title?: string, subtitle?: string }} LibraryAlbum
 * @param {{
 *   albums: () => LibraryAlbum[], keyOf: (al: LibraryAlbum) => string | null,
 *   splitCredit: (credit: string) => string[], canonArtist: (name: string) => string,
 *   genresOf: (al: LibraryAlbum) => string[], yearOf: (al: LibraryAlbum) => number | null,
 *   listening: { albumPlayRows: () => Array<{ key: string, ts: number }>, trackPlaysAlone: () => Array<{ key: string | null, artist: string, ts: number }> },
 *   suggested: () => Array<{ album: string, artist: string }>,
 *   libraryRecord: (title: string, artist: string) => LibraryAlbum | null,
 *   cap: () => number, now?: () => number,
 * }} deps
 *   suggested: every album Smart Picks has suggested (smart_picks), as it named them; throws when it can't be read;
 *   libraryRecord: the library album a title and artist name, tolerantly (index.js smartLibraryRecord)
 */
function createSeedInput(deps) {
  const now = deps.now || Date.now;
  /** A credit's artists, by their canonical names. @param {string} credit */
  const artistsOf = (credit) => deps.splitCredit(credit || "").map((name) => ({ canon: deps.canonArtist(name), name })).filter((a) => a.canon);

  /** The suggested albums' keys: the library's own where the album is there (under Roon's spelling), else as named. */
  function suggestedKeys() {
    const out = new Set();
    for (const r of deps.suggested()) {
      const rec = deps.libraryRecord(r.album, r.artist);
      const k = deps.keyOf(rec || { title: r.album, subtitle: r.artist });
      if (k) out.add(k);
    }
    return out;
  }

  /** Every artist, scored. @param {Set<string>} hubs @param {number} [halfLifeDays] */
  function scored(hubs, halfLifeDays) {
    const albums = [];
    for (const al of deps.albums()) {
      const key = deps.keyOf(al);
      if (key) albums.push({ key, title: al.title || "", credits: artistsOf(al.subtitle || ""), genres: deps.genresOf(al), year: deps.yearOf(al) });
    }
    const trackPlays = deps.listening.trackPlaysAlone().map((t) => ({ key: t.key, ts: t.ts, artists: artistsOf(t.artist) }));
    return scoreArtists({ albums, albumPlays: deps.listening.albumPlayRows(), trackPlays, hubs, now: now(), pickKeys: suggestedKeys(), halfLifeDays });
  }

  /**
   * The seeds, and what Why these picks needs of them. @param {Set<string>} hubs
   * @param {import("./tune").Tune} [tune]  Tune (§5); "As I listen" when not given
   */
  function seedsFor(hubs, tune) {
    const t = tune || defaultTune();
    return chooseSeeds(scored(hubs, halfLifeOf(t)), deps.cap(), seedTune(t));
  }

  /**
   * The listening's genres (the ten largest) and decades (every one played), each with its share, as it is without
   * Tune: what the Tune sheet offers. @param {Set<string>} hubs
   */
  function listened(hubs) {
    /** @type {Map<string, number>} */
    const genres = new Map();
    /** @type {Map<string, number>} */
    const decades = new Map();
    for (const r of scored(hubs).values()) {
      for (const [g, v] of r.share) genres.set(g, (genres.get(g) || 0) + v);
      for (const [d, v] of r.decades) decades.set(d, (decades.get(d) || 0) + v);
    }
    const list = (/** @type {Map<string, number>} */ m) => {
      const sum = [...m.values()].reduce((x, y) => x + y, 0);
      return [...m].filter(([, v]) => v > 0).map(([name, v]) => ({ name, share: Math.round(v / sum * 1000) / 1000 }));
    };
    return {
      genres: list(genres).sort((a, b) => b.share - a.share || (a.name < b.name ? -1 : 1)).slice(0, 10),
      decades: list(decades).sort((a, b) => (a.name === "unknown" ? 1 : b.name === "unknown" ? -1 : a.name < b.name ? -1 : 1)),
    };
  }

  return { seedsFor, listened, suggestedKeys };
}

module.exports = { createSeedInput };
