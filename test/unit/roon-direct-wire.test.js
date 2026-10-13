"use strict";
// ---------------------------------------------------------------------------
// v1.9.11: lib/roon-direct's wire format, held to the upstream it was ported
// from (arthursoares/roon-api-reverse-engineering, MIT, commit 8b67208): its
// own byte vectors (src/proto/flex.ts, encoding.test.ts, frame.ts), its
// captured ConnectRequest, and its captured DEFMETHOD string for the album
// query whose shape the track query follows (catalog/fixtures/
// captured_signatures.json). The vectors are copied here so no test needs the
// upstream checked out.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { writeFlexInt, writeFlexLong, readFlexLong, BinaryReader, BinaryWriter } = require("../../lib/roon-direct/wire");
const { encodeRequest, encodeResponse, FrameParser } = require("../../lib/roon-direct/frame");
const { CONNECT_REQUEST_TEMPLATE } = require("../../lib/roon-direct/connection");
const { SIG, ALLOWED, guarded, ROOT_SERVICE } = require("../../lib/roon-direct/methods");
const { parseCallResult } = require("../../lib/roon-direct/remoting");
const { dotnetGuidBytes, plainGuidBytes, brokerIdCandidates } = require("../../lib/roon-direct/brokerid");

const hex = (arr) => Buffer.from(arr).toString("hex");
const flexInt = (v) => { const o = []; writeFlexInt(o, v); return hex(o); };
const flexLong = (v) => { const o = []; writeFlexLong(o, v); return hex(o); };

test("flex integers: big-endian base-128, as RemotingUtils writes them", () => {
  assert.equal(flexInt(0), "00");
  assert.equal(flexInt(127), "7f");
  assert.equal(flexInt(143), "810f", "the upstream's own example: (1<<7)|15");
  assert.equal(flexInt(16383), "ff7f");
  assert.equal(flexInt(16384), "818000");
  assert.equal(flexInt(-1), "8fffffff7f", "the null length is the uint32 0xFFFFFFFF");
  assert.equal(flexLong(0n), "00");
  assert.equal(flexLong(123456789012n), "83cbf4e4b414", "an object id past 2^32, worked out by hand");
  for (const v of [0, 1, 127, 128, 300, 16384, 2097151, 2097152, 268435455, 268435456, 0xffffffff]) {
    assert.equal(new BinaryReader(Buffer.from(flexInt(v), "hex")).flexInt(), v >>> 0, "round trip " + v);
  }
  for (const v of [0n, 1n, 1000n, 2n ** 53n + 1n, 2n ** 63n]) {
    const r = readFlexLong(Buffer.from(flexLong(v), "hex"), 0);
    assert.equal(r[0], v, "round trip " + v);
  }
  assert.equal(readFlexLong(Buffer.from("81", "hex"), 0), null, "a long cut short is not invented");
});

test("reader and writer: the upstream's encoding vectors", () => {
  const sooid = Buffer.from("0116", "hex");
  assert.equal(new BinaryWriter().sooid(sooid).toBuffer().toString("hex"), "020116");
  assert.equal(new BinaryWriter().string("joão").toBuffer().toString("hex"), "056a6fc3a36f");
  assert.equal(new BinaryWriter().string(null).toBuffer().toString("hex"), "8fffffff7f");
  const r = new BinaryReader(Buffer.from("033f0116" + "8fffffff7f" + "012a" + "02" + "2a", "hex"));
  assert.equal(r.optionalSooid().toString("hex"), "3f0116");
  assert.equal(r.optionalSooid(), null);
  assert.equal(r.optionalInteger(), 42);
  assert.equal(r.optionalBoolean(), null, "2 is null for a nullable bool");
  assert.equal(r.integer(), 42);
  assert.equal(r.remaining, 0);
  assert.throws(() => new BinaryReader(Buffer.from("05ab", "hex")).string(), RangeError, "a string longer than the bytes left is refused");
  assert.equal(new BinaryReader(new BinaryWriter().string("Sooloos").toBuffer()).string(), "Sooloos");
});

test("frames: requests, responses, and a parser that waits for whole frames", () => {
  assert.equal(encodeRequest(6, Buffer.from("ab", "hex"), null).toString("hex"), "0601ab", "DEFMETHOD, no reply wanted");
  assert.equal(encodeRequest(3, Buffer.from("ab", "hex"), 5).toString("hex"), "430501ab", "CALL expecting reply 5");
  assert.equal(encodeResponse(9, Buffer.alloc(0)).toString("hex"), "c00900", "the empty acknowledgement");
  const two = Buffer.concat([encodeRequest(3, Buffer.alloc(200, 1), 300), encodeResponse(7, Buffer.from("ok"))]);
  const p = new FrameParser();
  const got = [];
  for (const b of two) got.push(...p.push(Buffer.from([b])));   // one byte at a time
  assert.equal(got.length, 2);
  assert.deepEqual([got[0].isResponse, got[0].cmd, got[0].rid, got[0].body.length], [false, 3, 300, 200]);
  assert.deepEqual([got[1].isResponse, got[1].isFinal, got[1].rid, got[1].body.toString()], [true, true, 7, "ok"]);
  assert.throws(() => new FrameParser(100).push(encodeRequest(3, Buffer.alloc(101), 1)), /over the 100-byte limit/);
});

test("the ConnectRequest is the official client's, but for its name", () => {
  // The upstream's template, as captured (connection.ts, commit 8b67208).
  const upstream = "470181670000000100012c536f6f6c6f6f732e4d73672e446973747269627574656442726f6b65722e436f6e6e6563745265717565737424840e436c69656e7442726f6b65724964XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX228110436c69656e7442726f6b65724e616d650000000848512d30303435321b810f50726f746f636f6c56657273696f6e0000000232383e810c50726f746f636f6c48617368000000286161656464323265326536653435323233316537346464333039666662396432376139373531656420810c436c69656e744272616e63680000000a70726f64756374696f6e05030503";
  const name = (s) => s.replace(Buffer.from("HQ-00452").toString("hex"), "").replace(Buffer.from("RouenApp").toString("hex"), "");
  assert.equal(CONNECT_REQUEST_TEMPLATE.length, upstream.length, "a length byte would have moved");
  assert.equal(name(CONNECT_REQUEST_TEMPLATE), name(upstream), "only the client name differs");
  assert.ok(CONNECT_REQUEST_TEMPLATE.includes(Buffer.from("RouenApp").toString("hex")));
  const f = new FrameParser().push(Buffer.from(CONNECT_REQUEST_TEMPLATE.replace(/X{32}/, "00".repeat(16)), "hex"));
  assert.equal(f.length, 1, "the template parses as one whole SENDMSG frame");
  assert.equal(f[0].cmd, 7);
});

test("the allowlist: the signatures, and a guard that refuses the rest", async () => {
  // The official client's captured album query, whose shape the track query follows.
  const capturedAlbum = "Sooloos.Broker.Api.Library::VirtualAlbumQuery(System.Sooid, Sooloos.Broker.Api.AlbumQueryCriteria, Sooloos.Broker.Api.VirtualQueryParameters, Base.ResultCallback<Sooloos.Broker.Api.VirtualAlbumLiteQuery>)";
  assert.equal(SIG.trackQuery, capturedAlbum.replace(/Album/g, "Track"));
  assert.equal(SIG.retainPage, "Sooloos.Broker.Api.VirtualTrackLiteQuery::RetainPage(int, Base.ResultCallback)");
  assert.equal(SIG.albumQuery, capturedAlbum, "the album query (v1.9.13) is the captured string itself");
  assert.equal(SIG.albumDispose, "Sooloos.Broker.Api.VirtualAlbumLiteQuery::Dispose()");
  assert.equal(SIG.albumRetainPage, "Sooloos.Broker.Api.VirtualAlbumLiteQuery::RetainPage(int, Base.ResultCallback)", "the official client's captured string");
  // Exactly the eight dev/design/roon-native.md §4 names for stage 0 (v1.9.16); a ninth is a design change first.
  assert.deepEqual([...ALLOWED].sort(), [SIG.trackQuery, SIG.retainPage, SIG.releasePage, SIG.dispose, SIG.albumQuery, SIG.albumDispose, SIG.albumRetainPage, SIG.albumReleasePage].sort());
  for (const sig of ALLOWED) assert.doesNotMatch(sig, /FavoriteOrBan|AddToLibrary|Edit|Play|Set/, "stage 0 writes nothing: " + sig);
  const sent = [];
  const fake = { call: async (o, s) => { sent.push(s); return { success: true }; }, callNoReply: (o, s) => sent.push(s), getService: async () => 1n, defineType: () => 1 };
  const g = guarded(/** @type {any} */ (fake));
  await g.call(1n, SIG.retainPage, Buffer.alloc(0));
  assert.throws(() => g.call(1n, "Sooloos.Broker.Api.Library::FavoriteOrBan(System.Sooid, Sooloos.Broker.Api.TrackBase, Sooloos.Broker.Api.FavoriteBanState, Base.ResultCallback)", Buffer.alloc(0)), /not on the allowlist/);
  assert.throws(() => g.callNoReply(1n, "Sooloos.Broker.Api.Zone::Pause()", Buffer.alloc(0)), /not on the allowlist/);
  assert.throws(() => g.getService(Buffer.alloc(16)), /only the root service/);
  await g.getService(ROOT_SERVICE);
  assert.deepEqual(sent, [SIG.retainPage], "nothing refused reached the Core");
});

test("call results: the status string first", () => {
  assert.deepEqual(parseCallResult(Buffer.concat([new BinaryWriter().string("Success").toBuffer(), Buffer.from([5])])), { status: "Success", success: true, payload: Buffer.from([5]) });
  assert.equal(parseCallResult(new BinaryWriter().string(null).toBuffer()).success, true, "a null status is success");
  assert.equal(parseCallResult(new BinaryWriter().string("InvalidArgument").toBuffer()).success, false);
  assert.equal(parseCallResult(Buffer.from([0x81])).status, "malformed reply");
});

test("broker ids: the core_id in .NET Guid order, then as written, then one by hand first", () => {
  // the upstream's own example: 01234567-89ab-cdef-0123-456789abcdef -> 67452301ab89efcd0123456789abcdef
  assert.equal(dotnetGuidBytes("01234567-89ab-cdef-0123-456789abcdef").toString("hex"), "67452301ab89efcd0123456789abcdef");
  assert.equal(plainGuidBytes("01234567-89ab-cdef-0123-456789abcdef").toString("hex"), "0123456789abcdef0123456789abcdef");
  assert.equal(dotnetGuidBytes("not a uuid"), null);
  const c = brokerIdCandidates({ coreId: "01234567-89ab-cdef-0123-456789abcdef", override: "AA".repeat(16) });
  assert.deepEqual(c.map((x) => x.label), ["given by hand", "core_id, .NET Guid order", "core_id, as written"]);
  assert.deepEqual(brokerIdCandidates({ override: "zz" }), [], "a malformed override is not tried");
  const same = brokerIdCandidates({ coreId: "00000000-0000-0000-0000-000000000000" });
  assert.equal(same.length, 1, "an id that reads the same both ways is tried once");
});
