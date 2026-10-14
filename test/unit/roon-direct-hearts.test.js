"use strict";
// ---------------------------------------------------------------------------
// Hearts, written to the Core (lib/roon-direct/marks.js, native-remote.md §8,
// v1.9.27), end to end over the link against the fake Core — which reads the
// bytes strictly (test/lib/fake-roon-hearts.js) but is not evidence that a
// real Core behaves this way (§2's "live" column is).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createStage1 } = require("../../lib/roon-direct/stage1");
const { createLink } = require("../../lib/roon-direct/link");
const { readAlbumsOn } = require("../../lib/roon-direct/albums");
const { startFakeCore } = require("../lib/fake-roon-core");
const { dotnetGuidBytes } = require("../../lib/roon-direct/brokerid");
const { CORE_ID, LIBRARY, assertTidy } = require("../lib/roon-direct-fixtures");

const keyOf = (title, artist) => (title ? `${title.toLowerCase()}||${artist.toLowerCase()}` : null);
const until = async (fn) => { for (let i = 0; i < 250 && !fn(); i++) await new Promise((r) => { setTimeout(r, 20); }); return fn(); };
/** Releases and disposals are sent without waiting: tidy once the fake has read them all. */
async function tidy(rec) {
  await until(() => rec.released.length >= rec.retained.length && rec.disposed.length >= rec.opened.length);
  assertTidy(rec);
}
const BLUE = Array.from({ length: 10 }, (_, i) => `Blue ${i + 1}`);

async function rig(t, faults) {
  // And one more by the same artist whose title holds "Blue": only the album's id tells its tracks apart.
  const albums = LIBRARY.map((a) => Object.assign({}, a)).concat([{ title: "Blue (Deluxe)", artist: "Joni Mitchell", source: "local", tracks: 3 }]);
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums, faults });
  let s1 = null;
  let reads = 0;
  const link = createLink({ core: () => ({ host: "127.0.0.1", coreId: CORE_ID }), port: core.port, timeoutMs: 1500,
    settleMs: 800, retryFirstMs: 100, onUp: () => s1.linkUp() });
  s1 = createStage1({
    settings: { load: () => null, save() {} }, cache: { read: () => null, write() {}, remove() {} },
    core: () => ({ host: "127.0.0.1", coreId: CORE_ID, coreVersion: "2.0" }), rouenVersion: "1.9.27",
    records: () => [], keyOf, link, minGapMs: 0,
    read: async (s) => { const r = await readAlbumsOn(s, {}); reads++; return r; },
  });
  t.after(async () => { s1.turnOff(); await core.close(); });
  s1.turnOn();
  assert.ok(await until(() => reads === 1 && s1.albums()), "the library was never read");
  return { core, s1, albums, marks: s1.marks, reads: () => reads };
}

test("THE one: an album heart reaches the Core, for Rouen's profile, by the album's stable id", async (t) => {
  const w = await rig(t);
  assert.deepEqual(w.marks.albumState("Blue", "Joni Mitchell"), { available: true, favorite: false, tracks: true, tracksWhy: null });
  assert.deepEqual(await w.marks.setAlbum("Blue", "Joni Mitchell", true), { ok: true, favorite: true });
  assert.deepEqual(w.core.rec.hearts, [{ albums: ["7000000000001"], state: 1 }]);
  assert.equal(w.albums[1].favorite, true, "the fake Core did not take it");
  assert.equal(w.marks.albumState("Blue", "Joni Mitchell").favorite, true);
  await tidy(w.core.rec);     // before the drop: the fake's object ids start again on each connection
  // The next read shows it: believed, and counted.
  w.core.drop();
  assert.ok(await until(() => w.reads() === 2));
  assert.deepEqual([w.marks.status().albumConfirmed, w.marks.status().awaiting, w.marks.status().album.on], [1, 0, true]);
});

test("a heart the Core says yes to, but whose next read shows otherwise, drops album hearts back", async (t) => {
  const w = await rig(t, { heartsIgnored: true });
  assert.equal((await w.marks.setAlbum("Blue", "Joni Mitchell", true)).ok, true);
  w.core.drop();
  assert.ok(await until(() => w.reads() === 2));
  const st = w.marks.albumState("Blue", "Joni Mitchell");
  assert.equal(st.available, false, "THE one: a heart the Core never kept is still offered");
  assert.match(st.why, /next read of the library didn't show it/);
});

test("refused: album hearts fall back, saying why; a new session tries again", async (t) => {
  const w = await rig(t, { refuseHearts: true });
  const r = await w.marks.setAlbum("Blue", "Joni Mitchell", true);
  assert.equal(r.status, 409);
  assert.match(r.error, /refused an album heart \("Refused"\)/);
  assert.equal(w.marks.albumState("Blue", "Joni Mitchell").available, false);
  assert.deepEqual(w.marks.status().album, { on: false, why: r.error });
});

test("an album that cannot be named is refused for that tap alone", async (t) => {
  const w = await rig(t);
  assert.equal((await w.marks.setAlbum("Not There", "Nobody", true)).status, 404);
  assert.equal(w.core.rec.hearts.length, 0);
  assert.equal(w.marks.status().album.on, true, "one unknown album turned hearts off");
});

test("no Broker in the graph: album hearts fall back before anything is sent", async (t) => {
  const w = await rig(t, { noBroker: true });
  const r = await w.marks.setAlbum("Blue", "Joni Mitchell", true);
  assert.match(r.error, /without its Broker/);
  assert.equal(w.core.rec.hearts.length, 0);
});

test("THE one for tracks: the picked tracks of this album only — not 'Blue (Deluxe)', which the text filters also match", async (t) => {
  const w = await rig(t);
  const r = await w.marks.setTracks("Blue", "Joni Mitchell", BLUE, [0, 2], true);
  assert.deepEqual(r, { ok: true, count: 2, favorite: true });
  assert.deepEqual(w.core.rec.trackQueries, [{ albumTitle: "Blue", albumArtist: "Joni Mitchell" }]);
  // LIBRARY's tracks are numbered in order: Kind of Blue's 5 first (70000-70004), then Blue's.
  assert.deepEqual(w.core.rec.hearts, [{ track: "70005", state: 1 }, { track: "70007", state: 1 }]);
  await tidy(w.core.rec);
});

test("tracks that are not the album view's: refused for this album, not every album's", async (t) => {
  const w = await rig(t);
  const r = await w.marks.setTracks("Blue", "Joni Mitchell", BLUE.slice(0, 9), [0], true);
  assert.equal(r.status, 409);
  assert.match(r.error, /lists 10 track\(s\) for this album, not the 9 shown here/);
  assert.equal(w.core.rec.hearts.length, 0, "a heart was sent on a list that did not match");
  assert.equal(w.marks.status().track.on, true);
});

test("a track heart the Core never shows: track hearts fall back", async (t) => {
  const w = await rig(t, { noTrackHeartUpdate: true });
  const r = await w.marks.setTracks("Blue", "Joni Mitchell", BLUE, [1], true);
  assert.equal(r.status, 409);
  assert.match(r.error, /never showed it\. 0 of 1 were set\./);
  assert.equal(w.marks.status().track.on, false);
});

test("two tracks of one name: the one picked is refused, nothing sent", async (t) => {
  const w = await rig(t);
  const titles = BLUE.slice(); titles[3] = titles[0];
  assert.equal((await w.marks.setTracks("Blue", "Joni Mitchell", titles, [0], true)).status, 409);
  assert.equal(w.core.rec.trackQueries.length, 0);
});

test("native mode off: no heart is offered or sent", async (t) => {
  const w = await rig(t);
  w.s1.turnOff();
  assert.equal(w.marks.albumState("Blue", "Joni Mitchell").available, false);
  assert.equal((await w.marks.setAlbum("Blue", "Joni Mitchell", true)).status >= 400, true);
  assert.equal(w.core.rec.hearts.length, 0);
});
