"use strict";
// ---------------------------------------------------------------------------
// Rouen's own playlists' plain routes (lib/routes/user-playlists.js), moved out of index.js unchanged in v1.9.63:
// list, one, create or rename, delete — each save told, the list read anew each time (a restore replaces it whole).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountUserPlaylists } = require("../../lib/routes/user-playlists");

function rig(max = 3) {
  const routes = {};
  const app = { get: (p, h) => { routes["GET " + p] = h; }, post: (p, h) => { routes["POST " + p] = h; } };
  const w = { list: [{ id: "up_1", name: "Morning", tracks: [{ title: "A" }, { title: "B" }] }], saves: 0, ids: 0 };
  mountUserPlaylists(app, { list: () => w.list, save: () => { w.saves++; }, summary: (p) => ({ id: p.id, name: p.name, n: p.tracks.length }),
    text: (v, n) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null), nameMax: () => 10, max: () => max,
    newId: () => "up_new" + (++w.ids) });
  w.call = async (k, req = {}) => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes[k](Object.assign({ query: {}, body: {} }, req), res);
    return res;
  };
  return w;
}

test("list and one: the summaries; one with its tracks; an unknown id is 404", async () => {
  const w = rig();
  assert.deepEqual((await w.call("GET /api/user-playlists")).body, { playlists: [{ id: "up_1", name: "Morning", n: 2 }] });
  assert.deepEqual((await w.call("GET /api/user-playlist", { query: { id: " up_1 " } })).body,
    { id: "up_1", name: "Morning", tracks: [{ title: "A" }, { title: "B" }], track_total: 2 });
  assert.equal((await w.call("GET /api/user-playlist", { query: { id: "nope" } })).code, 404);
});

test("create, rename, delete: each saved; a name required, the limit kept, an unknown id 404", async () => {
  const w = rig(2);
  assert.equal((await w.call("POST /api/user-playlists", { body: { name: "  " } })).code, 400);
  const made = await w.call("POST /api/user-playlists", { body: { name: "Evening playlist, long" } });
  assert.deepEqual(made.body.playlists.map((p) => p.name), ["Morning", "Evening pl"], "the name not cut to its limit");
  assert.equal(w.list[1].id, "up_new1");
  assert.match((await w.call("POST /api/user-playlists", { body: { name: "Third" } })).body.error, /^That's 2 playlists/);
  assert.equal((await w.call("POST /api/user-playlists", { body: { id: "up_1", name: "Dawn" } })).body.playlists[0].name, "Dawn");
  assert.equal((await w.call("POST /api/user-playlists", { body: { id: "nope", name: "X" } })).code, 404);
  assert.deepEqual((await w.call("POST /api/user-playlists/delete", { body: { id: "up_1" } })).body.playlists.map((p) => p.id), ["up_new1"]);
  assert.equal((await w.call("POST /api/user-playlists/delete", { body: { id: "up_1" } })).code, 404);
  assert.equal(w.saves, 3, "a change not saved, or a refusal saved");
});

test("the list is read anew on each request: one replaced whole (a restore, a copy to Roon) is the one answered", async () => {
  const w = rig();
  w.list = [];
  assert.deepEqual((await w.call("GET /api/user-playlists")).body, { playlists: [] });
  await w.call("POST /api/user-playlists", { body: { name: "New" } });
  assert.deepEqual(w.list.map((p) => p.name), ["New"], "the create went to the list as it was at mount");
});
