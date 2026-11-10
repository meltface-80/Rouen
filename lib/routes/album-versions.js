// @ts-check
"use strict";
/*
 * album-versions.js — an album's versions for its page (dev/design/album-versions.md, v2.0.3-t16), from your server
 * through native mode (lib/roon-direct/versions.js). The official API carries no versions: with native mode off there
 * are none, and the page shows no Versions.
 *
 *   GET  /api/album/versions?title=&artist=
 *        → { versions: [{ id, group, name, version, format, tracks, where, hidden, current }], status, complete?, why? }
 *          status "ok" | "pending" (not yet: native mode connecting, the library being read) | "none" (and why);
 *          versions empty when the album has only itself; complete false while the server is still loading them
 *   GET  /api/album/version-tracks?title=&artist=&id=  → { tracks: [{ disc, number, title, seconds }], status, why? }
 *   POST /api/album/version-play { title, artist, id, zone_id, shuffle }
 *        → 200 { ok: true } · 409 { notShown } (sent, the zone not seen playing it) · 503 { notSent } (nothing sent)
 *   GET  /api/debug/roon-album-versions?run=1&title=&artist=  the probe of §5, by hand; without run=1 it reads nothing
 */

/** @param {any} v */
const text = (v) => (typeof v === "string" ? v.trim() : "");
const ID = /^[los][0-9A-Za-z_-]{1,40}$/;

/**
 * @param {{ get: Function, post: Function }} app
 * @param {{ read: Function, tracks: Function, play: Function }} versions
 * @param {{ run: Function }} probe
 */
function mountAlbumVersions(app, versions, probe) {
  /** @param {any} res @param {any} e */
  const failed = (res, e) => res.status(500).json({ error: String(e && e.message) });

  app.get("/api/album/versions", async (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    const title = text(req.query.title), artist = text(req.query.artist);
    if (!title) return res.status(400).json({ error: "title required", versions: [] });
    try {
      const got = await versions.read(title, artist);
      if (!got.read) return res.json({ versions: [], status: got.wait ? "pending" : "none", why: got.why });
      res.json({ versions: got.versions, status: "ok", complete: got.complete });
    } catch (e) { failed(res, e); }
  });

  app.get("/api/album/version-tracks", async (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    const title = text(req.query.title), artist = text(req.query.artist), id = text(req.query.id);
    if (!title || !ID.test(id)) return res.status(400).json({ error: "title and id required", tracks: [] });
    try {
      const got = await versions.tracks(title, artist, id);
      if (!got.read) return res.json({ tracks: [], status: got.wait ? "pending" : "none", why: got.why });
      res.json({ tracks: got.tracks, status: "ok" });
    } catch (e) { failed(res, e); }
  });

  app.post("/api/album/version-play", async (/** @type {any} */ req, /** @type {any} */ res) => {
    const b = req.body || {};
    const title = text(b.title), artist = text(b.artist), id = text(b.id), zone = text(b.zone_id);
    if (!title || !ID.test(id) || !zone) return res.status(400).json({ error: "title, id and zone_id required" });
    try {
      const got = await versions.play(title, artist, id, zone, b.shuffle === true);
      res.status("ok" in got ? 200 : "notShown" in got ? 409 : 503).json(got);
    } catch (e) { failed(res, e); }
  });

  app.get("/api/debug/roon-album-versions", async (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    const title = text(req.query.title), artist = text(req.query.artist);
    if (req.query.run !== "1") {
      return res.json({ ran: false, readOnly: true, design: "dev/design/album-versions.md §5",
        how: "Add run=1&title=<album>&artist=<artist>: the album's versions, then each library copy's DuplicateOf, IsUserHidden and Version. Nothing is written." });
    }
    if (!title) return res.status(400).json({ error: "title required" });
    try {
      const got = await probe.run(title, artist);
      if (got && got.error) return res.status(got.status || 500).json({ ran: false, error: got.error });
      res.json(Object.assign({ ran: true, readOnly: true }, got));
    } catch (e) { failed(res, e); }
  });
}

module.exports = { mountAlbumVersions };
