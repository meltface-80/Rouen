// @ts-check
"use strict";
/*
 * probe.js — stage 0 of dev/design/roon-native.md: one read-only look at the
 * Core over its internal protocol, run by hand, to learn whether the rest of
 * the design can stand.
 *
 *   1. the handshake, with each broker-id candidate in turn (brokerid.js)
 *   2. the root service: the Core pushes its object graph — its profiles, its
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
 *      (§9.1). Counts only; each query disposed.
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
const { RoonConnection } = require("./connection");
const { RemotingClient } = require("./remoting");
const { ObjectGraph, isRef, field, plain, waitFor } = require("./objects");
const { brokerIdCandidates } = require("./brokerid");
const { ROOT_SERVICE, SIG, guarded, openTrackQuery, pageArg } = require("./methods");
const { probeLocations, describeLocation } = require("./locations");

const SOURCE_ORDER = /** @type {const} */ (["local", "tidal", "qobuz"]);
const QUIET_MS = 500;

/**
 * One connection: handshake, remoting, graph. Throws when the handshake fails.
 * @param {{ host: string, port: number, id: Buffer, timeoutMs: number }} o
 */
async function openSession(o) {
  const conn = new RoonConnection({ host: o.host, port: o.port, serverBrokerId: o.id, handshakeMs: o.timeoutMs });
  const remoting = new RemotingClient(conn, { timeoutMs: o.timeoutMs, maxInFlight: 2 });
  const graph = new ObjectGraph();
  remoting.onPush = (f) => { graph.ingest(f); };
  conn.onclosed = () => remoting.failPending("the connection closed");
  try { await conn.connect(); }
  catch (e) { conn.close(); throw e; }
  return { conn, remoting, graph, close: () => { remoting.failPending("probe finished"); conn.close(); } };
}

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

  let session = null;
  for (const c of candidates) {
    try {
      session = await openSession({ host: o.host, port, id: c.id, timeoutMs });
      out.brokerId.tried.push({ label: c.label, id: c.id.toString("hex"), ok: true });
      out.brokerId.used = c.label;
      break;
    } catch (e) {
      out.brokerId.tried.push({ label: c.label, id: c.id.toString("hex"), ok: false, error: e.message });
    }
  }
  if (!session) { out.why = "The Core refused every broker id tried (see brokerId.tried)."; out.ms = Date.now() - started; return out; }

  const g = guarded(session.remoting);
  const graph = session.graph;
  try {
    await g.getService(ROOT_SERVICE);
    // The graph arrives in pushes after the reply: wait for the profile and
    // the Library, then until nothing new has arrived for QUIET_MS (a count
    // unchanged between two polls is not quiet: the Locations can follow the
    // Library by a moment, and they are what §9.1 is decided on).
    // Watched as objects arrive, not by scanning the graph every poll.
    let sawProfile = graph.ofType("Profile").length > 0, sawLibrary = graph.ofType("Library").length > 0;
    graph.onObject = (obj) => {
      if (obj.typeName.endsWith(".Profile")) sawProfile = true;
      else if (obj.typeName.endsWith(".Library")) sawLibrary = true;
    };
    await waitFor(settleMs, () => (sawProfile && sawLibrary ? true : undefined));
    graph.onObject = () => {};
    let last = graph.objects.size, changed = Date.now();
    await waitFor(settleMs, () => {
      const n = graph.objects.size;
      if (n !== last) { last = n; changed = Date.now(); }
      return Date.now() - changed >= QUIET_MS ? true : undefined;
    });

    const profiles = graph.ofType("Profile");
    const library = graph.ofType("Library")[0];
    const profileId = profiles.map((p) => field(p, "ProfileId")).find((v) => Buffer.isBuffer(v));
    out.core = {
      objects: graph.objects.size,
      profiles: profiles.map((p) => field(p, "Name") || "(unnamed)"),
      profileUsed: profiles.length ? (field(profiles.find((p) => Buffer.isBuffer(field(p, "ProfileId"))), "Name") || "(unnamed)") : null,
      library: library ? { albums: plain(field(library, "AlbumCount")), tracks: plain(field(library, "TrackCount")) } : null,
      locations: graph.ofType("Location").map(describeLocation),
    };
    if (!library) { out.why = "The Core's graph arrived without its Library service."; return out; }
    if (!profileId) { out.why = "The Core's graph arrived without a profile id."; return out; }

    for (const source of SOURCE_ORDER) {
      // A call timed out: the Core may hold a page or a query this side never
      // heard about, so nothing more is asked — the connection is closed and
      // the Core is left to drop what it holds for it (§3).
      if (g.uncertain()) { out.sources[source] = { skipped: "an earlier call timed out" }; continue; }
      out.sources[source] = await probeSource(g, graph, library.oid, profileId, source, { pageSize, maxTracks, timeoutMs, lifetime: out.lifetime });
    }
    out.locations = await probeLocations(g, graph, { libraryOid: library.oid, profileId, timeoutMs, pageSize, countGraceMs: o.countGraceMs, lifetime: out.lifetime });
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
 * @param {ObjectGraph} graph
 * @param {bigint} libraryOid
 * @param {Buffer} profileId
 * @param {"local" | "tidal" | "qobuz"} source
 * @param {{ pageSize: number, maxTracks: number, timeoutMs: number, lifetime: any }} o
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
    if (count === 0) { res.albums = 0; return res; }
    if (count > o.maxTracks) { res.note = `${count} tracks: more than the ${o.maxTracks} a probe pages through, so its albums are not counted`; return res; }

    // The tracks are the TrackLite objects the Core pushes while this query
    // is open — new or pushed again — gathered across ALL its pages, so one
    // page's late arrivals count for the query rather than for the next page.
    // Watched as they arrive (onObject), never by scanning the graph. A track
    // the Core had pushed before and does not push again is not seen: the
    // note below says how many of the Count were.
    /** @type {Map<string, any>} */
    const tracks = new Map();
    graph.onObject = (obj) => { if (obj.typeName.endsWith(".TrackLite")) tracks.set(obj.oid.toString(), obj); };
    for (let page = 0; page * o.pageSize < count; page++) {
      const want = Math.min(count, (page + 1) * o.pageSize);
      const r = await g.call(qid, SIG.retainPage, pageArg(page));
      if (!r.success) { res.error = `the Core refused page ${page}: ${r.status}`; break; }
      o.lifetime.pagesRetained++;
      try {
        await waitFor(o.timeoutMs, () => (tracks.size >= want ? true : undefined));
      } finally {
        if (g.callNoReply(qid, SIG.releasePage, pageArg(page))) o.lifetime.pagesReleased++;
        else o.lifetime.unsent++;
      }
    }
    graph.onObject = () => {};
    /** @type {Set<string>} */
    const albums = new Set();
    for (const t of tracks.values()) {
      const a = field(t, "Album");
      if (isRef(a)) albums.add(a.$ref.toString());
    }
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
