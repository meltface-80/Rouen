"use strict";
// ---------------------------------------------------------------------------
// The plays-on probe's pieces (dev/design/plays-on.md §4): the performer filter's
// bytes and its one shared schema (a type is declared once a connection, so the
// control and the filtered query must declare AlbumQueryCriteria identically),
// the verdict that keeps "the same count as the control" from passing as a
// filter, the sample page that releases every page it retains, and that every
// query opened is disposed — even when the Count can't be read. The probe end to
// end is run on the owner's Core (the design's authority), not the fake.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { BinaryWriter } = require("../../lib/roon-direct/wire");
const { SIG, ALLOWED, openAlbumQuery, openAlbumQueryByPerformer, PERFORMER_KINDS } = require("../../lib/roon-direct/methods");
const { verdictOf, normName, nameMatches, askKind, resolvePerformer } = require("../../lib/roon-direct/plays-on-probe");

const AQC = "Sooloos.Broker.Api.AlbumQueryCriteria";

// A guard-shaped fake: records the types it declared and the methods it sent; `onCall` answers each call.
function fakeG(onCall) {
  const declared = [], sent = [], noReply = [];
  return {
    declared, sent, noReply,
    defineType(name, members) { declared.push({ name, members }); return 7; },
    uncertain() { return ""; },
    call(oid, sig, args) { sent.push({ oid, sig, args }); return onCall(sig, args, oid); },
    callNoReply(oid, sig) { noReply.push({ oid, sig }); return true; },
  };
}
const okQuery = (qid) => () => ({ success: true, payload: new BinaryWriter().long(qid).toBuffer() });

test("openAlbumQueryByPerformer: RequirePerformers sent LengthPrefixed (24) on the allowlisted album query", async () => {
  assert.ok(ALLOWED.has(SIG.albumQuery), "it reuses the already-allowed VirtualAlbumQuery — no new method");
  const g = fakeG(okQuery(100n));
  const qid = await openAlbumQueryByPerformer(/** @type {any} */ (g), 1n, Buffer.from([1]), "performers", [42n], 100);
  assert.equal(qid, 100n, "resolves to the query object id the Core returned");
  assert.equal(g.sent[0].sig, SIG.albumQuery);
  const members = g.declared[0].members;
  for (const k of ["performers", "mainPerformers", "production", "composers"]) {
    assert.equal(members.find((m) => m.name === PERFORMER_KINDS[k]).propType, 24, `${k} declared LengthPrefixed, matching refList's bytes`);
  }
});

test("the control and a performer query declare AlbumQueryCriteria identically, so one connection holds both", async () => {
  // defineType refuses a second declaration of a type name with other members (remoting.js). The criterion-free control
  // and the performer-filtered query must therefore declare AlbumQueryCriteria the SAME way — the propType-fix regression.
  const g = fakeG(okQuery(5n));
  await openAlbumQuery(/** @type {any} */ (g), 1n, Buffer.from([1]), null, 100);
  await openAlbumQueryByPerformer(/** @type {any} */ (g), 1n, Buffer.from([1]), "performers", [42n], 100);
  const decls = g.declared.filter((d) => d.name === AQC);
  assert.equal(decls.length, 2, "both declared the type");
  assert.deepEqual(decls[0].members, decls[1].members, "identical schemas → the real defineType declares it once and never throws 'other members'");
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

test("normName / nameMatches: a–z0–9, and a resolved performer must be the artist asked for (no name → can't check, passes)", () => {
  assert.equal(normName("Steve  Lukather!"), "stevelukather");
  assert.equal(normName("Earth, Wind & Fire"), "earthwindfire");
  assert.equal(nameMatches("Steve Lukather", "steve lukather"), true);
  assert.equal(nameMatches("Michael Jackson", "Steve Lukather"), false, "THE one: a record resolving to another lead is refused");
  assert.equal(nameMatches(null, "Steve Lukather"), true, "a performer with no name can't be checked");
});

// A query object the graph holds, with (or without) a Count member read by its suffix.
const queryObj = (count) => ({ fields: count === undefined ? {} : { "int Sooloos.Broker.Api.VirtualAlbumLiteQuery::Count": count } });

test("askKind disposes its query exactly once — a Count read, and no sample when it is not filtered", async () => {
  const g = fakeG(okQuery(50n));
  const graph = /** @type {any} */ ({ get: () => queryObj(100) });   // same as the control → ignored, no paging
  const lifetime = { queriesOpened: 0, queriesDisposed: 0, pagesRetained: 0, pagesReleased: 0, unsent: 0 };
  const o = { libraryOid: 1n, profileId: Buffer.from([1]), timeoutMs: 50, pageSize: 100, countGraceMs: 10, budget: { left: 6 }, lifetime };
  const r = await askKind(/** @type {any} */ ({ g, graph }), o, "performers", [42n], 100);
  assert.match(r.verdict, /^ignored:/);
  assert.equal(lifetime.queriesOpened, 1);
  assert.equal(lifetime.queriesDisposed, 1, "opened once, disposed once");
  assert.equal(g.noReply.filter((n) => n.sig === SIG.albumDispose).length, 1);
  assert.equal(g.sent.filter((n) => n.sig === SIG.albumRetainPage).length, 0, "an ignored kind is not paged");
});

test("askKind disposes its query even when the Count cannot be read (handle lifetime)", async () => {
  const g = fakeG(okQuery(50n));
  const graph = /** @type {any} */ ({ get: () => ({ fields: { "int? Sooloos.Broker.Api.VirtualAlbumLiteQuery::Count": null } }) });  // present, not a count → error
  const lifetime = { queriesOpened: 0, queriesDisposed: 0, pagesRetained: 0, pagesReleased: 0, unsent: 0 };
  const o = { libraryOid: 1n, profileId: Buffer.from([1]), timeoutMs: 50, pageSize: 100, countGraceMs: 10, budget: { left: 6 }, lifetime };
  const r = await askKind(/** @type {any} */ ({ g, graph }), o, "composers", [42n], 100);
  assert.ok(r.error, "the bad Count is reported as an error");
  assert.equal(lifetime.queriesDisposed, 1, "THE one: a query opened is disposed in the finally, whatever the read did");
});

test("askKind on a filtered kind samples a page, names the records from the library Rouen holds, and releases every page", async () => {
  // The found album ids come as the query's rows; their titles come from byOid (the library records), because the album
  // objects were dropped from the graph after the library read and the Core won't re-push their fields (the probe run).
  const QID = 7n, A1 = 11n, A2 = 12n;
  const byOid = new Map([
    ["11", { oid: "11", title: "Thriller", artist: "Michael Jackson", contentSource: 128, imageKey: "k1" }],
    ["12", { oid: "12", title: "Silk Degrees", artist: "Boz Scaggs", contentSource: 1, imageKey: "k2" }],
  ]);
  const filtered = { fields: { "int X::Count": 2 } };   // 2, strictly between 0 and the control 100 → filtered
  const row = (albumOid) => ({ typeName: "Sooloos.Broker.Api.VirtualQueryElement<Sooloos.Broker.Api.AlbumLite>", oid: albumOid * 100n, fields: { "Sooloos.Broker.Api.AlbumLite X::Data": { $ref: albumOid } } });
  const graph = /** @type {any} */ ({ onObject: null, get: (id) => (id === QID ? filtered : null) });   // the album objects aren't in the graph
  const g = fakeG((sig) => {
    if (sig === SIG.albumRetainPage) { if (graph.onObject) { graph.onObject(row(A1)); graph.onObject(row(A2)); } return { success: true, payload: Buffer.alloc(0) }; }
    return okQuery(QID)();
  });
  const lifetime = { queriesOpened: 0, queriesDisposed: 0, pagesRetained: 0, pagesReleased: 0, unsent: 0 };
  const o = { libraryOid: 1n, profileId: Buffer.from([1]), timeoutMs: 300, pageSize: 100, countGraceMs: 10, budget: { left: 6 }, lifetime, byOid };
  const r = await askKind({ g, graph }, o, "mainPerformers", [42n], 100);
  assert.match(r.verdict, /^filtered: 2 album/);
  assert.equal(r.sample.rows, 2, "both rows gathered");
  assert.deepEqual(r.sample.albums.map((a) => a.title), ["Thriller", "Silk Degrees"], "THE one: titles come from the library records, not the (empty) graph");
  assert.deepEqual(r.sample.albums.map((a) => a.contentSource), [128, 1]);
  assert.ok(r.sample.albums.every((a) => a.inLibrary === true) && !("unmatchedToLibrary" in r.sample));
  assert.equal(lifetime.pagesRetained, lifetime.pagesReleased, "every page retained is released");
  assert.ok(lifetime.pagesRetained >= 1 && o.budget.left === 5, "one page read, the budget spent by one");
  assert.equal(lifetime.queriesDisposed, 1);
});

test("resolvePerformer: a clear error when no library album is the artist's, so nothing is asked of the Core", async () => {
  const known = new Map([["k", { oid: "9", title: "Thriller", artist: "Michael Jackson" }]]);
  const r = await resolvePerformer(/** @type {any} */ ({ graph: { get: () => null } }), known, "Steve Lukather");
  assert.ok(!r.performer && /No album in your library is led by "Steve Lukather"/.test(r.error), "names the artist and how to help");
  const byTitle = await resolvePerformer(/** @type {any} */ ({ graph: { get: () => null } }), known, "Steve Lukather", "No Such Record");
  assert.match(byTitle.error, /No album of that title/);
});
