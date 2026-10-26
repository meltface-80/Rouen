"use strict";
// ---------------------------------------------------------------------------
// The Labels switch and the label-folder depth routes (lib/routes/labels-settings.js),
// moved out of index.js unchanged in v1.9.67: switched on, the scan runs now;
// a depth changed with Labels on and a Core paired starts a rescan, and with
// Labels off, or while one runs, it doesn't.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountLabelsSettings } = require("../../lib/routes/labels-settings");

function rig(o = {}) {
  const st = { enabled: !!o.enabled, depth: o.depth || 0, index: { count: 7, building: o.building || null, builtAt: 99 } };
  const saved = [], ran = [], logged = [];
  const routes = {};
  const app = { get: (p, fn) => { routes["GET " + p] = fn; }, post: (p, fn) => { routes["POST " + p] = fn; } };
  mountLabelsSettings(app, {
    enabled: () => st.enabled, setEnabled: (v) => { st.enabled = v; }, index: () => st.index,
    save: (patch) => { saved.push(patch); return true; },
    rescan: async (force) => { ran.push(force === true ? "force" : "plain"); },
    bgRun: (what, fn) => fn(), depth: () => st.depth, setDepth: (n) => { st.depth = n; },
    paired: () => o.paired !== false, log: (l) => logged.push(l),
  });
  const call = async (key, body) => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes[key]({ body }, res);
    await new Promise((r) => { setImmediate(r); });
    return res;
  };
  return { st, saved, ran, logged, call };
}

test("the switch: read; on starts the scan at once and is saved; off is saved and starts nothing; a body without it is 400", async () => {
  const w = rig();
  assert.deepEqual((await w.call("GET /api/settings/labels")).body, { enabled: false, count: 7, scanning: false });
  assert.equal((await w.call("POST /api/settings/labels", {})).code, 400);
  const on = await w.call("POST /api/settings/labels", { enabled: true });
  assert.deepEqual([on.body, w.st.enabled, w.saved, w.ran], [{ ok: true, enabled: true }, true, [{ labelsEnabled: true }], ["force"]]);
  await w.call("POST /api/settings/labels", { enabled: true });
  assert.deepEqual(w.ran, ["force"], "on again: no second scan");
  const off = await w.call("POST /api/settings/labels", { enabled: 0 });
  assert.deepEqual([off.body, w.st.enabled, w.saved.at(-1)], [{ ok: true, enabled: false }, false, { labelsEnabled: false }]);
  assert.deepEqual(w.ran, ["force"]);
});

test("the depth: read; 0–6 only; a change with Labels on and a Core paired rescans; unchanged, off, unpaired or mid-scan it doesn't", async () => {
  const w = rig({ enabled: true, depth: 2 });
  assert.deepEqual((await w.call("GET /api/settings/label-folder-depth")).body, { depth: 2 });
  assert.equal((await w.call("POST /api/settings/label-folder-depth", { depth: 7 })).code, 400);
  assert.equal((await w.call("POST /api/settings/label-folder-depth", { depth: "x" })).code, 400);
  const r = await w.call("POST /api/settings/label-folder-depth", { depth: 3 });
  assert.deepEqual([r.body, w.st.depth, w.saved, w.ran, w.st.index.builtAt], [{ ok: true, saved: true, rescanning: true }, 3, [{ labelFolderDepth: 3 }], ["plain"], 0]);
  assert.match(w.logged[0], /depth change → 3/);
  assert.equal((await w.call("POST /api/settings/label-folder-depth", { depth: 3 })).body.rescanning, false, "unchanged");
  const off = rig({ enabled: false, depth: 0 });
  assert.equal((await off.call("POST /api/settings/label-folder-depth", { depth: 1 })).body.rescanning, false, "Labels off");
  assert.deepEqual(off.ran, []);
  const unpaired = rig({ enabled: true, paired: false });
  assert.equal((await unpaired.call("POST /api/settings/label-folder-depth", { depth: 1 })).body.rescanning, false);
  const busy = rig({ enabled: true, building: { at: 1 } });
  const b = await busy.call("POST /api/settings/label-folder-depth", { depth: 1 });
  assert.deepEqual([b.body.rescanning, busy.ran], [true, []], "said rescanning (the one running will read the new depth), none started");
});
