"use strict";
// ---------------------------------------------------------------------------
// Rouen's Dynamic Playlists' routes (lib/routes/smart-playlists.js, moved out of
// index.js in v1.9.61) and their move onto Roon (native-remote.md §12.16): a
// playlist moved leaves Rouen's list, kept with Roon's PlaylistId in one write;
// a save asks for the move again; the status route says how it stands. The move
// itself is a stand-in: its own test runs it against the fake server.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountSmartPlaylists } = require("../../lib/routes/smart-playlists");
const { mountSmartRoon } = require("../../lib/routes/smart-roon");

const FOLK = { id: "sp_folk", name: "Folk", view: { genre: ["Folk"] }, limit: 100, mode: "albums", order: "album" };
const JAZZ = { id: "sp_jazz", name: "Jazz", view: { genre: ["Jazz"] }, limit: 100, mode: "albums", order: "album" };

function rig(o = {}) {
  const store = { smartPlaylists: [FOLK, JAZZ].map((p) => Object.assign({}, p)) };
  const writes = [];
  const asked = [];
  let pending = null;
  const move = { changed() { asked.push("changed"); },
    maybe(items, moved, still) { asked.push("maybe"); pending = { items: items(), moved, still }; return { running: true, total: 2 }; },
    progress: () => ({ running: false, total: 2, done: [{ id: "sp_jazz", name: "Jazz", result: "kept", why: "its Channels filter", roonId: null }], error: null }),
    editor: () => o.editor || null };
  const routes = {};
  const app = { get: (p, fn) => { routes["GET " + p] = fn; }, post: (p, fn) => { routes["POST " + p] = fn; } };
  const settings = { load: () => store, save: (patch) => { writes.push(Object.keys(patch).sort()); Object.assign(store, patch); return true; } };
  const m = mountSmartPlaylists(app, { load: () => store.smartPlaylists, save: (list) => settings.save({ smartPlaylists: list }),
    record: (p) => Object.assign({ limit: 100, mode: "albums", order: "album" }, p), nameMax: 60, max: 50, indexBuilt: () => true,
    view: () => [{ image_key: "a" }, { image_key: "b" }], unavailable: () => null, settings, move: () => (o.off ? null : move), timers: false,
    log: () => {} });
  const call = async (key, body, query = {}) => {
    const res = { code: 200, body: null, set() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes[key]({ body, query }, res);
    return res;
  };
  return { m, call, store, writes, asked, pending: () => pending, routes, app };
}

test("THE one for §12.16's store: a moved playlist leaves Rouen's list and is kept with Roon's id, in one write; the tile marked moved", async () => {
  const w = rig();
  const list = await w.call("GET /api/smart-playlists");
  assert.deepEqual(list.body.playlists.map((p) => [p.name, p.album_total]), [["Folk", 2], ["Jazz", 2]]);
  assert.deepEqual(w.asked, ["maybe"], "opening the screen didn't ask for the move");
  assert.deepEqual(w.pending().items.map((x) => [x.sp.id, x.matched, x.unavailable]), [["sp_folk", 2, null], ["sp_jazz", 2, null]]);
  w.writes.length = 0;
  w.pending().moved(FOLK, "abc123", "moved");
  assert.deepEqual(w.writes, [["roonSmartMoved", "smartPlaylists"]], "not one write");
  assert.deepEqual(w.store.smartPlaylists.map((p) => p.id), ["sp_jazz"]);
  assert.deepEqual(w.store.roonSmartMoved.map((x) => [x.roonId, x.name, x.how, x.rouen.id]), [["abc123", "Folk", "moved", "sp_folk"]]);
  assert.deepEqual([...w.m.movedIds()], ["abc123"]);
  // Found again (a restore brought Rouen's copy back): one record, not two.
  w.pending().moved(FOLK, "abc123", "already");
  assert.equal(w.store.roonSmartMoved.length, 1);
  // Roon's list marks it.
  const roon = {};
  mountSmartRoon({ get: (p, fn) => { roon[p] = fn; }, post() {} }, { smart: () => ({ list: async () => ({ playlists: [{ id: "abc123", name: "Folk" }, { id: "ff", name: "r&b" }] }) }),
    moved: w.m.movedIds });
  const res = { body: null, json(b) { this.body = b; return this; }, set() {}, status() { return this; } };
  await roon["/api/roon-smart"]({ query: {} }, res);
  assert.deepEqual(res.body.playlists.map((p) => [p.name, p.moved]), [["Folk", true], ["r&b", false]]);
});

test("§12.16: a save asks for the move again at once; the status route says how it stands; native mode not running: said", async () => {
  const w = rig();
  const saved = await w.call("POST /api/smart-playlists", { name: "Blues", view: { genre: ["Blues"] } });
  assert.equal(saved.body.ok, true);
  assert.deepEqual(w.asked, ["changed", "maybe"]);
  const st = await w.call("GET /api/roon-smart/move");
  assert.deepEqual([st.body.available, st.body.rouen, st.body.inRoon, st.body.done[0].why], [true, 3, 0, "its Channels filter"]);
  assert.deepEqual((await rig({ off: true }).call("GET /api/roon-smart/move")).body, { available: false });
});

test("the review: a playlist moved meanwhile isn't saved again as a second copy; one edited meanwhile isn't moved as it was", async () => {
  const w = rig();
  await w.call("GET /api/smart-playlists");
  const { moved } = w.pending();
  moved(FOLK, "abc123", "moved");
  const again = await w.call("POST /api/smart-playlists", { id: "sp_folk", name: "Folk", view: { genre: ["Folk", "Blues"] } });
  assert.equal(again.code, 409);
  assert.match(again.body.error, /now one of your server's smart playlists/);
  assert.deepEqual(w.store.smartPlaylists.map((p) => p.id), ["sp_jazz"], "saved as a second copy");
  // Edited since the move began: the move's check says it isn't as it was.
  const w2 = rig();
  await w2.call("GET /api/smart-playlists");
  const sp = w2.pending().items[1].sp;
  assert.equal(w2.pending().still(sp), true);
  w2.store.smartPlaylists[1] = Object.assign({}, sp, { view: { genre: ["Bebop"] } });
  assert.equal(w2.pending().still(sp), false);
});

test("§12.18: one of Roon's smart playlists saved from the editor goes to Roon, never as a Rouen copy; a moved one's record follows it", async () => {
  const saves = [];
  const editor = {
    editable: async (id) => (id === "abc123" ? { target: { id: "roon:abc123", name: "Folk", view: { genre: ["Folk"] }, roon: true } }
      : id === "ff" ? { why: "Rouen's editor can't show this smart playlist whole: its RequireIsFavorite filter.", kind: "refused" } : { notSent: "Native mode is off." }),
    save: async (id, name, view) => { saves.push([id, name, view]); return name === "Bad" ? { saved: false, why: "Roon's smart playlists can't hold its Channels filter.", kind: "refused" }
      : name === "Lost" ? { saved: "unknown", why: "Your server took it." } : { saved: true, name }; },
  };
  const w = rig({ editor });
  await w.call("GET /api/smart-playlists");
  w.pending().moved(FOLK, "abc123", "moved");
  const target = await w.call("GET /api/roon-smart/edit", undefined, { id: "abc123" });
  assert.deepEqual(target.body.target.id, "roon:abc123");
  // The editor's target id carries the stamp of what it was given; the record is found by its PlaylistId alone.
  const refused = await w.call("GET /api/roon-smart/edit", undefined, { id: "ff" });
  assert.deepEqual([refused.code, refused.body.error], [409, "Rouen's editor can't show this smart playlist whole: its RequireIsFavorite filter."]);
  assert.equal((await w.call("GET /api/roon-smart/edit", undefined, { id: "00" })).code, 503);
  const list = w.store.smartPlaylists.map((p) => p.id);
  const ok = await w.call("POST /api/smart-playlists", { id: "roon:abc123.0123456789ab", name: "Folk and Blues", view: { genre: ["Folk", "Blues"] }, limit: 100 });
  assert.deepEqual(ok.body, { ok: true, inRoon: true, name: "Folk and Blues" });
  assert.deepEqual(saves[0], ["abc123.0123456789ab", "Folk and Blues", { genre: ["Folk", "Blues"] }]);
  assert.deepEqual(w.store.smartPlaylists.map((p) => p.id), list, "saved as a Rouen copy");
  assert.deepEqual([w.store.roonSmartMoved[0].name, w.store.roonSmartMoved[0].rouen.name, w.store.roonSmartMoved[0].rouen.view],
    ["Folk and Blues", "Folk and Blues", { genre: ["Folk", "Blues"] }], "its record of the move not kept up");
  const bad = await w.call("POST /api/smart-playlists", { id: "roon:abc123", name: "Bad", view: {} });
  assert.deepEqual([bad.code, bad.body.error], [422, "Roon's smart playlists can't hold its Channels filter."]);
  assert.equal((await w.call("POST /api/smart-playlists", { id: "roon:abc123", name: "Lost", view: {} })).code, 502);
  assert.equal((await rig().call("POST /api/smart-playlists", { id: "roon:abc123", name: "Folk", view: {} })).code, 503, "no editor, and not said");
});
