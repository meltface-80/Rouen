// @ts-check
"use strict";
/*
 * album-match.js — which library album a play was played from (dev/design/listening.md §3.3).
 *
 * Roon's now-playing feed names the album by its title alone, and until 2.0.6-t20 every reader matched plays to
 * albums by that title: a play of any "Greatest Hits" counted for every "Greatest Hits" in the library. Here a play
 * belongs to one album, found by, in turn:
 *   1. the album's cover (`image_key`, in every play row and on every library record), where it names one album;
 *   2. the title, and the album's credit naming the track's artist;
 *   3. the title alone, where only one library album has it.
 * Otherwise to none: nothing is counted for a guess. An album's identity is its key (`keyOf`, index.js's albumKey of
 * its title and credit): two library records with one key (two editions under one name) are one album here, as they
 * are in album_tracks.
 */

/**
 * @typedef {{ title?: string, subtitle?: string, image_key?: string | null }} Album
 * @typedef {{ key: string, al: Album }} Hit
 */

/**
 * @param {{ albums: () => Album[], version: () => number, keyOf: (al: Album) => string | null,
 *   canonText: (s: string) => string, canonArtist: (s: string) => string, splitCredit: (s: string) => string[] }} deps
 *   albums: the library as the screens read it; version: what changes when it does (albumIndex.builtAt).
 */
function createAlbumMatcher(deps) {
  /** @type {{ albums: Album[] | null, version: number, byImage: Map<string, Hit[]>, byTitle: Map<string, Hit[]> }} */
  const ix = { albums: null, version: -1, byImage: new Map(), byTitle: new Map() };

  function index() {
    const albums = deps.albums(), version = deps.version();
    if (ix.albums === albums && ix.version === version) return ix;
    ix.albums = albums; ix.version = version;
    ix.byImage = new Map(); ix.byTitle = new Map();
    for (const al of albums) {
      const key = deps.keyOf(al);
      if (!key) continue;
      const hit = { key, al };
      if (al.image_key) add(ix.byImage, al.image_key, hit);
      const t = deps.canonText(al.title || "");
      if (t) add(ix.byTitle, t, hit);
    }
    return ix;
  }

  /** The one album these name, or null when they name none or several. @param {Hit[] | undefined} hits */
  function one(hits) {
    if (!hits || !hits.length) return null;
    return hits.every((h) => h.key === hits[0].key) ? hits[0] : null;
  }

  /** @param {string} credit */
  function names(credit) {
    return deps.splitCredit(credit || "").map((n) => deps.canonArtist(n)).filter(Boolean);
  }

  /**
   * The album a play belongs to, or null.
   * @param {{ album?: string, artist?: string, image_key?: string | null }} play
   * @returns {Hit | null}
   */
  function match(play) {
    const x = index();
    if (play.image_key) {
      const hit = one(x.byImage.get(play.image_key));
      if (hit) return hit;
    }
    const t = deps.canonText(play.album || "");
    if (!t) return null;
    const same = x.byTitle.get(t);
    if (!same) return null;
    const artists = new Set(names(play.artist || ""));
    if (artists.size) {
      const hit = one(same.filter((h) => names(h.al.subtitle || "").some((n) => artists.has(n))));
      if (hit) return hit;
    }
    return one(same);
  }

  return { match };
}

/** @param {Map<string, Hit[]>} m @param {string} k @param {Hit} v */
function add(m, k, v) {
  const list = m.get(k);
  if (list) list.push(v); else m.set(k, [v]);
}

module.exports = { createAlbumMatcher };
