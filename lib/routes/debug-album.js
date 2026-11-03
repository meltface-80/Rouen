// @ts-check
"use strict";
/*
 * debug-album.js — /api/debug/album?offset=N: the raw items Roon returns when drilling into an album (out of index.js
 * in v1.9.72-t5, behaviour unchanged). Read-only: one browse of the official API.
 */

/**
 * @param {{ get: Function }} app
 * @param {{ core: () => any, withBrowseSession: (fn: (key: string) => Promise<void>) => Promise<void>,
 *   browse: (o: object) => Promise<any>, load: (o: object) => Promise<any> }} deps
 */
function mountDebugAlbum(app, deps) {
  app.get("/api/debug/album", async (/** @type {any} */ req, /** @type {any} */ res) => {
    if (!deps.core()) return res.status(503).json({ error: "Not paired with Roon Core yet" });
    const offset = parseInt(req.query.offset, 10);
    if (!Number.isFinite(offset) || offset < 0) {
      return res.status(400).json({ error: "Valid offset query parameter required" });
    }
    try {
      await deps.withBrowseSession(async (/** @type {string} */ sessionKey) => {
        await deps.browse({ hierarchy: "albums", pop_all: true, multi_session_key: sessionKey });
        const albumLoad = await deps.load({
          hierarchy: "albums", offset, count: 1, multi_session_key: sessionKey
        });
        const albumItem = albumLoad.items && albumLoad.items[0];
        if (!albumItem) return res.status(404).json({ error: "Album not found at offset" });

        await deps.browse({
          hierarchy: "albums",
          item_key:  albumItem.item_key,
          multi_session_key: sessionKey
        });
        const inside = await deps.load({
          hierarchy: "albums",
          offset: 0,
          count: 500,
          multi_session_key: sessionKey
        });
        res.json({
          album: { title: albumItem.title, subtitle: albumItem.subtitle },
          list:  inside.list,
          item_count_returned: (inside.items || []).length,
          items: (inside.items || []).map((/** @type {any} */ it) => ({
            title: it.title,
            subtitle: it.subtitle,
            hint: it.hint || null,
            has_image: !!it.image_key,
            item_key_present: !!it.item_key
          }))
        });
      });
    } catch (e) {
      res.status(500).json({ error: /** @type {Error} */ (e).message });
    }
  });
}

module.exports = { mountDebugAlbum };
