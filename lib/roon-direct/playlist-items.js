// @ts-check
"use strict";
/*
 * playlist-items.js — one page of a playlist's items over your server's connection (v1.9.51, moved out of the
 * smart-playlist probe to be shared with smart.js; dev/design/native-remote.md §12.1–12.3).
 *
 *   Playlist::VirtualItemsQuery (UiLanguage "en", a page size of 100) → its Count → the page retained → each
 *   item named by its Track's title, album and artist, as the items or their rows arrive (a track sent before
 *   on this connection comes by reference, and is named from the graph) → the page released and the query
 *   disposed, once each, whatever happens.
 *
 * What a page brings stays in the graph (some 3,800 objects for 100 tracks on the owner's server, §12.2).
 */
const { field, isRef, waitFor } = require("./objects");
const { SIG, pageArg, openPlaylistItems } = require("./methods");
const { readCount } = require("./locations");
const { plainCredit } = require("./find");

const PAGE = 100;
const ITEM = /(?:^|\.)PlaylistItem$/;
const ITEM_ROW = /(?:^|\.)VirtualQueryElement<(?:Sooloos\.Broker\.Api\.)?PlaylistItem>$/;

/**
 * @typedef {{ title: string, album: string | null, artist: string | null } | { arrived: false }} Item
 * @typedef {{ count: number | null, countSent: boolean, complete: boolean, arrived: number, items: Item[], pushed: Record<string, number> }
 *           | { error: string, count?: number | null, query?: boolean }} Page
 */

/**
 * One page of a playlist's items, by the caller in its turn on the session.
 * @param {any} s  the session
 * @param {{ pid: Buffer, known: Map<string, import("./albums").RoonAlbum> | null, timeoutMs: number, page: number, want: number }} o
 *   pid: the profile's id; known: the library's albums as sent on this session, by object id; want: how many to name
 * @param {bigint} playlistOid
 * @returns {Promise<Page>}
 */
async function readItemsPage(s, o, playlistOid) {
  const { g, graph } = s;
  const qid = await openPlaylistItems(g, playlistOid, o.pid, PAGE);
  let held = false;
  try {
    const c = await readCount(graph, qid, o.timeoutMs);
    if ("error" in c) return { query: true, error: "Its items query " + c.error + "." };
    // No Count within the grace: said, and the page asked for all the same (not taken for an empty list).
    const inferred = !!(/** @type {any} */ (c).inferred);
    /** The page's items, in the order they came, and what else it pushed, by type. */
    const order = /** @type {string[]} */ ([]);
    const pushed = /** @type {Record<string, number>} */ ({});
    const before = graph.onObject;
    graph.onObject = (/** @type {any} */ x) => {
      const t = x.typeName.replace(/^Sooloos\.Broker\.Api\./, "");
      pushed[t] = (pushed[t] || 0) + 1;
      const id = ITEM.test(x.typeName) ? x.oid.toString() : ITEM_ROW.test(x.typeName) && isRef(field(x, "Data")) ? field(x, "Data").$ref.toString() : null;
      if (id && !order.includes(id)) order.push(id);
      before(x);
    };
    /** An item's track, once it and its title have arrived. @param {string} id */
    const trackOf = (id) => { const t = field(graph.get(BigInt(id)), "Track"); const x = isRef(t) ? graph.get(t.$ref) : null; return x && field(x, "Title") !== undefined ? x : null; };
    try {
      const onPage = inferred ? 1 : Math.max(0, Math.min(c.count - o.page * PAGE, PAGE));
      const want = Math.min(onPage, o.want);
      let complete = true;
      if (onPage > 0) {
        const r = await g.call(qid, SIG.playlistItemsRetainPage, pageArg(o.page));
        if (!r.success) return { count: inferred ? null : c.count, error: `Your server refused the playlist's page ("${r.status}").` };
        held = true;
        complete = !!(await waitFor(o.timeoutMs, () => (order.length >= want && order.slice(0, want).every(trackOf) ? true : undefined)));
      }
      const items = order.slice(0, o.want).map((id) => {
        const t = trackOf(id);
        if (!t) return /** @type {Item} */ ({ arrived: false });
        const al = field(t, "Album");
        const alObj = isRef(al) ? graph.get(al.$ref) : null;
        const k = isRef(al) && o.known ? o.known.get(al.$ref.toString()) : undefined;
        const by = field(t, "PerformedBy") ?? (alObj ? field(alObj, "PerformedBy") : undefined);
        return { title: String(field(t, "Title")), album: (alObj && field(alObj, "Title")) || (k && k.title) || null,
          artist: typeof by === "string" ? plainCredit(by) : (k && k.artist) || null };
      });
      return { count: inferred ? null : c.count, countSent: !inferred, complete, arrived: order.length, items, pushed };
    } finally {
      graph.onObject = before;
    }
  } finally {
    if (held) g.callNoReply(qid, SIG.playlistItemsReleasePage, pageArg(o.page));
    g.callNoReply(qid, SIG.playlistItemsDispose, Buffer.alloc(0));
  }
}

module.exports = { readItemsPage, PAGE };
