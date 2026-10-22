"use strict";
// ---------------------------------------------------------------------------
// Pause all, mute all and ungroup (lib/routes/all-zones.js, moved out of
// index.js unchanged in v1.9.53): each asks Roon's official transport API, and
// answers 503 unpaired, 400 for a bad body, 500 with Roon's error.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountAllZones } = require("../../lib/routes/all-zones");

function rig(o = {}) {
  const asked = [];
  const transport = {
    pause_all: (cb) => { asked.push(["pause"]); cb(o.err || null); },
    mute_all: (how, cb) => { asked.push(["mute", how]); cb(o.err || null); },
    ungroup_outputs: (ids, cb) => { asked.push(["ungroup", ids]); cb(o.err || null); },
  };
  const routes = {};
  mountAllZones({ post: (p, fn) => { routes[p] = fn; } },
    { core: () => (o.unpaired ? null : { services: { RoonApiTransport: transport } }), outputs: () => ({ o1: { display_name: "Kitchen" } }) });
  const call = (p, body) => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    routes[p]({ body }, res);
    return res;
  };
  return { call, asked };
}

test("each asks Roon, and answers ok", () => {
  const w = rig();
  assert.deepEqual(w.call("/api/pause-all").body, { ok: true });
  assert.deepEqual(w.call("/api/mute-all", { how: "unmute" }).body, { ok: true });
  assert.deepEqual(w.call("/api/ungroup-outputs", { output_ids: ["o1", "o2"] }).body, { ok: true });
  assert.deepEqual(w.asked, [["pause"], ["mute", "unmute"], ["ungroup", ["o1", "o2"]]]);
});

test("unpaired 503; a bad body 400, Roon not asked; Roon's error 500", () => {
  const off = rig({ unpaired: true });
  for (const p of ["/api/pause-all", "/api/mute-all", "/api/ungroup-outputs"]) assert.equal(off.call(p, {}).code, 503);
  const w = rig();
  assert.equal(w.call("/api/mute-all", { how: "loud" }).code, 400);
  assert.equal(w.call("/api/ungroup-outputs", { output_ids: [] }).code, 400);
  assert.equal(w.call("/api/ungroup-outputs", { output_ids: ["o1", ""] }).code, 400);
  assert.equal(w.call("/api/ungroup-outputs", { output_ids: ["o1", "o1"] }).code, 400);
  assert.deepEqual(w.asked, []);
  const bad = rig({ err: "ZoneNotFound" });
  const r = bad.call("/api/pause-all");
  assert.deepEqual([r.code, r.body], [500, { error: "ZoneNotFound" }]);
});
