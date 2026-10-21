// @ts-check
"use strict";
/*
 * service-search.js — Qobuz's and TIDAL's own catalogue search, with Rouen's sign-in: moved out of
 * index.js unchanged in v1.9.42 (dev/quality.md, step 5).
 *
 *   GET /api/qobuz/search?q=&offset=     GET /api/tidal/search?q=&offset=
 *
 * Albums and artists, paged by offset, in the service's relevance order; artist matches only on the
 * first page.
 */

/**
 * @param {{ get: Function }} app
 * @param {{ qobuzSearch: (q: string, offset: number) => Promise<any>, qobuzFavIds: () => Promise<any>,
 *           normalizeQobuzAlbums: (items: any[], favIds: any) => any[], qobuzImage: (x: any) => any,
 *           tidalAlbums: (q: string, offset: number) => Promise<any>, tidalArtists: (q: string) => Promise<any>,
 *           tidalFavIds: () => Promise<any>, normalizeTidalAlbums: (items: any[], favIds: any) => any[],
 *           tidalPicture: (picture: string) => string, parseOffset: (req: any) => number, errorStatus: (e: any) => number }} d
 */
function mountServiceSearch(app, d) {
  // Full Qobuz catalog search (albums + artists), paged by offset. Results keep
  // Qobuz's relevance order. Artist matches are only included on the first page.
  app.get("/api/qobuz/search", async (/** @type {any} */ req, /** @type {any} */ res) => {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "q required" });
    const offset = d.parseOffset(req);
    try {
      const [r, favIds] = await Promise.all([d.qobuzSearch(q, offset), d.qobuzFavIds()]);
      const albums = d.normalizeQobuzAlbums(r.albums.items, favIds);
      const artists = [];
      if (offset === 0) {
        for (const x of r.artists.items.slice(0, 8)) {
          if (!x || !x.id) continue;
          artists.push({
            id:           String(x.id),
            name:         x.name || "",
            image:        d.qobuzImage(x),
            albums_count: x.albums_count || 0
          });
        }
      }
      // has_more is computed from the RAW page length: normalization can drop
      // malformed items, so comparing filtered counts against Qobuz's total
      // would leave a dead "Load more" on the last page.
      const hasMore = offset + r.albums.items.length < r.albums.total;
      res.json({ query: q, offset, limit: 50, total: r.albums.total, has_more: hasMore, albums, artists });
    } catch (e) {
      res.status(d.errorStatus(e)).json({ error: /** @type {any} */ (e).message });
    }
  });

  // Full Tidal catalog search (albums + artists), paged by offset. Results keep
  // Tidal's relevance order. Artist matches are only included on the first page.
  app.get("/api/tidal/search", async (/** @type {any} */ req, /** @type {any} */ res) => {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "q required" });
    const offset = d.parseOffset(req);
    try {
      const [albumsPage, artistsPage, favIds] = await Promise.all([
        d.tidalAlbums(q, offset),
        offset === 0 ? d.tidalArtists(q) : Promise.resolve({ items: [], total: 0 }),
        d.tidalFavIds()
      ]);
      const albums = d.normalizeTidalAlbums(albumsPage.items, favIds);
      const artists = [];
      for (const x of artistsPage.items) {
        if (!x || x.id == null) continue;
        artists.push({
          id:           String(x.id),
          name:         x.name || "",
          image:        x.picture ? d.tidalPicture(x.picture) : null,
          albums_count: 0 // Tidal search doesn't report a per-artist album count
        });
      }
      const hasMore = offset + albumsPage.items.length < albumsPage.total; // raw length — see /api/qobuz/search
      res.json({ query: q, offset, limit: 50, total: albumsPage.total, has_more: hasMore, albums, artists });
    } catch (e) {
      res.status(d.errorStatus(e)).json({ error: /** @type {any} */ (e).message });
    }
  });
}

module.exports = { mountServiceSearch };
