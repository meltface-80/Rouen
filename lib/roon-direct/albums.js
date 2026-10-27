// @ts-check
"use strict";
/*
 * albums.js — stage 1's read (dev/design/roon-native.md §10.2): every album
 * the Core lists, with what stage 1 needs of each — its title and artist (to
 * find it in Rouen's index), its ContentSource (its source) and its cover key
 * (reported, not matched by).
 *
 *   one connection (session.js), the root service, then one
 *   Library::VirtualAlbumQuery with no criterion — stage 0's control query —
 *   paged through its whole Count (paging.js): each page retained, its rows'
 *   Data read once their fields have arrived, released; the query disposed;
 *   the connection closed.
 *
 * Only methods stage 0 already ran on the owner's Core are called (§4). Each
 * page's albums and rows are read into plain records and dropped from this
 * side's copy of the graph (objects.js forget), so a library of 13,000 albums
 * never holds more than a page of them there (their covers, which albums may
 * share, are kept).
 *
 * A read is whole only when every album of the Count arrived with its fields.
 * Anything less — a page refused or short, a call timed out, a decode error,
 * the graph's cap reached — is a failure with a reason, and nothing of it is
 * returned: a partial read must never pass for the library (§10.4).
 */
const { formatOf, ownRefs, genresOf } = require("./album-facts");
const { field, plain, isRef } = require("./objects");
const { brokerIdCandidates } = require("./brokerid");
const { SIG, guarded, openAlbumQuery } = require("./methods");
const { pageThrough } = require("./paging");
const { readCount, imageKeyOf } = require("./locations");
const { connectFirst, readRoot, profileFor } = require("./session");
const { profileBool } = require("./profile-data");

/** A page's row for an album: its Data is the album (as locations.js reads it). */
const ALBUM_ROW = /(?:^|\.)VirtualQueryElement<(?:Sooloos\.Broker\.Api\.)?AlbumLite>$/;

/**
 * An album sent in full: its Title, or — for an album whose title is empty, and so left out — its
 * ContentSource. Anything less is a push of one field (a favourite), not the album (find.js too).
 * @param {any} a
 */
const sentWhole = (a) => field(a, "Title") !== undefined || field(a, "ContentSource") !== undefined;

/**
 * @typedef {{ oid: string, title: string, artist: string, contentSource: number | null, imageKey: string | null,
 *             albumId: string | null, favorite: boolean | null, format?: import("./album-facts").AlbumFormat | null,
 *             genres?: string[] | null }} RoonAlbum
 *   albumId: the album's stable id (its AlbumId), which a heart names it by (native-remote.md §8.2);
 *   favorite: its IsFavorite for Rouen's profile, null when that did not come or could not be read; format, genres: its
 *   AlbumFormat and genres as the page sent them (v1.9.70-t5, shelf-focus.md §2), null when they didn't come
 * @typedef {{ ok: true, albums: RoonAlbum[], count: number, pages: number, ms: number, lifetime: any }} ReadOk
 * @typedef {{ ok: false, why: string, ms: number, lifetime: any, seen?: RoonAlbum[] }} ReadFailed
 *   seen: the albums a read on a held session (readAlbumsOn) did read before it failed — let go from
 *   the graph and not sent again on that connection, so the next read there is given them (v1.9.28)
 */

/**
 * @param {object} o
 * @param {string} o.host
 * @param {string} o.coreId          from the public API's pairing
 * @param {number} [o.port]
 * @param {number} [o.timeoutMs]     one call, the handshake, or one page's wait
 * @param {number} [o.settleMs]
 * @param {number} [o.pageSize]
 * @param {number} [o.countGraceMs]
 * @param {number} [o.maxObjects]    the graph's cap (tests lower it)
 * @returns {Promise<ReadOk | ReadFailed>}
 */
async function readAlbums(o) {
  const started = Date.now();
  const lifetime = { pagesRetained: 0, pagesReleased: 0, queriesOpened: 0, queriesDisposed: 0, unsent: 0 };
  /** @param {string} why @returns {ReadFailed} */
  const fail = (why) => ({ ok: false, why, ms: Date.now() - started, lifetime });
  const timeoutMs = o.timeoutMs || 10000;

  const candidates = brokerIdCandidates({ coreId: o.coreId });
  if (!candidates.length) return fail("Rouen has no core id from its pairing to connect with.");
  const first = await connectFirst({ host: o.host, port: o.port || 9332, timeoutMs, candidates, maxObjects: o.maxObjects });
  if (!first.session) return fail(`The Core refused the connection (${first.tried.map((t) => t.error).filter(Boolean).join("; ") || "no reason given"}).`);
  const session = first.session;
  const g = guarded(session.remoting);
  try {
    const root = await readRoot(g, session.graph, o.settleMs || 6000);
    const r = await readAlbumsOn({ g, graph: session.graph, root }, o);
    return Object.assign(r, { ms: Date.now() - started });
  } catch (e) {
    return fail(String(e && e.message || e));
  } finally {
    session.graph.onObject = () => {};
    session.close();
  }
}

/**
 * The read itself, on a session already open — readAlbums' own, or the
 * native remote's one connection (link.js, v1.9.21), whose objects it leaves
 * as it found them but for the pages it read, released, and the query it
 * opened, disposed. Each album keeps its object id (`oid`): good for as long
 * as that session is open, and no longer.
 * @param {{ g: ReturnType<typeof guarded>, graph: import("./objects").ObjectGraph, root: { library: any, profileId: Buffer | null, profiles?: any[] } }} s
 * @param {{ timeoutMs?: number, pageSize?: number, countGraceMs?: number, profile?: string | null,
 *           known?: Map<string, RoonAlbum> | null }} o
 *   profile: the id (hex) of the profile chosen in Settings → Native mode, whose hearts are read (v1.9.27);
 *   known: the albums THIS SESSION has been sent, by object id, as the server last said them — never
 *   with Rouen's own hearts written in (v1.9.28). The server sends an album's details once a
 *   connection (the v1.9.17 probe saw pages come "as rows alone"), and this read lets them go once
 *   read, so a second read on the same connection is given rows only: each such album is the one
 *   known, with whatever the server has sent of it since (an update).
 * @returns {Promise<ReadOk | ReadFailed>}
 */
async function readAlbumsOn(s, o) {
  const started = Date.now();
  const lifetime = { pagesRetained: 0, pagesReleased: 0, queriesOpened: 0, queriesDisposed: 0, unsent: 0 };
  /** @param {string} why @returns {ReadFailed} */
  const fail = (why) => ({ ok: false, why, ms: Date.now() - started, lifetime });
  /** @type {RoonAlbum[]} */
  const albums = [];
  /** @param {string} why @returns {ReadFailed} */
  const failSeen = (why) => Object.assign(fail(why), { seen: albums });
  const timeoutMs = o.timeoutMs || 10000;
  const pageSize = o.pageSize || 100;
  const { g, graph, root } = s;
  /** @type {bigint | null} */
  let q = null;
  try {
    if (!root.library) return fail("The Core's graph arrived without its Library.");
    if (!root.profileId) return fail("The Core's graph arrived without a profile.");
    const profileId = /** @type {Buffer} */ (profileFor({ profiles: root.profiles || [], profileId: root.profileId }, o.profile));
    q = await openAlbumQuery(g, root.library.oid, profileId, null, pageSize);
    lifetime.queriesOpened++;
    const qid = q;
    const c = await readCount(graph, qid, timeoutMs, o.countGraceMs);
    if ("error" in c) return fail(`The album list's ${c.error}.`);
    // A Count left out reads as 0 (a sparse 0) — believed only of a Library
    // that holds no albums either; otherwise it is a Count that never came.
    const held = Number(plain(field(root.library, "AlbumCount")) || 0);
    if (c.inferred && held > 0) return fail(`The album list's count never arrived, though the Library holds ${held} albums.`);
    const count = c.count;

    /** Albums read (and dropped from the graph), by object id. @type {Set<string>} */
    const read = new Set();
    /** Each album's row, to drop with it. @type {Map<string, bigint>} */
    const rowOf = new Map();
    /** Arrived: sent in full, or known from the last read on this connection (v1.9.28). @param {string} id */
    const loaded = (id) => read.has(id) || sentWhole(graph.get(BigInt(id))) || !!(o.known && o.known.has(id));
    let whole = true;
    const paged = await pageThrough(g, graph, qid, count, {
      pageSize, timeoutMs, lifetime, retain: SIG.albumRetainPage, release: SIG.albumReleasePage,
      stopWhenShort: true, ready: loaded,
      take: (obj) => {
        if (!ALBUM_ROW.test(obj.typeName)) return null;
        const d = field(obj, "Data");
        if (!isRef(d)) return null;
        rowOf.set(d.$ref.toString(), obj.oid);
        return d.$ref.toString();
      },
      afterPage: (_page, full) => {
        if (!full) { whole = false; return; }
        for (const [id, row] of rowOf) {
          if (read.has(id)) continue;
          const a = graph.get(BigInt(id));
          const favField = field(a, "IsFavorite");
          const known = o.known && o.known.get(id);
          const has = (/** @type {string} */ k) => field(a, k) !== undefined;
          if (known && !has("AlbumId")) {
            // Not sent again (v1.9.28): as known on this connection, with the fields of any update sent
            // since. Never whole — an AlbumId never changes, so only the whole album carries it.
            const fav = favField === undefined ? known.favorite : profileBool(favField, profileId);
            const cs = plain(field(a, "ContentSource"));
            albums.push(Object.assign({}, known, { favorite: fav === undefined ? null : fav,
              title: has("Title") ? String(field(a, "Title")) : known.title,
              artist: has("PerformedBy") ? String(field(a, "PerformedBy")) : known.artist,
              contentSource: typeof cs === "number" ? cs : known.contentSource,
              imageKey: has("Image") ? imageKeyOf(graph, a) : known.imageKey,
              format: (has("AlbumFormat") && formatOf(graph, a)) || known.format || null,
              genres: has("GenreObjects") || has("Genres") ? genresOf(graph, a) : known.genres || null }));
          } else {
            const cs = plain(field(a, "ContentSource"));
            const aid = field(a, "AlbumId");   // raw: an id may not fit a Number, so never plain()
            // Left out: not a favourite of anyone's — a sparse struct leaves its default out, as a Count of 0 is (v1.9.13).
            const fav = favField === undefined ? false : profileBool(favField, profileId);
            albums.push({ oid: id, title: String(field(a, "Title") || ""), artist: String(field(a, "PerformedBy") || ""),
              contentSource: typeof cs === "number" ? cs : null, imageKey: imageKeyOf(graph, a),
              albumId: typeof aid === "bigint" || typeof aid === "number" ? String(aid) : null,
              favorite: fav === undefined ? null : fav, format: formatOf(graph, a), genres: genresOf(graph, a) });
          }
          read.add(id);
          // Its Image is kept: one may be shared by several albums; so are its genres (a few hundred GenreLites in all).
          // Its AlbumFormat and its genres' list go with it, once read: an AlbumFormat the server shares is kept by
          // album-facts.js, not by the graph; the GenreLites, shared, stay.
          for (const r of ownRefs(a)) graph.forget(r);
          graph.forget(BigInt(id));
          graph.forget(row);
        }
        rowOf.clear();
      },
    });
    if (paged.error) return failSeen(paged.error.replace(/^the Core/, "The Core") + ".");
    if (!whole || paged.short) return failSeen(`The album list came short: ${read.size} of ${count} albums arrived with their details.`);
    // More than the Count (the library changed while it was read), or fewer: not the library.
    if (albums.length !== count) return failSeen(`The album list did not match its count: ${albums.length} albums for ${count}.`);
    if (graph.decodeErrors) return failSeen(`${graph.decodeErrors} message(s) from the Core could not be read: Roon may have changed its protocol.`);
    if (graph.overflowed) return failSeen("The Core sent more than Rouen keeps in memory for one read.");
    return { ok: true, albums, count, pages: paged.pages, ms: Date.now() - started, lifetime };
  } catch (e) {
    return failSeen(String(e && e.message || e));
  } finally {
    if (q !== null) {
      if (g.callNoReply(q, SIG.albumDispose, Buffer.alloc(0))) lifetime.queriesDisposed++;
      else lifetime.unsent++;
    }
  }
}

module.exports = { readAlbums, readAlbumsOn, sentWhole };
