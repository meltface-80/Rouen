// @ts-check
"use strict";
/*
 * artists.js — the Artists screen's routes (v1.9.70-t6, dev/design/artists.md §3.4).
 *
 *   GET /api/artists → { artists: [{ name, albums, cover, photo, letter }], ready }
 *       every album artist A to Z (lib/artists.js), made once for each library revision; photo: the picture the album credits keep for the name, or null;
 *       ready false (and no artists) while the library is still being read
 *   GET /api/artists/photos?n=<name>&n=… (at most 60) → { photos: { <name>: <address or null> } }
 *       the names with none are queued for a lookup (the credits' acts.want), the names on screen first
 */
const { buildArtists } = require("../artists");

const MAX_NAMES = 60;

/**
 * @param {{ get: Function }} app
 * @param {{ ready: () => boolean, stamp: () => string, albums: () => Iterable<any>, ensure: (al: any) => void, leadOf: (credit: string) => string,
 *           nameKey: (name: string) => string, photos: () => Map<string, string>,
 *           acts: { photo(name: string): string | null, want(names: Array<{ name: string, mbid: string | null }>): void } }} d
 *   stamp: the library's revision (the list is made once for each); photos: every kept picture by its name's key, read at once
 */
function mountArtists(app, d) {
  /** The list, for the library's revision it was made at (the review: every credit split again on each open). @type {{ stamp: string, list: import("../artists").Artist[] } | null} */
  let made = null;
  app.get("/api/artists", (/** @type {any} */ req, /** @type {any} */ res) => {
    if (!d.ready()) return res.json({ artists: [], ready: false });
    try {
      const photos = d.photos();
      const stamp = d.stamp();
      if (!made || made.stamp !== stamp) made = { stamp, list: buildArtists(d.albums(), { ensure: d.ensure, leadOf: d.leadOf }) };
      const artists = made.list
        .map((a) => ({ name: a.name, albums: a.albums, cover: a.cover, photo: photos.get(a.key) || null, letter: a.letter }));
      res.json({ artists, ready: true });
    } catch (e) {
      res.status(500).json({ error: String(e && /** @type {any} */ (e).message), artists: [] });
    }
  });

  app.get("/api/artists/photos", (/** @type {any} */ req, /** @type {any} */ res) => {
    const raw = req.query && req.query.n;
    const names = [...new Set((Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).map((s) => String(s).trim()).filter(Boolean))].slice(0, MAX_NAMES);
    /** @type {Record<string, string | null>} */
    const photos = {};
    const missing = [];
    for (const name of names) {
      photos[name] = d.acts.photo(name);
      if (!photos[name] && d.nameKey(name)) missing.push({ name, mbid: null });
    }
    if (missing.length) d.acts.want(missing);
    res.json({ photos });
  });
}

module.exports = { mountArtists, MAX_NAMES };
