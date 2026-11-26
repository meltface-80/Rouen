// @ts-check
"use strict";
/*
 * index.js — profiles, put together for Rouen's server (dev/design/profiles.md, 2.0.7-t2): the store, each device's
 * profile, whose a play is, and the routes. index.js holds one of these and wires it: `migrate` once the database is
 * open, `middleware` and `playStarts` after the login's guard, `mount` for the routes; the listening module asks
 * `whose` and `touch`, and every read made for a screen passes `viewer()`.
 */

const { createProfileStore, GUEST } = require("./store");
const { createProfileContext } = require("./context");
const { createAttribution } = require("./attribution");
const { mountProfiles, playStarts } = require("./routes");

/** The tables whose rows are a profile's listening, moved with it when it is removed (§9.3). */
const LISTENING_TABLES = ["plays", "album_plays"];

/**
 * @param {{ db: () => any, accountName: () => string, zone: (id: string) => any, changed: () => void,
 *   log?: (line: string) => void, now?: () => number }} deps
 *   zone: a zone by its id, an output's or its name; changed: plays moved (index.js playsVersion)
 */
function createProfiles(deps) {
  const log = deps.log || (() => {});
  const store = createProfileStore({ db: deps.db, accountName: deps.accountName, now: deps.now });
  const context = createProfileContext({ store, guest: GUEST });
  const attribution = createAttribution({ guest: GUEST, now: deps.now, zoneProfile: (zid) => {
    // No database: plays aren't written either (listening store), so whose they would be is moot.
    try { return store.zoneProfile(zid); } catch (e) { log("[profiles] " + /** @type {Error} */ (e).message); return GUEST; }
  } });

  return {
    store, attribution,
    /** @param {any} db */
    migrate: (db) => store.migrate(db),
    middleware: context.middleware,
    playStarts: playStarts(attribution, (id) => deps.zone(id)),
    /** @param {any} app */
    mount: (app) => mountProfiles(app, { store, context, guest: GUEST, listeningTables: LISTENING_TABLES,
      zone: (id) => deps.zone(id), changed: deps.changed }),
    whose: attribution.whose, touch: attribution.touch, forget: attribution.forget,
    viewer: context.viewer,
    /** The request's reads as a cache key's part: whose plays a cached view was counted for. */
    viewerKey: () => { const w = context.viewer(); return w ? w.id + (w.legacy ? "+" : "") : "*"; },
  };
}

module.exports = { createProfiles, LISTENING_TABLES, GUEST };
