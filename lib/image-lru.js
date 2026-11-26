// @ts-check
"use strict";
/*
 * image-lru.js — the in-memory LRU for scaled cover art (moved out of index.js unchanged in 2.0.6-t21,
 * dev/quality.md's move-out). Every art fetch used to be a live Roon Core round-trip over the single multiplexed
 * websocket, and the Core rescales the image each time; image_key changes when the art changes, so cached bytes never
 * go stale. A Map keeps insertion order: delete and set again on a hit gives LRU eviction.
 */

/**
 * @typedef {{ body: Buffer, type: string, bytes: number }} ImageEntry
 * @param {number} maxBytes  the most the cache holds; no one image may take more than a quarter of it
 */
function createImageLru(maxBytes) {
  /** @type {Map<string, ImageEntry>} "key@size" → entry */
  const cache = new Map();
  let bytes = 0;
  return {
    /** @param {string} k */
    get(k) {
      const hit = cache.get(k);
      if (!hit) return null;
      cache.delete(k); cache.set(k, hit);   // refresh LRU position
      return hit;
    },
    /** @param {string} k @param {ImageEntry} entry */
    put(k, entry) {
      if (entry.bytes > maxBytes / 4) return;   // never let one image dominate
      // Two concurrent misses for the same key both land here; set() replaces the
      // entry, so subtract the old bytes first or the accounting drifts upward
      // forever and eventually evicts the whole cache on every put.
      const prev = cache.get(k);
      if (prev) bytes -= prev.bytes;
      bytes += entry.bytes;
      cache.set(k, entry);
      while (bytes > maxBytes && cache.size) {
        const oldest = /** @type {string} */ (cache.keys().next().value);
        bytes -= /** @type {ImageEntry} */ (cache.get(oldest)).bytes;
        cache.delete(oldest);
      }
    },
    /** What it holds, for the tests. */
    size: () => ({ entries: cache.size, bytes }),
  };
}

module.exports = { createImageLru };
