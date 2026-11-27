// @ts-check
"use strict";
/*
 * walk-conn.js — a short connection of its own for the catalogue walk (edit-facts.js; dev/design/catalogue.md §4.1,
 * 2.0.8-t5). The owner's server, 2026-11-26: native mode's one connection held 175,752 objects six minutes after it
 * opened, its playlists refused for want of room; the walk, which by design (§4, v2.0.3-t17) fills that connection to
 * within ROOM of its cap, every object an answer names staying for the connection's life, had read 600 albums of
 * 13,095, and would go on 600 a connection, a night at a time.
 *
 * So the walk opens a connection for itself, as the Parametric EQ's fresh read does (peq-fresh.js): the handshake with
 * its own client id, the root read (readRoot), the library read on it (albums.js readAlbumsOn, which lets each page go)
 * for the albums' object ids on that connection; the walk fills it, closes it, and opens the next where it stopped.
 * Nothing on native mode's own connection is touched. Only reads are sent: GETSVC, the album query, GetMultiAlbumEditInfo.
 */
const { connectFirst, readRoot, household } = require("./session");
const { guarded } = require("./methods");
const { brokerIdCandidates } = require("./brokerid");
const { readAlbumsOn } = require("./albums");

const TIMEOUT_MS = 10000, SETTLE_MS = 6000, PORT = 9332;

/**
 * @param {{ core: () => ({ host: string | null, coreId: string | null } | null), connect?: typeof connectFirst,
 *           read?: typeof readAlbumsOn, port?: number, timeoutMs?: number, settleMs?: number, maxObjects?: number,
 *           log?: (line: string) => void }} deps
 */
function createWalkConnections(deps) {
  const connect = deps.connect || connectFirst;
  const read = deps.read || readAlbumsOn;
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS, settleMs = deps.settleMs ?? SETTLE_MS;
  return {
    /**
     * A connection open, its root and library read: the session the walk calls on, its albums by object id, and how to
     * close it; or why there is none (closed already).
     * @returns {Promise<{ session: any, known: Map<string, any>, close: () => void } | { why: string }>}
     */
    async open() {
      const core = deps.core();
      if (!core || !core.host || !core.coreId) return { why: "Rouen isn't paired with your server." };
      const first = await connect({ host: core.host, port: deps.port || PORT, timeoutMs, candidates: brokerIdCandidates({ coreId: core.coreId }),
        maxObjects: deps.maxObjects });
      const s0 = first.session;
      if (!s0) return { why: "Your server didn't take a connection for the walk." };
      try {
        const g = guarded(s0.remoting);
        const root = await readRoot(g, s0.graph, settleMs);
        if (!root.library || !root.profileId) { s0.close(); return { why: "The walk's connection came without its Library or a profile." }; }
        const session = { g, graph: s0.graph, root, close: s0.close };
        const r = await read(session, { profile: household(), known: null, timeoutMs });
        if (!r.ok) { s0.close(); return { why: "The library couldn't be read on the walk's connection: " + /** @type {import("./albums").ReadFailed} */ (r).why }; }
        const known = new Map(/** @type {import("./albums").ReadOk} */ (r).albums.map((a) => [String(a.oid), a]));
        return { session, known, close: () => s0.close() };
      } catch (e) {
        s0.close();
        return { why: String((e && /** @type {any} */ (e).message) || e) };
      }
    },
  };
}

module.exports = { createWalkConnections };
