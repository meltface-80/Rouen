// @ts-check
"use strict";
/*
 * debug-browse-routes.js — three read-only diagnostics of Roon's PUBLIC browse
 * API, moved out of index.js in v1.9.11 with behaviour unchanged
 * (dev/quality.md, "Splitting the monoliths"):
 *
 *   GET /api/debug/labels         the browse root and Library's contents
 *   GET /api/debug/filter         what a filter navigation finds, level by level
 *   GET /api/debug/browse-probe   walk a path of browse titles, optionally drill
 *                                 one album and one item's action menu
 *   GET /api/debug/streaming-browse   TIDAL's and Qobuz's trees, and their albums' menus
 *                                 (v1.9.36, lib/streaming-browse-probe.js)
 *
 * None of them plays, queues or adds anything. index.js hands in the browse
 * helpers it owns; nothing here holds state.
 */
const { mountStreamingBrowseProbe } = require("./streaming-browse-probe");

/**
 * @typedef {object} BrowseDebugDeps
 * @property {() => boolean} hasCore
 * @property {(fn: (sessionKey: string) => Promise<any>) => Promise<any>} withBrowseSession
 * @property {(opts: any) => Promise<any>} browse
 * @property {(opts: any) => Promise<any>} load
 * @property {(sessionKey: string, hierarchy: string, count: number) => Promise<any>} loadLevel
 * @property {(sessionKey: string, hierarchy: string, title: string, count: number) => Promise<any>} findItemByTitle
 * @property {(sessionKey: string, filter: any) => Promise<any>} navigateToAlbumList
 * @property {(query: any) => any} parseFilter
 */

/**
 * @param {{ get: Function }} app
 * @param {BrowseDebugDeps} d
 */
function mountBrowseDebug(app, d) {
  const { withBrowseSession, browse, load, loadLevel, findItemByTitle, navigateToAlbumList, parseFilter } = d;
  mountStreamingBrowseProbe(app, { hasCore: d.hasCore, withBrowseSession, browse, load });
  // Debug: dump the browse root + Library contents so we can see whether (and
  // where) a "Labels" list exists on a live Core.
  app.get("/api/debug/labels", async (/** @type {any} */ req, /** @type {any} */ res) => {
    if (!d.hasCore()) return res.status(503).json({ error: "Not paired with Roon Core yet" });
    try {
      await withBrowseSession(async (sessionKey) => {
        await browse({ hierarchy: "browse", pop_all: true, multi_session_key: sessionKey });
        const root = await loadLevel(sessionKey, "browse", 100);
        let library = null;
        const lib = root.items.find(i => /^library$/i.test((i.title || "").trim()));
        if (lib) {
          await browse({ hierarchy: "browse", item_key: lib.item_key, multi_session_key: sessionKey });
          library = (await loadLevel(sessionKey, "browse", 100)).items.map(i => i.title);
        }
        res.json({ root: root.items.map(i => i.title), library });
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Debug: dump what a filter navigation actually finds, level by level —
  // for fixing tree-walking assumptions against a live Core.
  app.get("/api/debug/filter", async (/** @type {any} */ req, /** @type {any} */ res) => {
    if (!d.hasCore()) return res.status(503).json({ error: "Not paired with Roon Core yet" });
    const filter = parseFilter(req.query);
    try {
      await withBrowseSession(async (sessionKey) => {
        const nav = await navigateToAlbumList(sessionKey, filter);
        const sample = await load({
          hierarchy: nav.hierarchy, offset: 0, count: 10, multi_session_key: sessionKey
        });
        res.json({
          filter, hierarchy: nav.hierarchy, total: nav.total,
          sample: (sample.items || []).map(i => ({
            title: i.title, subtitle: i.subtitle, hint: i.hint || null
          }))
        });
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Debug: read-only probe of the Roon browse tree. Walks from the browse root
  // through a slash-separated `path` of node titles (case-insensitive) and dumps
  // what the resulting level contains. Optionally drills into one album at that
  // level (`album=<index>`) to dump its contents/action_list. Used to confirm
  // (a) whether Qobuz "New Releases" is reachable and how many albums it holds,
  // and (b) whether an "Add to Library"/"Add to Favorites" action exists on a
  // Qobuz album — WITHOUT invoking anything. No zone_or_output_id is ever passed,
  // so nothing is played, queued, or added; this only reads the tree. Examples:
  //   /api/debug/browse-probe                                   → list browse root
  //   /api/debug/browse-probe?path=Qobuz                        → list the Qobuz section
  //   /api/debug/browse-probe?path=Qobuz/New%20Releases         → list those albums (count)
  //   ...&album=0&zone=<zone_id>                                → drill an album, zone-scoped
  //   ...&album=0&action=3&zone=<zone_id>                       → list item 3's ACTION MENU
  //
  // The action drill answers "does Roon offer an extension any playlist action?"
  // — "Add to Library" is known to appear in these menus, so their absence of an
  // "Add to Playlist" is worth confirming on a real Core rather than assuming.
  //   /api/debug/browse-probe?path=Qobuz/New%20Releases&album=0 → dump album 0's actions
  app.get("/api/debug/browse-probe", async (/** @type {any} */ req, /** @type {any} */ res) => {
    if (!d.hasCore()) return res.status(503).json({ error: "Not paired with Roon Core yet" });
    const hierarchy = "browse";
    const segments = (req.query.path || "").toString().split("/").map(s => s.trim()).filter(Boolean);
    const zone = String(req.query.zone || "") || undefined;
    const albumRaw = req.query.album;
    const albumIdx = albumRaw === undefined ? -1 : parseInt(albumRaw, 10);
    if (albumRaw !== undefined && (!Number.isFinite(albumIdx) || albumIdx < 0)) {
      return res.status(400).json({ error: "album must be a non-negative integer index" });
    }
    const mapItem = (/** @type {any} */ it) => ({
      title: it.title,
      subtitle: it.subtitle || null,
      hint: it.hint || null,
      has_image: !!it.image_key,
      has_item_key: !!it.item_key
    });
    try {
      await withBrowseSession(async (sessionKey) => {
        await browse({ hierarchy, pop_all: true, multi_session_key: sessionKey });
        const resolved = [];
        for (const seg of segments) {
          const node = await findItemByTitle(sessionKey, hierarchy, seg, 1000);
          if (!node) {
            const here = await loadLevel(sessionKey, hierarchy, 200);
            return res.status(404).json({
              error: 'Could not find "' + seg + '" at this level',
              resolved,
              available_here: here.items.map(i => i.title)
            });
          }
          resolved.push({ segment: seg, matchedTitle: node.title || null, hint: node.hint || null });
          await browse({ hierarchy, item_key: node.item_key, multi_session_key: sessionKey });
        }
        const level = await loadLevel(sessionKey, hierarchy, 300);
        const out = {
          path: segments,
          resolved,
          count: level.total,
          items: level.items.map((it, idx) => Object.assign({ idx }, mapItem(it)))
        };
        if (albumIdx >= 0) {
          const target = level.items[albumIdx];
          if (!target) {
            out.album = { error: "No item at index " + albumIdx + " (level has " + level.items.length + " items)" };
          } else if (!target.item_key) {
            out.album = { error: 'Item "' + (target.title || "") + '" has no item_key to drill into' };
          } else {
            // Read-only drill: browse the album item, then list its contents
            // (top-level action_list items + tracks). Nothing is invoked.
            //
            // `zone` matters here: Roon gates some browse items on a zone, so a
            // probe without one cannot prove an action is absent — only that it is
            // absent WITHOUT a zone. Pass ?zone=<id> to rule that out.
            await browse({ hierarchy, item_key: target.item_key, multi_session_key: sessionKey,
                           zone_or_output_id: zone });
            const inside = await load({ hierarchy, offset: 0, count: 500, multi_session_key: sessionKey });
            out.album = {
              title: target.title || null,
              subtitle: target.subtitle || null,
              list_title: (inside.list && inside.list.title) || null,
              zone_scoped: !!zone,
              items: (inside.items || []).map((it, idx) => Object.assign({ idx }, mapItem(it)))
            };

            // ?action=<idx> drills ONE level further, into that item's own action
            // menu — where a per-track "Add to Playlist" would live if Roon
            // offered one to extensions. Still read-only: the menu is listed, and
            // nothing in it is invoked.
            const actionRaw = req.query.action;
            if (actionRaw !== undefined) {
              const ai = parseInt(actionRaw, 10);
              const sub = (inside.items || [])[ai];
              if (!sub || !sub.item_key) {
                out.album.action = { error: "No item with an item_key at index " + actionRaw };
              } else {
                const d = await browse({ hierarchy, item_key: sub.item_key,
                                         multi_session_key: sessionKey,
                                         zone_or_output_id: zone });
                if (d.action !== "list") {
                  out.album.action = { of: sub.title || null, browse_action: d.action,
                                       note: "not a list — nothing to enumerate" };
                } else {
                  const acts = await load({ hierarchy, multi_session_key: sessionKey });
                  out.album.action = {
                    of: sub.title || null,
                    zone_scoped: !!zone,
                    items: (acts.items || []).map(mapItem)
                  };
                }
              }
            }
          }
        }
        res.json(out);
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

module.exports = { mountBrowseDebug };
