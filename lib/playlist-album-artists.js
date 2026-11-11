// @ts-check
"use strict";
/*
 * playlist-album-artists.js — a playlist row's album artist, found in Rouen's library by the row's cover (2.0.5-t1,
 * dev/design/playlist-artists.md §4). A playlists user, relayed by the owner (2026-11-11), saw the official API's
 * composer line under INXS and Tina Turner on a 1,715-track playlist: "That makes it very difficult to find anything."
 * Native mode names a track's own artist where its read reaches (lib/roon-direct/playlist-artists.js); a row it
 * doesn't name takes its album's artist from here, the owner's choice.
 *
 * A row's image_key is its album's cover in Roon's browse, and the library index (index.js's albumIndex, the official
 * API's album list) carries each album's cover and artist line. A cover shared by albums of different artists names
 * none; a compilation's artist ("Various Artists") is no answer: those rows keep their line.
 */

/** A compilation's artist line, in the languages Roon's libraries show it in: not an artist. */
const VARIOUS = /^(various( artists)?|v\.?\s?a\.?|diverse( interpreten)?|verschiedene( interpreten)?|artistes divers|varios( artistas)?|artisti vari|diversen)$/i;

/**
 * @param {() => Array<{ image_key?: string | null, subtitle?: string | null }> | null | undefined} albums  the library's albums
 * @param {() => any} [stamp]  changes when the library does (albumIndex.builtAt): the index is made again then
 */
function createAlbumArtists(albums, stamp = () => null) {
  /** @type {{ list: any, at: any, byKey: Map<string, string | null> }} */
  let kept = { list: null, at: undefined, byKey: new Map() };

  /** The library's albums by cover: an artist, or null where covers of different artists coincide. */
  function index() {
    const list = albums() || [];
    const at = stamp();
    if (list === kept.list && at === kept.at) return kept.byKey;
    /** @type {Map<string, string | null>} */
    const byKey = new Map();
    for (const a of list) {
      const key = a && a.image_key;
      const artist = a && typeof a.subtitle === "string" ? a.subtitle.trim() : "";
      if (!key || !artist) continue;
      if (!byKey.has(key)) byKey.set(key, artist);
      else if (byKey.get(key) !== artist) byKey.set(key, null);
    }
    kept = { list, at, byKey };
    return byKey;
  }

  return {
    /**
     * Each row's album artist, by its cover; null where none is known, or it is a compilation's.
     * @param {Array<string | null | undefined>} keys  the rows' image_keys
     * @returns {Array<string | null>}
     */
    of(keys) {
      const byKey = index();
      return keys.map((k) => {
        const a = k ? byKey.get(k) : null;
        return a && !VARIOUS.test(a) ? a : null;
      });
    },
  };
}

module.exports = { createAlbumArtists, VARIOUS };
