// @ts-check
"use strict";
/*
 * session.js — one connection to the Core over its internal protocol, as
 * stage 0's probe (probe.js) and stage 1's read (albums.js) both open it
 * (dev/design/roon-native.md §3: one short connection per run, closed
 * gracefully, nothing kept open):
 *
 *   connectFirst   the handshake with each broker-id candidate in turn
 *   readRoot       the root service, and the graph the Core pushes after it:
 *                  its profiles and its Library (and its storage Locations)
 *
 * Moved here from probe.js in v1.9.18, unchanged, so the two share one way in.
 */
const { RoonConnection } = require("./connection");
const { RemotingClient } = require("./remoting");
const { ObjectGraph, field, waitFor } = require("./objects");
const { ROOT_SERVICE } = require("./methods");

const QUIET_MS = 500;

const KEEPALIVE_MS = 10 * 1000;

/**
 * One connection: handshake, remoting, graph. Throws when the handshake fails.
 * Keepalives from the moment it is up (remoting.js startKeepalive, v1.9.24):
 * the server reaps a connection it has heard nothing from for about 30 s.
 * @param {{ host: string, port: number, id: Buffer, timeoutMs: number, maxObjects?: number, keepaliveMs?: number }} o
 *   maxObjects: the graph's cap (objects.js); its own default when not given
 */
async function openSession(o) {
  const conn = new RoonConnection({ host: o.host, port: o.port, serverBrokerId: o.id, handshakeMs: o.timeoutMs });
  const remoting = new RemotingClient(conn, { timeoutMs: o.timeoutMs, maxInFlight: 2 });
  const graph = new ObjectGraph(o.maxObjects);
  remoting.onPush = (f) => { graph.ingest(f); };
  conn.onclosed = () => remoting.failPending("the connection closed");
  try { await conn.connect(); }
  catch (e) { conn.close(); throw e; }
  remoting.startKeepalive(o.keepaliveMs || KEEPALIVE_MS);
  return { conn, remoting, graph, close: () => { remoting.failPending("probe finished"); conn.close(); } };
}

/** @typedef {Awaited<ReturnType<typeof openSession>>} Session */

/**
 * The handshake with each candidate in turn; the first the Core accepts is used.
 * @param {{ host: string, port: number, timeoutMs: number, candidates: Array<{ label: string, id: Buffer }>, maxObjects?: number, keepaliveMs?: number }} o
 * @returns {Promise<{ session: Session | null, tried: Array<{ label: string, id: string, ok: boolean, error?: string }>, used: string | null }>}
 */
async function connectFirst(o) {
  /** @type {Array<{ label: string, id: string, ok: boolean, error?: string }>} */
  const tried = [];
  for (const c of o.candidates) {
    try {
      const session = await openSession({ host: o.host, port: o.port, id: c.id, timeoutMs: o.timeoutMs, maxObjects: o.maxObjects, keepaliveMs: o.keepaliveMs });
      tried.push({ label: c.label, id: c.id.toString("hex"), ok: true });
      return { session, tried, used: c.label };
    } catch (e) {
      tried.push({ label: c.label, id: c.id.toString("hex"), ok: false, error: e.message });
    }
  }
  return { session: null, tried, used: null };
}

/**
 * GETSVC on the root service, then the graph it brings: wait for a profile
 * and the Library, then until nothing new has arrived for QUIET_MS (a count
 * unchanged between two polls is not quiet: the Locations can follow the
 * Library by a moment). Watched as objects arrive, not by scanning the graph
 * every poll.
 * @param {ReturnType<typeof import("./methods").guarded>} g
 * @param {import("./objects").ObjectGraph} graph
 * @param {number} settleMs
 */
async function readRoot(g, graph, settleMs) {
  await g.getService(ROOT_SERVICE);
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
  const library = graph.ofType("Library")[0] || null;
  const withId = profiles.find((p) => Buffer.isBuffer(field(p, "ProfileId")));
  /** @type {Buffer | null} */
  const profileId = withId ? field(withId, "ProfileId") : null;
  return { profiles, library, profileId, profileName: withId ? (field(withId, "Name") || "(unnamed)") : null };
}

/**
 * The profile Rouen acts for (v1.9.27, roon-native.md §8.4), as its object: the one chosen in
 * Settings → Native mode, by its id; none chosen, or that one gone, the first with an id (readRoot's).
 * A call that takes the Profile itself sends this (v1.9.36, GetListenLater).
 * @param {{ profiles: any[] }} root @param {string | null | undefined} chosen  its id, as hex
 * @returns {any | null}
 */
function profileObjectFor(root, chosen) {
  const withId = root.profiles.filter((x) => Buffer.isBuffer(field(x, "ProfileId")));
  return (chosen && withId.find((x) => field(x, "ProfileId").toString("hex") === chosen)) || withId[0] || null;
}

/**
 * The same profile, by its id — what most calls take.
 * @param {{ profiles: any[], profileId: Buffer | null }} root @param {string | null | undefined} chosen  its id, as hex
 * @returns {Buffer | null}
 */
function profileFor(root, chosen) {
  const p = profileObjectFor(root, chosen);
  return p ? field(p, "ProfileId") : root.profileId;
}

/** Every profile with an id, for the picker: its id as hex, and its name. @param {{ profiles: any[] }} root */
const profilesOf = (root) => root.profiles.filter((p) => Buffer.isBuffer(field(p, "ProfileId")))
  .map((p) => ({ id: field(p, "ProfileId").toString("hex"), name: String(field(p, "Name") || "(unnamed)") }));

module.exports = { openSession, connectFirst, readRoot, profileFor, profileObjectFor, profilesOf };
