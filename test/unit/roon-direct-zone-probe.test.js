"use strict";
// ---------------------------------------------------------------------------
// N3-0, the zones probe (lib/roon-direct/zone-probe.js, v1.9.64, native-remote.md §14.1): what the connection holds
// of the server's zones, outputs and audio devices, beside the official zones — and what moves in a few seconds. It
// makes no call: the session here has no channel to call on, so one tried would throw. The graph is a stub, shaped as
// objects.js keeps one; it is not evidence of what a real server sends (the owner's run is).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createZoneProbe } = require("../../lib/roon-direct/zone-probe");

const API = "Sooloos.Broker.Api.";
const obj = (oid, type, fields, loaded = true) => ({ oid, typeId: 1, typeName: API + type, fields, loaded });

function stubGraph() {
  const objects = new Map();
  const add = (o) => { objects.set(String(o.oid), o); return o; };
  const zone = add(obj(10n, "Zone", { [`System.Sooid ${API}Zone::ZoneId`]: Buffer.from("1601ab", "hex"), [`string ${API}Zone::Name`]: "HiFi",
    [`int ${API}Zone::State`]: 2, [`long ${API}Zone::Position`]: 1000n, [`${API}PlayingItem ${API}Zone::Playing`]: { $ref: 20n } }));
  // What the zone names by reference, of a kind the probe doesn't list: watched all the same (the review).
  const playing = add(obj(20n, "PlayingItem", { [`string ${API}PlayingItem::Name`]: "River", [`long ${API}PlayingItem::Elapsed`]: 7n }));
  add(obj(11n, "Endpoint", { [`string ${API}Endpoint::Name`]: "HiFi DAC", [`${API}Zone ${API}Endpoint::Zone`]: { $ref: 10n },
    [`double ${API}Endpoint::Volume`]: 30.5 }));
  add(obj(12n, "RaatAudioDevice", { [`int? ${API}RaatAudioDevice::MaxBitsPerSample`]: 24, [`string ${API}RaatAudioDevice::Name`]: "DAC" }));
  // v1.9.66 (§15.1): a device with its config, for the settings read.
  add(obj(15n, "SonosAudioDevice", { [`string ${API}SonosAudioDevice::Name`]: "Stereo Fives (FIVE)",
    [`${API}AudioDeviceCommonConfig ${API}SonosAudioDevice::CommonConfig`]: { $ref: 16n } }));
  add(obj(16n, "AudioDeviceCommonConfig", { [`bool ${API}AudioDeviceCommonConfig::SupportsDspConfig`]: true }));
  add(obj(13n, "Album", { [`string ${API}Album::Title`]: "Blue" }));
  add(obj(14n, "Zone", {}, false));   // a stub: not counted, not shown
  return {
    objects, zone, playing, watchers: new Set(),
    get: (oid) => objects.get(String(oid)),
    ofType: (s) => [...objects.values()].filter((o) => o.typeName === s || o.typeName.endsWith("." + s)),
  };
}

const OFFICIAL = { zone_id: "1601ab", display_name: "HiFi", state: "playing", settings: { shuffle: false, loop: "disabled", auto_radio: true },
  now_playing: { one_line: { line1: "River" }, seek_position: 10 },
  outputs: [{ output_id: "o1", display_name: "HiFi DAC", is_muted: false, volume: { value: 30, min: 0, max: 100 } }] };

function rig(o = {}) {
  const graph = stubGraph();
  // No `g` but with o.calls: a call would throw. With it, the settings read's two calls a device, answered null.
  const calls = [];
  const session = o.calls ? { graph, g: { uncertain: () => "", call: async (oid, sig) => { calls.push([oid, sig]); return { success: true, payload: Buffer.from([0]) }; } } }
    : { graph };
  const link = { s: session, session() { return this.s; } };
  let turns = 0;
  const official = Object.assign({}, OFFICIAL, { now_playing: Object.assign({}, OFFICIAL.now_playing) });
  const zonesNow = [official].concat(o.extra || []);
  const probe = createZoneProbe({ link: o.noLink ? null : link, off: () => o.off || null, moveMs: 5,
    zones: () => zonesNow,
    inTurn: async (fn) => {
      turns++;
      // Between the two reads: the server pushes the zone's position on, and the official zone's seek moves with it.
      if (turns === 2) {
        graph.zone.fields[`long ${API}Zone::Position`] = 4000n;
        graph.playing.fields[`long ${API}PlayingItem::Elapsed`] = 10n;
        official.now_playing.seek_position = 13;
        if (o.reconnect) link.s = { graph: stubGraph() };
        // Zones listed in another order, one new (the review): seeks are paired by id, not by place.
        if (o.reorder) zonesNow.unshift({ zone_id: "new1", display_name: "New", outputs: [] });
        if (o.throwsLater) throw new Error("a member it couldn't read");
      }
      return fn();
    } });
  return { probe, graph, calls };
}

test("THE one: the zones, outputs and devices as held, each beside the official zone or output it matches — and no call", async () => {
  const out = await rig({ extra: [{ zone_id: "ffff", display_name: "Kitchen", state: "stopped", outputs: [] }] }).probe.run();
  assert.equal(out.readOnly, true);
  assert.equal(out.calls, 0);
  assert.deepEqual(out.types, { Zone: 1, Endpoint: 1, RaatAudioDevice: 1, SonosAudioDevice: 1, AudioDeviceCommonConfig: 1 },
    "a stub, or a type not asked about, counted");
  assert.equal(out.zones.length, 1);
  const z = out.zones[0];
  assert.equal(z.zoneIdHex, "1601ab");
  assert.deepEqual(z.members, { ZoneId: { bytes: 3 }, Name: "HiFi", State: 2, Position: "1000", Playing: { object: "PlayingItem", name: "River" } });
  assert.deepEqual([z.official.zone_id, z.official.state, z.official.now_playing, z.official.seek_position, z.official.matchedBy],
    ["1601ab", "playing", "River", 10, "id"]);
  assert.deepEqual(z.official.outputs, [{ display_name: "HiFi DAC", muted: false, volume: 30 }]);
  assert.deepEqual(out.unmatched.map((u) => [u.display_name, u.why]), [["Kitchen", "Rouen couldn't tell which of your server's zones is \"Kitchen\"."]]);
  assert.deepEqual(out.endpoints[0].members, { Name: "HiFi DAC", Zone: { object: "Zone", name: "HiFi" }, Volume: 30.5 });
  assert.equal(out.endpoints[0].official.output_id, "o1");
  assert.deepEqual(out.devices[0], { oid: "12", type: "RaatAudioDevice", members: { MaxBitsPerSample: 24, Name: "DAC" } });
  assert.deepEqual(out.devices.map((d) => d.type), ["RaatAudioDevice", "SonosAudioDevice", "AudioDeviceCommonConfig"]);
});

test("what moves: the members that changed in the few seconds, both values, beside the official seek positions", async () => {
  const out = await rig().probe.run();
  assert.equal(out.moves.afterMs, 5);
  assert.deepEqual(out.moves.changed, [{ object: "Zone \"HiFi\"", changed: [{ member: "Position", was: "1000", now: "4000" }] },
    { object: "PlayingItem \"River\"", changed: [{ member: "Elapsed", was: "7", now: "10" }] }],
    "a member that moved, on the zone or on what it names, not seen");
  assert.deepEqual([out.moves.watched, out.moves.more], [6, 0]);
  assert.deepEqual(out.moves.officialSeek, [{ zone_id: "1601ab", was: 10, now: 13 }]);
  const re2 = await rig({ reorder: true }).probe.run();
  assert.deepEqual(re2.moves.officialSeek, [{ zone_id: "1601ab", was: 10, now: 13 }], "a seek paired with another zone's");
  const thrown = await rig({ throwsLater: true }).probe.run();
  assert.deepEqual([thrown.moves.error, thrown.zones.length], ["The second read failed: a member it couldn't read", 1],
    "the first read lost with the second");
  const re = await rig({ reconnect: true }).probe.run();
  assert.equal(re.moves.error, "The connection changed before the second read; run the probe again.");
  assert.equal(re.zones.length, 1, "the first read lost with the second");
});

test("not run: native mode off, not connected, or a probe already running — each said", async () => {
  assert.deepEqual(await rig({ off: "Native mode is off." }).probe.run(), { error: "Native mode is off.", status: 409 });
  assert.deepEqual(await rig({ noLink: true }).probe.run(), { error: "Native mode isn't connected to your server right now.", status: 503 });
  const w = rig();
  const first = w.probe.run();
  assert.deepEqual(await w.probe.run(), { error: "A probe is already running.", status: 409 });
  assert.equal((await first).calls, 0);
});

// v1.9.66 (§15.1): the settings read and the watch, each only when asked for.
test("v1.9.66: settings=1 reads each device's settings and DSP through its config; watch logs the pushes after the rest", async () => {
  const w = rig({ calls: true });
  const graph = w.graph;
  const running = w.probe.run({ settings: true, watchMs: 40 });
  setTimeout(() => { for (const fn of graph.watchers) fn(graph.zone, { [`int ${API}Zone::State`]: 0 }, 5); }, 25);
  const out = await running;
  assert.deepEqual(w.calls.map((c) => [c[0], c[1].split("::")[1].split("(")[0]]), [[16n, "GetConfigInfo"], [16n, "GetDspConfig"]]);
  assert.equal(out.calls, 2);
  assert.deepEqual(out.settings.map((r) => [r.device, r.config]), [["Stereo Fives (FIVE)", "16"]]);
  assert.deepEqual(out.watch.pushes.map((p) => [p.object, p.kind, p.members]), [["Zone \"HiFi\"", "UPDATEOBJ", { State: 0 }]]);
  assert.equal(graph.watchers.size, 0);
  // Not asked for: no call, no watch.
  const quiet = rig();
  const q = await quiet.probe.run();
  assert.deepEqual([q.calls, q.settings, q.watch], [0, undefined, undefined]);
});
