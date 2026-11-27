// @ts-check
"use strict";
/*
 * context.js — each device's profile (dev/design/profiles.md §2, §8, 2.0.7-t2), carried by a cookie beside the login's
 * (`rouen_profile`, a year, kept on the device like the login), and the reads a request makes for it.
 *
 * Every request runs with its device's profile in an AsyncLocalStorage, so the readers that count plays for a screen
 * (index.js: the play counts, Last played, Home's rows, Recently played) ask `viewer()` and need no new argument on
 * every route between. Work that is everyone's (Discover, the share card's taste, Smart Picks until P1b) passes no
 * viewer: its reads are all plays, whatever request happened to start it. A device with no cookie, or one naming a
 * profile since removed, is on the first profile; with accounts off there is still a cookie, so devices still differ.
 */

const { AsyncLocalStorage } = require("async_hooks");

const COOKIE = "rouen_profile";
/** The request's profile: one store for the process (one server), so a household job can step outside it. */
const als = new AsyncLocalStorage();
/**
 * The device's Roon profile (profiles.md §5, 2.0.7-t4), set only around the routes where a device acts in Roon as its
 * own — its hearts, adds and Roon's Listen later (lib/profiles/index.js) — never for the whole request, so nothing else
 * a request sets going (a build, a move, a read) acts for it.
 */
const roonAls = new AsyncLocalStorage();

/**
 * Work that is the household's, run outside whatever request started it: no device's profile, and native mode acts as
 * the household's Roon profile (profiles.md §13.2) — Rouen's own Listen later, Dynamic Playlists and playlists moved onto
 * Roon's, and every background job (index.js bgRun). @template T @param {() => T} fn @returns {T}
 */
function asHousehold(fn) { return als.exit(() => roonAls.exit(fn)); }

/** fn run as a device acting in Roon for its Roon profile (hex). @template T @param {string} roon @param {() => T} fn @returns {T} */
function asDevice(roon, fn) { return roonAls.run({ roon }, fn); }

/** The Roon profile the device being answered acts for (NOBODY: none), or null (the household's). @returns {string | null} */
function deviceRoon() { const s = roonAls.getStore(); return s ? s.roon : null; }
const YEAR_S = 365 * 24 * 60 * 60;

/** The cookie's value, from a Cookie header. @param {string | undefined} header */
function cookieValue(header) {
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === COOKIE) {
      // A value no one could have set (bad %-encoding) reads as none: the device is on the first profile.
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch (e) { return ""; }
    }
  }
  return "";
}

/**
 * @typedef {{ id: string, legacy: boolean }} Who  whose plays a read counts: a profile's id ('' for Guest, no one), and
 *   whether the plays kept before profiles (profile NULL) are its (the first profile's)
 * @param {{ store: { first: () => { id: string }, get: (id: unknown) => any, markSeen: (id: string) => void }, guest: string }} deps
 */
function createProfileContext(deps) {
  /** The device's profile: a profile's id, or the guest id. @param {{ headers?: any }} req */
  function deviceProfile(req) {
    const v = cookieValue(req && req.headers && req.headers.cookie);
    if (v === deps.guest) return v;
    if (v && deps.store.get(v)) return v;
    return deps.store.first().id;
  }

  /** Whose plays a profile reads. @param {string} profile  a profile's id or the guest id @returns {Who} */
  function who(profile) {
    if (profile === deps.guest) return { id: "", legacy: false };
    return { id: profile, legacy: profile === deps.store.first().id };
  }

  /**
   * Express middleware: the request's profile as `req.profile`, and the rest of it run with that profile. A database
   * that can't be read (no profiles) leaves the request as everyone's, as before profiles.
   * @param {any} req @param {any} res @param {() => void} next
   */
  function middleware(req, res, next) {
    let profile = null;
    try { profile = deviceProfile(req); }
    catch (e) { profile = null; }   // no database: every read is everyone's, as before profiles, and the screens still work
    req.profile = profile;
    if (profile === null) return next();
    // Seen as this profile today: a profile chosen on a device has its Smart Picks built (profiles.md §10.10). Not said
    // when it can't be written (no database): the build then counts the first profile and those with plays.
    if (profile !== deps.guest) { try { deps.store.markSeen(profile); } catch (e) { /* see above */ } }
    als.run({ profile }, next);
  }

  /** Whose plays the request being answered reads, or null outside a request (everyone's). @returns {Who | null} */
  function viewer() {
    const s = als.getStore();
    return s ? who(s.profile) : null;
  }

  /** The Set-Cookie header choosing a profile on this device. @param {string} profile @param {boolean} secure */
  function cookie(profile, secure) {
    return COOKIE + "=" + encodeURIComponent(profile) + "; Path=/; Max-Age=" + YEAR_S + "; SameSite=Lax" + (secure ? "; Secure" : "");
  }

  return { deviceProfile, who, middleware, viewer, cookie };
}

module.exports = { createProfileContext, cookieValue, asHousehold, asDevice, deviceRoon, COOKIE };
