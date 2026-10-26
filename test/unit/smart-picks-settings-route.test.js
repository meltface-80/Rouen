"use strict";
// Smart Picks' settings routes (lib/routes/smart-picks-settings.js, moved out of index.js in v1.9.67-t4, unchanged):
// every field checked before any is applied; the daily timer started or stopped as the switch moves; auto_add still
// honoured and still written.

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountSmartPicksSettings } = require("../../lib/routes/smart-picks-settings");

function rig() {
  let state = { enabled: false, hour: 4, dest: "ask" };
  const saved = [], timer = [], routes = {};
  mountSmartPicksSettings({ get: (p, fn) => { routes["GET " + p] = fn; }, post: (p, fn) => { routes["POST " + p] = fn; } }, {
    get: () => Object.assign({}, state), set: (v) => { state = v; }, dests: () => ["library", "later", "ask"], serviceReady: () => true,
    start: () => timer.push("start"), stop: () => timer.push("stop"), save: (patch) => { saved.push(patch); return true; },
  });
  const call = (k, body) => { const res = { code: 200, out: null, status(c) { this.code = c; return this; }, json(j) { this.out = j; return this; } }; routes[k]({ body }, res); return res; };
  return { call, saved, timer, state: () => state };
}

test("read; a refused field changes nothing; hour, dest and the switch applied together; auto_add as the old switch", () => {
  const w = rig();
  assert.deepEqual(w.call("GET /api/settings/smart-picks").out, { enabled: false, hour: 4, dest: "ask", dests: ["library", "later", "ask"], auto_add: false, service_ready: true });
  assert.equal(w.call("POST /api/settings/smart-picks", { dest: "moon", hour: 9 }).code, 400);
  assert.equal(w.call("POST /api/settings/smart-picks", { hour: 24, enabled: true }).code, 400);
  assert.deepEqual([w.state(), w.saved, w.timer], [{ enabled: false, hour: 4, dest: "ask" }, [], []], "nothing applied, nothing saved, no timer touched");
  const r = w.call("POST /api/settings/smart-picks", { hour: "9", dest: "library", enabled: true });
  assert.deepEqual(r.out, { ok: true, enabled: true, hour: 9, dest: "library", auto_add: true });
  assert.deepEqual([w.state(), w.timer], [{ enabled: true, hour: 9, dest: "library" }, ["start"]]);
  assert.deepEqual(w.saved, [{ smartPicksEnabled: true, smartPicksHour: 9, smartPicksDest: "library", smartPicksAutoAdd: true }]);
  w.call("POST /api/settings/smart-picks", { auto_add: false, enabled: false });
  assert.deepEqual([w.state(), w.timer], [{ enabled: false, hour: 9, dest: "ask" }, ["start", "stop"]], "the old switch off is 'ask'; the timer stopped");
  w.call("POST /api/settings/smart-picks", { hour: 5 });
  assert.deepEqual(w.timer, ["start", "stop"], "the switch untouched: the timer untouched");
});
