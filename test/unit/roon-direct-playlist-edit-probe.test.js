"use strict";
// ---------------------------------------------------------------------------
// 2.0.4-t12 (lib/roon-direct/playlist-edit-probe.js, dev/design/playlist-edit.md §3): a playlist's items moved
// (Playlists::MoveItems) and removed (Playlists::RemoveItems), tried once by hand on a playlist the probe makes and
// deletes. The server here is a stand-in that does what it is asked (or, for the review's cases, does not); it is not
// evidence of what Roon does — the owner's run is.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPlaylistEditProbe } = require("../../lib/roon-direct/playlist-edit-probe");
const { SIG, ALLOWED, playlistArgs } = require("../../lib/roon-direct/methods");

/** @param {{ ignoreMove?: boolean, refuseMove?: boolean, ignoreRemove?: boolean, fewItems?: boolean, noSession?: boolean, unlisted?: boolean, throwMove?: boolean, deleteRefused?: boolean }} [o] */
function rig(o = {}) {
  let items = (o.fewItems ? ["A1", "A2"] : ["A1", "A2", "B1", "B2"]).map((title, i) => ({ oid: String(100 + i), title, index: i }));
  const sent = [], log = [];
  const playlists = {
    made: /** @type {string[]} */ ([]), removed: /** @type {string[]} */ ([]), added: /** @type {any[]} */ ([]),
    async create(name) { this.made.push(name); return { id: "ab12", name }; },
    async addAlbums(id, albums) { this.added.push(albums); return { sent: 2, missing: [], failed: [], why: null }; },
    async remove(id) { this.removed.push(id); return o.deleteRefused ? { notSent: "Your server's connection is being checked." } : { ok: true, name: "trial" }; },
    async list() { return { playlists: o.unlisted ? [] : [{ id: "ab12", name: "trial" }] }; },
    async read() { return { svc: { oid: 9n }, list: [{ id: "ab12", oid: 50n, name: "trial" }] }; },
  };
  const s = { root: { profiles: [], profileId: Buffer.alloc(16) }, g: {
    call: async (oid, sig, args) => {
      sent.push({ oid, sig, args: args.toString("hex") });
      if (sig === SIG.moveItems) {
        if (o.throwMove) throw new Error("Your server didn't answer MoveItems in time.");
        if (o.refuseMove) return { success: false, status: "InvalidArguments" };
        if (!o.ignoreMove) { const [, , third] = items; items = [third].concat(items.filter((i) => i !== third)); }
      }
      return { success: true, status: "Success" };
    },
    callNoReply: (oid, sig, args) => {
      sent.push({ oid, sig, args: args.toString("hex"), noReply: true });
      if (sig === SIG.removeItems && !o.ignoreRemove) items = items.filter((i) => i.oid !== "100");
    },
  } };
  const probe = createPlaylistEditProbe({ link: { session: () => (o.noSession ? null : s) }, inTurn: (fn) => fn(), off: () => null, profile: () => null,
    albums: () => [{ title: "First", artist: "Ay" }, { title: "Second", artist: "Bee" }], playlists, log: (l) => log.push(l),
    settleMs: 0, sleep: async () => {}, items: async () => ({ count: items.length, items: items.slice() }) });
  return { probe, sent, playlists, log };
}

test("THE trial: the third moved before the first, the first removed, the playlist deleted after", async () => {
  const { probe, sent, playlists } = rig();
  const out = await probe.run();
  assert.equal(out.move, "moved as asked");
  assert.equal(out.remove, "removed");
  assert.match(playlists.made[0], /^Rouen edit trial \d\d:\d\d:\d\d$/);
  assert.deepEqual(playlists.added[0], [{ title: "First", subtitle: "Ay" }, { title: "Second", subtitle: "Bee" }]);
  assert.deepEqual(playlists.removed, ["ab12"], "the trial playlist deleted");
  const mv = sent.find((x) => x.sig === SIG.moveItems), rm = sent.find((x) => x.sig === SIG.removeItems);
  assert.equal(mv.oid, 9n, "on the Playlists object");
  assert.equal(mv.args, playlistArgs.moveItems(50n, [102n], "before", 100n).toString("hex"), "the third (102) before the first (100)");
  assert.equal(mv.args, "3202016603" + "64", "playlist 50, one item 102, Before (3), relative to 100");
  assert.equal(rm.noReply, true, "RemoveItems takes no callback: sent without waiting for one");
  assert.equal(rm.args, "32020164", "playlist 50, one item: the first as made (100)");
  const order = out.steps.find((x) => /MoveItems/.test(x.step)).order;
  assert.deepEqual(order, ["B1", "A1", "A2", "B2"]);
  assert.equal(out.deleted, "deleted");
});

test("the review: a Success that moved nothing, a refusal, and a removal that didn't happen are each said so", async () => {
  assert.equal((await rig({ ignoreMove: true }).probe.run()).move, "answered Success, but the order read back is not the one asked");
  assert.equal((await rig({ refuseMove: true }).probe.run()).move, "refused");
  assert.match((await rig({ ignoreRemove: true }).probe.run()).remove, /^not removed/);
});

test("the trial playlist is deleted whatever happens: too few items, no connection, never listed, a call that threw", async () => {
  for (const o of [{ fewItems: true }, { noSession: true }, { unlisted: true }]) {
    const { probe, playlists, sent } = rig(o);
    const out = await probe.run();
    assert.deepEqual(playlists.removed, ["ab12"], JSON.stringify(o));
    assert.equal(out.move, "not tried");
    assert.ok(!sent.some((x) => x.sig === SIG.moveItems || x.sig === SIG.removeItems), "nothing new sent");
    assert.equal(out.deleted, "deleted");
  }
  {
    const { probe, playlists } = rig({ unlisted: true });
    const out = await probe.run();
    assert.equal(playlists.added.length, 0, "nothing added to a playlist not yet listed");
    assert.ok(out.steps.some((x) => x.step === "listed" && x.error));
  }
  const thrown = rig({ throwMove: true });
  const out = await thrown.probe.run();
  assert.deepEqual(thrown.playlists.removed, ["ab12"], "deleted after a call threw");
  assert.ok(out.steps.some((x) => x.step === "trial" && /in time/.test(x.error)), "the steps so far, and why");
});

test("the review: a delete that couldn't be made names the playlist, for deleting in Roon", async () => {
  const out = await rig({ deleteRefused: true }).probe.run();
  assert.match(out.deleted, /^NOT deleted: delete "Rouen edit trial \d\d:\d\d:\d\d" in Roon \(Your server's connection is being checked\.\)$/);
});

test("the two methods are on the allowlist, as the catalogue spells them", () => {
  assert.ok(ALLOWED.has(SIG.moveItems) && ALLOWED.has(SIG.removeItems));
  assert.match(SIG.moveItems, /^Sooloos\.Broker\.Api\.Playlists::MoveItems\(Sooloos\.Broker\.Api\.Playlist, System\.Collections\.Generic\.IEnumerable<Sooloos\.Broker\.Api\.PlaylistItem>, Sooloos\.Broker\.Api\.InsertionPoint, Sooloos\.Broker\.Api\.PlaylistItem, Base\.ResultCallback\)$/);
  assert.equal(SIG.removeItems, "Sooloos.Broker.Api.Playlists::RemoveItems(Sooloos.Broker.Api.Playlist, System.Collections.Generic.IEnumerable<Sooloos.Broker.Api.PlaylistItem>)");
});
