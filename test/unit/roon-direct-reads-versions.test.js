"use strict";
// ---------------------------------------------------------------------------
// v2.0.3-t13: the reads probe says an album's other versions in full (lib/roon-direct/reads-probe.js versionsOf,
// dev/design/native-remote.md §16.4). The owner's read of The Dark Side of the Moon (2026-11-10) found 3 library
// versions and 2 streaming ones, each said only as {"struct":"AlternateAlbumVersion"}: what one holds is what the album
// view's Versions will be built on. The values here are built in the shape that read showed (a struct of list
// objects, each holding AlternateAlbumVersion structs); the members inside them are invented, not the server's.
// And a read that finds no zone says how many the connection held.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { ObjectGraph } = require("../../lib/roon-direct/objects");
const { versionsOf, createReadsProbe } = require("../../lib/roon-direct/reads-probe");

const A = "Sooloos.Broker.Api.";
const put = (graph, oid, type, fields) => { graph.objects.set(String(oid), { oid: BigInt(oid), typeName: A + type, loaded: true, fields }); };
const version = (albumOid, label, extra = {}) => Object.assign({ $type: A + "AlternateAlbumVersion",
  [`${A}AlbumLite ${A}AlternateAlbumVersion::Album`]: { $ref: BigInt(albumOid) },
  [`string ${A}AlternateAlbumVersion::Label`]: label }, extra);

function rig({ streaming = 2, group = 3 } = {}) {
  const graph = new ObjectGraph();
  const list = (oid, items) => put(graph, oid, "DataList<Sooloos.Broker.Api.AlternateAlbumVersion>", { $items: items });
  const groupItems = [], streamItems = [];
  for (let i = 0; i < group; i++) {
    put(graph, 800 + i, "AlbumLite", { [`string ${A}AlbumLite::Title`]: `Copy ${i}`, [`int ${A}AlbumLite::Source`]: 1 });
    groupItems.push(version(800 + i, `Library ${i}`, { [`bool ${A}AlternateAlbumVersion::IsMain`]: i === 0 }));
  }
  for (let i = 0; i < streaming; i++) {
    put(graph, 900 + i, "AlbumLite", { [`string ${A}AlbumLite::Title`]: `Stream ${i}`, [`int ${A}AlbumLite::Source`]: 3 });
    streamItems.push(version(900 + i, `Streaming ${i}`));
  }
  list(701, groupItems); list(702, []); list(703, streamItems);
  const album = { oid: 600n, typeName: A + "Album", loaded: true, fields: {
    [`string ${A}Album::Title`]: "The Dark Side of the Moon",
    [`${A}AlternateAlbumVersions ${A}Album::AlternateAlbumVersions`]: { $type: A + "AlternateAlbumVersions",
      [`x ${A}AlternateAlbumVersions::LibraryGroupVersions`]: { $ref: 701n },
      [`x ${A}AlternateAlbumVersions::LibraryOtherVersions`]: { $ref: 702n },
      [`x ${A}AlternateAlbumVersions::StreamingVersions`]: { $ref: 703n } } } };
  return { graph, album };
}

test("THE one: each version said in full, its lists opened, and each album it names given whole", () => {
  const { graph, album } = rig();
  const out = versionsOf(graph, album);
  const v = out.versions;
  assert.equal(v.struct, "AlternateAlbumVersions");
  assert.deepEqual([v.LibraryGroupVersions.count, v.LibraryOtherVersions.count, v.StreamingVersions.count], [3, 0, 2]);
  const first = v.LibraryGroupVersions.items[0];
  assert.deepEqual([first.struct, first.Label, first.IsMain, first.Album], ["AlternateAlbumVersion", "Library 0", true, { ref: "800" }],
    "every member of a version under its own name, not its type alone");
  assert.equal(v.StreamingVersions.items[1].Label, "Streaming 1");
  assert.deepEqual(Object.keys(out.named), ["800", "801", "802", "900", "901"], "each album named, once");
  assert.deepEqual([out.named["900"].object, out.named["900"].members.Title, out.named["900"].members.Source], ["AlbumLite", "Stream 0", 3]);
  assert.equal(out.namedNotSaid, undefined);
});

test("bounded: past the first 24 objects named, the rest counted; an album without versions said so", () => {
  const { graph, album } = rig({ group: 20, streaming: 10 });
  const out = versionsOf(graph, album);
  assert.equal(Object.keys(out.named).length, 24);
  assert.equal(out.namedNotSaid, 6);
  const bare = { oid: 1n, typeName: A + "Album", loaded: true, fields: { [`string ${A}Album::Title`]: "x" } };
  assert.match(versionsOf(graph, bare).skipped, /without AlternateAlbumVersions/);
});

test("a version naming an object the server never pushed: said so, not taken for nothing", () => {
  const { graph, album } = rig({ group: 1, streaming: 0 });
  graph.objects.delete("800");
  assert.equal(versionsOf(graph, album).named["800"].object, "named, never pushed");
});

test("no zone to match: how many zones the connection held is said beside it", async () => {
  const graph = new ObjectGraph();
  put(graph, 10, "Zone", { [`string ${A}Zone::Name`]: "Stereo Fives" });
  put(graph, 11, "Zone", { [`string ${A}Zone::Name`]: "Kitchen" });
  put(graph, 12, "ZoneDisplay", {});
  const s = { graph, root: { library: { oid: 3n } }, g: { uncertain: () => null, call: async () => ({ success: false, status: "InvalidArguments" }) } };
  const probe = createReadsProbe({ link: { session: () => s }, inTurn: (fn) => fn(), off: () => null, known: () => new Map(),
    keyOf: () => null, profile: () => null, zones: () => [] });
  const out = await probe.run();
  assert.deepEqual(out.zone, { skipped: "The official API has no zone to match.", onConnection: 2 });
});

test("the review's: an album named inside a version's own list (an array) is given whole too, not left as its oid", () => {
  const { graph, album } = rig({ group: 1, streaming: 0 });
  put(graph, 850, "PerformerLite", { [`string ${A}PerformerLite::Name`]: "Pink Floyd" });
  const list = graph.get(701n).fields.$items;
  list[0][`x ${A}AlternateAlbumVersion::Performers`] = [{ $ref: 850n }];
  list[0][`x ${A}AlternateAlbumVersion::Nested`] = { $type: A + "Inner", [`x ${A}Inner::Who`]: [{ $ref: 851n }] };
  const out = versionsOf(graph, album);
  assert.deepEqual(out.versions.LibraryGroupVersions.items[0].Performers, [{ ref: "850" }]);
  assert.equal(out.named["850"].members.Name, "Pink Floyd");
  assert.equal(out.named["851"].object, "named, never pushed", "inside a nested struct's list too");
});
