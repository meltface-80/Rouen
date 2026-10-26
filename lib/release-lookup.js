// @ts-check
"use strict";
/*
 * release-lookup.js — which albums the label scan asks Discogs about for a catalogue number, where the answer is
 * kept, and the memory of who has been asked (v1.9.67-t2, dev/design/catalogue.md §3 Discogs). The glue between
 * lib/labels-discogs-pass.js and lib/release-facts.js, out of index.js so it is tested.
 *
 *   createReleaseLookup(deps)
 *     .needing(albums)   the albums with no catalogue number from any source, not yet asked about
 *     .keep(al, rel)     Discogs' answer kept under the album's keys, as src "discogs" (ranked below a tag and Roon)
 *     .mark(key)         asked about, with something or nothing: not again
 *     .has(key), .load(keys), .clear(), .size()
 */

/**
 * @param {{ facts: { forKeys: (keys: string[]) => ({ catno: string | null } | null), set: (key: string, f: any, src: string) => boolean },
 *           keysOf: (al: any) => string[], labelKey: (al: any) => string,
 *           save?: (key: string, at: number) => void, remove?: () => void, now?: () => number }} d
 *   facts: the release-facts cache; keysOf: the keys an album is looked up by (the badge's srcKeys, else its
 *   title and artist's); labelKey: the label cache's key for an album, which the memory is kept by;
 *   save/remove: the `release_lookup` table
 */
function createReleaseLookup(d) {
  const tried = new Set();
  const now = d.now || Date.now;
  return {
    /** @param {any[]} albums */
    needing(albums) {
      return albums.filter((al) => {
        if (tried.has(d.labelKey(al))) return false;
        const r = d.facts.forKeys(d.keysOf(al));
        return !(r && r.catno);
      });
    },
    /** @param {any} al @param {{ catno: string | null, type: string | null }} rel */
    keep(al, rel) {
      for (const k of d.keysOf(al)) d.facts.set(k, rel, "discogs");
    },
    /** @param {string} key */
    mark(key) {
      tried.add(key);
      if (d.save) d.save(key, now());
    },
    /** @param {string} key */
    has: (key) => tried.has(key),
    /** @param {string[]} keys  as saved */
    load(keys) {
      for (const k of keys || []) if (typeof k === "string" && k) tried.add(k);
    },
    /** A Force rescan, or a Discogs token that changed: everyone is asked again. */
    clear() {
      tried.clear();
      if (d.remove) d.remove();
    },
    size: () => tried.size,
  };
}

module.exports = { createReleaseLookup };
