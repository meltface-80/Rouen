// @ts-check
"use strict";
/*
 * daily.js — what is made once a day for each profile (dev/design/profiles.md §3, §10.10, 2.0.7-t3), moved out of
 * index.js:
 *
 *   buildEach     the day's Smart Picks build for each active profile, one after another: a profile with today's
 *                 set, or one tried today, is left alone unless the build is for it alone (a Rebuild, a Tune change);
 *                 one profile's failure stops no other's, and the first is thrown once every profile has had its turn
 *   createDaily   a value built once a day for each profile on first asking (the share card's taste), answered from
 *                 the last one while today's builds; a profile's build is never run twice at once
 */

/**
 * @param {string} day @param {{ profile?: string }} [opts]
 * @param {{ profiles: () => string[], has: (day: string, p: string) => boolean, tried: (day: string, p: string) => boolean,
 *   build: (day: string, p: string) => Promise<void> }} d
 */
async function buildEach(day, opts, d) {
  const one = opts && opts.profile;
  let failed = null;
  for (const p of one ? [one] : d.profiles()) {
    if (!one && (d.has(day, p) || d.tried(day, p))) continue;   // a set kept all day; a day tried, not retried per request
    try { await d.build(day, p); } catch (e) { failed = failed || e; }
  }
  if (failed) throw failed;
}

/**
 * @template T
 * @param {{ day: () => string, build: (profile: string) => Promise<T>, log?: (line: string) => void }} d
 */
function createDaily(d) {
  /** @type {Map<string, { day: string, value: T }>} */
  const built = new Map();
  /** @type {Map<string, Promise<void>>} */
  const building = new Map();

  /** Today's build for the profile, once: the one under way if there is one. @param {string} profile */
  function rebuild(profile) {
    const running = building.get(profile);
    if (running) return running;
    const day = d.day();
    const p = d.build(profile).then((value) => { built.set(profile, { day, value }); })
      .catch((e) => { if (d.log) d.log(/** @type {Error} */ (e).message); })   // said; the last value stands meanwhile
      .finally(() => { building.delete(profile); });
    building.set(profile, p);
    return p;
  }

  /** The profile's value, today's or the last (null before the first); today's built when it isn't. @param {string} profile */
  function get(profile) {
    const b = built.get(profile);
    if (!b || b.day !== d.day()) rebuild(profile);
    return b ? b.value : null;
  }

  /** A profile removed: nothing kept for it. @param {string} profile */
  function forget(profile) { built.delete(profile); }

  return { get, rebuild, forget };
}

module.exports = { buildEach, createDaily };
