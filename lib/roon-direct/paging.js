// @ts-check
"use strict";
/*
 * paging.js — reading a library query's pages, one at a time: retained, its
 * items gathered as the Core pushes them, released. Shared by the probe's
 * track queries (probe.js, since v1.9.11), its album queries by Location
 * (locations.js, v1.9.16) and stage 1's read of the whole album list
 * (albums.js, v1.9.18), so all keep the same promises
 * (dev/design/roon-native.md §3):
 *  - every page retained is released exactly once (ReleasePage, sent without
 *    waiting, because the Core never answers it), whatever happens while it
 *    is held;
 *  - a page whose RetainPage the Core refused or never confirmed is not
 *    released: it may not exist, and releasing twice corrupts the Core's count;
 *  - items are what the Core pushes while the query is open, new or pushed
 *    again, gathered across all its pages — watched as they arrive
 *    (graph.onObject), never by scanning the graph.
 */
const { waitFor } = require("./objects");
const { pageArg } = require("./methods");

/**
 * @param {ReturnType<typeof import("./methods").guarded>} g
 * @param {import("./objects").ObjectGraph} graph
 * @param {bigint} qid       the query
 * @param {number} count     its Count
 * @param {{ pageSize: number, timeoutMs: number, lifetime: any, retain: string, release: string,
 *           take: (obj: import("./objects").RoonObject) => string | null,
 *           maxPages?: number, stopWhenShort?: boolean, ready?: (key: string) => boolean,
 *           afterPage?: (page: number, full: boolean) => void }} o
 *   take: the key an item is gathered under, or null for an object that is not one;
 *   maxPages: read at most this many pages; stopWhenShort: a page that comes
 *   short (its wait runs out) ends the reading, rather than each later page
 *   costing a full wait for the same reason; ready: a page is whole only when
 *   every item gathered so far is ready too (its fields have arrived, which
 *   the Core may push after the item itself) — once ready, an item is not
 *   asked again, so a page's wait looks only at the items still waited on
 *   (stage 1 pages a whole library, v1.9.18); afterPage: told once each page
 *   is released, whether or not it came whole
 * @returns {Promise<{ seen: Set<string>, pages: number, short?: boolean, error?: string }>}
 *   throws what a call throws (a timeout), after releasing what it holds
 */
async function pageThrough(g, graph, qid, count, o) {
  /** @type {Set<string>} */
  const seen = new Set();
  /** Gathered, and not yet seen ready. @type {Set<string>} */
  const waiting = new Set();
  const before = graph.onObject;
  graph.onObject = (obj) => { const k = o.take(obj); if (k && !seen.has(k)) { seen.add(k); waiting.add(k); } };
  const ready = o.ready;
  const allReady = () => {
    if (!ready) return true;
    for (const k of waiting) { if (!ready(k)) return false; waiting.delete(k); }
    return true;
  };
  let page = 0;
  try {
    for (; page * o.pageSize < count && (o.maxPages === undefined || page < o.maxPages); page++) {
      const want = Math.min(count, (page + 1) * o.pageSize);
      const r = await g.call(qid, o.retain, pageArg(page));
      if (!r.success) return { seen, pages: page, error: `the Core refused page ${page}: ${r.status}` };
      o.lifetime.pagesRetained++;
      let full;
      try {
        full = await waitFor(o.timeoutMs, () => (seen.size >= want && allReady() ? true : undefined));
      } finally {
        if (g.callNoReply(qid, o.release, pageArg(page))) o.lifetime.pagesReleased++;
        else o.lifetime.unsent++;
      }
      if (o.afterPage) o.afterPage(page, !!full);
      if (!full && o.stopWhenShort) return { seen, pages: page + 1, short: true };
    }
    return { seen, pages: page };
  } finally {
    graph.onObject = before;
  }
}

module.exports = { pageThrough };
