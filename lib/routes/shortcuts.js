// @ts-check
"use strict";
/*
 * lib/routes/shortcuts.js — Apple Shortcuts: simple GET endpoints for voice and automation triggers, moved out of
 * index.js unchanged in v1.9.72-t67 (dev/quality.md, step 5).
 *
 *   GET /api/shortcut/zones                          → { zones: [{ id, name, state }] }
 *   GET /api/shortcut/play-random?zone=ZONENAME      → a random album played now on the zone (by name or id)
 *   GET /api/shortcut/play-unheard?zone=ZONENAME     → an unheard album played now on the zone
 *
 * index.js keeps the picks (pickRandomAlbums, pickUnheardAlbum) and the album opening (openAlbumByOffset), and reads of
 * its `core` and `zones`, which it reassigns, are passed as getters.
 */

/**
 * @typedef {object} ShortcutDeps
 * @property {() => any} core  the paired Core, or null
 * @property {() => Record<string, any>} zones  Roon's zones, by id
 * @property {(n: number) => Promise<{ albums: any[] }>} pickRandomAlbums
 * @property {() => Promise<any>} pickUnheardAlbum
 * @property {(offset: number, zoneId: string, kind: string, filter: any, expect: any) => Promise<any>} openAlbumByOffset
 */

/** @param {{ get: Function }} app @param {ShortcutDeps} d */
function mountShortcuts(app, d) {
  // List zones: GET /api/shortcut/zones
  app.get("/api/shortcut/zones", (/** @type {any} */ req, /** @type {any} */ res) => {
    const list = Object.values(d.zones()).map(z => ({
      id:    z.zone_id,
      name:  z.display_name,
      state: z.state
    }));
    res.json({ zones: list });
  });

  // Play random album: GET /api/shortcut/play-random?zone=ZONENAME
  app.get("/api/shortcut/play-random", async (/** @type {any} */ req, /** @type {any} */ res) => {
    if (!d.core()) return res.status(503).json({ error: "Roon not connected" });
    const zoneName = req.query.zone || "";
    const zone = Object.values(d.zones()).find(z => z.display_name === zoneName || z.zone_id === zoneName);
    if (!zone) {
      return res.status(404).json({
        error: "Zone not found",
        available: Object.values(d.zones()).map(z => z.display_name)
      });
    }
    try {
      const picks = (await d.pickRandomAlbums(1)).albums;
      if (!picks.length) return res.status(503).json({ error: "No albums available" });
      await d.openAlbumByOffset(picks[0].offset, zone.zone_id, "play_now", null,
                                { title: picks[0].title || "", subtitle: picks[0].subtitle || "" });
      res.json({ ok: true, album: picks[0].title, artist: picks[0].subtitle, zone: zone.display_name });
    } catch (e) {
      res.status(500).json({ error: /** @type {Error} */ (e).message });
    }
  });

  // Play unheard album: GET /api/shortcut/play-unheard?zone=ZONENAME
  app.get("/api/shortcut/play-unheard", async (/** @type {any} */ req, /** @type {any} */ res) => {
    if (!d.core()) return res.status(503).json({ error: "Roon not connected" });
    const zoneName = req.query.zone || "";
    const zone = Object.values(d.zones()).find(z => z.display_name === zoneName || z.zone_id === zoneName);
    if (!zone) {
      return res.status(404).json({
        error: "Zone not found",
        available: Object.values(d.zones()).map(z => z.display_name)
      });
    }
    try {
      const pick = await d.pickUnheardAlbum();
      if (!pick) return res.status(503).json({ error: "No albums available" });
      await d.openAlbumByOffset(pick.offset, zone.zone_id, "play_now", null,
                                { title: pick.title || "", subtitle: pick.subtitle || "" });
      res.json({ ok: true, album: pick.title, artist: pick.subtitle, zone: zone.display_name });
    } catch (e) {
      res.status(500).json({ error: /** @type {Error} */ (e).message });
    }
  });
}

module.exports = { mountShortcuts };
