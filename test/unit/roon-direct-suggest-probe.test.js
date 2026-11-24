"use strict";
// ---------------------------------------------------------------------------
// Stage 0 of suggestions from Roon (lib/roon-direct/suggest-probe.js, 2.0.6-t17, dev/design/roon-suggestions.md §4):
// the album's See also and its artist's similar artists, read whole; GetPerformer and Roon's search for the first three
// of them, each search's albums in Roon's order and its result disposed once. The graph is objects.js's own; the
// answers are built here in the forms this design reads, not evidence of the server's.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { ObjectGraph, P } = require("../../lib/roon-direct/objects");
const { BinaryWriter } = require("../../lib/roon-direct/wire");
const { SIG } = require("../../lib/roon-direct/methods");
const { createSuggestProbe } = require("../../lib/roon-direct/suggest-probe");

const A = "Sooloos.Broker.Api.";
const LIST = (el) => `System.Collections.Generic.IList<${A}${el}>`;
const TYPES = {
  4: ["AlbumLite", [[`string ${A}AlbumLite::Title`, P.String], [`string ${A}AlbumLite::PerformedBy`, P.String], [`${A}MediaSource ${A}AlbumLite::ContentSource`, P.Enum], [`long ${A}AlbumLite::AlbumId`, P.Long]]],
  5: ["Album", [[`string ${A}Album::Title`, P.String], [`${LIST("PerformerLite")} ${A}Album::MainPerformers`, P.LengthPrefixed], [`${LIST("AlbumLite")} ${A}Album::SeeAlso`, P.LengthPrefixed]]],
  6: ["PerformerLite", [[`string ${A}PerformerLite::Name`, P.String]]],
  7: ["Performer", [[`string ${A}Performer::Name`, P.String], [`${LIST("PerformerLite")} ${A}Performer::SimilarTo`, P.LengthPrefixed]]],
  // Roon's search as find.js reads it (fake-roon-search.js's forms): its album list a DataList object, each catalogue
  // album by its AlbumLiteVersions and that object's own list.
  8: ["UnifiedSearchResults", [[`${A}AlbumLite ${A}UnifiedSearchResults::TopAlbum`, P.Object], [`${A}DataList<${A}AlbumLite> ${A}UnifiedSearchResults::Albums`, P.Object]]],
  9: [`DataList<${A}AlbumLite>`, []],
  10: ["AlbumLiteVersions", [[`${A}DataList<${A}AlbumLite> ${A}AlbumLiteVersions::Albums`, P.Object]]],
  13: ["Profile", [[`System.Sooid ${A}Profile::ProfileId`, P.Sooid], [`string ${A}Profile::Name`, P.String]]],
};
const frame = (oid, tid, fields) => {
  const w = new BinaryWriter().long(oid).flexInt(tid);
  for (const [i, write] of fields) { w.flexInt(i); write(w); }
  return { cmd: 3, isResponse: false, body: w.flexInt(0).toBuffer() };
};
const ref = (oid) => new BinaryWriter().long(oid).toBuffer();
const refs = (...oids) => { const inner = oids.reduce((w, o) => w.long(o), new BinaryWriter().flexInt(oids.length)).toBuffer(); return (w) => w.integer(inner.length).bytes(inner); };

function rig(o = {}) {
  const graph = new ObjectGraph();
  for (const [id, [name, members]] of Object.entries(TYPES)) {
    graph.types.set(Number(id), { id: Number(id), name: A + name, members: members.map(([n, p]) => ({ name: n, propType: p })) });
  }
  const push = (...a) => graph.ingest(frame(...a));
  push(30n, 13, [[1, (w) => w.sooid(Buffer.from("cafe", "hex"))], [2, (w) => w.string("Owner")]]);
  push(50n, 4, [[1, (w) => w.string("Day & Age")], [2, (w) => w.string("The Killers")]]);
  // Its similar artists, as GetPerformer's answer names them.
  const SIMILAR = { 311n: "Arcade Fire", 312n: "Interpol", 313n: "Editors", 314n: "Kasabian" };
  const calls = [];
  const answers = {
    [SIG.getAlbum]: () => {
      push(301n, 6, [[1, (w) => w.string("The Killers")]]);
      push(401n, 4, [[1, (w) => w.string("Hot Fuss")], [2, (w) => w.string("The Killers")], [3, (w) => w.integer(1)]]);
      push(402n, 4, [[1, (w) => w.string("Funeral")], [2, (w) => w.string("[[9|Arcade Fire]]")], [3, (w) => w.integer(256)], [4, (w) => w.long(70001n)]]);
      push(501n, 5, [[1, (w) => w.string("Day & Age")], [2, refs(301n)], [3, refs(401n, 402n)]]);
      return ref(501n);
    },
    [SIG.getPerformer]: (args) => {
      const oid = new (require("../../lib/roon-direct/wire").BinaryReader)(args).long();
      if (oid === 301n) {
        for (const [id, name] of Object.entries(SIMILAR)) push(BigInt(id), 6, [[1, (w) => w.string(name)]]);
        push(701n, 7, [[1, (w) => w.string("The Killers")], [2, refs(...Object.keys(SIMILAR).map(BigInt))]]);
        return ref(701n);
      }
      if (o.refuseSimilar) return null;
      push(oid + 1000n, 7, [[1, (w) => w.string(SIMILAR[oid] || "?")]]);
      return ref(oid + 1000n);
    },
    [SIG.unifiedSearch]: () => {
      const base = 900n + BigInt(calls.filter((c) => c.sig === SIG.unifiedSearch).length) * 10n;
      const list = (oid, ...items) => graph.ingest({ cmd: 3, isResponse: false, body: items.reduce((w, x) => w.long(x), new BinaryWriter().long(oid).flexInt(9).integer(items.length)).toBuffer() });
      push(base + 1n, 4, [[1, (w) => w.string("Neon Bible")], [2, (w) => w.string("[[9|Arcade Fire]]")], [3, (w) => w.integer(256)], [4, (w) => w.long(80001n)]]);
      list(base + 2n, base + 1n);                                   // its versions' list
      push(base + 3n, 10, [[1, (w) => w.long(base + 2n)]]);        // its versions
      // Another, named only through its versions (not the top album): read through them, or not at all.
      push(base + 5n, 4, [[1, (w) => w.string("Funeral")], [2, (w) => w.string("[[9|Arcade Fire]]")], [3, (w) => w.integer(128)], [4, (w) => w.long(80002n)]]);
      list(base + 6n, base + 5n);
      push(base + 7n, 10, [[1, (w) => w.long(base + 6n)]]);
      push(base, 8, [[1, (w) => w.long(base + 1n)], [2, (w) => w.long(base + 4n)]]);
      // The album list comes after the answer, as a search's lists do: waited for, never read half.
      setTimeout(() => list(base + 4n, base + 3n, base + 7n, 50n), o.listLateMs ?? 20);
      return new BinaryWriter().long(base).toBuffer();
    },
  };
  let uncertain = "";
  const s = { graph, root: { library: { oid: 3n }, profiles: [graph.get(30n)], profileId: null },
    g: {
      uncertain: () => uncertain,
      defineType: () => 99,
      call: async (oid, sig, args) => {
        calls.push({ oid: String(oid), sig, args });
        if (o.unanswered === sig) { uncertain = "a call unanswered"; throw new Error("no answer within 10 s"); }
        const a = answers[sig] ? answers[sig](args) : null;
        return a === null ? { success: false, status: "InvalidArguments" } : { success: true, status: "Success", payload: a };
      },
      callNoReply: (oid, sig) => { calls.push({ oid: String(oid), sig, noReply: true }); return true; } } };
  const known = new Map([["50", { oid: "50", title: "Day & Age", artist: "The Killers" }]]);
  const probe = createSuggestProbe({ link: { session: () => s }, inTurn: (fn) => fn(), off: () => o.off || null, known: () => known,
    keyOf: (t, a) => `${t}||${a}`.toLowerCase(), profile: () => "cafe", albumWaitMs: 50, searchMs: o.searchMs ?? 300,
    zones: () => o.zones || [{ zone_id: "z1", display_name: "Lounge", state: "playing", now_playing: { three_line: { line1: "Spaceman", line2: "The Killers", line3: "Day & Age" } } }] });
  return { probe, calls, graph };
}
const short = (calls) => calls.map((c) => c.sig.replace(/Sooloos\.Broker\.Api\./g, "").replace(/\(.*$/, ""));

test("THE one: the album playing — its See also and its artist's similar artists whole; three of them read and searched for", async () => {
  const { probe, calls, graph } = rig();
  const out = await probe.run();
  assert.deepEqual(out.asked, { title: "Day & Age", artist: "The Killers", chose: "the album playing in Lounge" });
  assert.deepEqual(out.seeAlso.items.map((x) => x.members.Title), ["Hot Fuss", "Funeral"], "See also, whole");
  assert.equal(out.seeAlso.form, "LengthPrefixed list");
  assert.equal(out.performer.name, "The Killers");
  assert.equal(out.similarTo.count, 4);
  assert.deepEqual(out.similarTo.items.map((x) => x.members.Name), ["Arcade Fire", "Interpol", "Editors", "Kasabian"]);
  assert.deepEqual(out.similarRead.map((x) => x.name), ["Arcade Fire", "Interpol", "Editors"], "the first three, no more");
  assert.equal(out.similarRead[0].performer.object, "Performer", "GetPerformer for a similar artist, whole");
  const search = out.similarRead[0].search;
  assert.equal(search.query, "Arcade Fire");
  assert.deepEqual(search.albums, [
    { title: "Neon Bible", artist: "Arcade Fire", source: "Qobuz", inLibrary: false, albumId: "80001" },
    { title: "Funeral", artist: "Arcade Fire", source: "TIDAL", inLibrary: false, albumId: "80002" },
    { title: "Day & Age", artist: "The Killers", source: "unknown", inLibrary: true, albumId: null },
  ], "THE one: each album whole — a catalogue album named through its versions, not blank — in Roon's order, each in the library or not");
  assert.equal(search.whole, true, "the album list waited for");
  assert.equal(search.albumsFound, 3, "a catalogue album found through its versions and as the top album is one album");
  assert.ok("TopAlbum" in search.members && "Albums" in search.members, "the result's own members");
  assert.deepEqual(short(calls), ["Library::GetAlbum", "Library::GetPerformer",
    "Library::GetPerformer", "Library::UnifiedSearch", "UnifiedSearchResults::Dispose",
    "Library::GetPerformer", "Library::UnifiedSearch", "UnifiedSearchResults::Dispose",
    "Library::GetPerformer", "Library::UnifiedSearch", "UnifiedSearchResults::Dispose"], "each result disposed once, nothing else sent");
  assert.ok(calls.filter((c) => c.noReply).every((c) => /^9\d0$/.test(c.oid)), "Dispose sent to the result object");
  assert.equal(graph.get(910n), undefined, "the result object let go on this side");
  assert.deepEqual(Object.keys(out.connection.after), ["album", "similar 311", "similar 312", "similar 313"]);
});

test("a similar artist GetPerformer refuses: said, and still searched for by its name", async () => {
  const { probe } = rig({ refuseSimilar: true });
  const out = await probe.run({ title: "Day & Age", artist: "The Killers" });
  assert.equal(out.asked.chose, "the album named");
  assert.equal(out.similarRead[0].performer.refused, "InvalidArguments");
  assert.equal(out.similarRead[0].search.albums[0].title, "Neon Bible");
});

test("a call unanswered: nothing more is sent; native mode off or a missing album: nothing sent at all", async () => {
  const stuck = rig({ unanswered: SIG.getAlbum });
  const out = await stuck.probe.run();
  assert.deepEqual(short(stuck.calls), ["Library::GetAlbum"]);
  assert.match(out.album.error, /no answer/);
  assert.deepEqual(out.similarRead, []);
  const off = rig({ off: "Native mode is off." });
  assert.deepEqual(await off.probe.run(), { error: "Native mode is off.", status: 503 });
  assert.deepEqual(off.calls, []);
  const none = rig();
  assert.equal((await none.probe.run({ title: "Nope", artist: "Nobody" })).status, 404);
  assert.deepEqual(none.calls, []);
  // Nothing playing: the library's first, said so.
  const idle = rig({ zones: [] });
  assert.match((await idle.probe.run()).asked.chose, /library's first \(nothing is playing\)/);
});

test("a search whose album list hasn't all come: said incomplete, with what had, never read as whole", async () => {
  const { probe } = rig({ listLateMs: 400, searchMs: 60 });
  const out = await probe.run();
  const search = out.similarRead[0].search;
  assert.equal(search.whole, false);
  assert.match(search.incomplete, /Not all of the result had arrived/);
  assert.deepEqual(search.albums.map((a) => a.title), ["Neon Bible"], "the top album alone, which had come");
});

test("by title alone; something playing that isn't in the library said, never passed over for another album", async () => {
  const titled = rig();
  assert.equal((await titled.probe.run({ title: "Day & Age" })).asked.chose, "the album named");
  const elsewhere = rig({ zones: [{ zone_id: "z1", display_name: "Lounge", state: "playing", now_playing: { three_line: { line1: "x", line2: "Nobody", line3: "Not Here" } } }] });
  const out = await elsewhere.probe.run();
  assert.equal(out.status, 404);
  assert.match(out.error, /"Not Here" by Nobody, playing in Lounge, isn't an album of your library/);
  assert.deepEqual(elsewhere.calls, []);
});

test("Roon's search unanswered for one similar artist: the rest send nothing, each said why", async () => {
  const { probe, calls } = rig({ unanswered: SIG.unifiedSearch });
  const out = await probe.run();
  assert.match(out.similarRead[0].error, /no answer/);
  assert.match(out.similarRead[1].performer.skipped, /unanswered/);
  assert.equal(short(calls).filter((c) => c === "Library::UnifiedSearch").length, 1, "searched again after an unanswered call");
});
