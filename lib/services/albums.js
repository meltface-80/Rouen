// @ts-check
"use strict";
/*
 * albums.js — what the Qobuz and TIDAL code shares: an album object in the one service-generic shape the
 * frontend reads, its best-effort release timestamp, and the HTTP status a service failure answers with. Moved out
 * of index.js unchanged in v1.9.72-t63 (dev/quality.md, step 5); index.js and lib/routes/service-favourites.js are
 * handed these. (The `offset` query parameter went in v1.9.72-t77 with the catalogue routes that paged.)
 */

// Shared HTTP status mapping for streaming-service (Qobuz/Tidal) route
// failures: 429 passes through, "not connected" is the caller's fault (400),
// everything else is upstream (502).
/**
 * @param {any} e
 * @returns {number}
 */
function serviceErrorStatus(e) {
  return e && e.code === 429 ? 429 : (/not connected/i.test(e.message) ? 400 : 502);
}

/**
 * The album shapes, made once by lib/services/index.js with the two clients whose cover urls they build.
 * @param {{ qobuz: { pickImage: (a: any) => any }, tidal: { coverUrl: (picture: string, size: string) => string } }} d
 */
function createAlbumShapes(d) {
  const { qobuz, tidal } = d;

  // Best-effort release timestamp (ms) from a Qobuz album object.
  /**
   * @param {any} a
   * @returns {number | null}
   */
  function qobuzReleaseTs(a) {
    if (a.released_at && Number.isFinite(a.released_at)) return a.released_at * 1000;
    const d = a.release_date_original || a.release_date_stream || a.release_date_download;
    if (d) {
      const t = Date.parse(d);
      if (Number.isFinite(t)) return t;
    }
    return null;
  }

  // Shared album→JSON normalizer for every album-returning Qobuz route.
  // `favIds` is a Set of the user's favourited album ids (strings).
  /**
   * @param {any} a
   * @param {{ has: (id: string) => boolean }} favIds
   */
  function normalizeQobuzAlbum(a, favIds) {
    return {
      id:           String(a.id),
      title:        a.title || "",
      version:      a.version || null,
      artist:       (a.artist && a.artist.name) || (a.performer && a.performer.name) || "",
      artist_id:    (a.artist && a.artist.id != null) ? String(a.artist.id) : null,
      image:        qobuz.pickImage(a),
      released_at:  qobuzReleaseTs(a),
      release_date: a.release_date_original || null,
      favourited:   favIds.has(String(a.id))
    };
  }

  // Normalize a raw Qobuz items array, skipping malformed entries without an id.
  /**
   * @param {any[]} items
   * @param {{ has: (id: string) => boolean }} favIds
   */
  function normalizeQobuzAlbums(items, favIds) {
    const albums = [];
    for (const a of items || []) {
      if (!a || !a.id) continue;
      albums.push(normalizeQobuzAlbum(a, favIds));
    }
    return albums;
  }

  // Best-effort release timestamp (ms) from a Tidal album object ("YYYY-MM-DD").
  /**
   * @param {any} a
   * @returns {number | null}
   */
  function tidalReleaseTs(a) {
    if (a.releaseDate) {
      const t = Date.parse(a.releaseDate);
      if (Number.isFinite(t)) return t;
    }
    return null;
  }

  // Shared album→JSON normalizer for every album-returning Tidal route — the
  // same shape normalizeQobuzAlbum emits, so the frontend stays service-generic.
  // `favIds` is a Set of the user's favourited album ids (strings).
  /**
   * @param {any} a
   * @param {{ has: (id: string) => boolean }} favIds
   */
  function normalizeTidalAlbum(a, favIds) {
    const lead = (a.artist && a.artist.name) ? a.artist : (a.artists && a.artists[0]) || null;
    return {
      id:           String(a.id),
      title:        a.title || "",
      version:      a.version || null,
      artist:       (lead && lead.name) || "",
      artist_id:    (lead && lead.id != null) ? String(lead.id) : null,
      image:        a.cover ? tidal.coverUrl(a.cover, "640x640") : null,
      released_at:  tidalReleaseTs(a),
      release_date: a.releaseDate || null,
      favourited:   favIds.has(String(a.id))
    };
  }

  // Normalize a raw Tidal items array, skipping malformed entries without an id.
  /**
   * @param {any[]} items
   * @param {{ has: (id: string) => boolean }} favIds
   */
  function normalizeTidalAlbums(items, favIds) {
    const albums = [];
    for (const a of items || []) {
      if (!a || a.id == null) continue;
      albums.push(normalizeTidalAlbum(a, favIds));
    }
    return albums;
  }

  return { qobuzReleaseTs, normalizeQobuzAlbum, normalizeQobuzAlbums, tidalReleaseTs, normalizeTidalAlbum,
    normalizeTidalAlbums };
}

module.exports = { serviceErrorStatus, createAlbumShapes };
