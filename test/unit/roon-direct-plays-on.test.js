"use strict";
// ---------------------------------------------------------------------------
// The plays-on probe's pieces (dev/design/plays-on.md §4): the bytes a performer
// filter is sent as and at which property type, the verdict that keeps "the same
// count as the control" from passing as a filter, and that every query opened is
// disposed — even when the Count can't be read. The probe end to end is run on
// the owner's Core (the design's authority), not the fake.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { BinaryWriter } = require("../../lib/roon-direct/wire");
const { SIG, ALLOWED, openAlbumQueryByPerformer, PERFORMER_KINDS } = require("../../lib/roon-direct/methods");
const { verdictOf, normName, askKind, resolvePerformer } = require("../../lib/roon-direct/plays-on-probe");

// A guard-shaped fake: records the type it declared and the methods it sent; answers the album query with a query id.
function fakeG(onQuery) {
  const declared = [], sent = [], noReply = [];
  return {
    declared, sent, noReply,
    defineType(name, members) { declared.push({ name, members }); return 7; },
    uncertain() { return ""; },
    call(oid, sig, args) { sent.push({ sig, args }); return onQuery(sig, args); },
    callNoReply(oid, sig) { noReply.push(sig); return true; },
  };
}

test("openAlbumQueryByPerformer: RequirePerformers, sent at the property type passed, on the allowlisted album query", async () => {
  assert.ok(ALLOWED.has(SIG.albumQuery), "it reuses the already-allowed VirtualAlbumQuery");
  const g = fakeG(() => ({ success: true, payload: new BinaryWriter().long(100n).toBuffer() }));
  const qid = await openAlbumQueryByPerformer(/** @type {any} */ (g), 1n, Buffer.from([1]), "performers", [42n], 100, 24);
  assert.equal(qid, 100n, "resolves to the query object id the Core returned");
  assert.equal(g.sent[0].sig, SIG.albumQuery);
  // The one member whose property type was overridden to the value under test; every other IList member keeps the schema's.
  const members = g.declared[0].members;
  const perf = members.find((m) => m.name === PERFORMER_KINDS.performers);
  assert.equal(perf.propType, 24, "RequirePerformers declared at the property type passed in");
  // The other performer members keep the schema's 23 — only the one kind under test is overridden, nothing sweeping.
  for (const other of [PERFORMER_KINDS.mainPerformers, PERFORMER_KINDS.production, PERFORMER_KINDS.composers]) {
    assert.equal(members.find((m) => m.name === other).propType, 23, `${other.split("::")[1]} is untouched`);
  }
});

test("the four credit kinds the owner chose map to the right criteria", () => {
  assert.deepEqual(Object.keys(PERFORMER_KINDS), ["mainPerformers", "performers", "production", "composers"]);
  assert.ok(PERFORMER_KINDS.mainPerformers.endsWith("::RequireMainPerformers"));
  assert.ok(PERFORMER_KINDS.composers.endsWith("::RequireComposers"));
});

test("verdictOf: filtered only on a Count strictly between 0 and the control", () => {
  assert.match(verdictOf(5, 100), /^filtered: 5 album/);
  assert.match(verdictOf(100, 100), /^ignored: the same Count as with no criterion \(100\)/, "THE one: as many as the whole library is no filter, it is the criterion ignored");
  assert.match(verdictOf(0, 100), /^none: no album/);
  assert.match(verdictOf(200, 100), /^misread: 200, more than the 100/);
  assert.match(verdictOf(5, null), /^unknown: the unfiltered control query failed/);
  assert.match(verdictOf(5, 0), /^unknown: the control counted no albums/);
  assert.match(verdictOf(null, 100), /^unknown: the filtered query gave no Count/);
});

test("normName: a–z and 0–9 only, lower-cased, so an artist matches an album's lead whatever the spacing", () => {
  assert.equal(normName("Steve  Lukather!"), "stevelukather");
  assert.equal(normName("Earth, Wind & Fire"), "earthwindfire");
});

// A query object the graph holds, with (or without) a Count member read by its suffix.
const queryObj = (count) => ({ fields: count === undefined ? {} : { "int Sooloos.Broker.Api.VirtualAlbumLiteQuery::Count": count } });

test("askKind disposes its query exactly once — a Count read, and no sample when it is not filtered", async () => {
  const g = fakeG(() => ({ success: true, payload: new BinaryWriter().long(50n).toBuffer() }));
  const graph = /** @type {any} */ ({ get: () => queryObj(100) });   // same as the control → ignored, no paging
  const lifetime = { queriesOpened: 0, queriesDisposed: 0, pagesRetained: 0, pagesReleased: 0, unsent: 0 };
  const o = { libraryOid: 1n, profileId: Buffer.from([1]), timeoutMs: 50, pageSize: 100, countGraceMs: 10, budget: { left: 6 }, lifetime };
  const r = await askKind(/** @type {any} */ ({ g, graph }), o, "performers", [42n], 24, 100);
  assert.match(r.verdict, /^ignored:/);
  assert.equal(lifetime.queriesOpened, 1);
  assert.equal(lifetime.queriesDisposed, 1, "opened once, disposed once");
  assert.equal(g.noReply.filter((s) => s === SIG.albumDispose).length, 1);
  assert.equal(g.sent.filter((s) => s.sig === SIG.albumRetainPage).length, 0, "an ignored kind is not paged");
});

test("askKind disposes its query even when the Count cannot be read (handle lifetime)", async () => {
  const g = fakeG(() => ({ success: true, payload: new BinaryWriter().long(50n).toBuffer() }));
  const graph = /** @type {any} */ ({ get: () => ({ fields: { "int? Sooloos.Broker.Api.VirtualAlbumLiteQuery::Count": null } }) });  // present, not a count → error
  const lifetime = { queriesOpened: 0, queriesDisposed: 0, pagesRetained: 0, pagesReleased: 0, unsent: 0 };
  const o = { libraryOid: 1n, profileId: Buffer.from([1]), timeoutMs: 50, pageSize: 100, countGraceMs: 10, budget: { left: 6 }, lifetime };
  const r = await askKind(/** @type {any} */ ({ g, graph }), o, "composers", [42n], 24, 100);
  assert.ok(r.error, "the bad Count is reported as an error");
  assert.equal(lifetime.queriesDisposed, 1, "THE one: a query opened is disposed in the finally, whatever the read did");
});

test("resolvePerformer: a clear error when no library album is the artist's, so nothing is asked of the Core", async () => {
  const known = new Map([["k", { oid: "9", title: "Thriller", artist: "Michael Jackson" }]]);
  const r = await resolvePerformer(/** @type {any} */ ({ graph: { get: () => null } }), known, "Steve Lukather");
  assert.ok(!r.performer && /No library album whose artist is exactly "Steve Lukather"/.test(r.error), "names the artist and how to help (an album of theirs)");
  const byTitle = await resolvePerformer(/** @type {any} */ ({ graph: { get: () => null } }), known, "Steve Lukather", "No Such Record");
  assert.match(byTitle.error, /No album of that title/);
});
