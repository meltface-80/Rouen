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
 *   4. the connection closed.
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
const { ObjectGraph, isRef, field } = require("./objects");
const { brokerIdCandidates } = require("./brokerid");
const { ROOT_SERVICE, SIG, guarded, openTrackQuery, pageArg } = require("./methods");

const SOURCE_ORDER = /** @type {const} */ (["local", "tidal", "qobuz"]);

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * @template T
 * @param {number} ms
 * @param {() => T | undefined} read
 * @returns {Promise<T | undefined>} the value, or undefined when time ran out
 */
async function waitFor(ms, read) {
  const end = Date.now() + ms;
  for (;;) {
    const v = read();
    if (v !== undefined) return v;
    if (Date.now() >= end) return undefined;
    await sleep(50);
  }
}

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

/** @param {any} v */
const plain = (v) => (typeof v === "bigint" ? Number(v) : Buffer.isBuffer(v) ? v.toString("hex") : v);

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
 */
async function runProbe(o) {
  const port = o.port || 9332;
  const timeoutMs = o.timeoutMs || 10000;
  const settleMs = o.settleMs || 6000;
  const pageSize = o.pageSize || 100;
  const maxTracks = o.maxTracksForAlbums === undefined ? 2000 : o.maxTracksForAlbums;
  const started = Date.now();
  /** @type {any} */
  const out = { ok: false, host: o.host, port, brokerId: { tried: [], used: null }, core: null, sources: {}, calls: [], lifetime: { pagesRetained: 0, pagesReleased: 0, queriesOpened: 0, queriesDisposed: 0 } };

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
    // the Library, then for the pushes to go quiet.
    await waitFor(settleMs, () => (graph.ofType("Profile").length && graph.ofType("Library").length ? true : undefined));
    let last = -1;
    await waitFor(Math.min(1500, settleMs), () => { const n = graph.objects.size; const quiet = n === last; last = n; return quiet ? true : undefined; });

    const profiles = graph.ofType("Profile");
    const library = graph.ofType("Library")[0];
    const profileId = profiles.map((p) => field(p, "ProfileId")).find((v) => Buffer.isBuffer(v));
    out.core = {
      objects: graph.objects.size,
      profiles: profiles.map((p) => field(p, "Name") || "(unnamed)"),
      profileUsed: profiles.length ? (field(profiles.find((p) => Buffer.isBuffer(field(p, "ProfileId"))), "Name") || "(unnamed)") : null,
      library: library ? { albums: plain(field(library, "AlbumCount")), tracks: plain(field(library, "TrackCount")) } : null,
      locations: graph.ofType("Location").map((l) => ({
        name: field(l, "DisplayName") || field(l, "Name") || null,
        category: plain(field(l, "Category")), type: plain(field(l, "Type")),
        online: plain(field(l, "IsOnline")), files: plain(field(l, "MusicFileCount")),
      })),
    };
    if (!library) { out.why = "The Core's graph arrived without its Library service."; return out; }
    if (!profileId) { out.why = "The Core's graph arrived without a profile id."; return out; }

    for (const source of SOURCE_ORDER) {
      out.sources[source] = await probeSource(g, graph, library.oid, profileId, source, { pageSize, maxTracks, timeoutMs, lifetime: out.lifetime });
    }
    out.ok = SOURCE_ORDER.every((s) => !out.sources[s].error);
    if (!out.ok) out.why = "A source's query failed (see sources).";
  } catch (e) {
    out.why = e.message;
  } finally {
    out.calls = g.log;
    out.graphOverflowed = graph.overflowed;
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

    /** @type {Set<string>} */
    const albums = new Set();
    let seen = 0;
    for (let page = 0; page * o.pageSize < count; page++) {
      const before = new Set(graph.ofType("TrackLite").map((t) => t.oid.toString()));
      const want = Math.min(o.pageSize, count - page * o.pageSize);
      const r = await g.call(qid, SIG.retainPage, pageArg(page));
      if (!r.success) { res.error = `the Core refused page ${page}: ${r.status}`; break; }
      o.lifetime.pagesRetained++;
      try {
        const fresh = await waitFor(o.timeoutMs, () => {
          const f = graph.ofType("TrackLite").filter((t) => !before.has(t.oid.toString()));
          return f.length >= want ? f : undefined;
        });
        const tracks = fresh || graph.ofType("TrackLite").filter((t) => !before.has(t.oid.toString()));
        seen += tracks.length;
        for (const t of tracks) {
          const a = field(t, "Album");
          if (isRef(a)) albums.add(a.$ref.toString());
        }
      } finally {
        g.callNoReply(qid, SIG.releasePage, pageArg(page));
        o.lifetime.pagesReleased++;
      }
    }
    res.albums = albums.size;
    if (seen < count) res.note = `${seen} of ${count} tracks arrived in their pages; the album count is of those`;
    res.albumTitles = [...albums].slice(0, 25).map((oid) => {
      const a = graph.get(BigInt(oid));
      const t = field(a, "Title"), by = field(a, "PerformedBy");
      return t ? (by ? `${by} — ${t}` : t) : `(album ${oid}, not pushed)`;
    });
  } catch (e) {
    res.error = e.message;
  } finally {
    if (q !== null) { g.callNoReply(q, SIG.dispose, Buffer.alloc(0)); o.lifetime.queriesDisposed++; }
  }
  return res;
}

module.exports = { runProbe, SOURCE_ORDER };
