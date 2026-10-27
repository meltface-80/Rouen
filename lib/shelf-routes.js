// @ts-check
"use strict";
/*
 * shelf-routes.js — the Shelf screen's two routes, moved out of index.js in
 * v1.9.10 (dev/quality.md, "Splitting the monoliths"): the page itself
 * (/shelf) and the whole library it flicks through (/api/shelf/albums).
 * Behaviour as it was, plus each album's year for the Years tab.
 *
 * index.js still owns the snapshot, the genre and year caches and the live
 * revisions; it hands this module the functions that read them, so nothing
 * here holds library state of its own except the answer it keeps.
 */
const path = require("node:path");
const { buildShelf, shelfSignature, stampOf } = require("./shelf");
const { KINDS } = require("./release-facts");

/**
 * @typedef {object} ShelfDeps
 * @property {string} publicDir                  where shelf.html lives
 * @property {() => boolean} canServe            paired with a Core, or a snapshot exists to serve
 * @property {() => Promise<void>} ensureIndex   index.js's ensureAlbumIndex
 * @property {() => boolean} isIndexBuilt
 * @property {() => string} stateKey            changes whenever anything the shelf shows may have
 * @property {() => string} libraryRev          /api/live's library revision
 * @property {(q: object) => Array} libraryView  index.js's libraryView
 * @property {(al: any) => string[]} genresOf
 * @property {(al: any) => string} firstOf
 * @property {(al: any) => (number|null)} yearOf
 * @property {(al: any) => (string|null)} [labelOf]   its record label (v1.9.67)
 * @property {(al: any) => (string|null)} [catOf]     its catalogue number
 * @property {(al: any) => (string|null)} [formatOf] what its files are, or its service (v1.9.68)
 * @property {(al: any) => (string[]|null)} [typeOf]  what kinds of release it is (several at once since v1.9.67-t4)
 */

/**
 * @param {{ get: Function }} app  the Express app
 * @param {ShelfDeps} deps
 */
function mountShelf(app, deps) {
  // Shelf (v1.9.1): flick through the library like a record shop's racks. A
  // page of its own, beside the wall display and the remote, that each of them
  // reaches in one tap. Not behind the wall display's switch — it shows nothing
  // the remote doesn't, and on a tablet it is a way to choose records, not a
  // screen left on the wall.
  app.get("/shelf", (req, res) => {
    res.sendFile(path.join(deps.publicDir, "shelf.html"));
  });

  // The whole library in one answer, in the artist order a shop files by, with
  // every album's genres, the letter its artist sits under and its year.
  // lib/shelf.js says why it is one list rather than a page per filter.
  // Snapshot only — zero Core calls on this route, however long it is flicked
  // through.
  //
  // Built once per state of what it is made of — the snapshot (titles,
  // credits, art, the artist order), the genres and, since the Years tab
  // (v1.9.10), the years — and kept. Every open Shelf asks again when
  // /api/live's library revision moves, and that revision also moves for
  // things the shelf does not show (a badge, a label); those rebuild at most
  // once per coalesced bump, and the signature below still answers `same`
  // when nothing the shelf shows has changed. A Shelf that sends back the
  // signature it has is told `same` in a few bytes rather than being sent the
  // whole library again. (Shelf's zone polling does count as an open app for
  // the library watch, as the remote's and the wall display's do.)
  // The formats (v1.9.68) are not in the state key: they move with every file walk, service harvest and source
  // change, which index.js has no stamp of its own for. So the answer keeps the albums it was made of, and is made
  // again when their formats, read afresh, no longer match it — the library itself read again only then.
  const formatsOf = (/** @type {any[]} */ albums) => (deps.formatOf ? stampOf(albums, deps.formatOf) : 0);
  /** @type {{ key: string, fm: number, albums: any[], sig: string, shelf: ReturnType<typeof buildShelf> } | null} */
  let answer = null;
  app.get("/api/shelf/albums", async (req, res) => {
    if (!deps.canServe()) return res.status(503).json({ error: "Not paired with Roon Core yet" });
    try {
      await deps.ensureIndex();
      if (!deps.isIndexBuilt()) return res.status(503).json({ error: "Library index is still building" });
      const rev = deps.libraryRev();
      const key = deps.stateKey();
      if (!answer || answer.key !== key || answer.fm !== formatsOf(answer.albums)) {
        const albums = deps.libraryView({ sort: "artist" });
        const shelf = buildShelf(albums, {
          genresOf: deps.genresOf,
          firstOf: deps.firstOf,
          yearOf: deps.yearOf,
          // its label, catalogue number and kind (v1.9.67): the Labels and Types tiles, the label order, the spine
          labelOf: deps.labelOf,
          catOf: deps.catOf,
          typeOf: deps.typeOf,
          formatOf: deps.formatOf,
        });
        answer = { key, fm: formatsOf(albums), albums, sig: shelfSignature(shelf), shelf };
      }
      // `rev` is /api/live's library revision as of this answer: the page polls
      // that and asks again only when it moves.
      if (req.query.sig && String(req.query.sig) === answer.sig) return res.json({ same: true, rev, sig: answer.sig });
      // kinds (v1.9.67): what a release can be, named once here (lib/release-facts.js), so the page keeps no copy.
      res.json(Object.assign({ total: answer.shelf.albums.length, rev, sig: answer.sig, kinds: KINDS }, answer.shelf));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

module.exports = { mountShelf };
