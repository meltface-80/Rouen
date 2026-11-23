// @ts-check
"use strict";
/*
 * label-albums.js — GET /api/label-albums?label=&order=alpha|random: a label's albums, from the label scan's index, with
 * its logo. Moved out of index.js unchanged in 2.0.6-t4 (dev/quality.md, "Splitting the monoliths").
 */

/**
 * @param {{ get: Function }} app
 * @param {{ enabled: () => boolean, index: { map: Map<string, any>, building: boolean }, groupKey: (name: string) => string,
 *           withSource: (album: any) => any, logos: Map<string, string> }} d  as index.js has them
 */
function mountLabelAlbums(app, d) {
  app.get("/api/label-albums", (/** @type {any} */ req, /** @type {any} */ res) => {
    if (!d.enabled()) return res.json({ label: null, albums: [] });
    const name  = String(req.query.label || "").trim();
    const order = req.query.order === "random" ? "random" : "alpha";
    if (!name) return res.status(400).json({ error: "label query parameter required" });
    const entry = d.index.map.get(d.groupKey(name));
    if (!entry) {
      return res.json({ albums: [], total: 0, label: name, order,
        scanning: d.index.building });
    }
    let albums = entry.albums.slice();
    if (order === "random") {
      for (let i = albums.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [albums[i], albums[j]] = [albums[j], albums[i]];
      }
    } else {
      albums.sort((/** @type {any} */ a, /** @type {any} */ b) =>
        (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" }));
    }
    const gk = d.groupKey(name);
    // Shallow-copied so the badge isn't written onto the stored label index.
    res.json({ albums: albums.map((/** @type {any} */ a) => d.withSource(Object.assign({}, a))),
               total: albums.length, label: name, order,
               groupKey: gk, logo_url: d.logos.get(gk) || null });
  });
}

module.exports = { mountLabelAlbums };
