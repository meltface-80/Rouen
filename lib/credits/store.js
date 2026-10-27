// @ts-check
"use strict";
/*
 * store.js — what Rouen keeps of albums' credits and the names on them (dev/design/album-credits.md §4, §5), in the
 * labels database beside the label and release caches: `album_credits` (an album's rows, what each source came to,
 * when) and `credit_acts` (a name's MusicBrainz id and picture, when looked up). Its tables are made the first time
 * they are used. With no database (better-sqlite3 missing) it keeps them in memory for the life of the process.
 */

/**
 * @typedef {{ rows: import("./rules").AlbumCredit[], sources: Record<string, { state: string, at: number, why?: string }>, at: number }} KeptAlbum
 *   state: "gave" (something), "none" (asked; nothing), "failed" (couldn't ask; asked again the next day), "off" (not to be asked)
 * @typedef {{ key: string, name: string, mbid: string | null, photo: string | null, source: string | null, at: number, ok: boolean,
 *              members?: Array<{ name: string, mbid: string | null, roles: string[] }> | null }} KeptAct
 *   ok: false when MusicBrainz couldn't be reached (asked again the next day); members: a band's now (§7), null if never read
 */

/** @param {{ db: () => any, log?: (line: string) => void }} deps  db: the labels database, or null */
function createCreditStore(deps) {
  const log = deps.log || (() => {});
  /** @type {Map<string, KeptAlbum>} */
  const albums = new Map();
  /** @type {Map<string, KeptAct>} */
  const acts = new Map();
  let made = null;

  /** The database with the tables made, or null. */
  function db() {
    const d = deps.db();
    if (!d) return null;
    if (made !== d) {
      try {
        d.exec(`CREATE TABLE IF NOT EXISTS album_credits (key TEXT PRIMARY KEY, rows TEXT NOT NULL, sources TEXT NOT NULL, read_at INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS credit_acts (key TEXT PRIMARY KEY, name TEXT NOT NULL, mbid TEXT, photo TEXT, photo_source TEXT,
            looked_at INTEGER NOT NULL, ok INTEGER NOT NULL, members TEXT);`);
        made = d;
      } catch (e) { log("credits: the tables couldn't be made: " + String(e && /** @type {any} */ (e).message)); return null; }
    }
    return d;
  }

  return {
    /** @param {string} key @returns {KeptAlbum | null} */
    album(key) {
      // Kept in memory when the database couldn't take it (the review), read back before the database.
      if (albums.has(key)) return albums.get(key) || null;
      const d = db();
      if (!d) return null;
      try {
        const r = d.prepare("SELECT rows, sources, read_at FROM album_credits WHERE key = ?").get(key);
        return r ? { rows: JSON.parse(r.rows), sources: JSON.parse(r.sources), at: r.read_at } : null;
      } catch (e) { log("credits: an album couldn't be read: " + String(e && /** @type {any} */ (e).message)); return null; }
    },
    /** @param {string} key @param {KeptAlbum} v */
    saveAlbum(key, v) {
      const d = db();
      if (!d) { albums.set(key, v); return; }
      try { d.prepare("INSERT OR REPLACE INTO album_credits (key, rows, sources, read_at) VALUES (?, ?, ?, ?)").run(key, JSON.stringify(v.rows), JSON.stringify(v.sources), v.at); albums.delete(key); }
      catch (e) { log("credits: an album couldn't be kept: " + String(e && /** @type {any} */ (e).message)); albums.set(key, v); }
    },
    /** @param {string} key @returns {KeptAct | null} */
    act(key) {
      if (acts.has(key)) return acts.get(key) || null;
      const d = db();
      if (!d) return null;
      try {
        const r = d.prepare("SELECT key, name, mbid, photo, photo_source, looked_at, ok, members FROM credit_acts WHERE key = ?").get(key);
        return r ? { key: r.key, name: r.name, mbid: r.mbid, photo: r.photo, source: r.photo_source, at: r.looked_at, ok: !!r.ok, members: r.members ? JSON.parse(r.members) : null } : null;
      } catch (e) { log("credits: a name couldn't be read: " + String(e && /** @type {any} */ (e).message)); return null; }
    },
    /** @param {KeptAct} v */
    saveAct(v) {
      const d = db();
      if (!d) { acts.set(v.key, v); return; }
      try {
        d.prepare("INSERT OR REPLACE INTO credit_acts (key, name, mbid, photo, photo_source, looked_at, ok, members) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .run(v.key, v.name, v.mbid, v.photo, v.source, v.at, v.ok ? 1 : 0, v.members ? JSON.stringify(v.members) : null);
        acts.delete(v.key);
      } catch (e) { log("credits: a name couldn't be kept: " + String(e && /** @type {any} */ (e).message)); acts.set(v.key, v); }
    },
  };
}

module.exports = { createCreditStore };
