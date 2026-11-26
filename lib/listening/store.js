// @ts-check
"use strict";
/*
 * store.js — plays as dev/design/listening.md keeps them (§4), and the readers every screen counts plays with (§5).
 *
 *   plays          one row per track started (Recently played and the queue history read every row, as before), now
 *                  with `heard` (seconds listened), `played` (rule.js: 95%) and `album_key` (album-match.js: the
 *                  library album it was played from; '' when none could be named)
 *   album_plays    one row per album played (runs.js: every track played in one run)
 *   listening_meta this module's own bookkeeping: the last play row written before 2.0.6-t20 (`upgradeId`), and
 *                  whether the history has been read for album plays (§6)
 *
 * Plays from before 2.0.6-t20 never kept how long was heard, so they are read by the rule they were recorded under
 * (`completed`: half the track, 30 seconds at least) as track plays, and once, the first time the library is there,
 * as album plays where a run of them covers an album Rouen keeps the track list of (§6).
 *
 * Every reader answers empty rather than throwing when the database cannot be read: no history reads as no plays.
 */

const { createRuns } = require("./runs");

/** @typedef {import("./runs").TrackRow} TrackRow */

/** @param {{ db: () => any }} deps  db: the labels database, or null when there is none */
function createListeningStore(deps) {
  /** @type {Map<string, any>} */
  const stmts = new Map();
  /** @param {string} sql */
  function st(sql) {
    let s = stmts.get(sql);
    if (!s) { s = deps.db().prepare(sql); stmts.set(sql, s); }
    return s;
  }
  /** @template T @param {() => T} fn @param {T} none */
  function read(fn, none) {
    if (!deps.db()) return none;
    try { return fn(); } catch (e) { return none; }   // no table yet, or the database unreadable: no plays, as before
  }

  /** The tables and columns, made once at start; the rows from before them marked. @param {any} db */
  function migrate(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS album_plays (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        zone TEXT,
        album_key TEXT NOT NULL,
        title TEXT,
        image_key TEXT,
        tracks INTEGER,
        profile TEXT
      );
      CREATE INDEX IF NOT EXISTS album_plays_key ON album_plays(album_key);
      CREATE INDEX IF NOT EXISTS album_plays_ts ON album_plays(ts);
      CREATE TABLE IF NOT EXISTS listening_meta (k TEXT PRIMARY KEY, v TEXT);
    `);
    let upgrading = false;
    try { db.exec("ALTER TABLE plays ADD COLUMN heard INTEGER"); upgrading = true; }
    catch (e) { /* already present — SQLite has no ADD COLUMN IF NOT EXISTS */ }
    try { db.exec("ALTER TABLE plays ADD COLUMN played INTEGER DEFAULT 0"); }
    catch (e) { /* already present */ }
    try { db.exec("ALTER TABLE plays ADD COLUMN album_key TEXT"); }
    catch (e) { /* already present */ }
    db.exec("CREATE INDEX IF NOT EXISTS plays_album_key ON plays(album_key)");
    if (upgrading) {
      // The first start of 2.0.6-t20: every row so far was judged by the old rule, which is all Rouen knows of it.
      const top = db.prepare("SELECT MAX(id) AS id FROM plays").get();
      const upgradeId = top && top.id ? top.id : 0;
      db.prepare("INSERT OR REPLACE INTO listening_meta (k, v) VALUES ('upgradeId', ?)").run(String(upgradeId));
      db.prepare("UPDATE plays SET played = 1 WHERE id <= ? AND completed = 1").run(upgradeId);
    }
  }

  /** @param {string} k */
  function meta(k) { return read(() => { const r = st("SELECT v FROM listening_meta WHERE k = ?").get(k); return r ? r.v : null; }, null); }

  /**
   * A track started: its row, for Recently played now and for the counts once it ends. The row's id, or null.
   * @param {{ ts: number, zone: string, track: string, artist: string, album: string, image_key: string,
   *   duration: number, album_key: string | null }} p
   */
  function startPlay(p) {
    const info = st("INSERT INTO plays (ts, zone, track, artist, album, image_key, duration, album_key) " +
      "VALUES (?,?,?,?,?,?,?,?)").run(p.ts, p.zone, p.track, p.artist, p.album, p.image_key, p.duration, p.album_key);
    return info.lastInsertRowid;
  }

  /** A track ended: how long was heard, and whether that was a play. @param {number | bigint} id @param {number} heard @param {boolean} played */
  function endPlay(id, heard, played) {
    st("UPDATE plays SET heard = ?, played = ? WHERE id = ?").run(Math.round(heard), played ? 1 : 0, id);
  }

  /** An album played. @param {{ ts: number, zone: string, key: string, title: string, image_key: string | null, tracks: number }} p */
  function addAlbumPlay(p) {
    st("INSERT INTO album_plays (ts, zone, album_key, title, image_key, tracks) VALUES (?,?,?,?,?,?)")
      .run(p.ts, p.zone, p.key, p.title, p.image_key || "", p.tracks);
  }

  /** Every album with a track or album play since `cutoff` (exclusive), by its key. @param {number} cutoff */
  function playedKeysSince(cutoff) {
    return read(() => {
      const out = new Set();
      for (const r of st("SELECT DISTINCT album_key k FROM plays WHERE ts > ? AND played = 1 AND album_key != ''").all(cutoff)) out.add(r.k);
      for (const r of st("SELECT DISTINCT album_key k FROM album_plays WHERE ts > ?").all(cutoff)) out.add(r.k);
      return out;
    }, new Set());
  }

  /** Has anything been played at all? */
  function anyPlayed() {
    return read(() => !!st("SELECT 1 FROM plays WHERE played = 1 LIMIT 1").get(), false);
  }

  /**
   * Each album's play count (album plays) and when it was last played (its latest album play, else its latest track
   * play), by its key: the Library's play sorts and Smart Picks' seeds.
   * @returns {{ count: Map<string, number>, last: Map<string, number> }}
   */
  function albumStats() {
    const out = { count: new Map(), last: new Map() };
    return read(() => {
      for (const r of st("SELECT album_key k, MAX(ts) t FROM plays WHERE played = 1 AND album_key != '' GROUP BY album_key").all()) {
        out.last.set(r.k, r.t);
      }
      for (const r of st("SELECT album_key k, COUNT(*) n, MAX(ts) t FROM album_plays GROUP BY album_key").all()) {
        out.count.set(r.k, r.n);
        out.last.set(r.k, r.t);
      }
      return out;
    }, out);
  }

  /** Was the album played (an album play) at or after `since`? @param {string} key @param {number} since */
  function albumPlayedSince(key, since) {
    return read(() => !!st("SELECT 1 FROM album_plays WHERE album_key = ? AND ts >= ? LIMIT 1").get(key, since), false);
  }

  /** The artists of track plays since `cutoff`: who you play. @param {number} cutoff */
  function playedArtistRows(cutoff) {
    return read(() => st("SELECT artist, ts FROM plays WHERE ts >= ? AND played = 1 AND artist != ''").all(cutoff), []);
  }

  /** Album plays older than `cutoff` go, as plays do. The number gone. @param {number} cutoff */
  function prune(cutoff) {
    return read(() => st("DELETE FROM album_plays WHERE ts < ?").run(cutoff).changes, 0);
  }

  /**
   * Rows written before the library could name their album: named now ('' when it can't, so they are not asked
   * again). The number named.
   * @param {(p: { album: string, artist: string, image_key: string }) => { key: string } | null} match
   */
  function fillKeys(match) {
    return read(() => {
      const rows = st("SELECT id, album, artist, image_key FROM plays WHERE album_key IS NULL").all();
      if (!rows.length) return 0;
      const set = st("UPDATE plays SET album_key = ? WHERE id = ?");
      let named = 0;
      deps.db().transaction(() => {
        for (const r of rows) {
          const hit = r.album ? match(r) : null;
          set.run(hit ? hit.key : "", r.id);
          if (hit) named++;
        }
      })();
      return named;
    }, 0);
  }

  /**
   * Once: the plays from before 2.0.6-t20, read for album plays (§6). Their album keys must be filled first. The
   * number of album plays found, or null when it had run already.
   * @param {{ tracksOf: (key: string) => TrackRow[], trackKeys: (title: string) => string[],
   *   titleOf: (key: string) => { title: string, image_key: string | null } | null }} d
   */
  function readHistoryOnce(d) {
    if (!deps.db() || meta("historyRead")) return null;
    const upgradeId = Number(meta("upgradeId")) || 0;
    let found = 0;
    return read(() => {
      const rows = st("SELECT id, ts, zone, track, album_key, played FROM plays WHERE id <= ? ORDER BY zone, ts, id").all(upgradeId);
      const add = st("INSERT INTO album_plays (ts, zone, album_key, title, image_key, tracks) VALUES (?,?,?,?,?,?)");
      deps.db().transaction(() => {
        /** @type {Map<string, TrackRow[]>} each album's list read once, not once per track */
        const lists = new Map();
        const tracksOf = (/** @type {string} */ key) => {
          let l = lists.get(key);
          if (!l) { l = d.tracksOf(key); lists.set(key, l); }
          return l;
        };
        const runs = createRuns({ tracksOf, trackKeys: d.trackKeys, onAlbumPlay: (p) => {
          const t = d.titleOf(p.key);
          add.run(p.ts, p.zone, p.key, t ? t.title : "", t && t.image_key ? t.image_key : "", p.tracks);
          found++;
        } });
        for (const r of rows) {
          const key = r.album_key || null;
          runs.noteTrack(String(r.zone || ""), { key, al: key ? { title: "" } : null, title: r.track || "", played: r.played === 1, ts: r.ts });
        }
        st("INSERT OR REPLACE INTO listening_meta (k, v) VALUES ('historyRead', ?)").run(String(Date.now()));
      })();
      return found;
    }, null);
  }

  return { migrate, startPlay, endPlay, addAlbumPlay, playedKeysSince, anyPlayed, albumStats, albumPlayedSince,
    playedArtistRows, prune, fillKeys, readHistoryOnce };
}

module.exports = { createListeningStore };
