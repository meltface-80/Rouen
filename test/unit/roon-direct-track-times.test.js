"use strict";
// ---------------------------------------------------------------------------
// v1.9.70-t14 (lib/roon-direct/track-times.js, lib/routes/album-track-times.js; dev/design/native-remote.md §16.6):
// an album's track lengths from Library::GetAlbumTrackLites, the read the owner's server answered on 2026-10-28 — a
// LengthPrefixed list of TrackLites by reference, pushed with the answer, each with its Title, LengthSeconds,
// TrackNumber and MediaNumber. The graph is objects.js's own; the answer is built here in that form (and the bare one),
// not evidence of the server's: the owner's run of the reads probe is.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { ObjectGraph, P } = require("../../lib/roon-direct/objects");
const { BinaryWriter } = require("../../lib/roon-direct/wire");
const { SIG, ALLOWED } = require("../../lib/roon-direct/methods");
const { createRoonTrackTimes } = require("../../lib/roon-direct/track-times");
const { listOf } = require("../../lib/roon-direct/answer-list");
const { mountTrackTimes } = require("../../lib/routes/album-track-times");

const A = "Sooloos.Broker.Api.";
const TYPES = {
  10: ["TrackLite", [[`string ${A}TrackLite::Title`, P.String], [`int ${A}TrackLite::LengthSeconds`, P.Int],
    [`int ${A}TrackLite::TrackNumber`, P.Int], [`int ${A}TrackLite::MediaNumber`, P.Int]]],
};
const frame = (oid, tid, fields) => {
  const w = new BinaryWriter().long(oid).flexInt(tid);
  for (const [i, write] of fields) { w.flexInt(i); write(w); }
  return { cmd: 3, isResponse: false, body: w.flexInt(0).toBuffer() };
};
const ref = (oid) => new BinaryWriter().long(oid).toBuffer();

// Morph the Cat, as the owner's server sent it — but a two-disc set, sent out of order, to prove the order is put back.
const TRACKS = [[701n, "H Gang", 315, 2, 1], [702n, "Morph the Cat", 409, 1, 1], [703n, "What I Do", 361, 1, 2], [704n, "Morph the Cat (Reprise)", 171, 9, 2]];

function rig(o = {}) {
  const graph = new ObjectGraph();
  for (const [id, [name, members]] of Object.entries(TYPES)) {
    graph.types.set(Number(id), { id: Number(id), name: A + name, members: members.map(([n, p]) => ({ name: n, propType: p })) });
  }
  const push = (...a) => graph.ingest(frame(...a));
  const calls = [];
  const answer = o.answer || (() => {
    for (const [oid, title, secs, num, disc] of o.tracks || TRACKS) {
      const fields = [[1, (w) => w.string(title)], [3, (w) => w.integer(num)], [4, (w) => w.integer(disc)]];
      if (secs !== null) fields.splice(1, 0, [2, (w) => w.integer(secs)]);
      push(oid, 10, fields);
    }
    const named = (o.tracks || TRACKS).map(([oid]) => oid).concat(o.extraRefs || []);
    const inner = new BinaryWriter().flexInt(named.length);
    for (const oid of named) inner.long(oid);
    const body = inner.toBuffer();
    return o.bare ? body : new BinaryWriter().integer(body.length).bytes(body).toBuffer();
  });
  if (o.before) o.before(push);
  let uncertain = o.uncertain || "";
  const s = { graph, root: { library: { oid: 3n } },
    g: {
      uncertain: () => uncertain,
      call: async (oid, sig, args) => {
        calls.push({ oid: String(oid), sig, args });
        if (o.refuse) return { success: false, status: "InvalidArguments" };
        return { success: true, status: "Success", payload: answer() };
      } } };
  const known = new Map([["morph the cat||donald fagen", { oid: "406162", title: "Morph the Cat", artist: "Donald Fagen" }]]);
  const times = createRoonTrackTimes({ link: o.noLink ? null : { session: () => (o.noSession ? null : s) }, inTurn: (fn) => fn(),
    off: () => o.off || null, on: () => !!o.on, known: () => (o.notRead ? null : known), keyOf: (t, a) => `${t}||${a}`.toLowerCase(), waitMs: 50 });
  return { times, calls, graph };
}

test("THE one: every track's length, in disc and track order, from the one read the owner's server answered", async () => {
  const { times, calls } = rig();
  const got = await times.album("Morph the Cat", "Donald Fagen");
  assert.equal(got.read, true, JSON.stringify(got));
  assert.deepEqual(got.tracks, [
    { disc: 1, number: 1, title: "Morph the Cat", seconds: 409 }, { disc: 1, number: 2, title: "H Gang", seconds: 315 },
    { disc: 2, number: 1, title: "What I Do", seconds: 361 }, { disc: 2, number: 9, title: "Morph the Cat (Reprise)", seconds: 171 }]);
  // One call, to the library, with the album by its object id; on the allowlist.
  assert.deepEqual(calls.map((c) => [c.oid, c.sig]), [["3", SIG.albumTrackLites]]);
  assert.deepEqual(calls[0].args, ref(406162n));
  assert.ok(ALLOWED.has(SIG.albumTrackLites));
});

test("the bare list form is read too; a track sent without a length is left out", async () => {
  const { times } = rig({ bare: true, tracks: [[801n, "One", 100, 1, 1], [802n, "Two", null, 2, 1]] });
  const got = await times.album("Morph the Cat", "Donald Fagen");
  assert.deepEqual(got, { read: true, tracks: [{ disc: 1, number: 1, title: "One", seconds: 100 }] });
});

test("nothing asked, and why said, when it can't be: off, not connected, not read yet, being checked, not there, refused, unreadable", async () => {
  const cases = [
    [{ off: "Native mode is off." }, { read: false, why: "Native mode is off." }, 0],
    [{ noSession: true }, { wait: true }, 0], [{ notRead: true }, { wait: true }, 0], [{ uncertain: "a call unanswered" }, { wait: true }, 0],
    [{ off: "Native mode is checking your server after an update.", on: true }, { wait: true }, 0],
    [{ refuse: true }, { read: false }, 1], [{ answer: () => Buffer.from([0xff]) }, { read: false }, 1],
    [{ answer: () => Buffer.from([0]) }, { read: false }, 1],
    // a TrackLite named but never pushed: not a list cut short, but asked again
    [{ extraRefs: [999n] }, { wait: true }, 1],
  ];
  for (const [o, want, n] of cases) {
    const { times, calls } = rig(o);
    const got = await times.album("Morph the Cat", "Donald Fagen");
    const said = JSON.stringify([o, got], (k, v) => (typeof v === "bigint" ? String(v) : v));
    for (const [k, v] of Object.entries(want)) assert.deepEqual(got[k], v, said);
    assert.equal(got.read, false);
    assert.equal(typeof got.why, "string");
    assert.equal(calls.length, n, said);
  }
  const { times, calls } = rig();
  const none = await times.album("Gaucho", "Steely Dan");
  assert.equal(none.read, false);
  assert.equal(calls.length, 0, "an album the server doesn't hold: nothing asked");
});

/** The route, driven without Express: the handler it registers, and a response that records. */
function route(album, o) {
  let handler = null;
  mountTrackTimes({ get: (path, fn) => { assert.equal(path, "/api/album/track-times"); handler = fn; } }, { album }, o);
  return async (query) => {
    const res = { code: 200, body: null, set() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await handler({ query }, res);
    return res;
  };
}

test("the route: ok kept for a while (no second ask), pending and none said, a title required", async () => {
  let asks = 0, t = 0;
  const ask = route(async () => { asks++; return { read: true, tracks: [{ disc: 1, number: 1, title: "A", seconds: 60 }] }; }, { now: () => t });
  const first = await ask({ title: "Morph the Cat", artist: "Donald Fagen" });
  assert.deepEqual(first.body, { tracks: [{ disc: 1, number: 1, title: "A", seconds: 60 }], status: "ok" });
  await ask({ title: "morph the cat", artist: "donald fagen" });
  assert.equal(asks, 1, "asked again within the while");
  t = 31 * 60 * 1000;
  await ask({ title: "Morph the Cat", artist: "Donald Fagen" });
  assert.equal(asks, 2, "not asked again after the while");
  assert.equal((await ask({})).code, 400);

  const pending = route(async () => ({ read: false, wait: true, why: "connecting" }));
  assert.deepEqual((await pending({ title: "X" })).body, { tracks: [], status: "pending", why: "connecting" });
  const none = route(async () => ({ read: false, why: "Native mode is off." }));
  assert.deepEqual((await none({ title: "X" })).body, { tracks: [], status: "none", why: "Native mode is off." });
});

test("THE review: what the read brought into the graph is let go once read; what the graph held before stays", async () => {
  // 702 (Morph the Cat) was held before the read — the zone playing it, say — and is only named again.
  const { times, graph } = rig({ before: (push) => push(702n, 10, [[1, (w) => w.string("Morph the Cat")], [2, (w) => w.integer(409)], [3, (w) => w.integer(1)], [4, (w) => w.integer(1)]]) });
  const got = await times.album("Morph the Cat", "Donald Fagen");
  assert.equal(got.read, true);
  assert.equal(got.tracks.length, 4);
  assert.deepEqual([701n, 703n, 704n].map((o) => graph.get(o)), [undefined, undefined, undefined], "the TrackLites first pushed by this read: let go");
  assert.ok(graph.get(702n), "the one held before: kept");
});

test("the shared list reader gives its form, and a null answer is an empty bare list", () => {
  const graph = new ObjectGraph();
  assert.deepEqual(listOf(graph, Buffer.from([0])), { form: "bare list", items: [] });
  assert.equal(listOf(graph, Buffer.from([0xff])), null);
});

test("v1.9.71-t1: the album index follows what the connection was sent as it grows (a failed read adds to the same map)", () => {
  const { albumIndex } = require("../../lib/roon-direct/albums");
  const keyOf = (t, a) => `${t}||${a}`.toLowerCase();
  const known = new Map([["1", { oid: "1", title: "Morph the Cat", artist: "Donald Fagen" }]]);
  assert.ok(albumIndex(known, keyOf).get("morph the cat||donald fagen"));
  known.set("2", { oid: "2", title: "Kamakiriad", artist: "Donald Fagen" });
  assert.equal((albumIndex(known, keyOf).get("kamakiriad||donald fagen") || {}).oid, "2", "an album added after the index was built");
  // sent again, renamed: a fresh copy under the same id, the size the same
  known.set("1", { oid: "1", title: "Morph the Cat (Deluxe)", artist: "Donald Fagen" });
  assert.equal((albumIndex(known, keyOf).get("morph the cat (deluxe)||donald fagen") || {}).oid, "1", "an album sent again under a new title");
});
