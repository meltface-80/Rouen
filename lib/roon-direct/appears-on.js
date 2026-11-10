// @ts-check
"use strict";
/*
 * appears-on.js — the records in the library that credit an artist, read from your server the way Roon's own artist page
 * reads them, for the artist page's "Appears on" (dev/design/plays-on.md §6, v2.0.3-t3). The probe's mechanism
 * (plays-on-probe.js, proven on the owner's server in v2.0.3-t1 and -t2) made a read:
 *
 *   1. the artist resolved to a Performer from a library album that is theirs (resolvePerformer: its lead, its name the
 *      artist's) — an artist who leads none is "unresolved", and the page keeps what it showed before;
 *   2. one Library::VirtualAlbumQuery per credit kind the owner chose (decision 2), Require… = [that performer]: main
 *      performer and performer ("Played"), production ("Produced"), composer ("Wrote");
 *   3. every page read, to a cap, and released; the query disposed; a Count as large as the library is the criterion
 *      misread or ignored (plays-on.md §4), never an appearance list, and gives nothing;
 *   4. each record named from the library records Rouen holds, by Roon object id (the album objects themselves are not
 *      in the graph after the library read, and the server does not push them again: v2.0.3-t2), one per record with
 *      every role it has.
 *
 * Read only: nothing is written to Roon. Kept per artist until the library is read again (its records are a new Map
 * then) and for a day at most; a read already running for an artist is shared, not doubled; a caller can wait a while
 * and be told "pending" past it, the read going on.
 */
const { field, isRef } = require("./objects");
const { SIG, openAlbumQueryByPerformer } = require("./methods");
const { profileFor } = require("./session");
const { pageThrough } = require("./paging");
const { readCount } = require("./locations");
const { resolvePerformer, normName } = require("./plays-on-probe");
const { noRoom } = require("./find");

/** The credit kinds read, in order, and the role each gives a record. */
const KINDS = /** @type {ReadonlyArray<["mainPerformers"|"performers"|"production"|"composers", string]>} */ (Object.freeze([
  ["mainPerformers", "Played"], ["performers", "Played"], ["production", "Produced"], ["composers", "Wrote"]]));
const ROLE_ORDER = Object.freeze(["Played", "Produced", "Wrote"]);
const PAGE_SIZE = 100, MAX_PAGES = 5, TIMEOUT_MS = 8000, KEEP_MS = 24 * 3600 * 1000;
// A kind's Count arrives with its query when there is one; a kind with none (the server leaves a 0 out, roon-native.md
// §9.1) is read as 0 after this much more, not the probe's 3 s, so an artist with two empty kinds doesn't hold the turn
// for six seconds (the review). A read whose turn comes this long after it was asked is not made: no one is waiting.
const COUNT_GRACE_MS = 1500, STALE_MS = 30000;
/** A page's row for an album: its Data is the album (as locations.js reads them). */
const ALBUM_ROW = /(?:^|\.)VirtualQueryElement<(?:Sooloos\.Broker\.Api\.)?AlbumLite>$/;

/**
 * @typedef {{ title: string, artist: string, roles: string[] }} Appearance
 * @typedef {{ status: "ok", albums: Appearance[], capped?: boolean, unnamed?: number }
 *   | { status: "unresolved" | "off" | "failed" | "pending", why?: string, again?: boolean }} Answer  again: an
 *   "unresolved" that a later read may resolve (no lead album, no credit naming them yet), not kept
 */

/**
 * Each kind's records → one per record with all its roles, in ROLE_ORDER; a record with no library record (not expected
 * on a library query) is counted, once, and left out. Pure.
 * @param {Array<{ role: string, oids: string[] }>} perKind
 * @param {Map<string, { title: string, artist: string }>} byOid
 * @returns {{ albums: Appearance[], unnamed: number }}
 */
function mergeRoles(perKind, byOid) {
  /** @type {Map<string, { title: string, artist: string, roles: Set<string> }>} */
  const recs = new Map();
  /** @type {Set<string>} */
  const unnamed = new Set();
  for (const { role, oids } of perKind) {
    for (const oid of oids) {
      const r = byOid.get(oid);
      if (!r) { unnamed.add(oid); continue; }
      let e = recs.get(oid);
      if (!e) recs.set(oid, (e = { title: r.title, artist: r.artist, roles: new Set() }));
      e.roles.add(role);
    }
  }
  const albums = [...recs.values()].map((e) => ({ title: e.title, artist: e.artist, roles: ROLE_ORDER.filter((x) => e.roles.has(x)) }));
  return { albums, unnamed: unnamed.size };
}

/**
 * One credit kind's records, by object id: the query opened, counted, every page read (to the cap) and released, the
 * query disposed exactly once whatever happens.
 * @param {any} s  the session @param {bigint} libraryOid @param {Buffer} profileId
 * @param {"mainPerformers"|"performers"|"production"|"composers"} kind @param {bigint[]} pid @param {number} librarySize
 * @param {{ pageSize?: number, maxPages?: number, timeoutMs?: number, countGraceMs?: number }} [o]
 * @returns {Promise<{ oids: string[], capped: boolean, misread?: number }>}  throws what a call throws, a refused page,
 *   a Count that is not one
 */
async function kindOids(s, libraryOid, profileId, kind, pid, librarySize, o = {}) {
  const pageSize = o.pageSize ?? PAGE_SIZE, maxPages = o.maxPages ?? MAX_PAGES, timeoutMs = o.timeoutMs ?? TIMEOUT_MS;
  const countGraceMs = o.countGraceMs ?? COUNT_GRACE_MS;
  const lifetime = { queriesOpened: 0, queriesDisposed: 0, pagesRetained: 0, pagesReleased: 0, unsent: 0 };
  /** @type {bigint | null} */
  let q = null;
  try {
    q = await openAlbumQueryByPerformer(s.g, libraryOid, profileId, kind, pid, pageSize);
    const r = await readCount(s.graph, q, timeoutMs, countGraceMs);
    if ("error" in r) throw new Error(`${kind}: ${r.error}`);
    // No Count member: the server sends a Count of 0 by leaving it out (roon-native.md §9.1).
    const count = r.inferred ? 0 : r.count;
    if (!count) return { oids: [], capped: false };
    if (count >= librarySize) return { oids: [], capped: false, misread: count };
    const paged = await pageThrough(s.g, s.graph, q, count, {
      pageSize, timeoutMs, lifetime, retain: SIG.albumRetainPage, release: SIG.albumReleasePage, stopWhenShort: true, maxPages,
      take: (obj) => { if (ALBUM_ROW.test(obj.typeName)) { const d = field(obj, "Data"); return isRef(d) ? d.$ref.toString() : null; } return null; },
    });
    if (paged.error) throw new Error(`${kind}: ${paged.error}`);
    // A page that didn't arrive in time is a partial list, never kept as the whole one (the review).
    if (paged.short && paged.seen.size < Math.min(count, pageSize * maxPages)) throw new Error(`${kind}: a page of its records didn't arrive in time`);
    return { oids: [...paged.seen], capped: count > pageSize * maxPages };
  } finally {
    if (q !== null) s.g.callNoReply(q, SIG.albumDispose, Buffer.alloc(0));
  }
}

/**
 * A performer the connection holds already by the artist's name (2.0.4-t7, plays-on.md §3.1): the PerformerLites an
 * album's credits brought (credits.js, the album page's Credits), or a Performer read whole. Exactly one of that name
 * gives its object's id; none, or two of one name (two people), gives null — never a guess. Pure.
 * @param {any} graph @param {string} artist
 * @returns {string | null}
 */
function performerByName(graph, artist) {
  const want = normName(artist);
  if (!want || !graph || !graph.objects) return null;
  /** @type {Set<string>} */
  const ids = new Set();
  for (const [id, o] of graph.objects) {
    if (!o || !o.loaded || !/(?:^|\.)Performer(?:Lite)?$/.test(String(o.typeName))) continue;
    const name = field(o, "Name");
    if (typeof name === "string" && normName(name) === want) ids.add(String(id));
  }
  return ids.size === 1 ? [...ids][0] : null;
}

/**
 * The read itself, on one session, inside the connection's turn.
 * @param {any} s @param {Map<string, import("./albums").RoonAlbum>} known @param {string} artist @param {string | null} profile
 * @param {(line: string) => void} log
 * @returns {Promise<Answer>}
 */
async function readArtist(s, known, artist, profile, log) {
  const full = noRoom(s);
  if (full) return { status: "failed", why: full };
  const { root } = s;
  if (!root.library || !root.profileId) return { status: "failed", why: "The server's graph arrived without its Library or a profile." };
  if (s.g.uncertain()) return { status: "failed", why: "An earlier call went unanswered." };
  /** @type {any} */
  let resolved = await resolvePerformer(s, known, artist);
  // No album of theirs leads: a musician on others' records only (gert_mogensen, the Roon forum, 2026-11-10: "it shows
  // nothing unless the musicians has a solo record"). The performer an album's credits brought, by name (2.0.4-t7).
  if (!resolved.performer && !("from" in resolved)) {
    const byName = performerByName(s.graph, artist);
    if (byName) resolved = { performer: byName, name: artist, from: null };
  }
  if (!resolved.performer) {
    // Kept for the day only when it is so: they lead no library album and no credit read names them, or the album's
    // lead is someone else. A refused or unanswered GetAlbum is a passing failure, asked again next time (the review).
    // Not kept (again): a credit naming them may be read later on this connection, the album page's Credits opened.
    if (!("from" in resolved)) return { status: "unresolved", again: true, why: `No album in your library is led by "${artist}", and no credit read on this connection names them.` };
    if ("resolvedTo" in resolved) return { status: "unresolved", why: `Their album resolved to "${resolved.resolvedTo}", not "${artist}".` };
    return { status: "failed", why: resolved.error || "No performer for the artist." };
  }
  const pid = [BigInt(resolved.performer)];
  const profileId = /** @type {Buffer} */ (profileFor({ profiles: root.profiles || [], profileId: root.profileId }, profile));
  /** @type {Map<string, { title: string, artist: string }>} */
  const byOid = new Map();
  for (const a of known.values()) byOid.set(String(a.oid), a);
  /** @type {Array<{ role: string, oids: string[] }>} */
  const perKind = [];
  let capped = false;
  for (const [kind, role] of KINDS) {
    if (s.g.uncertain()) return { status: "failed", why: "An earlier call went unanswered." };
    const got = await kindOids(s, root.library.oid, profileId, kind, pid, known.size);
    if (got.misread !== undefined) log(`appears on: ${kind} for "${artist}" counted ${got.misread} of ${known.size} — taken as misread, left out`);
    capped = capped || got.capped;
    perKind.push({ role, oids: got.oids });
  }
  const merged = mergeRoles(perKind, byOid);
  return Object.assign({ status: /** @type {"ok"} */ ("ok"), albums: merged.albums }, capped ? { capped } : {}, merged.unnamed ? { unnamed: merged.unnamed } : {});
}

/**
 * @param {{ link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>, off: () => string | null,
 *           known: (session: any) => Map<string, import("./albums").RoonAlbum> | null, profile: () => string | null,
 *           log?: (line: string) => void, now?: () => number,
 *           read?: (s: any, known: Map<string, any>, artist: string) => Promise<Answer> }} deps
 *   read: stands in for readArtist in tests
 */
function createAppearsOn(deps) {
  const log = deps.log || (() => {});
  const now = deps.now || Date.now;
  const read = deps.read || ((s, known, artist) => readArtist(s, known, artist, deps.profile(), log));
  /** Per library read (its records' Map), per artist. @type {WeakMap<object, Map<string, { at: number, value: Answer }>>} */
  const kept = new WeakMap();
  /** @type {Map<string, Promise<Answer>>} */
  const running = new Map();

  /** @param {string} artist @returns {Promise<Answer>} */
  const readNow = (artist) => { const asked = now(); return deps.inTurn(async () => {
    if (now() - asked > STALE_MS) return { status: "failed", why: "Asked too long ago; ask again." };
    const s = deps.link ? deps.link.session() : null;
    const known = s ? deps.known(s) : null;
    if (!s || !known) return { status: "off", why: deps.off() || "Native mode isn't connected to your server right now." };
    const value = await read(s, known, artist);
    // What this library read gives the artist, kept: their records ("ok") or that none of theirs leads an album.
    if (value.status === "ok" || (value.status === "unresolved" && !value.again)) {
      let byArtist = kept.get(known);
      if (!byArtist) kept.set(known, (byArtist = new Map()));
      byArtist.set(normName(artist), { at: now(), value });
    }
    return value;
  }); };

  return {
    /**
     * The artist's records in the library, by credit. waitMs: how long to wait for a read not kept; past it "pending",
     * the read going on (and kept when it ends).
     * @param {string} artist @param {{ waitMs?: number }} [o] @returns {Promise<Answer>}
     */
    async read(artist, o = {}) {
      const why = deps.off();
      if (why) return { status: "off", why };
      const key = normName(artist);
      if (!key) return { status: "unresolved", why: "No name to look for." };
      const s = deps.link ? deps.link.session() : null;
      const known = s ? deps.known(s) : null;
      const hit = known ? (kept.get(known) || new Map()).get(key) : undefined;
      if (hit && now() - hit.at < KEEP_MS) return hit.value;
      let p = running.get(key);
      if (!p) {
        p = readNow(artist)
          .catch((e) => /** @type {Answer} */ ({ status: "failed", why: String(e && /** @type {any} */ (e).message) }))
          .finally(() => { running.delete(key); });
        running.set(key, p);
      }
      if (!o.waitMs) return p;
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let timer;
      const waited = new Promise((res) => { timer = setTimeout(() => res({ status: "pending" }), o.waitMs); });
      try { return await Promise.race([p, /** @type {Promise<Answer>} */ (waited)]); }
      finally { clearTimeout(timer); }
    },
  };
}

module.exports = { performerByName, createAppearsOn, readArtist, kindOids, mergeRoles, KINDS, ROLE_ORDER };
