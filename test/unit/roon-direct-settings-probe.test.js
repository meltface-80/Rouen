"use strict";
// ---------------------------------------------------------------------------
// N3-3a, the settings probe (lib/roon-direct/settings-probe.js, v1.9.66, native-remote.md §15.1): every push to the
// zones and outputs for a while, with its kind and whether it carried the identity member; each device's settings and
// DSP read through its AudioDeviceCommonConfig and decoded by the graph's own reader. The graph is objects.js's own;
// the answers are built here, so they are not evidence of what a real server sends (the owner's run is).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { ObjectGraph, P } = require("../../lib/roon-direct/objects");
const { BinaryWriter } = require("../../lib/roon-direct/wire");
const { watchPushes, readSettings, answer, MAX_PUSHES } = require("../../lib/roon-direct/settings-probe");
const { SIG } = require("../../lib/roon-direct/methods");

const API = "Sooloos.Broker.Api.";

/** A graph with a Zone type (ZoneId, State, Name) declared, and one zone pushed. */
function graphWithZone() {
  const g = new ObjectGraph();
  g.types.set(1, { id: 1, name: API + "Zone", members: [{ name: `System.Sooid ${API}Zone::ZoneId`, propType: P.Sooid },
    { name: `Sooloos.Broker.Api.ZoneState ${API}Zone::State`, propType: P.Enum }, { name: `string ${API}Zone::Name`, propType: P.String }] });
  return g;
}
/** A push frame of the zone: its oid, its type, then (index, value) pairs. */
function zoneFrame(cmd, fields) {
  const w = new BinaryWriter().long(10n).flexInt(1);
  if (fields.zoneId) w.flexInt(1).sooid(Buffer.from("16aa", "hex"));
  if (fields.state !== undefined) w.flexInt(2).integer(fields.state);
  if (fields.name) w.flexInt(3).string(fields.name);
  w.flexInt(0);
  return { cmd, isResponse: false, body: w.toBuffer() };
}

test("objects.js tells its watchers the push's kind: PUSHOBJ 3, UPDATEOBJ 5", () => {
  const g = graphWithZone();
  const seen = [];
  g.watchers.add((o, pushed, cmd) => seen.push([cmd, Object.keys(pushed).length]));
  g.ingest(zoneFrame(3, { zoneId: true, state: 1 }));
  g.ingest(zoneFrame(5, { state: 0 }));
  assert.deepEqual(seen, [[3, 2], [5, 1]]);
});

test("THE one: the pushes while watching — kind, identity, members — the watched objects' and any new one of the probe's kinds, and the watcher gone after", async () => {
  const g = graphWithZone();
  g.types.set(2, { id: 2, name: API + "Library", members: [] });
  g.types.set(3, { id: 3, name: API + "DspConfig", members: [{ name: `bool ${API}DspConfig::IsEnabled`, propType: P.Bool }] });
  g.ingest(zoneFrame(3, { zoneId: true, state: 3, name: "Stereo Fives" }));
  const zone = g.get(10n);
  const watching = watchPushes(g, [zone], 60);
  g.ingest(zoneFrame(3, { zoneId: true, name: "Stereo Fives" }));   // whole, State left out (Playing, 0)
  g.ingest(zoneFrame(5, { state: 2 }));                               // a field alone: Paused
  g.ingest({ cmd: 3, isResponse: false, body: new BinaryWriter().long(11n).flexInt(2).flexInt(0).toBuffer() });   // not of the kinds: left out
  // A DspConfig pushed meanwhile (one read, or a zone made by grouping): caught, its identity member not known.
  g.ingest({ cmd: 3, isResponse: false, body: new BinaryWriter().long(12n).flexInt(3).flexInt(1).boolean(true).flexInt(0).toBuffer() });
  const out = await watching;
  assert.deepEqual(out.pushes.map((p) => [p.object, p.kind, p.identity, p.members]), [
    ["Zone \"Stereo Fives\"", "PUSHOBJ", true, { ZoneId: { bytes: 2 }, Name: "Stereo Fives" }],
    ["Zone \"Stereo Fives\"", "UPDATEOBJ", false, { State: 2 }],
    ["DspConfig \"12\"", "PUSHOBJ", null, { IsEnabled: true }]]);
  assert.equal(g.watchers.size, 0, "the watcher left behind");
  // At most MAX_PUSHES, the rest counted.
  const many = watchPushes(g, [zone], 60);
  for (let i = 0; i < MAX_PUSHES + 3; i++) g.ingest(zoneFrame(5, { state: i % 4 }));
  const m = await many;
  assert.deepEqual([m.pushes.length, m.more], [MAX_PUSHES, 3]);
});

/** A DspConfig object's push frame. */
const dspFrame = (oid) => ({ cmd: 3, isResponse: false, body: new BinaryWriter().long(oid).flexInt(8).flexInt(1).boolean(true).flexInt(0).toBuffer() });

test("an answer: a value decoded by the graph's reader, an object waited for as pushed with it, or its bytes when neither", async () => {
  const g = new ObjectGraph();
  g.types.set(7, { id: 7, name: API + "AudioDeviceCommonConfigInfo", members: [
    { name: `bool ${API}AudioDeviceCommonConfigInfo::SupportsOutputChannels`, propType: P.Bool },
    { name: `string ${API}AudioDeviceCommonConfigInfo::OutputChannels`, propType: P.String }] });
  const body = new BinaryWriter().flexInt(1).boolean(true).flexInt(2).string("stereo").flexInt(0).toBuffer();
  const value = new BinaryWriter().long(1n).integer(7).integer(body.length).bytes(body).toBuffer();
  assert.deepEqual(await answer(g, value, 10), { struct: "AudioDeviceCommonConfigInfo", members: { SupportsOutputChannels: true, OutputChannels: "stereo" } });
  assert.deepEqual(await answer(g, Buffer.from([0x00]), 10), { value: null }, "a null answer is a value, not bytes");
  // Bytes after the value: not taken as the value alone.
  const longer = Buffer.concat([value, Buffer.from([0x05])]);
  assert.deepEqual(await answer(g, longer, 10), { undecoded: true, why: "1 byte(s) after the value", bytes: longer.length, hex: longer.toString("hex") });
  // By reference: the DspConfig object the server pushes after its answer.
  g.types.set(8, { id: 8, name: API + "DspConfig", members: [{ name: `bool ${API}DspConfig::IsEnabled`, propType: P.Bool }] });
  const ref = (oid) => new BinaryWriter().long(oid).toBuffer();
  const later = answer(g, ref(500n), 500);
  setTimeout(() => { g.ingest(dspFrame(500n)); }, 20);
  assert.deepEqual(await later, { object: "DspConfig", oid: "500", members: { IsEnabled: true } });
  assert.deepEqual(await answer(g, ref(600n), 30), { object: "named, never pushed", oid: "600" });
  // Held from before, and not pushed since the call: what the graph held, said so.
  assert.deepEqual(await answer(g, ref(500n), 30, new Set()), { object: "DspConfig", oid: "500", members: { IsEnabled: true }, pushedWithAnswer: false });
  // An inline value of a type the server never declared: its bytes, for the design to read.
  const odd = new BinaryWriter().long(1n).integer(99).integer(1).bytes([0]).toBuffer();
  assert.deepEqual(await answer(g, odd, 10), { undecoded: true, why: null, bytes: odd.length, hex: odd.toString("hex") });
});

/** An audio device, with its config when given. */
const dev = (oid, name, cfg) => ({ oid, typeName: API + "SonosAudioDevice", loaded: true,
  fields: Object.assign({ [`string ${API}SonosAudioDevice::Name`]: name }, cfg ? { [`${API}AudioDeviceCommonConfig ${API}SonosAudioDevice::CommonConfig`]: { $ref: cfg } } : {}) });

test("each device's settings and DSP read through its config — refused and failed said per call; a device without one left out; what was sent counted", async () => {
  const g = new ObjectGraph();
  g.types.set(8, { id: 8, name: API + "DspConfig", members: [{ name: `bool ${API}DspConfig::IsEnabled`, propType: P.Bool }] });
  const calls = [];
  const s = { graph: g, g: { uncertain: () => "", call: async (oid, sig) => {
    calls.push([oid, sig]);
    if (oid === 21n && sig === SIG.dspConfig) throw new Error("no answer in 15000 ms");
    if (oid === 22n && sig === SIG.dspConfig) { g.ingest(dspFrame(700n)); return { success: true, payload: new BinaryWriter().long(700n).toBuffer() }; }
    if (sig === SIG.dspConfig) return { success: false, status: "NotSupported" };
    return { success: true, payload: Buffer.from([0x00]) };   // a null value
  } } };
  const out = await readSettings(s, [dev(1n, "Stereo Fives (FIVE)", 20n), dev(2n, "TV Speaker", 21n), dev(3n, "No config", null), dev(4n, "Kitchen", 22n)], { waitMs: 10 });
  assert.deepEqual(out.rows.map((r) => r.device), ["Stereo Fives (FIVE)", "TV Speaker", "Kitchen"]);
  assert.deepEqual(out.rows[0].dspConfig, { refused: "NotSupported" });
  assert.deepEqual(out.rows[1].dspConfig, { error: "no answer in 15000 ms" });
  assert.deepEqual(out.rows[0].configInfo, { value: null });
  assert.deepEqual(out.rows[2].dspConfig, { object: "DspConfig", oid: "700", members: { IsEnabled: true } }, "pushed with its answer");
  assert.deepEqual(calls, [[20n, SIG.configInfo], [20n, SIG.dspConfig], [21n, SIG.configInfo], [21n, SIG.dspConfig], [22n, SIG.configInfo], [22n, SIG.dspConfig]]);
  assert.equal(out.calls, 6);
  assert.equal(g.watchers.size, 0, "a call's watcher left behind");
});

test("the review: once a call goes unanswered, nothing more is sent — said skipped, not counted", async () => {
  const g = new ObjectGraph();
  let uncertain = "";
  const calls = [];
  const s = { graph: g, g: { uncertain: () => uncertain, call: async (oid, sig) => {
    calls.push([oid, sig]);
    uncertain = "no answer in 15000 ms";
    throw new Error(uncertain);
  } } };
  const out = await readSettings(s, [dev(1n, "Stereo Fives (FIVE)", 20n), dev(2n, "TV Speaker", 21n)], { waitMs: 10 });
  assert.deepEqual(calls, [[20n, SIG.configInfo]]);
  assert.equal(out.calls, 1);
  const skipped = { skipped: "An earlier call went unanswered; nothing more was sent." };
  assert.deepEqual([out.rows[0].configInfo, out.rows[0].dspConfig, out.rows[1].configInfo, out.rows[1].dspConfig],
    [{ error: "no answer in 15000 ms" }, skipped, skipped, skipped]);
});

// v1.9.66-t3 (§15.2): the DSP config whole, from what was pushed with it — no call added.
const DSP_TYPES = (g) => g.types.set(8, { id: 8, name: API + "DspConfig", members: [{ name: `bool ${API}DspConfig::IsEnabled`, propType: P.Bool },
  { name: `Sooloos.Broker.Api.DataList ${API}DspConfig::Items`, propType: P.Object }] });
const DSP_FRAME = new BinaryWriter().long(700n).flexInt(8).flexInt(1).boolean(true).flexInt(2).long(701n).flexInt(0).toBuffer();

test("THE one for t3: each device's DSP config read whole, under the server's own names — with no call more", async () => {
  const g = new ObjectGraph();
  DSP_TYPES(g);
  const put = (oid, typeName, fields) => g.objects.set(String(oid), { oid, typeName, loaded: true, fields });
  const calls = [];
  const s = { graph: g, g: { uncertain: () => "", call: async (oid, sig) => {
    calls.push(sig);
    if (sig !== SIG.dspConfig) return { success: true, payload: Buffer.from([0x00]) };
    // the chain: a list of two items, one naming a filter, the other naming the first again; the filter comes later
    put("701", "DataList<Sooloos.Broker.Api.DspConfigItem>", { $items: [{ $ref: 702n }, { $ref: 703n }], $count: 2 });
    put("702", API + "DspConfigItem", { [`string ${API}DspConfigItem::Type`]: "headroom", [`bool ${API}DspConfigItem::IsEnabled`]: true,
      [`${API}DspFilter ${API}DspConfigItem::Filter`]: { $ref: 704n } });
    put("703", API + "DspConfigItem", { [`string ${API}DspConfigItem::Type`]: "volume_leveling", [`${API}DspConfigItem ${API}DspConfigItem::Next`]: { $ref: 702n } });
    g.ingest({ cmd: 3, isResponse: false, body: DSP_FRAME });
    setTimeout(() => put("704", API + "DspFilter", { [`double ${API}DspFilter::GainDb`]: -3 }), 20);
    return { success: true, payload: new BinaryWriter().long(700n).toBuffer() };
  } } };
  const out = await readSettings(s, [dev(1n, "Stereo Fives (FIVE)", 20n)], { waitMs: 300 });
  const headroom = { object: "DspConfigItem", oid: "702", members: { Type: "headroom", IsEnabled: true,
    Filter: { object: "DspFilter", oid: "704", members: { GainDb: -3 } } } };
  assert.deepEqual(out.rows[0].dsp, { object: "DspConfig", oid: "700", members: { IsEnabled: true, Items: {
    object: "DataList<Sooloos.Broker.Api.DspConfigItem>", oid: "701", members: {}, count: 2, items: [headroom,
      { object: "DspConfigItem", oid: "703", members: { Type: "volume_leveling", Next: { object: "DspConfigItem", oid: "702", seen: true } } }] } } },
    "the filter pushed after the config is waited for; an object met twice is named, not repeated");
  assert.deepEqual(calls, [SIG.configInfo, SIG.dspConfig], "a call more than the two reads");
});

test("t3, the review: a list cut short says so, a stale config is said stale, and a fault leaves the read as it was", async () => {
  const g = new ObjectGraph();
  DSP_TYPES(g);
  const put = (oid, typeName, fields) => g.objects.set(String(oid), { oid, typeName, loaded: true, fields });
  put("701", "DataList<Sooloos.Broker.Api.DspConfigItem>", { $items: [{ $ref: 702n }], $count: -1 });
  put("702", API + "DspConfigItem", { [`string ${API}DspConfigItem::Type`]: "peq", [`${API}DspFilter ${API}DspConfigItem::Filter`]: { $ref: 704n } });
  put("704", API + "DspFilter", { [`double ${API}DspFilter::GainDb`]: 1 });
  g.ingest({ cmd: 3, isResponse: false, body: DSP_FRAME });   // held from before the call: not pushed with its answer
  const ask = (graph) => ({ graph, g: { uncertain: () => "", call: async (oid, sig) => (sig === SIG.dspConfig
    ? { success: true, payload: new BinaryWriter().long(700n).toBuffer() } : { success: false, status: "NotSupported" }) } });
  const row = (await readSettings(ask(g), [dev(1n, "TV", 20n)], { waitMs: 20 })).rows[0];
  assert.equal(row.dspConfig.pushedWithAnswer, false);
  assert.equal(row.dsp.pushedWithAnswer, false, "the graph's older copy, not said so");
  assert.equal(row.dsp.members.Items.cut, "Not all of this list arrived.");
  // a graph that throws for an object only the whole read reaches: the DSP read stands, the fault is said under dsp
  const bad = Object.create(g);
  bad.get = (oid) => { if (String(oid) === "704") throw new Error("odd object"); return g.get(oid); };
  bad.watchers = g.watchers;
  const r2 = (await readSettings(ask(bad), [dev(1n, "TV", 20n)], { waitMs: 20 })).rows[0];
  assert.equal(r2.dspConfig.object, "DspConfig");
  assert.deepEqual(r2.dsp, { error: "odd object" });
  // a refused DSP read has no config to show
  assert.equal((await readSettings({ graph: g, g: { uncertain: () => "", call: async () => ({ success: false, status: "NotSupported" }) } },
    [dev(2n, "TV", 21n)], { waitMs: 10 })).rows[0].dsp, undefined);
});
