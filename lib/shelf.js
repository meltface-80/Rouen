"use strict";
const crypto = require("node:crypto");
/*
 * shelf.js — what the Shelf screen (/shelf) is given: the whole library, in
 * the order a shop would file it, with each album's genres and the letter its
 * artist is filed under.
 *
 * The page does its own filtering. Every tile on its left shows how many
 * albums choosing it would leave, and those counts move with every tap, so a
 * round trip per tap would make the tiles lag the finger. One list, sent once,
 * costs a few hundred kilobytes (gzipped) for a large library and nothing per
 * tap after that.
 *
 * Pure: no Core, no cache, no I/O. index.js hands it the snapshot already in
 * artist order (libraryView's own "artist" sort) and two lookups.
 */

/**
 * The letter an artist is filed under on the Artists grid: A–Z, 1–9, or "#"
 * for everything else (a symbol, a 0, a name in another script).
 *
 * Read from the SAME canonical first-credited name the artist order sorts by
 * (canonArtist: lower case, accents folded, punctuation gone, a leading "The"
 * dropped), so the grid and the order can never disagree about where an act
 * lives: "The Beatles" is a B, "Ólafur Arnalds" an O, "!!!" a #.
 */
function shelfBucket(canonFirst) {
  const c = String(canonFirst || "").charAt(0).toUpperCase();
  if (c >= "A" && c <= "Z") return c;
  if (c >= "1" && c <= "9") return c;
  return "#";
}

/**
 * @param {Array} albums    snapshot records in display order
 * @param {object} fns
 * @param {(al) => string[]} fns.genresOf  an album's genre names
 * @param {(al) => string}   fns.firstOf   its canonical first-credited artist
 * @returns {{ genres: Array<{name: string, count: number}>, albums: Array }}
 *   Each album is { o: offset, t: title, a: artist credit, k: image key,
 *   g: indices into `genres`, b: bucket }. Keys are short because a library
 *   of thirteen thousand albums sends them thirteen thousand times.
 *   Genres are listed commonest first, then by name, which is the order the
 *   tiles are drawn in.
 */
function buildShelf(albums, fns) {
  const counts = new Map();
  const perAlbum = [];
  for (const al of albums) {
    const names = [...new Set((fns.genresOf(al) || []).filter(Boolean))];
    perAlbum.push(names);
    for (const n of names) counts.set(n, (counts.get(n) || 0) + 1);
  }
  const genres = [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));
  const index = new Map(genres.map((g, i) => [g.name, i]));
  const out = albums.map((al, i) => ({
    o: al.offset,
    t: al.title || "",
    a: al.subtitle || "",
    k: al.image_key || null,
    g: perAlbum[i].map((n) => index.get(n)).sort((x, y) => x - y),
    b: shelfBucket(fns.firstOf(al)),
  }));
  return { genres, albums: out };
}

/**
 * A short fingerprint of everything the shelf shows. Two answers with the same
 * signature draw the same shelf, so the page can keep the one it has.
 */
function shelfSignature(shelf) {
  return crypto.createHash("sha1").update(JSON.stringify(shelf)).digest("hex").slice(0, 16);
}

module.exports = { shelfBucket, buildShelf, shelfSignature };
