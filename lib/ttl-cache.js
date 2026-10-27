// @ts-check
"use strict";
/*
 * ttl-cache.js — a cache whose values last a fixed time: the genre lists and the Qobuz and TIDAL featured lists
 * against the Core and the services. Moved out of index.js in v1.9.70-t5, unchanged.
 */

/**
 * A cache whose values last ttlMs each; a cold key's callers share one fetch, and a failed fetch is never kept.
 * @param {number} ttlMs
 * @returns {{ get: (key: any, fetchFn: () => Promise<any>) => Promise<any>, clear: () => void }}
 */
function makeTtlCache(ttlMs) {
  /** @type {Map<any, { value: any, at: number }>} */
  const map     = new Map(); // key → { value, at }
  /** @type {Map<any, Promise<any>>} */
  const inFlight = new Map(); // key → Promise, only while a fetch is running
  return {
    async get(key, fetchFn) {
      const hit = map.get(key);
      if (hit && (Date.now() - hit.at) < ttlMs) return hit.value;
      // Two callers arriving on a cold key both used to run the fetch, because
      // the map was only written after the await. On the Home screen several
      // clients can wake at once, and each miss is a Roon walk — so the second
      // caller waits on the first instead of duplicating it.
      const running = inFlight.get(key);
      if (running) return running;
      // The PROMISE is shared, never the failure. A rejected fetch is deleted
      // here rather than stored, so a transient Core blip cannot be cached for
      // the whole TTL and turn a one-second glitch into a half-hour outage.
      const p = (async () => {
        const value = await fetchFn();
        map.set(key, { value, at: Date.now() });
        return value;
      })().finally(() => { inFlight.delete(key); });
      inFlight.set(key, p);
      return p;
    },
    clear() { map.clear(); }   // in-flight fetches finish and repopulate
  };
}

module.exports = { makeTtlCache };
