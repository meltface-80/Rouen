// @ts-check
"use strict";
/*
 * roon-playlist-edit.js — a Roon playlist's tracks moved and removed from its page (2.0.4-t13,
 * dev/design/playlist-edit.md §4.2; the server's side is lib/roon-direct/playlist-edit.js):
 *
 *   POST /api/roon-playlists/move    { id, from, from_title, to, to_title, count? }
 *   POST /api/roon-playlists/remove  { id, at, title, count? }
 *     count: how many tracks the page has, when it has them all; a playlist read of another length is stale
 *     → { ok: true } once the playlist read back shows it; else { ok: false, error, stale? } with 400 (what was sent),
 *       409 (the playlist changed since the page read it: nothing was sent), 503 (native mode can't act now) or 502
 *       (your server refused it, or never showed it).
 *
 * A playlist is named by its PlaylistId as hex (as /api/roon-playlists lists it), a track by its place in the playlist
 * (from 0) and its title, as the page shows it.
 */

/** A playlist's id, as lib/playlists-native.js takes it. */
const ID = /^[0-9a-f]{2,64}$/;
/** A place in a playlist: Roon's playlists hold far fewer. */
const MAX_AT = 1000000;

/** @param {any} v */
const place = (v) => (Number.isInteger(v) && v >= 0 && v < MAX_AT ? v : null);
/** A count given, or undefined when none is. @param {any} v */
const countOf = (v) => (v === undefined ? undefined : place(v) === null ? null : v);
/** @param {any} v */
const title = (v) => (typeof v === "string" && v.length <= 1000 ? v : null);

/**
 * @param {any} app
 * @param {{ move(o: any): Promise<any>, remove(o: any): Promise<any> } | null | undefined} edit  lib/roon-direct/playlist-edit.js
 */
function mountRoonPlaylistEdit(app, edit) {
  /** @param {(b: any) => { error: string } | Promise<any>} fn */
  const route = (fn) => async (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    if (!edit) return res.status(503).json({ ok: false, error: "Native mode isn't available here." });
    const b = req.body || {};
    if (typeof b.id !== "string" || !ID.test(b.id)) return res.status(400).json({ ok: false, error: "A playlist's id, please." });
    const out = await fn(b);
    if ("error" in out && !("ok" in out)) return res.status(400).json({ ok: false, error: out.error });
    if (out.ok) return res.json({ ok: true });
    res.status(out.status || 502).json(Object.assign({ ok: false, error: out.error }, out.stale ? { stale: true } : {}));
  };

  app.post("/api/roon-playlists/move", route((b) => {
    const from = place(b.from), to = place(b.to), fromTitle = title(b.from_title), toTitle = title(b.to_title), count = countOf(b.count);
    if (from === null || to === null || fromTitle === null || toTitle === null || count === null) return { error: "from, to and both titles, please." };
    if (from === to) return { error: "A track moved to where it is." };
    return /** @type {any} */ (edit).move(Object.assign({ id: b.id, from, fromTitle, to, toTitle }, count === undefined ? {} : { count }));
  }));

  app.post("/api/roon-playlists/remove", route((b) => {
    const at = place(b.at), t = title(b.title), count = countOf(b.count);
    if (at === null || t === null || count === null) return { error: "at and the title, please." };
    return /** @type {any} */ (edit).remove(Object.assign({ id: b.id, at, title: t }, count === undefined ? {} : { count }));
  }));
}

module.exports = { mountRoonPlaylistEdit };
