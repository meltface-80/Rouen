// @ts-check
"use strict";
/*
 * store.js — Rouen's own Listen later list (v1.8.67): how it is stored, matched and emptied. Moved out of index.js
 * unchanged in 2.0.7-t5, with the backup's restore of it (backupRestoreLater). The table (`listen_later`) is still
 * created by index.js's openLabelsDb; its routes are lib/routes/listen-later.js, and Roon's own list, used in its
 * place with native mode on, is lib/roon-direct/later.js. Whose each entry is (2.0.7-t5, profiles.md §12) is
 * lib/listen-later/owners.js: a profile's "played through", "Not for me" and discarded picks hide its own tags, and
 * an entry leaves this list only once no one else has it.
 *
 * Ported from Mandarin, which grew out of this extension and has had it since
 * its v0.5.28. Roon's own Listen later is not reachable through the extension
 * API, so this is the extension's own list, kept on the data volume.
 *
 * WHAT AN ENTRY IS. An album identity (albumKey) plus the strings it was put
 * aside under — never an offset, which is a position in a list that reshuffles
 * on every library change. Resolved against the snapshot at READ time
 * (smartLibraryRecord, the same tolerant albumKeys match the Smart Picks use),
 * so an entry follows its album through a rescan, and an entry for an album
 * Roon does not have yet — a Smart Pick sent here instead of to the streaming
 * library — becomes playable the moment Roon imports it, with nothing written.
 *
 * HOW AN ENTRY LEAVES. By hand, or once the album has been played since it was
 * put aside — every track of it, 95% each, in one run, on any zone, from any app
 * (dev/design/listening.md, 2.0.6-t20). "Every track" is read from album_tracks,
 * which Rouen fills when it opens an album, and reads for itself the first time
 * a track of one it has never opened is played; an album it still has no list
 * for stays until it is taken off by hand rather than leaving on a guess.
 */

const { tagKey, ownKey } = require("./owners");

/**
 * @typedef {{ key: string, title: string, artist: string, service: string | null, album_id: string | null,
 *   image: string | null, source: string, ts: number }} Row  a row of `listen_later`
 * @typedef {{ title: string, subtitle: string, offset?: number }} LibraryAlbum  an album of the library snapshot
 */

/**
 * @param {{
 *   db: () => any,
 *   bump: () => void,
 *   frozen: () => boolean,
 *   albumKey: (title: string, artist: string) => string | null,
 *   canonText: (s: string) => string,
 *   canonArtist: (s: string) => string,
 *   exact: { find: (title: string, artist: string) => any },
 *   tolerant: (title: string, artist: string) => any,
 *   listening: { albumPlayedSince: (key: string, since: number, who?: { id: string, legacy: boolean }) => boolean },
 *   listenKey: (al: { title: string, subtitle: string }) => string | null,
 *   qobuzDeep: { deepLink: (id: string) => string },
 *   log?: { log: (msg: string) => void, error: (msg: string) => void },
 *   owners?: ReturnType<typeof import("./owners").createLaterOwners>,
 * }} d
 *   db: the labels database, or null (read on every call: it opens after start-up). bump: the list changed (index.js's
 *   `later` revision, which the screens follow). frozen: restarting after a restore, when the list on disk is the
 *   restored one. exact / tolerant: the library album a title and credit name, exactly (lib/library-exact.js) and
 *   by any albumKeys identity (index.js smartLibraryRecord). listening: the plays (lib/listening/). log: console.
 *   owners: whose each entry is (none: every entry is everyone's, as before profiles).
 */
function createLaterStore(d) {
  const log = d.log || console;
  const owners = d.owners || null;
  /** An album as its tags name it (owners.js). @param {string} title @param {string} artist @param {string | null} [albumId] */
  const albumOf = (title, artist, albumId) => ({ key: tagKey(libraryRecord(title, artist), d.albumKey, title, artist),
    alt: ownKey(d.albumKey, title, artist), albumId: albumId || null });
  /**
   * The household's (no tag, or shared: the rules from before profiles apply), against the tags read once for a pass
   * (the review: not a read a row). @param {any[] | null} tags @returns {(a: { key: string, albumId: string | null }) => boolean}
   */
  const householdIn = (tags) => (a) => !owners || owners.household(a, tags || undefined);
  const tagsOnce = () => (owners ? owners.exportAll() : null);
  /**
   * A tagged entry's profile let go of (its "Not for me", its discarded day): its tag hidden; off this list, with its
   * tags, only when no one else has it. Whether it went. @param {Row} r @param {string} profile @param {any} del
   */
  const letGo = (r, profile, del) => {
    const a = albumOf(r.title, r.artist);
    if (/** @type {any} */ (owners).hide(profile, a) === true) return false;   // another profile's still
    if (!del.run(r.key).changes) return false;
    /** @type {any} */ (owners).forget(a);
    return true;
  };
  /** The profile's own Smart Pick tags naming `match` hidden, wherever the album is (Roon's list is never changed). @param {string} profile @param {(t: any) => boolean} match */
  const hidePicks = (profile, match) => {
    let n = 0;
    if (owners) for (const t of owners.open(profile)) if (t.source === "picks" && match(t)) { owners.hide(profile, { key: t.key, albumId: t.album_id }); n++; }
    return n;
  };

  /** The services an entry may name. @returns {string[]} */
  function services() { return ["qobuz", "tidal"]; }
  /** Where an entry may have come from. @returns {string[]} */
  function sources()  { return ["album", "picks"]; }

  /** Every entry, newest first. @returns {Row[]} */
  function rows() {
    const db = d.db();
    if (!db) return [];
    try {
      return db.prepare("SELECT * FROM listen_later ORDER BY ts DESC").all();
    } catch (e) {
      log.error("[later] read failed: " + e.message);
      return [];
    }
  }

  /**
   * The library album `title`/`artist` names right now, or null: the exact edition first (lib/library-exact.js,
   * which says why), then the tolerant match. @param {string} title @param {string} artist
   */
  function libraryRecord(title, artist) {
    if (!title) return null;
    return d.exact.find(title, artist) || d.tolerant(title, artist);
  }

  /** The library record an entry stands for right now, or null. @param {Row} row */
  function record(row) {
    return libraryRecord(row.title, row.artist);
  }

  /**
   * Every key that names the same album as `title`/`artist`: its own identity
   * and, when it resolves to a library record, that record's identity — so an
   * entry stored under a service's spelling ("Album (Deluxe)") is found from
   * Roon's ("Album"), and the other way round. @param {string} title @param {string} artist
   */
  function keysFor(title, artist) {
    const keys = new Set();
    const own = d.albumKey(title, artist);
    if (own) keys.add(own);
    const rec = libraryRecord(title, artist);
    if (rec) {
      const k = d.albumKey(rec.title, rec.subtitle);
      if (k) keys.add(k);
    }
    return keys;
  }

  /**
   * The rows that name the album `title`/`artist`, compared in BOTH directions
   * (see keysFor). @param {string} title @param {string} artist @param {Row[]} [list]  the rows, when already read
   * @returns {Row[]}
   */
  function matches(title, artist, list) {
    const want = keysFor(title, artist);
    if (!want.size) return [];
    return (list || rows()).filter(r => {
      if (want.has(r.key)) return true;
      const rec = record(r);
      return !!(rec && want.has(d.albumKey(rec.title, rec.subtitle)));
    });
  }

  /**
   * Put an album aside. Returns true when it is on the list afterwards (whether
   * or not it already was), false when it could not be stored. Adding an album
   * already on the list keeps its original date: "newest first" means when it
   * was first put aside, and a second tap must not move it to the front.
   * @param {{ title?: string, artist?: string, service?: string, album_id?: string, image?: string, source?: string }} entry
   */
  function add(entry) {
    const db = d.db();
    if (!db || !entry) return false;
    if (d.frozen()) return false;   // restarting after a restore: the list on disk is the restored one
    const title  = String(entry.title || "").trim().slice(0, 300);
    const artist = String(entry.artist || "").trim().slice(0, 300);
    const key = d.albumKey(title, artist);
    if (!key) return false;
    if (matches(title, artist).length) return true;
    const service = services().indexOf(entry.service) !== -1 ? entry.service : null;
    const albumId = service && entry.album_id ? String(entry.album_id).slice(0, 64) : null;
    // A cover URL is shown in an <img>, so only a plain http(s) address is kept.
    const image = /^https?:\/\//i.test(String(entry.image || "")) ? String(entry.image).slice(0, 1000) : null;
    const source = sources().indexOf(entry.source) !== -1 ? entry.source : "album";
    try {
      const info = db.prepare(
        "INSERT OR IGNORE INTO listen_later (key, title, artist, service, album_id, image, source, ts) " +
        "VALUES (?,?,?,?,?,?,?,?)").run(key, title, artist, service, albumId, image, source, Date.now());
      // Only a row actually written moves the revision: a spurious move makes
      // every device re-read the row and both screens for nothing.
      if (info.changes) d.bump();
      return true;
    } catch (e) {
      log.error("[later] could not add " + JSON.stringify(title) + ": " + e.message);
      return false;
    }
  }

  /**
   * Take an album off the list — every row that names it, so an album put aside
   * twice under two spellings does not survive its own removal. Returns how many
   * rows went. @param {string} title @param {string} artist @returns {number}
   */
  function remove(title, artist) {
    const db = d.db();
    if (!db) return 0;
    const found = matches(title, artist);
    if (!found.length) return 0;
    try {
      const del = db.prepare("DELETE FROM listen_later WHERE key = ?");
      db.transaction(() => { for (const r of found) del.run(r.key); })();
      d.bump();
      return found.length;
    } catch (e) {
      log.error("[later] could not remove " + JSON.stringify(title) + ": " + e.message);
      return 0;
    }
  }

  /**
   * "Not for me" on a Smart Pick means the artist, everywhere: every entry that
   * came from Smart Picks for them goes too — whether the build sent it here or
   * the pick's own "＋ Listen later" did, since both are the recommender's
   * suggestion. An album put aside from the album view (source "album") stays:
   * that was the user's own find, not a pick. With profiles (2.0.7-t5, profiles.md §12), the profile's own picks:
   * another profile's stay. @param {string} canon  the act, canonArtist'd
   * @param {string} [profile]  whose "Not for me" (none: everyone's picks, as before profiles) @returns {number}
   */
  function forgetPickArtist(canon, profile) {
    const db = d.db();
    if (!db || !canon) return 0;
    let n = 0;
    // The entry carries the SERVICE's credit, which can name the blocked act
    // alongside others ("Khruangbin & Leon Bridges") — so any credited act
    // counts, split the way albumKeys splits a credit.
    const credits = (/** @type {string} */ artist) => [artist].concat(String(artist || "").split(/ \/ |\/| feat\.? | featuring | ft\.? |, | & | \+ /i))
      .some(a => d.canonArtist(a) === canon);
    try {
      const del = db.prepare("DELETE FROM listen_later WHERE key = ?");
      const household = householdIn(tagsOnce());
      for (const r of rows()) {
        if (r.source !== "picks" || !credits(r.artist)) continue;
        // Whose (profiles.md §12): a profile's "Not for me" lets go of its own picks only.
        if (profile !== undefined && !household(albumOf(r.title, r.artist))) { if (letGo(r, profile, del)) n++; continue; }
        if (del.run(r.key).changes) n++;
      }
      if (profile !== undefined) n += hidePicks(profile, (t) => credits(t.artist));
      if (n) d.bump();
    } catch (e) {
      log.error("[later] could not drop picks by a blocked artist: " + e.message);
    }
    return n;
  }

  /**
   * The entries a day's Smart Picks put here, by the service album each names.
   * Called when that day's set is discarded and rebuilt: the profile's picks of the day only (2.0.7-t3, the review),
   * and, tagged, only the profile's own tag on them (2.0.7-t5, profiles.md §12).
   * @param {string} day @param {string} profile @returns {number}
   */
  function forgetPicksOfDay(day, profile) {
    const db = d.db();
    if (!db) return 0;
    try {
      const del = db.prepare("DELETE FROM listen_later WHERE key = ?");
      const household = householdIn(tagsOnce());
      let n = 0;
      for (const r of /** @type {Row[]} */ (db.prepare(
        "SELECT * FROM listen_later WHERE source = 'picks' AND album_id IS NOT NULL AND " +
        "EXISTS (SELECT 1 FROM smart_picks p WHERE p.day = ? AND p.profile = ? AND p.service = listen_later.service " +
        "AND p.album_id = listen_later.album_id)").all(day, profile))) {
        if (!household(albumOf(r.title, r.artist))) { if (letGo(r, profile, del)) n++; continue; }
        if (del.run(r.key).changes) n++;
      }
      // Its picks of the day on Roon's list: its tags hidden, the list itself untouched.
      const keys = new Set(db.prepare("SELECT album, artist FROM smart_picks WHERE day = ? AND profile = ?").all(day, profile)
        .map((/** @type {any} */ p) => albumOf(p.album || "", p.artist).key));
      n += hidePicks(profile, (t) => keys.has(t.key));
      if (n) d.bump();
      return n;
    } catch (e) {
      log.error("[later] could not drop the discarded day's picks: " + e.message);
      return 0;
    }
  }

  /**
   * Has the album filed under `akey` been played — every track of it, 95% each, in one run (dev/design/listening.md,
   * 2.0.6-t20) — since `since`? False whenever it cannot be shown to be true, including an album whose track list Rouen
   * has not kept (lib/listening/runs.js reads it the first time a track of it is played).
   * @param {string | null} akey @param {number} since
   */
  function playedThrough(akey, since) {
    return !!d.db() && !!akey && d.listening.albumPlayedSince(akey, since);
  }

  /**
   * Called when an album is played (lib/listening/listening.js), with whose the play was. Only an entry whose title is
   * the one just played is examined. A profile's own (profiles.md §12): hidden from it once it has played it through
   * since putting it aside, and off this list once no one else has it; never off Roon's (§10.19). The household's:
   * as before. @param {string} albumTitle @param {string | null} [profile]
   */
  function noticePlay(albumTitle, profile) {
    const db = d.db();
    if (!db || d.frozen()) return;   // frozen: restarting after a restore, the list on disk is the restored one
    const want = d.canonText(albumTitle);
    if (!want) return;
    try {
      const del = db.prepare("DELETE FROM listen_later WHERE key = ?");
      if (owners && profile) {
        for (const t of owners.open(profile)) {
          const rec = libraryRecord(t.title, t.artist);
          const title = rec ? rec.title : t.title;
          if (d.canonText(title) !== want) continue;
          const akey = d.listenKey({ title, subtitle: rec ? rec.subtitle : t.artist });
          if (!akey || !d.listening.albumPlayedSince(akey, t.ts, { id: profile, legacy: false })) continue;
          const others = owners.hide(profile, { key: t.key, albumId: t.album_id });
          d.bump();
          log.log("[later] " + JSON.stringify(title) + " played through — off this profile's Listen later");
          // No one else's: off Rouen's own list, and its tags with it, so the album put back later (in Roon's own app,
          // say) is everyone's again (the review). On Roon's list it stays, and its played-through tag keeps it hidden.
          if (others === false) {
            for (const r of rows()) if (albumOf(r.title, r.artist).key === t.key && del.run(r.key).changes) owners.forget({ key: t.key, albumId: t.album_id });
          }
        }
      }
      const household = householdIn(tagsOnce());
      for (const row of rows()) {
        if (!household(albumOf(row.title, row.artist))) continue;   // a profile's own: above
        const rec = record(row);
        const title = rec ? rec.title : row.title;
        if (d.canonText(title) !== want) continue;
        const akey = d.listenKey({ title, subtitle: rec ? rec.subtitle : row.artist });
        if (!playedThrough(akey, row.ts)) continue;
        if (!del.run(row.key).changes) continue;
        d.bump();
        log.log("[later] " + JSON.stringify(title) + " played through — off the Listen later list");
      }
    } catch (e) {
      // Logged, not thrown: this runs inside the zone-event handler, and a
      // failure here must cost the list its tidy-up, never playback tracking.
      log.error("[later] play check failed: " + e.message);
    }
  }

  /**
   * Where a service-only entry can be opened, for listening before deciding.
   * @param {string | null} service @param {string | null} albumId @returns {string | null}
   */
  function serviceUrl(service, albumId) {
    if (!albumId) return null;
    if (service === "qobuz") return d.qobuzDeep.deepLink(albumId);
    if (service === "tidal") return "https://tidal.com/browse/album/" + encodeURIComponent(albumId);
    return null;
  }

  /**
   * The Listen later part of a backup, put back (index.js backupRestoreLater until 2.0.7-t5). The key is worked out
   * again from title and artist rather than taken from the file, so a backup made by a build that keyed albums
   * differently still lands where today's lookups will look. Throws when there is no database.
   * @param {any[]} list  the backup's rows
   */
  function restore(list) {
    const db = d.db();
    if (!db) throw new Error("The database is not available");
    const ins = db.prepare(
      "INSERT OR IGNORE INTO listen_later (key, title, artist, service, album_id, image, source, ts) " +
      "VALUES (?,?,?,?,?,?,?,?)");
    db.transaction(() => {
      db.prepare("DELETE FROM listen_later").run();
      for (const r of list) {
        if (!r || typeof r !== "object") continue;
        const title  = String(r.title || "").trim().slice(0, 300);
        const artist = String(r.artist || "").trim().slice(0, 300);
        const key = d.albumKey(title, artist);
        if (!key) continue;
        const service = services().indexOf(r.service) !== -1 ? r.service : null;
        const albumId = service && r.album_id ? String(r.album_id).slice(0, 64) : null;
        const image = /^https?:\/\//i.test(String(r.image || "")) ? String(r.image).slice(0, 1000) : null;
        const source = sources().indexOf(r.source) !== -1 ? r.source : "album";
        const ts = Number.isFinite(Number(r.ts)) && Number(r.ts) > 0 ? Math.floor(Number(r.ts)) : Date.now();
        ins.run(key, title, artist, service, albumId, image, source, ts);
      }
    })();
    d.bump();
  }

  return { services, sources, rows, libraryRecord, record, keysFor, matches, add, remove, forgetPickArtist,
    forgetPicksOfDay, playedThrough, noticePlay, serviceUrl, restore };
}

module.exports = { createLaterStore };
