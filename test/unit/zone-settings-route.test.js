"use strict";
// ---------------------------------------------------------------------------
// Shuffle, repeat and Roon Radio for a zone (lib/routes/zone-settings.js, moved out of index.js in v1.9.72-t27
// unchanged): the asks it refuses, the change sent through the native-first transport, what was accepted mirrored on
// the zone at once, and Rouen's own Random Album Radio handed over to Roon Radio only once Roon accepted it.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountZoneSettings } = require("../../lib/routes/zone-settings");

function rig(o = {}) {
  let handler = null;
  const app = { post: (p, h) => { assert.equal(p, "/api/zone-settings"); handler = h; } };
  const sent = [], mirrored = [], stopped = [];
  const zones = { z1: { zone_id: "z1", display_name: "Kitchen" } };
  const outputs = { o1: { zone_id: "z1" } };
  mountZoneSettings(app, {
    core: () => (o.unpaired ? null : {}), zones: () => zones, outputs: () => outputs,
    transport: { change_settings: (id, patch, cb) => { sent.push([id, patch]); cb(o.err || null, { via: "roon" }); } },
    applyAccepted: (zone, patch) => mirrored.push([zone && zone.zone_id, patch]),
    radio: { toTurnOff: (which, on, ours) => (which === "roon" && on && ours ? "own" : null), isOn: (id) => !!o.ownRadio && id === "z1",
      stop: (id) => stopped.push(id), report: (id) => ({ zone: id, own: !!o.ownRadio && !stopped.length }) },
  });
  const ask = (body) => new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    handler({ body }, res);
  });
  return { ask, sent, mirrored, stopped };
}

test("THE one: Roon Radio on with ours on — sent, mirrored, then ours stood down and said so", async () => {
  const w = rig({ ownRadio: true });
  const r = await w.ask({ zone_or_output_id: "o1", auto_radio: true });
  assert.equal(r.code, 200);
  assert.deepEqual(w.sent, [["o1", { auto_radio: true }]]);
  assert.deepEqual(w.mirrored, [["z1", { auto_radio: true }]]);
  assert.deepEqual(w.stopped, ["z1"]);
  assert.deepEqual(r.body, { ok: true, random_album_radio_turned_off: true, via: "roon", radios: { zone: "z1", own: false } });
});

test("refused by Roon: ours is left on, nothing mirrored", async () => {
  const w = rig({ ownRadio: true, err: "NotFound" });
  const r = await w.ask({ zone_or_output_id: "z1", auto_radio: true });
  assert.equal(r.code, 500);
  assert.equal(r.body.error, "NotFound");
  assert.deepEqual(w.stopped, []);
  assert.deepEqual(w.mirrored, []);
});

test("the asks it refuses, before anything is sent", async () => {
  for (const [body, code, why] of [
    [{}, 400, /zone_or_output_id/],
    [{ zone_or_output_id: "z1" }, 400, /one of shuffle/],
    [{ zone_or_output_id: "z1", shuffle: "yes" }, 400, /boolean/],
    [{ zone_or_output_id: "z1", loop: "next" }, 400, /disabled, loop, loop_one/],
  ]) {
    const w = rig();
    const r = await w.ask(body);
    assert.equal(r.code, code); assert.match(r.body.error, why);
    assert.deepEqual(w.sent, []);
  }
  const unpaired = rig({ unpaired: true });
  assert.equal((await unpaired.ask({ zone_or_output_id: "z1", shuffle: true })).code, 503);
});

test("shuffle and repeat alone: sent as asked, ours untouched", async () => {
  const w = rig({ ownRadio: true });
  const r = await w.ask({ zone_or_output_id: "z1", shuffle: true, loop: "loop_one" });
  assert.equal(r.code, 200);
  assert.deepEqual(w.sent, [["z1", { shuffle: true, loop: "loop_one" }]]);
  assert.equal(r.body.random_album_radio_turned_off, false);
  assert.deepEqual(w.stopped, []);
});
