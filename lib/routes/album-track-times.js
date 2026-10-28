// @ts-check
"use strict";
/*
 * album-track-times.js — an album's track lengths for its page (v1.9.70-t14, dev/design/native-remote.md §16.6), from
 * your server through native mode (lib/roon-direct/track-times.js). Roon's public extension API gives none, so with
 * native mode off there are none, and the page shows its tracks as before.
 *
 *   GET /api/album/track-times?title=&artist=
 *       → { tracks: [{ disc, number, title, seconds }], status: "ok" | "pending" | "none", why? }
 *         pending: not yet (native mode connecting, the library being read): ask again soon; none: there are none to
 *         give (native mode off, the album not on the server), and why
 *
 * An album's answer is kept for a while, so opening it again asks the server nothing (a track's length doesn't change).
 */

const KEEP_MS = 30 * 60 * 1000, KEEP_MAX = 300;

/**
 * @param {{ get: Function }} app
 * @param {{ album: (title: string, artist: string) => Promise<any> }} trackTimes
 * @param {{ now?: () => number }} [o]
 */
function mountTrackTimes(app, trackTimes, o = {}) {
  const now = o.now || Date.now;
  /** @type {Map<string, { at: number, tracks: any[] }>} */
  const kept = new Map();
  app.get("/api/album/track-times", async (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    const title = String((req.query && req.query.title) || "").trim(), artist = String((req.query && req.query.artist) || "").trim();
    if (!title) return res.status(400).json({ error: "title required" });
    const key = JSON.stringify([title.toLowerCase(), artist.toLowerCase()]);
    const had = kept.get(key);
    if (had && now() - had.at < KEEP_MS) return res.json({ tracks: had.tracks, status: "ok" });
    try {
      const got = await trackTimes.album(title, artist);
      if (!got.read) return res.json({ tracks: [], status: got.wait ? "pending" : "none", why: got.why });
      kept.delete(key);
      kept.set(key, { at: now(), tracks: got.tracks });
      // the oldest goes first (a Map keeps the order things were set in)
      while (kept.size > KEEP_MAX) kept.delete(/** @type {string} */ (kept.keys().next().value));
      res.json({ tracks: got.tracks, status: "ok" });
    } catch (e) {
      res.status(500).json({ error: String(e && /** @type {any} */ (e).message), tracks: [] });
    }
  });
}

module.exports = { mountTrackTimes, KEEP_MS, KEEP_MAX };
