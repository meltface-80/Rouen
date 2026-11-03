"use strict";
// v1.9.72-t71: POST /api/transfer-zone (lib/routes/transfer-zone.js), moved out of index.js unchanged. On fakes.

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountTransferZone } = require("../../lib/routes/transfer-zone");

function world({ core = true, fail = null } = {}) {
  const routes = {}, asked = [];
  const fakeCore = { services: { RoonApiTransport: { transfer_zone: (a, b, cb) => { asked.push([a, b]); cb(fail); } } } };
  mountTransferZone({ post: (p, h) => { routes[p] = h; } }, {
    core: () => (core ? fakeCore : null),
    zones: () => ({ z1: { display_name: "Lounge" }, z2: { display_name: "Kitchen" } }),
  });
  const call = (body) => new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    routes["/api/transfer-zone"]({ body }, res);
  });
  return { call, asked };
}

test("THE one: the queue is moved from one zone to the other through Roon's transfer_zone", async () => {
  const w = world();
  const r = await w.call({ from_zone: "z1", to_zone: "z2" });
  assert.deepEqual(r, { code: 200, body: { ok: true } });
  assert.deepEqual(w.asked, [["z1", "z2"]]);
});

test("the same zone twice is a no-op; Roon isn't asked", async () => {
  const w = world();
  assert.deepEqual((await w.call({ from_zone: "z1", to_zone: "z1" })).body, { ok: true, noop: true });
  assert.deepEqual(w.asked, []);
});

test("no Core: 503; a missing zone: 400; Roon refusing: 500 with its words", async () => {
  assert.equal((await world({ core: false }).call({ from_zone: "z1", to_zone: "z2" })).code, 503);
  assert.equal((await world().call({ from_zone: "z1" })).code, 400);
  const r = await world({ fail: "zone gone" }).call({ from_zone: "z1", to_zone: "z2" });
  assert.deepEqual(r, { code: 500, body: { error: "zone gone" } });
  const o = await world({ fail: { code: 1 } }).call({ from_zone: "z1", to_zone: "z2" });
  assert.deepEqual(o.body, { error: '{"code":1}' });
});
