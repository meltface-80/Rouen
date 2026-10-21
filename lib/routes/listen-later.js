// @ts-check
"use strict";
/*
 * listen-later.js — the Listen later list's routes, moved out of index.js in v1.9.45, and Roon's own
 * list in place of Rouen's with native mode on (N2c-2, dev/design/native-remote.md §10.4).
 *
 *   GET  /api/listen-later            the list, newest first (Roon's when it can be read, else Rouen's)
 *   POST /api/listen-later { title, artist, on, service?, album_id?, image?, source? }
 *   GET  /api/roon-later/move         how Rouen's own list's move onto Roon's stands (v1.9.47): it moves by
 *                                     itself, once a connection, when Roon's list is read on it
 *
 * With native mode on, a change goes to Roon's list (lib/roon-direct/later.js), believed once that list
 * shows it. One that can't be sent is kept today's way, on Rouen's own list, and the answer says so
 * (`kept`); one sent and not shown is only said. Native mode off: Rouen's own list, as before.
 */

/**
 * @typedef {ReturnType<typeof import("../roon-direct/later").createLater>} Later
 * @typedef {{ title: string, subtitle: string, offset: number, image_key?: string | null }} Rec  a library album
 */

const REFRESH_MS = 5 * 60 * 1000;

/**
 * @param {{ get: Function, post: Function }} app
 * @param {{ native: () => Later | null, rows: () => any[], record: (title: string, artist: string) => Rec | null,
 *           matches: (title: string, artist: string, rows?: any[]) => any[], add: (entry: any) => boolean,
 *           remove: (title: string, artist: string) => number, favourites: () => Promise<{ qobuz: Set<string> | null, tidal: Set<string> | null }>,
 *           withSource: (album: any, rec: any) => any, serviceUrl: (service: string, albumId: string) => string | null,
 *           keyOf: (title: string, artist: string) => string | null, dbReady: () => boolean, writable: () => boolean,
 *           refreshMs?: number }} d
 *   record: the library album these strings name now (exact first, index.js listenLaterLibraryRecord);
 *   matches: Rouen's own rows naming that album; writable: Rouen's own list may change now (not restarting after a restore);
 *   refreshMs: how often Roon's list is read unasked (0: never)
 */
function mountListenLater(app, d) {
  /** The album asked about, as later.js takes it: with the library's own strings when Rouen has it. @param {string} title @param {string} artist @param {string} [service] */
  const wanted = (title, artist, service) => {
    const rec = d.record(title, artist);
    return { title, artist, service: service || "", alt: rec ? { title: rec.title, artist: rec.subtitle } : null };
  };

  /** Off Rouen's own list, while it may change (each time: a restore may begin while a move runs, the review). @param {{ title: string, artist: string }} w */
  const leave = (w) => { if (d.writable()) d.remove(w.title, w.artist); };
  /**
   * What makes an entry playable: its place in the library and Roon's own strings (the play routes check identity
   * against them), and the album as every other Home row sends it, badges included. @param {Rec | null} rec
   */
  const libraryPart = (rec) => ({
    offset: rec ? rec.offset : null, library_title: rec ? rec.title : "", library_subtitle: rec ? rec.subtitle : "",
    image_key: rec ? (rec.image_key || null) : null,
    album: rec ? d.withSource({ offset: rec.offset, title: rec.title, subtitle: rec.subtitle, image_key: rec.image_key || null }, rec) : null,
  });
  /** One of Rouen's own rows as the client sees it (v1.8.67). @param {any} row @param {any} favs */
  function rouenJson(row, favs) {
    const rec = d.record(row.title, row.artist);
    const set = row.service === "qobuz" ? (favs && favs.qobuz) : row.service === "tidal" ? (favs && favs.tidal) : null;
    return {
      key: row.key, title: row.title, artist: row.artist, service: row.service || "", album_id: row.album_id || "",
      image: row.image || "", source: row.source, added_at: row.ts,
      // Whether a service-only entry is already favourited; null when the service could not be asked.
      added: set && row.album_id ? set.has(String(row.album_id)) : null,
      service_url: d.serviceUrl(row.service, row.album_id),
      ...libraryPart(rec),
    };
  }
  /**
   * One album on Roon's list, in the same shape (§10.4): no service album id (Roon names it by its own), its cover
   * your server's. @param {import("../roon-direct/later").Entry} e @param {number} readAt
   */
  const roonJson = (e, readAt) => ({
    key: d.keyOf(e.title, e.artist) || e.albumId, title: e.title, artist: e.artist, service: e.service, album_id: "",
    image: e.imageKey ? `/api/image/${encodeURIComponent(e.imageKey)}?size=500` : "", source: "roon",
    added_at: (e.at && Date.parse(e.at.replace(" (the server's local time)", "Z"))) || readAt, added: null, service_url: null,
    ...libraryPart(d.record(e.title, e.artist)),
  });

  app.get("/api/listen-later", async (/** @type {any} */ req, /** @type {any} */ res) => {
    try {
      const n = d.native();
      const l = n ? await n.list() : null;
      if (l && "entries" in l) { tryMove(); return res.json({ albums: l.entries.map((e) => roonJson(e, l.at)), roon: true }); }
      const rows = d.rows();
      // The favourites are read only when an entry needs them: one that Roon does not have and that names a service
      // album it could be added from — and never for the Home row (?favs=0), which must not wait on a service to paint.
      const needFavs = req.query.favs !== "0" && rows.some((r) => r.album_id && !d.record(r.title, r.artist));
      const favs = needFavs ? await d.favourites() : { qobuz: null, tidal: null };
      res.json({ albums: rows.map((r) => rouenJson(r, favs)) });
    } catch (e) {
      res.status(500).json({ error: /** @type {any} */ (e).message });
    }
  });

  // `on` is the state ASKED FOR, not a toggle: two devices tapping at once must both end where they meant to.
  app.post("/api/listen-later", async (/** @type {any} */ req, /** @type {any} */ res) => {
    const body = req.body || {};
    const title = String(body.title || "").trim();
    const artist = String(body.artist || "").trim();
    if (!title) return res.status(400).json({ error: "title required" });
    if (typeof body.on !== "boolean") return res.status(400).json({ error: "on must be true or false" });
    if (!d.keyOf(title, artist)) return res.status(400).json({ error: "unrecognisable album title" });
    const n = d.native();
    let kept = null;
    if (n) {
      try {
        const out = await n.set(wanted(title, artist, body.service), body.on);
        // Taken off Roon's list: off Rouen's own too, should a move have left it there (the review).
        if ("ok" in out) { if (!out.on) leave({ title, artist }); return res.json({ ok: true, on: out.on, roon: true }); }
        if ("notShown" in out) return res.status(502).json({ error: out.notShown });
        if ("notSent" in out) kept = out.notSent;   // today's way, said
      } catch (e) {
        kept = "Native mode couldn't send it: " + /** @type {any} */ (e).message;
      }
    }
    if (!d.dbReady()) return res.status(503).json({ error: kept || "History database unavailable" });
    const also = kept ? (body.on ? " It's on Rouen's own Listen later instead, shown while your server's can't be read or native mode is off."
      : " It's taken off Rouen's own Listen later instead.") : "";
    if (body.on) {
      const ok = d.add({ title, artist, service: body.service, album_id: body.album_id, image: body.image, source: body.source });
      if (!ok) return res.status(500).json({ error: "Couldn't save that" });
      return res.json(kept ? { ok: true, on: true, kept: kept + also } : { ok: true, on: true });
    }
    d.remove(title, artist);
    res.json(kept ? { ok: true, on: false, kept: kept + also } : { ok: true, on: false });
  });

  /**
   * Rouen's own list moved onto Roon's (v1.9.47, the owner: "Move it"): once a connection, when Roon's list has been read
   * on it; each album Roon's list shows leaves Rouen's own, and what it couldn't take stays, tried again on the next.
   */
  /** @type {number | null} */
  let movedOn = null;
  function maybeMove() {
    const n = d.native();
    const on = n ? n.listedOn() : null;
    if (!n || !on || !d.writable()) return;
    // Every read: what Roon's list holds now leaves Rouen's own — one shown only after its move gave up on it, or put
    // back there by hand — so a removal in Roon is never undone by the next move (the review).
    const rows = d.rows().filter((r) => { const w = wanted(r.title, r.artist); if (n.has(w) !== true) return true; leave(w); return false; });
    const p = n.moveProgress();
    // Once a connection; again on it only when its move couldn't read Roon's list (the review).
    if (on === movedOn && !(p.error && !p.running)) return;
    if (!rows.length) { movedOn = on; return; }
    if ("running" in n.move(rows.map((r) => wanted(r.title, r.artist, r.service)), leave)) movedOn = on;
  }
  function tryMove() { try { maybeMove(); } catch (e) { console.error("[later] the move couldn't start: " + /** @type {any} */ (e).message); } }
  app.get("/api/roon-later/move", async (/** @type {any} */ req, /** @type {any} */ res) => {
    const n = d.native();
    if (!n) return res.json({ available: false });
    try {
      const l = await n.list();
      if ("entries" in l) tryMove();
      const p = n.moveProgress();
      // Running: how many it has been through (sent ones are believed only at the end, the review); done: how many moved.
      res.json({ available: "entries" in l, why: "notRead" in l ? l.notRead : null, rouen: d.rows().length, running: p.running, total: p.total,
        moved: p.running ? p.done.length : p.done.filter((x) => x.result === "moved" || x.result === "already").length,
        left: p.running ? [] : p.done.filter((x) => x.result === "failed" || x.result === "not-shown"), error: p.error });
    } catch (e) {
      res.status(500).json({ error: /** @type {any} */ (e).message });
    }
  });

  const every = d.refreshMs === undefined ? REFRESH_MS : d.refreshMs;
  if (every) {
    // Roon's list read unasked, so a change made in Roon's own apps reaches every open screen (§10.4).
    const t = setInterval(() => {
      const n = d.native();
      // Half the interval as its age: a read begun at the last tick is always older than that by this one (the review).
      if (n) n.refresh(every / 2).then(tryMove, () => { /* list() answers notRead rather than rejecting; the next tick or ask reads again */ });
    }, every);
    if (t.unref) t.unref();
  }

  return {
    /**
     * Whether the album is on the list in force: Roon's as last read, else Rouen's own.
     * @param {string} title @param {string} artist @param {any[]} [rows]  Rouen's rows, read once by a caller asking many
     */
    has(title, artist, rows) {
      const n = d.native();
      const roon = n ? n.has(wanted(title, artist)) : null;
      return roon !== null ? roon : d.matches(title, artist, rows).length > 0;
    },
    /**
     * Put on the list in force (a Smart Pick sent to Listen later): Roon's, else — or when it can't be sent — Rouen's.
     * @param {{ title: string, artist: string, service?: string, album_id?: string, image?: string, source?: string }} entry
     */
    async put(entry) {
      const n = d.native();
      if (n) {
        /** @type {any} */
        let out = null;
        try { out = await n.set(wanted(entry.title, entry.artist, entry.service), true); }
        catch (e) { console.error("[later] a Smart Pick for your server's Listen Later failed: " + /** @type {any} */ (e).message); }
        if (out && ("ok" in out || "notShown" in out)) return;   // sent: not kept twice
      }
      d.add(entry);
    },
  };
}

module.exports = { mountListenLater };
