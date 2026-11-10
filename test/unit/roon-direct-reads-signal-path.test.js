"use strict";
// ---------------------------------------------------------------------------
// v2.0.3-t14: the reads probe says a zone's signal path step by step (lib/roon-direct/reads-probe.js signalPathOf,
// dev/design/native-remote.md §16.7). The owner's reads of 2026-11-10 ("poly", a Chord Poly over RAAT) found the
// Zone's SignalPath with its Elements — 3 plain, then 10 with DSP on — but each element's part (Source, Raat, Output,
// SampleRateConversion, …) said by its type alone: the whole zone stops four levels down, at the part. The shape here
// is the one those reads showed (a SignalPath object, its Elements a list object of SignalPathElement objects, each
// naming one part object); the members inside the parts are the catalogue's names with invented values, not the server's.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { ObjectGraph } = require("../../lib/roon-direct/objects");
const { signalPathOf, createReadsProbe } = require("../../lib/roon-direct/reads-probe");
const { whole } = require("../../lib/roon-direct/settings-probe");
const { BinaryWriter } = require("../../lib/roon-direct/wire");

const A = "Sooloos.Broker.Api.";
const put = (graph, oid, type, fields) => { graph.objects.set(String(oid), { oid: BigInt(oid), typeName: A + type, loaded: true, fields }); };
const m = (type, name) => `x ${A}${type}::${name}`;
/** An element: its quality and id, and the one part it carries, by reference. */
const element = (graph, oid, quality, part, partOid) => put(graph, oid, "SignalPathElement",
  { [m("SignalPathElement", "Quality")]: quality, [m("SignalPathElement", "UniqueId")]: oid, [m("SignalPathElement", part)]: { $ref: BigInt(partOid) } });

/** The zone "poly" with DSP on, as the owner's third read held it, shortened to four steps. */
function rig() {
  const graph = new ObjectGraph();
  put(graph, 500, "SourceSignalPathElement", { [m("SourceSignalPathElement", "Format")]: "FLAC", [m("SourceSignalPathElement", "SampleRate")]: 96000,
    [m("SourceSignalPathElement", "BitsPerSample")]: 24, [m("SourceSignalPathElement", "Channels")]: 2 });
  put(graph, 501, "SampleRateConversionSignalPathElement", { [m("SampleRateConversionSignalPathElement", "FromSampleRate")]: 96000,
    [m("SampleRateConversionSignalPathElement", "ToSampleRate")]: 384000 });
  put(graph, 510, "RaatAudioDevice", { [m("RaatAudioDevice", "Vendor")]: "Chord", [m("RaatAudioDevice", "Model")]: "Poly",
    [m("RaatAudioDevice", "BridgedDeviceName")]: "Chord Electronics Ltd Mojo2" });
  put(graph, 502, "RaatSignalPathElement", { [m("RaatSignalPathElement", "Device")]: { $ref: 510n } });
  put(graph, 503, "OutputSignalPathElement", { [m("OutputSignalPathElement", "OutputType")]: 13, [m("OutputSignalPathElement", "Model")]: "Poly" });
  element(graph, 76, 3, "Source", 500);
  element(graph, 115, 4, "SampleRateConversion", 501);
  element(graph, 122, 3, "Raat", 502);
  element(graph, 120, 3, "Output", 503);
  put(graph, 403, "DataList<Sooloos.Broker.Api.SignalPathElement>", { $items: [76n, 115n, 122n, 120n].map(($ref) => ({ $ref })) });
  put(graph, 402, "SignalPath", { [m("SignalPath", "Quality")]: 4, [m("SignalPath", "Elements")]: { $ref: 403n },
    [m("SignalPath", "ProcessingSpeed")]: 23.7 });
  put(graph, 404, "Zone", { [`string ${A}Zone::Name`]: "poly", [m("Zone", "SignalPath")]: { $ref: 402n } });
  return { graph, zone: graph.get(404n) };
}

test("THE one: each step said in full — its part's members, and an object the part names whole", () => {
  const { graph, zone } = rig();
  // What the reads of 2026-11-10 got, and why: the zone whole stops at the part, its type alone.
  const stops = whole(graph, { $ref: 404n }, new Set()).members.SignalPath.members.Elements.items[0].members.Source;
  assert.equal(stops.members, undefined, "the zone whole says the part by its type alone (the fault this read is for)");
  const out = signalPathOf(graph, zone);
  assert.deepEqual([out.oid, out.count, out.path.Quality, out.path.ProcessingSpeed], ["402", 4, 4, 23.7], "the path's own values");
  assert.equal(out.path.Elements, undefined, "the elements said once, below, not in the path's own values too");
  const [source, src, raat, output] = out.elements;
  assert.deepEqual([source.object, source.members.Quality, source.members.UniqueId], ["SignalPathElement", 3, 76]);
  assert.deepEqual([source.members.Source.object, source.members.Source.members.Format, source.members.Source.members.SampleRate,
    source.members.Source.members.BitsPerSample], ["SourceSignalPathElement", "FLAC", 96000, 24], "the source's format, member by member");
  assert.deepEqual([src.members.SampleRateConversion.members.FromSampleRate, src.members.SampleRateConversion.members.ToSampleRate], [96000, 384000]);
  assert.deepEqual([raat.members.Raat.members.Device.object, raat.members.Raat.members.Device.members.BridgedDeviceName],
    ["RaatAudioDevice", "Chord Electronics Ltd Mojo2"], "the device a RAAT step names, whole");
  assert.deepEqual([output.members.Output.members.OutputType, output.members.Output.members.Model], [13, "Poly"]);
});

test("the elements a list held as bytes are read too; past twenty, counted", () => {
  const { graph, zone } = rig();
  // As bytes (a LengthPrefixed list of references), the form the catalogue's IList members come in elsewhere.
  const sp = graph.get(402n).fields;
  const asList = `System.Collections.Generic.IList<${A}SignalPathElement> ${A}SignalPath::Elements`;
  delete sp[m("SignalPath", "Elements")];
  sp[asList] = new BinaryWriter().integer(2).long(76n).long(122n).toBuffer();
  const bytes = signalPathOf(graph, zone);
  assert.deepEqual([bytes.count, bytes.elements[1].members.Raat.members.Device.members.Model], [2, "Poly"]);
  assert.equal(bytes.cut, undefined);
  sp[asList] = new BinaryWriter().integer(3).long(76n).long(122n).toBuffer();
  assert.equal(signalPathOf(graph, zone).cut, "Not all of the elements arrived.", "bytes cut short, said so");
  delete sp[asList];
  sp[m("SignalPath", "Elements")] = { $ref: 403n };
  const list = graph.get(403n).fields.$items;
  // Twenty-two steps: the four, then eighteen more of the source's kind.
  for (let i = 0; i < 18; i++) { element(graph, 600 + i, 3, "Source", 500); list.push({ $ref: BigInt(600 + i) }); }
  const out = signalPathOf(graph, zone);
  assert.deepEqual([out.count, out.more, out.elements.length], [22, 2, 20]);
});

test("not there, said so: no SignalPath, one never pushed, Elements missing or a list cut short", () => {
  const { graph, zone } = rig();
  const bare = { oid: 1n, typeName: A + "Zone", loaded: true, fields: { [`string ${A}Zone::Name`]: "Kitchen" } };
  assert.match(signalPathOf(graph, bare).skipped, /without a SignalPath/);
  graph.get(403n).fields.$count = -1;
  assert.equal(signalPathOf(graph, zone).cut, "Not all of the elements arrived.");
  delete graph.get(402n).fields[m("SignalPath", "Elements")];
  assert.match(signalPathOf(graph, zone).elements.skipped, /without Elements/);
  graph.objects.delete("402");
  assert.deepEqual(signalPathOf(graph, zone), { skipped: "The zone's SignalPath was named but never pushed.", oid: "402" });
});

test("the read: the zone matched carries its signal path beside the zone whole", async () => {
  const { graph } = rig();
  graph.get(404n).fields[`System.Sooid ${A}Zone::ZoneId`] = Buffer.from("16aa", "hex");
  const s = { graph, root: { library: { oid: 3n }, profiles: [] }, keepalive: () => ({ sent: 1, answered: 1, missed: 0 }),
    g: { uncertain: () => null, call: async () => ({ success: false, status: "InvalidArguments" }) } };
  const probe = createReadsProbe({ link: { session: () => s }, inTurn: (fn) => fn(), off: () => null, known: () => new Map(),
    keyOf: (t, a) => `${t}||${a}`, profile: () => null, albumWaitMs: 10,
    zones: () => [{ zone_id: "16aa", display_name: "poly", state: "playing" }] });
  const out = await probe.run({});
  assert.equal(out.zone.matchedBy, "id");
  assert.equal(out.zone.signalPath.count, 4);
  assert.equal(out.zone.signalPath.elements[2].members.Raat.members.Device.members.Vendor, "Chord");
  assert.equal(out.zone.whole.object, "Zone", "the zone whole still said beside it");
});

test("the review's: a struct inside a step said in full (an EQ's bands), not by its type; every read survives JSON", () => {
  const { graph, zone } = rig();
  // A parametric EQ step whose part holds its spec inline: a struct, its bands a list of structs (invented members).
  const band = (i) => ({ $type: A + "PEQBand", [m("PEQBand", "Frequency")]: 100 * (i + 1), [m("PEQBand", "GainDb")]: i === 0 ? -Infinity : -1.5 });
  put(graph, 520, "ParametricEQSignalPathElement", { [m("ParametricEQSignalPathElement", "PresetName")]: "Room",
    [m("ParametricEQSignalPathElement", "Spec")]: { $type: A + "PEQSpec", [m("PEQSpec", "Bands")]: Array.from({ length: 40 }, (_, i) => band(i)) } });
  element(graph, 117, 4, "ParametricEQ", 520);
  graph.get(403n).fields.$items.splice(2, 0, { $ref: 117n });
  graph.get(402n).fields[m("SignalPath", "UniqueId")] = 1n << 70n;
  const out = signalPathOf(graph, zone);
  const peq = out.elements[2].members.ParametricEQ;
  assert.equal(peq.members.PresetName, "Room");
  const bands = peq.members.Spec.Bands;
  assert.deepEqual([bands[1].struct === undefined, bands[1].Frequency, bands[1].GainDb], [true, 200, -1.5], "a band's own members, not its type alone");
  assert.equal(bands[0].GainDb, "-Infinity", "a gain JSON can't hold, said as text, not null");
  assert.equal(bands.length, 33, "bounded: 32 bands, then how many more");
  assert.doesNotThrow(() => JSON.stringify(out), "no BigInt reaches the answer (the route sends it as JSON)");
  assert.equal(JSON.parse(JSON.stringify(out)).path.UniqueId, String(1n << 70n));
});

test("the review's: each way the elements can't be read, said apart; a list held as bytes and cut short says how many it declared", () => {
  const { graph, zone } = rig();
  const sp = graph.get(402n).fields, key = m("SignalPath", "Elements");
  graph.objects.delete("403");
  assert.deepEqual(signalPathOf(graph, zone).elements, { skipped: "Its Elements list was named but never pushed.", oid: "403" });
  sp[key] = [1, 2];
  assert.deepEqual(signalPathOf(graph, zone).elements, { skipped: "Its Elements came in a form not read here.", form: "object" });
  delete sp[key];
  const asList = `System.Collections.Generic.IList<${A}SignalPathElement> ${A}SignalPath::Elements`;
  sp[asList] = new BinaryWriter().integer(3).long(76n).long(122n).toBuffer();
  const cut = signalPathOf(graph, zone);
  assert.deepEqual([cut.declared, cut.cut], [3, "Not all of the elements arrived."], "cut short: how many it declared said beside what was read");
  const notRef = { oid: 9n, typeName: A + "Zone", loaded: true, fields: { [m("Zone", "SignalPath")]: Buffer.from([1]) } };
  assert.match(signalPathOf(graph, notRef).skipped, /wasn't sent by reference/);
  // A step never pushed, said so with its oid; a part not a signal path part (an object named), whole as before.
  sp[asList] = new BinaryWriter().integer(1).long(999n).toBuffer();
  assert.deepEqual(signalPathOf(graph, zone).elements[0], { object: "named, never pushed", oid: "999" });
});
