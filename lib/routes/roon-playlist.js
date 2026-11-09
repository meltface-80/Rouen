// @ts-check
"use strict";
/*
 * roon-playlist.js — one of your Roon playlists through the official API's browse: its tracks, and playing it or one of
 * its tracks. Moved out of index.js in v2.0.3-t4, unchanged (dev/quality.md, "Splitting the monoliths"); the browse
 * session, the playlist's walk and its play actions stay in index.js, which the playlist list and its covers share.
 *
 *   GET  /api/playlist?offset=&title=&zone=   → { title, subtitle, image_key, tracks, total, truncated, can_play }
 *   POST /api/playlist/play                   { offset, title, zone_or_output_id, kind }
 *   POST /api/playlist/play-track             { offset, title, track_index, track_title, zone_or_output_id, kind }
 */

/**
 * @param {{ get: Function, post: Function }} app
 * @param {{ core: () => any, withBrowseSession: (fn: (sk: any) => Promise<any>) => Promise<any>,
 *           loadPlaylistSession: (sk: any, offset: number, title: string, zone: string | null) => Promise<any>,
 *           isTrackItem: (t: any, playMenu: any) => boolean, stripTrackNumber: (s: string) => string,
 *           trackNumberOf: (s: string) => number | null, PLAYLIST_ITEMS: number,
 *           invokePlaylistAction: (offset: number, title: string, zone: string, kind: string) => Promise<any>,
 *           invokePlaylistTrackAction: (offset: number, title: string, idx: number, trackTitle: string, zone: string, kind: string) => Promise<any> }} d
 *   as index.js has them
 */
function mountRoonPlaylist(app, d) {
  // One playlist's tracks.  ?offset=<n>&title=<name>
  // `title` is what makes the read safe — see loadPlaylistSession.
  app.get("/api/playlist", async (/** @type {any} */ req, /** @type {any} */ res) => {
    if (!d.core()) return res.status(503).json({ error: "Not paired with Roon Core yet" });
    const offset = parseInt(req.query.offset, 10);
    const title  = String(req.query.title || "");
    // Optional, but the client always sends it (see loadPlaylistSession).
    const zone   = String(req.query.zone || "") || null;
    if (!Number.isFinite(offset) || offset < 0) {
      return res.status(400).json({ error: "Valid offset query parameter required" });
    }
    try {
      const { items, playMenu, item, total } =
        await d.withBrowseSession((/** @type {any} */ sk) => d.loadPlaylistSession(sk, offset, title, zone));
      const tracks = items.filter((/** @type {any} */ t) => d.isTrackItem(t, playMenu)).map((/** @type {any} */ t, /** @type {number} */ i) => ({
        index:    i,
        title:    d.stripTrackNumber(t.title),
        subtitle: t.subtitle || "",
        image_key: t.image_key || null,
        // Usually null here — a playlist is not an album, so Roon rarely numbers
        // its rows. Carried anyway because export reads this shape.
        track_no: d.trackNumberOf(t.title)
      }));
      res.json({
        title: item.title || "", subtitle: item.subtitle || "",
        image_key: item.image_key || null,
        tracks,
        // Roon reports the real length; we only read PLAYLIST_ITEMS of it, so say
        // so rather than letting a long playlist look truncated for no reason.
        total,
        // Only truncated if we actually hit the read ceiling. `total` is the
        // browse LEVEL's row count, which includes the play-menu row that
        // isTrackItem excludes — comparing the two made every playlist with a
        // Play action report "showing the first N of N+1".
        truncated: tracks.length >= d.PLAYLIST_ITEMS,
        can_play: !!playMenu
      });
    } catch (/** @type {any} */ e) {
      if (e.stale) return res.status(409).json({ error: e.message, stale: true });
      console.warn("[playlist] load failed:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Play or queue a whole playlist.
  // body: { offset, title, zone_or_output_id, kind }
  app.post("/api/playlist/play", async (/** @type {any} */ req, /** @type {any} */ res) => {
    if (!d.core()) return res.status(503).json({ error: "Not paired with Roon Core yet" });
    const { title, zone_or_output_id, kind } = req.body || {};
    const offset = parseInt(req.body && req.body.offset, 10);
    if (!Number.isFinite(offset) || offset < 0) return res.status(400).json({ error: "offset required" });
    if (!zone_or_output_id) return res.status(400).json({ error: "zone_or_output_id required" });
    if (!kind)              return res.status(400).json({ error: "kind required" });
    try {
      res.json(await d.invokePlaylistAction(offset, title, zone_or_output_id, kind));
    } catch (/** @type {any} */ e) {
      if (e.stale) return res.status(409).json({ error: e.message, stale: true });
      console.warn("[playlist] play failed:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Play or queue one track of a playlist.
  // body: { offset, title, track_index, track_title, zone_or_output_id, kind }
  app.post("/api/playlist/play-track", async (/** @type {any} */ req, /** @type {any} */ res) => {
    if (!d.core()) return res.status(503).json({ error: "Not paired with Roon Core yet" });
    const { title, track_title, zone_or_output_id, kind } = req.body || {};
    const offset = parseInt(req.body && req.body.offset, 10);
    const idx    = parseInt(req.body && req.body.track_index, 10);
    if (!Number.isFinite(offset) || offset < 0) return res.status(400).json({ error: "offset required" });
    if (!Number.isFinite(idx) || idx < 0)       return res.status(400).json({ error: "track_index required" });
    if (!zone_or_output_id) return res.status(400).json({ error: "zone_or_output_id required" });
    if (!kind)              return res.status(400).json({ error: "kind required" });
    try {
      res.json(await d.invokePlaylistTrackAction(offset, title, idx, track_title, zone_or_output_id, kind));
    } catch (/** @type {any} */ e) {
      if (e.stale) return res.status(409).json({ error: e.message, stale: true });
      console.warn("[playlist] play-track failed:", e.message);
      res.status(500).json({ error: e.message });
    }
  });
}

module.exports = { mountRoonPlaylist };
