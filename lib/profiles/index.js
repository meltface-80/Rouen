// @ts-check
"use strict";
/*
 * index.js — profiles, put together for Rouen's server (dev/design/profiles.md, 2.0.7-t2): the store, each device's
 * profile, whose a play is, and the routes. index.js holds one of these and wires it: `migrate` once the database is
 * open, `middleware` and `playStarts` after the login's guard, `mount` for the routes; the listening module asks
 * `whose` and `playing`, and every read made for a screen passes `viewer()`.
 */

const { createProfileStore, GUEST } = require("./store");
const { createProfileContext } = require("./context");
const { createAttribution } = require("./attribution");
const { mountProfiles, playStarts } = require("./routes");

/** The tables whose rows are a profile's listening, moved with it when it is removed (§9.3). */
const LISTENING_TABLES = ["plays", "album_plays"];

/** How long a profile counts as in use for the daily Smart Picks build (§10.10). */
const ACTIVE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * @param {{ db: () => any, accountName: () => string, zone: (id: string) => any, changed: () => void,
 *   movers?: Array<(db: any, from: string, to: string) => void>, removed?: (from: string, to: string) => void,
 *   roonProfiles?: () => { profiles: Array<{ id: string, name: string }>, chosen: string | null } | null,
 *   log?: (line: string) => void, now?: () => number }} deps
 *   zone: a zone by its id, an output's or its name; changed: plays moved (index.js playsVersion); movers: the other
 *   tables a removed profile's rows go with (Smart Picks'); removed: a profile gone, after (its Tune moved)
 */
function createProfiles(deps) {
  const log = deps.log || (() => {});
  const store = createProfileStore({ db: deps.db, accountName: deps.accountName, now: deps.now });
  const context = createProfileContext({ store, guest: GUEST });
  const attribution = createAttribution({ guest: GUEST, now: deps.now, zoneProfile: (zid) => {
    // No database: plays aren't written either (listening store), so whose they would be is moot.
    try { return store.zoneProfile(zid); } catch (e) { log("[profiles] " + /** @type {Error} */ (e).message); return GUEST; }
  } });

  /** The first profile's id, or `none` without a database (every read then answers empty). @param {string} none */
  const firstOr = (none) => { try { return store.first().id; } catch (e) { return none; } };   // no database: see above

  return {
    store, attribution,
    /** @param {any} db */
    migrate: (db) => store.migrate(db),
    middleware: context.middleware,
    playStarts: playStarts(attribution, (id) => deps.zone(id)),
    /** @param {any} app */
    mount: (app) => mountProfiles(app, { store, context, guest: GUEST, listeningTables: LISTENING_TABLES,
      zone: (id) => deps.zone(id), changed: deps.changed, movers: deps.movers, roonProfiles: deps.roonProfiles,
      removed: (id, to) => { attribution.forgetProfile(id); if (deps.removed) deps.removed(id, to); } }),
    whose: attribution.whose, playing: attribution.playing, forget: attribution.forget,
    viewer: context.viewer,
    /** Whose plays a profile's reads count (its id; '' Guest; the first's also the plays before profiles). @param {string} id */
    who: (id) => context.who(id),
    /**
     * Whose Smart Picks a profile reads: its own; none (no cookie, no database) the first's; Guest, nobody's (null: the
     * owner, 2026-11-26, "Nothing personal"). @param {string | null | undefined} p
     */
    picksOf: (p) => (p === GUEST ? null : !p ? firstOr("") : p),
    /** Whose Smart Picks a request changes: the device's profile's, or null on Guest. @param {any} req */
    owner: (req) => (req.profile === GUEST ? null : req.profile || firstOr("")),
    /**
     * The Roon profile (hex) linked to the asking device's profile (§5, 2.0.7-t4), or null (Guest, none linked, no
     * request, no database: native mode acts for the profile chosen in Settings → Native mode, the owner's "Act as the
     * first's").
     */
    roonOfRequest: () => {
      const w = context.viewer();
      if (!w || !w.id) return null;
      try { const p = store.get(w.id); return p ? p.roon_profile : null; }
      catch (e) { return null; }   // no database: see above
    },
    /** The profiles whose Smart Picks are built today (§10.10); none without a database (nothing could be kept). */
    picksProfiles: () => {
      try { return store.activeIds((deps.now || Date.now)() - ACTIVE_MS, LISTENING_TABLES); }
      catch (e) { return []; }   // no database: no build (its picks couldn't be kept), and the timer mustn't throw
    },
    /** The request's reads as a cache key's part: whose plays a cached view was counted for. */
    viewerKey: () => { const w = context.viewer(); return w ? w.id + (w.legacy ? "+" : "") : "*"; },
  };
}

module.exports = { createProfiles, LISTENING_TABLES, GUEST };
