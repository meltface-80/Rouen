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
