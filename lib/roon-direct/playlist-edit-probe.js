// @ts-check
"use strict";
/*
 * playlist-edit-probe.js — a playlist's items moved and removed, tried once by hand before anything is built on them
 * (2.0.4-t12, dev/design/playlist-edit.md §3). The owner, 2026-11-10: "I don't see a way to reorder tracks or delete
 * tracks from playlists".
 *
 * On a playlist it makes for the purpose and deletes again, whatever happens, so nothing else is touched:
 *   CreatePlaylist + InsertAlbums (proven, playlists.js) → Playlist::VirtualItemsQuery (proven, playlist-items.js), the
 *   items in order, each by its track's title → Playlists::MoveItems(the third, Before, the first) → read again →
 *   Playlists::RemoveItems(the first as made; no answer comes) → read again → Delete (proven).
 * Each step says what was sent, what came back, and the order read before and after; a verdict for each method.
 */
const { field, isRef, waitFor } = require("./objects");
const { SIG, pageArg, openPlaylistItems, playlistArgs } = require("./methods");
const { readCount } = require("./locations");
const { profileFor } = require("./session");

const PAGE = 100;
const ITEM = /(?:^|\.)PlaylistItem$/;
const ITEM_ROW = /(?:^|\.)VirtualQueryElement<(?:Sooloos\.Broker\.Api\.)?PlaylistItem>$/;
const NAME = "Rouen edit trial";

/**
 * A playlist's first page of items, in the order they come (as playlist-items.js reads a playlist to play it), each with
 * its object id (an item is named to Roon by it), its track's title and its Index (reported, not trusted: an item this
 * connection holds already comes by reference, its Index as it was). Only items of this playlist are taken (the review):
 * one whose Playlist names another is passed over.
 * @param {any} s @param {Buffer} pid @param {bigint} playlistOid @param {number} timeoutMs
 * @returns {Promise<{ count: number, items: Array<{ oid: string, title: string, index: number | null }> } | { error: string }>}
 */
async function itemsNow(s, pid, playlistOid, timeoutMs) {
  const { g, graph } = s;
  const qid = await openPlaylistItems(g, playlistOid, pid, PAGE);
  let held = false;
  try {
    const c = await readCount(graph, qid, timeoutMs);
    if ("error" in c) return { error: "Its items query " + c.error + "." };
    /** @type {string[]} */
    const order = [];
    const before = graph.onObject;
    graph.onObject = (/** @type {any} */ x) => {
      const id = ITEM.test(x.typeName) ? x.oid.toString() : ITEM_ROW.test(x.typeName) && isRef(field(x, "Data")) ? field(x, "Data").$ref.toString() : null;
      if (id && !order.includes(id) && ours(id)) order.push(id);
      before(x);
    };
    /** Not an item of another playlist: one whose Playlist is known and is not this one is passed over. @param {string} id */
    function ours(id) {
      const p = field(graph.get(BigInt(id)), "Playlist");
      return !isRef(p) || p.$ref === playlistOid;
    }
    /** @param {string} id */
    const titleOf = (id) => {
      const t = field(graph.get(BigInt(id)), "Track");
      const x = isRef(t) ? graph.get(t.$ref) : null;
      const title = x ? field(x, "Title") : undefined;
      return typeof title === "string" ? title : null;
    };
    try {
      if (!c.count) return { count: 0, items: [] };
      const r = await g.call(qid, SIG.playlistItemsRetainPage, pageArg(0));
      if (!r.success) return { error: `Your server refused its items' page ("${r.status}").` };
      held = true;
      const want = Math.min(c.count, PAGE);
      const whole = await waitFor(timeoutMs, () => (order.length >= want && order.slice(0, want).every((id) => titleOf(id) !== null) ? true : undefined));
      if (!whole) return { error: `${order.filter((id) => titleOf(id) !== null).length} of its ${want} items arrived named.` };
      const items = order.slice(0, want).map((id) => {
        const ix = field(graph.get(BigInt(id)), "Index");
        return { oid: id, title: /** @type {string} */ (titleOf(id)), index: typeof ix === "number" ? ix : typeof ix === "bigint" ? Number(ix) : null };
      });
      return { count: c.count, items };
    } finally {
      graph.onObject = before;
    }
  } finally {
    if (held) g.callNoReply(qid, SIG.playlistItemsReleasePage, pageArg(0));
    g.callNoReply(qid, SIG.playlistItemsDispose, Buffer.alloc(0));
  }
}

/**
 * @param {{ link: { session(): any } | null, inTurn: <T>(fn: () => Promise<T>) => Promise<T>, off: () => string | null,
 *           profile: () => string | null, albums: () => Array<{ title: string, artist: string }> | null,
 *           playlists: { create(name: string): Promise<any>, addAlbums(id: string, albums: Array<{ title: string, subtitle: string }>): Promise<any>,
 *             remove(id: string): Promise<any>, read(s: any): Promise<any>, list(): Promise<any> },
 *           log?: (line: string) => void, timeoutMs?: number, settleMs?: number, sleep?: (ms: number) => Promise<void>,
 *           items?: typeof itemsNow }} deps
 *   items: stands in for the items' read in tests
 */
function createPlaylistEditProbe(deps) {
  const log = deps.log || (() => {});
  const timeoutMs = deps.timeoutMs || 15000;
  const settleMs = deps.settleMs ?? 2000;
  const sleep = deps.sleep || ((ms) => new Promise((r) => { setTimeout(r, ms); }));
  const read = deps.items || itemsNow;
  let busy = false;

  /** Its items, read until `done` holds of them (a change lands a moment after its answer, the review), or the last read. */
  async function readUntil(/** @type {any} */ s, /** @type {Buffer} */ pid, /** @type {bigint} */ oid, /** @type {(r: any) => boolean} */ done) {
    /** @type {any} */
    let got = null;
    for (let i = 0; i < 5; i++) {
      got = await read(s, pid, oid, timeoutMs);
      if (!("error" in got) && done(got)) return got;
      await sleep(settleMs / 2);
    }
    return got;
  }
  const titles = (/** @type {any} */ r) => ("items" in r ? r.items.map((/** @type {any} */ i) => i.title) : null);
  const oids = (/** @type {any} */ r) => ("items" in r ? r.items.map((/** @type {any} */ i) => i.oid) : null);
  /** A new playlist listed by your server before anything is added to it (a Create answers before the playlist is read back, the review). */
  async function listed(/** @type {string} */ id) {
    for (let i = 0; i < 10; i++) {
      const l = await deps.playlists.list();
      if (l && Array.isArray(l.playlists) && l.playlists.some((/** @type {any} */ p) => p.id === id)) return true;
      await sleep(settleMs / 2);
    }
    return false;
  }

  /**
   * The two new calls, on the trial playlist, in the connection's turn.
   * @param {string} id @param {any[]} steps @param {any} out @returns {Promise<{ ok?: true, error?: string, answer?: any }>}
   */
  async function tryIt(id, steps, out) {
    const s = deps.link ? deps.link.session() : null;
    if (!s) return { error: "Native mode isn't connected to your server right now." };
    const r = await deps.playlists.read(s);
    if (!r || !r.list) return { error: "Your server's playlists weren't read.", answer: r };
    const pl = r.list.find((/** @type {any} */ p) => p.id === id);
    if (!pl) return { error: "The trial playlist isn't listed by your server." };
    const pid = /** @type {Buffer} */ (profileFor({ profiles: s.root.profiles || [], profileId: s.root.profileId }, deps.profile()));
    const before = await readUntil(s, pid, pl.oid, (g) => g.count >= 3);
    steps.push({ step: "read (proven)", count: before.count, order: titles(before), items: before.items, error: before.error });
    if (!("items" in before) || before.items.length < 3) return { error: "Fewer than three items to try with." };
    const [first, , third] = before.items;
    // MoveItems: the third to before the first. Asked of: the items themselves, by their ids; their titles as well, in
    // case Roon makes new item objects for a moved one.
    const wantIds = [third.oid].concat(before.items.filter((/** @type {any} */ i) => i !== third).map((/** @type {any} */ i) => i.oid));
    const wantTitles = [third.title].concat(before.items.filter((/** @type {any} */ i) => i !== third).map((/** @type {any} */ i) => i.title));
    const same = (/** @type {any} */ g) => JSON.stringify(oids(g)) === JSON.stringify(wantIds) || JSON.stringify(titles(g)) === JSON.stringify(wantTitles);
    const mv = await s.g.call(r.svc.oid, SIG.moveItems, playlistArgs.moveItems(pl.oid, [BigInt(third.oid)], "before", BigInt(first.oid)));
    await sleep(settleMs);
    const moved = mv.success ? await readUntil(s, pid, pl.oid, same) : await read(s, pid, pl.oid, timeoutMs);
    const movedOk = "items" in moved && same(moved);
    steps.push({ step: "MoveItems (new): the third before the first", answer: { success: mv.success, status: String(mv.status) },
      order: titles(moved), expected: wantTitles, sameIds: "items" in moved && JSON.stringify(oids(moved)) === JSON.stringify(wantIds), error: moved.error });
    out.move = movedOk ? "moved as asked" : mv.success ? "answered Success, but the order read back is not the one asked" : "refused";
    // RemoveItems: the first as made. No answer comes; what it did is read back, until it shows or five reads have passed.
    s.g.callNoReply(r.svc.oid, SIG.removeItems, playlistArgs.removeItems(pl.oid, [BigInt(first.oid)]));
    await sleep(settleMs);
    const goneFrom = (/** @type {any} */ g) => "items" in g && g.count === before.count - 1 && !g.items.some((/** @type {any} */ i) => i.oid === first.oid);
    const removed = await readUntil(s, pid, pl.oid, goneFrom);
    steps.push({ step: "RemoveItems (new): the first as made, no answer", count: removed.count, order: titles(removed), error: removed.error });
    out.remove = goneFrom(removed) ? "removed" : "not removed (the count read back is unchanged, or the item is still there)";
    return { ok: true };
  }

  return {
    /** @returns {Promise<any>} each step, or { error, status } when nothing could be tried */
    async run() {
      const why = deps.off();
      if (why) return { error: why, status: 409 };
      if (busy) return { error: "A probe is already running.", status: 409 };
      const lib = deps.albums() || [];
      // Two albums, so the trial playlist has at least three tracks to move and remove.
      const picks = lib.slice(0, 2).map((a) => ({ title: a.title, subtitle: a.artist }));
      if (picks.length < 2) return { error: "Your library hasn't been read on this connection yet.", status: 503 };
      busy = true;
      const name = `${NAME} ${new Date().toISOString().slice(11, 19)}`;
      /** @type {any[]} */
      const steps = [];
      const out = { design: "dev/design/playlist-edit.md §3", name, steps, move: "not tried", remove: "not tried", deleted: "not made" };
      try {
        const made = await deps.playlists.create(name);
        steps.push({ step: "create (proven)", answer: made });
        if (!made || !made.id) return out;
        try {
          if (!(await listed(made.id))) { steps.push({ step: "listed", error: "Your server didn't list the new playlist." }); return out; }
          steps.push({ step: "add two albums (proven)", albums: picks, answer: await deps.playlists.addAlbums(made.id, picks) });
          const trial = await deps.inTurn(() => tryIt(made.id, steps, out));
          if (trial.error) steps.push({ step: "trial", error: trial.error, answer: trial.answer });
        } catch (e) {
          // A call never answered, or refused by throwing: said with the steps so far, the delete still made below.
          steps.push({ step: "trial", error: String((e && /** @type {any} */ (e).message) || e) });
        } finally {
          // The trial playlist goes, whatever happened above; if it can't, the answer names it, for deleting in Roon.
          let del;
          try { del = await deps.playlists.remove(made.id); } catch (e) { del = { error: String((e && /** @type {any} */ (e).message) || e) }; }
          steps.push({ step: "delete (proven)", answer: del });
          out.deleted = del && del.ok ? "deleted" : `NOT deleted: delete "${name}" in Roon (${(del && (del.notSent || del.error)) || "no answer"})`;
        }
        log(`playlist edit probe: move ${out.move}; remove ${out.remove}; ${out.deleted}`);
        return out;
      } finally {
        busy = false;
      }
    },
  };
}

module.exports = { createPlaylistEditProbe, itemsNow, NAME };
