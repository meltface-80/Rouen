// @ts-check
"use strict";
/*
 * store.js — profiles (dev/design/profiles.md, 2.0.7-t2): the people listening under the one account, Guest, and whose
 * listening each zone counts for.
 *
 *   profiles       id, name, colour, made, roon_profile (§5, unused until P2). The first is made at the first start of
 *                  this version, named after the account, and stands for every play kept before it (a play row's
 *                  `profile` NULL), every zone not given one and every device that hasn't chosen. Removing it (only
 *                  while another exists) moves its plays, NULL ones included, and that role to the profile the removal
 *                  names (§9.3), kept in profiles_meta ("first"); until a removal, the first is the lowest id.
 *   zone_profiles  a zone's "Listening here counts for" (§4.2), by Roon's zone id with the zone's name: a profile's
 *                  id, or "guest" (no one). A zone not listed counts for the first profile.
 *
 * Guest is not a row: it is GUEST, always there, never renamed or removed, and its listening counts for no one, which
 * a play row keeps as profile ''.
 */

const GUEST = "guest";
const COLOURS = ["#5b8def", "#e0795a", "#4fb286", "#c768c4", "#d9a62e", "#5fb7c9", "#e05a8a", "#8a8f99"];
const MAX_NAME = 40;

/**
 * @typedef {{ id: string, name: string, colour: string, made: number, roon_profile: string | null, first: boolean }} Profile
 * @param {{ db: () => any, accountName: () => string, now?: () => number }} deps
 *   db: the labels database (plays live there too), or null when there is none
 */
function createProfileStore(deps) {
  const now = deps.now || Date.now;
  const db = () => {
    const d = deps.db();
    if (!d) throw new Error("History database unavailable");
    return d;
  };

  /** The tables, and the first profile when there is none. @param {any} d */
  function migrate(d) {
    d.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        colour TEXT NOT NULL,
        made INTEGER NOT NULL,
        roon_profile TEXT
      );
      CREATE TABLE IF NOT EXISTS zone_profiles (
        zone_id TEXT PRIMARY KEY,
        zone_name TEXT,
        profile TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS profiles_meta (k TEXT PRIMARY KEY, v TEXT);
    `);
    if (!d.prepare("SELECT 1 FROM profiles LIMIT 1").get()) {
      const name = cleanName(deps.accountName()) || "Me";
      d.prepare("INSERT INTO profiles (name, colour, made) VALUES (?,?,?)").run(name, COLOURS[0], now());
    }
  }

  /** @param {unknown} v */
  function cleanName(v) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, MAX_NAME); }

  /** Every profile, the first first, then by when they were made. @returns {Profile[]} */
  function list() {
    const d = db();
    const rows = d.prepare("SELECT id, name, colour, made, roon_profile FROM profiles ORDER BY id").all();
    const kept = d.prepare("SELECT v FROM profiles_meta WHERE k = 'first'").get();
    const firstId = kept && rows.some((/** @type {any} */ r) => String(r.id) === kept.v) ? kept.v : rows.length ? String(rows[0].id) : null;
    const out = rows.map((/** @type {any} */ r) => ({ id: String(r.id), name: r.name, colour: r.colour,
      made: r.made, roon_profile: r.roon_profile || null, first: String(r.id) === firstId }));
    return out.filter((p) => p.first).concat(out.filter((p) => !p.first));
  }

  /** The first profile. @returns {Profile} */
  function first() {
    const all = list();
    if (!all.length) throw new Error("no profile");   // migrate makes one, and the last can't be removed
    return all[0];
  }

  /** A profile by id, or null (Guest is not one). @param {unknown} id */
  function get(id) { return list().find((p) => p.id === String(id)) || null; }

  /** @param {string} name @param {string | null} except  the profile being renamed */
  function checkName(name, except) {
    if (!name) throw new Error("a profile needs a name");
    if (name.toLowerCase() === GUEST) throw new Error("Guest is always there");
    if (list().some((p) => p.id !== except && p.name.toLowerCase() === name.toLowerCase())) throw new Error("there is a profile called " + name + " already");
  }
  /** @param {unknown} c */
  function checkColour(c) {
    if (COLOURS.indexOf(String(c)) === -1) throw new Error("not one of the colours");
    return String(c);
  }

  /** A new profile. @param {unknown} name @param {unknown} [colour] @returns {Profile} */
  function add(name, colour) {
    const n = cleanName(name);
    checkName(n, null);
    const c = colour === undefined ? COLOURS[list().length % COLOURS.length] : checkColour(colour);
    const id = db().prepare("INSERT INTO profiles (name, colour, made) VALUES (?,?,?)").run(n, c, now()).lastInsertRowid;
    return /** @type {Profile} */ (get(id));
  }

  /** A profile renamed and/or recoloured, every field checked first. @param {unknown} id @param {{ name?: unknown, colour?: unknown }} patch */
  function update(id, patch) {
    const p = get(id);
    if (!p) throw new Error("no such profile");
    const name = patch.name === undefined ? p.name : cleanName(patch.name);
    if (patch.name !== undefined) checkName(name, p.id);
    const colour = patch.colour === undefined ? p.colour : checkColour(patch.colour);
    db().prepare("UPDATE profiles SET name = ?, colour = ? WHERE id = ?").run(name, colour, Number(p.id));
    return /** @type {Profile} */ (get(p.id));
  }

  /**
   * A profile removed, its listening moved to `moveTo` (§9.3), and the zones that counted for it counting for that one.
   * `tables`: every table with a `profile` column whose rows go with the listening (index.js: plays, album_plays).
   * @param {unknown} id @param {unknown} moveTo @param {string[]} tables
   */
  function remove(id, moveTo, tables) {
    const p = get(id);
    if (!p) throw new Error("no such profile");
    const to = get(moveTo);
    if (!to || to.id === p.id) throw new Error("choose the profile its listening moves to");
    const d = db();
    d.transaction(() => {
      for (const t of tables) {
        // The first profile also stands for the plays kept before profiles (NULL): they go with it.
        d.prepare(`UPDATE ${t} SET profile = ? WHERE profile = ?` + (p.first ? " OR profile IS NULL" : "")).run(to.id, p.id);
      }
      d.prepare("UPDATE zone_profiles SET profile = ? WHERE profile = ?").run(to.id, p.id);
      // The first's role (the zones not given one, the devices that haven't chosen) goes where its plays go.
      if (p.first) d.prepare("INSERT OR REPLACE INTO profiles_meta (k, v) VALUES ('first', ?)").run(to.id);
      d.prepare("DELETE FROM profiles WHERE id = ?").run(Number(p.id));
    })();
    return to;
  }

  /**
   * Whose listening a zone counts for: a profile's id, or GUEST. @param {string} zoneId
   * @returns {string}
   */
  function zoneProfile(zoneId) {
    const r = deps.db() ? db().prepare("SELECT profile FROM zone_profiles WHERE zone_id = ?").get(String(zoneId)) : null;
    if (r && (r.profile === GUEST || get(r.profile))) return r.profile;
    return first().id;
  }

  /** @param {string} zoneId @param {string} zoneName @param {unknown} profile  a profile's id or GUEST */
  function setZoneProfile(zoneId, zoneName, profile) {
    const v = String(profile);
    if (v !== GUEST && !get(v)) throw new Error("no such profile");
    if (!zoneId) throw new Error("zone required");
    db().prepare("INSERT OR REPLACE INTO zone_profiles (zone_id, zone_name, profile) VALUES (?,?,?)").run(String(zoneId), String(zoneName || ""), v);
  }

  return { migrate, list, first, get, add, update, remove, zoneProfile, setZoneProfile, COLOURS };
}

module.exports = { createProfileStore, GUEST, COLOURS };
