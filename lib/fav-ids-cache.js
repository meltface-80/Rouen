// @ts-check
"use strict";
/*
 * fav-ids-cache.js — a streaming service's favourited album ids, kept a short while. Moved out of index.js in
 * v1.9.70-t6, unchanged but for its debug switch, which it is given.
 *
 * Short-lived cache of a streaming service's favourited album ids, shared by
 * all of that service's browse routes so each page render doesn't re-fetch the
 * full favourites list (429 risk). Concurrent callers on a cold cache share
 * one in-flight fetch. Best-effort: on fetch failure, serves the previous ids
 * if they aren't older than `staleMaxMs`, otherwise an empty Set — the list
 * still renders, just without favourite marks. `fetchIds` must resolve to a
 * Set of album-id strings.
 */

/**
 * @param {{ name: string, fetchIds: () => Promise<Set<string>>, cacheMs?: number, staleMaxMs?: number, debug?: boolean }} o
 *   debug: say why a lookup failed (index.js's RRA_DEBUG)
 */
function makeFavIdsCache({ name, fetchIds, cacheMs = 60 * 1000, staleMaxMs = 10 * 60 * 1000, debug = false }) {
  /** @type {Set<string> | null} */
  let ids = null;      // Set of album ids, or null when stale/never fetched
  let at = 0;          // epoch ms of last successful fetch
  /** @type {Promise<Set<string>> | null} */
  let pending = null;  // in-flight fetch promise — concurrent callers share it
  return {
    async get() {
      if (ids && (Date.now() - at) < cacheMs) return ids;
      if (pending) return pending;
      pending = (async () => {
        try {
          const fresh = await fetchIds();
          ids = fresh;
          at = Date.now();
          return fresh;
        } catch (e) {
          if (debug) console.error("[" + name + "] favourite-ids lookup failed:", /** @type {any} */ (e).message);
          if (ids && (Date.now() - at) < staleMaxMs) return ids; // stale-on-error ceiling
          return new Set();
        } finally {
          pending = null;
        }
      })();
      return pending;
    },
    add(id)    { if (ids) ids.add(String(id)); },
    remove(id) { if (ids) ids.delete(String(id)); },
    clear()    { ids = null; at = 0; }
  };
}

module.exports = { makeFavIdsCache };
