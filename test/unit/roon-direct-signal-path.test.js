"use strict";
// ---------------------------------------------------------------------------
// v2.0.3-t15: the signal path on Now playing, read (lib/roon-direct/signal-path.js, dev/design/signal-path.md). The
// first test is the owner's read of 2026-11-10 (t14's probe, "TV Speaker", a Sonos Beam, DSP on), member for member
// as the server sent it; the others are the catalogue's names with invented values, not the server's.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { ObjectGraph } = require("../../lib/roon-direct/objects");
const { BinaryWriter } = require("../../lib/roon-direct/wire");
const { pathOf, createSignalPath, sourceFormat } = require("../../lib/roon-direct/signal-path");

const A = "Sooloos.Broker.Api.";
const put = (graph, oid, type, fields) => { graph.objects.set(String(oid), { oid: BigInt(oid), typeName: A + type, loaded: true, fields }); };
const m = (type, name) => `x ${A}${type}::${name}`;
/** A part and the element that carries it. */
function step(graph, oid, quality, kind, members) {
  const type = kind + "SignalPathElement";
  put(graph, oid + 1000, type, Object.fromEntries(Object.entries(members).map(([k, v]) => [m(type, k), v])));
  put(graph, oid, "SignalPathElement", { [m("SignalPathElement", "Quality")]: quality, [m("SignalPathElement", "UniqueId")]: oid,
    [m("SignalPathElement", kind)]: { $ref: BigInt(oid + 1000) } });
  return { $ref: BigInt(oid) };
}
/** A zone whose path holds the given elements. */
function zoneWith(graph, items, path = {}) {
  put(graph, 2, `DataList<${A}SignalPathElement>`, { $items: items });
  put(graph, 3, "SignalPath", Object.assign({ [m("SignalPath", "Elements")]: { $ref: 2n } },
    Object.fromEntries(Object.entries(path).map(([k, v]) => [m("SignalPath", k), v]))));
  put(graph, 4, "Zone", { [`System.Sooid ${A}Zone::ZoneId`]: Buffer.from("16aa", "hex"), [m("Zone", "SignalPath")]: { $ref: 3n } });
  return graph.get(4n);
}

test("THE one: the owner's Beam, DSP on, said step by step as Roon's card says it", () => {
  const g = new ObjectGraph();
  const z = zoneWith(g, [
    step(g, 80, 3, "Source", { Format: "Flac", SampleRate: 44100, BitsPerSample: 16, Channels: 2, BitRate: 616, ContentSource: 1 }),
    step(g, 125, 3, "UpgradeBitDepth", { FromBitsPerSample: 16, ToBitsPerSample: 64 }),
    step(g, 131, 4, "VolumeNormalization", { GainDb: -0.7933175113064066 }),
    step(g, 127, 4, "HeadroomGain", { GainDb: -3 }),
    step(g, 128, 4, "Crossfeed", { Description: "Bauer stereo-to-binaural" }),
    step(g, 129, 4, "ParametricEQ", { FilterCount: 5 }),
    step(g, 130, 3, "Truncate", { FromBitsPerSample: 64, ToBitsPerSample: 24 }),
    step(g, 124, 3, "Output", { OutputType: 24, Model: "BEAM" }),
  ], { Quality: 4, ProcessingSpeed: 294.5 });
  const p = pathOf(g, z);
  assert.deepEqual([p.quality, p.speed, p.clipping, p.format], ["enhanced", 294.5, false, "FLAC 44.1kHz 16-bit"]);
  assert.deepEqual(p.steps.map((s) => [s.name, s.quality, s.text]), [
    ["Source", "lossless", "FLAC 44.1kHz 16-bit · Stereo · Library"],
    ["Bit depth", "lossless", "16-bit → 64-bit"],
    ["Volume levelling", "enhanced", "−0.8 dB"],
    ["Headroom", "enhanced", "−3.0 dB"],
    ["Crossfeed", "enhanced", "Bauer stereo-to-binaural"],
    ["Parametric EQ", "enhanced", "5 filters"],
    ["Truncation", "lossless", "64-bit → 24-bit"],
    ["Output", "lossless", "BEAM · Sonos"],
  ]);
  assert.deepEqual(Object.keys(p.steps[0]), ["kind", "quality", "name", "text"], "a step says no more than the card shows");
});

test("the poly: RAAT names its device and the DAC behind it; rates converted said in kHz; a part left out dropped", () => {
  const g = new ObjectGraph();
  put(g, 900, "RaatAudioDevice", { [m("RaatAudioDevice", "VendorModel")]: "Chord Poly", [m("RaatAudioDevice", "BridgedDeviceName")]: "Chord Electronics Ltd Mojo2" });
  const z = zoneWith(g, [
    step(g, 76, 3, "Source", { Format: "Flac", SampleRate: 96000, BitsPerSample: 24, Channels: 2 }),
    step(g, 115, 4, "SampleRateConversion", { FromSampleRate: 96000, ToSampleRate: 384000 }),
    step(g, 122, 3, "Raat", { Device: { $ref: 900n } }),
    step(g, 120, 3, "Output", { OutputType: 13 }),
    step(g, 140, 3, "SpeakerSetup", { HasDistanceAdjustment: true }),
  ], { Quality: 4, ProcessingSpeed: 23.700000000000003, IsClipping: true });
  const p = pathOf(g, z);
  assert.equal(p.clipping, true);
  assert.deepEqual(p.steps.map((s) => [s.name, s.text]), [
    ["Source", "FLAC 96kHz 24-bit · Stereo"],
    ["Sample rate conversion", "96kHz → 384kHz"],
    ["RAAT", "Chord Poly → Chord Electronics Ltd Mojo2"],
    ["Output", "RAAT"],
    ["Speaker Setup", null],
  ]);
});

test("every kind the design names says its line; lossy, DSD and mono sources as Roon says them", () => {
  const g = new ObjectGraph();
  const z = zoneWith(g, [
    step(g, 10, 1, "Source", { Format: "AAC", BitRate: 256, SampleRate: 44100, Channels: 1, ContentSource: 128 }),
    step(g, 11, 4, "DigitalVolume", { GainDb: -12 }),
    step(g, 12, 4, "AnalogVolume", { GainDb: 2 }),
    step(g, 13, 4, "DsdSampleRateConversion", { FromSampleRate: 2822400, ToSampleRate: 5644800 }),
    step(g, 14, 4, "PcmToDsd", { FromSampleRate: 44100, ToSampleRate: 5644800, Modulator: "7th order" }),
    step(g, 15, 4, "ProceduralEQ", { FilterCount: 1 }),
    step(g, 16, 4, "Convolution", { TapCount: 65536 }),
    step(g, 17, 4, "CrossFade", { Milliseconds: 5000 }),
    step(g, 18, 4, "Delay", { DelayMs: 12 }),
    step(g, 19, 4, "Balance", { StringValue: "L 2 dB" }),
    step(g, 20, 3, "Dither", { SignificantBits: 24 }),
    step(g, 21, 4, "HQPlayer", { Filter: "poly-sinc-gauss", Shaper: "ASDM7", Rate: 22579200 }),
    step(g, 22, 4, "ParametricEQ", { FilterCount: 1, PresetName: "Room" }),
    step(g, 23, 2, "Output", { OutputType: 99, Model: "Mystery" }),
  ], { Quality: 1 });
  assert.deepEqual(pathOf(g, z).steps.map((s) => s.text), [
    "AAC 256kbps · Mono · TIDAL", "−12.0 dB", "+2.0 dB", "2.8MHz → 5.6MHz", "44.1kHz → 5.6MHz · 7th order", "1 filter",
    "65536 taps", "5000 ms", "12 ms", "L 2 dB", "to 24-bit", "poly-sinc-gauss · ASDM7 · 22.6MHz", "1 filter · Room",
    "Mystery",
  ], "an output type the catalogue doesn't name is left out, not guessed");
  assert.equal(pathOf(g, z).quality, "low");
  assert.equal(sourceFormat(() => undefined), null, "a source saying nothing says nothing");
  assert.equal(sourceFormat((k) => ({ Format: "DSD", SampleRate: 2822400 })[k]), "DSD 2.8MHz");
});

test("no path to show: none sent, never pushed, its elements unread, a step without a part; qualities outside the catalogue unnamed", () => {
  const g = new ObjectGraph();
  put(g, 4, "Zone", {});
  assert.equal(pathOf(g, g.get(4n)), null);
  const z = zoneWith(g, [step(g, 50, 7, "Source", { Format: "Flac" })], { Quality: 0 });
  put(g, 60, "SignalPathElement", { [m("SignalPathElement", "Quality")]: 3 });
  g.get(2n).fields.$items.push({ $ref: 60n }, { $ref: 61n });
  const p = pathOf(g, z);
  assert.deepEqual([p.quality, p.steps.length, p.steps[0].quality], [null, 1, null], "Inactive 0 and 7 not named; a bare and an unpushed element skipped");
  // An element naming another object before its part (the Broker, say): the part is what it says, not the first object.
  put(g, 70, "Broker", { [m("Broker", "Name")]: "DietPi" });
  const el = g.get(50n);
  el.fields = Object.assign({ [m("SignalPathElement", "Broker")]: { $ref: 70n } }, el.fields);
  assert.deepEqual([pathOf(g, z).steps[0].kind, pathOf(g, z).steps[0].text], ["Source", "FLAC"]);
  g.objects.delete("2");
  assert.equal(pathOf(g, z), null, "its Elements never pushed");
  g.get(3n).fields[m("SignalPath", "Elements")] = new BinaryWriter().integer(1).long(50n).toBuffer();
  g.get(3n).fields = Object.fromEntries(Object.entries(g.get(3n).fields).map(([k, v]) => [k.endsWith("::Elements") ? `System.Collections.Generic.IList<${A}SignalPathElement> ${A}SignalPath::Elements` : k, v]));
  assert.equal(pathOf(g, z).steps[0].text, "FLAC", "a list held as bytes, read");
  g.objects.delete("3");
  assert.equal(pathOf(g, z), null, "the path never pushed");
});

test("read: native mode off, no connection, a zone not held, and the zone's path found by the official id", () => {
  const g = new ObjectGraph();
  zoneWith(g, [step(g, 80, 3, "Source", { Format: "Flac", SampleRate: 44100, BitsPerSample: 16 })], { Quality: 3 });
  let on = false, session = { graph: g };
  const sp = createSignalPath({ link: { session: () => session }, on: () => on });
  assert.deepEqual(sp.read("16aa"), { native: false, why: "Native mode is off." });
  on = true; session = null;
  assert.equal(sp.read("16aa").native, false);
  session = { graph: g };
  assert.deepEqual(sp.read("beef"), { native: true, found: false, zone_id: "beef" });
  const out = sp.read("16AA");
  assert.deepEqual([out.found, out.path.quality, out.path.steps[0].text], [true, "lossless", "FLAC 44.1kHz 16-bit"]);
  assert.doesNotThrow(() => JSON.stringify(out));
});
