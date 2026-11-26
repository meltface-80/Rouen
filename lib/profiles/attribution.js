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
 * "Played nothing": no track began or ended on the zone (the scrobbler says each, `touch`). A track ends when the next
 * begins or the zone stops, so a long movement keeps its zone current, and a zone stopped half an hour forgets who
 * started it.
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
  /** @type {Map<string, number>} each zone's last track begun or ended */
  const touched = new Map();

  /** A device started something on a zone. @param {string} zoneId @param {string} profile  its profile's id, or the guest id */
  function start(zoneId, profile) {
    if (!zoneId) return;
    started.set(zoneId, { profile, at: now() });
    touched.set(zoneId, now());
  }

  /** A track began or ended on the zone. @param {string} zoneId */
  function touch(zoneId) { touched.set(zoneId, now()); }

  /**
   * Whose a play on this zone is, now: a profile's id, or '' (no one). Counts as the zone's activity.
   * @param {string} zoneId @returns {string}
   */
  function whose(zoneId) {
    const s = started.get(zoneId);
    const last = touched.get(zoneId);
    if (s && (last === undefined || now() - last > IDLE_MS)) started.delete(zoneId);
    touch(zoneId);
    const p = started.has(zoneId) ? /** @type {{ profile: string }} */ (started.get(zoneId)).profile : deps.zoneProfile(zoneId);
    return p === deps.guest ? "" : p;
  }

  /** A zone gone: nothing kept for it. @param {string} zoneId */
  function forget(zoneId) { started.delete(zoneId); touched.delete(zoneId); }

  return { start, touch, whose, forget };
}

module.exports = { createAttribution, IDLE_MS };
