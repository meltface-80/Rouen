"use strict";
// ---------------------------------------------------------------------------
// The fake server's album facts (v1.9.70-t5, dev/design/shelf-focus.md §2): an album's AlbumFormat and its genres
// (GenreLites), each object pushed before the album that names it, and once a connection — a genre always, a format
// with the sharedFormats fault (albums of one format name one AlbumFormat). Not evidence that a real server sends
// either in a library page: the owner's server will say.
// ---------------------------------------------------------------------------

/**
 * One connection's facts.
 * @param {(oid: bigint, typeId: number, fields: Array<[number, (w: any) => void]>) => void} obj  pushes an object
 * @param {{ Format: number, Genre: number }} T  the type ids
 * @param {{ sharedFormats?: boolean }} f  the faults
 */
function createFacts(obj, T, f) {
  const genreObj = new Map();     // a genre's name -> its GenreLite's object id
  const formatObj = new Map();    // sharedFormats: a format, as JSON -> its AlbumFormat's object id
  /**
   * Pushes what album i names that this connection hasn't been sent, and says the object ids it names.
   * @param {any} a @param {number} i @returns {{ format: bigint | null, genres: bigint[] }}
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
    return { format, genres };
  };
}

module.exports = { createFacts };
