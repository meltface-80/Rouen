// @ts-check
"use strict";
/*
 * smart-roon.js — N2e-1 (dev/design/native-remote.md §12.3, v1.9.51): Roon's smart playlists' routes.
 *
 *   GET  /api/roon-smart                       { playlists: [{ id, name, tracks, images, imagesSent, moved }] }, or { available: false, why }
 *   GET  /api/roon-smart/items?id=&page=       a page of one's tracks: { name, count, page, pages, items, complete }
 *   POST /api/roon-smart/play { id, zone_or_output_id, shuffle }   { ok, by } once the zone shows it playing
 *
 * The work is lib/roon-direct/smart.js's. Native mode off: `available: false` with no reason, and the screens
 * are today's. A play not sent is a 409 with why; one sent and not shown a 502, said as such.
 */

/**
 * @typedef {ReturnType<typeof import("../roon-direct/smart").createSmart>} Smart
 */

/** A tile's mosaic, as Rouen's own playlists' tiles draw it. */
const TILE_COVERS = 4;
/** A smart playlist's id, as the list gives it: its PlaylistId as hex. */
const ID = /^[0-9a-f]{2,64}$/;

/**
 * @param {{ get: Function, post: Function }} app
 * @param {{ smart: () => Smart | null, moved?: () => Set<string>, cover?: (serverKey: string) => string | null }} d
 *   moved: Roon's PlaylistIds of the Dynamic Playlists Rouen moved there (§12.16), each listed `moved: true`
 *   cover: a cover's key as `/api/image` serves it (the official API's), for the server's own key — the album it is the
 *   cover of, paired in the library (v1.9.62, §12.17); null when no library album has it
 */
function mountSmartRoon(app, d) {
  app.get("/api/roon-smart", async (/** @type {any} */ req, /** @type {any} */ res) => {
    const s = d.smart();
    if (!s) return res.json({ available: false, why: "" });
    try {
      const r = await s.list();
      if ("notSent" in r) return res.json({ available: false, why: r.notSent });
      const moved = d.moved ? d.moved() : new Set();
      // Covers as the server names them don't load through the official API (the owner, v1.9.61: a cover link showed
      // nothing): each is given as its library album's, and left out when no album has it; how many came is said.
      // No translator: the keys as they came (the review). A tile's four are chosen after, each once (the review).
      const cover = d.cover || ((/** @type {string} */ k) => k);
      /** @param {string[]} keys */
      const given = (keys) => [...new Set(keys.map(cover).filter((k) => typeof k === "string" && k))].slice(0, TILE_COVERS);
      res.json({ available: true, playlists: r.playlists.map((p) => Object.assign({}, p, { moved: moved.has(p.id),
        imagesSent: (p.images || []).length, images: given(p.images || []) })) });
    } catch (e) {
      res.json({ available: false, why: "Your server's smart playlists couldn't be read: " + /** @type {any} */ (e).message });
    }
  });

  app.get("/api/roon-smart/items", async (/** @type {any} */ req, /** @type {any} */ res) => {
    const id = String(req.query.id || "");
    const page = req.query.page === undefined ? 0 : Number(req.query.page);
    if (!ID.test(id)) return res.status(400).json({ error: "id required" });
    const s = d.smart();
    if (!s) return res.status(409).json({ error: "Native mode is off." });
    try {
      const r = await s.page(id, page);
      if ("notSent" in r) return res.status(409).json({ error: r.notSent || "Native mode is off." });
      res.json(r);
    } catch (e) {
      res.status(502).json({ error: "The smart playlist couldn't be read: " + /** @type {any} */ (e).message });
    }
  });

  app.post("/api/roon-smart/play", async (/** @type {any} */ req, /** @type {any} */ res) => {
    const { id, zone_or_output_id: zone, shuffle } = req.body || {};
    if (!ID.test(String(id || ""))) return res.status(400).json({ error: "id required" });
    if (!zone) return res.status(400).json({ error: "zone_or_output_id required" });
    const s = d.smart();
    if (!s) return res.status(409).json({ error: "Native mode is off." });
    try {
      const r = await s.play(String(id), String(zone), shuffle === true);
      if ("notSent" in r) return res.status(409).json({ error: r.notSent || "Native mode is off." });
      if ("notShown" in r) return res.status(502).json({ error: r.notShown, sent: true });
      res.json({ ok: true, by: r.by });
    } catch (e) {
      res.status(502).json({ error: "The play couldn't be sent: " + /** @type {any} */ (e).message });
    }
  });
}

module.exports = { mountSmartRoon };
