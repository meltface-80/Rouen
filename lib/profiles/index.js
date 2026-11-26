// @ts-check
"use strict";
/*
 * index.js — profiles, put together for Rouen's server (dev/design/profiles.md, 2.0.7-t2): the store, each device's
 * profile, whose a play is, and the routes. index.js holds one of these and wires it: `migrate` once the database is
 * open, `middleware` and `playStarts` after the login's guard, `mount` for the routes; the listening module asks
 * `whose` and `playing`, and every read made for a screen passes `viewer()`.
 */

const { createProfileStore, GUEST } = require("./store");
const { createProfileContext, asDevice, asHousehold, deviceRoon } = require("./context");
const { createRoonSync } = require("./roon-sync");
const { NOBODY, setHousehold } = require("../roon-direct/session");

/**
 * The routes where a device acts in Roon as its own (profiles.md §5, §13.2): hearts, add to library, Roon's Listen
 * later, and the album view, Shelf and Smart Picks that show them; as its paired Roon profile, or as NOBODY (Guest, or
 * none paired), never another's. Nothing else follows the device's Roon profile; what such a route sets going in the
 * background is the household's (index.js bgRun).
 */
const DEVICE_ROUTES = /^\/api\/(hearts\/(album|tracks)|library\/add|listen-later|album|shelf\/albums|smart-picks)$/;
const { createAttribution } = require("./attribution");
const { mountProfiles, playStarts } = require("./routes");

/** The tables whose rows are a profile's listening, moved with it when it is removed (§9.3). */
const LISTENING_TABLES = ["plays", "album_plays"];

/** How long a profile counts as in use for the daily Smart Picks build (§10.10). */
const ACTIVE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * @param {{ db: () => any, accountName: () => string, zone: (id: string) => any, changed: () => void,
 *   movers?: Array<(db: any, from: string, to: string) => void>, removed?: (from: string, to: string) => void,
 *   roonProfiles?: () => { profiles: Array<{ id: string, name: string }>, reread?: () => void } | null,
 *   log?: (line: string) => void, now?: () => number }} deps
 *   zone: a zone by its id, an output's or its name; changed: plays moved (index.js playsVersion); movers: the other
 *   tables a removed profile's rows go with (Smart Picks'); removed: a profile gone, after (its Tune moved)
 */
function createProfiles(deps) {
  const log = deps.log || (() => {});
  const store = createProfileStore({ db: deps.db, accountName: deps.accountName, now: deps.now });
  const context = createProfileContext({ store, guest: GUEST });
  const roonNow = () => (deps.roonProfiles ? deps.roonProfiles() : null);
  const sync = createRoonSync({ store, db: deps.db, roon: roonNow, log });
  // The household's Roon profile (§13.2): the one paired with Rouen's first profile, for what is no one's own.
  setHousehold(() => sync.household());
  const attribution = createAttribution({ guest: GUEST, now: deps.now, zoneProfile: (zid) => {
    // No database: plays aren't written either (listening store), so whose they would be is moot.
    try { return store.zoneProfile(zid); } catch (e) { log("[profiles] " + /** @type {Error} */ (e).message); return GUEST; }
  } });

  /** The first profile's id, or `none` without a database (every read then answers empty). @param {string} none */
  /** A profile, or null when the database can't be read: the request then acts as the household's. @param {string} id */
  const storeGet = (id) => { try { return store.get(id); } catch (e) { return null; } };   // no database: no link to read, so none
  const firstOr = (none) => { try { return store.first().id; } catch (e) { return none; } };   // no database: see above

  return {
    store, attribution,
    /** @param {any} db */
    migrate: (db) => store.migrate(db),
    /** The device's profile for the request; and, in its own routes, its Roon profile (§5). @param {any} req @param {any} res @param {() => void} next */
    middleware: (req, res, next) => context.middleware(req, res, () => {
      const path = String(req.path || String(req.url || "").split("?")[0]);
      if (!DEVICE_ROUTES.test(path) || !req.profile) return next();
      const p = req.profile === GUEST ? null : storeGet(req.profile);
      // Guest, a profile paired with none, or none to read: NOBODY, so nothing is done in Roon for someone else (§13.2).
      return asDevice(p && p.roon_profile ? p.roon_profile : NOBODY, next);
    }),
    playStarts: playStarts(attribution, (id) => deps.zone(id)),
    /** @param {any} app */
    mount: (app) => mountProfiles(app, { store, context, guest: GUEST, listeningTables: LISTENING_TABLES,
      zone: (id) => deps.zone(id), changed: deps.changed, movers: deps.movers, roonProfiles: deps.roonProfiles, sync,
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
     * The Roon profile (hex) the device being answered acts for, in its own routes (§13.2): its paired one, or NOBODY
     * (Guest, none paired); else null (another route, no request, no database): the household's.
     */
    roonOfRequest: deviceRoon,
    /**
     * fn run as `profile`'s devices act in Roon (§12, §13.2): for its paired Roon profile — a Smart Pick of its sent to
     * Listen later goes on its own Roon list — or as NOBODY when it has none; with no database, the household's.
     * @template T @param {string} profile @param {() => T} fn @returns {T}
     */
    asRoonOf: (profile, fn) => { const p = storeGet(profile); return !p ? fn() : asDevice(p.roon_profile || NOBODY, fn); },
    /** The profiles whose Smart Picks are built today (§10.10); none without a database (nothing could be kept). */
    picksProfiles: () => {
      try { return store.activeIds((deps.now || Date.now)() - ACTIVE_MS, LISTENING_TABLES); }
      catch (e) { return []; }   // no database: no build (its picks couldn't be kept), and the timer mustn't throw
    },
    /** The request's reads as a cache key's part: whose plays a cached view was counted for. */
    viewerKey: () => { const w = context.viewer(); return w ? w.id + (w.legacy ? "+" : "") : "*"; },
  };
}

module.exports = { createProfiles, asHousehold, LISTENING_TABLES, GUEST };
