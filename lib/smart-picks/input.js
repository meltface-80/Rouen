// @ts-check
"use strict";
/*
 * input.js — what Smart Picks' seeds are made from (dev/design/smart-picks.md §3, 2.0.6-t22), gathered from what
 * index.js holds: the library's albums with their keys, credits, Roon's top-level genres and years; every album played
 * (lib/listening/store.js); the tracks played on their own, each credited to the library artists its own credit names;
 * and the albums Smart Picks has suggested, matched to the library as Listen later matches them, so a pick tried
 * says nothing until it is played whole. seeds.js does the scoring.
 */

const { scoreArtists, chooseSeeds } = require("./seeds");

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

  /** The seeds, and what Why these picks needs of them. @param {Set<string>} hubs */
  function seedsFor(hubs) {
    const albums = [];
    for (const al of deps.albums()) {
      const key = deps.keyOf(al);
      if (key) albums.push({ key, title: al.title || "", credits: artistsOf(al.subtitle || ""), genres: deps.genresOf(al), year: deps.yearOf(al) });
    }
    const trackPlays = deps.listening.trackPlaysAlone().map((t) => ({ key: t.key, ts: t.ts, artists: artistsOf(t.artist) }));
    const scored = scoreArtists({ albums, albumPlays: deps.listening.albumPlayRows(), trackPlays, hubs, now: now(), pickKeys: suggestedKeys() });
    return chooseSeeds(scored, deps.cap());
  }

  return { seedsFor, suggestedKeys };
}

module.exports = { createSeedInput };
