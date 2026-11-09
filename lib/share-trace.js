// @ts-check
"use strict";
/*
 * share-trace.js — what an album's extras lookup spent its time on (v2.0.3-t5), so that a slow share card can be
 * explained from a log instead of guessed at.
 *
 * The share card is drawn only once /api/album/extras answers, and that answer waits on four outside sites at once
 * (MusicBrainz for the year; Pitchfork, Qobuz and Wikipedia for the review), each with its own pacing and its own
 * time limit. Nothing said which one a slow card had waited on. This records, for each extras request:
 *
 *   - who asked (the share card, the album view, Shelf), for which album, and how long the whole answer took;
 *   - each step (the year, the day, the three review sources) from its start to its end — a step that made no request
 *     was answered from what the server remembered;
 *   - every request a step made to an outside site (lib/http.js tells this module), with its time and its status, so
 *     the gap between a step's start and its first request is the time it spent waiting its turn in a rate limit;
 *   - the other extras requests for the same album that were still running when it started (the album view and the
 *     share card asking for the same thing at the same time);
 *   - and, once the page has drawn the card, the page's own steps (the font, the round trip, the pictures, the
 *     drawing, the PNG), sent back to POST /api/debug/share-card.
 *
 * Requests and steps are tied to their extras request by Node's AsyncLocalStorage, so nothing between the route and
 * lib/http.js passes anything along. Kept in memory: the last KEEP requests, newest first, for
 * GET /api/debug/share-card. Nothing here changes what any lookup does.
 */

const { AsyncLocalStorage } = require("node:async_hooks");

const KEEP = 30;
// A page's step report: only these keys, each only as a number, a yes or no, or a few words.
const CLIENT_NUMBERS = ["total_ms", "font_ms", "extras_ms", "extras_status", "images_ms", "draw_ms", "encode_ms",
  "width", "height", "bytes"];
const CLIENT_FLAGS = ["font_timed_out", "font_failed", "cover", "logo"];
const CLIENT_WORDS = ["result", "error", "where"];

/** Which outside site a request went to, by its host. @param {string} url */
function siteOf(url) {
  let host = "";
  try { host = new URL(url).hostname; } catch (e) { return "other"; }   // not a URL: counted, not attributed
  if (/(^|\.)musicbrainz\.org$/.test(host)) return "musicbrainz";
  if (/(^|\.)qobuz\.com$/.test(host)) return "qobuz";
  if (/(^|\.)wikipedia\.org$/.test(host)) return "wikipedia";
  if (/(^|\.)pitchfork\.com$/.test(host)) return "pitchfork";
  return host || "other";
}

/** A request's path without its query (which names the album). @param {string} url */
function pathOf(url) {
  try { return new URL(url).pathname.slice(0, 80); } catch (e) { return ""; }   // not a URL: no path to show
}

/**
 * @typedef {{ site: string, path: string, step: string|null, at: number, ms: number, status: string }} TraceRequest
 * @typedef {{ name: string, at: number, ms: number|null, outcome: string|null }} TraceStep
 * @typedef {{ id: number, started: number, caller: string, key: string, album: string, ms: number|null,
 *   status: string|null, alongside: number[], steps: TraceStep[], requests: TraceRequest[],
 *   client: Record<string, any>|null }} Trace
 */

/**
 * @param {{ now?: () => number, keep?: number, log?: (line: string) => void }} [o]
 */
function createShareTrace(o = {}) {
  const now = o.now || Date.now;
  const keep = o.keep || KEEP;
  /** @type {AsyncLocalStorage<{ trace: Trace, step: string|null }>} */
  const als = new AsyncLocalStorage();
  /** @type {Trace[]} newest first */
  const done = [];
  /** @type {Set<Trace>} */
  const running = new Set();
  let nextId = 1;

  /**
   * Runs fn as one traced extras request.
   * @template T
   * @param {{ caller: string, key: string, title: string, artist: string }} info
   * @param {(trace: Trace) => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async function run(info, fn) {
    /** @type {Trace} */
    const trace = {
      id: nextId++, started: now(), caller: info.caller, key: info.key,
      album: info.title + (info.artist ? " — " + info.artist : ""),
      ms: null, status: null,
      alongside: [...running].filter((t) => t.key === info.key).map((t) => t.id),
      steps: [], requests: [], client: null,
    };
    running.add(trace);
    try {
      return await als.run({ trace, step: null }, () => fn(trace));
    } finally {
      running.delete(trace);
      trace.ms = now() - trace.started;
      if (trace.status == null) trace.status = "failed";
      done.unshift(trace);
      if (done.length > keep) done.length = keep;
      if (o.log && (trace.caller === "card" || trace.ms >= 2000)) o.log(lineOf(trace));
    }
  }

  /**
   * A named step of the current extras request; outside one, fn runs untraced.
   * @template T
   * @param {string} name @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  function step(name, fn) {
    const cur = als.getStore();
    if (!cur || cur.trace.ms != null) return fn();
    const trace = cur.trace;
    /** @type {TraceStep} */
    const s = { name, at: now() - trace.started, ms: null, outcome: null };
    trace.steps.push(s);
    const end = (/** @type {string} */ outcome) => { s.ms = now() - trace.started - s.at; s.outcome = outcome; };
    return als.run({ trace, step: name }, () => {
      /** @type {Promise<T>} */
      let p;
      try { p = Promise.resolve(fn()); } catch (e) { end("error"); throw e; }
      p.then((v) => end(v == null ? "nothing" : "found"), () => end("error"));
      return p;
    });
  }

  /**
   * lib/http.js's observer: one request to an outside site, finished.
   * @param {{ url: string, start: number, end: number, status: string }} r
   */
  function request(r) {
    const cur = als.getStore();
    // A finished answer takes no more: work it set going (a background lookup kicked from inside it) carries its
    // context on, and would otherwise grow a kept trace for as long as that work runs.
    if (!cur || cur.trace.ms != null) return;
    cur.trace.requests.push({
      site: siteOf(r.url), path: pathOf(r.url), step: cur.step,
      at: r.start - cur.trace.started, ms: r.end - r.start, status: r.status,
    });
  }

  /**
   * The page's own steps for a card, from POST /api/debug/share-card: kept on the extras request it names, or on
   * its own when that request never answered (or the server was restarted since).
   * @param {any} body
   * @returns {boolean} whether it was kept
   */
  function client(body) {
    if (!body || typeof body !== "object") return false;
    /** @type {Record<string, any>} */
    const phases = {};
    for (const k of CLIENT_NUMBERS) if (typeof body[k] === "number" && Number.isFinite(body[k])) phases[k] = Math.round(body[k]);
    for (const k of CLIENT_FLAGS) if (typeof body[k] === "boolean") phases[k] = body[k];
    for (const k of CLIENT_WORDS) if (typeof body[k] === "string" && body[k]) phases[k] = body[k].slice(0, 120);
    if (!Object.keys(phases).length) return false;
    const id = Number(body.trace);
    const trace = Number.isInteger(id) ? done.find((t) => t.id === id) : null;
    if (trace) { trace.client = phases; return true; }
    done.unshift({ id: nextId++, started: now(), caller: "card", key: "", album: "", ms: null, status: "page only",
      alongside: [], steps: [], requests: [], client: phases });
    if (done.length > keep) done.length = keep;
    return true;
  }

  /** The kept requests, newest first, for GET /api/debug/share-card. */
  function recent() {
    const t = now();
    return done.map((tr) => ({
      id: tr.id, caller: tr.caller, album: tr.album, ago_ms: t - tr.started,
      ms: tr.ms, status: tr.status, alongside: tr.alongside,
      steps: tr.steps.map((s) => summarise(tr, s)),
      requests: tr.requests,
      page: tr.client,
    }));
  }

  /** A step with what it waited for and what it asked. @param {Trace} tr @param {TraceStep} s */
  function summarise(tr, s) {
    const reqs = tr.requests.filter((r) => r.step === s.name);
    const first = reqs.length ? Math.min(...reqs.map((r) => r.at)) : null;
    return {
      // "step", not "name": the Android app's saved log hides every "name" (LogRedact.NAMED).
      step: s.name, at: s.at, ms: s.ms, outcome: s.outcome,
      requests: reqs.length,
      // Before its first request a step is waiting its turn (a rate limit's queue); with none it was remembered.
      waited_ms: first == null ? null : first - s.at,
      remembered: reqs.length === 0,
    };
  }

  /** The Server-Timing header for an extras answer: each step's time, and the trace's id. @param {Trace} tr */
  function serverTiming(tr) {
    const parts = tr.steps.map((s) => `${s.name.replace(/[^\w-]/g, "")};dur=${s.ms == null ? now() - tr.started - s.at : s.ms}`);
    parts.push(`total;dur=${now() - tr.started}`);
    return parts.join(", ");
  }

  return { run, step, request, client, recent, serverTiming, lineOf };
}

/**
 * One line for the server's log.
 *   [share-card] #12 card "Timeless" — Goldie: 6234 ms · year 2310 ms (1 req, waited 1130 ms) · qobuz 4870 ms (2 req)
 *   · wikipedia 5980 ms (6 req) · pitchfork 410 ms (1 req, HTTP 404) · alongside #11
 * @param {Trace} tr
 */
function lineOf(tr) {
  const steps = tr.steps.map((s) => {
    const reqs = tr.requests.filter((r) => r.step === s.name);
    const bits = [];
    if (!reqs.length) bits.push("remembered");
    else {
      bits.push(reqs.length + " req");
      const waited = Math.min(...reqs.map((r) => r.at)) - s.at;
      if (waited >= 200) bits.push("waited " + waited + " ms");
      const bad = reqs.filter((r) => r.status !== "200").map((r) => r.status);
      if (bad.length) bits.push(bad.join(", "));
    }
    return `${s.name} ${s.ms == null ? "?" : s.ms} ms (${bits.join(", ")})`;
  });
  return `[share-card] #${tr.id} ${tr.caller} "${tr.album}": ${tr.ms} ms, ${tr.status}` +
    (steps.length ? " · " + steps.join(" · ") : "") +
    (tr.alongside.length ? " · alongside " + tr.alongside.map((n) => "#" + n).join(", ") : "");
}

module.exports = { createShareTrace, siteOf, lineOf };
