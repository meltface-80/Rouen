// @ts-check
"use strict";
/*
 * qobuz-releases.js — Qobuz's new releases, an artist's albums and the featured lists, moved out of index.js
 * unchanged in v1.9.72-t56 (dev/quality.md, step 5). index.js keeps the Qobuz session, the favourites cache, the
 * featured cache and the album normalizer, because the rest of the Qobuz code reads them too; this holds the routes
 * and the one helper only they used.
 *
 *   GET /api/qobuz/new-releases?days=              → { albums, days }      newest first, days 1-365 (default 30)
 *   GET /api/qobuz/artist-albums?artist_id=&offset= → { artist, offset, limit, total, has_more, albums, biography }
 *                                                     400 without artist_id
 *   GET /api/qobuz/featured?type=                  → { type, albums }      400 for a type not in the list
 *
 * A failure upstream answers { error } with the shared streaming-service status: 429 passed through, "not
 * connected" a 400, anything else a 502.
 */

// Qobuz featured/browse categories. Albums are returned in Qobuz's own order
// (meaningful for e.g. best-sellers), so no re-sorting here.
const QOBUZ_FEATURED_TYPES = new Set([
  "new-releases-full", "best-sellers", "most-streamed", "press-awards",
  "editor-picks", "qobuzissims", "ideal-discography", "recent-releases"
]);

/**
 * @param {{ get: Function }} app
 * @param {{ featuredCache: { get: (key: any, fetchFn: () => Promise<any>) => Promise<any> },
 *           fetchFeatured: (type: string) => Promise<any[]>,
 *           favIds: () => Promise<any>,
 *           getArtist: (artistId: string, offset: number) => Promise<any>,
 *           releaseTs: (a: any) => number | null,
 *           normalizeAlbum: (a: any, favIds: any) => any,
 *           normalizeAlbums: (items: any[], favIds: any) => any[],
 *           stripHtml: (html: string) => string,
 *           parseOffset: (req: any) => number,
 *           errorStatus: (e: any) => number }} d
 *   featuredCache: index.js's qobuzFeaturedCache itself, shared: connecting and disconnecting Qobuz clear it there
 *   fetchFeatured: one featured list, 150 albums, under the current Qobuz token (qobuzWithToken)
 *   favIds: the user's Qobuz favourite album ids (qobuzFavIds.get(), cached, best-effort)
 *   getArtist: an artist and one 50-album page of their discography, under the current Qobuz token
 *   releaseTs, normalizeAlbum, normalizeAlbums: index.js's qobuzReleaseTs, normalizeQobuzAlbum, normalizeQobuzAlbums
 *   stripHtml, parseOffset, errorStatus: index.js's stripHtml, parseOffsetParam, serviceErrorStatus
 */
function mountQobuzReleases(app, d) {
  // Raw featured items per type (10-min TTL, see makeTtlCache) — tab flapping
  // in the UI must not translate into repeated upstream calls.
  /** @param {string} type */
  function getFeaturedItemsCached(type) {
    return d.featuredCache.get(type, () => d.fetchFeatured(type));
  }

  // New releases from the last N days (default 30), newest first.
  app.get("/api/qobuz/new-releases", async (/** @type {any} */ req, /** @type {any} */ res) => {
    let days = parseInt(req.query.days, 10);
    if (!Number.isFinite(days) || days <= 0 || days > 365) days = 30;
    try {
      // Which of these are already in the user's Qobuz favourites (any device).
      // Best-effort (cached): on failure the list still renders without marks.
      const [items, favIds] = await Promise.all([
        getFeaturedItemsCached("new-releases-full"),
        d.favIds()
      ]);
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const future = Date.now() + 2 * 24 * 60 * 60 * 1000; // tolerate a couple days' skew
      const albums = [];
      for (const a of items) {
        if (!a || !a.id) continue;
        const ts = d.releaseTs(a);
        if (ts !== null && (ts < cutoff || ts > future)) continue; // outside the window
        albums.push(d.normalizeAlbum(a, favIds));
      }
      albums.sort((x, y) => (y.released_at || 0) - (x.released_at || 0));
      res.json({ albums, days });
    } catch (e) {
      res.status(d.errorStatus(e)).json({ error: /** @type {any} */ (e).message });
    }
  });

  // A Qobuz artist's discography, paged by offset. Albums stay in Qobuz's own
  // order — sorting each 50-album page independently would make dates jump
  // around at every "Load more" seam, so no per-page re-sort here.
  app.get("/api/qobuz/artist-albums", async (/** @type {any} */ req, /** @type {any} */ res) => {
    const artistId = String(req.query.artist_id || "").trim();
    if (!artistId) return res.status(400).json({ error: "artist_id required" });
    const offset = d.parseOffset(req);
    try {
      const [r, favIds] = await Promise.all([
        d.getArtist(artistId, offset),
        d.favIds()
      ]);
      const albums = d.normalizeAlbums(r.albums.items, favIds);
      const hasMore = offset + r.albums.items.length < r.albums.total; // raw length — see /api/qobuz/search
      res.json({
        artist: r.artist, offset, limit: 50, total: r.albums.total, has_more: hasMore, albums,
        // Qobuz's editorial bio was fetched all along and discarded — surface it
        // so the artist screen can show it (first page only; it never changes).
        biography: (offset === 0 && r.biography) ? d.stripHtml(String(r.biography)).trim() : ""
      });
    } catch (e) {
      res.status(d.errorStatus(e)).json({ error: /** @type {any} */ (e).message });
    }
  });

  app.get("/api/qobuz/featured", async (/** @type {any} */ req, /** @type {any} */ res) => {
    const type = String(req.query.type || "").trim();
    if (!QOBUZ_FEATURED_TYPES.has(type)) return res.status(400).json({ error: "invalid type" });
    try {
      const [items, favIds] = await Promise.all([
        getFeaturedItemsCached(type),
        d.favIds()
      ]);
      res.json({ type, albums: d.normalizeAlbums(items, favIds) });
    } catch (e) {
      res.status(d.errorStatus(e)).json({ error: /** @type {any} */ (e).message });
    }
  });
}

module.exports = { mountQobuzReleases, QOBUZ_FEATURED_TYPES };
