// @ts-check
"use strict";
/*
 * attribution.js — whose listening a play is (dev/design/profiles.md §4, 2.0.7-t2):
 *
 *   1. started from Rouen: a device that starts something on a zone has that zone's listening count for its profile,
 *      until another device starts something there or the zone has played nothing for 30 minutes;
 *   2. otherwise the zone's own "Listening here counts for" (store.js zoneProfile);
 *   3. Guest, either way, counts for no one: written as profile ''.
 *
 * "Played nothing": the zone not reported playing (the scrobbler says `playing` at each report of it playing, before
 * it writes the play). Paused or stopped half an hour, it forgets who started it, whoever resumes it. A start is
 * claimed before its route acts (routes.js), so the first track is already the device's, and given back if the route
 * refuses. A profile removed is forgotten wherever it held a zone.
 */

const IDLE_MS = 30 * 60 * 1000;

/**
 * @param {{ zoneProfile: (zoneId: string) => string, guest: string, now?: () => number }} deps
 *   zoneProfile: the zone's own (a profile's id, or the guest id)
 */
function createAttribution(deps) {
  const now = deps.now || Date.now;
  /** @type {Map<string, { profile: string, at: number }>} who started each zone, and when */
  const started = new Map();
  /** @type {Map<string, number>} when each zone was last reported playing (or started) */
  const lastPlaying = new Map();

  /** A start forgotten if the zone has played nothing for IDLE_MS. @param {string} zoneId */
  function expire(zoneId) {
    const last = lastPlaying.get(zoneId);
    if (started.has(zoneId) && (last === undefined || now() - last > IDLE_MS)) started.delete(zoneId);
  }

  /**
   * A device starts something on a zone: what held it before, to give back if the start is refused.
   * @param {string} zoneId @param {string} profile  its profile's id, or the guest id
   * @returns {{ profile: string, at: number } | undefined}
   */
  function start(zoneId, profile) {
    const before = started.get(zoneId);
    if (!zoneId) return before;
    started.set(zoneId, { profile, at: now() });
    lastPlaying.set(zoneId, now());
    return before;
  }

  /** A start refused: the zone as it was. @param {string} zoneId @param {{ profile: string, at: number } | undefined} before */
  function undo(zoneId, before) {
    if (before) started.set(zoneId, before); else started.delete(zoneId);
  }

  /** The zone reported playing. @param {string} zoneId */
  function playing(zoneId) {
    expire(zoneId);
    lastPlaying.set(zoneId, now());
  }

  /** Whose a play on this zone is, now: a profile's id, or '' (no one). @param {string} zoneId @returns {string} */
  function whose(zoneId) {
    expire(zoneId);
    const s = started.get(zoneId);
    const p = s ? s.profile : deps.zoneProfile(zoneId);
    return p === deps.guest ? "" : p;
  }

  /** A zone gone: nothing kept for it. @param {string} zoneId */
  function forget(zoneId) { started.delete(zoneId); lastPlaying.delete(zoneId); }

  /** A profile removed: no zone counts for it any longer. @param {string} profile */
  function forgetProfile(profile) {
    for (const [z, s] of started) if (s.profile === profile) started.delete(z);
  }

  return { start, undo, playing, whose, forget, forgetProfile };
}

module.exports = { createAttribution, IDLE_MS };
