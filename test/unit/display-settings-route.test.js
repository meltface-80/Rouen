"use strict";
// The Wall Display's settings routes (lib/routes/display-settings.js, moved out of index.js in v1.9.67-t3, unchanged):
// a switch and a refresh interval of 5–60 s, anything else leaving the old value, persisted together.

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountDisplaySettings } = require("../../lib/routes/display-settings");

function rig() {
  let state = { enabled: false, seconds: 10 };
  const saved = [], routes = {};
  mountDisplaySettings({ get: (p, fn) => { routes["GET " + p] = fn; }, post: (p, fn) => { routes["POST " + p] = fn; } },
    { get: () => Object.assign({}, state), set: (v) => { state = v; }, save: (patch) => { saved.push(patch); return true; } });
  const call = (k, body) => { let out; routes[k]({ body }, { json: (j) => { out = j; } }); return out; };
  return { call, saved, state: () => state };
}

test("read as held; a switch and an interval set together or apart; an interval out of range or not a number leaves the old", () => {
  const w = rig();
  assert.deepEqual(w.call("GET /api/settings/display"), { enabled: false, seconds: 10 });
  assert.deepEqual(w.call("POST /api/settings/display", { enabled: true, seconds: "30" }), { ok: true, enabled: true, seconds: 30 });
  assert.deepEqual(w.state(), { enabled: true, seconds: 30 });
  assert.deepEqual(w.call("POST /api/settings/display", { seconds: 4 }), { ok: true, enabled: true, seconds: 30 }, "under 5: the old stays");
  assert.deepEqual(w.call("POST /api/settings/display", { seconds: "x", enabled: "yes" }), { ok: true, enabled: true, seconds: 30 }, "not a number, not a boolean: nothing moves");
  assert.deepEqual(w.call("POST /api/settings/display", {}), { ok: true, enabled: true, seconds: 30 });
  assert.deepEqual(w.saved, [{ displayEnabled: true, displaySeconds: 30 }, { displayEnabled: true, displaySeconds: 30 }, { displayEnabled: true, displaySeconds: 30 }, { displayEnabled: true, displaySeconds: 30 }],
    "persisted as a pair, every time");
});

// 2.0.6-t8 (dev/design/rouen-lite.md §4; the owner: "Wall display wasn't removed as requested"): Rouen Lite has none.
test("Rouen Lite: off whatever was saved, said so, and never turned on; the saved value left alone", () => {
  let state = { enabled: true, seconds: 10 };
  const saved = [], routes = {};
  mountDisplaySettings({ get: (p, fn) => { routes["GET " + p] = fn; }, post: (p, fn) => { routes["POST " + p] = fn; } },
    { get: () => Object.assign({}, state), set: (v) => { state = v; }, save: (patch) => { saved.push(patch); return true; }, lite: true });
  const call = (k, body) => new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(j) { resolve({ code: this.code, body: j }); } };
    routes[k]({ body }, res);
  });
  return (async () => {
    assert.equal(state.enabled, false, "THE one: off from the start, so /display and its content answer as when it is off");
    assert.deepEqual(saved, [], "what was saved is left as it was");
    assert.deepEqual(await call("GET /api/settings/display"), { code: 200, body: { enabled: false, seconds: 10, lite: true } });
    assert.deepEqual(await call("POST /api/settings/display", { enabled: true }), { code: 409, body: { error: "Rouen Lite has no wall display." } });
    assert.equal(state.enabled, false);
    assert.equal((await call("POST /api/settings/display", { seconds: 20 })).body.seconds, 20, "its interval may still be set");
    assert.deepEqual(saved, [{ displaySeconds: 20 }], "the review: the interval alone saved, the switch saved before left as it was");
  })();
});
