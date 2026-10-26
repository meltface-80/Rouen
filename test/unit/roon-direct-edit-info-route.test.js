"use strict";
// t3's route (lib/roon-direct/route.js mountEditInfoProbe, v1.9.67-t3): nothing without run=1; n checked against the
// probe's own limits; title and artist passed as text; and the answer as JSON — what reaches a browser must survive
// JSON.stringify (a BigInt from the wire would not; the review).

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountRoonDirect } = require("../../lib/roon-direct/route");
const { MAX_N, DEFAULT_N, said, layers } = require("../../lib/roon-direct/edit-info");
const { ObjectGraph } = require("../../lib/roon-direct/objects");

function rig(answer) {
  const runs = [], routes = {};
  const app = { get: (p, fn) => { routes["GET " + p] = fn; }, post: (p, fn) => { routes["POST " + p] = fn; } };
  const noop = { run: async () => ({}) };
  const stage1 = {
    status: () => ({}), turnOn: () => ({}), turnOff: () => ({}), setProfile: () => ({}), albums: () => null,
    marks: {}, finder: {}, later: { read: async () => ({}) }, smartProbe: noop, smartUpdater: {}, zoneProbe: noop, peqTry: {},
    zoneSettings: {}, zoneControls: {}, zoneDsp: {}, dspSettings: {}, peq: {},
    editInfoProbe: { run: async (o) => { runs.push(o); return answer; } },
  };
  mountRoonDirect(app, stage1);
  const call = async (query) => {
    const res = { code: 200, body: null, set() {}, status(c) { this.code = c; return this; }, json(b) { this.body = JSON.parse(JSON.stringify(b)); return this; } };
    await routes["GET /api/debug/roon-album-edit-info"]({ query }, res);
    return res;
  };
  return { call, runs };
}

test("the gate, the limits and what is passed through; the answer survives JSON", async () => {
  const w = rig({ read: true, albums: [{ roon: { Title: layers(new ObjectGraph({ maxObjects: 10 }), { $ref: 77n }) } }] });
  const idle = await w.call({});
  assert.equal(idle.body.ran, false);
  assert.match(idle.body.how, new RegExp(`1 to ${MAX_N}, ${DEFAULT_N} if not given`));
  assert.deepEqual(w.runs, []);
  for (const n of ["0", String(MAX_N + 1), "1,2", "abc"]) assert.equal((await w.call({ run: "1", n })).code, 400, "n=" + n);
  assert.deepEqual(w.runs, [], "a refused n sends nothing");
  const ok = await w.call({ run: "1", n: "3", title: "blue", artist: ["x"] });
  assert.equal(ok.code, 200);
  assert.deepEqual(w.runs, [{ n: 3, title: "blue", artist: undefined }], "n as a number, title as text, an array (not text) as nothing");
  assert.deepEqual(ok.body.albums[0].roon.Title, { as: "object", value: { ref: "77" } }, "a reference from the wire reaches the browser as its id, not a BigInt");
  const bare = await w.call({ run: "1" });
  assert.deepEqual(w.runs[1], { n: undefined, title: undefined, artist: undefined });
  assert.equal(bare.code, 200);
  const refused = rig({ error: "Native mode is off.", status: 409 });
  assert.deepEqual([(await refused.call({ run: "1" })).code, (await refused.call({ run: "1" })).body], [409, { error: "Native mode is off." }]);
  assert.deepEqual(said([5n, { $ref: 9n }, { $inline: 80 }, null]), ["5", { ref: "9" }, { undeclaredType: 80 }, null]);
});
