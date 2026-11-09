"use strict";
// ---------------------------------------------------------------------------
// The artist page's "Appears on" (v2.0.3-t3, dev/design/plays-on.md §6): the probe's read made a feature.
//
// The server read (lib/roon-direct/appears-on.js): one query per credit kind, each disposed once and every page it
// retains released, a Count as large as the library taken as a misread and given nothing, each record named from the
// library records Rouen holds, one per record with every role. Kept per library read and per artist; one read at a
// time per artist; "pending" past the caller's wait. The route (lib/routes/artist-albums.js): the records as the
// library's own tiles, the artist's own albums left out, every album whose artist line names them kept as "Featured",
// and any answer but "ok" passed through so the page keeps "Also appears on". The read itself is proven on the owner's
// Core (the probe, v2.0.3-t2), not on these fakes.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { BinaryWriter } = require("../../lib/roon-direct/wire");
const { SIG } = require("../../lib/roon-direct/methods");
const { createAppearsOn, kindOids, mergeRoles, KINDS } = require("../../lib/roon-direct/appears-on");
const { appearsTiles, mountArtistAlbums } = require("../../lib/routes/artist-albums");

function fakeG(onCall) {
  const sent = [], noReply = [];
  return {
    sent, noReply,
    defineType() { return 7; },
    uncertain() { return ""; },
    call(oid, sig, args) { sent.push({ oid, sig, args }); return onCall(sig, args, oid); },
    callNoReply(oid, sig) { noReply.push({ oid, sig }); return true; },
  };
}
const okQuery = (qid) => ({ success: true, payload: new BinaryWriter().long(qid).toBuffer() });
const countObj = (n) => ({ fields: { "int Sooloos.Broker.Api.VirtualAlbumLiteQuery::Count": n } });
const row = (albumOid) => ({ typeName: "Sooloos.Broker.Api.VirtualQueryElement<Sooloos.Broker.Api.AlbumLite>", oid: albumOid * 100n,
  fields: { "Sooloos.Broker.Api.AlbumLite X::Data": { $ref: albumOid } } });

// A session whose query counts `count` and whose one page carries `rows`.
function session(count, rows) {
  const QID = 7n;
  const graph = /** @type {any} */ ({ onObject: null, get: (id) => (id === QID ? countObj(count) : null) });
  const g = fakeG((sig) => {
    if (sig === SIG.albumRetainPage) { if (graph.onObject) for (const r of rows) graph.onObject(row(r)); return { success: true, payload: Buffer.alloc(0) }; }
    return okQuery(QID);
  });
  return { g, graph };
}
const disposed = (g) => g.noReply.filter((n) => n.sig === SIG.albumDispose).length;
const retained = (g) => g.sent.filter((n) => n.sig === SIG.albumRetainPage).length;
const released = (g) => g.noReply.filter((n) => n.sig === SIG.albumReleasePage).length;
const O = { timeoutMs: 300, countGraceMs: 10 };

test("kindOids: a filtered kind's records by id, every page released, the query disposed once", async () => {
  const s = session(2, [11n, 12n]);
  const r = await kindOids(s, 1n, Buffer.from([1]), "performers", [42n], 1000, O);
  assert.deepEqual(r.oids.sort(), ["11", "12"]);
  assert.equal(r.capped, false);
  assert.equal(r.misread, undefined);
  assert.ok(retained(s.g) >= 1);
  assert.equal(released(s.g), retained(s.g), "every page retained is released");
  assert.equal(disposed(s.g), 1, "opened once, disposed once");
});

test("kindOids: THE one — a Count as large as the library is a misread criterion, never an appearance list", async () => {
  const s = session(1000, [11n]);
  const r = await kindOids(s, 1n, Buffer.from([1]), "composers", [42n], 1000, O);
  assert.deepEqual(r.oids, [], "a misread Count gives nothing");
  assert.equal(r.misread, 1000);
  assert.equal(retained(s.g), 0, "a misread kind is not paged");
  assert.equal(disposed(s.g), 1);
});

test("kindOids: a Count of 0 asks for no page; a bad Count throws, the query still disposed", async () => {
  const zero = session(0, []);
  assert.deepEqual(await kindOids(zero, 1n, Buffer.from([1]), "production", [42n], 1000, O), { oids: [], capped: false });
  assert.equal(retained(zero.g), 0);
  assert.equal(disposed(zero.g), 1);
  const bad = session(/** @type {any} */ ("x"), []);
  await assert.rejects(kindOids(bad, 1n, Buffer.from([1]), "production", [42n], 1000, O), /production: the query's Count was not a count/);
  assert.equal(disposed(bad.g), 1, "disposed in the finally, whatever the read did");
});

test("kindOids: more records than the cap is said (capped), and only the cap's pages are read", async () => {
  const s = session(250, [11n]);
  const r = await kindOids(s, 1n, Buffer.from([1]), "performers", [42n], 1000, Object.assign({ pageSize: 100, maxPages: 2 }, O));
  assert.equal(r.capped, true);
  assert.ok(retained(s.g) <= 2);
  assert.equal(released(s.g), retained(s.g));
});

test("mergeRoles: one per record, every role it has, in order; a record Rouen does not hold counted once", () => {
  const byOid = new Map([["11", { title: "Thriller", artist: "Michael Jackson" }], ["12", { title: "IV", artist: "Toto" }]]);
  const r = mergeRoles([
    { role: "Played", oids: ["11", "12"] }, { role: "Played", oids: ["11"] },
    { role: "Wrote", oids: ["12", "99"] }, { role: "Produced", oids: ["12", "99"] },
  ], byOid);
  assert.deepEqual(r.albums, [
    { title: "Thriller", artist: "Michael Jackson", roles: ["Played"] },
    { title: "IV", artist: "Toto", roles: ["Played", "Produced", "Wrote"] },
  ]);
  assert.equal(r.unnamed, 1);
  assert.deepEqual(KINDS.map((k) => k[1]), ["Played", "Played", "Produced", "Wrote"], "the owner's kinds: performing, production, writing");
});

test("createAppearsOn: off says why and reads nothing; an empty name is unresolved", async () => {
  let reads = 0;
  const a = createAppearsOn({ link: null, inTurn: (fn) => fn(), off: () => "Native mode is off.", known: () => null, profile: () => null,
    read: async () => { reads++; return { status: "ok", albums: [] }; } });
  assert.deepEqual(await a.read("Steve Lukather"), { status: "off", why: "Native mode is off." });
  assert.equal(reads, 0);
  const b = createAppearsOn({ link: null, inTurn: (fn) => fn(), off: () => null, known: () => null, profile: () => null });
  assert.equal((await b.read("!!")).status, "unresolved");
  assert.equal((await b.read("Steve Lukather")).status, "off", "no session: off, not a throw");
});

test("createAppearsOn: kept per library read and artist; a new library read asks again; failures are not kept", async () => {
  let known = new Map([["a", { oid: "1" }]]);
  let reads = 0, answer = { status: "ok", albums: [{ title: "Thriller", artist: "Michael Jackson", roles: ["Played"] }] };
  let t = 1000;
  const a = createAppearsOn({ link: { session: () => ({}) }, inTurn: (fn) => fn(), off: () => null, known: () => known, profile: () => null,
    now: () => t, read: async () => { reads++; return answer; } });
  assert.equal((await a.read("Steve Lukather")).albums.length, 1);
  await a.read("steve  LUKATHER");
  assert.equal(reads, 1, "the same artist, by name as normName has it, is read once");
  t += 25 * 3600 * 1000;
  await a.read("Steve Lukather");
  assert.equal(reads, 2, "a day on, read again");
  known = new Map(known);
  await a.read("Steve Lukather");
  assert.equal(reads, 3, "a new library read (a new Map) is read again");
  answer = { status: "failed", why: "x" };
  known = new Map(known);
  await a.read("Steve Lukather"); await a.read("Steve Lukather");
  assert.equal(reads, 5, "a failure is not kept");
});

test("createAppearsOn: one read per artist at a time; past waitMs \"pending\", the read going on and kept", async () => {
  const known = new Map();
  let reads = 0, finish;
  const a = createAppearsOn({ link: { session: () => ({}) }, inTurn: (fn) => fn(), off: () => null, known: () => known, profile: () => null,
    read: () => { reads++; return new Promise((res) => { finish = res; }); } });
  const first = await a.read("Steve Lukather", { waitMs: 20 });
  assert.deepEqual(first, { status: "pending" });
  const second = a.read("Steve Lukather");
  assert.equal(reads, 1, "the running read is shared, not doubled");
  finish({ status: "ok", albums: [] });
  assert.equal((await second).status, "ok");
  assert.equal((await a.read("Steve Lukather", { waitMs: 20 })).status, "ok", "kept when it ended");
  assert.equal(reads, 1);
});

const slimAlbum = (al) => ({ offset: al.offset, title: al.title, subtitle: al.subtitle });
const LIB = [
  { offset: 1, title: "Luke", subtitle: "Steve Lukather" },
  { offset: 2, title: "Thriller", subtitle: "Michael Jackson" },
  { offset: 3, title: "IV", subtitle: "Toto" },
  { offset: 4, title: "Duets", subtitle: "Someone & Steve Lukather" },
  { offset: 5, title: "Silk Degrees", subtitle: "Boz Scaggs" },
];
const tileOf = (title, artist) => { const al = LIB.find((x) => x.title === title && x.subtitle === artist); return al ? slimAlbum(al) : null; };

test("appearsTiles: the artist's own left out, one tile per record, roles merged, \"Featured\" kept, ordered by first role", () => {
  const r = appearsTiles([
    { title: "Luke", artist: "Steve Lukather", roles: ["Played"] },          // their own: under Albums already
    { title: "Thriller", artist: "Michael Jackson", roles: ["Played"] },
    { title: "Silk Degrees", artist: "Boz Scaggs", roles: ["Wrote"] },
    { title: "IV", artist: "Toto", roles: ["Produced", "Wrote"] },
    { title: "IV", artist: "Toto", roles: ["Played"] },
    { title: "Gone", artist: "Nobody", roles: ["Played"] },                  // not a record Rouen can tile
  ], { tileOf, own: new Set([1]), featured: [LIB[3]], slimAlbum });
  assert.deepEqual(r.albums.map((a) => [a.title, a.roles.join(",")]), [
    ["Thriller", "Played"], ["IV", "Played,Produced,Wrote"], ["Silk Degrees", "Wrote"], ["Duets", "Featured"],
  ]);
  assert.equal(r.notInLibrary, 1);
  assert.equal(r.albums[0].offset, 2, "the library's own tile, its offset as of now");
});

function route(deps) {
  const routes = {};
  mountArtistAlbums({ get: (p, fn) => { routes[p] = fn; } }, Object.assign({
    artistLibraryAlbums: () => ({ primary: [LIB[0]], featured: [LIB[3]] }), slimAlbum, splitCreditIntoArtists: (c) => [c], normalize: (s) => s,
  }, deps));
  const h = routes["/api/artist/appears-on"];
  return async (query) => {
    let status = 200, body = null;
    const headers = {};
    const res = { set(k, v) { headers[k] = v; return this; }, status(c) { status = c; return this; }, json(b) { body = b; return this; } };
    await h({ query }, res);
    return { status, body, headers };
  };
}

test("GET /api/artist/appears-on: tiles with roles on \"ok\"; every other answer passed through with no list", async () => {
  const ok = route({ tileOf, appearsOn: async () => ({ status: "ok", albums: [{ title: "Thriller", artist: "Michael Jackson", roles: ["Played"] }], capped: true }) });
  const r = await ok({ artist: "Steve Lukather" });
  assert.equal(r.headers["Cache-Control"], "no-store", "offsets are the library's as of this request");
  assert.equal(r.body.status, "ok");
  assert.deepEqual(r.body.albums.map((a) => [a.title, a.roles]), [["Thriller", ["Played"]], ["Duets", ["Featured"]]]);
  assert.equal(r.body.capped, true);
  assert.equal((await ok({})).status, 400);
  for (const status of ["pending", "unresolved", "off", "failed"]) {
    const other = route({ tileOf, appearsOn: async () => ({ status, why: "because" }) });
    assert.deepEqual((await other({ artist: "Steve Lukather" })).body, { status, albums: [], why: "because" });
  }
  assert.deepEqual((await route({})({ artist: "X" })).body, { status: "off", albums: [] }, "no native read wired: off");
  const throws = route({ tileOf, appearsOn: async () => { throw new Error("boom"); } });
  assert.deepEqual((await throws({ artist: "X" })).body, { status: "failed", albums: [], why: "boom" });
});
