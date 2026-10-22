"use strict";
// ---------------------------------------------------------------------------
// N2e-2a (lib/roon-direct/focus.js, v1.9.52, native-remote.md §12.5): a smart
// playlist's Focus lists read from the bytes the graph keeps — a count, then
// each item in its element type's encoding — and a list that doesn't read
// whole said so. The probe's own test reads them through the fake server.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { readList, elementOf } = require("../../lib/roon-direct/focus");
const { ObjectGraph } = require("../../lib/roon-direct/objects");
const { BinaryWriter } = require("../../lib/roon-direct/wire");

const GENRES = "System.Collections.Generic.IList<Sooloos.Broker.Api.GenreLite> Sooloos.Broker.Api.AlbumQueryCriteria::RequireGenreObjects";
const LABELS = "System.Collections.Generic.IList<string> Sooloos.Broker.Api.AlbumQueryCriteria::RequireLabels";
const YEARS = "System.Collections.Generic.IList<int> Sooloos.Broker.Api.AlbumQueryCriteria::RequireYears";
const graph = new ObjectGraph();

test("each element type read as its own: objects by reference (or null), strings, ints and enums as integers", () => {
  const genres = new BinaryWriter().flexInt(3).long(23000n).long(0n).long(150n).toBuffer();
  assert.deepEqual(readList(graph, GENRES, genres), { type: "GenreLite", count: 3, items: [{ $ref: 23000n }, null, { $ref: 150n }], whole: true });
  assert.deepEqual(readList(graph, LABELS, new BinaryWriter().flexInt(1).string("Motown").toBuffer()), { type: "string", count: 1, items: ["Motown"], whole: true });
  assert.deepEqual(readList(graph, YEARS, new BinaryWriter().flexInt(2).integer(1975).integer(1999).toBuffer()).items, [1975, 1999]);
  // The owner's server: every empty list one byte (§12.2).
  assert.deepEqual(readList(graph, LABELS, Buffer.from([0])), { type: "string", count: 0, items: [], whole: true });
});

test("not whole: cut short, or bytes left over — what was read kept, and said", () => {
  const short = new BinaryWriter().flexInt(2).string("Motown").toBuffer();
  assert.deepEqual(readList(graph, LABELS, short), { type: "string", count: 2, items: ["Motown"], whole: false });
  const over = Buffer.concat([new BinaryWriter().flexInt(1).string("Stax").toBuffer(), Buffer.from([7, 7])]);
  assert.equal(readList(graph, LABELS, over).whole, false);
});

test("a member that isn't a list is none of this module's", () => {
  assert.equal(readList(graph, "Sooloos.Sooid Sooloos.Broker.Api.AlbumQueryOrdering::RandomSeed", Buffer.from([1, 2])), null);
  assert.equal(elementOf("System.Collections.Generic.IList<Sooloos.Broker.Api.TagLite> X::RequireTags"), "Sooloos.Broker.Api.TagLite");
});

test("the review: a null list, a count past the bytes, the Roon.Broker.Api namespace, and a fault of Rouen's own not said as the server's", () => {
  assert.deepEqual(readList(graph, LABELS, new BinaryWriter().integer(-1).toBuffer()), { type: "string", count: null, items: [], whole: true });
  assert.deepEqual(readList(graph, LABELS, new BinaryWriter().flexInt(500).string("x").toBuffer()), { type: "string", count: 500, items: [], whole: false });
  const roonTypes = "System.Collections.Generic.IList<Roon.Broker.Api.AlbumType> Sooloos.Broker.Api.AlbumQueryCriteria::RequireTypes";
  assert.deepEqual(readList(graph, roonTypes, new BinaryWriter().flexInt(2).integer(1).integer(0).toBuffer()), { type: "AlbumType", count: 2, items: [1, 0], whole: true });
  assert.throws(() => readList({ readValue() { throw new TypeError("a bug"); } }, LABELS, new BinaryWriter().flexInt(1).string("x").toBuffer()), TypeError);
});
