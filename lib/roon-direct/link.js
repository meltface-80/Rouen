// @ts-check
"use strict";
/*
 * link.js — the native remote's one connection to the Core
 * (dev/design/native-remote.md §4): opened while Roon direct is on and Rouen
 * is paired, kept open as Roon Remote keeps its own, and closed and opened
 * again:
 *   - every night at `reconnectHour` (04:00): nothing the Core holds for this
 *     connection can be released one by one (GCOBJS's format is unknown), so
 *     what it holds is bounded by starting afresh;
 *   - when it drops, after a wait that grows (30 s, doubling to 5 min);
 *   - when it can no longer be trusted: a call timed out (the Core may hold
 *     something this side never heard of), a message could not be read, or
 *     the object graph reached its cap.
 * Each opening is a new session (`gen`): every object id belongs to one
 * connection, so whatever was read on the last one is read again (`onUp`).
 * The Core's pings are answered by remoting.js. Off (`stop`), it is closed and
 * nothing of it runs.
 */
const { brokerIdCandidates } = require("./brokerid");
const { guarded } = require("./methods");
const session = require("./session");

const RETRY_FIRST_MS = 30 * 1000;
const RETRY_MAX_MS = 5 * 60 * 1000;
const HEALTH_MS = 60 * 1000;

/**
 * How long until the next `hour`:00 local time.
 * @param {number} hour
 * @param {Date} now
 */
function msUntilHour(hour, now) {
  const next = new Date(now.getTime());
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

/**
 * @typedef {{ gen: number, g: ReturnType<typeof guarded>, graph: import("./objects").ObjectGraph,
 *             root: Awaited<ReturnType<typeof session.readRoot>>, close: () => void }} LinkSession
 * @typedef {object} LinkDeps
 * @property {() => { host: string | null, coreId: string | null } | null} core  the paired Core
 * @property {(s: LinkSession) => void} [onUp]       a new session is open
 * @property {(why: string, planned: boolean) => void} [onDown]
 *                                                    the session closed, or an opening failed, and why;
 *                                                    `planned`: closed on purpose (stop, cycle), not by a fault
 * @property {typeof session.connectFirst} [connect]
 * @property {typeof session.readRoot} [readRoot]
 * @property {() => Date} [now]
 * @property {number} [reconnectHour]
 * @property {number} [port]
 * @property {number} [timeoutMs]
 * @property {number} [settleMs]
 * @property {number} [maxObjects]
 * @property {number} [retryFirstMs]                 the first wait after a drop (tests shorten it)
 * @property {(line: string) => void} [log]
 */

/** @param {LinkDeps} deps */
function createLink(deps) {
  const connect = deps.connect || session.connectFirst;
  const readRoot = deps.readRoot || session.readRoot;
  const now = deps.now || (() => new Date());
  const log = deps.log || (() => {});
  const hour = deps.reconnectHour === undefined ? 4 : deps.reconnectHour;
  const retryFirst = deps.retryFirstMs || RETRY_FIRST_MS;
  let running = false, opening = false, gen = 0, retryMs = retryFirst;
  /** @type {LinkSession | null} */
  let current = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let retryTimer = null, nightTimer = null;
  /** @type {ReturnType<typeof setInterval> | null} */
  let healthTimer = null;
  let upSince = 0, lastDown = /** @type {{ at: number, why: string } | null} */ (null), reconnects = 0;

  /** @param {() => void} fn @param {number} ms */
  const later = (fn, ms) => { const t = setTimeout(fn, ms); if (typeof t.unref === "function") t.unref(); return t; };
  const clear = () => {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (nightTimer) { clearTimeout(nightTimer); nightTimer = null; }
    if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
  };

  /**
   * The session went, or an opening failed, for `why`; another is opened
   * unless the link is stopped. `soon`: closed on purpose to open afresh.
   * @param {string} why @param {boolean} [soon] @param {boolean} [planned]
   */
  function down(why, soon, planned) {
    const s = current;
    current = null;
    clear();
    if (s) { try { s.close(); } catch (e) { /* closing a socket that is already gone: nothing more to release */ } }
    lastDown = { at: now().getTime(), why };
    log("down: " + why);
    if (deps.onDown) deps.onDown(why, !!(soon || planned));
    if (!running) return;
    const wait = soon ? 1000 : retryMs;
    if (!soon) retryMs = Math.min(RETRY_MAX_MS, retryMs * 2);
    retryTimer = later(() => { retryTimer = null; open(); }, wait);
  }

  async function open() {
    if (!running || opening || current) return;
    const core = deps.core();
    if (!core || !core.host || !core.coreId) return;   // pairing calls refresh()
    opening = true;
    try { await opened(core); }
    finally { opening = false; }
  }

  /** One opening, from the handshake to the session in use. @param {{ host: string | null, coreId: string | null }} core */
  async function opened(core) {
    try {
      const candidates = brokerIdCandidates({ coreId: core.coreId });
      const first = await connect({ host: core.host, port: deps.port || 9332, timeoutMs: deps.timeoutMs || 10000, candidates, maxObjects: deps.maxObjects });
      if (!first.session) throw new Error("the Core refused the connection");
      const s0 = first.session;
      if (!running) { s0.close(); return; }
      const g = guarded(s0.remoting);
      let root;
      try { root = await readRoot(g, s0.graph, deps.settleMs || 6000); }
      catch (e) { s0.close(); throw e; }
      // Switched off while the root was read: nothing of it may stay open.
      if (!running) { s0.close(); return; }
      if (!root.library || !root.profileId) { s0.close(); throw new Error("the Core's graph arrived without its Library or a profile"); }
      /** @type {LinkSession} */
      const s = { gen: ++gen, g, graph: s0.graph, root, close: s0.close };
      const prior = s0.conn.onclosed;
      s0.conn.onclosed = () => { prior(); if (current === s) down("the connection closed"); };
      current = s;
      upSince = now().getTime();
      retryMs = retryFirst;
      if (gen > 1) reconnects++;
      log("up: session " + s.gen);
      nightTimer = later(() => { nightTimer = null; if (current === s) cycle("the nightly reconnect"); }, msUntilHour(hour, now()));
      healthTimer = setInterval(() => { if (current === s) check(s); }, HEALTH_MS);
      if (typeof healthTimer.unref === "function") healthTimer.unref();
      if (deps.onUp) deps.onUp(s);
    } catch (e) {
      if (running) down(String(e && /** @type {any} */ (e).message || e));
    }
  }

  /** Whether the session can still be trusted; if not, a fresh one. @param {LinkSession} s */
  function check(s) {
    if (s.g.uncertain()) cycle("a call went unanswered: " + s.g.uncertain());
    else if (s.graph.decodeErrors) cycle(s.graph.decodeErrors + " message(s) from the Core could not be read");
    else if (s.graph.overflowed) cycle("the Core's objects reached the cap Rouen keeps");
  }

  /** Close and open again now. @param {string} why */
  function cycle(why) { if (current) down(why, true); }

  return {
    /** Roon direct switched on: open, and keep open. */
    start() { if (running) return; running = true; open(); },
    /** Roon direct switched off: closed, and nothing of it runs. @param {string} [why] */
    stop(why) {
      running = false;
      if (current) down(why || "Roon direct switched off", false, true);
      clear();
    },
    /** Rouen paired (again): open if it should be open and is not. */
    refresh() { if (running && !current && !opening && !retryTimer) open(); },
    /** Close and open again (after a failed call, or another Core paired). @param {string} why */
    cycle(why) { if (current) cycle(why); else if (running && !opening) { if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } open(); } },
    /** Look now, as the minute's check would. */
    check() { if (current) check(current); },
    /** The open session, or null. */
    session() { return current; },
    status() {
      return { running, up: !!current, session: current ? current.gen : null,
        since: current ? upSince : null, objects: current ? current.graph.objects.size : null,
        reconnects, lastDown };
    },
  };
}

module.exports = { createLink, msUntilHour };
