// @ts-check
"use strict";
/*
 * lookup-once.js — an album's lookups on other sites (MusicBrainz's year, Qobuz's and Pitchfork's reviews,
 * Wikipedia's articles) asked once at a time, and only their answers remembered (v2.0.3-t12).
 *
 * Two faults the share card's timings showed (2.0.3-t5's trace, the owner's log of 2026-11-09):
 *   - The album view asks for an album's extras, and the share card opened from it asks again a second or two later.
 *     Each lookup was remembered only once it had finished, so the card's ask ran every lookup a second time: four or
 *     five more requests to Wikipedia, and a second turn in MusicBrainz's and Qobuz's one-a-second queues. Now the
 *     second ask waits for the first's answer.
 *   - A lookup that failed (Wikipedia's 429 "too many requests", a time limit, a 503) was remembered as "nothing
 *     there", so the album had no review until Rouen restarted. Now only an answer is remembered: "nothing there" is
 *     an answer, and so is a refusal that will not change (a 404, a 403); a failure that may pass is not, and the next
 *     ask tries again.
 *
 *   lookupOnce(store, key, run, { throwPassing }) → run()'s answer, kept in store under key; or the answer being
 *     fetched for key; or the one kept. run throws for a failure: null is the answer then, kept only when the failure
 *     will not pass. A failure may carry `value`, an answer in part (one of two lookups came back): returned, not kept.
 *     throwPassing: a failure that may pass is thrown to this caller instead (the labels scan, whose Qobuz pass stops
 *     after ten in a row: a scan of thousands of albums must not ask a site that is down for every one of them).
 *   mayPass(error) → whether asking again later could get an answer: a time limit, a dropped connection, 408, 429, a
 *     5xx. Anything else is an answer: a 404 or a 403, and a fault in the lookup's own reading of a page.
 */

/** The network's own failures, as Node's fetch reports them (its error's cause, or the error itself). */
const NETWORK = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "EHOSTUNREACH",
  "ENETUNREACH", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);

/** What a failure says, as lib/http.js throws it: "HTTP <status>", a time limit, or the fetch's own error. @param {any} e */
function mayPass(e) {
  if (!e) return false;
  if (e.name === "AbortError" || e.name === "TimeoutError") return true;
  const m = /^HTTP (\d{3})$/.exec(String(e.message));
  if (m) {
    const status = Number(m[1]);
    return status === 408 || status === 429 || status >= 500;
  }
  const code = (e.cause && e.cause.code) || e.code;
  return String(e.message) === "fetch failed" || NETWORK.has(code);
}

/** @type {WeakMap<Map<string, any>, Map<string, Promise<any>>>} */
const flights = new WeakMap();

/**
 * @template T
 * @param {Map<string, any>} store  the lookup's answers, by key (read elsewhere too: Qobuz's labels)
 * @param {string} key
 * @param {() => Promise<T>} run
 * @param {{ throwPassing?: boolean }} [o]
 * @returns {Promise<T | null>}
 */
function lookupOnce(store, key, run, o = {}) {
  if (store.has(key)) return Promise.resolve(store.get(key));
  let flying = flights.get(store);
  if (!flying) { flying = new Map(); flights.set(store, flying); }
  let p = flying.get(key);
  if (!p) {
    const inFlight = flying;
    // Shared by every ask while it runs: it rejects only with a failure that may pass, which each ask then takes as
    // it asked to (below).
    p = (async () => {
      try {
        const value = await run();
        store.set(key, value);
        return value;
      } catch (/** @type {any} */ e) {
        if (!mayPass(e)) { store.set(key, null); return null; }
        throw e;
      }
    })().finally(() => { inFlight.delete(key); });
    inFlight.set(key, p);
  }
  return o.throwPassing ? p : p.catch((/** @type {any} */ e) => (e && "value" in e ? e.value : null));
}

module.exports = { lookupOnce, mayPass };
