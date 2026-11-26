// @ts-check
"use strict";
/*
 * store.js — plays as dev/design/listening.md keeps them (§4), and the readers every screen counts plays with (§5).
 *
 *   plays          one row per track started (Recently played and the queue history read every row, as before), now
 *                  with `heard` (seconds listened), `played` (rule.js: 95%) and `album_key` (album-match.js: the
 *                  library album it was played from; '' when none could be named)
 *   album_plays    one row per album played (runs.js: every track played in one run)
 *   album_track_list  each album's tracks by position, under its key: what a run must hear. album_tracks (index.js)
 *                  cannot say it: it keeps one row per title, so two tracks of one title are one row there
 *   listening_meta this module's own bookkeeping: the last play row written before 2.0.6-t20 (`upgradeId`), and
 *                  whether the history has been read for album plays (§6)
 *
 * Plays from before 2.0.6-t20 never kept how long was heard, so they are read by the rule they were recorded under
 * (`completed`: 30 seconds heard and half the track or four minutes) as track plays, and once, when the track lists
 * their runs need have been read (listening.js), as album plays where a run of them covers the album (§6).
 *
 * Every reader answers empty rather than throwing when the database cannot be read (a disk error, a database a
 * restore is replacing): the screens show no plays rather than failing. Writes throw, for the caller to say.
 */

const { createRuns } = require("./runs");
const { RUN_GAP_MS } = require("./rule");

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
    // Silent: a reader's caller is a screen or a pick, which shows nothing played rather than failing; every write goes
    // through `st` directly and throws, so a failure that loses something is said by its caller.
    try { return fn(); } catch (e) { return none; }
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
      CREATE TABLE IF NOT EXISTS album_track_list (
        akey TEXT NOT NULL,
        n INTEGER NOT NULL,
        title TEXT NOT NULL,
        PRIMARY KEY (akey, n)
      );
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

  /**
   * An album's tracks, in order, as Roon listed them: kept whole, in place of what was kept before (a re-rip leaves no
   * phantom tracks). Nothing kept for an empty list.
   * @param {string} key @param {string[]} titles
   */
  function keepTrackList(key, titles) {
    if (!key || !titles.length) return;
    deps.db().transaction(() => {
      st("DELETE FROM album_track_list WHERE akey = ?").run(key);
      const ins = st("INSERT INTO album_track_list (akey, n, title) VALUES (?,?,?)");
      titles.forEach((t, n) => ins.run(key, n, String(t || "")));
    })();
  }

  /** An album's tracks as keepTrackList kept them, or [] when none are. @param {string} key */
  function trackList(key) {
    return read(() => st("SELECT n, title FROM album_track_list WHERE akey = ? ORDER BY n").all(key), []);
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

  /** Every album play, by the album's key: Smart Picks' seeds weigh each by its age (smart-picks.md §3.1). */
  function albumPlayRows() {
    return read(() => st("SELECT album_key key, ts FROM album_plays").all(), []);
  }

  /**
   * The tracks played outside any album's run (a playlist, Radio, shuffle across the library: smart-picks.md §3.1):
   * each one whose zone played no other track of its album just before or after it, within a run's gap (rule.js).
   * Tracks of a run that ended short are left out: they were an album sampled, never a preference.
   */
  function trackPlaysAlone() {
    return read(() => {
      const rows = st("SELECT ts, zone, album, album_key, artist, played FROM plays ORDER BY zone, ts, id").all();
      const group = (/** @type {any} */ r) => (r.album_key ? "k:" + r.album_key : r.album ? "t:" + String(r.album).toLowerCase() : null);
      const near = (/** @type {any} */ a, /** @type {any} */ b) => !!a && !!b && a.zone === b.zone && Math.abs(a.ts - b.ts) <= RUN_GAP_MS
        && group(a) !== null && group(a) === group(b);
      const out = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r.played !== 1 || near(r, rows[i - 1]) || near(r, rows[i + 1])) continue;
        out.push({ key: r.album_key || null, artist: String(r.artist || ""), ts: r.ts });
      }
      return out;
    }, []);
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
    if (!deps.db()) return 0;
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
  }

  /** Has the history been read for album plays (§6)? */
  function historyRead() { return !!meta("historyRead"); }

  /**
   * The albums the history (rows before 2.0.6-t20) holds a run of at least two played tracks of, and that have no track
   * list kept: what must be read before the history can be (listening.js). Most recent first.
   */
  function historyWanting() {
    if (!deps.db() || historyRead()) return [];
    const upgradeId = Number(meta("upgradeId")) || 0;
    const rows = st("SELECT ts, zone, album_key, played FROM plays WHERE id <= ? ORDER BY zone, ts, id").all(upgradeId);
    /** @type {Map<string, number>} key → its latest run's time */
    const want = new Map();
    let zone = null, key = null, last = 0, played = 0;
    for (const r of rows) {
      if (r.zone !== zone || r.album_key !== key || r.ts - last > RUN_GAP_MS) { zone = r.zone; key = r.album_key; played = 0; }
      last = r.ts;
      if (r.played === 1 && key && ++played >= 2) want.set(key, r.ts);
    }
    const has = st("SELECT 1 FROM album_track_list WHERE akey = ? LIMIT 1");
    return [...want].filter(([k]) => !has.get(k)).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }

  /**
   * Once: the plays from before 2.0.6-t20, read for album plays (§6). Their album keys must be filled first. The
   * number of album plays found, or null when it had run already.
   * @param {{ tracksOf: (key: string) => TrackRow[], trackKeys: (title: string) => string[],
   *   titleOf: (key: string) => { title: string, image_key: string | null } | null }} d
   */
  function readHistoryOnce(d) {
    if (!deps.db() || historyRead()) return null;
    const upgradeId = Number(meta("upgradeId")) || 0;
    let found = 0;
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
  }

  return { migrate, startPlay, endPlay, addAlbumPlay, keepTrackList, trackList, historyRead, historyWanting, playedKeysSince, anyPlayed, albumStats, albumPlayedSince,
    playedArtistRows, albumPlayRows, trackPlaysAlone, prune, fillKeys, readHistoryOnce };
}

module.exports = { createListeningStore };
