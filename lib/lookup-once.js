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
 *   lookupOnce(store, key, run) → run()'s answer, kept in store under key; or the answer being fetched for key; or
 *     the one kept. run throws for a failure: null is the answer then, kept only when the failure will not pass. A
 *     failure may carry `value`, an answer in part (one of two lookups came back): returned, not kept.
 *   mayPass(error) → whether asking again later could get an answer
 */

/** What a failure says, as lib/http.js throws it: "HTTP <status>", or the fetch's own error. @param {any} e */
function mayPass(e) {
  if (!e) return true;
  const m = /^HTTP (\d{3})$/.exec(String(e.message));
  if (!m) return true;                              // a time limit, a dropped connection, a page that was not JSON
  const status = Number(m[1]);
  return status === 408 || status === 429 || status >= 500;
}

/** @type {WeakMap<Map<string, any>, Map<string, Promise<any>>>} */
const flights = new WeakMap();

/**
 * @template T
 * @param {Map<string, any>} store  the lookup's answers, by key (read elsewhere too: Qobuz's labels)
 * @param {string} key
 * @param {() => Promise<T>} run
 * @returns {Promise<T | null>}
 */
function lookupOnce(store, key, run) {
  if (store.has(key)) return Promise.resolve(store.get(key));
  let flying = flights.get(store);
  if (!flying) { flying = new Map(); flights.set(store, flying); }
  const running = flying.get(key);
  if (running) return running;
  const inFlight = flying;
  const p = (async () => {
    try {
      const value = await run();
      store.set(key, value);
      return value;
    } catch (/** @type {any} */ e) {
      if (!mayPass(e)) { store.set(key, null); return null; }
      return e && "value" in e ? e.value : null;
    }
  })().finally(() => { inFlight.delete(key); });
  inFlight.set(key, p);
  return p;
}

module.exports = { lookupOnce, mayPass };
