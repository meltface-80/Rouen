"use strict";
// ---------------------------------------------------------------------------
// Roon playlists' cover mosaics (lib/routes/playlist-art.js, moved out of
// index.js in v1.9.62, unchanged): read from a cache by title, or walked once
// and cached — even when empty — with up to four distinct covers; the cache
// bounded at 300, one shared object across concurrent writers.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountPlaylistArt } = require("../../lib/routes/playlist-art");

function rig(o = {}) {
  const store = {};
  const walked = [];
  const routes = {};
  const art = mountPlaylistArt({ get: (p, fn) => { routes[p] = fn; } }, {
    settings: { load: () => store, save: (patch) => { Object.assign(store, patch); return true; } },
    keyOf: (t) => (t ? t.toLowerCase() : null), core: () => (o.unpaired ? null : {}),
    isTrack: (t) => !t.menu,
    walk: async (offset, title) => {
      walked.push([offset, title]);
      if (o.stale) { const e = new Error("moved"); e.stale = true; throw e; }
      return { items: o.items || [], playMenu: null };
    },
  });
  const call = async (query) => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes["/api/playlist/art"]({ query }, res);
    return res;
  };
  return { call, store, walked, art };
}

test("walked once, four distinct covers kept by title (even none), then read from the cache", async () => {
  const w = rig({ items: [{ menu: true, image_key: "m" }, { image_key: "a" }, { image_key: "a" }, { image_key: "b" }, { image_key: null },
    { image_key: "c" }, { image_key: "d" }, { image_key: "e" }] });
  assert.deepEqual((await w.call({ title: "Morning", offset: "3" })).body, { title: "Morning", art_keys: ["a", "b", "c", "d"], cached: false });
  assert.deepEqual((await w.call({ title: "Morning", offset: "3" })).body, { title: "Morning", art_keys: ["a", "b", "c", "d"], cached: true });
  assert.deepEqual(w.walked, [[3, "Morning"]]);
  assert.equal(w.art.cache(), w.store.playlistArt, "not the one shared object");
  const none = rig({ items: [] });
  await none.call({ title: "Empty", offset: "0" });
  assert.deepEqual(none.store.playlistArt, { empty: [] });
});

test("refused: no title 400, not paired 503, no offset 400, a stale walk 409; the cache bounded at 300", async () => {
  assert.equal((await rig().call({})).code, 400);
  assert.equal((await rig({ unpaired: true }).call({ title: "x", offset: "0" })).code, 503);
  assert.equal((await rig().call({ title: "x" })).code, 400);
  const stale = await rig({ stale: true }).call({ title: "x", offset: "0" });
  assert.deepEqual([stale.code, stale.body.stale], [409, true]);
  const w = rig({ items: [{ image_key: "k" }] });
  for (let i = 0; i < 302; i++) await w.call({ title: "P" + i, offset: "0" });
  const names = Object.keys(w.store.playlistArt);
  assert.deepEqual([names.length, names[0], names[299]], [300, "p2", "p301"], "not the oldest dropped first");
});
