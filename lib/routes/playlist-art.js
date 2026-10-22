// @ts-check
"use strict";
/*
 * playlist-art.js — Roon playlists' cover mosaics, moved out of index.js unchanged in v1.9.62 (dev/quality.md).
 *
 *   GET /api/playlist/art?title=<name>&offset=<n>   up to four distinct covers from the tracks inside, cached by title
 *
 * Roon hands us no artwork for a playlist at the LIST level (every tile came
 * back with a null image_key), so a mosaic has to be built from the artwork of
 * the tracks inside — which means opening the playlist. That is a browse walk
 * per playlist, far too expensive to do for a whole grid on every visit, so the
 * result is cached on the data volume and keyed by playlist title. Artwork for a
 * given playlist barely changes, and a wrong-but-stale mosaic is a cosmetic miss
 * on a tile whose name is still correct.
 */

const PLAYLIST_ART_MAX = 300;   // a cache, not a database

/**
 * @param {{ get: Function }} app
 * @param {{ settings: { load: () => Record<string, any>, save: (patch: Record<string, any>) => boolean },
 *           keyOf: (title: string) => string | null, core: () => any,
 *           walk: (offset: number, title: string) => Promise<{ items: any[], playMenu: any }>,
 *           isTrack: (t: any, playMenu: any) => boolean }} d
 *   walk: the playlist's items, read in a browse session (index.js's withBrowseSession + loadPlaylistSession)
 * @returns {{ cache: () => Record<string, string[]> }}
 */
function mountPlaylistArt(app, d) {
  // Installs the map into the settings object on first use rather than handing
  // back a fresh {}. Mosaics are fetched by two workers at once, and with a
  // throwaway object each of the first two writers would build its own copy and
  // the second save would drop the first's entry. Sharing one reference — the
  // same one savePersistedSettings mutates in place — makes that impossible.
  /** @returns {Record<string, string[]>} */
  function loadPlaylistArtCache() {
    const s = d.settings.load();
    if (!s.playlistArt || typeof s.playlistArt !== "object" || Array.isArray(s.playlistArt)) {
      s.playlistArt = {};
    }
    return s.playlistArt;
  }
  /** @param {string} title @param {string[]} keys */
  function savePlaylistArt(title, keys) {
    const cache = loadPlaylistArtCache();
    const key = d.keyOf(title);
    if (!key) return;
    cache[key] = keys;
    // Bounded: drop the oldest insertions once over the cap. Object key order is
    // insertion order for string keys, so this is stable.
    const names = Object.keys(cache);
    if (names.length > PLAYLIST_ART_MAX) {
      for (const n of names.slice(0, names.length - PLAYLIST_ART_MAX)) delete cache[n];
    }
    d.settings.save({ playlistArt: cache });
  }

  app.get("/api/playlist/art", async (/** @type {any} */ req, /** @type {any} */ res) => {
    const title = String(req.query.title || "");
    const key = d.keyOf(title);
    if (!key) return res.status(400).json({ error: "title required" });

    const cached = loadPlaylistArtCache()[key];
    if (Array.isArray(cached)) return res.json({ title, art_keys: cached, cached: true });

    if (!d.core()) return res.status(503).json({ error: "Not paired with Roon Core yet" });
    const offset = parseInt(req.query.offset, 10);
    if (!Number.isFinite(offset) || offset < 0) {
      return res.status(400).json({ error: "Valid offset query parameter required" });
    }
    try {
      const { items, playMenu } = await d.walk(offset, title);
      /** @type {string[]} */
      const keys = [];
      for (const t of items) {
        if (!d.isTrack(t, playMenu)) continue;
        // Distinct covers only — a playlist of one album would otherwise show the
        // same sleeve four times, which reads as a rendering bug.
        if (t.image_key && !keys.includes(t.image_key)) keys.push(t.image_key);
        if (keys.length === 4) break;
      }
      // Cached even when empty, so a playlist with no artwork isn't re-walked on
      // every visit to the grid.
      savePlaylistArt(title, keys);
      res.json({ title, art_keys: keys, cached: false });
    } catch (e) {
      const err = /** @type {any} */ (e);
      if (err.stale) return res.status(409).json({ error: err.message, stale: true });
      res.status(500).json({ error: err.message });
    }
  });

  return { cache: loadPlaylistArtCache };
}

module.exports = { mountPlaylistArt };
