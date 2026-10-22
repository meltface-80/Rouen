"use strict";
// ---------------------------------------------------------------------------
// The zone reads (lib/routes/zones.js), moved out of index.js unchanged in v1.9.64: what each answers from the
// official API's zones and outputs, read anew on every request (index.js replaces them whole when the Core comes or
// goes). zoneSettings and outputInfo themselves are tested in zonemodes.test.js.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountZoneReads } = require("../../lib/routes/zones");

function rig(state) {
  const routes = {};
  const app = { get: (p, h) => { routes[p] = h; } };
  let noted = 0;
  mountZoneReads(app, { core: () => state.core, zones: () => state.zones, outputs: () => state.outputs,
    zoneSettings: (z) => ({ shuffle: !!(z && z.settings && z.settings.shuffle), loop: "disabled", auto_radio: false }),
    noteLibraryClient: () => { noted++; }, creditLinks: (c) => (c ? [{ name: c, linkable: false }] : []) });
  const call = (p, query = {}) => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    routes[p]({ query }, res);
    return res;
  };
  return { call, noted: () => noted };
}

const KITCHEN = { zone_id: "z2", display_name: "Kitchen", state: "stopped", outputs: [{ output_id: "o2", zone_id: "z2", display_name: "Kitchen" }] };
const HIFI = { zone_id: "z1", display_name: "HiFi", state: "playing", settings: { shuffle: true }, queue_items_remaining: 4,
  is_play_allowed: false, is_pause_allowed: true, is_next_allowed: true, is_previous_allowed: true, is_seek_allowed: true,
  outputs: [{ output_id: "o1", zone_id: "z1", display_name: "DAC", is_muted: true, volume: { value: 30, min: 0, max: 100, step: 1, type: "number" } }],
  now_playing: { seek_position: 12, length: 200, image_key: "k1", three_line: { line1: "River", line2: "Joni Mitchell", line3: "Blue" }, one_line: { line1: "River" } } };

test("/api/zones and /api/outputs: sorted by name, each zone's settings and outputs; outputs from the zones when none cached", () => {
  const state = { core: {}, zones: { z1: HIFI, z2: KITCHEN }, outputs: {} };
  const w = rig(state);
  const z = w.call("/api/zones").body.zones;
  assert.deepEqual(z.map((x) => [x.display_name, x.state, x.settings.shuffle]), [["HiFi", "playing", true], ["Kitchen", "stopped", false]]);
  assert.deepEqual(z[0].outputs[0], { output_id: "o1", zone_id: "z1", display_name: "DAC", can_group_with_output_ids: null, source_controls: [] });
  const o = w.call("/api/outputs").body.outputs;
  assert.deepEqual(o.map((x) => [x.display_name, x.zone_name]), [["DAC", "HiFi"], ["Kitchen", "Kitchen"]]);
  state.outputs = { o9: { output_id: "o9", zone_id: "z2", display_name: "Patio" } };
  assert.deepEqual(w.call("/api/outputs").body.outputs.map((x) => [x.display_name, x.zone_name]), [["Patio", "Kitchen"]],
    "the outputs cache, read anew, not used when it has outputs");
  state.core = null;
  assert.equal(w.call("/api/outputs").code, 503);
});

test("/api/zone-state: one zone as the screens poll it; none named or unknown is null; not paired is 503; noted as looking", () => {
  const state = { core: {}, zones: { z1: HIFI }, outputs: {} };
  const w = rig(state);
  const r = w.call("/api/zone-state", { zone: "z1" }).body.zone;
  assert.deepEqual([r.state, r.is_play_allowed, r.is_pause_allowed, r.queue_items_remaining], ["playing", false, true, 4]);
  assert.deepEqual(r.outputs, [{ output_id: "o1", display_name: "DAC", is_muted: true, volume: { value: 30, min: 0, max: 100, step: 1, soft_limit: undefined, type: "number" } }]);
  assert.deepEqual(r.now_playing, { line1: "River", line2: "Joni Mitchell", line3: "Blue", artists: [{ name: "Joni Mitchell", linkable: false }],
    image_key: "k1", length: 200, seek_position: 12 });
  assert.deepEqual(w.call("/api/zone-state", { zone: "nope" }).body, { zone: null });
  assert.deepEqual(w.call("/api/zone-state").body, { zone: null });
  assert.equal(w.noted(), 3, "a poll not counted as someone looking");
  state.core = null;
  assert.equal(w.call("/api/zone-state", { zone: "z1" }).code, 503);
});
