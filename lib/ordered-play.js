// @ts-check
"use strict";
/*
 * ordered-play.js — a list of tracks sent to a zone one at a time, in the order given (v2.0.3-t11,
 * dev/design/playlist-artists.md §7).
 *
 * Roon's official API can play a whole playlist, or one track of it; it has no "play these tracks in this order". So
 * a playlist sorted on the screen is played by sending its tracks one after another: the first Roon accepts with the
 * kind asked ("play_now" or "queue"), every one after it queued behind. That takes several browse round-trips a
 * track, which for a long playlist is minutes — longer than a phone keeps a page awake or a request open. So the run
 * lives here, on the server: it is started, answers at once, and is then asked how far it has got.
 *
 *   start(zone, tracks, kind, send, meta) → the run as status() gives it
 *   status(zone) → { id, kind, total, sent, queued, failed, first_error, done, stopped, seconds, ...meta } | null
 *     sent: tracks tried so far; queued: those Roon accepted; failed: those it refused
 *   stop(zone, why, id) → a promise of the same, once the run has ended (the send in flight is not cut short)
 *   takeOver(zone, why, fn) → fn()'s answer: the zone's run ended first, fn (a Play now) run in its place
 *
 * One thing is sent to a zone at a time: each run, and each takeOver, waits for what the zone was given before it.
 * Starting a run ends the one running ("replaced"), and the new one sends nothing until the old one's send in flight
 * has landed, so a late track of the old run never lands in the new one's queue. A track Roon refuses is counted and
 * the run goes on; GIVE_UP_AFTER refusals in a row end it (the playlist deleted, Roon gone), with stopped
 * "failures". A finished run is kept for KEEP_MS, or until the zone's next, so the page can read how it ended.
 */

const GIVE_UP_AFTER = 5;
const KEEP_MS = 60 * 60 * 1000;

/**
 * @typedef {{ id: string, kind: string, total: number, sent: number, queued: number, failed: number,
 *             first_error: string, done: boolean, stopped: string | null, started: number, ended: number,
 *             meta: Record<string, any>, halt: string | null, settled: Promise<void> }} Run
 */

/** Why a send failed, as text; a thing thrown that cannot be made a string is still a refusal. @param {any} e */
function reason(e) {
  try {
    return String((e && e.message) || e);
  } catch (x) {
    return "refused";
  }
}

/**
 * @param {{ log?: (line: string) => void, now?: () => number }} [o]
 */
function createOrderedPlay(o = {}) {
  const log = o.log || ((/** @type {string} */ line) => console.log(line));
  const now = o.now || Date.now;
  /** @type {Map<string, Run>} */
  const runs = new Map();
  /** What each zone was last given to do: the next thing for that zone waits for it. Never rejects. @type {Map<string, Promise<void>>} */
  const last = new Map();
  let seq = 0;

  /** What the page is told of a run: no functions, nothing of the tracks. @param {Run} r */
  const view = (r) => Object.assign({}, r.meta, {
    id: r.id, kind: r.kind, total: r.total, sent: r.sent, queued: r.queued, failed: r.failed,
    first_error: r.first_error, done: r.done, stopped: r.stopped,
    seconds: Math.round(((r.done ? r.ended : now()) - r.started) / 1000),
  });

  /** @param {string} zone @param {Promise<void>} p  the zone's newest; forgotten once it has ended, if still the newest */
  function queueOn(zone, p) {
    last.set(zone, p);
    p.then(() => { if (last.get(zone) === p) last.delete(zone); });
  }

  /**
   * Never rejects: a run that could would leave everything waiting on its zone waiting for ever.
   * @param {Run} r @param {Array<any>} tracks
   * @param {(track: any, kind: string) => Promise<any>} send
   * @param {Promise<void> | undefined} after  what the zone was given before this run
   */
  async function work(r, tracks, send, after) {
    try {
      if (after) await after;
      r.started = now();                             // its time is its own sending, not the wait before it
      let inARow = 0;
      for (const t of tracks) {
        if (r.halt) break;
        try {
          // The kind asked goes to the first track Roon accepts, not the first tried: a "Play now" whose first track
          // is gone still starts playing, and does not queue the rest behind whatever was on.
          await send(t, r.queued === 0 ? r.kind : "queue");
          r.queued++;
          inARow = 0;
        } catch (/** @type {any} */ e) {
          r.failed++;
          inARow++;
          if (!r.first_error) r.first_error = reason(e);
        }
        r.sent++;
        if (inARow >= GIVE_UP_AFTER && !r.halt) r.halt = "failures";
      }
    } finally {
      // Ended early, or on a run of refusals. A Stop that lands as the last track goes is a run that finished.
      r.stopped = r.sent < r.total || r.halt === "failures" ? r.halt : null;
      r.ended = now();
      r.done = true;
      try {
        log(`[playlist] ordered play${r.meta.title ? ` "${r.meta.title}"` : ""}: ${r.queued} of ${r.total} tracks sent in ` +
          `${Math.round((r.ended - r.started) / 1000)} s` + (r.failed ? `, ${r.failed} refused (${r.first_error})` : "") +
          (r.stopped ? `, stopped (${r.stopped})` : ""));
      } catch (e) { /* a log that cannot be written is no reason for the run to end as a rejection */ }
    }
  }

  /** @param {string} zone @param {string} why */
  function halt(zone, why) {
    const r = runs.get(zone);
    if (r && !r.done && !r.halt) r.halt = why;
  }

  /**
   * @param {string} zone @param {Array<any>} tracks @param {string} kind
   * @param {(track: any, kind: string) => Promise<any>} send  rejects when Roon refuses the track
   * @param {Record<string, any>} [meta]  carried on the run's status (which playlist it is)
   */
  function start(zone, tracks, kind, send, meta) {
    for (const [z, old] of runs) if (old.done && now() - old.ended > KEEP_MS) runs.delete(z);
    halt(zone, "replaced");
    /** @type {Run} */
    const r = { id: now().toString(36) + "-" + (++seq), kind, total: tracks.length, sent: 0, queued: 0, failed: 0,
      first_error: "", done: false, stopped: null, started: now(), ended: 0, meta: meta || {}, halt: null,
      settled: Promise.resolve() };
    r.settled = work(r, tracks.slice(), send, last.get(zone));
    queueOn(zone, r.settled);
    runs.set(zone, r);
    return view(r);
  }

  /** @param {string} zone */
  function status(zone) {
    const r = runs.get(zone);
    return r ? view(r) : null;
  }

  /**
   * @param {string} zone @param {string} [why]  "user" (the Stop button)
   * @param {string} [id]  the run meant: another run the zone has been given since is left alone, and answered
   */
  async function stop(zone, why, id) {
    const r = runs.get(zone);
    if (!r) return null;
    if (id && r.id !== id) return view(r);
    if (!r.done && !r.halt) r.halt = why || "user";
    await r.settled;
    return view(r);
  }

  /**
   * Something else for the zone that a run must not go on queueing behind (a Play now): the zone's run is ended, fn
   * waits for what the zone was given before it, and whatever the zone is given next waits for fn.
   * @template T
   * @param {string} zone @param {string} why  what the run's status says stopped it ("other")
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  function takeOver(zone, why, fn) {
    halt(zone, why);
    const after = last.get(zone);
    const p = (async () => {
      if (after) await after;
      return fn();
    })();
    queueOn(zone, p.then(() => {}, () => {}));
    return p;
  }

  return { start, status, stop, takeOver };
}

module.exports = { createOrderedPlay, GIVE_UP_AFTER };
