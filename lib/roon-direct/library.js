// @ts-check
"use strict";
/*
 * library.js — the library the screens read, from the Core's own album list
 * (dev/design/native-remote.md §3.2, N1a, v1.9.21). Pure: no Core, no index.
 *
 * Each album the Core lists becomes one of Rouen's album records (index.js's
 * indexRecord), with the Core's title, artist and source (`roonSource`, from
 * its ContentSource). Nothing is paired to find its source.
 *
 * Until album pages and playing go native (N1b, N1c), each is still opened
 * through the official API's list (index.js's publicIndex), at an offset. So
 * each Core album is given the offset of the official list's row with the
 * same title and artist: the same strings first, then the same once
 * normalised as albumIdentityMatches compares them (what that open checks
 * before it plays anything) — but never a title that normalises to nothing.
 * Ed Sheeran's "+" and "=", and "στίγμα" (the owner's library, v1.9.20's
 * unmatched list), all normalise to "": by that alone they are one album.
 *  - the same title and artist twice (a local copy and a Qobuz one): the
 *    rows are given in order, one each. Which copy each row is, the official
 *    list cannot say; N1b, playing by the Core's own album, ends that.
 *  - a Core album the official list has no row for: an offset far past that
 *    list's end (from PAST_END, so the list's growing never reaches one a
 *    tile still holds), a different one for each. Opening it finds nothing
 *    there and goes to Roon's search by title and artist (loadAlbumSession);
 *    an offset past the end of a list that has not moved is not evidence that
 *    the list changed, so it never sets off a re-read of it.
 *  - its cover: the official row's image key where there is one, the Core's
 *    own otherwise (§3.4: whether the image service takes the Core's key is
 *    still to be seen).
 */
const { MEDIA } = require("./albumsource");

/**
 * @typedef {{ offset: number, title: string, subtitle: string, image_key: string | null, nTitle: string, nArtist: string }} AlbumRecord
 * @typedef {(item: { title: string, subtitle: string, image_key: string | null }, offset: number) => AlbumRecord} MakeRecord
 */

/** Where the offsets of Core albums with no official row start: past any library's end. */
const PAST_END = 1000000;

/** @param {{ title: string, subtitle: string }} r */
const exactKey = (r) => "=" + r.title + "\u0000" + r.subtitle;
/** @param {{ nTitle: string, nArtist: string }} r */
const looseKey = (r) => (r.nTitle ? "~" + r.nTitle + "\u0000" + r.nArtist : null);

/**
 * @param {Array<import("./albums").RoonAlbum> | null} native  the Core's list, from the last whole read
 * @param {{ albums: AlbumRecord[], count: number, declared?: number }} pub  the official API's list
 * @param {MakeRecord} makeRecord
 * @returns {{ albums: Array<AlbumRecord & { roonSource: string | null }>, paired: number, unpaired: number,
 *             bySource: { local: number, qobuz: number, tidal: number, none: number }, covers: Map<string, string> } | null}
 *   covers: each paired album's cover, its server's own key → the official API's (v1.9.62, native-remote.md §12.17): the
 *   key `/api/image` serves, for covers the server names by its own key (a smart playlist's Images)
 */
function nativeView(native, pub, makeRecord) {
  if (!native) return null;
  /** The official rows by each key, in their order. @type {Map<string, AlbumRecord[]>} */
  const rows = new Map();
  /** @param {string | null} k @param {AlbumRecord} r */
  const add = (k, r) => { if (k === null) return; const list = rows.get(k); if (list) list.push(r); else rows.set(k, [r]); };
  for (const r of pub.albums) { add(exactKey(r), r); add(looseKey(r), r); }
  /** Rows already given to a Core album. @type {Set<AlbumRecord>} */
  const taken = new Set();
  /** @param {string | null} k */
  const take = (k) => {
    const list = k === null ? null : rows.get(k);
    const row = list ? list.find((r) => !taken.has(r)) : undefined;
    if (row) taken.add(row);
    return row || null;
  };
  let past = Math.max(PAST_END, pub.declared || 0, pub.count || 0, pub.albums.length);
  const recs = native.map((a) => makeRecord({ title: a.title, subtitle: a.artist, image_key: a.imageKey }, -1));
  // Every exact pair first, so a loose one never takes a row an exact one needed.
  const rowOf = recs.map((rec) => take(exactKey(rec)));
  recs.forEach((rec, i) => { if (!rowOf[i]) rowOf[i] = take(looseKey(rec)); });
  let paired = 0;
  /** @type {Map<string, string>} */
  const covers = new Map();
  const albums = native.map((a, i) => {
    const rec = recs[i], row = rowOf[i];
    if (!row) rec.offset = past++;
    else { rec.offset = row.offset; paired++; }
    if (row && row.image_key) {
      rec.image_key = row.image_key;
      // The first pairing wins: two of the server's albums sharing one cover key give the first its row (the review).
      if (a.imageKey && !covers.has(a.imageKey)) covers.set(a.imageKey, row.image_key);
    }
    const source = a.contentSource === null ? null : /** @type {any} */ (MEDIA)[a.contentSource] || null;
    return Object.assign(rec, { roonSource: /** @type {string | null} */ (source) });
  });
  const bySource = { local: 0, qobuz: 0, tidal: 0, none: 0 };
  for (const a of albums) bySource[/** @type {"local" | "qobuz" | "tidal"} */ (a.roonSource) || "none"]++;
  return { albums, paired, unpaired: albums.length - paired, bySource, covers };
}

/**
 * Puts what the screens read on `view` (index.js's albumIndex): the official
 * list itself, or the Core's (nativeView) while one is read and in force.
 * @param {{ albums: any[], count: number, covers?: Map<string, string> }} view  covers: the server's own cover keys → the official API's (v1.9.62)
 * @param {{ albums: AlbumRecord[], count: number, declared?: number }} pub
 * @param {Array<import("./albums").RoonAlbum> | null} native
 * @param {MakeRecord} makeRecord
 * @returns {{ albums: number, paired: number, unpaired: number, bySource: Record<string, number> } | null}
 *   with the Core's list in force, what Settings → Roon says of it
 */
function showLibrary(view, pub, native, makeRecord) {
  const v = pub.count ? nativeView(native, pub, makeRecord) : null;
  view.albums = v ? v.albums : pub.albums;
  view.count = view.albums.length;
  view.covers = v ? v.covers : new Map();
  return v ? { albums: v.albums.length, paired: v.paired, unpaired: v.unpaired, bySource: v.bySource } : null;
}

module.exports = { nativeView, showLibrary, PAST_END };
