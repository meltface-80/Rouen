// @ts-check
"use strict";
/*
 * library-stats.js — two small reads the pages make at start, moved out of index.js unchanged in v1.9.67-t6
 * (dev/quality.md: a session that touches index.js moves code out of it):
 *
 *   GET /api/library-stats   { albums, building }   503 until paired — the album index, already in memory
 *   GET /api/music-mount     { mounted, path }       whether file metadata scanning is available
 */

/**
 * @param {{ get: Function }} app
 * @param {{ paired: () => boolean, index: () => { count: number, building: any }, mounted: () => boolean, musicDir: string }} d
 *   paired: a Core is paired; index: the album index (count; building, truthy while it is being built); mounted:
 *   the /music mount is there; musicDir: its path, as Rouen was started with
 */
function mountLibraryStats(app, d) {
  app.get("/api/library-stats", (/** @type {any} */ req, /** @type {any} */ res) => {
    if (!d.paired()) return res.status(503).json({ error: "Not paired with Roon Core yet" });
    const count = d.index().count;
    res.json({ albums: count, building: count === 0 && !!d.index().building });
  });
  app.get("/api/music-mount", (/** @type {any} */ req, /** @type {any} */ res) => {
    res.json({ mounted: d.mounted(), path: d.musicDir });
  });
}

module.exports = { mountLibraryStats };
