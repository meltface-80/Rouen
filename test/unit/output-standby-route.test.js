"use strict";
/*
 * POST /api/output/standby, moved out of index.js unchanged in Rouen Lite's L1 (lib/routes/output-standby.js): not
 * paired, 503; its checks, 400; standby sent; a keyed toggle first, and the keyless fallback when Roon lost the control.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { mountOutputStandby } = require("../../lib/routes/output-standby");
const { indexSource } = require("../lib/extract");

function route(core, outputs = {}) {
  let handler = null;
  const d = { core: () => core, outputs: () => outputs, modes: ["toggle", "standby"], roonErrorPayload: (e) => ({ error: String(e) }),
    shouldRetryKeyless: (name, had) => name === "SourceControlNotFound" && had, controlStatusOf: () => "indeterminate",
    keylessStandbyFallback: () => "wake" };
  mountOutputStandby({ post: (p, h) => { assert.equal(p, "/api/output/standby"); handler = h; } }, d);
  return (body) => new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ status: this.code, body: b }); } };
    handler({ body }, res);
  });
}

test("its checks, as before", async () => {
  assert.equal((await route(null)({ output_id: "o" })).status, 503);
  const r = route({});
  assert.equal((await r({})).status, 400);
  assert.match((await r({ output_id: "o", mode: "off" })).body.error, /invalid mode, allowed: toggle, standby/);
  assert.match((await r({ output_id: "o" })).body.error, /control_key required/);
  assert.match((await r({ output_id: "o", mode: "standby", control_key: 5 })).body.error, /control_key must be a string/);
});

test("standby sent; a keyed toggle, and the keyless wake when Roon lost the control", async () => {
  const calls = [];
  const t = { standby: (id, o, cb) => { calls.push(["standby", id, o]); cb(); },
    toggle_standby: (id, o, cb) => { calls.push(["toggle", id, o]); cb("SourceControlNotFound"); },
    convenience_switch: (id, o, cb) => { calls.push(["wake", id, o]); cb(); } };
  const r = route({ services: { RoonApiTransport: t } }, { o: { display_name: "DAC" } });
  assert.deepEqual((await r({ output_id: "o", mode: "standby" })).body, { ok: true });
  assert.deepEqual((await r({ output_id: "o", control_key: "k" })).body, { ok: true, form: "keyless-wake" });
  assert.deepEqual(calls, [["standby", "o", {}], ["toggle", "o", { control_key: "k" }], ["wake", "o", {}]]);
});

test("index.js mounts it with its Core, outputs, modes and helpers", () => {
  assert.match(indexSource(), /\nmountOutputStandby\(app, \{ core: \(\) => core, outputs: \(\) => outputs, modes: STANDBY_MODES, roonErrorPayload, shouldRetryKeyless,\n {2}controlStatusOf, keylessStandbyFallback \}\);\n/);
});
