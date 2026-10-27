"use strict";
// ---------------------------------------------------------------------------
// The fake server's album facts (v1.9.70-t5, dev/design/shelf-focus.md §2): an album's AlbumFormat and its genres
// (GenreLites, in a DataList by reference, as the owner's server sends them: v1.9.70-t7), each object pushed before
// the album that names it, and once a connection, as the owner's server sends every object: a genre and an album's
// genres' list always (an album sent again, whole, names its list without sending it), a format with the
// sharedFormats fault (albums of one format name one AlbumFormat). With the sharedGenres fault, albums of the same
// genres name one list. With the inlineGenres fault, the list is in the album itself, the form v1.9.70-t5 read (both
// are read). Not evidence of what a real server sends: the owner's sends both, its genres by reference (v1.9.70-t4's
// probe).
// ---------------------------------------------------------------------------

const { BinaryWriter } = require("../../lib/roon-direct/wire");

/**
 * One connection's facts.
 * @param {(oid: bigint, typeId: number, fields: Array<[number, (w: any) => void]>) => void} obj  pushes an object
 * @param {{ Format: number, Genre: number, GenreList: number }} T  the type ids
 * @param {{ sharedFormats?: boolean, sharedGenres?: boolean, inlineGenres?: boolean }} f  the faults
 * @param {(oid: bigint, typeId: number, body: Buffer) => void} raw  pushes an object whose payload is not members
 */
function createFacts(obj, T, f, raw) {
  const genreObj = new Map();     // a genre's name -> its GenreLite's object id
  const formatObj = new Map();    // sharedFormats: a format, as JSON -> its AlbumFormat's object id
  const listObj = new Map();      // sharedGenres: the genres, as JSON -> their list's object id
  /** The genres' lists this connection has been sent. @type {Set<bigint>} */
  const listSent = new Set();
  /**
   * Pushes what album i names that this connection hasn't been sent, and says the object id of its format, and how to
   * write its GenreObjects: its DataList's id (47000 + i, or the first album's of those genres with sharedGenres), or
   * the list itself (inlineGenres).
   * @param {any} a @param {number} i @returns {{ format: bigint | null, genres: ((w: any) => void) | null }}
   */
  return function factsOf(a, i) {
    let format = null;
    if (a.format) {
      const key = f.sharedFormats ? JSON.stringify(a.format) : null;
      format = (key && formatObj.get(key)) || 41000n + BigInt(i);
      if (!(key && formatObj.has(key))) {
        const fm = a.format;
        if (key) formatObj.set(key, format);
        obj(format, T.Format, [[1, (w) => w.flexInt(fm.file)], ...(fm.rate ? [[2, (w) => w.integer(fm.rate)]] : []),
          ...(fm.bits ? [[3, (w) => w.integer(fm.bits)]] : []), ...(fm.channels ? [[4, (w) => w.integer(fm.channels)]] : []),
          ...(fm.streaming ? [[5, (w) => w.boolean(true)]] : [])]);
      }
    }
    const genres = (a.genres || []).map((/** @type {string} */ n) => {
      if (!genreObj.has(n)) { genreObj.set(n, 46000n + BigInt(genreObj.size)); obj(genreObj.get(n), T.Genre, [[1, (w) => w.string(n)]]); }
      return genreObj.get(n);
    });
    if (!a.genres) return { format, genres: null };
    if (f.inlineGenres) {
      const l = new BinaryWriter().integer(genres.length);
      for (const g of genres) l.long(g);
      const b = l.toBuffer();
      return { format, genres: (w) => w.integer(b.length).bytes(b) };
    }
    const key = f.sharedGenres ? JSON.stringify(a.genres) : null;
    const genreList = (key && listObj.get(key)) || 47000n + BigInt(i);
    if (key && !listObj.has(key)) listObj.set(key, genreList);
    if (!listSent.has(genreList)) {
      listSent.add(genreList);
      const body = new BinaryWriter().integer(genres.length);
      for (const g of genres) body.long(g);
      raw(genreList, T.GenreList, body.toBuffer());
    }
    return { format, genres: (w) => w.long(genreList) };
  };
}

/**
 * The types as this connection's faults have them: with inlineGenres, AlbumLite's GenreObjects a list inline (24), not
 * a DataList by reference (23).
 * @param {Array<[number, string, Array<[string, number]>]>} types @param {{ inlineGenres?: boolean }} f
 */
function typesFor(types, f) {
  if (!f.inlineGenres) return types;
  return types.map(([id, name, members]) => [id, name, members.map(([m, p]) => (/::GenreObjects$/.test(m)
    ? ["System.Collections.Generic.IList<Sooloos.Broker.Api.GenreLite> Sooloos.Broker.Api.AlbumLite::GenreObjects", 24] : [m, p]))]);
}

module.exports = { createFacts, typesFor };
