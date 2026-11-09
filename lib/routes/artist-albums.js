// @ts-check
"use strict";
/*
 * artist-albums.js — an artist's albums in the library, and the routes that show them: the artist page's and the
 * album view's "More by" / "Appears on" (v1.9.3). Moved out of index.js in v2.0.3-t3, unchanged (dev/quality.md,
 * "Splitting the monoliths"); index.js keeps slimAlbum, which the Last.fm routes share.
 *
 *   GET /api/artist-albums?artist=       → { artist, primary: [tile], featured: [tile] }
 *   GET /api/album/more?title=&artist=   → { artist, by: [tile], appears: [tile] }
 */

/**
 * @param {{ albums: () => any[], count: () => number, canonArtist: (s: string) => string, applyCreditIdentities: (al: any) => void }} d
 *   albums / count: the snapshot's albums (albumIndex); the rest as index.js has them
 * @returns {(artist: string) => { primary: any[], featured: any[] }}
 */
function createArtistLibraryAlbums(d) {
  const { canonArtist, applyCreditIdentities } = d;
  // An artist's albums in the snapshot: their own (`primary`) and the ones they
  // appear on (`featured`), each A→Z. Zero Core calls. Shared by the artist page
  // and, since v1.9.3, the album view's "More by" and "Appears on" and Last.fm's
  // "is this artist in the library".
  //
  // EQUALITY on whole credited names, never substring: "jordan prince" and
  // 'bonnie "prince" billy' both CONTAIN "prince" and used to be listed as
  // Prince appearances. An empty query is refused for the same reason
  // albumKey() refuses blank titles — a punctuation-only name normalises to ""
  // and would otherwise match the entire library.
  /** @param {string} artist */
  function artistLibraryAlbums(artist) {
    /** @type {any[]} */
    const primary = [], featured = [];
    const q = canonArtist(artist);
    if (!q || !d.count()) return { primary, featured };
    for (const al of d.albums()) {
      if (al.cArtist === undefined) applyCreditIdentities(al);   // record built outside the pass
      const names = al.cCredits;
      if (names ? !names.includes(q) : al.cArtist !== q) continue;
      // Credited as the whole credit or the lead artist → their own album;
      // credited further along → an appearance.
      if (q === al.cArtist || q === al.cFirst) primary.push(al);
      else featured.push(al);
    }
    primary.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    featured.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    return { primary, featured };
  }
  return artistLibraryAlbums;
}

/**
 * @param {{ get: Function }} app
 * @param {{ artistLibraryAlbums: (artist: string) => { primary: any[], featured: any[] }, slimAlbum: (al: any) => any,
 *           splitCreditIntoArtists: (credit: string) => string[], normalize: (s: string) => string }} d
 */
function mountArtistAlbums(app, d) {
  const { artistLibraryAlbums, slimAlbum, splitCreditIntoArtists, normalize } = d;
  app.get("/api/artist-albums", (/** @type {any} */ req, /** @type {any} */ res) => {
    const artist = (req.query.artist || "").trim();
    if (!artist) return res.status(400).json({ error: "artist required" });
    const { primary, featured } = artistLibraryAlbums(artist);
    res.json({ artist, primary: primary.map(slimAlbum), featured: featured.map(slimAlbum) });
  });

  // The album view's "More by <artist>" and "<artist> appears on" (v1.9.3): the
  // album's lead artist's other albums, and the albums they appear on. The lead
  // artist is the first of the library-validated split the album view's artist
  // links use, so the section is about the name the first link shows.
  app.get("/api/album/more", (/** @type {any} */ req, /** @type {any} */ res) => {
    const title = String(req.query.title || "").trim();
    const credit = String(req.query.artist || "").trim();
    if (!credit) return res.status(400).json({ error: "artist required" });
    const artist = splitCreditIntoArtists(credit)[0] || credit;
    const { primary, featured } = artistLibraryAlbums(artist);
    // Not the album being looked at: same title AND same credit. Two albums of
    // one title by one act (a reissue) both stay — they are different records.
    const tN = normalize(title), cN = normalize(credit);
    let skipped = false;
    const others = primary.filter((/** @type {any} */ al) => {
      if (!skipped && normalize(al.title || "") === tN && normalize(al.subtitle || "") === cN) {
        skipped = true;
        return false;
      }
      return true;
    });
    res.json({ artist, by: others.map(slimAlbum), appears: featured.map(slimAlbum) });
  });
}

module.exports = { createArtistLibraryAlbums, mountArtistAlbums };
