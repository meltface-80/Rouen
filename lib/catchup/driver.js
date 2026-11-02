// @ts-check
"use strict";
/*
 * driver.js — the catch-up (dev/design/android-app.md §4.22, v1.9.72-t56): This phone's plays, replayed to Roon on the
 * silent player (player.js) so Roon counts them. The owner, 2026-11-02: as soon as plays reach Rouen, home or away;
 * each track replayed to exactly where the phone stopped it, so Roon counts it or not by its own rules; Roon's history
 * (and Roon's own Last.fm, when on) takes them at the time they are caught up — Roon has no way to back-date a play.
 *
 * One play at a time, in the order heard:
 *   1. the player's elapsed is capped at how far the phone played the track (player.setCap);
 *   2. Roon is asked to play that track on "Rouen catch-up" (deps.playTrack: the album found by its title and artist,
 *      the track by its place and then its title);
 *   3. only a stream Roon starts after being asked is this play's (not one still running from the play before);
 *   4. once its elapsed reaches the cap, Roon is told that elapsed at once (player.report) and again on the next beat,
 *      SETTLE_MS later — at 120 times real time a beat is two minutes of track, so stopping on the first sight of the
 *      cap could leave Roon with an elapsed far short of it — and then the zone is stopped: the play is replayed, and
 *      Roon has counted it or not by its own rules, as it would have live.
 * A play Roon can't be asked for now (not paired, the library not read yet, a refusal it may not repeat) waits and is
 * tried again, at most MAX_TRIES times; one that can never be played (its album or track not in the library) is
 * dropped at once. Either is said in the status. Nothing waits for ever: asking and stopping have their own limits.
 * The queue is kept on disk (deps.store), so a restart loses nothing. A play already queued or recently replayed is not
 * taken twice (a phone sending the same plays again after a lost answer). Off (deps.enabled), nothing is replayed and
 * the player leaves Roon.
 */

const TICK_MS = 250;
/** Roon has this long to answer a play, to start its stream, for the play to reach its cap, and to stop. */
const ASK_MS = 60_000, START_MS = 30_000, PLAY_MS = 5 * 60_000, STOP_MS = 30_000;
/** After the cap is reached, this long (past one 1 s beat) before the zone is stopped. */
const SETTLE_MS = 1_500;
/** A play that failed for now is tried again after this long, this many times at most. */
const RETRY_MS = 30_000, MAX_TRIES = 5;
/** Kept on disk at most; older plays beyond it are dropped as new ones come (a phone offline for weeks). */
const MAX_QUEUE = 5000, MAX_RECENT = 30, MAX_SEEN = 2000;

/**
 * A play as the phone sends it: the album's title and artist, the track's title and its place in the album (0-based),
 * how far it was played (seconds) and when (ms since 1970); [tries]: how often it couldn't be played yet.
 * @typedef {{ album: string, artist: string, track: string, index: number, elapsed: number, at: number, tries?: number }} Play
 */

/** A play's identity, for taking it once. @param {Play} p */
const keyOf = (p) => p.at + "|" + p.album + "|" + p.track;

/**
 * @param {{
 *   player: { start: (host: string) => void, stop: () => void, setCap: (ms: number | null) => void, report: () => void,
 *     state: () => { connected: boolean, playing: boolean, elapsedMs: number, streams?: number } },
 *   host: () => string | null, enabled: () => boolean, zoneId: () => string | null,
 *   playTrack: (play: Play, zoneId: string) => Promise<void>, stop: (zoneId: string) => Promise<void>,
 *   store: { load: () => Play[], save: (plays: Play[]) => void }, log?: (line: string) => void, now?: () => number,
 *   timers?: { setInterval: typeof setInterval, clearInterval: typeof clearInterval } }} deps
 */
function createCatchup(deps) {
  const now = deps.now || Date.now;
  const T = deps.timers || { setInterval, clearInterval };
  const log = deps.log || ((/** @type {string} */ line) => console.log(line));
  /** @param {any} e */
  const errText = (e) => (e && e.message) || String(e);
  /** @type {Play[]} */
  let queue = [];
  try { queue = deps.store.load() || []; } catch (e) { log("[catch-up] couldn't read the kept plays: " + errText(e)); }
  /** Keys of plays replayed or dropped lately, so the same play sent again is not taken twice. @type {string[]} */
  const seen = [];
  /** @type {any} */
  let current = null;
  let waitUntil = 0;
  /** @type {any[]} */
  const recent = [];
  const counts = { replayed: 0, dropped: 0 };
  /** @type {any} */
  let timer = null;

  const save = () => { try { deps.store.save(queue); } catch (e) { log("[catch-up] couldn't keep the plays: " + errText(e)); } };
  /** @param {Play} p @param {string} result @param {string} [why] */
  function said(p, result, why) {
    recent.push({ album: p.album, track: p.track, elapsed: p.elapsed, result, why: why || null, at: new Date(now()).toISOString() });
    if (recent.length > MAX_RECENT) recent.splice(0, recent.length - MAX_RECENT);
  }
  /** The play at the head is over: [result] says how. @param {string} result @param {string} [why] */
  function finish(result, why) {
    const p = queue.shift();
    current = null;
    deps.player.setCap(null);
    if (p) {
      said(p, result, why);
      if (result === "replayed") counts.replayed++; else counts.dropped++;
      seen.push(keyOf(p));
      if (seen.length > MAX_SEEN) seen.splice(0, seen.length - MAX_SEEN);
    }
    save();
  }
  /** The play at the head can't be played now: tried again later, or given up after MAX_TRIES. @param {string} why */
  function later(why) {
    const p = current && current.play;
    current = null;
    deps.player.setCap(null);
    if (!p) return;
    p.tries = (p.tries || 0) + 1;
    if (p.tries >= MAX_TRIES) { finish("dropped", "gave up after " + p.tries + " tries: " + why); return; }
    said(p, "waiting", why);
    save();
    waitUntil = now() + RETRY_MS;
  }
  /** Stop the zone; then the play is replayed (a stop Roon refuses still ends it: Roon's next play replaces it). */
  function stopIt() {
    const mine = current;
    mine.phase = "stopping";
    mine.stoppingAt = now();
    deps.stop(mine.zone).then(() => { if (current === mine) finish("replayed"); },
      (e) => { if (current === mine) finish("replayed", "stopping it: " + errText(e)); });
  }

  /** The play under way. @param {{ playing: boolean, elapsedMs: number, streams?: number }} st */
  function follow(st) {
    const c = current;
    if (c.phase === "asking") { if (now() - c.askedAt > ASK_MS) later("Roon didn't answer"); return; }
    if (c.phase === "stopping") { if (now() - c.stoppingAt > STOP_MS) finish("replayed", "Roon didn't say it stopped"); return; }
    const started = (st.streams || 0) > c.streamsAtAsk && st.playing;
    if (!started) {
      if (now() - c.startedAt > START_MS) {
        deps.stop(c.zone).catch(() => { /* a zone that never started has nothing to stop: the play is tried again */ });
        later("Roon didn't start it");
      }
      return;
    }
    if (st.elapsedMs >= c.capMs) {
      if (c.reachedAt == null) { c.reachedAt = now(); deps.player.report(); return; }
      if (now() - c.reachedAt >= SETTLE_MS) stopIt();
      return;
    }
    if (now() - c.startedAt > PLAY_MS) {
      deps.stop(c.zone).catch(() => { /* already stopped, or Roon gone: the play is tried again either way */ });
      later("it didn't reach where the phone stopped");
    }
  }

  function tick() {
    if (!deps.enabled()) { deps.player.stop(); return; }
    const host = deps.host();
    if (!host) return;
    deps.player.start(host);
    const st = deps.player.state();
    if (current) { follow(st); return; }
    if (!queue.length || now() < waitUntil || !st.connected) return;
    const zone = deps.zoneId();
    if (!zone) return;   // not enabled in Roon (Settings → Audio) yet: nothing to play to
    const play = queue[0];
    const capMs = Math.max(0, Math.round(play.elapsed * 1000));
    current = { play, zone, capMs, phase: "asking", askedAt: now(), streamsAtAsk: st.streams || 0, startedAt: 0, reachedAt: null };
    deps.player.setCap(capMs);
    const mine = current;
    deps.playTrack(play, zone).then(() => {
      if (current !== mine) return;
      mine.phase = "playing";
      mine.startedAt = now();
    }, (e) => {
      if (current !== mine) return;
      if (e && e.permanent) finish("dropped", errText(e)); else later(errText(e));
    });
  }

  return {
    /** Start following the queue (each TICK_MS). */
    start() { if (!timer) timer = T.setInterval(tick, TICK_MS); },
    /** Stop following it, and leave Roon. */
    stop() { if (timer) T.clearInterval(timer); timer = null; deps.player.stop(); },
    /**
     * Plays heard on the phone, in the order heard: one already queued or lately replayed is not taken again; the
     * oldest go when the queue is full. How many were taken. @param {Play[]} plays
     */
    add(plays) {
      const have = new Set(queue.map(keyOf).concat(seen));
      const fresh = plays.filter((p) => { const k = keyOf(p); if (have.has(k)) return false; have.add(k); return true; });
      queue.push(...fresh);
      // The play being replayed now, at the head, is kept: only the oldest plays behind it go.
      if (queue.length > MAX_QUEUE) queue.splice(current ? 1 : 0, queue.length - MAX_QUEUE);
      if (fresh.length) save();
      return fresh.length;
    },
    /** How many plays wait. */
    waiting() { return queue.length; },
    /** What the catch-up is doing, for its status line. */
    status() {
      return { enabled: deps.enabled(), waiting: queue.length, replaying: current ? { album: current.play.album, track: current.play.track } : null,
        replayed: counts.replayed, dropped: counts.dropped, zone: deps.zoneId(), recent: recent.slice().reverse() };
    },
    tick,
  };
}

module.exports = { createCatchup, TICK_MS, ASK_MS, START_MS, PLAY_MS, STOP_MS, SETTLE_MS, RETRY_MS, MAX_TRIES, MAX_QUEUE };
