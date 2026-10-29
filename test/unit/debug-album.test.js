"use strict";
// /api/debug/album, moved out of index.js in v1.9.72-t5 (lib/routes/debug-album.js) with its behaviour unchanged:
// the album at an offset, opened in one browse session, and the items Roon gave inside it.
const test = require("node:test");
const assert = require("node:assert/strict");
const { mountDebugAlbum } = require("../../lib/routes/debug-album");

function route(deps) {
  let handler = null;
  mountDebugAlbum({ get: (p, h) => { assert.equal(p, "/api/debug/album"); handler = h; } }, deps);
  return (query) => new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    handler({ query }, res);
  });
}

test("no Core, a bad offset, an album not there, and an album's items as Roon gave them", async () => {
  assert.equal((await route({ core: () => null })({ offset: "0" })).code, 503);
  const calls = [];
  const deps = (items) => ({ core: () => ({}), withBrowseSession: (fn) => fn("k1"),
    browse: async (o) => { calls.push(["browse", o]); },
    load: async (o) => (o.count === 1 ? { items } : { list: { title: "Kind of Blue", count: 2 },
      items: [{ title: "So What", subtitle: "Miles Davis", item_key: "a", image_key: "i" }, { title: "Play Album", hint: "action_list" }] }) });
  assert.equal((await route(deps([]))({ offset: "-1" })).code, 400);
  assert.equal((await route(deps([]))({ offset: "4" })).code, 404);
  calls.length = 0;
  const r = await route(deps([{ title: "Kind of Blue", subtitle: "Miles Davis", item_key: "k" }]))({ offset: "4" });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.album, { title: "Kind of Blue", subtitle: "Miles Davis" });
  assert.equal(r.body.item_count_returned, 2);
  assert.deepEqual(r.body.items[0], { title: "So What", subtitle: "Miles Davis", hint: null, has_image: true, item_key_present: true });
  assert.deepEqual(calls.map(([, o]) => [o.pop_all || false, o.item_key || null, o.multi_session_key]), [[true, null, "k1"], [false, "k", "k1"]]);
  const failing = await route({ core: () => ({}), withBrowseSession: async () => { throw new Error("Roon went away"); } })({ offset: "1" });
  assert.deepEqual(failing, { code: 500, body: { error: "Roon went away" } });
});
