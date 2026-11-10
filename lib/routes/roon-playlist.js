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
 *   POST /api/playlist/play-ordered           { offset, title, zone_or_output_id, kind, tracks: [{ index, title }] }  (v2.0.3-t11)
 *       → { ok, job } at once: the tracks named are sent one at a time, in that order (lib/ordered-play.js; why, and
 *       what it costs: dev/design/playlist-artists.md §7). kind is "play_now" or "queue"
 *   GET  /api/playlist/play-ordered/status?zone=   → { job }: how far the zone's run has got, or null
 *   POST /api/playlist/play-ordered/stop      { zone_or_output_id, id } → { job }, once the run has ended; with the
 *       run's id, a run the zone was given since is left going
 *       A "play_now" through /api/playlist/play or /api/playlist/play-track ends the zone's run first.
 *   POST /api/playlist/track-artists          { title, tracks: [row titles] } → { status, artists: [per row] }  (v2.0.3-t4)
 *       each row's own artist, from your server over native mode (lib/roon-direct/playlist-artists.js), or null where
 *       none is known; status "ok", else "off" / "none" / "failed" with why — the rows keep the line they have
 *   GET  /api/debug/roon-playlist-artists?run=1&offset=&title=   (v2.0.3-t4, the probe)
 *       the official API's line under each title beside the artist your server names for it, the first 40 rows
 */
const { alignArtists, alignTracks } = require("../roon-direct/playlist-artists");
const { createOrderedPlay } = require("../ordered-play");
const PROBE_ROWS = 40;
/** A run keeps its playlist's name, and each track's until it is sent: no longer than a name is. */
const TITLE_MAX = 500;

/**
 * @param {{ get: Function, post: Function }} app
 * @param {{ core: () => any, withBrowseSession: (fn: (sk: any) => Promise<any>) => Promise<any>,
 *           loadPlaylistSession: (sk: any, offset: number, title: string, zone: string | null) => Promise<any>,
 *           isTrackItem: (t: any, playMenu: any) => boolean, stripTrackNumber: (s: string) => string,
 *           trackNumberOf: (s: string) => number | null, PLAYLIST_ITEMS: number,
 *           invokePlaylistAction: (offset: number, title: string, zone: string, kind: string) => Promise<any>,
 *           invokePlaylistTrackAction: (offset: number, title: string, idx: number, trackTitle: string, zone: string, kind: string) => Promise<any>,
 *           playlistArtists?: { read(name: string): Promise<any> },
 *           orderedPlay?: ReturnType<typeof createOrderedPlay> }} d
 *   as index.js has them; playlistArtists: native mode's read (lib/roon-direct/playlist-artists.js); orderedPlay: the
 *   runs of tracks sent in the order shown, one of its own when none is given
 */
function mountRoonPlaylist(app, d) {
  const ordered = d.orderedPlay || createOrderedPlay();
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
      const act = () => d.invokePlaylistAction(offset, title, zone_or_output_id, kind);
      res.json(await (kind === "play_now" ? ordered.takeOver(String(zone_or_output_id), "other", act) : act()));
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
      const act = () => d.invokePlaylistTrackAction(offset, title, idx, track_title, zone_or_output_id, kind);
      res.json(await (kind === "play_now" ? ordered.takeOver(String(zone_or_output_id), "other", act) : act()));
    } catch (/** @type {any} */ e) {
      if (e.stale) return res.status(409).json({ error: e.message, stale: true });
      console.warn("[playlist] play-track failed:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // A playlist's tracks in the order the page shows them (v2.0.3-t11, dev/design/playlist-artists.md §7). Roon has no
  // such action, so they are sent one at a time; that takes minutes for a long playlist, so this answers at once and
  // the page asks how far the run has got.
  // body: { offset, title, zone_or_output_id, kind, tracks: [{ index, title }] }
  app.post("/api/playlist/play-ordered", (/** @type {any} */ req, /** @type {any} */ res) => {
    if (!d.core()) return res.status(503).json({ error: "Not paired with Roon Core yet" });
    const b = req.body || {};
    const offset = parseInt(b.offset, 10);
    const title = String(b.title || "").slice(0, TITLE_MAX);
    const zone = b.zone_or_output_id ? String(b.zone_or_output_id) : "";
    const kind = b.kind;
    if (!Number.isFinite(offset) || offset < 0) return res.status(400).json({ error: "offset required" });
    // The name is what says the offset still points at this playlist, for every track of a run minutes long.
    if (!title) return res.status(400).json({ error: "title required" });
    if (!zone) return res.status(400).json({ error: "zone_or_output_id required" });
    if (kind !== "play_now" && kind !== "queue") return res.status(400).json({ error: "kind must be play_now or queue" });
    if (!Array.isArray(b.tracks) || !b.tracks.length || b.tracks.length > d.PLAYLIST_ITEMS) {
      return res.status(400).json({ error: `tracks required (1 to ${d.PLAYLIST_ITEMS})` });
    }
    const tracks = b.tracks.map((/** @type {any} */ t) => ({ index: parseInt(t && t.index, 10), title: String((t && t.title) || "").slice(0, TITLE_MAX) }));
    if (tracks.some((/** @type {{ index: number }} */ t) => !Number.isFinite(t.index) || t.index < 0)) {
      return res.status(400).json({ error: "each track needs its index" });
    }
    const job = ordered.start(zone, tracks, kind,
      (t, k) => d.invokePlaylistTrackAction(offset, title, t.index, t.title, zone, k), { offset, title });
    res.json({ ok: true, job });
  });

  // Asked every 1.5 s while a page watches a run, so it has a path of its own for the request trace to leave out
  // (lib/http-trace.js) without leaving out the start.
  app.get("/api/playlist/play-ordered/status", (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    res.json({ job: ordered.status(String(req.query.zone || "")) });
  });

  app.post("/api/playlist/play-ordered/stop", async (/** @type {any} */ req, /** @type {any} */ res) => {
    const zone = req.body && req.body.zone_or_output_id;
    const id = req.body && req.body.id ? String(req.body.id) : "";
    if (!zone) return res.status(400).json({ error: "zone_or_output_id required" });
    try {
      // With the run's id, a run the zone was given since is left going, and is what the answer carries.
      res.json({ job: await ordered.stop(String(zone), "user", id) });
    } catch (/** @type {any} */ e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Each row's own artist (v2.0.3-t4, dev/design/playlist-artists.md): asked once the page has drawn the rows.
  app.post("/api/playlist/track-artists", async (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    const b = req.body || {};
    const title = typeof b.title === "string" ? b.title : "";
    const rows = Array.isArray(b.tracks) ? b.tracks.slice(0, d.PLAYLIST_ITEMS).map((/** @type {any} */ x) => String(x == null ? "" : x)) : null;
    if (!title || !rows) return res.status(400).json({ error: "title and tracks required" });
    if (!d.playlistArtists) return res.json({ status: "off", why: "Native mode is off." });
    try {
      const got = await d.playlistArtists.read(title);
      if (got.status !== "ok") return res.json({ status: got.status, why: got.why });
      res.json(Object.assign({ status: "ok", artists: alignArtists(rows, got.tracks, got.whole !== false) }, got.capped ? { capped: true } : {}));
    } catch (/** @type {any} */ e) {
      res.json({ status: "failed", why: String((e && e.message) || e) });
    }
  });

  // The probe (v2.0.3-t4): what the official API puts under each title, beside the artist your server names. Read only.
  app.get("/api/debug/roon-playlist-artists", async (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    if (req.query.run !== "1") {
      return res.json({ readOnly: true, ran: false, design: "dev/design/playlist-artists.md §3",
        how: "Add ?run=1&title=<a playlist's name>&offset=<its place in the list, 0 for the first> to read that playlist through Roon's official API and, over native mode, from your server, and see the line under each track beside the artist your server names for it. Nothing is changed." });
    }
    const title = String(req.query.title || "");
    const offset = parseInt(req.query.offset, 10);
    if (!title || !Number.isFinite(offset) || offset < 0) return res.status(400).json({ error: "title and offset required" });
    if (!d.core()) return res.status(503).json({ error: "Not paired with Roon Core yet" });
    const t0 = Date.now();
    try {
      const { items, playMenu } = await d.withBrowseSession((/** @type {any} */ sk) => d.loadPlaylistSession(sk, offset, title, null));
      const rows = items.filter((/** @type {any} */ t) => d.isTrackItem(t, playMenu));
      const official = Date.now() - t0;
      const got = d.playlistArtists ? await d.playlistArtists.read(title) : { status: "off", why: "Native mode is off." };
      const titles = rows.map((/** @type {any} */ t) => d.stripTrackNumber(t.title));
      // Each row's own track (the one its artist comes from), so a row's album is its track's, never its neighbour's.
      const at = got.status === "ok" ? alignTracks(titles, got.tracks, got.whole !== false) : titles.map(() => -1);
      const trackAt = (/** @type {number} */ i) => (at[i] >= 0 ? got.tracks[at[i]] : null);
      const artists = titles.map((_, i) => { const t = trackAt(i); return t ? t.artist : null; });
      const sample = rows.slice(0, PROBE_ROWS).map((/** @type {any} */ t, /** @type {number} */ i) => ({ title: titles[i], line: t.subtitle || "",
        artist: artists[i], album: trackAt(i) ? /** @type {any} */ (trackAt(i)).album : null }));
      const named = artists.filter(Boolean).length;
      const same = artists.filter((a, i) => a && a === (rows[i].subtitle || "")).length;
      res.json({ readOnly: true, ran: true, title, rows: rows.length, native: { status: got.status, why: got.why || null,
        count: got.count ?? null, capped: !!got.capped, whole: got.whole ?? null }, named, lineIsArtist: same, lineDiffers: named - same,
        ms: { official, total: Date.now() - t0 }, sample });
    } catch (/** @type {any} */ e) {
      res.json({ readOnly: true, ran: true, error: String(e && e.message) });
    }
  });
}

module.exports = { mountRoonPlaylist };
