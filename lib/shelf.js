// @ts-check
"use strict";
const crypto = require("node:crypto");
/*
 * shelf.js — what the Shelf screen (/shelf) is given: the whole library, in
 * the order a shop would file it, with each album's genres and the letter its
 * artist is filed under; and, since v1.9.67 (a user's request: "my main goto
 * way to sort electronic music vinyls"), its record label, its catalogue
 * number and what kind of release it is, for the Labels and Types tiles, the
 * label order, and the catalogue number on the spine.
 *
 * The page does its own filtering. Every tile on its left shows how many
 * albums choosing it would leave, and those counts move with every tap, so a
 * round trip per tap would make the tiles lag the finger. One list, sent once,
 * costs a few hundred kilobytes (gzipped) for a large library and nothing per
 * tap after that.
 *
 * Pure: no Core, no cache, no I/O. lib/shelf-routes.js hands it the snapshot
 * already in artist order (libraryView's own "artist" sort) and the lookups.
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

/** An album's kinds as sent: a list, one kind, or nothing → a list or null. @param {any} v */
function kinds(v) {
  const list = Array.isArray(v) ? v.filter(Boolean) : v ? [v] : [];
  return list.length ? list : null;
}

/** A list of names, commonest first, then by name: the order the tiles are drawn in. @param {Map<string, number>} counts */
function ranked(counts) {
  return [...counts.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
}

/**
 * @param {Array} albums    snapshot records in display order
 * @param {object} fns
 * @param {(al) => string[]} fns.genresOf  an album's genre names
 * @param {(al) => string}   fns.firstOf   its canonical first-credited artist
 * @param {(al) => (number|null)} [fns.yearOf]  its release year, or null when
 *   no source has stated one (the Decade focus's own albumYearOf). Without it
 *   every album is undated.
 * @param {(al) => (string|null)} [fns.labelOf]  its record label, as the Label focus names it
 * @param {(al) => (string|null)} [fns.catOf]    its catalogue number, as tagged
 * @param {(al) => (string|null)} [fns.formatOf]  what its files are ("FLAC 24/96") or the service it streams from (v1.9.68)
 * @param {(al) => (string[]|string|null)} [fns.typeOf]   what kinds of release it is: album, ep, single,
 *   compilation, live, soundtrack, remix, other (lib/release-facts.js TYPES) — several at once since v1.9.67-t4 (a
 *   live compilation) — or nothing when no source says
 * @returns {{ genres: Array<{name: string, count: number}>, labels: Array<{name: string, count: number}>, albums: Array }}
 *   Each album is { o: offset, t: title, a: artist credit, k: image key,
 *   g: indices into `genres`, b: bucket, y: year or null, l: index into `labels` or null,
 *   c: catalogue number or null, ty: its kinds (a list) or null, fm: its format or null }. The year is for
 *   the Years tab (v1.9.10, from Mandarin v0.8.27). Keys are short because a library
 *   of thirteen thousand albums sends them thirteen thousand times.
 *   Genres and labels are listed commonest first, then by name, which is the
 *   order the tiles are drawn in.
 */
function buildShelf(albums, fns) {
  const counts = new Map(), labelCounts = new Map();
  const perAlbum = [], perLabel = [];
  for (const al of albums) {
    const names = [...new Set((fns.genresOf(al) || []).filter(Boolean))];
    perAlbum.push(names);
    for (const n of names) counts.set(n, (counts.get(n) || 0) + 1);
    const label = (fns.labelOf && fns.labelOf(al)) || null;
    perLabel.push(label);
    if (label) labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
  }
  const genres = ranked(counts), labels = ranked(labelCounts);
  const index = new Map(genres.map((g, i) => [g.name, i]));
  const labelIndex = new Map(labels.map((l, i) => [l.name, i]));
  const out = albums.map((al, i) => ({
    o: al.offset,
    t: al.title || "",
    a: al.subtitle || "",
    k: al.image_key || null,
    g: perAlbum[i].map((n) => index.get(n)).sort((x, y) => x - y),
    b: shelfBucket(fns.firstOf(al)),
    y: (fns.yearOf && fns.yearOf(al)) || null,
    l: perLabel[i] === null ? null : labelIndex.get(perLabel[i]),
    c: (fns.catOf && fns.catOf(al)) || null,
    ty: kinds(fns.typeOf && fns.typeOf(al)),
    fm: (fns.formatOf && fns.formatOf(al)) || null,
  }));
  return { genres, labels, albums: out };
}

/**
 * A short fingerprint of everything the shelf shows. Two answers with the same
 * signature draw the same shelf, so the page can keep the one it has.
 */
function shelfSignature(shelf) {
  return crypto.createHash("sha1").update(JSON.stringify(shelf)).digest("hex").slice(0, 16);
}

/**
 * A short number that moves when any album's value of `fn` does (v1.9.68: the formats, which have no stamp of their
 * own in index.js — they move with every file walk and service harvest, and with the sources).
 * @param {Array<any>} albums @param {(al: any) => (string|number|null|undefined)} fn
 * @returns {number}
 */
function stampOf(albums, fn) {
  let h = 0;
  for (const al of albums) {
    const v = String(fn(al) ?? "");
    for (let i = 0; i < v.length; i++) h = (Math.imul(h, 31) + v.charCodeAt(i)) | 0;
    h = (Math.imul(h, 31) + 1) | 0;   // where one album's ends, so "ab" + "c" is not "a" + "bc"
  }
  return h;
}

module.exports = { shelfBucket, buildShelf, shelfSignature, stampOf };
