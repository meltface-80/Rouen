"use strict";
// ---------------------------------------------------------------------------
// N2e-1 (lib/roon-direct/smart.js, v1.9.51, native-remote.md §12.3): Roon's
// smart playlists in Rouen — listed, a page of their items read, played on
// the native zone that is Rouen's chosen zone (by its id, its name, or its
// outputs' endpoints), believed once the official API's zone plays — end to
// end against the fake server (fake-roon-playlists.js, fake-roon-transport.js),
// which reads each call strictly. Not evidence that the real server takes the
// play: the owner's zone playing is.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createStage1 } = require("../../lib/roon-direct/stage1");
const { createLink } = require("../../lib/roon-direct/link");
const { readAlbumsOn } = require("../../lib/roon-direct/albums");
const { createSmart, played } = require("../../lib/roon-direct/smart");
const { ALLOWED, SIG } = require("../../lib/roon-direct/methods");
const { startFakeCore } = require("../lib/fake-roon-core");
const { dotnetGuidBytes } = require("../../lib/roon-direct/brokerid");
const { CORE_ID, LIBRARY } = require("../lib/roon-direct-fixtures");

const keyOf = (title, artist) => (title ? `${title.toLowerCase()}||${artist.toLowerCase()}` : null);
const until = async (fn) => { for (let i = 0; i < 250 && !fn(); i++) await new Promise((r) => { setTimeout(r, 20); }); return fn(); };
const PLAYLISTS = [{ name: "Morning", tracks: 3, items: 3 }, { name: "r&b random", tracks: 194, items: 194, smart: true }];
// The official API's zone as index.js holds it; a play the fake server takes starts it.
const official = (o = {}) => ({ zone_id: o.id || "1601aabbcc", display_name: o.name || "Living Room", state: "stopped",
  outputs: (o.outputs || ["Living Room"]).map((n) => ({ display_name: n })), now_playing: null });

async function rig(t, faults, o = {}) {
  const albums = LIBRARY.map((a) => Object.assign({}, a));
  const zone = official(o.official);
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums, playlists: PLAYLISTS.map((p) => Object.assign({}, p)), zones: o.zones,
    faults: Object.assign({ sentOnce: true }, faults),
    onPlay: () => { setTimeout(() => { zone.state = "playing"; zone.now_playing = { one_line: { line1: "Walk Like Me" } }; }, 100); } });
  let s1 = null;
  const reads = [];
  const link = createLink({ core: () => ({ host: "127.0.0.1", coreId: CORE_ID }), port: core.port, timeoutMs: 1500,
    settleMs: 800, retryFirstMs: 100, onUp: () => s1.linkUp() });
  s1 = createStage1({
    settings: { load: () => null, save() {} }, cache: { read: () => null, write() {}, remove() {} },
    core: () => ({ host: "127.0.0.1", coreId: CORE_ID, coreVersion: "2.0" }), rouenVersion: "1.9.51",
    records: () => [], keyOf, link, minGapMs: 0, zone: (id) => (id === zone.zone_id ? zone : null),
    read: async (s, ro) => { const r = await readAlbumsOn(s, Object.assign({ timeoutMs: 1000 }, ro)); reads.push(r.ok); return r; },
  });
  t.after(async () => { s1.turnOff(); await core.close(); });
  if (o.off) return { core, s1, zone };
  s1.turnOn();
  assert.ok(await until(() => reads.length >= 1 && s1.albums()), "the library was never read");
  // smart.js with a short wait for the zone, on the same connection.
  const quick = createSmart({ link, inTurn: (fn) => fn(), on: () => true, profile: () => null, known: () => null, playlists: s1.playlists,
    zone: (id) => (id === zone.zone_id ? zone : null), confirmMs: 300, pollMs: 50 });
  return { core, s1, zone, quick, link };
}

test("THE one for N2e-1: the smart playlists listed, a page of one read in its order, the whole played on Rouen's zone — believed once it plays", async (t) => {
  const w = await rig(t);
  const listed = await w.s1.smart.list();
  assert.equal(listed.playlists.length, 1, "a playlist that isn't smart listed");
  const [sp] = listed.playlists;
  assert.deepEqual([sp.name, sp.tracks], ["r&b random", 194]);
  assert.match(sp.id, /^[0-9a-f]{32}$/);
  const p0 = await w.s1.smart.page(sp.id, 0);
  assert.deepEqual([p0.name, p0.count, p0.page, p0.pages, p0.items.length, p0.complete], ["r&b random", 194, 0, 2, 100, true]);
  assert.deepEqual(p0.items[0], { title: "Kind of Blue 1", album: "Kind of Blue", artist: "Miles Davis" });
  const p1 = await w.s1.smart.page(sp.id, 1);
  assert.deepEqual([p1.items.length, p1.items[0].title], [94, "Rumours 27"], "the second page: tracks 101–194");
  const answer = await w.s1.smart.play(sp.id, "1601aabbcc", true);
  assert.deepEqual(answer, { ok: true, by: "id" });
  assert.deepEqual(w.core.rec.plays, [{ zone: "1601aabbcc", playlist: "r&b random", shuffle: true }]);
  assert.equal(w.zone.state, "playing");
  for (const sig of w.core.rec.signatures) assert.ok(ALLOWED.has(sig), "off the allowlist: " + sig);
  assert.ok(w.core.rec.signatures.includes(SIG.playPlaylist));
  assert.deepEqual(w.core.rec.playlistCalls, [], "a playlist changed");
});

test("which zone: by its name when its id isn't the official one; by its outputs' endpoints when it has no name; none: not played, said", async (t) => {
  const byName = await rig(t, {}, { official: { id: "ffff0000" } });
  const id1 = (await byName.s1.smart.list()).playlists[0].id;
  assert.deepEqual(await byName.s1.smart.play(id1, "ffff0000", false), { ok: true, by: "name" });
  assert.deepEqual(byName.core.rec.plays.map((p) => p.shuffle), [false]);
  const byEndpoints = await rig(t, {}, { official: { id: "ffff0000", name: "Lounge", outputs: ["DAC", "Sub"] },
    zones: [{ id: "1601aabbcc", endpoints: ["DAC", "Sub"] }, { id: "1601ddeeff", name: "Kitchen", endpoints: ["Kitchen"] }] });
  const id2 = (await byEndpoints.s1.smart.list()).playlists[0].id;
  assert.deepEqual(await byEndpoints.s1.smart.play(id2, "ffff0000", false), { ok: true, by: "endpoints" });
  assert.deepEqual(byEndpoints.core.rec.plays.map((p) => p.zone), ["1601aabbcc"]);
  const none = await rig(t, {}, { official: { id: "ffff0000", name: "Garage", outputs: ["Garage"] } });
  const id3 = (await none.s1.smart.list()).playlists[0].id;
  assert.match((await none.s1.smart.play(id3, "ffff0000", false)).notSent, /couldn't tell which of your server's zones is "Garage"/);
  assert.deepEqual(none.core.rec.plays, []);
});

test("refused: said as the server said it; taken and the zone not playing: said, never believed", async (t) => {
  const refused = await rig(t, { refusePlay: true });
  const id = (await refused.quick.list()).playlists[0].id;
  assert.match((await refused.quick.play(id, "1601aabbcc", false)).notSent, /refused to play it \("Refused"\)/);
  const ignored = await rig(t, { playIgnored: true });
  const id2 = (await ignored.quick.list()).playlists[0].id;
  assert.deepEqual(await ignored.quick.play(id2, "1601aabbcc", false), { notShown: "Your server took it, but the zone didn't start playing." });
});

test("nothing asked: native mode off (nothing to say), a zone not chosen, a page past the fifth, a playlist not listed", async (t) => {
  const off = await rig(t, {}, { off: true });
  assert.deepEqual(await off.s1.smart.list(), { notSent: "" });
  const w = await rig(t);
  const id = (await w.s1.smart.list()).playlists[0].id;
  assert.match((await w.s1.smart.play(id, "nope", false)).notSent, /Choose a zone/);
  assert.match((await w.s1.smart.page(id, 5)).notSent, /first 500 tracks/);
  assert.match((await w.s1.smart.page("00".repeat(16), 0)).notSent, /doesn't list that smart playlist/);
  assert.deepEqual(w.core.rec.plays, []);
});

test("a page asked for with under 50,000 objects of room left: not read, said — the rest of native mode keeps its own 25,000", async (t) => {
  const w = await rig(t);
  const id = (await w.s1.smart.list()).playlists[0].id;
  const { graph } = w.link.session();
  graph.maxObjects = graph.objects.size + 40000;
  assert.match((await w.s1.smart.page(id, 0)).notSent, /as much of your server's smart playlists as it keeps room for/);
  assert.deepEqual(w.core.rec.itemQueries || [], [], "the items query opened all the same");
});

test("believed (§12.3): it starts playing, its queue grows, or another track — never the queue moving on by one by itself", () => {
  const z = (state, line, left) => ({ state, line, left });
  assert.equal(played(z("stopped", null, 0), z("playing", "A", 5007)), true, "it started");
  assert.equal(played(z("playing", "A", 3), z("playing", "B", 2)), false, "a track ending taken for the play");
  assert.equal(played(z("playing", "A", 3), z("playing", "A", 5006)), true, "the queue replaced, its first track the one playing");
  assert.equal(played(z("playing", "A", 30), z("playing", "B", 1)), true, "a short playlist in place of a longer queue");
  assert.equal(played(z("playing", "A", null), z("playing", "B", null)), true, "no queue count: another track");
  assert.equal(played(z("playing", "A", 3), z("paused", "B", 5007)), false, "not playing");
});
