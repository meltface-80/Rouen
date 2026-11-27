// @ts-check
"use strict";
/*
 * tables.js — Smart Picks' own tables, each profile's (dev/design/profiles.md §3, P1b, 2.0.7-t3). Moved out of
 * index.js's schema with the profile added to each key:
 *
 *   smart_picks        the picks of a day, by profile: stored rather than recomputed, so a set is stable for whoever
 *                      looks at it and a restart does not hand anybody a different day's picks
 *   smart_pick_seen    the artists already shown to a profile, so its set turns over instead of repeating
 *   smart_pick_blocks  a profile's "Not for me": an EXPLICIT tap only, and permanent. Silence is never recorded: the
 *                      premise is albums the listener would not otherwise reach for, so treating no response as a
 *                      rejection would empty the pool within a week
 *
 * An install from before profiles has the tables without `profile`: SQLite can't change a key in place, so each is
 * made again with it and its rows copied in as the first profile's, once, each table in a transaction of its own (a
 * crash leaves each either as it was or done). `profile` has no default: a write that forgot it fails, rather than
 * landing under no one, never to be read. The last build's Why these picks (smart_cache "why") becomes the first's.
 */

const DDL = {
  smart_picks: `CREATE TABLE IF NOT EXISTS smart_picks (
        profile  TEXT NOT NULL,
        day      TEXT NOT NULL,
        kind     TEXT NOT NULL,
        rank     INTEGER NOT NULL,
        mbid     TEXT,
        artist   TEXT NOT NULL,
        canon    TEXT NOT NULL,
        album    TEXT,
        album_id TEXT,
        service  TEXT,
        image    TEXT,
        reason   TEXT,
        genre    TEXT,
        ts       INTEGER NOT NULL,
        PRIMARY KEY (profile, day, kind, rank)
      );`,
  smart_pick_seen: `CREATE TABLE IF NOT EXISTS smart_pick_seen (
        profile TEXT NOT NULL,
        canon   TEXT NOT NULL,
        ts      INTEGER NOT NULL,
        PRIMARY KEY (profile, canon)
      );`,
  smart_pick_blocks: `CREATE TABLE IF NOT EXISTS smart_pick_blocks (
        profile TEXT NOT NULL,
        canon   TEXT NOT NULL,
        name    TEXT,
        ts      INTEGER NOT NULL,
        PRIMARY KEY (profile, canon)
      );`,
};
const COLUMNS = {
  smart_picks: "day, kind, rank, mbid, artist, canon, album, album_id, service, image, reason, genre, ts",
  smart_pick_seen: "canon, ts",
  smart_pick_blocks: "canon, name, ts",
};

/**
 * The tables, made, or made again with `profile` (their rows the first profile's). @param {any} db
 * @param {string} firstId  the first profile's id (lib/profiles/store.js)
 */
function migrate(db, firstId) {
  // Why these picks, kept under one key before profiles: the first profile's now (smart_cache is index.js's, made first).
  db.prepare("UPDATE OR IGNORE smart_cache SET key = ? WHERE key = 'why'").run("why:" + firstId);
  for (const t of /** @type {Array<keyof typeof DDL>} */ (Object.keys(DDL))) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((/** @type {any} */ c) => c.name);
    if (!cols.length) { db.exec(DDL[t]); continue; }
    if (cols.includes("profile")) continue;
    db.transaction(() => {
      db.exec(`ALTER TABLE ${t} RENAME TO ${t}_before_profiles`);
      db.exec(DDL[t]);
      db.prepare(`INSERT OR IGNORE INTO ${t} (profile, ${COLUMNS[t]}) SELECT ?, ${COLUMNS[t]} FROM ${t}_before_profiles`).run(firstId);
      db.exec(`DROP TABLE ${t}_before_profiles`);
    })();
  }
}

/**
 * A profile removed (§9.3): its "Not for me" and the artists already shown go to `to` (where `to` has its own, its
 * own is kept); its picks go, as a day's picks are its own and `to` has its own set.
 * @param {any} db @param {string} from @param {string} to
 */
function moveProfile(db, from, to) {
  db.prepare("DELETE FROM smart_picks WHERE profile = ?").run(from);
  for (const t of ["smart_pick_seen", "smart_pick_blocks"]) {
    db.prepare(`UPDATE OR IGNORE ${t} SET profile = ? WHERE profile = ?`).run(to, from);
    db.prepare(`DELETE FROM ${t} WHERE profile = ?`).run(from);
  }
}

module.exports = { DDL, migrate, moveProfile };
