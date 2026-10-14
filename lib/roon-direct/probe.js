// @ts-check
"use strict";
/*
 * probe.js — stage 0 of dev/design/roon-native.md: one read-only look at the
 * Core over its internal protocol, run by hand, to learn whether the rest of
 * the design can stand.
 *
 *   1. the handshake, with each broker-id candidate in turn (brokerid.js,
 *      session.js)
 *   2. the root service (session.js): the Core pushes its object graph — its profiles, its
 *      Library service (with its own album and track totals) and its storage
 *      Locations. Read as pushed; no call asks for them.
 *   3. per source (local, TIDAL, Qobuz): Library::VirtualTrackQuery with the
 *      source's criterion, and the query's Count. Where a source has few
 *      enough tracks (maxTracksForAlbums), its pages are read one at a time —
 *      retained, read, released — and the albums its tracks belong to are
 *      counted. Then the query is disposed.
 *   4. the Locations probe (locations.js): an album query per Location the
 *      Core pushed, with RequireLocations, against an unfiltered control —
 *      whether stage 1 can read an album's source without paging its tracks
 *      (§9.1), each Location's Count; then (v1.9.16) the Locations that stand
 *      for a source paged, their albums set against the tracks' and each
 *      album's ContentSource read. Every page released, each query disposed.
 *   5. the connection closed.
 *
 * Every call goes through methods.js's allowlist guard. Every page retained is
 * released exactly once, every query opened is disposed exactly once, before
 * the connection closes — test/unit/roon-direct-probe.test.js holds a fake
 * Core to that. Nothing here writes: no call on the allowlist changes the
 * library.
 *
 * Why tracks: the source criteria (RequireIsLocal / IsTidal / IsQobuz) exist
 * on TrackQueryCriteria only; AlbumQueryCriteria has none (§2, corrected in
 * v1.9.11). An album's source is its tracks'.
 */
const { isRef, field, plain, waitFor } = require("./objects");
const { brokerIdCandidates } = require("./brokerid");
const { SIG, guarded, openTrackQuery } = require("./methods");
const { pageThrough } = require("./paging");
const { probeLocations, describeLocation } = require("./locations");
const { connectFirst, readRoot } = require("./session");

const SOURCE_ORDER = /** @type {const} */ (["local", "tidal", "qobuz"]);

/**
 * @param {object} o
 * @param {string} o.host
 * @param {number} [o.port]
 * @param {string} [o.coreId]            from the public API's pairing
 * @param {string} [o.override]          a broker id given by hand (32 hex)
 * @param {number} [o.timeoutMs]         one call, or the handshake
 * @param {number} [o.settleMs]          how long the graph may take to arrive
 * @param {number} [o.pageSize]
 * @param {number} [o.maxTracksForAlbums]
 * @param {number} [o.countGraceMs]      how long a query with no Count is waited on before it reads as 0
 * @param {number} [o.maxAlbumsForPages] a Location with more albums is not compared: one page is read as a sample
 * @param {number} [o.albumPageBudget]   album pages read in all, across Locations
 */
async function runProbe(o) {
  const port = o.port || 9332;
  const timeoutMs = o.timeoutMs || 10000;
  const settleMs = o.settleMs || 6000;
  const pageSize = o.pageSize || 100;
  const maxTracks = o.maxTracksForAlbums === undefined ? 2000 : o.maxTracksForAlbums;
  const started = Date.now();
  /** @type {any} */
  const out = { ok: false, host: o.host, port, brokerId: { tried: [], used: null }, core: null, sources: {}, calls: [], lifetime: { pagesRetained: 0, pagesReleased: 0, queriesOpened: 0, queriesDisposed: 0, unsent: 0 } };

  const candidates = brokerIdCandidates({ coreId: o.coreId, override: o.override });
  if (!candidates.length) { out.why = "No broker id to try: Rouen has no core_id from a pairing, and none was given (?broker=)."; return out; }

  const first = await connectFirst({ host: o.host, port, timeoutMs, candidates });
  out.brokerId.tried = first.tried;
  out.brokerId.used = first.used;
  const session = first.session;
  if (!session) { out.why = "The Core refused every broker id tried (see brokerId.tried)."; out.ms = Date.now() - started; return out; }

  const g = guarded(session.remoting);
  const graph = session.graph;
  try {
    const root = await readRoot(g, graph, settleMs);
    const profiles = root.profiles;
    const library = root.library;
    const profileId = root.profileId;
    out.core = {
      objects: graph.objects.size,
      profiles: profiles.map((p) => field(p, "Name") || "(unnamed)"),
      profileUsed: profiles.length ? (root.profileName || "(unnamed)") : null,
      library: library ? { albums: plain(field(library, "AlbumCount")), tracks: plain(field(library, "TrackCount")) } : null,
      locations: graph.ofType("Location").map(describeLocation),
    };
    if (!library) { out.why = "The Core's graph arrived without its Library service."; return out; }
    if (!profileId) { out.why = "The Core's graph arrived without a profile id."; return out; }

    /** Each source's albums, from its tracks, by object id: what the Locations probe checks its own against. @type {Record<string, Set<string>>} */
    const trackAlbums = {};
    for (const source of SOURCE_ORDER) {
      // A call timed out: the Core may hold a page or a query this side never
      // heard about, so nothing more is asked — the connection is closed and
      // the Core is left to drop what it holds for it (§3).
      if (g.uncertain()) { out.sources[source] = { skipped: "an earlier call timed out" }; continue; }
      out.sources[source] = await probeSource(g, graph, library.oid, profileId, source, { pageSize, maxTracks, timeoutMs, lifetime: out.lifetime, albumsOut: trackAlbums });
    }
    out.locations = await probeLocations(g, graph, { libraryOid: library.oid, profileId, timeoutMs, pageSize, countGraceMs: o.countGraceMs, maxAlbums: o.maxAlbumsForPages === undefined ? 2000 : o.maxAlbumsForPages, trackAlbums,
      budget: { left: o.albumPageBudget === undefined ? 60 : o.albumPageBudget }, lifetime: out.lifetime });
    out.ok = SOURCE_ORDER.every((s) => !out.sources[s].error && !out.sources[s].skipped) && out.locations.ok;
    if (g.uncertain()) out.why = `Stopped and closed: ${g.uncertain()}. A late answer may have left a page or a query open in the Core until it drops this connection's objects.`;
    else if (!out.ok) out.why = "A query failed (see sources and locations).";
  } catch (e) {
    out.why = e.message;
  } finally {
    out.calls = g.log;
    out.graphOverflowed = graph.overflowed;
    out.decodeErrors = graph.decodeErrors;
    graph.onObject = () => {};
    session.close();
    out.ms = Date.now() - started;
  }
  return out;
}

/**
 * @param {ReturnType<typeof guarded>} g
 * @param {import("./objects").ObjectGraph} graph
 * @param {bigint} libraryOid
 * @param {Buffer} profileId
 * @param {"local" | "tidal" | "qobuz"} source
 * @param {{ pageSize: number, maxTracks: number, timeoutMs: number, lifetime: any, albumsOut?: Record<string, Set<string>> }} o
 *   albumsOut: where a source whose every track was seen leaves its albums
 */
async function probeSource(g, graph, libraryOid, profileId, source, o) {
  /** @type {any} */
  const res = { tracks: null, albums: null, albumTitles: [] };
  /** @type {bigint | null} */
  let q = null;
  try {
    q = await openTrackQuery(g, libraryOid, profileId, source, o.pageSize);
    o.lifetime.queriesOpened++;
    const qid = q;
    const count = await waitFor(o.timeoutMs, () => {
      const c = field(graph.get(qid), "Count");
      return typeof c === "number" && c >= 0 ? c : undefined;
    });
    if (count === undefined) { res.error = "the query's Count never arrived"; return res; }
    res.tracks = count;
    if (count === 0) { res.albums = 0; if (o.albumsOut) o.albumsOut[source] = new Set(); return res; }
    if (count > o.maxTracks) { res.note = `${count} tracks: more than the ${o.maxTracks} a probe pages through, so its albums are not counted`; return res; }

    // The tracks are the TrackLite objects the Core pushes while this query
    // is open — new or pushed again — gathered across ALL its pages, so one
    // page's late arrivals count for the query rather than for the next page
    // (paging.js). A track the Core had pushed before and does not push again
    // is not seen: the note below says how many of the Count were.
    const paged = await pageThrough(g, graph, qid, count, {
      pageSize: o.pageSize, timeoutMs: o.timeoutMs, lifetime: o.lifetime, retain: SIG.retainPage, release: SIG.releasePage,
      take: (obj) => (obj.typeName.endsWith(".TrackLite") ? obj.oid.toString() : null),
    });
    if (paged.error) res.error = paged.error;
    /** @type {Set<string>} */
    const albums = new Set();
    for (const oid of paged.seen) {
      const a = field(graph.get(BigInt(oid)), "Album");
      if (isRef(a)) albums.add(a.$ref.toString());
    }
    // Kept for the Locations probe's cross-check (same session, same ids); not reported.
    if (o.albumsOut && !paged.error && paged.seen.size === count) o.albumsOut[source] = albums;
    const tracks = paged.seen;
    const seen = tracks.size;
    res.albums = albums.size;
    if (seen < count) res.note = `${seen} of ${count} tracks were pushed while the query was open; the album count is of those`;
    res.albumTitles = [...albums].slice(0, 25).map((oid) => {
      const a = graph.get(BigInt(oid));
      const t = field(a, "Title"), by = field(a, "PerformedBy");
      return t ? (by ? `${by} — ${t}` : t) : `(album ${oid}, not pushed)`;
    });
  } catch (e) {
    res.error = e.message;
  } finally {
    graph.onObject = () => {};
    if (q !== null) {
      if (g.callNoReply(q, SIG.dispose, Buffer.alloc(0))) o.lifetime.queriesDisposed++;
      else o.lifetime.unsent++;
    }
  }
  return res;
}

module.exports = { runProbe, SOURCE_ORDER };
