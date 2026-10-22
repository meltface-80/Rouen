// @ts-check
"use strict";
/*
 * smart-playlists.js — Rouen's Dynamic Playlists' routes, moved out of index.js unchanged in v1.9.61 (dev/quality.md),
 * and their move onto Roon's smart playlists (dev/design/native-remote.md §12.16).
 *
 *   GET  /api/smart-playlists                 Rouen's own, each with its album counts and covers
 *   POST /api/smart-playlists                 create, or replace in place  body: { id?, name, view, limit?, mode?, order? }
 *   POST /api/smart-playlists/delete          body: { id }
 *   GET  /api/roon-smart/move                 how the move onto Roon stands
 *
 * The move (§12.16): with native mode on, once a connection and again after each save, every Dynamic Playlist Roon can
 * hold is made in Roon (or found there already), and Rouen's own copy then leaves its list — kept in settings.json as
 * `roonSmartMoved` with Roon's PlaylistId, so the tile shows Roon's where Rouen's stood. Asked for on every open of the
 * Dynamic Playlists screen, of Settings, and every 5 minutes.
 */

const MOVE_EVERY_MS = 5 * 60 * 1000;
/** How many moved records are kept (§12.16): the newest, each under a kilobyte. */
const MOVED_MAX = 1000;

/**
 * @typedef {{ id: string, name: string, view: any, limit: number, mode: string, order: string }} Record_
 * @typedef {{ roonId: string, name: string, how: string, at: number, rouen: Record_ }} Moved
 */

/**
 * @param {{ get: Function, post: Function }} app
 * @param {{ load: () => Record_[], save: (list: Record_[]) => boolean, record: (p: any) => Record_ | null, nameMax: number, max: number,
 *           indexBuilt: () => boolean, view: (v: any) => any[], unavailable: (sp: any) => string | null,
 *           settings: { load: () => Record<string, any>, save: (patch: Record<string, any>) => boolean },
 *           move: () => ReturnType<typeof import("../roon-direct/smart-move").createSmartMove> | null,
 *           log?: (line: string) => void, timers?: boolean }} d
 * @returns {{ movedIds: () => Set<string>, tryMove: () => void }}
 */
function mountSmartPlaylists(app, d) {
  const log = d.log || ((/** @type {string} */ line) => { console.log("[smart] " + line); });

  /** The moved records, as kept. @returns {Moved[]} */
  const movedList = () => { const m = d.settings.load().roonSmartMoved; return Array.isArray(m) ? m.filter((x) => x && typeof x.roonId === "string") : []; };
  /** Roon's PlaylistIds of the Dynamic Playlists Rouen moved there. */
  const movedIds = () => new Set(movedList().map((x) => x.roonId));

  /**
   * One moved (or found there already): Rouen's own copy leaves its list, and is kept with Roon's id, in one write.
   * @param {any} sp @param {string} roonId @param {string} how
   */
  function moved(sp, roonId, how) {
    const list = d.load();
    const next = list.filter((p) => p.id !== sp.id);
    const kept = movedList().filter((x) => x.roonId !== roonId);
    kept.push({ roonId, name: sp.name, how, at: Date.now(), rouen: sp });
    if (!d.settings.save({ smartPlaylists: next, roonSmartMoved: kept.slice(-MOVED_MAX) })) {
      log(`"${sp.name}" is in Roon, but Rouen couldn't save that: its own copy stays until the next move finds it there`);
    }
  }

  /** The move, when native mode has something new to move. */
  function tryMove() {
    const m = d.move();
    if (!m) return;
    try {
      m.maybe(() => d.load().map((sp) => {
        const unavailable = d.unavailable(sp);
        /** @type {number | null} */
        let matched = null;
        try { if (d.indexBuilt() && !unavailable) matched = d.view(sp.view).length; }
        catch (e) { matched = null; }   // a bad view: the limit's note says "every album" rather than a number
        return { sp, matched, unavailable };
      }), moved,
      // Still in Rouen's list as it was when the move began (the review: an edit or a delete meanwhile is not undone).
      (sp) => JSON.stringify(d.load().find((p) => p.id === sp.id) || null) === JSON.stringify(sp));
    } catch (e) {
      log("the move onto Roon couldn't start: " + /** @type {any} */ (e).message);
    }
  }
  if (d.timers !== false) setInterval(tryMove, MOVE_EVERY_MS).unref();

  app.get("/api/smart-playlists", (/** @type {any} */ req, /** @type {any} */ res) => {
    // Each row carries its album count so the tile can read like a playlist tile
    // ("48 Albums"). Costs nothing — libraryView is in-memory and cached.
    const list = d.load();
    let counted = list;
    if (d.indexBuilt()) {
      counted = list.map((p) => {
        try {
          const view = d.view(p.view);
          // Up to four DISTINCT covers for the tile mosaic, straight from the
          // snapshot — no Roon calls. Distinct because a playlist that resolves to
          // one artist would otherwise show the same sleeve four times.
          /** @type {string[]} */
          const keys = [];
          for (const al of view) {
            if (al.image_key && !keys.includes(al.image_key)) keys.push(al.image_key);
            if (keys.length === 4) break;
          }
          // `album_total` is what this playlist DELIVERS; `album_matched` is what
          // the query found. The tile showed the second and played the first,
          // which is precisely the mismatch that made the cap misleading.
          // An unavailable playlist plays nothing: no count of the broader set its view gives without the facet that
          // is off (the review, v1.9.54).
          const unavailable = d.unavailable(p);
          return Object.assign({}, p, {
            album_total: unavailable ? null : Math.min(view.length, p.limit),
            album_matched: unavailable ? null : view.length,
            art_keys: unavailable ? [] : keys,
            unavailable,
          });
        }
        // A bad view must not take the whole list down — but the row still has to
        // carry its reason, or the tile looks ordinary until it is opened.
        catch (e) { return Object.assign({}, p, { unavailable: d.unavailable(p) }); }
      });
    } else {
      // No snapshot yet, so no counts — the reason is still known and cheap.
      counted = list.map((p) => Object.assign({}, p, { unavailable: d.unavailable(p) }));
    }
    res.json({ playlists: counted });
    tryMove();
  });

  // Create or rename/update one.  body: { id?, name, view, limit? }
  // An omitted id creates; a known id replaces in place (so "save over" works).
  app.post("/api/smart-playlists", (/** @type {any} */ req, /** @type {any} */ res) => {
    const body = req.body || {};
    const name = String(body.name || "").trim().slice(0, d.nameMax);
    if (!name) return res.status(400).json({ error: "name required" });

    const list = d.load();
    const id = String(body.id || "").trim();
    // One moved to Roon meanwhile (its screen or editor still Rouen's): not saved as a second copy (the review, §12.16).
    if (id && !list.some((p) => p.id === id) && movedList().some((x) => x.rouen && x.rouen.id === id)) {
      return res.status(409).json({ error: "This Dynamic Playlist is now one of your server's smart playlists. Open it again from Dynamic Playlists." });
    }
    // Built through smartPlaylistRecord so the limit is normalised by the same
    // function that reads it back off disk — a second, hand-rolled shape here is
    // how the two drift.
    const record = d.record({
      id: id || ("sp_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
      name, view: body.view, limit: body.limit, mode: body.mode, order: body.order,
    });
    if (!record) return res.status(400).json({ error: "name required" });

    const at = id ? list.findIndex((p) => p.id === id) : -1;
    if (at >= 0) {
      list[at] = record;
    } else {
      // Same name twice is a rename-in-place, not a duplicate — the picker is a
      // flat list and two identical rows would be indistinguishable.
      const byName = list.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
      if (byName >= 0) { record.id = list[byName].id; list[byName] = record; }
      else {
        if (list.length >= d.max) {
          return res.status(400).json({ error: `That's the limit of ${d.max} smart playlists` });
        }
        list.push(record);
      }
    }
    if (!d.save(list)) return res.status(500).json({ error: "Couldn't save" });
    console.log(`[smart] saved "${name}"`);
    // album_matched travels back so the client can say "plays 100 of the 1,179
    // that match" at the moment of saving, rather than leaving the user to
    // discover the limit when a play falls short of the count on the tile.
    /** @type {number | null} */
    let matched = null;
    try { if (d.indexBuilt() && !d.unavailable(record)) matched = d.view(record.view).length; }
    catch (e) { /* a bad view must not fail the save that just succeeded */ }
    res.json({ ok: true, playlist: Object.assign({}, record, { album_matched: matched }),
      playlists: list });
    // A playlist saved goes to Roon now, not at the next connection (§12.16: "created in Rouen … made in Roon").
    const m = d.move();
    if (m) { m.changed(); tryMove(); }
  });

  app.post("/api/smart-playlists/delete", (/** @type {any} */ req, /** @type {any} */ res) => {
    const id = String((req.body && req.body.id) || "").trim();
    if (!id) return res.status(400).json({ error: "id required" });
    const list = d.load();
    const next = list.filter((p) => p.id !== id);
    if (next.length === list.length) return res.status(404).json({ error: "No such dynamic playlist" });
    if (!d.save(next)) return res.status(500).json({ error: "Couldn't save" });
    console.log(`[smart] deleted ${id}`);
    res.json({ ok: true, playlists: next });
  });

  // How the move onto Roon stands (Settings → Native mode, §12.16).
  app.get("/api/roon-smart/move", (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    const m = d.move();
    if (!m) return res.json({ available: false });
    tryMove();
    const p = m.progress();
    res.json({ available: true, running: p.running, total: p.total, rouen: d.load().length, inRoon: movedList().length,
      done: p.done, error: p.error });
  });

  return { movedIds, tryMove };
}

module.exports = { mountSmartPlaylists };
