"use strict";
// ---------------------------------------------------------------------------
// The profiles tests' world (profiles.test.js, profiles-roon.test.js): a database with plays, the listening store and
// the profiles, as index.js opens them, and the routes mounted on a stand-in app. Moved out unchanged in 2.0.8-t2, when
// the §13 tests took profiles.test.js past 500 lines.
// ---------------------------------------------------------------------------

const { createProfileStore, GUEST } = require("../../lib/profiles/store");
const { createProfileContext } = require("../../lib/profiles/context");
const { mountProfiles } = require("../../lib/profiles/routes");
const { createListeningStore } = require("../../lib/listening/store");
const { createRoonSync } = require("../../lib/profiles/roon-sync");

let Database = null;
try { Database = require("../../lib/sqlite-compat").adapterOver(require("node:sqlite")); } catch (e) {
  // node:sqlite is Node 22.5+'s; without it the database's tests skip, as a better-sqlite3 test does without its build
}
const PLAYS = `CREATE TABLE plays (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, zone TEXT, track TEXT,
  artist TEXT, album TEXT, image_key TEXT, duration INTEGER, completed INTEGER DEFAULT 0);`;

/** A database with plays, the listening store and the profiles, as index.js opens them. */
function world(account = "Alex") {
  const db = new Database(":memory:");
  db.exec(PLAYS);
  const plays = createListeningStore({ db: () => db });
  plays.migrate(db);
  const profiles = createProfileStore({ db: () => db, accountName: () => account, now: () => 1 });
  profiles.migrate(db);
  return { db, plays, profiles };
}

function routes(w, roonProfiles) {
  const r = {};
  const app = { get: (p, fn) => { r["GET " + p] = fn; }, post: (p, fn) => { r["POST " + p] = fn; } };
  const changed = [];
  const ctx = createProfileContext({ store: w.profiles, guest: GUEST });
  const zones = { z1: { zone_id: "z1", display_name: "Kitchen" } };
  mountProfiles(app, { store: w.profiles, context: ctx, guest: GUEST, listeningTables: ["plays", "album_plays"],
    zone: (id) => zones[id] || Object.values(zones).find((z) => z.display_name === id) || null, changed: () => changed.push(1),
    removed: (id) => changed.push("removed " + id), roonProfiles,
    sync: createRoonSync({ store: w.profiles, db: () => w.db, roon: () => (roonProfiles ? roonProfiles() : null) }) });
  const call = (key, { body, params, query, profile } = {}) => {
    let status = 200, out, headers = {};
    const res = { status: (s) => { status = s; return res; }, json: (b) => { out = b; }, setHeader: (k, v) => { headers[k] = v; } };
    r[key]({ body, params: params || {}, query: query || {}, profile, secure: false }, res);
    return { status, body: out, headers };
  };
  return { call, changed };
}

module.exports = { Database, PLAYS, world, routes };
