// @ts-check
"use strict";
/*
 * user-playlists.js — Rouen's own playlists' plain routes, moved out of index.js unchanged in v1.9.63 (dev/quality.md).
 * Every one costs ZERO Roon calls: a user playlist stores its tracks rather than deriving them.
 *
 *   GET  /api/user-playlists          the summaries
 *   GET  /api/user-playlist?id=       one, with its tracks
 *   POST /api/user-playlists          create, or rename an existing one   body: { id?, name }
 *   POST /api/user-playlists/delete   body: { id }
 *
 * The adds (tracks, whole albums) stay in index.js, beside the helpers they share.
 */

/**
 * @param {{ get: Function, post: Function }} app
 * @param {{ list: () => any[], save: () => void, summary: (p: any) => any, text: (v: any, max: number) => string | null,
 *           nameMax: () => number, max: () => number, newId: () => string }} d
 *   list: Rouen's own playlists now (index.js's userPlaylists, replaced whole by a restore); save: written to disk
 */
function mountUserPlaylists(app, d) {
  app.get("/api/user-playlists", (/** @type {any} */ req, /** @type {any} */ res) => {
    res.json({ playlists: d.list().map(d.summary) });
  });

  app.get("/api/user-playlist", (/** @type {any} */ req, /** @type {any} */ res) => {
    const id = String(req.query.id || "").trim();
    const p = d.list().find((x) => x.id === id);
    if (!p) return res.status(404).json({ error: "No such playlist" });
    res.json({ id: p.id, name: p.name, tracks: p.tracks, track_total: p.tracks.length });
  });

  // Create, or rename an existing one. body: { id?, name }
  app.post("/api/user-playlists", (/** @type {any} */ req, /** @type {any} */ res) => {
    const body = req.body || {};
    const name = d.text(body.name, d.nameMax());
    if (!name) return res.status(400).json({ error: "name required" });
    const id = d.text(body.id, 64);
    const list = d.list();
    if (id) {
      const p = list.find((x) => x.id === id);
      if (!p) return res.status(404).json({ error: "No such playlist" });
      p.name = name;
      p.updated_at = Date.now();
    } else {
      if (list.length >= d.max()) {
        return res.status(400).json({ error: `That's ${d.max()} playlists — delete one first` });
      }
      list.push({ id: d.newId(), name, tracks: [],
        created_at: Date.now(), updated_at: Date.now() });
    }
    d.save();
    res.json({ ok: true, playlists: list.map(d.summary) });
  });

  app.post("/api/user-playlists/delete", (/** @type {any} */ req, /** @type {any} */ res) => {
    const id = d.text((req.body || {}).id, 64);
    const list = d.list();
    const at = list.findIndex((x) => x.id === id);
    if (at === -1) return res.status(404).json({ error: "No such playlist" });
    list.splice(at, 1);
    d.save();
    res.json({ ok: true, playlists: list.map(d.summary) });
  });
}

module.exports = { mountUserPlaylists };
