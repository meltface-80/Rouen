"use strict";
// ---------------------------------------------------------------------------
// The Recently added probe (dev/design/recently-added.md §3, 2.0.6-t5): the ordered album query's bytes and its one
// shared declaration of AlbumQueryCriteria; the verdict that keeps a misread or short read from passing as Roon's order;
// the newest-first read, in the rows' order, each page released and its rows let go from the graph, the query disposed
// once; the fields a type declares; and the route. The probe end to end is run on the owner's Core, not this fake.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { BinaryWriter } = require("../../lib/roon-direct/wire");
const { SIG, ALLOWED, openAlbumQuery, openAlbumQueryOrdered } = require("../../lib/roon-direct/methods");
const { verdictOf, compare, membersOf, orderedRead, readingsOf, createAddedProbe, IMPORT_DATE, ASCENDING, DESCENDING } = require("../../lib/roon-direct/added-probe");
const { mountRoonAddedProbe } = require("../../lib/routes/roon-added-probe");

const AQC = "Sooloos.Broker.Api.AlbumQueryCriteria";
const AQO = "Sooloos.Broker.Api.AlbumQueryOrdering";

function fakeG(onCall) {
  const declared = [], sent = [], noReply = [];
  return {
    declared, sent, noReply,
    defineType(name, members) { declared.push({ name, members }); return declared.length; },
    uncertain() { return ""; },
    call(oid, sig, args) { sent.push({ oid, sig, args }); return onCall(sig, args, oid); },
    callNoReply(oid, sig) { noReply.push({ oid, sig }); return true; },
  };
}
const okQuery = (qid) => () => ({ success: true, payload: new BinaryWriter().long(qid).toBuffer() });

test("the ordered query: VirtualAlbumQuery, ImportDate and the direction inline, AlbumQueryCriteria declared as every album query's", async () => {
  assert.deepEqual([IMPORT_DATE, ASCENDING, DESCENDING], [1, 1, 2], "Roon's AlbumOrdering ImportDate, OrderingDirection (focus-map.js)");
  assert.ok(ALLOWED.has(SIG.albumQuery), "no new method: the allowlisted album query");
  const g = fakeG(okQuery(9n));
  assert.equal(await openAlbumQueryOrdered(/** @type {any} */ (g), 1n, Buffer.from([1]), IMPORT_DATE, DESCENDING, 100), 9n);
  await openAlbumQuery(/** @type {any} */ (g), 1n, Buffer.from([1]), null, 100);
  assert.equal(g.sent[0].sig, SIG.albumQuery);
  const crit = g.declared.filter((d) => d.name === AQC);
  assert.equal(crit.length, 2);
  assert.deepEqual(crit[0].members, crit[1].members, "one declaration a connection: the library read's and this one's the same");
  const order = g.declared.find((d) => d.name === AQO);
  assert.ok(order, "the order sent inline as its own struct");
  // The order's body: member 1 (Ordering) = 1, member 2 (Direction) = 2, then the end (0), each as BinaryWriter writes it.
  const want = Buffer.concat([new BinaryWriter().flexInt(1).toBuffer(), new BinaryWriter().integer(1).toBuffer(),
    new BinaryWriter().flexInt(2).toBuffer(), new BinaryWriter().integer(2).toBuffer(), new BinaryWriter().flexInt(0).toBuffer()]);
  assert.ok(g.sent[0].args.includes(want), "ImportDate, Descending, as sent");
});

test("verdictOf: ordered only on equal Counts, a whole read of library albums in order, and the oldest found at the end", () => {
  const desc = { count: 300, rows: 300, matched: 300, indexInOrder: true, budgetReached: false };
  const asc = { count: 300, rows: 100, atEnd: 1, sameAsNewest: false };
  assert.match(verdictOf({ control: 300, desc, asc }), /^ordered: 300 albums.*— compare/);
  assert.doesNotMatch(verdictOf({ control: 300, desc, asc }), /small library/);
  assert.match(verdictOf({ control: null, desc, asc }), /^unknown: the unfiltered control/);
  assert.match(verdictOf({ control: 300, desc: { count: null, error: "refused" }, asc }), /^unknown: the newest-first read failed \(refused\)/);
  assert.match(verdictOf({ control: 301, desc, asc }), /^misread: .*300.*301/, "THE one: a Count other than the control's is the order not taken");
  assert.match(verdictOf({ control: 300, desc: { ...desc, budgetReached: true, rows: 200 }, asc }), /^unknown: .*page budget, 200 of 300/);
  assert.match(verdictOf({ control: 300, desc: { ...desc, rows: 299, matched: 299 }, asc }), /^short: 299 of 300/);
  assert.match(verdictOf({ control: 300, desc: { ...desc, matched: 298 }, asc }), /^unpaired: 2 of/);
  assert.match(verdictOf({ control: 300, desc: { ...desc, indexInOrder: false }, asc }), /^unordered/);
  assert.match(verdictOf({ control: 300, desc, asc: { ...asc, atEnd: 0.5 } }), /^not reversed: only 50%/);
  assert.match(verdictOf({ control: 300, desc, asc: { count: null, error: "x" } }), /^unknown: the oldest-first/);
  assert.match(verdictOf({ control: 300, desc: { ...desc, indexInOrder: null }, asc }), /^ordered/, "rows without an Index: their order is the pages'");
});

test("verdictOf: never ordered on an empty library, a Count that never came, a short page, or the order ignored (the review)", () => {
  const desc = { count: 300, rows: 300, matched: 300, indexInOrder: true, budgetReached: false };
  const asc = { count: 300, rows: 100, atEnd: 1, sameAsNewest: false };
  assert.match(verdictOf({ control: 0, desc: { ...desc, count: 0, rows: 0, matched: 0 }, asc: { ...asc, count: 0, rows: 0 } }), /^unknown: the library holds no albums/);
  assert.match(verdictOf({ control: 0, controlInferred: true, desc, asc }), /^unknown: the unfiltered control's Count never came/);
  assert.match(verdictOf({ control: 300, desc: { ...desc, inferred: true }, asc }), /^unknown: the newest-first query's Count never came/);
  assert.match(verdictOf({ control: 300, desc, asc: { ...asc, inferred: true } }), /^unknown: the oldest-first/);
  assert.match(verdictOf({ control: 300, desc, asc: { ...asc, rows: 0, short: true, atEnd: 0 } }), /^unknown: the oldest-first page came short \(0/, "a page that never came isn't blamed on the order");
  assert.match(verdictOf({ control: 1, desc: { ...desc, count: 1, rows: 1, matched: 1 }, asc: { ...asc, count: 1, rows: 1 } }), /^unknown: one album/);
  // THE one: a library under two pages, the order ignored — both reads in the server's own order, every check else passing.
  const small = { count: 105, rows: 105, matched: 105, indexInOrder: null, budgetReached: false };
  assert.match(verdictOf({ control: 105, desc: small, asc: { count: 105, rows: 100, atEnd: 0.95, sameAsNewest: true } }), /^ignored:/);
  assert.match(verdictOf({ control: 105, desc: small, asc: { count: 105, rows: 100, atEnd: 0.4, sameAsNewest: false } }), /^ordered: 105 .*small library/,
    "a small library can't be told by its end, only by the directions differing");
});

test("compare: the oldest-first page at the newest-first end, and whether it came in the newest-first order", () => {
  const desc = ["a", "b", "c", "d", "e", "f"];
  assert.deepEqual(compare(desc, ["f", "e"]), { atEnd: 1, sameAsNewest: false });
  assert.deepEqual(compare(desc, ["e", "a"]), { atEnd: 0.5, sameAsNewest: false }, "the tail, not the head");
  assert.deepEqual(compare(desc, ["a", "b"]), { atEnd: 0, sameAsNewest: true });
  assert.deepEqual(compare(["a"], ["a"]), { atEnd: 1, sameAsNewest: false }, "one album is neither");
  assert.deepEqual(compare(desc, []), { atEnd: 0, sameAsNewest: false });
});

test("membersOf: a declared type's members by short name, and those that may hold a date added", () => {
  const graph = { types: new Map([[3, { name: "Sooloos.Broker.Api.AlbumLite", members: [
    { name: "string Sooloos.Broker.Api.AlbumLite::Title", propType: 20 }, { name: "Sooloos.NullDate Sooloos.Broker.Api.AlbumLite::ImportDate", propType: 23 },
    { name: "int Sooloos.Broker.Api.AlbumLite::ContentSource", propType: 9 }] }]]) };
  assert.deepEqual(membersOf(graph, /(?:^|\.)AlbumLite$/), { type: "Sooloos.Broker.Api.AlbumLite", members: ["Title", "ImportDate", "ContentSource"], dateLike: ["ImportDate"],
    declared: [{ member: "Sooloos.NullDate Sooloos.Broker.Api.AlbumLite::ImportDate", propType: 23 }] });
  assert.equal(membersOf(graph, /Nope$/), null);
  assert.equal(membersOf({}, /AlbumLite$/), null, "a graph that holds no types");
});

/** A graph with the query (its Count), and rows pushed a page at a time when a page is retained. */
function world(n, opts = {}) {
  const QID = 5n;
  const objects = new Map();
  const forgotten = [];
  const graph = { onObject: null, objects, get: (id) => (id === QID ? { fields: { "int X::Count": n } } : objects.get(String(id)) || null),
    forget: (oid) => { forgotten.push(oid); objects.delete(String(oid)); } };
  const row = (i) => ({ typeName: "Sooloos.Broker.Api.VirtualQueryElement<Sooloos.Broker.Api.AlbumLite>", oid: BigInt(10000 + i),
    fields: Object.assign({ "Sooloos.Broker.Api.AlbumLite X::Data": { $ref: BigInt(100 + i) } }, opts.index ? { "int X::Index": opts.index(i) } : {}) });
  const heldAtRetain = [];
  const g = fakeG((sig, args) => {
    if (sig === SIG.albumRetainPage) {
      heldAtRetain.push(objects.size);
      const page = args.readInt32BE ? Number(new DataView(args.buffer, args.byteOffset, args.length).getInt8(0)) : 0;
      const p = opts.pages ? opts.pages.shift() : page;
      for (let i = p * 2; i < Math.min(n, p * 2 + 2); i++) { const r = row(i); objects.set(String(r.oid), r); if (graph.onObject) graph.onObject(r); }
      return { success: true, payload: Buffer.alloc(0) };
    }
    return okQuery(QID)();
  });
  return { g, graph, forgotten, heldAtRetain };
}
const lifetime = () => ({ queriesOpened: 0, queriesDisposed: 0, pagesRetained: 0, pagesReleased: 0, unsent: 0 });
const byOid = (n) => new Map(Array.from({ length: n }, (_, i) => [String(100 + i), { oid: String(100 + i), title: "T" + i, artist: "A" + i, contentSource: 7 }]));

test("orderedRead: every album in the rows' order, named from the library read, each page released and its rows let go", async () => {
  const { g, graph, forgotten, heldAtRetain } = world(5, { pages: [0, 1, 2] });
  const o = { libraryOid: 1n, profileId: Buffer.from([1]), timeoutMs: 300, pageSize: 2, countGraceMs: 10, lifetime: lifetime(), byOid: byOid(4) };
  const r = await orderedRead({ g, graph }, o, DESCENDING, 300);
  assert.deepEqual(r.ids, ["100", "101", "102", "103", "104"], "in the order the rows came");
  assert.equal(r.count, 5);
  assert.equal(r.rows, 5);
  assert.equal(r.matched, 4, "one album not in the library read");
  assert.deepEqual(r.first[0], { title: "T0", by: "A0", contentSource: 7 });
  assert.deepEqual(r.first[4], { oid: "104", inLibrary: false });
  assert.equal(r.budgetReached, false);
  assert.equal(r.indexInOrder, null, "rows without an Index");
  assert.equal(o.lifetime.pagesRetained, 3);
  assert.equal(o.lifetime.pagesReleased, 3, "every page retained is released");
  assert.equal(o.lifetime.queriesOpened, 1);
  assert.equal(o.lifetime.queriesDisposed, 1, "the query disposed once");
  assert.equal(forgotten.length, 5, "THE one: each row let go once its page is read — a whole library on native mode's connection");
  assert.equal(graph.objects.size, 0);
  assert.deepEqual(heldAtRetain, [0, 0, 0], "and page by page: no row of a page is still held when the next is asked");
});

test("orderedRead: a budget reached is said, and a row's Index read", async () => {
  const { g, graph } = world(6, { pages: [0, 1], index: (i) => i * 3 });
  const o = { libraryOid: 1n, profileId: Buffer.from([1]), timeoutMs: 300, pageSize: 2, countGraceMs: 10, lifetime: lifetime(), byOid: byOid(6) };
  const r = await orderedRead({ g, graph }, o, ASCENDING, 2);
  assert.equal(r.rows, 4);
  assert.equal(r.budgetReached, true);
  assert.equal(r.indexInOrder, true);
  assert.equal(r.first[1].index, 3, "each row's Index reported with its album");
  const back = world(4, { pages: [0, 1], index: (i) => 10 - i });
  const r2 = await orderedRead({ g: back.g, graph: back.graph }, { ...o, lifetime: lifetime() }, ASCENDING, 300);
  assert.equal(r2.indexInOrder, false, "rows whose Index runs backwards");
});

test("orderedRead: a short page is said as short, not as the budget (the review)", async () => {
  const { g, graph } = world(6, { pages: [0, 1, 9] });   // the third page brings nothing
  const o = { libraryOid: 1n, profileId: Buffer.from([1]), timeoutMs: 100, pageSize: 2, countGraceMs: 10, lifetime: lifetime(), byOid: byOid(6) };
  const r = await orderedRead({ g, graph }, o, DESCENDING, 3);
  assert.equal(r.rows, 4);
  assert.equal(r.short, true);
  assert.equal(r.budgetReached, false);
  assert.match(verdictOf({ control: 6, desc: r, asc: { count: 6, rows: 2, atEnd: 1, sameAsNewest: false } }), /^short: 4 of 6/);
});

test("orderedRead disposes its query when the Core refuses a page", async () => {
  const graph = { onObject: null, objects: new Map(), get: () => ({ fields: { "int X::Count": 4 } }), forget() {} };
  const g = fakeG((sig) => (sig === SIG.albumRetainPage ? { success: false, status: "NotFound" } : okQuery(5n)()));
  const o = { libraryOid: 1n, profileId: Buffer.from([1]), timeoutMs: 100, pageSize: 2, countGraceMs: 10, lifetime: lifetime(), byOid: byOid(4) };
  const r = await orderedRead({ g, graph }, o, DESCENDING, 300);
  assert.match(r.error, /refused page 0/);
  assert.equal(o.lifetime.queriesDisposed, 1);
});

test("the probe asks nothing when native mode is off or its library not yet read", async () => {
  const off = createAddedProbe({ link: null, inTurn: (f) => f(), off: () => "Native mode is off.", known: () => null, profile: () => null });
  assert.deepEqual(await off.run(), { error: "Native mode is off.", status: 503 });
  const s = { graph: { maxObjects: 1e6, objects: new Map() }, root: {} };
  const unread = createAddedProbe({ link: { session: () => s }, inTurn: (f) => f(), off: () => null, known: () => null, profile: () => null });
  assert.match((await unread.run()).error, /hasn't been read/);
});

test("the route: nothing asked without run=1; max_pages checked; the probe's answer and errors as they came", async () => {
  let handler, asked = null;
  mountRoonAddedProbe({ get: (p, h) => { assert.equal(p, "/api/debug/roon-added"); handler = h; } },
    { run: async (o) => { asked = o; return o.maxPages === 7 ? { error: "busy", status: 409 } : { verdict: "ordered" }; } });
  const call = (query) => new Promise((resolve) => {
    const res = { code: 200, set() {}, status(c) { this.code = c; return this; }, json(b) { resolve({ status: this.code, body: b }); } };
    handler({ query }, res);
  });
  const how = await call({});
  assert.equal(how.body.ran, false);
  assert.equal(asked, null, "THE one: without run=1 nothing is asked of the server");
  assert.equal((await call({ run: "1", max_pages: "0" })).status, 400);
  assert.deepEqual((await call({ run: "1" })).body, { verdict: "ordered" });
  assert.deepEqual(asked, { maxPages: undefined });
  assert.deepEqual(await call({ run: "1", max_pages: "7" }), { status: 409, body: { error: "busy" } });
  let none;
  mountRoonAddedProbe({ get: (p, h) => { none = h; } }, null);
  const absent = await new Promise((resolve) => {
    const res = { code: 200, set() {}, status(c) { this.code = c; return this; }, json(b) { resolve({ status: this.code, body: b }); } };
    none({ query: { run: "1" } }, res);
  });
  assert.equal(absent.status, 503);
});

// 2.0.6-t7: the owner's run (2026-11-23) showed AlbumLite declares ImportDate; its form isn't known. The library read
// keeps it raw (albums.js importOf), and the probe reads it every way it may be written, for the owner to compare with
// Roon's own dates.
const { importOf } = require("../../lib/roon-direct/albums");

test("importOf: an album's ImportDate kept raw, whatever its form; null when it didn't come", () => {
  const obj = (v) => ({ fields: v === undefined ? {} : { "System.DateTime Sooloos.Broker.Api.AlbumLite::ImportDate": v } });
  assert.equal(importOf(obj(638679348000000001n)), "638679348000000001", "a long's digits, whole (it doesn't fit a Number)");
  assert.equal(importOf(obj(42)), "42");
  assert.equal(importOf(obj(Buffer.from([0xbd, 0xc8]))), "hex:bdc8");
  assert.equal(importOf(obj(undefined)), null);
  assert.equal(importOf(obj(null)), null);
  assert.equal(importOf(obj({ $type: "X", "long X::Ticks": 5n })), '{"$type":"X","long X::Ticks":"5"}');
});

test("readingsOf: the raw ImportDate as .NET ticks, Unix time and a NullDate, the one that fits showing itself", () => {
  // Fixed values, worked out apart from the code (the review): 1970-01-01 is 621,355,968,000,000,000 ticks.
  assert.equal(readingsOf("621355968000000000").dotnetTicks, null, "1970 is before 1990: left out");
  const t2024 = "638679168000000000";   // 2024-11-23T00:00:00Z: (1732320000000 + 62135596800000) × 10,000
  assert.equal(readingsOf(t2024).dotnetTicks, "2024-11-23T00:00:00.000Z");
  assert.equal(readingsOf(t2024).unixMs, null, "a tick count read as milliseconds is far past 2100");
  assert.equal(readingsOf(t2024).nullDate, null);
  // A DateTime's ToBinary: the kind (UTC, 01) in the top two bits.
  const binary = String((1n << 62n) | 638679168000000000n);
  assert.equal(readingsOf(binary).dotnetTicks, null, "the kind bits put it past 2100 as plain ticks");
  assert.equal(readingsOf(binary).dotnetBinary, "2024-11-23T00:00:00.000Z");
  assert.equal(readingsOf("1732320000000").unixMs, "2024-11-23T00:00:00.000Z");
  assert.equal(readingsOf("1732320000").unixSeconds, "2024-11-23T00:00:00.000Z");
  const nd = String((2024 << 16) | (11 << 8) | 23);
  assert.deepEqual(readingsOf(nd), { dotnetTicks: null, dotnetBinary: null, unixMs: null, unixSeconds: null, nullDate: "2024-11-23" },
    "a NullDate's integer is no other form's plausible date (1974 as Unix seconds: left out)");
  assert.deepEqual(readingsOf("-5"), { dotnetTicks: null, dotnetBinary: null, unixMs: null, unixSeconds: null, nullDate: null });
  assert.deepEqual(readingsOf('{"$type":"X"}'), { other: '{"$type":"X"}' });
  assert.equal(readingsOf(null), null);
});

test("readingsOf: bytes holding a NullDate's integer are read as its date (the review)", () => {
  const { BinaryWriter } = require("../../lib/roon-direct/wire");
  const hex = new BinaryWriter().integer((2024 << 16) | (11 << 8) | 23).toBuffer().toString("hex");
  const r = readingsOf("hex:" + hex).bytes;
  assert.equal(r.integerAsNullDate, "2024-11-23", "THE one: the protocol's own integer, as a Focus's dates are (§12.12)");
  assert.equal(readingsOf("hex:bdc88000").bytes.integerAsNullDate, null, "the owner's Focus date of 1970-00-00 is before 1990");
  assert.equal(readingsOf("hex:zz").bytes.integerAsNullDate, null, "bytes that are no integer: no date");
});

test("membersOf: each date-like member's declaration and property type, so its form is known", () => {
  const graph = { types: new Map([[3, { name: "Sooloos.Broker.Api.AlbumLite", members: [
    { name: "string Sooloos.Broker.Api.AlbumLite::Title", propType: 20 }, { name: "System.DateTime Sooloos.Broker.Api.AlbumLite::ImportDate", propType: 8 }] }]]) };
  assert.deepEqual(membersOf(graph, /(?:^|\.)AlbumLite$/).declared, [{ member: "System.DateTime Sooloos.Broker.Api.AlbumLite::ImportDate", propType: 8 }]);
});
