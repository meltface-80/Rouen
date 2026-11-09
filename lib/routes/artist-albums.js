// @ts-check
"use strict";
/*
 * artist-albums.js — an artist's albums in the library, and the routes that show them: the artist page's and the
 * album view's "More by" / "Appears on" (v1.9.3). Moved out of index.js in v2.0.3-t3, unchanged (dev/quality.md,
 * "Splitting the monoliths"); index.js keeps slimAlbum, which the Last.fm routes share.
 *
 *   GET /api/artist-albums?artist=       → { artist, primary: [tile], featured: [tile] }
 *   GET /api/album/more?title=&artist=   → { artist, by: [tile], appears: [tile] }
 *   GET /api/artist/appears-on?artist=   → { status, albums: [tile + roles] }   (v2.0.3-t3, dev/design/plays-on.md §2, §6)
 *       status "ok": the library records that credit the artist, as your server credits them (native mode), each a
 *       tile with its roles ("Played", "Produced", "Wrote"; "Featured" for one only the album's artist line names);
 *       "pending" (still being read: ask again), "unresolved" (none of their albums leads to a performer), "off",
 *       "failed": no list, and the artist page keeps "Also appears on" as it was
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

/** A record's roles, in the order the page shows them; a record's place in the list is its first role's. */
const ROLE_ORDER = Object.freeze(["Played", "Produced", "Wrote", "Featured"]);

/**
 * The records the server credits the artist on, as the library's own tiles: matched to the record Rouen plays (tileOf,
 * its offset as of this request), the artist's own albums left out (they head the page), one tile per record with every
 * role it has, and every album whose artist line names them further along (today's "Also appears on") kept — a
 * "Featured" record the server does not credit is still shown, so nothing the page showed before is lost. Ordered by
 * first role, then artist, then title. Pure.
 * @param {Array<{ title: string, artist: string, roles: string[] }>} found
 * @param {{ tileOf: (title: string, artist: string) => any, own: Set<any>, featured: any[], slimAlbum: (al: any) => any }} d
 *   own: the offsets of the artist's own albums
 * @returns {{ albums: any[], notInLibrary: number }}
 */
function appearsTiles(found, d) {
  /** @type {Map<any, any>} */
  const byOffset = new Map();
  let notInLibrary = 0;
  for (const f of found) {
    const t = d.tileOf(f.title, f.artist);
    if (!t) { notInLibrary++; continue; }
    if (d.own.has(t.offset)) continue;
    const e = byOffset.get(t.offset);
    if (e) { for (const r of f.roles) if (!e.roles.includes(r)) e.roles.push(r); }
    else byOffset.set(t.offset, Object.assign({}, t, { roles: f.roles.slice() }));
  }
  for (const al of d.featured) {
    if (d.own.has(al.offset) || byOffset.has(al.offset)) continue;
    byOffset.set(al.offset, Object.assign({}, d.slimAlbum(al), { roles: ["Featured"] }));
  }
  const at = (/** @type {string} */ r) => { const i = ROLE_ORDER.indexOf(r); return i < 0 ? ROLE_ORDER.length : i; };
  const albums = [...byOffset.values()];
  for (const e of albums) e.roles.sort((/** @type {string} */ a, /** @type {string} */ b) => at(a) - at(b));
  const rank = (/** @type {any} */ e) => (e.roles.length ? at(e.roles[0]) : ROLE_ORDER.length);
  albums.sort((a, b) => rank(a) - rank(b) || (a.subtitle || "").localeCompare(b.subtitle || "") || (a.title || "").localeCompare(b.title || ""));
  return { albums, notInLibrary };
}

/**
 * @param {{ get: Function }} app
 * @param {{ artistLibraryAlbums: (artist: string) => { primary: any[], featured: any[] }, slimAlbum: (al: any) => any,
 *           splitCreditIntoArtists: (credit: string) => string[], normalize: (s: string) => string,
 *           appearsOn?: (artist: string) => Promise<{ status: string, albums?: Array<{ title: string, artist: string, roles: string[] }>, why?: string, capped?: boolean }>,
 *           tileOf?: (title: string, artist: string) => any }} d
 *   appearsOn: native mode's read (lib/roon-direct/appears-on.js); tileOf: the library record a title and artist name, as a tile
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

  // The artist page's "Appears on" (v2.0.3-t3, dev/design/plays-on.md): every record the server credits the artist on,
  // in place of "Also appears on" when native mode answers. Tiles are made at each request, so their offsets are the
  // library's as it is now; the server's own answer is kept per artist (appears-on.js).
  app.get("/api/artist/appears-on", async (/** @type {any} */ req, /** @type {any} */ res) => {
    res.set("Cache-Control", "no-store");
    const artist = String((req.query && req.query.artist) || "").trim();
    if (!artist) return res.status(400).json({ error: "artist required" });
    if (!d.appearsOn || !d.tileOf) return res.json({ status: "off", albums: [] });
    try {
      const got = await d.appearsOn(artist);
      if (got.status !== "ok" || !Array.isArray(got.albums)) return res.json(Object.assign({ status: got.status, albums: [] }, got.why ? { why: got.why } : {}));
      const { primary, featured } = artistLibraryAlbums(artist);
      const t = appearsTiles(got.albums, { tileOf: d.tileOf, own: new Set(primary.map((/** @type {any} */ a) => a.offset)), featured, slimAlbum });
      res.json(Object.assign({ status: "ok", albums: t.albums }, t.notInLibrary ? { notInLibrary: t.notInLibrary } : {}, got.capped ? { capped: true } : {}));
    } catch (e) {
      // The page keeps "Also appears on" on any answer but "ok"; this one says why.
      res.json({ status: "failed", albums: [], why: String(e && /** @type {any} */ (e).message) });
    }
  });
}

module.exports = { createArtistLibraryAlbums, mountArtistAlbums, appearsTiles, ROLE_ORDER };
