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
const { field, plain, isRef } = require("./objects");
const { brokerIdCandidates } = require("./brokerid");
const { SIG, guarded, openAlbumQuery } = require("./methods");
const { pageThrough } = require("./paging");
const { readCount, imageKeyOf } = require("./locations");
const { connectFirst, readRoot } = require("./session");

/** A page's row for an album: its Data is the album (as locations.js reads it). */
const ALBUM_ROW = /(?:^|\.)VirtualQueryElement<(?:Sooloos\.Broker\.Api\.)?AlbumLite>$/;

/**
 * @typedef {{ oid: string, title: string, artist: string, contentSource: number | null, imageKey: string | null }} RoonAlbum
 * @typedef {{ ok: true, albums: RoonAlbum[], count: number, pages: number, ms: number, lifetime: any }} ReadOk
 * @typedef {{ ok: false, why: string, ms: number, lifetime: any }} ReadFailed
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
 * @param {{ g: ReturnType<typeof guarded>, graph: import("./objects").ObjectGraph, root: { library: any, profileId: Buffer | null } }} s
 * @param {{ timeoutMs?: number, pageSize?: number, countGraceMs?: number }} o
 * @returns {Promise<ReadOk | ReadFailed>}
 */
async function readAlbumsOn(s, o) {
  const started = Date.now();
  const lifetime = { pagesRetained: 0, pagesReleased: 0, queriesOpened: 0, queriesDisposed: 0, unsent: 0 };
  /** @param {string} why @returns {ReadFailed} */
  const fail = (why) => ({ ok: false, why, ms: Date.now() - started, lifetime });
  const timeoutMs = o.timeoutMs || 10000;
  const pageSize = o.pageSize || 100;
  const { g, graph, root } = s;
  /** @type {bigint | null} */
  let q = null;
  try {
    if (!root.library) return fail("The Core's graph arrived without its Library.");
    if (!root.profileId) return fail("The Core's graph arrived without a profile.");
    q = await openAlbumQuery(g, root.library.oid, root.profileId, null, pageSize);
    lifetime.queriesOpened++;
    const qid = q;
    const c = await readCount(graph, qid, timeoutMs, o.countGraceMs);
    if ("error" in c) return fail(`The album list's ${c.error}.`);
    // A Count left out reads as 0 (a sparse 0) — believed only of a Library
    // that holds no albums either; otherwise it is a Count that never came.
    const held = Number(plain(field(root.library, "AlbumCount")) || 0);
    if (c.inferred && held > 0) return fail(`The album list's count never arrived, though the Library holds ${held} albums.`);
    const count = c.count;

    /** @type {RoonAlbum[]} */
    const albums = [];
    /** Albums read (and dropped from the graph), by object id. @type {Set<string>} */
    const read = new Set();
    /** Each album's row, to drop with it. @type {Map<string, bigint>} */
    const rowOf = new Map();
    /**
     * An album has arrived once its fields have: its Title, or — for an
     * album whose title is empty, and so left out — its ContentSource.
     * @param {string} id
     */
    const loaded = (id) => {
      if (read.has(id)) return true;
      const a = graph.get(BigInt(id));
      return field(a, "Title") !== undefined || field(a, "ContentSource") !== undefined;
    };
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
          const cs = plain(field(a, "ContentSource"));
          albums.push({ oid: id, title: String(field(a, "Title") || ""), artist: String(field(a, "PerformedBy") || ""),
            contentSource: typeof cs === "number" ? cs : null, imageKey: imageKeyOf(graph, a) });
          read.add(id);
          // Its Image is kept: one may be shared by several albums.
          graph.forget(BigInt(id));
          graph.forget(row);
        }
        rowOf.clear();
      },
    });
    if (paged.error) return fail(paged.error.replace(/^the Core/, "The Core") + ".");
    if (!whole || paged.short) return fail(`The album list came short: ${read.size} of ${count} albums arrived with their details.`);
    // More than the Count (the library changed while it was read), or fewer: not the library.
    if (albums.length !== count) return fail(`The album list did not match its count: ${albums.length} albums for ${count}.`);
    if (graph.decodeErrors) return fail(`${graph.decodeErrors} message(s) from the Core could not be read: Roon may have changed its protocol.`);
    if (graph.overflowed) return fail("The Core sent more than Rouen keeps in memory for one read.");
    return { ok: true, albums, count, pages: paged.pages, ms: Date.now() - started, lifetime };
  } catch (e) {
    return fail(String(e && e.message || e));
  } finally {
    if (q !== null) {
      if (g.callNoReply(q, SIG.albumDispose, Buffer.alloc(0))) lifetime.queriesDisposed++;
      else lifetime.unsent++;
    }
  }
}

module.exports = { readAlbums, readAlbumsOn };
