// @ts-check
"use strict";
/*
 * service-favourites.js — an album put in, or taken out of, your Qobuz or TIDAL favourites with
 * Rouen's own sign-in (idempotent). Moved out of index.js unchanged in v1.9.41 (dev/quality.md,
 * step 5): Smart Picks' and Listen Later's "+ Add" before native mode, and its fallback since
 * (lib/library-add.js, dev/design/native-remote.md §9.2).
 *
 *   POST /api/qobuz/favorite {album_id}     POST /api/qobuz/unfavorite {album_id}
 *   POST /api/tidal/favorite {album_id}     POST /api/tidal/unfavorite {album_id}
 */

/**
 * @param {{ qobuz: (albumId: string, on: boolean) => Promise<void>, tidal: (albumId: string, on: boolean) => Promise<void> }} deps
 *   each the service's own call, keeping its favourites cache coherent
 */
function createServiceFavourites(deps) {
  return {
    /** @param {"qobuz" | "tidal"} service @param {string} albumId @param {boolean} on */
    set: (service, albumId, on) => deps[service](albumId, on),
  };
}

/**
 * @param {{ post: Function }} app
 * @param {ReturnType<typeof createServiceFavourites>} sf
 * @param {(e: any) => number} errorStatus  the shared streaming-service status mapping (index.js serviceErrorStatus)
 */
function mountServiceFavourites(app, sf, errorStatus) {
  for (const service of /** @type {const} */ (["qobuz", "tidal"])) {
    for (const [path, on] of /** @type {const} */ ([["favorite", true], ["unfavorite", false]])) {
      app.post(`/api/${service}/${path}`, async (/** @type {any} */ req, /** @type {any} */ res) => {
        const albumId = ((req.body && req.body.album_id) || "").toString().trim();
        if (!albumId) return res.status(400).json({ ok: false, error: "album_id required" });
        try {
          await sf.set(service, albumId, on);
          res.json({ ok: true });
        } catch (e) {
          res.status(errorStatus(e)).json({ ok: false, error: /** @type {any} */ (e).message });
        }
      });
    }
  }
}

module.exports = { createServiceFavourites, mountServiceFavourites };
