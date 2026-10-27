// @ts-check
"use strict";
/*
 * artists.js — the Artists screen's list (v1.9.70-t6, dev/design/artists.md §3.1): every album artist, A to Z, with
 * how many albums are theirs and one of their covers. Pure: the library's albums in, the list out.
 *
 * An artist is an album's lead artist (`cFirst`, canonical, a leading "The" aside), as the Library's Artist order and
 * the Shelf file albums. An album is theirs exactly as the artist page has it (index.js artistLibraryAlbums's
 * `primary`): credited to that name whole (`cArtist`) or with that name first (`cFirst`). A name with no canonical
 * form has no artist page, and is left out.
 */

/**
 * @typedef {{ name: string, key: string, letter: string, albums: number, cover: string | null }} Artist
 * @typedef {{ subtitle?: string, image_key?: string | null, cArtist?: string, cFirst?: string }} AlbumRecord
 */

/**
 * @param {Iterable<AlbumRecord>} albums
 * @param {{ ensure: (al: AlbumRecord) => void, leadOf: (credit: string) => string }} fns
 *   ensure: gives an album its cArtist/cFirst when it has none yet; leadOf: a credit's first artist, as written
 * @returns {Artist[]}
 */
function buildArtists(albums, fns) {
  /** @type {Map<string, { names: Map<string, number>, albums: number, cover: string | null }>} */
  const by = new Map();
  /** @type {AlbumRecord[]} */
  const whole = [];
  for (const al of albums) {
    fns.ensure(al);
    const key = al.cFirst || "";
    if (!key) continue;
    let a = by.get(key);
    if (!a) by.set(key, (a = { names: new Map(), albums: 0, cover: null }));
    a.albums++;
    const name = (fns.leadOf(al.subtitle || "") || al.subtitle || "").trim();
    if (name) a.names.set(name, (a.names.get(name) || 0) + 1);
    if (!a.cover && al.image_key) a.cover = al.image_key;
    // Credited whole to another name that is someone's lead too ("Simon & Garfunkel" over "Simon"): theirs as well.
    if (al.cArtist && al.cArtist !== key) whole.push(al);
  }
  for (const al of whole) {
    const a = by.get(/** @type {string} */ (al.cArtist));
    if (!a) continue;
    a.albums++;
    if (!a.cover && al.image_key) a.cover = al.image_key;
  }
  /** @type {Artist[]} */
  const out = [];
  for (const [key, a] of by) {
    // The name as most of their albums credit it; the first seen of equals.
    let name = "", n = 0;
    for (const [s, c] of a.names) if (c > n) { name = s; n = c; }
    out.push({ name: name || key, key, letter: /^[a-z]/.test(key) ? key[0].toUpperCase() : "#", albums: a.albums, cover: a.cover });
  }
  // A to Z by the canonical name (each artist's own), # (anything else) after Z.
  const rank = (/** @type {Artist} */ x) => (x.letter === "#" ? 1 : 0);
  out.sort((x, y) => rank(x) - rank(y) || (x.key < y.key ? -1 : 1));
  return out;
}

module.exports = { buildArtists };
