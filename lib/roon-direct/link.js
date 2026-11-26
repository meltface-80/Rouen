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
 * Every connection sends a keepalive every `keepaliveMs` (10 s) from the
 * moment it is up (session.js, v1.9.24): the server reaps one it has heard
 * nothing from for about 30 s. One the server stops answering, having
 * answered before, is a dead line: three missed in a row, and it is opened
 * afresh rather than trusted until TCP gives up.
 * Each opening is a new session (`gen`): every object id belongs to one
 * connection, so whatever was read on the last one is read again (`onUp`).
 * The Core's pings are answered by remoting.js. Off (`stop`), it is closed and
 * nothing of it runs.
 */
const { brokerIdCandidates } = require("./brokerid");
const { guarded } = require("./methods");
const session = require("./session");
const { openingFault } = require("./always-on");

const RETRY_FIRST_MS = 30 * 1000;
const RETRY_MAX_MS = 5 * 60 * 1000;
/** How long openings that reach the server must keep failing before the path is called broken (roon-native.md §11.2). */
const FAILING_MS = 30 * 60 * 1000;
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
 *             root: Awaited<ReturnType<typeof session.readRoot>>, close: () => void,
 *             keepalive: () => { sent: number, answered: number, missed: number } }} LinkSession
 * @typedef {object} LinkDeps
 * @property {() => { host: string | null, coreId: string | null } | null} core  the paired Core
 * @property {(s: LinkSession) => void} [onUp]       a new session is open
 * @property {(why: string, planned: boolean) => void} [onDown]
 *                                                    the session closed, or an opening failed, and why;
 *                                                    `planned`: closed on purpose (stop, cycle), not by a fault
 * @property {(why: string) => void} [onBroken]      the path closed or broken: refused, or openings that reached the
 *                                                    server failing for half an hour (roon-native.md §11.2)
 * @property {number} [failingMs]                    that half hour (tests shorten it)
 * @property {typeof session.connectFirst} [connect]
 * @property {typeof session.readRoot} [readRoot]
 * @property {() => Date} [now]
 * @property {number} [reconnectHour]
 * @property {number} [port]
 * @property {number} [timeoutMs]
 * @property {number} [settleMs]
 * @property {number} [maxObjects]
 * @property {number} [retryFirstMs]                 the first wait after a drop (tests shorten it)
 * @property {number} [keepaliveMs]                  between keepalives (tests shorten it)
 * @property {number} [healthMs]                     between looks at the session (tests shorten it)
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
  const failingMs = deps.failingMs === undefined ? FAILING_MS : deps.failingMs;
  let running = false, opening = false, gen = 0, retryMs = retryFirst, failedOpenings = 0, failingSince = 0;
  /** @type {LinkSession | null} */
  let current = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let retryTimer = null, nightTimer = null;
  /** @type {ReturnType<typeof setInterval> | null} */
  let healthTimer = null;
  let upSince = 0, lastDown = /** @type {{ at: number, why: string, planned: boolean } | null} */ (null), reconnects = 0;

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
    lastDown = { at: now().getTime(), why, planned: !!planned };   // planned (not a fault): the status board's grey (§13)
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
      const first = await connect({ host: core.host, port: deps.port || 9332, timeoutMs: deps.timeoutMs || 10000, candidates,
        maxObjects: deps.maxObjects, keepaliveMs: deps.keepaliveMs });
      if (!first.session) {
        // Every broker id tried and none taken: refused, unless none of them reached the server (2.0.6-t21: a server
        // out of reach is a drop, retried; one that answers and refuses is the path closed, §11.2).
        const errs = (first.tried || []).map((t) => t.error || "").filter(Boolean);
        // Refused only when every broker id was: one id is the wrong one, and refused as such, so a slow handshake on the
        // right one beside it is a drop (the review).
        const faults = errs.map(openingFault);
        throw new Error(!errs.length || faults.every((f) => f === "refused") ? "the Core refused the connection" + (errs.length ? " (" + errs.join("; ") + ")" : "")
          : faults.includes("failed") ? "the Core answered, and no session came up (" + errs.join("; ") + ")"
            : "could not reach the Core: " + errs.join("; "));
      }
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
      const s = { gen: ++gen, g, graph: s0.graph, root, close: s0.close, keepalive: () => s0.remoting.keepalive || { sent: 0, answered: 0, missed: 0 } };
      const prior = s0.conn.onclosed;
      s0.conn.onclosed = () => { prior(); if (current === s) down("the connection closed"); };
      current = s;
      failedOpenings = 0; failingSince = 0;
      upSince = now().getTime();
      retryMs = retryFirst;
      if (gen > 1) reconnects++;
      log("up: session " + s.gen);
      nightTimer = later(() => { nightTimer = null; if (current === s) cycle("the nightly reconnect", true); }, msUntilHour(hour, now()));
      healthTimer = setInterval(() => { if (current === s) check(s); }, deps.healthMs || HEALTH_MS);
      if (typeof healthTimer.unref === "function") healthTimer.unref();
      if (deps.onUp) deps.onUp(s);
    } catch (e) {
      const why = String(e && /** @type {any} */ (e).message || e);
      // The path closed or broken (roon-native.md §11.2): refused, or three openings in a row that reached the server
      // and failed. Said, for native mode to be suspended; a server out of reach is retried as before.
      // Failed openings count only while they last: three or more, over FAILING_MS, so a server restarting (a proxy
      // closing at once, a library still loading) is a drop (the review).
      const fault = openingFault(why);
      const at = now().getTime();
      if (fault) { failedOpenings++; if (!failingSince) failingSince = at; } else { failedOpenings = 0; failingSince = 0; }
      if (running) down(why);
      if (running && deps.onBroken && (fault === "refused" || (failedOpenings >= 3 && at - failingSince >= failingMs))) {
        deps.onBroken(fault === "refused" ? why : `openings kept failing for ${Math.round((at - failingSince) / 60000)} minutes; the last: ${why}`);
      }
    }
  }

  /** Whether the session can still be trusted; if not, a fresh one. @param {LinkSession} s */
  function check(s) {
    if (s.g.uncertain()) cycle("a call went unanswered: " + s.g.uncertain());
    else if (s.graph.decodeErrors) cycle(s.graph.decodeErrors + " message(s) from the Core could not be read");
    else if (s.graph.overflowed) cycle("the Core's objects reached the cap Rouen keeps");
    else {
      const k = s.keepalive();
      // Only a server that has answered one: one that never answers may still count them.
      if (k.answered && k.missed >= 3) cycle("the server stopped answering keepalives");
    }
  }

  /** Close and open again now. @param {string} why */
  /** @param {string} why @param {boolean} [planned]  the nightly reconnect, or asked for: not a fault (v1.9.63) */
  function cycle(why, planned) { if (current) down(why, true, planned); }

  return {
    /** Native mode in use, or tried again: open, and keep open. */
    start() { if (running) return; running = true; failedOpenings = 0; failingSince = 0; open(); },
    /** Native mode off or suspended (roon-native.md §11): closed, and nothing of it runs. @param {string} [why] */
    stop(why) {
      running = false;
      if (current) down(why || "native mode stopped", false, true);
      clear();
    },
    /** Rouen paired (again): open if it should be open and is not. */
    refresh() { if (running && !current && !opening && !retryTimer) open(); },
    /** Close and open again (after a failed call, or another Core paired). @param {string} why */
    cycle(why) { if (current) cycle(why, true); else if (running && !opening) { if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } open(); } },
    /** Look now, as the minute's check would. */
    check() { if (current) check(current); },
    /** The open session, or null. */
    session() { return current; },
    /** The port it connects to (a connection of the walk's own goes to the same, walk-conn.js). */
    port() { return deps.port || 9332; },
    status() {
      return { running, up: !!current, session: current ? current.gen : null,
        since: current ? upSince : null, objects: current ? current.graph.objects.size : null,
        keepalive: current ? Object.assign({}, current.keepalive()) : null,
        reconnects, lastDown };
    },
  };
}

module.exports = { createLink, msUntilHour };
