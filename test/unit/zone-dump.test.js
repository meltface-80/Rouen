"use strict";
// /api/debug/zone-dump, moved out of index.js in v1.9.72-t1 (lib/routes/zone-dump.js) with its behaviour unchanged:
// it picks the zone with the most loaded, says plainly when that zone is idle, and never fails on an unreadable queue.
const test = require("node:test");
const assert = require("node:assert/strict");
const { mountZoneDump } = require("../../lib/routes/zone-dump");

function dump(deps) {
  let handler = null;
  mountZoneDump({ get: (p, h) => { assert.equal(p, "/api/debug/zone-dump"); handler = h; } }, deps);
  return (query) => new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    handler({ query }, res);
  });
}

const playing = { zone_id: "z2", display_name: "Lounge", state: "playing",
  now_playing: { three_line: { line1: "So What", line2: "Miles Davis", line3: "Kind of Blue" } } };
const paused = { zone_id: "z3", display_name: "Office", state: "paused", now_playing: { three_line: { line1: "x" } } };
const idle = { zone_id: "z1", display_name: "Kitchen", state: "stopped" };
const deps = (o = {}) => Object.assign({ core: () => ({}), zones: () => ({ z1: idle, z2: playing, z3: paused }),
  peekQueueRaw: async () => [{ queue_item_id: 1 }], identityReport: () => ({ source: "local" }),
  qobuz: () => ({ connected: false }), samples: () => [{ at: 1, zone_name: "Lounge", state: "playing", app_thinks: {}, now_playing: { length: 9 } }] }, o);

test("without a Core it says so", async () => {
  assert.equal((await dump(deps({ core: () => null }))({})).code, 503);
});

test("it picks the playing zone over a paused or idle one, and reports what Rouen thinks of it", async () => {
  const r = await dump(deps())({});
  assert.equal(r.code, 200);
  assert.equal(r.body.zone_raw.zone_id, "z2");
  assert.match(r.body.note, /^OK/);
  assert.deepEqual(r.body.app_thinks, { track: "So What", album: "Kind of Blue", artist: "Miles Davis", source: "local" });
  assert.deepEqual(r.body.queue_raw, [{ queue_item_id: 1 }]);
  assert.equal(r.body.sample_count, 1);
  assert.deepEqual(r.body.qobuz, { connected: false });
});

test("an idle zone asked for by id is said to be idle; an unknown one is a 404; an unreadable queue is empty", async () => {
  const r = await dump(deps({ peekQueueRaw: async () => { throw new Error("no queue"); } }))({ zone: "z1" });
  assert.match(r.body.note, /^THIS ZONE IS IDLE \(state: stopped\)/);
  assert.deepEqual(r.body.queue_raw, []);
  const none = await dump(deps())({ zone: "nope" });
  assert.equal(none.code, 404);
  assert.deepEqual(none.body.known, ["z1", "z2", "z3"]);
});
