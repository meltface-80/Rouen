"use strict";
// ---------------------------------------------------------------------------
// N3-5a (lib/roon-direct/dsp-parts.js, dsp-settings.js, v1.9.66-t12, native-remote.md §15.12): Headroom, Crossfeed and
// Sample rate conversion settings, read from each item's part and changed on it — sent once, believed only when the
// part shows it. The server here is a stand-in that answers as the owner's recording showed (each part pushed whole, a
// setting at its default left out; a preset setting its values; custom adding what can be changed), so it is not
// evidence of what a server does.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { ObjectGraph, P } = require("../../lib/roon-direct/objects");
const { BinaryWriter, BinaryReader } = require("../../lib/roon-direct/wire");
const { SIG } = require("../../lib/roon-direct/methods");
const { createZoneDsp } = require("../../lib/roon-direct/zone-dsp");
const { createDspSettings } = require("../../lib/roon-direct/dsp-settings");
const { mountRoonDirect } = require("../../lib/roon-direct/route");

const API = "Sooloos.Broker.Api.";
const ID = "16aa01";
const B = P.Bool, D = P.Double, I = P.Int, S = P.String, O = P.Object;
const TYPES = {
  1: ["Zone", [["ZoneId", P.Sooid]]],
  2: ["Endpoint", [["EndpointId", P.Sooid], ["Name", S], ["Zone", O], ["Device", O]]],
  3: ["SonosAudioDevice", [["Name", S], ["CommonConfig", O]]],
  4: ["AudioDeviceCommonConfig", [["SupportsDspConfig", B]]],
  5: ["DspConfig", [["BeforeItems", O]]],
  6: ["DspConfigItem", [["SupportsSetEnabled", B], ["IsEnabled", B], ["HeadroomAdjustment", O], ["BS2B", O], ["SampleRateConversion", O]]],
  7: ["HeadroomAdjustmentItem", [["SupportsClippingIndicator", B], ["ClippingIndicator", B], ["SupportsGainDb", B], ["MinGainDb", D], ["GainDbStep", D], ["GainDb", D]]],
  8: ["BS2BItem", [["SupportsPreset", B], ["SupportedPresets", O], ["Preset", S], ["SupportsCutFrequency", B], ["MinCutFrequency", I], ["MaxCutFrequency", I],
    ["CutFrequency", I], ["SupportsFeedLevelDb", B], ["MinFeedLevelDb", D], ["MaxFeedLevelDb", D], ["FeedLevelDb", D]]],
  9: ["SampleRateConversionItem", [["SupportsSRCFilterType", B], ["SupportedSRCFilterType", O], ["SRCFilterType", S], ["SupportsSampleRateConversionMode", B],
    ["SupportedSampleRateConversionModes", O], ["SampleRateConversionMode", S], ["SupportsSampleRateConversionRules", B], ["SampleRateConversionRules", O],
    ["SupportedDSDModulator", O], ["DSDModulator", S], ["SupportsDsdToPcmFilter", B], ["DsdToPcmFilter", S], ["SupportedDsdToPcmFilterValues", O]]],
  10: ["SampleRateConversionRule", [["InputSampleRate", I], ["SupportedOutputSampleRates", O], ["OutputSampleRate", I]]],
};
const PRESETS = { default: [700, 4.5], cmoy: [700, 6], meier: [650, 9.5] };

/**
 * A stand-in server: TV Speaker's output (20) and its DspConfig (50), whose BeforeItems (51) hold Headroom (61, part
 * 71), Crossfeed (62, part 72) and Sample rate conversion (63, part 73, rules 81 and 82 in list 83). Calls recorded.
 */
function server(o = {}) {
  const g = new ObjectGraph();
  for (const [id, [name, members]] of Object.entries(TYPES)) {
    g.types.set(Number(id), { id: Number(id), name: API + name, members: members.map(([n, pt]) => ({ name: `x ${API}${name}::${n}`, propType: pt })) });
  }
  // what each part holds now; a value at its default (0, false, null) is left out of the push
  const st = { gain: -3, clipping: false, preset: "default", cut: 700, feed: 4.5, mode: "none", filter: "minimum_phase", modulator: "clans_order5",
    dsdToPcm: "lowpass_30khz", rules: { 81: null, 82: null } };
  const calls = [];
  const push = (oid, tid, vals) => {
    const [, members] = TYPES[tid];
    const w = new BinaryWriter().long(BigInt(oid)).flexInt(tid);
    members.forEach(([n, pt], i) => {
      const v = vals[n];
      if (v === undefined || v === null || v === false || v === 0) return;
      w.flexInt(i + 1);
      if (pt === B) w.boolean(v); else if (pt === D) w.double(v); else if (pt === I) w.integer(v); else if (pt === S) w.string(v); else if (pt === O) w.long(BigInt(v));
      else if (pt === P.Sooid) w.sooid(v);
    });
    g.ingest({ cmd: 3, isResponse: false, body: w.flexInt(0).toBuffer() });
  };
  const list = (oid, items) => g.objects.set(String(oid), { oid: BigInt(oid), typeName: `${API}DataList<x>`, loaded: true, fields: { $count: items.length, $items: items } });
  const pushHead = () => push(71, 7, { SupportsClippingIndicator: true, ClippingIndicator: st.clipping, SupportsGainDb: true, MinGainDb: -30, GainDbStep: 0.1, GainDb: st.gain });
  const pushBs2b = () => push(72, 8, { SupportsPreset: true, SupportedPresets: 91, Preset: st.preset, SupportsCutFrequency: st.preset === "custom",
    MinCutFrequency: 300, MaxCutFrequency: 2000, CutFrequency: st.cut, SupportsFeedLevelDb: st.preset === "custom", MinFeedLevelDb: 1, MaxFeedLevelDb: 15, FeedLevelDb: st.feed });
  const pushSrc = () => push(73, 9, { SupportsSRCFilterType: true, SupportedSRCFilterType: 92, SRCFilterType: st.filter, SupportsSampleRateConversionMode: true,
    SupportedSampleRateConversionModes: 93, SampleRateConversionMode: st.mode, SupportsSampleRateConversionRules: st.mode === "custom", SampleRateConversionRules: 83,
    SupportedDSDModulator: 94, DSDModulator: st.modulator, SupportsDsdToPcmFilter: true, DsdToPcmFilter: st.dsdToPcm, SupportedDsdToPcmFilterValues: 95 });
  const pushRule = (oid) => push(oid, 10, { InputSampleRate: oid === 81 ? 44100 : 48000, SupportedOutputSampleRates: 96, OutputSampleRate: st.rules[oid] });
  let pushed = false;
  const pushDsp = () => {
    for (const [oid, items] of [[91, ["default", "cmoy", "meier", "custom"]], [92, ["linear_phase", "minimum_phase", "linear_phase_smooth", "minimum_phase_smooth"]],
      [93, ["none", "max_sample_rate", "custom"]], [94, ["order5", "clans_order5"]], [95, ["lowpass_24khz", "lowpass_30khz", "lowpass_50khz", "none"]], [96, [44100, 48000]],
      [83, o.fewerRules ? [{ $ref: 81n }] : [{ $ref: 81n }, { $ref: 82n }]], [51, [{ $ref: 61n }, { $ref: 62n }, { $ref: 63n }]]]) list(oid, items);
    if (o.fewerRules) g.objects.get("83").fields.$count = 2;   // a list cut short: one of its two
    pushHead(); pushBs2b(); pushSrc(); pushRule(81); pushRule(82);
    push(61, 6, { SupportsSetEnabled: true, HeadroomAdjustment: 71 });
    push(62, 6, { SupportsSetEnabled: true, BS2B: 72 });
    push(63, 6, { SupportsSetEnabled: true, SampleRateConversion: 73 });
    push(50, 5, { BeforeItems: 51 });
  };
  push(10, 1, { ZoneId: Buffer.from(ID, "hex") });
  push(40, 4, { SupportsDspConfig: true });
  push(30, 3, { Name: "TV Speaker (BEAM)", CommonConfig: 40 });
  push(20, 2, { EndpointId: Buffer.from("e1", "hex"), Name: "TV Speaker", Zone: 10, Device: 30 });
  const later = (fn) => { if (!o.deaf) setTimeout(fn, 5); };
  const s = { graph: g, g: {
    uncertain: () => "",
    callNoReply() { throw new Error("nothing here is sent without an answer"); },
    async call(oid, sig, args) {
      calls.push([String(oid), sig.slice(sig.indexOf("::") + 2, sig.indexOf("(")), args.toString("hex")]);
      if (sig === SIG.dspConfig) {
        if (!pushed) { pushed = true; pushDsp(); }
        return { success: true, payload: new BinaryWriter().long(50n).toBuffer() };
      }
      if (o.refuse) return { success: false, status: "NotSupported" };
      const r = new BinaryReader(args);
      const then = {
        [SIG.dspHeadroomGain]: () => { st.gain = r.double(); return pushHead; },
        [SIG.dspHeadroomClipping]: () => { st.clipping = r.boolean(); return pushHead; },
        [SIG.dspCrossfeedPreset]: () => { st.preset = r.string(); if (PRESETS[st.preset]) [st.cut, st.feed] = PRESETS[st.preset]; return pushBs2b; },
        [SIG.dspCrossfeedCut]: () => { st.cut = r.integer(); return pushBs2b; },
        [SIG.dspCrossfeedFeed]: () => { st.feed = r.double(); return pushBs2b; },
        [SIG.dspSrcMode]: () => { st.mode = r.string(); return pushSrc; },
        [SIG.dspSrcFilter]: () => { st.filter = r.string(); return pushSrc; },
        [SIG.dspSrcModulator]: () => { st.modulator = r.string(); return pushSrc; },
        [SIG.dspSrcDsdToPcm]: () => { st.dsdToPcm = r.string(); return pushSrc; },
        [SIG.dspSrcRule]: () => { const v = r.optionalInteger(); st.rules[Number(oid)] = v; return () => pushRule(Number(oid)); },
      }[sig];
      if (!then) throw new Error("not this server's call: " + sig);
      const pushIt = then();
      later(pushIt);
      return { success: true, payload: Buffer.from([0x00]) };
    },
  } };
  return { s, st, calls, g };
}
const deps = (s, extra = {}) => Object.assign({ link: { session: () => s }, inTurn: (fn) => fn(), on: () => true, waitMs: 200, pollMs: 5, heldMs: 60 }, extra);
const both = (s, extra) => { const zoneDsp = createZoneDsp(deps(s, extra)); return { zoneDsp, dsp: createDspSettings(Object.assign(deps(s, extra), { zoneDsp })) }; };
const sets = (calls) => calls.filter((x) => x[1] !== "GetDspConfig").map((x) => x.join(" "));
const dbl = (v) => { const b = Buffer.alloc(8); b.writeDoubleLE(v, 0); return b.toString("hex"); };

test("THE one: each setting read from its part, changed as MUSE changes it, and seen — a default left out read as such", async () => {
  const { s, calls, g } = server();
  const { zoneDsp, dsp } = both(s);
  const items = (await zoneDsp.read(ID)).outputs[0].items;
  assert.deepEqual(items.map((i) => i.settings.kind), ["headroom", "crossfeed", "src"]);
  assert.deepEqual(items[0].settings, { kind: "headroom", part: "71", gain: -3, min: -30, max: 0, canGain: true, clipping: false, canClipping: true });
  assert.deepEqual([items[1].settings.preset, items[1].settings.presets, items[1].settings.canCut], ["default", ["default", "cmoy", "meier", "custom"], false]);
  assert.deepEqual([items[2].settings.mode, items[2].settings.canRules, items[2].settings.rulesComplete, items[2].settings.rules], ["none", false, false, []]);
  // Headroom: −6, then 0, which the part leaves out (gone from the graph, read as 0 dB), and the clipping indicator
  assert.equal((await dsp.set(ID, "61", "headroom.gain", -6)).item.settings.gain, -6);
  const zero = await dsp.set(ID, "61", "headroom.gain", 0);
  assert.deepEqual([zero.seen, zero.item.settings.gain], [true, 0]);
  assert.equal(Object.keys(g.get(71n).fields).some((k) => k.endsWith("::GainDb")), false, "the whole part's gain left out: 0, not −6 kept");
  assert.equal((await dsp.set(ID, "61", "headroom.clipping", true)).item.settings.clipping, true);
  // Crossfeed: a preset sets its values; cut and feed only in custom
  const cmoy = await dsp.set(ID, "62", "crossfeed.preset", "cmoy");
  assert.deepEqual([cmoy.item.settings.cut, cmoy.item.settings.feed, cmoy.item.settings.canCut], [700, 6, false]);
  assert.match((await dsp.set(ID, "62", "crossfeed.cut", 660)).notSent, /custom preset only/);
  assert.equal((await dsp.set(ID, "62", "crossfeed.preset", "custom")).item.settings.canCut, true);
  assert.equal((await dsp.set(ID, "62", "crossfeed.cut", 660)).item.settings.cut, 660);
  assert.equal((await dsp.set(ID, "62", "crossfeed.feed", 9.1)).item.settings.feed, 9.1);
  // Sample rate conversion: custom lists the rules; a rule to 48 kHz, then back to the input's own rate (null)
  const custom = await dsp.set(ID, "63", "src.mode", "custom");
  assert.deepEqual(custom.item.settings.rules, [{ id: "81", input: 44100, output: null, outputs: [44100, 48000] }, { id: "82", input: 48000, output: null, outputs: [44100, 48000] }]);
  assert.equal((await dsp.set(ID, "63", "src.rule", 48000, "81")).item.settings.rules[0].output, 48000);
  assert.equal((await dsp.set(ID, "63", "src.rule", null, "81")).item.settings.rules[0].output, null);
  assert.equal((await dsp.set(ID, "63", "src.filter", "linear_phase")).item.settings.filter, "linear_phase");
  assert.equal((await dsp.set(ID, "63", "src.dsdToPcm", "lowpass_50khz")).item.settings.dsdToPcm, "lowpass_50khz");
  // each on its own part or rule, once, as the catalogue says; a string as the wire writes one, a nullable int as §15.7's
  const str = (v) => new BinaryWriter().string(v).toBuffer().toString("hex");
  assert.deepEqual(sets(calls), [`71 SetGainDb ${dbl(-6)}`, `71 SetGainDb ${dbl(0)}`, "71 SetClippingIndicator 01", `72 SetPreset ${str("cmoy")}`,
    `72 SetPreset ${str("custom")}`, `72 SetCutFrequency ${new BinaryWriter().integer(660).toBuffer().toString("hex")}`, `72 SetFeedLevelDb ${dbl(9.1)}`,
    `73 SetSampleRateConversionMode ${str("custom")}`, `81 SetOutputSampleRate 01${new BinaryWriter().integer(48000).toBuffer().toString("hex")}`,
    "81 SetOutputSampleRate 00", `73 SetSRCFilterType ${str("linear_phase")}`, `73 SetDsdToPcmFilter ${str("lowpass_50khz")}`]);
});

test("only what the part allows is sent: bounds, the 0.1 grid, the server's lists, its own part and rules", async () => {
  const { s, calls } = server();
  const { zoneDsp, dsp } = both(s);
  await zoneDsp.read(ID);
  for (const [item, setting, value, rule, why] of [
    ["61", "headroom.gain", 1, undefined, /−?-?30 to 0 dB/], ["61", "headroom.gain", -31, undefined, /to 0 dB/], ["61", "headroom.gain", -6.05, undefined, /to 0 dB/],
    ["61", "headroom.gain", "x", undefined, /to 0 dB/], ["61", "headroom.clipping", 1, undefined, /On or off/],
    ["62", "crossfeed.preset", "loud", undefined, /presets/], ["63", "src.mode", "fast", undefined, /modes/], ["63", "src.filter", null, undefined, /filters/],
    ["63", "src.rule", 48000, "81", /custom mode only/], ["61", "crossfeed.preset", "cmoy", undefined, /no such setting/],
    ["61", "nope", 1, undefined, /Which setting/], ["61", "toString", 1, undefined, /Which setting/], ["99", "headroom.gain", -6, undefined, /isn't one of this zone's/],
    ["x", "headroom.gain", -6, undefined, /Which DSP item/], ["63", "src.rule", 48000, "x", /Which sample rate/]]) {
    assert.match((await dsp.set(ID, item, setting, value, rule)).notSent, why, `${setting} ${value}`);
  }
  await dsp.set(ID, "63", "src.mode", "custom");
  assert.match((await dsp.set(ID, "63", "src.rule", 96000, "81")).notSent, /rates for it/);
  assert.match((await dsp.set(ID, "63", "src.rule", 48000, "61")).notSent, /custom mode only/, "not a rule of its own");
  assert.deepEqual(sets(calls), [`73 SetSampleRateConversionMode ${new BinaryWriter().string("custom").toBuffer().toString("hex")}`], "nothing else sent");
});

test("the review: custom is believed only with all its rules held; a list of rules cut short is none of them, said", async () => {
  const short = server({ fewerRules: true });
  const { zoneDsp, dsp } = both(short.s);
  await zoneDsp.read(ID);
  const r = await dsp.set(ID, "63", "src.mode", "custom");
  assert.equal(r.seen, false, "the mode came, its rules didn't all: not shown as custom with some of them");
  const st = (await zoneDsp.read(ID)).outputs[0].items[2].settings;
  assert.deepEqual([st.mode, st.canRules, st.rulesComplete, st.rules], ["custom", true, false, []]);
  assert.match((await dsp.set(ID, "63", "src.rule", 48000, "81")).notSent, /custom mode only/, "no rule offered, none sent");
});

test("not shown in time: said, never sent again; refused or off: said, nothing changed", async () => {
  const deaf = server({ deaf: true });
  const d = both(deaf.s);
  const r = await d.dsp.set(ID, "61", "headroom.gain", -6);
  assert.deepEqual([r.seen, /the item didn't show it/.test(r.why)], [false, true]);
  assert.equal(sets(deaf.calls).length, 1, "sent once");
  assert.match((await both(server({ refuse: true }).s).dsp.set(ID, "61", "headroom.gain", -6)).notSent, /refused it \(NotSupported\)/);
  assert.deepEqual(await both(server().s, { on: () => false }).dsp.set(ID, "61", "headroom.gain", -6), { notSent: "Native mode is off." });
});

test("the graph: a part pushed with its marker is whole; without it, laid over what is held", () => {
  const { g } = server();
  const f = (tid, put) => { const w = new BinaryWriter().long(75n).flexInt(tid); put(w); return { cmd: 5, isResponse: false, body: w.flexInt(0).toBuffer() }; };
  g.ingest(f(7, (w) => w.flexInt(4).double(-30).flexInt(6).double(-6)));
  g.ingest(f(7, (w) => w.flexInt(4).double(-30)));
  assert.equal(Object.keys(g.get(75n).fields).some((k) => k.endsWith("::GainDb")), false, "MinGainDb carried: whole, the gain left out is 0");
  g.ingest(f(7, (w) => w.flexInt(6).double(-9)));
  g.ingest(f(7, (w) => w.flexInt(2).boolean(true)));
  assert.equal(Object.keys(g.get(75n).fields).some((k) => k.endsWith("::GainDb")), true, "no marker: merged");
});

test("the route: 200 seen, 409 sent and not seen, 503 not sent, 400 refused", async () => {
  const routes = {};
  const answers = { seen: { seen: true, item: {} }, not: { seen: false, why: "x" }, none: { notSent: "y" } };
  let next = "seen";
  const asked = [];
  mountRoonDirect({ get: (p, h) => { routes["GET " + p] = h; }, post: (p, h) => { routes["POST " + p] = h; } }, /** @type {any} */ ({
    status: () => ({}), unmatched: () => [], turnOn() {}, turnOff() {}, setProfile: () => ({}),
    dspSettings: { set: async (...a) => (asked.push(a), answers[next]) } }));
  const call = async (body) => { const res = { code: 200, body: null, set() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes["POST /api/roon/zone-dsp/setting"]({ body }, res); return res.code; };
  for (const [k, code] of [["seen", 200], ["not", 409], ["none", 503]]) {
    next = k;
    assert.equal(await call({ zone_id: ID, item: "61", setting: "headroom.gain", value: -6 }), code, k);
  }
  assert.equal(await call({ zone_id: ID, item: "63", setting: "src.rule", value: null, rule: "81" }), 503);
  for (const body of [{ zone_id: "zz", item: "61", setting: "headroom.gain", value: -6 }, { zone_id: ID, item: 61, setting: "headroom.gain", value: -6 },
    { zone_id: ID, item: "61", setting: 5, value: -6 }, { zone_id: ID, item: "61", setting: "headroom.gain", value: {} },
    { zone_id: ID, item: "61", setting: "headroom.gain" }, { zone_id: ID, item: "61", setting: "headroom.gain", value: Infinity },
    { zone_id: ID, item: "63", setting: "src.rule", value: 48000, rule: 81 }, { zone_id: ID, item: "61", setting: "x".repeat(33), value: 1 }]) {
    assert.equal(await call(body), 400, JSON.stringify(body));
  }
  assert.deepEqual(asked.map((a) => a.slice(1)), [["61", "headroom.gain", -6, undefined], ["61", "headroom.gain", -6, undefined], ["61", "headroom.gain", -6, undefined],
    ["63", "src.rule", null, "81"]]);
});
