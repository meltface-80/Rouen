// @ts-check
"use strict";
/*
 * library-exact.js — the library album that a title and credit name EXACTLY, moved out of index.js in v1.9.49
 * (listenLaterLibraryRecord's first step, since v1.8.67).
 *
 * EXACT IDENTITY FIRST. smartLibraryRecord matches through every albumKeys
 * variant and keeps the first album filed under each, and the edition-stripped
 * variant is shared: with "Rumours" and "Rumours (Deluxe Edition)" both in the
 * library, a plain "Rumours" can come back as the deluxe record — whose album
 * view would then say "Remove from Listen later" for the other edition. So an
 * album whose own title and credit are exactly these wins, and the tolerant
 * match is only the fallback (a service spelling Roon has cleaned up).
 *
 * A title Rouen's key can't name (no ASCII letters or digits: Ed Sheeran's "+", "Кино") is found by its title and
 * credit as written instead (find.js asWritten, v1.9.49) — it has no tolerant fallback to fall to.
 */
const { asWritten } = require("./roon-direct/find");

/**
 * @param {{ index: () => { builtAt: number, albums?: any[] }, albumKey: (title: string, artist: string) => string | null }} d
 *   index: the library as Rouen holds it (index.js albumIndex), rebuilt as its builtAt moves
 */
function createExactIndex(d) {
  let built = { builtAt: -1, map: /** @type {Map<string, any> | null} */ (null) };
  /** @param {string} title @param {string} artist */
  const keyOf = (title, artist) => d.albumKey(title, artist) || asWritten(title, artist);
  return {
    /** The library album these strings name exactly, or null. @param {string} title @param {string} artist */
    find(title, artist) {
      const idx = d.index();
      if (built.builtAt !== idx.builtAt || !built.map) {
        const map = new Map();
        for (const al of (idx.albums || [])) {
          const k = keyOf(al.title, al.subtitle);
          if (!map.has(k)) map.set(k, al);
        }
        built = { builtAt: idx.builtAt, map };
      }
      return built.map.get(keyOf(title, artist || "")) || null;
    },
  };
}

module.exports = { createExactIndex };
