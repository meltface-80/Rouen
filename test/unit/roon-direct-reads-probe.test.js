"use strict";
// ---------------------------------------------------------------------------
// N7-0, the reads probe (lib/roon-direct/reads-probe.js, v1.9.70-t3, native-remote.md §16.4): the reads full native
// mode rests on — the zone's NowPlaying and Queue as held, Queue::GetItems, Library::GetAlbum, GetAlbumTrackLites,
// GetPerformer, GetToplevelGenres, GetAllTagLites and the album's Image — each sent once, each answer read whole by
// the graph's own reader, one refused leaving the rest. The graph is objects.js's own; the answers are built here in
// the forms this design reads (a reference, a LengthPrefixed or bare list, a DataList), not evidence of the server's.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { ObjectGraph, P } = require("../../lib/roon-direct/objects");
const { BinaryWriter } = require("../../lib/roon-direct/wire");
const { SIG } = require("../../lib/roon-direct/methods");
const { createReadsProbe } = require("../../lib/roon-direct/reads-probe");

const A = "Sooloos.Broker.Api.";
const LIST = (el) => `System.Collections.Generic.IList<${A}${el}>`;
const TYPES = {
  1: ["Zone", [[`System.Sooid ${A}Zone::ZoneId`, P.Sooid], [`string ${A}Zone::Name`, P.String], [`${A}TransportItem ${A}Zone::NowPlaying`, P.Object], [`${A}Queue ${A}Zone::Queue`, P.Object]]],
  2: ["TransportItem", [[`long ${A}TransportItem::TransportItemId`, P.Long], [`bool ${A}TransportItem::IsCurrent`, P.Bool]]],
  3: ["Queue", [[`int ${A}Queue::Count`, P.Int]]],
  4: ["AlbumLite", [[`string ${A}AlbumLite::Title`, P.String], [`string ${A}AlbumLite::PerformedBy`, P.String]]],
  5: ["Album", [[`string ${A}Album::Title`, P.String], [`${LIST("PerformerLite")} ${A}Album::MainPerformers`, P.LengthPrefixed], [`${A}Image ${A}Album::Image`, P.Object]]],
  6: ["PerformerLite", [[`string ${A}PerformerLite::Name`, P.String]]],
  7: ["Performer", [[`string ${A}Performer::Name`, P.String], [`${A}Biography ${A}Performer::Biography`, P.Object], [`${A}PerformerType ${A}Performer::Type`, P.Enum]]],
  8: ["Image", [[`string ${A}Image::Url`, P.String]]],
  9: ["Biography", [[`string ${A}Biography::Text`, P.String]]],
  10: ["TrackLite", [[`string ${A}TrackLite::Title`, P.String]]],
  11: ["DataList<Sooloos.Broker.Api.TagLite>", []],
  12: ["TagLite", [[`string ${A}TagLite::Name`, P.String]]],
  13: ["Profile", [[`System.Sooid ${A}Profile::ProfileId`, P.Sooid], [`string ${A}Profile::Name`, P.String]]],
};

/** A pushed object: its oid, type, then (index, write) pairs. */
const frame = (oid, tid, fields) => {
  const w = new BinaryWriter().long(oid).flexInt(tid);
  for (const [i, write] of fields) { w.flexInt(i); write(w); }
  return { cmd: 3, isResponse: false, body: w.flexInt(0).toBuffer() };
};
const ref = (oid) => new BinaryWriter().long(oid).toBuffer();

/** A server: a graph holding a zone (playing an item, its queue) and a profile, and answers per method. */
function rig(o = {}) {
  const graph = new ObjectGraph();
  for (const [id, [name, members]] of Object.entries(TYPES)) {
    graph.types.set(Number(id), { id: Number(id), name: A + name, members: members.map(([n, p]) => ({ name: n, propType: p })) });
  }
  const push = (...a) => graph.ingest(frame(...a));
  push(20n, 2, [[1, (w) => w.long(5n)], [2, (w) => w.boolean(true)]]);
  push(21n, 3, [[1, (w) => w.integer(2)]]);
  push(10n, 1, [[1, (w) => w.sooid(Buffer.from("16aa", "hex"))], [2, (w) => w.string("Stereo Fives")], [3, (w) => w.long(20n)], [4, (w) => w.long(21n)]]);
  push(30n, 13, [[1, (w) => w.sooid(Buffer.from("cafe", "hex"))], [2, (w) => w.string("Owner")]]);
  push(50n, 4, [[1, (w) => w.string("Among the Living")], [2, (w) => w.string("Anthrax")]]);
  const calls = [];
  const answers = {
    [SIG.queueItems]: () => {
      push(201n, 2, [[1, (w) => w.long(6n)]]); push(202n, 2, [[1, (w) => w.long(7n)]]);
      const inner = new BinaryWriter().flexInt(2).long(201n).long(202n).toBuffer();
      return new BinaryWriter().integer(inner.length).bytes(inner).toBuffer();
    },
    [SIG.getAlbum]: () => {
      push(301n, 6, [[1, (w) => w.string("Anthrax")]]);
      push(401n, 8, [[1, (w) => w.string("broker:///image/abc.jpg")]]);
      const perf = new BinaryWriter().integer(1).long(301n).toBuffer();
      push(501n, 5, [[1, (w) => w.string("Among the Living")], [2, (w) => w.integer(perf.length).bytes(perf)], [3, (w) => w.long(401n)]]);
      return ref(501n);
    },
    [SIG.albumTrackLites]: () => {
      push(601n, 10, [[1, (w) => w.string("Among the Living")]]); push(602n, 10, [[1, (w) => w.string("Caught in a Mosh")]]);
      return new BinaryWriter().flexInt(2).long(601n).long(602n).toBuffer();
    },
    [SIG.getPerformer]: (args) => {
      assert.deepEqual(args, ref(301n), "the album's main performer, by its object");
      const bio = new BinaryWriter().flexInt(1).string("Thrash metal band from New York.").flexInt(0).toBuffer();
      push(701n, 7, [[1, (w) => w.string("Anthrax")], [2, (w) => w.long(1n).flexInt(9).flexInt(bio.length).bytes(bio)], [3, (w) => w.integer(2)]]);
      return ref(701n);
    },
    [SIG.toplevelGenres]: () => null,
    [SIG.allTagLites]: (args) => {
      assert.deepEqual(args, ref(30n), "the chosen profile, by its object");
      push(802n, 12, [[1, (w) => w.string("Favourites")]]);
      graph.ingest({ cmd: 3, isResponse: false, body: new BinaryWriter().long(801n).flexInt(11).integer(1).long(802n).toBuffer() });
      return ref(801n);
    },
  };
  Object.assign(answers, o.answers || {});
  let uncertain = "";
  const s = { graph, root: { library: { oid: 3n }, profiles: [graph.get(30n)], profileId: null },
    g: {
      uncertain: () => uncertain,
      // A struct's type declared: a frame of its own, recorded as one (the review).
      defineType: (name) => { calls.push({ oid: "-", sig: "DEFTYPE " + name, args: Buffer.alloc(0) }); return 99; },
      call: async (oid, sig, args) => {
        calls.push({ oid: String(oid), sig, args });
        if (o.unanswered === sig) { uncertain = "a call unanswered"; throw new Error("no answer within 10 s"); }
        const a = answers[sig] ? answers[sig](args) : null;
        return a === null ? { success: false, status: "InvalidArguments" } : { success: true, status: "Success", payload: a };
      } } };
  const known = new Map([["among the living||anthrax", { oid: "50", title: "Among the Living", artist: "Anthrax" }]]);
  if (o.forgetLite) graph.forget(50n);
  const probe = createReadsProbe({ link: { session: () => s }, inTurn: o.inTurn || ((fn) => fn()), off: () => o.off || null, known: () => known,
    keyOf: (t, a) => `${t}||${a}`.toLowerCase(), profile: () => "cafe",
    zones: o.zones || (() => [{ zone_id: "16aa", display_name: "Stereo Fives", state: "playing" }]) });
  return { probe, calls, s };
}
const short = (calls) => calls.map((c) => c.sig.replace(/Sooloos\.Broker\.Api\./g, "").replace(/\(.*$/, ""));

test("THE one: every read of §16.4 once, in order, each answer read whole — a refused one leaving the rest", async () => {
  const { probe, calls } = rig();
  const out = await probe.run({ title: "Among the Living", artist: "Anthrax" });
  assert.deepEqual(short(calls), ["Queue::GetItems", "Library::GetAlbum", "Library::GetAlbumTrackLites", "Library::GetPerformer",
    "DEFTYPE GetGenreParameters", "Library::GetToplevelGenres", "Library::GetAllTagLites"]);
  assert.deepEqual(out.album.sent, { to: "3", with: "the album, object 50" }, "what was sent, said");
  assert.equal(calls[0].oid, "21", "GetItems sent to the zone's own Queue");
  assert.deepEqual(calls[1].args, ref(50n), "the album by its object id, as every by-reference argument");
  assert.deepEqual([out.zone.matchedBy, out.zone.nowPlaying.object, out.zone.nowPlaying.members.IsCurrent, out.zone.queue.members.Count], ["id", "TransportItem", true, 2]);
  assert.deepEqual([out.queueItems.answer.form, out.queueItems.answer.count, out.queueItems.answer.items.map((x) => String(x.members.TransportItemId))],
    ["LengthPrefixed list", 2, ["6", "7"]], "the items the answer names, each pushed with it");
  assert.equal(out.album.answer.object, "Album");
  assert.equal(out.album.answer.members.Title, "Among the Living");
  assert.deepEqual([out.albumTracks.answer.form, out.albumTracks.answer.items.map((x) => x.members.Title)], ["bare list", ["Among the Living", "Caught in a Mosh"]]);
  assert.deepEqual([out.performer.answer.object, out.performer.answer.members.Name, out.performer.answer.members.Type], ["Performer", "Anthrax", 2]);
  assert.match(JSON.stringify(out.performer.answer.members.Biography), /Thrash metal band from New York/);
  assert.deepEqual(out.genres, Object.assign({}, out.genres, { method: "Library::GetToplevelGenres", refused: "InvalidArguments" }), "refused: said, the rest read");
  assert.equal(out.tags.answer.object, "DataList<Sooloos.Broker.Api.TagLite>");
  assert.match(JSON.stringify(out.tags.answer), /Favourites/);
  assert.equal(out.image.members.Url, "broker:///image/abc.jpg");
  assert.deepEqual(out.asked, { title: "Among the Living", artist: "Anthrax" });
});

test("a call unanswered: nothing more is sent — not even a struct's type — each later read said skipped", async () => {
  const { probe, calls } = rig({ unanswered: SIG.getAlbum });
  const out = await probe.run({ title: "Among the Living", artist: "Anthrax" });
  assert.deepEqual(short(calls), ["Queue::GetItems", "Library::GetAlbum"]);
  assert.match(out.album.error, /no answer/);
  for (const k of ["albumTracks", "genres", "tags"]) assert.match(out[k].skipped, /unanswered/, k);
  const first = rig({ unanswered: SIG.queueItems });
  await first.probe.run();
  assert.deepEqual(short(first.calls), ["Queue::GetItems"], "the genres' parameters never declared once the connection is uncertain");
});

test("the album refused: its tracks still asked; no performer to ask for, said so; off answered, nothing sent", async () => {
  const { probe, calls } = rig({ answers: { [SIG.getAlbum]: () => null } });
  const out = await probe.run({ title: "Among the Living", artist: "Anthrax" });
  assert.equal(out.album.refused, "InvalidArguments");
  assert.match(out.performer.skipped, /without a main performer/);
  assert.ok(!short(calls).includes("Library::GetPerformer"));
  const off = rig({ off: "Native mode is off." });
  assert.deepEqual(await off.probe.run(), { error: "Native mode is off.", status: 503 });
  assert.deepEqual(off.calls, []);
  const unknown = await rig().probe.run({ title: "Nope", artist: "None" });
  assert.match(unknown.album.skipped, /No album of that title/);
});

test("the review's: a step that throws leaves the rest; the title alone matches; an unknown zone said; busy answered", async () => {
  const thrown = rig({ zones: () => { throw new Error("the zones aren't there"); } });
  const out = await thrown.probe.run();
  assert.deepEqual(out.zone, { error: "the zones aren't there" });
  assert.equal(out.album.answer.object, "Album", "the album read all the same");
  const byTitle = await rig().probe.run({ title: "among the living" });
  assert.deepEqual(byTitle.asked, { title: "Among the Living", artist: "Anthrax" });
  const noZone = await rig().probe.run({ zoneId: "beef" });
  assert.match(noZone.zone.skipped, /no zone of that id/);
  let release;
  const held = rig({ inTurn: (fn) => new Promise((r) => { release = () => r(fn()); }) });
  const first = held.probe.run();
  const second = await Promise.race([held.probe.run(), new Promise((r) => { setTimeout(() => r("it waited instead"), 200); })]);
  assert.deepEqual(second, { error: "A read is already running; wait for it.", status: 409 });
  release();
  await first;
});

test("the review's: an Album named but never pushed, the AlbumLite let go — no object to read the performer from, said; one only held from before, flagged", async () => {
  // The Album named, sent only as a stub (PUSHSTUB, no members): held, but not loaded — not read as the album.
  const gone = rig({ forgetLite: true, answers: { [SIG.getAlbum]: () => ref(999n) } });
  gone.s.graph.ingest({ cmd: 4, isResponse: false, body: new BinaryWriter().long(999n).flexInt(5).flexInt(0).toBuffer() });
  const out = await gone.probe.run({ title: "Among the Living", artist: "Anthrax" });
  assert.equal(out.album.answer.object, "named, never pushed");
  assert.match(out.performer.skipped, /No album object/);
  assert.ok(!short(gone.calls).includes("Library::GetPerformer"));
  // The performer answered by reference to an object the graph held before, not pushed again: said so.
  const old = rig({ answers: { [SIG.getPerformer]: () => ref(30n) } });
  const o2 = await old.probe.run({ title: "Among the Living", artist: "Anthrax" });
  assert.equal(o2.performer.answer.pushedWithAnswer, false);
  // A list whose items were held before and not pushed again: counted.
  const stale = rig({ answers: { [SIG.queueItems]: () => new BinaryWriter().flexInt(1).long(20n).toBuffer() } });
  const o3 = await stale.probe.run();
  assert.equal(o3.queueItems.answer.notPushedWithAnswer, 1);
});
