"use strict";
// ---------------------------------------------------------------------------
// t3 (lib/roon-direct/edit-info.js, v1.9.67-t3, dev/design/catalogue.md §4):
// what Roon holds of a few albums' catalogue numbers, labels and kinds, read
// once by hand over native mode's connection, end to end against the fake
// server (test/lib/fake-roon-edit-info.js), which reads the one argument
// strictly and answers by value. The fake is not evidence of how the real
// server answers, nor of how it declares the Edit*Info structs: the probe
// exists to find that out.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createStage1 } = require("../../lib/roon-direct/stage1");
const { createLink } = require("../../lib/roon-direct/link");
const { readAlbumsOn } = require("../../lib/roon-direct/albums");
const { readAnswer, layers, editInfoArgs } = require("../../lib/roon-direct/edit-info");
const { ObjectGraph } = require("../../lib/roon-direct/objects");
const { ALLOWED, SIG } = require("../../lib/roon-direct/methods");
const { BinaryReader, BinaryWriter } = require("../../lib/roon-direct/wire");
const { startFakeCore } = require("../lib/fake-roon-core");
const { dotnetGuidBytes } = require("../../lib/roon-direct/brokerid");
const { CORE_ID, LIBRARY } = require("../lib/roon-direct-fixtures");

const keyOf = (title, artist) => (title ? `${title.toLowerCase()}||${artist.toLowerCase()}` : null);
const until = async (fn) => { for (let i = 0; i < 250 && !fn(); i++) await new Promise((r) => { setTimeout(r, 20); }); return fn(); };
// The owner's case: a main release with a number the file's tag and the service disagree on; a live compilation
// (Roon's counts: Live and Compilation are flags beside Type); an album Roon knows nothing of.
const EDIT = [
  { type: 0, live: false, compilation: false, labels: ["Columbia"], metadataLabels: ["Columbia", "Legacy"], catno: "CK 64935", localCatno: "CS 8163" },
  { type: 0, live: true, compilation: true, bootleg: false, labels: ["Reprise"], catno: "none" },
];
const RELEASE = { "kind of blue": { label: "Columbia", catno: "CS 8163", type: "album", src: "file" } };

async function rig(t, faults, o = {}) {
  const albums = LIBRARY.map((a) => Object.assign({}, a));
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums, editInfo: EDIT, faults: Object.assign({ sentOnce: true }, faults) });
  let s1 = null;
  const reads = [];
  const link = createLink({ core: () => ({ host: "127.0.0.1", coreId: CORE_ID }), port: core.port, timeoutMs: 1500,
    settleMs: 800, retryFirstMs: 100, onUp: () => s1.linkUp() });
  s1 = createStage1({
    settings: { load: () => null, save() {} }, cache: { read: () => null, write() {}, remove() {} },
    core: () => ({ host: "127.0.0.1", coreId: CORE_ID, coreVersion: "2.0" }), rouenVersion: "1.9.67-t3",
    records: () => [], keyOf, link, minGapMs: 0, release: (title) => RELEASE[title.toLowerCase()] || null,
    read: async (s, ro) => { const r = await readAlbumsOn(s, Object.assign({ timeoutMs: 1000 }, ro)); reads.push(r.ok); return r; },
  });
  t.after(async () => { s1.turnOff(); await core.close(); });
  if (o.off) return { core, s1 };
  s1.turnOn();
  assert.ok(await until(() => reads.length === 1 && s1.albums()), "the library was never read");
  return { core, s1 };
}

test("THE one for t3: a few albums' edit info, each value with its layers, beside what Rouen holds — one read, nothing written", async (t) => {
  const w = await rig(t);
  const out = await w.s1.editInfoProbe.run({ n: 3 });
  assert.equal(out.read, true, JSON.stringify(out));
  assert.deepEqual(out.tries, [{ languages: [], status: "Success" }]);
  assert.equal(out.form, "LengthPrefixed collection of inline structs");
  assert.deepEqual(out.asked, [{ title: "Kind of Blue", artist: "Miles Davis" }, { title: "Blue", artist: "Joni Mitchell" }, { title: "Mezzanine", artist: "Massive Attack" }]);
  const [kob, blue, mezz] = out.albums;
  assert.deepEqual(kob.album, { title: "Kind of Blue", artist: "Miles Davis" }, "named by the answer's own Album reference, known from the read");
  assert.deepEqual(kob.rouen, { label: "Columbia", catno: "CS 8163", type: "album", src: "file" });
  assert.deepEqual(kob.roon.Type, { struct: "EditOptionalValInfo<AlbumType>", value: 0, layers: ["metadata"], name: "Main" });
  assert.deepEqual(kob.roon.CatalogNumber, { struct: "EditOptionalRefInfo<string>", value: "CK 64935", local: "CS 8163", layers: ["local", "metadata"] },
    "the value Roon shows and the file's own, each said: the owner's AlbumPreferLocalCatalogNumber question");
  assert.deepEqual(kob.roon.Labels, { struct: "EditListInfo<string>", value: ["Columbia"], metadata: ["Columbia", "Legacy"], layers: ["metadata"] }, "a list read by its element type");
  assert.deepEqual([kob.roon.IsLive.value, kob.roon.IsCompilation.value, kob.roon.IsBootleg], [false, false, null], "a flag not sent is nothing, not false");
  assert.deepEqual(kob.roon.Title, { struct: "EditRequiredRefInfo<string>", value: "Kind of Blue", layers: ["metadata"] });
  assert.equal(kob.roon.ProductCode, null);
  assert.ok(kob.members.includes("CatalogNumber") && kob.members.includes("Album"));
  assert.deepEqual([blue.roon.Type.name, blue.roon.IsLive.value, blue.roon.IsCompilation.value, blue.roon.IsBootleg.value, blue.roon.CatalogNumber.value],
    ["Main", true, true, false, "none"], "live and compilation beside a Main type: flags, as the owner's counts say; a number of \"none\" said as sent");
  assert.equal(blue.rouen, null, "Rouen holds nothing of it");
  assert.deepEqual([mezz.roon.Type, mezz.roon.Labels, mezz.roon.CatalogNumber], [null, null, null], "an album Roon knows nothing of: its Title alone");
  assert.equal(out.whole.$type, "AlbumEditInfo");
  assert.equal(out.whole.Title.Value, "Kind of Blue", "the first album whole, under the server's own names");
  assert.deepEqual(out.whole.Labels.Values, { list: "string", count: 1, items: ["Columbia"] });
  // As the design reads the call: the connection's own objects of the albums, no languages; nothing but this read.
  assert.deepEqual(w.core.rec.editInfoAsks, [{ albums: ["50000", "50001", "50002"], languages: [] }]);
  assert.deepEqual(w.core.rec.hearts, []);
  assert.deepEqual(w.core.rec.playlistCalls, []);
  for (const sig of w.core.rec.signatures) assert.ok(ALLOWED.has(sig), "off the allowlist: " + sig);
  assert.equal(w.core.rec.signatures.filter((s) => s === SIG.albumEditInfo).length, 1);
});

test("picked by title or artist; too many asked for is capped; none matching is said", async (t) => {
  const w = await rig(t);
  const byArtist = await w.s1.editInfoProbe.run({ artist: "joni" });
  assert.deepEqual(byArtist.asked, [{ title: "Blue", artist: "Joni Mitchell" }]);
  const capped = await w.s1.editInfoProbe.run({ n: 99 });
  assert.equal(capped.asked.length, 8, "the whole fixture library, under the cap of 25");
  const none = await w.s1.editInfoProbe.run({ title: "nosuch" });
  assert.equal(none.status, 404);
});

test("refused with no languages: asked again with [\"en\"], both tries said; refused outright: read false, both said", async (t) => {
  const w = await rig(t, { editInfoRefuseEmptyLanguages: true });
  const out = await w.s1.editInfoProbe.run({ n: 1 });
  assert.equal(out.read, true);
  assert.deepEqual(out.tries, [{ languages: [], status: "InvalidArguments" }, { languages: ["en"], status: "Success" }]);
  assert.deepEqual(w.core.rec.editInfoAsks.map((a) => a.languages), [[], ["en"]]);
  const w2 = await rig(t, { refuseEditInfo: true });
  const out2 = await w2.s1.editInfoProbe.run({ n: 1 });
  assert.deepEqual([out2.read, out2.tries.length, out2.albums], [false, 2, undefined]);
});

test("the answer's form: the bare collection read as the second form; what is neither is given as bytes, said why", async (t) => {
  const w = await rig(t, { editInfoBare: true });
  const out = await w.s1.editInfoProbe.run({ n: 1 });
  assert.equal(out.read, true, JSON.stringify(out));
  assert.equal(out.form, "bare collection of inline structs");
  assert.equal(out.albums[0].roon.CatalogNumber.value, "CK 64935");
  const w2 = await rig(t, { editInfoNotList: true });
  const out2 = await w2.s1.editInfoProbe.run({ n: 1 });
  assert.equal(out2.read, false);
  assert.equal(out2.answer.undecoded, true);
  assert.match(out2.answer.why, /bare:/);
  assert.match(out2.answer.hex, /^[0-9a-f]+$/);
});

test("native mode off, or the library not yet read: said, nothing sent", async (t) => {
  const w = await rig(t, {}, { off: true });
  const out = await w.s1.editInfoProbe.run();
  assert.equal(out.status, 409);
  assert.deepEqual(w.core.rec.editInfoAsks, []);
});

test("readAnswer and layers on their own: a count past the bytes is not read as that form; a value that is no struct is said as what it is", () => {
  const graph = new ObjectGraph({ maxObjects: 100 });
  const bogus = new BinaryWriter().integer(2).flexInt(200).toBuffer();   // a prefix of 2 bytes, a count of 200 and nothing after
  const r = readAnswer(graph, bogus);
  assert.equal(r.undecoded, true);
  assert.match(r.why, /count of 200/);
  assert.deepEqual(layers(graph, 7), { as: "number", value: 7 });
  assert.equal(layers(graph, undefined), null);
  // The argument: an inline AlbumEditInfoParameters with both lists LengthPrefixed (the fake reads it strictly; here its shape).
  const types = [];
  const args = editInfoArgs({ defineType: (name, members) => { types.push([name, members.map((m) => m.propType)]); return 9; } }, [50000n, 50001n], ["en"]);
  assert.deepEqual(types, [["Sooloos.Broker.Api.AlbumEditInfoParameters", [24, 24]]]);
  const rd = new BinaryReader(args);
  assert.equal(rd.long(), 1n);
  assert.equal(rd.flexInt(), 9);
});
