"use strict";
// v1.9.72-t68: the Apple Shortcuts routes (lib/routes/shortcuts.js), moved out of index.js unchanged. On fakes.

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountShortcuts } = require("../../lib/routes/shortcuts");

const ZONES = { z1: { zone_id: "z1", display_name: "TV Speaker", state: "playing" }, z2: { zone_id: "z2", display_name: "Kitchen", state: "stopped" } };

function world({ core = {}, random = [{ offset: 7, title: "Rumours", subtitle: "Fleetwood Mac" }], unheard = { offset: 9, title: "Tusk", subtitle: "Fleetwood Mac" }, fail = null } = {}) {
  const routes = {}, opened = [];
  mountShortcuts({ get: (p, h) => { routes[p] = h; } }, {
    core: () => core, zones: () => ZONES,
    pickRandomAlbums: async () => ({ albums: random }),
    pickUnheardAlbum: async () => unheard,
    openAlbumByOffset: async (...a) => { if (fail) throw new Error(fail); opened.push(a); },
  });
  const call = (p, query = {}) => new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    routes[p]({ query }, res);
  });
  return { call, opened };
}

test("zones: each zone's id, name and state", async () => {
  const r = await world().call("/api/shortcut/zones");
  assert.deepEqual(r.body, { zones: [{ id: "z1", name: "TV Speaker", state: "playing" }, { id: "z2", name: "Kitchen", state: "stopped" }] });
});

test("THE one: play-random plays the pick now on the zone named, checked by its title", async () => {
  const w = world();
  const r = await w.call("/api/shortcut/play-random", { zone: "Kitchen" });
  assert.deepEqual(r.body, { ok: true, album: "Rumours", artist: "Fleetwood Mac", zone: "Kitchen" });
  assert.deepEqual(w.opened, [[7, "z2", "play_now", null, { title: "Rumours", subtitle: "Fleetwood Mac" }]]);
});

test("play-unheard by the zone's id; an unknown zone is a 404 that lists the zones", async () => {
  const w = world();
  const r = await w.call("/api/shortcut/play-unheard", { zone: "z1" });
  assert.deepEqual(r.body, { ok: true, album: "Tusk", artist: "Fleetwood Mac", zone: "TV Speaker" });
  const no = await w.call("/api/shortcut/play-unheard", { zone: "Attic" });
  assert.equal(no.code, 404);
  assert.deepEqual(no.body, { error: "Zone not found", available: ["TV Speaker", "Kitchen"] });
});

test("no Core: 503; nothing to pick: 503; Roon refusing: 500 with its words", async () => {
  assert.equal((await world({ core: null }).call("/api/shortcut/play-random", { zone: "Kitchen" })).code, 503);
  assert.equal((await world({ random: [] }).call("/api/shortcut/play-random", { zone: "Kitchen" })).code, 503);
  assert.equal((await world({ unheard: null }).call("/api/shortcut/play-unheard", { zone: "Kitchen" })).code, 503);
  const r = await world({ fail: "no Play Now" }).call("/api/shortcut/play-random", { zone: "Kitchen" });
  assert.deepEqual([r.code, r.body], [500, { error: "no Play Now" }]);
});
