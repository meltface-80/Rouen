"use strict";
// ---------------------------------------------------------------------------
// v2.0.3-t16: an album's versions (lib/roon-direct/versions.js, versions-probe.js, lib/routes/album-versions.js;
// dev/design/album-versions.md). The first test is the owner's read of 2026-11-10 (The Dark Side of the Moon, t13's
// probe) member for member as the server sent it — three library copies grouped (the one opened, named never pushed;
// two hidden duplicates) and two TIDAL releases — held in objects.js's graph; the rest invent values in that shape.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { ObjectGraph, P } = require("../../lib/roon-direct/objects");
const { BinaryWriter } = require("../../lib/roon-direct/wire");
const { SIG, ALLOWED, playAlbumArgs } = require("../../lib/roon-direct/methods");
const { createVersions, versionsOf, formatSaid } = require("../../lib/roon-direct/versions");
const { createVersionsProbe } = require("../../lib/roon-direct/versions-probe");
const { mountAlbumVersions } = require("../../lib/routes/album-versions");

const A = "Sooloos.Broker.Api.";
const put = (graph, oid, type, fields) => { graph.objects.set(String(oid), { oid: BigInt(oid), typeName: A + type, loaded: true, fields }); };
const k = (type, name, t = "x") => `${t} ${A}${type}::${name}`;
const lite = (graph, oid, m) => put(graph, oid, "AlbumLite", Object.fromEntries(Object.entries(m).map(([n, v]) => [k("AlbumLite", n), v])));
/** An AlternateAlbumVersion struct, inline. */
const ver = (graph, oid, m, listOid) => {
  if (m.Formats) put(graph, listOid, "DataList<string>", { $items: m.Formats });
  const s = { $type: A + "AlternateAlbumVersion", [k("AlternateAlbumVersion", "Album")]: { $ref: BigInt(oid) } };
  if (m.Version) s[k("AlternateAlbumVersion", "Version")] = m.Version;
  if (m.TrackCount !== undefined) s[k("AlternateAlbumVersion", "TrackCount")] = m.TrackCount;
  if (m.Formats) s[k("AlternateAlbumVersion", "Formats")] = { $ref: BigInt(listOid) };
  if (m.Path) s[k("AlternateAlbumVersion", "ContentLocations")] = [{ $type: A + "ContentLocation", [k("ContentLocation", "RelativePath")]: m.Path }];
  return s;
};
/** The Album GetAlbum answered: its AlternateAlbumVersions a struct of three list objects. */
function album(graph, oid, lists, extra = {}) {
  let n = 9000;
  const listRef = (items) => { const o = n++; put(graph, o, "DataList<AlternateAlbumVersion>", { $items: items }); return { $ref: BigInt(o) }; };
  put(graph, oid, "Album", Object.assign({ [k("Album", "Title")]: "The Dark Side of the Moon",
    [k("Album", "AlternateAlbumVersions")]: { $type: A + "AlternateAlbumVersions",
      [k("AlternateAlbumVersions", "LibraryGroupVersions")]: listRef(lists.group || []),
      [k("AlternateAlbumVersions", "LibraryOtherVersions")]: listRef(lists.other || []),
      [k("AlternateAlbumVersions", "StreamingVersions")]: listRef(lists.streaming || []) } },
  Object.fromEntries(Object.entries(extra).map(([n2, v]) => [k("Album", n2), v]))));
}
/** The owner's read: The Dark Side of the Moon. */
function dsotm(graph, o = {}) {
  lite(graph, 220281, { Title: "The Dark Side of the Moon", ContentSource: 1, IsDuplicate: true, IsHidden: true, LibraryAlbumId: "2270255" });
  lite(graph, 227007, { Title: "The Dark Side of the Moon", ContentSource: 1, IsDuplicate: true, IsHidden: true, LibraryAlbumId: "2842159", Version: "oan, EAC - FLAC" });
  if (!o.noStreaming) {
    lite(graph, 38323948, { Title: "The Dark Side of the Moon", ContentSource: 128, RoonReleaseId: "201662" });
    lite(graph, 38323949, { Title: "The Dark Side Of The Moon (50th Anniversary; 2023 Remaster)", ContentSource: 128, RoonReleaseId: "201918" });
  }
  album(graph, 38322294, {
    group: [ver(graph, 226343, { Version: "50th Anniversary", TrackCount: 10, Formats: ["FLAC 192kHz 24bit"], Path: "4tb/Music/Pink Floyd/The Dark Side Of The Moon (50th Anniversary) (1973)" }, 100),
      ver(graph, 227007, { Version: "oan, EAC - FLAC", TrackCount: 10, Formats: ["FLAC 44.1kHz 16bit"], Path: "4tb/Music/Pink Floyd - Discography/Pink Floyd - The Dark Side Of The Moon 1973 [EAC - FLAC] (oan)" }, 101),
      ver(graph, 220281, { TrackCount: 10, Formats: ["FLAC 96kHz 24bit"], Path: "4tb/Music/Pink Floyd/The Dark Side of the Moon (1973)" }, 102)],
    streaming: o.noStreaming ? [] : [ver(graph, 38323948, { TrackCount: 10, Formats: ["FLAC 96kHz 24bit"] }, 103),
      ver(graph, 38323949, { TrackCount: 10, Formats: ["FLAC 192kHz 24bit"] }, 104)],
  }, o.loading ? { IsLoading: true } : {});
}

test("THE one: the owner's Dark Side of the Moon, as Roon groups it — the one open, two hidden copies, two on TIDAL", () => {
  const g = new ObjectGraph();
  dsotm(g);
  const got = versionsOf(g, g.get(38322294n), "226343", new Map());
  assert.equal(got.complete, true);
  assert.deepEqual(got.versions.map((v) => [v.id, v.group, v.name, v.format, v.tracks, v.where, v.hidden, v.current]), [
    ["o226343", "library", "50th Anniversary", "FLAC 192kHz 24-bit", 10, "Library", false, true],
    ["l2842159", "library", "oan, EAC - FLAC", "FLAC 44.1kHz 16-bit", 10, "Library", true, false],
    ["l2270255", "library", "The Dark Side of the Moon (1973)", "FLAC 96kHz 24-bit", 10, "Library", true, false],
    ["s201662", "streaming", "Version 4", "FLAC 96kHz 24-bit", 10, "TIDAL", false, false],
    ["s201918", "streaming", "The Dark Side Of The Moon (50th Anniversary; 2023 Remaster)", "FLAC 192kHz 24-bit", 10, "TIDAL", false, false],
  ], "named by Version, else a title of its own, else its folder, else its place; a library copy known by its LibraryAlbumId, a stream by its release");
  assert.equal(formatSaid("DSD 2.8MHz 1bit"), "DSD 2.8MHz 1-bit");
});

test("a copy the graph let go is said from what was read of it before; still loading, and no versions at all", () => {
  const g = new ObjectGraph();
  dsotm(g, { loading: true });
  const copies = new Map();
  assert.equal(versionsOf(g, g.get(38322294n), "226343", copies).complete, false, "IsLoading: the streaming ones may come yet");
  g.objects.delete("220281");
  const again = versionsOf(g, g.get(38322294n), "226343", copies);
  assert.deepEqual([again.versions[2].id, again.versions[2].hidden], ["l2270255", true]);
  const fresh = versionsOf(g, g.get(38322294n), "226343", new Map());
  assert.deepEqual([fresh.versions[2].id, fresh.versions[2].hidden, fresh.versions[2].where], ["o220281", false, "Library"], "nothing known of it: by its object, never guessed hidden");
  // A library album the library read let go (a visible other release): said from what that read kept of it (the review).
  const lib = versionsOf(g, g.get(38322294n), "226343", new Map(), new Map([["220281", { oid: "220281", title: "The Dark Side of the Moon (Remaster)", contentSource: 1, format: { text: "FLAC 96/24" } }]]));
  assert.deepEqual([lib.versions[2].name, lib.versions[2].where], ["The Dark Side of the Moon (Remaster)", "Library"]);
  put(g, 5, "Album", {});
  assert.equal(versionsOf(g, g.get(5n), "1", new Map()), null);
});

/** The module on a fake session: GetAlbum answers the Album by reference (a bare long, as the wire carries one). */
function rig(o = {}) {
  const graph = new ObjectGraph();
  dsotm(graph, o);
  const calls = [];
  let zoneShows = { zone_id: "16aa", display_name: "TV Speaker", state: "stopped", now_playing: null };
  put(graph, 50, "Transport", {});
  put(graph, 60, "Zone", { [`System.Sooid ${A}Zone::ZoneId`]: Buffer.from("16aa", "hex"), [k("Zone", "Name")]: "TV Speaker" });
  const s = { graph, root: { library: { oid: 3n }, profiles: [], profileId: Buffer.from("00112233445566778899aabbccddeeff", "hex") },
    g: { uncertain: () => "", defineType: () => 1,
      call: async (oid, sig, args) => {
        calls.push({ oid: String(oid), sig, args });
        if (sig === SIG.playAlbum) { if (!o.playRefused && !o.silent) zoneShows = Object.assign({}, zoneShows, { state: "playing" }); return o.playRefused ? { success: false, status: "InvalidArgument" } : { success: true }; }
        if (o.during) o.during(graph);
        return { success: true, status: "Success", payload: new BinaryWriter().long(38322294n).toBuffer() };
      } } };
  const known = new Map([["226343", { oid: "226343", title: "The Dark Side of the Moon", artist: "Pink Floyd" }]]);
  const asked = [];
  const versions = createVersions({ link: { session: () => s }, inTurn: (fn) => fn(), known: () => known, off: () => o.off || null, on: () => !o.off,
    keyOf: (t, a) => `${t}||${a}`.toLowerCase(), profile: () => null, zone: (id) => (id === "16aa" ? zoneShows : null),
    trackTimes: { byOid: async (oid) => { asked.push(oid); return { read: true, tracks: [{ disc: 1, number: 1, title: "Speak to Me", seconds: 67 }] }; } },
    answerMs: 50, confirmMs: 200, pollMs: 10 });
  return { versions, calls, asked, graph, s };
}

test("read: GetAlbum once a connection, the album by its object; none but itself gives none; native mode off says why", async () => {
  const { versions, calls } = rig();
  const got = await versions.read("The Dark Side of the Moon", "Pink Floyd");
  assert.equal(got.read, true);
  assert.equal(got.versions.length, 5);
  assert.ok(got.versions.every((v) => !("oid" in v)), "an object's id is only this connection's: never given out");
  assert.deepEqual(calls.map((c) => [c.oid, c.sig, c.args.toString("hex")]), [["3", SIG.getAlbum, new BinaryWriter().long(226343n).toBuffer().toString("hex")]]);
  await versions.read("The Dark Side of the Moon", "Pink Floyd");
  assert.equal(calls.length, 1, "kept: asked once a connection");
  assert.deepEqual(await rig({ off: "Native mode is off." }).versions.read("x", "y"), { read: false, why: "Native mode is off." });
  const lone = rig();
  const g = lone.graph;
  put(g, 9000, "DataList<AlternateAlbumVersion>", { $items: [ver(g, 226343, { TrackCount: 10 }, 200)] });
  put(g, 9002, "DataList<AlternateAlbumVersion>", { $items: [] });
  assert.deepEqual((await lone.versions.read("The Dark Side of the Moon", "Pink Floyd")).versions, [], "only itself: no versions");
  assert.equal((await rig().versions.read("Animals", "Pink Floyd")).read, false);
});

test("still loading: the Album kept and read again from the graph, no second call; the streaming ones taken as they come", async () => {
  const { versions, calls, graph } = rig({ loading: true, noStreaming: true });
  const first = await versions.read("The Dark Side of the Moon", "Pink Floyd");
  assert.deepEqual([first.complete, first.versions.length], [false, 3]);
  lite(graph, 38323948, { Title: "The Dark Side of the Moon", ContentSource: 128, RoonReleaseId: "201662" });
  put(graph, 9002, "DataList<AlternateAlbumVersion>", { $items: [ver(graph, 38323948, { TrackCount: 10, Formats: ["FLAC 96kHz 24bit"] }, 300)] });
  const al = graph.get(38322294n);
  delete al.fields[k("Album", "IsLoading")];
  const then = await versions.read("The Dark Side of the Moon", "Pink Floyd");
  assert.deepEqual([then.complete, then.versions.length, then.versions[3].where], [true, 4, "TIDAL"]);
  assert.equal(calls.length, 1);
});

test("tracks and play: a version found by its id; played whole on the chosen zone and believed when it plays", async () => {
  const { versions, calls, asked } = rig();
  assert.deepEqual(await versions.tracks("The Dark Side of the Moon", "Pink Floyd", "l2270255"), { read: true, tracks: [{ disc: 1, number: 1, title: "Speak to Me", seconds: 67 }] });
  assert.deepEqual(asked, ["220281"], "the hidden copy's tracks, by its object");
  assert.equal((await versions.tracks("The Dark Side of the Moon", "Pink Floyd", "l999")).read, false);
  assert.deepEqual(await versions.play("The Dark Side of the Moon", "Pink Floyd", "l2270255", "16aa", true), { ok: true });
  const p = calls.find((c) => c.sig === SIG.playAlbum);
  assert.equal(p.oid, "50", "to the Transport");
  assert.deepEqual(p.args, playAlbumArgs(/** @type {any} */ ({ defineType: () => 1 }), 60n, Buffer.from("00112233445566778899aabbccddeeff", "hex"), true, 220281n));
  assert.ok(p.args.toString("hex").endsWith(new BinaryWriter().long(220281n).boolean(false).boolean(true).toBuffer().toString("hex")),
    "the copy by its object, favourites only false, hidden included");
  assert.ok(ALLOWED.has(SIG.playAlbum));
  assert.deepEqual(await versions.play("The Dark Side of the Moon", "Pink Floyd", "l2270255", "nope", false), { notSent: "Choose a zone to play on first." });
  assert.deepEqual(await rig({ silent: true }).versions.play("The Dark Side of the Moon", "Pink Floyd", "l2270255", "16aa", false),
    { notShown: "Your server took it, but the zone didn't start playing." }, "taken, but the zone never plays it: not believed");
  assert.match((await rig({ playRefused: true }).versions.play("The Dark Side of the Moon", "Pink Floyd", "l2270255", "16aa", false)).notSent, /refused/);
});

test("the probe: each library copy's edit info asked, its DuplicateOf said by which version it names", async () => {
  const { versions, calls, s } = rig();
  const probe = createVersionsProbe({ link: { session: () => s }, inTurn: (fn) => fn(), off: () => null, versions });
  // The edit info's answer: one AlbumEditInfo the hidden copy, its DuplicateOf the one opened. The answer's own form is
  // edit-info.js's (its tests); here, what the probe does with it.
  const orig = s.g.call;
  s.g.call = async (oid, sig, args) => {
    if (sig !== SIG.albumEditInfo) return orig(oid, sig, args);
    calls.push({ oid: String(oid), sig, args });
    return { success: false, status: "InvalidArgument" };
  };
  const out = await probe.run("The Dark Side of the Moon", "Pink Floyd");
  assert.deepEqual(out.versions.map((v) => v.id), ["o226343", "l2842159", "l2270255", "s201662", "s201918"]);
  assert.deepEqual(out.tries.map((t) => t.languages), [[], ["en"]], "refused: tried in both forms, as edit-info.js does, then said so");
  assert.equal(out.editInfo, null);
  assert.equal(calls.filter((c) => c.sig === SIG.albumEditInfo).length, 2);
  assert.ok(!calls.some((c) => /::Edit\(/.test(c.sig)), "nothing written");
});

test("the routes: a title or a 400; the answer as read; a play's outcome by its status; the probe only with run=1", async () => {
  const routes = {};
  const app = { get: (p, h) => { routes["GET " + p] = h; }, post: (p, h) => { routes["POST " + p] = h; } };
  let played = { ok: true };
  mountAlbumVersions(app, { read: async () => ({ read: true, complete: false, versions: [{ id: "l1" }] }), tracks: async () => ({ read: false, wait: true, why: "w" }),
    play: async () => played }, { run: async () => ({ versions: [] }) });
  const call = async (key, req) => { const res = { code: 200, headers: {}, set(a, b) { this.headers[a] = b; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes[key](req, res); return res; };
  assert.equal((await call("GET /api/album/versions", { query: {} })).code, 400);
  const r = await call("GET /api/album/versions", { query: { title: "T", artist: "A" } });
  assert.deepEqual([r.body, r.headers["Cache-Control"]], [{ versions: [{ id: "l1" }], status: "ok", complete: false }, "no-store"]);
  assert.deepEqual((await call("GET /api/album/version-tracks", { query: { title: "T", id: "l1" } })).body, { tracks: [], status: "pending", why: "w" });
  assert.equal((await call("GET /api/album/version-tracks", { query: { title: "T", id: "../x" } })).code, 400);
  const body = { title: "T", artist: "A", id: "s201662", zone_id: "16aa", shuffle: true };
  assert.equal((await call("POST /api/album/version-play", { body })).code, 200);
  played = { notShown: "n" };
  assert.equal((await call("POST /api/album/version-play", { body })).code, 409);
  played = { notSent: "n" };
  assert.equal((await call("POST /api/album/version-play", { body })).code, 503);
  assert.equal((await call("POST /api/album/version-play", { body: { title: "T", id: "s1" } })).code, 400);
  assert.equal((await call("GET /api/debug/roon-album-versions", { query: { title: "T" } })).body.ran, false);
  assert.equal((await call("GET /api/debug/roon-album-versions", { query: { run: "1", title: "T" } })).body.ran, true);
});

test("the review's: nothing pushed while the album is asked for is let go — a zone made by grouping meanwhile stays", async () => {
  // A Zone pushed as the server pushes one (objects.js ingest, watchers told), while GetAlbum is out.
  const during = (graph) => {
    graph.types.set(77, { id: 77, name: A + "Zone", members: [{ name: `string ${A}Zone::Name`, propType: P.String }] });
    const w = new BinaryWriter().long(5151n).flexInt(77).flexInt(1).string("Kitchen + Den");
    graph.ingest({ cmd: 3, isResponse: false, body: w.flexInt(0).toBuffer() });
  };
  const { versions, graph } = rig({ during });
  const before = new Set(graph.objects.keys());
  assert.equal((await versions.read("The Dark Side of the Moon", "Pink Floyd")).read, true);
  assert.ok(graph.get(5151n) && graph.get(5151n).loaded, "the grouped zone, pushed meanwhile, still held");
  for (const k2 of before) assert.ok(graph.objects.has(k2), "nothing the graph held before is let go: " + k2);
});
