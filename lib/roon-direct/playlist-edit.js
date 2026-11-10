// @ts-check
"use strict";
/*
 * playlist-edit.js — a Roon playlist's tracks moved and removed from its page (2.0.4-t13, dev/design/playlist-edit.md
 * §4.2). The owner, 2026-11-10: "I don't see a way to reorder tracks or delete tracks from playlists". The two methods
 * were proven by the probe on the owner's server first (playlist-edit-probe.js, §3.1).
 *
 * A row is named by its place in the playlist and its title: the page's rows come from the official API, which knows
 * no item ids, and an item's object id belongs to one connection. Each change:
 *   in one turn: the playlist, editable (playlists.js) → the page holding each place (playlist-items.js) → a title not
 *   the one named is stale, and nothing is sent → Playlists::MoveItems or Playlists::RemoveItems;
 *   then read back, a read a turn, until it shows (by the item's id) or five reads have passed.
 * Changes go one at a time, across the server.
 */
const { SIG, playlistArgs } = require("./methods");
const { readItemsPage, PAGE } = require("./playlist-items");
const { norm } = require("./playlist-artists");
const { profileFor } = require("./session");

/** Objects of room a page read leaves, as playlist-artists.js keeps for smart.js's pages. */
const PAGE_ROOM = 70000;
const READS = 5;
const NOT_TAKEN = "Roon didn't take that change.";
const STALE = "This playlist has changed since it was opened; reopen it.";
/** Read-backs that all failed: the change may have been made, and the page can't say. */
const UNSEEN = "Your server didn't let Rouen read the playlist back to see the change; reopen it to see whether it was made.";

/**
 * @typedef {{ ok: true } | { ok: false, error: string, status: number, stale?: true }} Answer
 * @typedef {{ oid: string, title: string }} Item
 */

/**
 * @param {{ link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>,
 *           profile: () => string | null,
 *           playlists: { editable(id: string): Promise<{ s: any, svc: any, pl: { oid: bigint, id: string, name: string } } | { notSent: string }> },
 *           log?: (line: string) => void, timeoutMs?: number, settleMs?: number, sleep?: (ms: number) => Promise<void>,
 *           page?: typeof readItemsPage }} deps
 *   page: stands in for playlist-items.js's readItemsPage in tests
 */
function createPlaylistEdit(deps) {
  const log = deps.log || (() => {});
  const timeoutMs = deps.timeoutMs || 8000;
  const settleMs = deps.settleMs ?? 1000;
  const sleep = deps.sleep || ((ms) => new Promise((r) => { setTimeout(r, ms); }));
  const page = deps.page || readItemsPage;
  /** The change before this one, settled or not: each waits for it. */
  let chain = Promise.resolve();

  /** @param {string} error @param {number} status @returns {Answer} */
  const no = (error, status) => ({ ok: false, error, status });

  /**
   * The items on the page holding `at`, and the playlist's count; or why not. By a caller in its turn.
   * @param {any} s @param {Buffer} pid @param {bigint} oid @param {number} at
   * @returns {Promise<{ count: number, first: number, items: Array<Item | null> } | { why: Answer }>}
   */
  async function pageOf(s, pid, oid, at) {
    if (s.graph.maxObjects - s.graph.objects.size < PAGE_ROOM) {
      return { why: no("Rouen's copy of what your server has sent on this connection is nearly full; this waits for the next connection.", 503) };
    }
    const p = Math.floor(at / PAGE);
    const got = await page(s, { pid, known: null, timeoutMs, page: p, want: PAGE }, oid);
    if ("error" in got) return { why: no(got.error, 502) };
    if (got.count === null) return { why: no("Your server didn't say how many tracks the playlist has.", 502) };
    const items = got.items.map((it, i) => ("arrived" in it ? null : { oid: got.ids[i], title: it.title }));
    return { count: got.count, first: p * PAGE, items };
  }

  /**
   * The item at a place, when it is the title named and the playlist the length the page has; or why not (stale: the
   * playlist changed, or holds tracks the page's rows don't, which would shift every place after them: the review).
   * From the page given when it holds the place, else read. By a caller in its turn.
   * @param {any} s @param {Buffer} pid @param {bigint} oid @param {{ at: number, title: string, count?: number }} want
   * @param {{ count: number, first: number, items: Array<Item | null> }} [read]  a page already read
   * @returns {Promise<{ item: Item, count: number, page: { count: number, first: number, items: Array<Item | null> } } | { why: Answer }>}
   */
  async function itemAt(s, pid, oid, want, read) {
    const holds = read && Math.floor(want.at / PAGE) * PAGE === read.first;
    const got = holds && read ? read : await pageOf(s, pid, oid, want.at);
    if ("why" in got) return got;
    const stale = { why: /** @type {Answer} */ ({ ok: false, error: STALE, status: 409, stale: true }) };
    if (want.at >= got.count || (want.count !== undefined && want.count !== got.count)) return stale;
    const item = got.items[want.at - got.first];
    if (!item) return { why: no("Your server didn't send that track in time; try again.", 502) };
    if (norm(item.title) !== norm(want.title)) return stale;
    return { item, count: got.count, page: got };
  }

  /**
   * The playlist, editable, and its session and profile; or why not. By a caller in its turn.
   * @param {string} id
   * @returns {Promise<{ why: Answer } | { s: any, svc: any, pl: { oid: bigint, id: string, name: string }, pid: Buffer }>}
   */
  async function open(id) {
    const e = await deps.playlists.editable(id);
    if ("notSent" in e) return { why: no(e.notSent || "Native mode is off.", 503) };
    const pid = profileFor({ profiles: e.s.root.profiles || [], profileId: e.s.root.profileId }, deps.profile());
    if (!Buffer.isBuffer(pid)) return { why: no("Your server sent no profile.", 503) };
    return { s: e.s, svc: e.svc, pl: e.pl, pid };
  }

  /**
   * Read back until `shown` holds, a read a turn, on the session the change was sent on. A read that fails (a query
   * not answered in time, a page refused) is one of the five, not the end (the review): the next may show it.
   * @param {any} s @param {() => Promise<boolean | { why: Answer }>} shown
   * @returns {Promise<Answer>}
   */
  async function believe(s, shown) {
    let seen = false;
    for (let i = 0; i < READS; i++) {
      await sleep(settleMs);
      const r = await deps.inTurn(async () => {
        const now = deps.link ? deps.link.session() : null;
        if (now !== s) return { gone: true };
        return shown();
      });
      if (r === true) return { ok: true };
      if (r && typeof r === "object" && "gone" in r) {
        return no("The connection to your server changed before the change could be seen; reopen the playlist to see whether it was made.", 502);
      }
      if (r === false) seen = true;
    }
    // Read and not there: not taken. Never read: not known either way.
    return no(seen ? NOT_TAKEN : UNSEEN, 502);
  }

  /** One change after another. @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
  function inOrder(fn) {
    const run = chain.then(fn, fn);
    // The next waits for this one, however it ends; its own outcome goes to its caller.
    chain = run.then(() => {}, () => {});
    return run;
  }

  /** @param {any} e @returns {Answer} */
  const thrown = (e) => no("That didn't reach your server: " + String((e && e.message) || e), 502);

  return {
    /**
     * The track at `from` moved to `to` (its place once moved), believed when the playlist read back shows it.
     * @param {{ id: string, from: number, fromTitle: string, to: number, toTitle: string, count?: number }} o
     *   count: how many tracks the page has, when it has them all: the playlist read must be as long
     * @returns {Promise<Answer>}
     */
    move(o) {
      return inOrder(async () => {
        try {
          const sent = await deps.inTurn(async () => {
            const at = await open(o.id);
            if ("why" in at) return at;
            const a = await itemAt(at.s, at.pid, at.pl.oid, { at: o.from, title: o.fromTitle, count: o.count });
            if ("why" in a) return a;
            // Both places on one page (the usual case): read once (the review).
            const b = await itemAt(at.s, at.pid, at.pl.oid, { at: o.to, title: o.toTitle, count: o.count }, a.page);
            if ("why" in b) return b;
            // Down: after the track now at its new place; up: before it.
            const where = o.to > o.from ? "after" : "before";
            const r = await at.s.g.call(at.svc.oid, SIG.moveItems, playlistArgs.moveItems(at.pl.oid, [BigInt(a.item.oid)], where, BigInt(b.item.oid)));
            if (!r.success) return { why: no(`Your server refused the move ("${r.status}").`, 502) };
            log(`playlist edit: moved ${o.from + 1} to ${o.to + 1} in "${at.pl.name}"`);
            return { s: at.s, pid: at.pid, oid: at.pl.oid, moved: a.item.oid, count: a.count };
          });
          if ("why" in sent) return sent.why;
          return await believe(sent.s, async () => {
            const got = await pageOf(sent.s, sent.pid, sent.oid, o.to);
            if ("why" in got) return got;
            const here = got.items[o.to - got.first];
            return got.count === sent.count && !!here && here.oid === sent.moved;
          });
        } catch (e) {
          return thrown(e);
        }
      });
    },

    /**
     * The track at `at` removed, believed when the playlist read back is one shorter and it is gone from its page.
     * @param {{ id: string, at: number, title: string, count?: number }} o  count: as move's
     * @returns {Promise<Answer>}
     */
    remove(o) {
      return inOrder(async () => {
        try {
          const sent = await deps.inTurn(async () => {
            const at = await open(o.id);
            if ("why" in at) return at;
            const a = await itemAt(at.s, at.pid, at.pl.oid, { at: o.at, title: o.title, count: o.count });
            if ("why" in a) return a;
            // No answer comes (the catalogue gives it no callback): what it did is read back.
            at.s.g.callNoReply(at.svc.oid, SIG.removeItems, playlistArgs.removeItems(at.pl.oid, [BigInt(a.item.oid)]));
            log(`playlist edit: removed ${o.at + 1} from "${at.pl.name}"`);
            return { s: at.s, pid: at.pid, oid: at.pl.oid, gone: a.item.oid, count: a.count };
          });
          if ("why" in sent) return sent.why;
          const left = sent.count - 1;
          return await believe(sent.s, async () => {
            const got = await pageOf(sent.s, sent.pid, sent.oid, Math.max(0, Math.min(o.at, left - 1)));
            if ("why" in got) return got;
            return got.count === left && !got.items.some((it) => it && it.oid === sent.gone);
          });
        } catch (e) {
          return thrown(e);
        }
      });
    },
  };
}

module.exports = { createPlaylistEdit, NOT_TAKEN, STALE, UNSEEN };
