// @ts-check
"use strict";
/*
 * owners.js — whose each album on Listen later is (dev/design/profiles.md §12, §10.18–19, 2.0.7-t5).
 *
 * The list stays where it is (Roon's own with native mode in use, Rouen's own otherwise); this keeps, beside it, which
 * profile put each album aside: `listen_later_owners`, one row a profile an album. `profile` is a profile's id, or ''
 * for "shared" (put aside on Guest). `done` marks one that profile has played through: hidden from it, and kept, so an
 * album on Roon's list nobody else wanted doesn't become everyone's (only a removal by hand writes to Roon, §10.19).
 *
 * An album is matched by its key (Rouen's album key, the caller's: its library album's when the library has it), by its
 * own key (its strings', kept so a pick still matches once the library has it), or by Roon's AlbumId when both sides
 * have one. Who sees it:
 *   no row, or a shared row          everyone (Guest included): the household's
 *   otherwise                         each profile with a row not played through
 * A viewer of null (no request: a build, a timer) sees everything, as before profiles.
 */

/**
 * @typedef {{ key: string, alt: string | null, profile: string, album_id: string | null, title: string, artist: string, source: string, ts: number, done: number }} Tag
 * @typedef {{ key: string, alt?: string | null, albumId?: string | null }} Album  an album as the list names it: key, its
 *   own key when that differs (tagKey's second), and Roon's AlbumId
 */

const DDL = `CREATE TABLE IF NOT EXISTS listen_later_owners (
  key      TEXT NOT NULL,
  alt      TEXT,
  profile  TEXT NOT NULL,
  album_id TEXT,
  title    TEXT NOT NULL DEFAULT '',
  artist   TEXT NOT NULL DEFAULT '',
  source   TEXT NOT NULL DEFAULT 'album',
  ts       INTEGER NOT NULL,
  done     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, profile)
);`;

/** @param {Tag[]} rows @param {string | null} viewer */
function seenIn(rows, viewer) {
  if (viewer === null || !rows.length) return true;
  return rows.some((r) => !r.done && (r.profile === "" || r.profile === viewer));
}

/**
 * @param {{ db: () => any, now?: () => number }} d  db: the labels database, or null (then every album is everyone's
 *   and nothing is kept)
 */
function createLaterOwners(d) {
  const now = d.now || Date.now;

  /** Every tag, read once. @returns {Tag[]} */
  function all() {
    const db = d.db();
    if (!db) return [];
    return db.prepare("SELECT key, alt, profile, album_id, title, artist, source, ts, done FROM listen_later_owners").all();
  }
  /** The tags naming an album: by either of its keys, or Roon's AlbumId. @param {Album} a @param {Tag[]} [rows] */
  const tagsOf = (a, rows) => (rows || all()).filter((r) => r.key === a.key || r.alt === a.key || (!!a.alt && (r.key === a.alt || r.alt === a.alt))
    || (!!a.albumId && r.album_id === a.albumId));

  /**
   * Who sees what, from one read: a test for each album on the list. @param {string | null} viewer  a profile's id, ''
   * on Guest, null outside a request @returns {(a: Album) => boolean}
   */
  function viewFor(viewer) {
    if (viewer === null) return () => true;
    const rows = all();
    return (a) => seenIn(tagsOf(a, rows), viewer);
  }

  /**
   * Put aside by `viewer` ('' on Guest: shared): its tag, shown again if it had played the album through. `source`:
   * "picks" for a Smart Pick sent there (only those leave with "Not for me"), else "album".
   * @param {string | null} viewer @param {Album & { title?: string, artist?: string }} a @param {string} [source]
   */
  function claim(viewer, a, source) {
    const db = d.db();
    if (!db || viewer === null) return;
    // Put aside again: shown again, its AlbumId kept if this time has none, and a pick stays a pick (the review).
    db.prepare(`INSERT INTO listen_later_owners (key, alt, profile, album_id, title, artist, source, ts, done) VALUES (?,?,?,?,?,?,?,?,0)
      ON CONFLICT (key, profile) DO UPDATE SET alt = COALESCE(excluded.alt, alt), album_id = COALESCE(excluded.album_id, album_id),
        source = CASE WHEN source = 'picks' THEN 'picks' ELSE excluded.source END, ts = excluded.ts, done = 0`)
      .run(a.key, a.alt && a.alt !== a.key ? a.alt : null, viewer, a.albumId || null, String(a.title || ""), String(a.artist || ""),
        source === "picks" ? "picks" : "album", now());
  }

  /**
   * Whether an album is the household's: no tag, or a shared one not played through. @param {Album} a
   * @param {Tag[]} [rows]  every tag, read once by a caller asking of many albums
   */
  function household(a, rows) {
    const mine = tagsOf(a, rows);
    return !mine.length || mine.some((r) => r.profile === "" && !r.done);
  }

  /**
   * Tags of albums on neither list any more (taken off in Roon's own app, or gone with Rouen's own list's move): gone,
   * so the album put there again by Roon's app is everyone's, as §12 says. Asked only after a whole read of the list.
   * @param {(t: Tag) => boolean} onAList  whether the tag's album is on Roon's list or Rouen's own
   */
  function prune(onAList) {
    const db = d.db();
    if (!db) return 0;
    let n = 0;
    for (const r of all()) if (!onAList(r)) { db.prepare("DELETE FROM listen_later_owners WHERE key = ? AND profile = ?").run(r.key, r.profile); n++; }
    return n;
  }

  /**
   * Taken off by hand by `viewer`: whether the album leaves the list itself (shared, or no one else has it: the caller
   * takes it off, then forget()s its tags, so one that couldn't be taken off keeps them), or only `viewer`'s tag goes
   * and it stays for the others. @param {string | null} viewer @param {Album} a @returns {boolean}
   */
  function release(viewer, a) {
    const db = d.db();
    if (!db) return true;
    const rows = tagsOf(a);
    const shared = !rows.length || rows.some((r) => r.profile === "" && !r.done);
    const others = rows.filter((r) => r.profile !== viewer && r.profile !== "" && !r.done);
    if (!shared && viewer !== null && others.length) {
      for (const r of rows.filter((x) => x.profile === viewer)) db.prepare("DELETE FROM listen_later_owners WHERE key = ? AND profile = ?").run(r.key, r.profile);
      return false;
    }
    return true;
  }

  /** An album gone from the list: its tags with it. @param {Album} a @param {Tag[]} [rows] */
  function forget(a, rows) {
    const db = d.db();
    if (!db) return;
    for (const r of rows || tagsOf(a)) db.prepare("DELETE FROM listen_later_owners WHERE key = ? AND profile = ?").run(r.key, r.profile);
  }

  /**
   * `profile`'s tag on an album marked played through (or its pick discarded): hidden from it, kept. Whether anyone
   * still sees the album afterwards by a tag of theirs (another profile's, or shared); null when it had no tag at all
   * (the household's: the caller's rule for shared albums applies). @param {string} profile @param {Album} a
   * @returns {boolean | null}
   */
  function hide(profile, a) {
    const db = d.db();
    if (!db) return null;
    const rows = tagsOf(a);
    if (!rows.length) return null;
    for (const r of rows.filter((x) => x.profile === profile)) db.prepare("UPDATE listen_later_owners SET done = 1 WHERE key = ? AND profile = ?").run(r.key, r.profile);
    return rows.some((r) => r.profile !== profile && !r.done);
  }

  /** The tags `profile` has and hasn't played through: what its plays are checked against. @param {string} profile @returns {Tag[]} */
  const open = (profile) => all().filter((r) => r.profile === profile && !r.done);

  /**
   * A profile removed (§9.3): its tags to `to`, where `to` has the album its own is kept — shown again when the removed
   * profile still wanted it and `to` had played it through (the review: else it was hidden from everyone).
   * @param {string} from @param {string} to
   */
  function moveProfile(from, to) {
    const db = d.db();
    if (!db) return;
    db.prepare("UPDATE listen_later_owners SET done = 0 WHERE profile = ? AND done = 1 AND key IN (SELECT key FROM listen_later_owners WHERE profile = ? AND done = 0)").run(to, from);
    db.prepare("UPDATE OR IGNORE listen_later_owners SET profile = ? WHERE profile = ?").run(to, from);
    db.prepare("DELETE FROM listen_later_owners WHERE profile = ?").run(from);
  }

  /** For the backup's "later" part. */
  const exportAll = () => all();
  /**
   * A backup's tags, in place of these (the list itself is restored beside them). A tag naming a profile this install
   * hasn't (a backup from elsewhere, or from before a removal) is left out: it would hide its album from everyone.
   * @param {unknown} rows @param {(profile: string) => boolean} [known]  whether a profile id is one here ('' always is)
   */
  function restoreAll(rows, known) {
    const db = d.db();
    if (!db) return;
    const ok = (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r.key === "string" && r.key && typeof r.profile === "string"
      && (r.profile === "" || !known || known(r.profile)));
    db.transaction(() => {
      db.prepare("DELETE FROM listen_later_owners").run();
      const ins = db.prepare("INSERT OR IGNORE INTO listen_later_owners (key, alt, profile, album_id, title, artist, source, ts, done) VALUES (?,?,?,?,?,?,?,?,?)");
      for (const r of ok) {
        ins.run(r.key, typeof r.alt === "string" ? r.alt : null, r.profile, typeof r.album_id === "string" ? r.album_id : null,
          String(r.title || ""), String(r.artist || ""), r.source === "picks" ? "picks" : "album", Number(r.ts) || now(), r.done ? 1 : 0);
      }
    })();
  }

  return { migrate: (/** @type {any} */ db) => db.exec(DDL), viewFor, claim, household, prune, release, forget, hide, open, moveProfile, exportAll, restoreAll };
}

/** The strings' own key (no library album): what a tag also keeps, so it still matches once the library has the album. */
const ownKey = (/** @type {(t: string, a: string) => string | null} */ keyOf, /** @type {string} */ title, /** @type {string} */ artist) =>
  keyOf(title, artist) || "=" + (title + "||" + artist).toLowerCase();

/**
 * An album's key as its tags name it, for the routes and the store alike: its library album's key when the library has
 * it, else its own, else as written ("+", which Rouen's key can't name).
 * @param {{ title: string, subtitle: string } | null} rec  the library album the strings name now
 * @param {(title: string, artist: string) => string | null} keyOf  Rouen's album key @param {string} title @param {string} artist
 */
function tagKey(rec, keyOf, title, artist) {
  return (rec && keyOf(rec.title, rec.subtitle)) || ownKey(keyOf, title, artist);
}

module.exports = { createLaterOwners, seenIn, tagKey, ownKey, DDL };
