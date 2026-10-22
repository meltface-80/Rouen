"use strict";
// ---------------------------------------------------------------------------
// N2e-0 (lib/roon-direct/smart-probe.js, v1.9.50, native-remote.md §12.1): Roon's
// smart playlists, read once by hand over native mode's connection — every
// playlist with its Type, a smart one's Focus, and one playlist's first items
// through Playlist::VirtualItemsQuery — end to end against the fake server
// (test/lib/fake-roon-playlists.js), which reads each call strictly. The fake is
// not evidence of how the real server answers: the probe exists to find out.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createStage1 } = require("../../lib/roon-direct/stage1");
const { createLink } = require("../../lib/roon-direct/link");
const { readAlbumsOn } = require("../../lib/roon-direct/albums");
const { describe, createSmartProbe } = require("../../lib/roon-direct/smart-probe");
const { ALLOWED, SIG } = require("../../lib/roon-direct/methods");
const { startFakeCore } = require("../lib/fake-roon-core");
const { dotnetGuidBytes } = require("../../lib/roon-direct/brokerid");
const { CORE_ID, LIBRARY } = require("../lib/roon-direct-fixtures");

const keyOf = (title, artist) => (title ? `${title.toLowerCase()}||${artist.toLowerCase()}` : null);
const until = async (fn) => { for (let i = 0; i < 250 && !fn(); i++) await new Promise((r) => { setTimeout(r, 20); }); return fn(); };
// The owner's case: a smart playlist of 5007 tracks among ordinary ones; here 30, of a library of 205.
const PLAYLISTS = [{ name: "Morning", tracks: 3, items: 3 }, { name: "r&b random", tracks: 30, items: 30, smart: true }];

// The fake smart playlist's Focus as the probe says it (v1.9.52, §12.5): each list read — a genre by its Name,
// labels as strings, an album type by its number, an empty list by its count.
const FOCUS = { UiLanguage: "en", RequireIsFavorite: true,
  RequireGenreObjects: { list: "GenreLite", count: 1, items: [{ object: "GenreLite", name: "R&B" }] },
  ExcludeGenreObjects: { list: "GenreLite", count: 0 },
  RequireLabels: { list: "string", count: 2, items: ["Motown", "Stax"] },
  RequireTypes: { list: "AlbumType", count: 1, items: [1] } };

async function rig(t, faults, o = {}) {
  const albums = LIBRARY.map((a) => Object.assign({}, a));
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums, playlists: (o.playlists || PLAYLISTS).map((p) => Object.assign({}, p)),
    faults: Object.assign({ sentOnce: true }, faults) });
  let s1 = null;
  const reads = [];
  const link = createLink({ core: () => ({ host: "127.0.0.1", coreId: CORE_ID }), port: core.port, timeoutMs: 1500,
    settleMs: 800, retryFirstMs: 100, onUp: () => s1.linkUp() });
  s1 = createStage1({
    settings: { load: () => null, save() {} }, cache: { read: () => null, write() {}, remove() {} },
    core: () => ({ host: "127.0.0.1", coreId: CORE_ID, coreVersion: "2.0" }), rouenVersion: "1.9.50",
    records: () => [], keyOf, link, minGapMs: 0,
    read: async (s, ro) => { const r = await readAlbumsOn(s, Object.assign({ timeoutMs: 1000 }, ro)); reads.push(r.ok); return r; },
  });
  t.after(async () => { s1.turnOff(); await core.close(); });
  if (o.off) return { core, s1 };
  s1.turnOn();
  assert.ok(await until(() => reads.length >= 1 && s1.albums()), "the library was never read");
  return { core, s1, s1Link: () => link.session() };
}

test("THE one for N2e-0: every playlist and its Type, the smart one's Focus, and its first 25 items — nothing written", async (t) => {
  const w = await rig(t);
  const out = await w.s1.smartProbe.run();
  assert.equal(out.read, true, JSON.stringify(out));
  assert.deepEqual(out.playlists.map((p) => [p.name, p.type, p.typeName, p.trackCount]), [["Morning", 5, "Sooloos", 3], ["r&b random", 15, "Smart", 30]]);
  assert.equal(out.smart, 1);
  assert.ok(out.playlists[1].members.includes("AlbumCriteria") && out.playlists[1].members.includes("Type"));
  assert.deepEqual(out.playlists[1].AlbumCriteria, { struct: "AlbumQueryCriteria", members: FOCUS });
  assert.equal(out.playlists[0].AlbumCriteria, undefined);
  // The first smart one's items: its count, and the first 25 named by their tracks (title, album, artist).
  assert.equal(out.items.playlist, "r&b random");
  assert.deepEqual([out.items.count, out.items.countSent, out.items.complete], [30, true, true]);
  assert.equal(out.items.items.length, 25);
  assert.deepEqual(out.items.items[0], { title: "Kind of Blue 1", album: "Kind of Blue", artist: "Miles Davis" });
  assert.deepEqual(out.items.items[6], { title: "Blue 2", album: "Blue", artist: "Joni Mitchell" });
  // As the catalogue has it: for the profile chosen, UiLanguage alone, a page of 100; the page released and the query
  // disposed once each; nothing but reads.
  assert.deepEqual(w.core.rec.itemQueries, [{ playlist: "r&b random", profile: "cafebabe", criteria: { UiLanguage: "en" }, pageSize: 100 }]);
  const q = w.core.rec.opened[w.core.rec.opened.length - 1];
  await until(() => w.core.rec.disposed.includes(q));
  assert.deepEqual([w.core.rec.retained.filter((x) => x.startsWith(q + ":")), w.core.rec.released.filter((x) => x.startsWith(q + ":")),
    w.core.rec.disposed.filter((x) => x === q)], [[q + ":0"], [q + ":0"], [q]]);
  assert.deepEqual(w.core.rec.playlistCalls, []);
  assert.deepEqual(w.core.rec.hearts, []);
  for (const sig of w.core.rec.signatures) assert.ok(ALLOWED.has(sig), "off the allowlist: " + sig);
  assert.ok(w.core.rec.signatures.includes(SIG.playlistItems));
});

test("a playlist named: its items, smart or not; one not there, or no smart one: said, nothing asked", async (t) => {
  const w = await rig(t);
  const named = await w.s1.smartProbe.run({ name: "Morning" });
  assert.deepEqual([named.items.playlist, named.items.count, named.items.items.map((i) => i.title)], ["Morning", 3, ["Kind of Blue 1", "Kind of Blue 2", "Kind of Blue 3"]]);
  assert.match((await w.s1.smartProbe.run({ name: "Nope" })).items.error, /no playlist named "Nope"/);
  const plain = await rig(t, {}, { playlists: [{ name: "Morning", tracks: 3, items: 3 }] });
  const none = await plain.s1.smartProbe.run();
  assert.match(none.items.error, /no playlist marked smart/);
  assert.deepEqual(plain.core.rec.itemQueries, []);
});

test("refused when it can't be asked: native mode off; no playlists sent", async (t) => {
  const off = await rig(t, {}, { off: true });
  assert.equal((await off.s1.smartProbe.run()).status, 409);
  const none = await rig(t, { noPlaylists: true });
  // On the same connection, with a short wait (stage1's is 8 s).
  const quick = createSmartProbe({ link: { session: () => none.s1Link() }, inTurn: (fn) => fn(), profile: () => null, known: () => null, off: () => null, timeoutMs: 300 });
  assert.deepEqual(await quick.run(), { read: false, why: "Your server didn't send its playlists, whole, in time." });
});

test("the review: a refused items query keeps what was read; a Focus on a playlist not typed Smart counts as smart", async (t) => {
  const w = await rig(t, { refuseItems: true });
  const out = await w.s1.smartProbe.run();
  assert.equal(out.read, true);
  assert.equal(out.playlists.length, 2, "the playlists read lost to the items' refusal");
  assert.deepEqual(out.playlists[1].AlbumCriteria.members, FOCUS);
  assert.match(out.items.error, /couldn't be read: the Core refused the playlist's items query: Refused/);
  const focus = await rig(t, {}, { playlists: [{ name: "Morning", tracks: 3, items: 3 }, { name: "Focus only", tracks: 4, items: 4, smart: true, focusOnly: true }] });
  const f = await focus.s1.smartProbe.run();
  assert.deepEqual(f.playlists.map((p) => [p.name, p.type, p.smart]), [["Morning", 5, false], ["Focus only", 5, true]]);
  assert.equal(f.smart, 1);
  assert.equal(f.items.playlist, "Focus only");
});

test("a value said as the page shows it: never bytes; lists by count and first five; structs two levels deep", () => {
  const graph = { get: (oid) => (oid === 5n ? { loaded: true, typeName: "Sooloos.Broker.Api.GenreLite", fields: { "string Sooloos.Broker.Api.GenreLite::Name": "R&B" } } : undefined) };
  assert.deepEqual(describe(graph, Buffer.from("cafebabe", "hex")), { bytes: 4 });
  assert.deepEqual(describe(graph, [1, 2, 3, 4, 5, 6]), { count: 6, first: [1, 2, 3, 4, 5] });
  assert.deepEqual(describe(graph, { $ref: 5n }), { object: "GenreLite", name: "R&B" });
  assert.deepEqual(describe(graph, { $ref: 6n }), { object: "not sent" });
  assert.deepEqual(describe(graph, 12n), "12");
  const nested = { $type: "Sooloos.Broker.Api.AlbumQueryCriteria", "x Sooloos.Broker.Api.AlbumQueryCriteria::Ordering":
    { $type: "Sooloos.Broker.Api.AlbumQueryOrdering", "x Y::Inner": { $type: "Deep", "z W::V": 1 } } };
  assert.deepEqual(describe(graph, nested), { struct: "AlbumQueryCriteria", members: { Ordering: { struct: "AlbumQueryOrdering", members: { Inner: { struct: "Deep" } } } } });
});

test("a Focus sent by reference, as an object of its own: its members and lists read as an inline one's (the review)", async (t) => {
  const w = await rig(t, {}, { playlists: [{ name: "r&b random", tracks: 30, items: 30, smart: true, focusByRef: true }] });
  const out = await w.s1.smartProbe.run();
  assert.deepEqual(out.playlists[0].AlbumCriteria, { struct: "AlbumQueryCriteria", members: FOCUS });
});
