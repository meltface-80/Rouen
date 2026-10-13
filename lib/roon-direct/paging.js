// @ts-check
"use strict";
/*
 * paging.js — reading a library query's pages, one at a time: retained, its
 * items gathered as the Core pushes them, released. Shared by the probe's
 * track queries (probe.js, since v1.9.11) and its album queries by Location
 * (locations.js, v1.9.16), so both keep the same promises
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
 *           maxPages?: number, stopWhenShort?: boolean, ready?: (key: string) => boolean }} o
 *   take: the key an item is gathered under, or null for an object that is not one;
 *   maxPages: read at most this many pages; stopWhenShort: a page that comes
 *   short (its wait runs out) ends the reading, rather than each later page
 *   costing a full wait for the same reason; ready: a page is whole only when
 *   every item gathered so far is ready too (its fields have arrived, which
 *   the Core may push after the item itself)
 * @returns {Promise<{ seen: Set<string>, pages: number, short?: boolean, error?: string }>}
 *   throws what a call throws (a timeout), after releasing what it holds
 */
async function pageThrough(g, graph, qid, count, o) {
  /** @type {Set<string>} */
  const seen = new Set();
  const before = graph.onObject;
  graph.onObject = (obj) => { const k = o.take(obj); if (k) seen.add(k); };
  let page = 0;
  try {
    for (; page * o.pageSize < count && (o.maxPages === undefined || page < o.maxPages); page++) {
      const want = Math.min(count, (page + 1) * o.pageSize);
      const r = await g.call(qid, o.retain, pageArg(page));
      if (!r.success) return { seen, pages: page, error: `the Core refused page ${page}: ${r.status}` };
      o.lifetime.pagesRetained++;
      let full;
      try {
        const ready = o.ready;
        full = await waitFor(o.timeoutMs, () => (seen.size >= want && (!ready || [...seen].every(ready)) ? true : undefined));
      } finally {
        if (g.callNoReply(qid, o.release, pageArg(page))) o.lifetime.pagesReleased++;
        else o.lifetime.unsent++;
      }
      if (!full && o.stopWhenShort) return { seen, pages: page + 1, short: true };
    }
    return { seen, pages: page };
  } finally {
    graph.onObject = before;
  }
}

module.exports = { pageThrough };
