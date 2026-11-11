"use strict";
// ---------------------------------------------------------------------------
// 2.0.4-t13 (lib/roon-direct/playlist-edit.js, lib/routes/roon-playlist-edit.js; dev/design/playlist-edit.md §4.2): a
// Roon playlist's tracks moved and removed from its page. The owner, 2026-11-10: "I don't see a way to reorder tracks
// or delete tracks from playlists". Rows named by place and title; the item's id found on its page; nothing sent when
// the title isn't the one named; believed when the read-back shows it. The server here is a stand-in.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPlaylistEdit, NOT_TAKEN, STALE, UNSEEN } = require("../../lib/roon-direct/playlist-edit");
const { mountRoonPlaylistEdit } = require("../../lib/routes/roon-playlist-edit");
const { SIG, playlistArgs } = require("../../lib/roon-direct/methods");

/**
 * @param {{ n?: number, ignore?: boolean, refuse?: boolean, newIds?: boolean, editable?: any, full?: boolean, swapSession?: boolean,
 *           failReads?: number }} [o]  failReads: read-backs that fail (a query not answered in time) once a change is sent
 */
function rig(o = {}) {
  let items = Array.from({ length: o.n || 6 }, (_, i) => ({ oid: String(1000 + i), title: "Song " + (i + 1) }));
  const sent = [], log = [], pagesRead = [];
  const s = { root: { profiles: [], profileId: Buffer.alloc(16, 1) }, graph: { maxObjects: 400000, objects: { size: o.full ? 390000 : 1000 } }, g: {
    call: async (oid, sig, args) => {
      sent.push({ oid, sig, args: args.toString("hex") });
      if (sig === SIG.moveItems && o.refuse) return { success: false, status: "InvalidArguments" };
      return { success: true, status: "Success" };
    },
    callNoReply: (oid, sig, args) => { sent.push({ oid, sig, args: args.toString("hex"), noReply: true }); },
  } };
  const link = { now: s, session() { return this.now; } };
  /** What the stand-in server does with a move or a remove, as Roon did on the owner's server (§3.1), by the ids named. */
  const apply = { move: (from, where, rel) => {
    const it = items.find((x) => x.oid === from), r = items.find((x) => x.oid === rel);
    const rest = items.filter((x) => x !== it);
    const at = rest.indexOf(r) + (where === "after" ? 1 : 0);
    rest.splice(at, 0, o.newIds ? { oid: "9" + it.oid, title: it.title } : it);
    items = rest;
  }, remove: (id) => { items = items.filter((x) => x.oid !== id); } };
  const edit = createPlaylistEdit({
    link, inTurn: (fn) => fn(), profile: () => null, log: (l) => log.push(l), settleMs: 0, sleep: async () => { if (o.swapSession) link.now = { other: true }; },
    playlists: { editable: async (id) => o.editable || { s, svc: { oid: 9n }, pl: { oid: 50n, id, name: "Mix" } } },
    page: async (sess, q, oid) => {
      pagesRead.push(q.page);
      if (rig.last && o.failReads) { o.failReads--; return { query: true, error: "Its items query wasn't answered in time." }; }
      assert.equal(oid, 50n, "the playlist's own items");
      assert.ok(Buffer.isBuffer(q.pid), "a profile's id");
      return { count: items.length, countSent: true, complete: true, arrived: items.length,
        items: items.slice(q.page * 100, q.page * 100 + 100).map((x) => ({ title: x.title, album: null, artist: null })),
        ids: items.slice(q.page * 100, q.page * 100 + 100).map((x) => x.oid), pushed: {} };
    },
  });
  // The stand-in applies what was sent the moment it is sent: wrap call and callNoReply.
  const call = s.g.call, noReply = s.g.callNoReply;
  s.g.call = async (oid, sig, args) => {
    const r = await call(oid, sig, args);
    if (sig === SIG.moveItems && r.success && !o.ignore) apply.move(rig.last.from, rig.last.where, rig.last.rel);
    return r;
  };
  s.g.callNoReply = (oid, sig, args) => { noReply(oid, sig, args); if (sig === SIG.removeItems && !o.ignore) apply.remove(rig.last.id); };
  return { edit, sent, log, pagesRead, items: () => items.map((x) => x.title) };
}
// The frames are checked against playlistArgs byte for byte below; the stand-in learns what they name from this spy.
const realMove = playlistArgs.moveItems, realRemove = playlistArgs.removeItems;
playlistArgs.moveItems = (pl, ids, where, rel) => { rig.last = { from: String(ids[0]), where, rel: String(rel) }; return realMove(pl, ids, where, rel); };
playlistArgs.removeItems = (pl, ids) => { rig.last = { id: String(ids[0]) }; return realRemove(pl, ids); };

test("THE one: a track moved down goes after the one at its new place, up goes before it; believed by its id", async () => {
  const r = rig();
  assert.deepEqual(await r.edit.move({ id: "ab12", from: 1, fromTitle: "Song 2", to: 4, toTitle: "Song 5" }), { ok: true });
  assert.deepEqual(r.items(), ["Song 1", "Song 3", "Song 4", "Song 5", "Song 2", "Song 6"]);
  const mv = r.sent.find((x) => x.sig === SIG.moveItems);
  assert.equal(mv.oid, 9n, "on the Playlists object");
  assert.equal(mv.args, realMove(50n, [1001n], "after", 1004n).toString("hex"), "Song 2 (1001) after Song 5 (1004)");
  assert.deepEqual(await r.edit.move({ id: "ab12", from: 4, fromTitle: "Song 2", to: 0, toTitle: "Song 1" }), { ok: true });
  assert.deepEqual(r.items(), ["Song 2", "Song 1", "Song 3", "Song 4", "Song 5", "Song 6"]);
  assert.equal(r.sent.filter((x) => x.sig === SIG.moveItems)[1].args, realMove(50n, [1001n], "before", 1000n).toString("hex"));
});

test("a track removed: RemoveItems with no answer awaited, believed when the count is one less and it is gone", async () => {
  const r = rig();
  assert.deepEqual(await r.edit.remove({ id: "ab12", at: 5, title: "Song 6" }), { ok: true }, "the last one");
  assert.deepEqual(await r.edit.remove({ id: "ab12", at: 0, title: "Song 1" }), { ok: true }, "the first one");
  assert.deepEqual(r.items(), ["Song 2", "Song 3", "Song 4", "Song 5"]);
  const rm = r.sent.filter((x) => x.sig === SIG.removeItems);
  assert.equal(rm.length, 2);
  assert.ok(rm.every((x) => x.noReply), "sent without waiting for an answer");
  assert.equal(rm[1].args, realRemove(50n, [1000n]).toString("hex"));
});

test("the stale check: a title not the one at that place, or a place past the end, sends nothing", async () => {
  const r = rig();
  for (const out of [await r.edit.move({ id: "ab12", from: 1, fromTitle: "Song 3", to: 4, toTitle: "Song 5" }),
    await r.edit.move({ id: "ab12", from: 1, fromTitle: "Song 2", to: 4, toTitle: "Something else" }),
    await r.edit.remove({ id: "ab12", at: 6, title: "Song 7" })]) {
    assert.deepEqual(out, { ok: false, error: STALE, status: 409, stale: true });
  }
  assert.equal(r.sent.length, 0, "nothing sent");
  // Titles as compared: case and punctuation aside, as playlist-artists.js compares them.
  assert.deepEqual(await r.edit.remove({ id: "ab12", at: 2, title: "song  3!" }), { ok: true });
});

test("the review: the page's rows one for one with the playlist, or stale (an item the official list leaves out shifts every place)", async () => {
  const r = rig();
  assert.deepEqual(await r.edit.remove({ id: "ab12", at: 2, title: "Song 3", count: 7 }), { ok: false, error: STALE, status: 409, stale: true });
  assert.equal(r.sent.length, 0);
  assert.deepEqual(await r.edit.remove({ id: "ab12", at: 2, title: "Song 3", count: 6 }), { ok: true });
});

test("the review: a read-back that fails is one of the five, not the end; all five failing is said as not known", async () => {
  rig.last = null;
  const once = rig({ failReads: 2 });
  assert.deepEqual(await once.edit.move({ id: "ab12", from: 0, fromTitle: "Song 1", to: 2, toTitle: "Song 3" }), { ok: true });
  rig.last = null;
  const never = rig({ failReads: 5 });
  assert.deepEqual(await never.edit.remove({ id: "ab12", at: 0, title: "Song 1" }), { ok: false, error: UNSEEN, status: 502 });
});

test("the review: both places on one page are read once", async () => {
  rig.last = null;
  const r = rig();
  assert.deepEqual(await r.edit.move({ id: "ab12", from: 4, fromTitle: "Song 5", to: 1, toTitle: "Song 2" }), { ok: true });
  assert.deepEqual(r.pagesRead, [0, 0], "one read to find both, one to see it moved");
});

test("a long playlist: each place read on its own page (100 a page)", async () => {
  const r = rig({ n: 250 });
  assert.deepEqual(await r.edit.move({ id: "ab12", from: 230, fromTitle: "Song 231", to: 10, toTitle: "Song 11" }), { ok: true });
  assert.deepEqual(r.items().slice(9, 12), ["Song 10", "Song 231", "Song 11"]);
  assert.deepEqual(r.pagesRead.slice(0, 3), [2, 0, 0], "the page of 230, the page of 10, then the read-back of 10");
});

test("the review: a Success that moved nothing, a refusal, an id Roon changed, a remove not made: none is believed", async () => {
  assert.deepEqual(await rig({ ignore: true }).edit.move({ id: "ab12", from: 0, fromTitle: "Song 1", to: 2, toTitle: "Song 3" }),
    { ok: false, error: NOT_TAKEN, status: 502 });
  assert.deepEqual(await rig({ refuse: true }).edit.move({ id: "ab12", from: 0, fromTitle: "Song 1", to: 2, toTitle: "Song 3" }),
    { ok: false, error: 'Your server refused the move ("InvalidArguments").', status: 502 });
  // Believed by the id the run showed kept (§3.1), not by a title two tracks can share.
  assert.equal((await rig({ newIds: true }).edit.move({ id: "ab12", from: 0, fromTitle: "Song 1", to: 2, toTitle: "Song 3" })).error, NOT_TAKEN);
  assert.deepEqual(await rig({ ignore: true }).edit.remove({ id: "ab12", at: 1, title: "Song 2" }), { ok: false, error: NOT_TAKEN, status: 502 });
});

test("why not, said: native mode can't act, no room, the connection changed before the read-back", async () => {
  const off = await rig({ editable: { notSent: "" } }).edit.remove({ id: "ab12", at: 0, title: "Song 1" });
  assert.deepEqual(off, { ok: false, error: "Native mode is off.", status: 503 });
  const ro = await rig({ editable: { notSent: "That playlist can't be changed (it isn't yours to edit in Roon)." } }).edit.remove({ id: "ab12", at: 0, title: "Song 1" });
  assert.equal(ro.status, 503);
  const full = rig({ full: true });
  assert.equal((await full.edit.remove({ id: "ab12", at: 0, title: "Song 1" })).status, 503);
  assert.equal(full.sent.length, 0);
  const swapped = await rig({ swapSession: true }).edit.remove({ id: "ab12", at: 0, title: "Song 1" });
  assert.match(swapped.error, /connection to your server changed/);
});

test("one change at a time: a second waits for the first, and a change that throws doesn't hold up the next", async () => {
  const r = rig();
  const both = await Promise.all([r.edit.move({ id: "ab12", from: 0, fromTitle: "Song 1", to: 1, toTitle: "Song 2" }),
    r.edit.remove({ id: "ab12", at: 0, title: "Song 2" })]);
  assert.deepEqual(both, [{ ok: true }, { ok: true }], "the remove named the playlist as the move left it");
  assert.deepEqual(r.items(), ["Song 1", "Song 3", "Song 4", "Song 5", "Song 6"]);
  const edit = createPlaylistEdit({ link: { session: () => null }, inTurn: async () => { throw new Error("gone"); }, profile: () => null,
    playlists: { editable: async () => ({ notSent: "x" }) } });
  assert.match((await edit.remove({ id: "ab12", at: 0, title: "Song 1" })).error, /didn't reach your server: gone/);
});

test("the routes: what is sent checked; the answer's status and stale flag passed on", async () => {
  const routes = {};
  const app = { post: (p, fn) => { routes[p] = fn; } };
  const asked = [];
  mountRoonPlaylistEdit(app, {
    move: async (o) => { asked.push(o); return { ok: true }; },
    remove: async (o) => { asked.push(o); return { ok: false, error: STALE, status: 409, stale: true }; },
  });
  const call = async (p, body) => {
    const res = { code: 200, body: null, set() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes[p]({ body }, res);
    return res;
  };
  let res = await call("/api/roon-playlists/move", { id: "ab12", from: 2, from_title: "A", to: 0, to_title: "B" });
  assert.deepEqual([res.code, res.body], [200, { ok: true }]);
  assert.deepEqual(asked[0], { id: "ab12", from: 2, fromTitle: "A", to: 0, toTitle: "B" });
  res = await call("/api/roon-playlists/remove", { id: "ab12", at: 3, title: "C" });
  assert.deepEqual([res.code, res.body], [409, { ok: false, error: STALE, stale: true }]);
  for (const [p, body] of [["/api/roon-playlists/move", { id: "ab12", from: 1, from_title: "A", to: 1, to_title: "A" }],
    ["/api/roon-playlists/move", { id: "ab12", from: -1, from_title: "A", to: 1, to_title: "B" }],
    ["/api/roon-playlists/remove", { id: "AB12", at: 0, title: "A" }],
    ["/api/roon-playlists/remove", { id: "ab12", at: 1.5, title: "A" }],
    ["/api/roon-playlists/remove", { id: "ab12", at: 0 }]]) {
    assert.equal((await call(p, body)).code, 400, JSON.stringify(body));
  }
  assert.equal(asked.length, 2, "nothing bad passed on");
  const none = {};
  mountRoonPlaylistEdit({ post: (p, fn) => { none[p] = fn; } }, null);
  const r2 = { code: 0, set() {}, status(c) { this.code = c; return this; }, json() { return this; } };
  await none["/api/roon-playlists/remove"]({ body: { id: "ab12", at: 0, title: "A" } }, r2);
  assert.equal(r2.code, 503);
});
