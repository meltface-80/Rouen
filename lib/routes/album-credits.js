// @ts-check
"use strict";
/*
 * album-credits.js — an album's credits for its page, and what each source said of it (v1.9.70-t1,
 * dev/design/album-credits.md §6).
 *
 *   GET /api/album/credits?title=&artist=&tracks=N
 *       → { credits: [{ name, roles, tracks, photo, source }], status: "ok" | "pending" }
 *         tracks empty: on every track; photo: the picture's address, or null; pending: still being read, ask again
 *   GET /api/artist/members?name=   (§7) → { members: [{ name, roles, photo }], status } — a band's members now, and
 *       only them; none for a person or an act MusicBrainz lists no members for
 *   GET /api/debug/album-credits?title=&artist=&tracks=N
 *       → each source's state and why, the last read's account (your server's calls, the release), the rows with
 *         their pictures, and how many names wait for one
 */

const WAIT_MS = 8000;

/**
 * @param {{ get: Function }} app
 * @param {{ finder: ReturnType<typeof import("../credits/finder").createCreditFinder>,
 *           acts: ReturnType<typeof import("../credits/acts").createActs>, waitMs?: number }} d
 */
function mountAlbumCredits(app, d) {
  /** @param {any} q */
  const asked = (q) => ({
    title: String((q && q.title) || "").trim(), artist: String((q && q.artist) || "").trim(),
    tracks: Math.max(0, Math.min(999, parseInt(String((q && q.tracks) || "0"), 10) || 0)),
  });
  /** @param {import("../credits/rules").AlbumCredit[]} rows */
  const shown = (rows) => rows.map((r) => ({ name: r.name, roles: r.roles, tracks: r.tracks, photo: d.acts.photo(r.name), source: r.source }));

  app.get("/api/album/credits", async (/** @type {any} */ req, /** @type {any} */ res) => {
    const a = asked(req.query);
    if (!a.title) return res.status(400).json({ error: "title required" });
    try {
      const got = await d.finder.album(a, d.waitMs === undefined ? WAIT_MS : d.waitMs);
      res.json({ credits: got.kept ? shown(got.kept.rows) : [], status: got.status });
    } catch (e) {
      res.status(500).json({ error: String(e && /** @type {any} */ (e).message), credits: [] });
    }
  });

  app.get("/api/artist/members", async (/** @type {any} */ req, /** @type {any} */ res) => {
    const name = String((req.query && req.query.name) || "").trim();
    if (!name) return res.status(400).json({ error: "name required" });
    try {
      const got = await d.acts.band(name, d.waitMs === undefined ? WAIT_MS : d.waitMs);
      res.json({ members: got.members.map((m) => ({ name: m.name, roles: m.roles, photo: d.acts.photo(m.name) })), status: got.status });
    } catch (e) {
      res.status(500).json({ error: String(e && /** @type {any} */ (e).message), members: [] });
    }
  });

  app.get("/api/debug/album-credits", async (/** @type {any} */ req, /** @type {any} */ res) => {
    const a = asked(req.query);
    if (!a.title) return res.status(400).json({ error: "title required (and artist, and tracks for a search by name)" });
    try {
      const got = await d.finder.album(a, d.waitMs === undefined ? WAIT_MS * 2 : d.waitMs);
      res.json({
        status: got.status, design: "dev/design/album-credits.md",
        sources: got.kept ? got.kept.sources : null, keptAt: got.kept ? new Date(got.kept.at).toISOString() : null,
        lastRead: d.finder.lastRead(a.title, a.artist), credits: got.kept ? shown(got.kept.rows) : [], picturesWaiting: d.acts.waiting(),
      });
    } catch (e) {
      res.status(500).json({ error: String(e && /** @type {any} */ (e).message) });
    }
  });
}

module.exports = { mountAlbumCredits, WAIT_MS };
