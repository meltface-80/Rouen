"use strict";
// ---------------------------------------------------------------------------
// N2c-2 (lib/roon-direct/later.js, v1.9.45, native-remote.md §10.4): Roon's
// own Listen Later in place of Rouen's — read, an album put on it and taken
// off it by Library::SetListenLaterState, each believed once GetListenLater
// shows it — end to end over the link against the fake server
// (test/lib/fake-roon-later.js), which reads the call strictly. The fake is
// not evidence that the real server takes this form: the owner's Roon app
// showing the album is.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createStage1 } = require("../../lib/roon-direct/stage1");
const { createLink } = require("../../lib/roon-direct/link");
const { readAlbumsOn } = require("../../lib/roon-direct/albums");
const { createLater, entriesOf } = require("../../lib/roon-direct/later");
const { startFakeCore } = require("../lib/fake-roon-core");
const { dotnetGuidBytes } = require("../../lib/roon-direct/brokerid");
const { CORE_ID, LIBRARY, assertTidy } = require("../lib/roon-direct-fixtures");

const keyOf = (title, artist) => (title ? `${title.toLowerCase()}||${artist.toLowerCase()}` : null);
const until = async (fn) => { for (let i = 0; i < 250 && !fn(); i++) await new Promise((r) => { setTimeout(r, 20); }); return fn(); };
const CATALOG = [
  { title: "Selected Ambient Works 85-92", artist: "Aphex Twin", source: "tidal" },
  { title: "Homogenic", artist: "Björk", source: "qobuz" },
  { title: "Kid A", artist: "Radiohead", source: "tidal", noAlbumId: true },
];
const LIB_ID = (i) => String(7000000000000n + BigInt(i));
const CAT_ID = (j) => String(8000000000000n + BigInt(j));

async function rig(t, faults, o = {}) {
  const albums = LIBRARY.map((a) => Object.assign({}, a));
  const listenLater = (o.later || [{ catalog: 0 }, { library: 2 }]).map((x) => Object.assign({}, x));
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums, catalog: CATALOG, listenLater,
    faults: Object.assign({ sentOnce: true }, faults) });
  let s1 = null;
  const reads = [];
  let changes = 0;
  const link = createLink({ core: () => ({ host: "127.0.0.1", coreId: CORE_ID }), port: core.port, timeoutMs: 1500,
    settleMs: 800, retryFirstMs: 100, onUp: () => s1.linkUp() });
  s1 = createStage1({
    settings: { load: () => (o.profile ? { on: false, profile: o.profile } : null), save() {} }, cache: { read: () => null, write() {}, remove() {} },
    core: () => ({ host: "127.0.0.1", coreId: CORE_ID, coreVersion: "2.0" }), rouenVersion: "1.9.45",
    records: () => [], keyOf, link, minGapMs: 0, onLaterChange: () => { changes++; },
    read: async (s, ro) => { const r = await readAlbumsOn(s, Object.assign({ timeoutMs: 1000 }, ro)); reads.push(r.ok); return r; },
  });
  t.after(async () => { s1.turnOff(); await core.close(); });
  if (o.off) return { core, s1, link, listenLater };
  s1.turnOn();
  assert.ok(await until(() => reads.length >= 1 && s1.albums()), "the library was never read");
  // later.js with short waits, on the same connection (a test sends nothing else at the same time).
  const quick = createLater({ reader: s1.later, link, inTurn: (fn) => fn(), on: () => true, profile: () => null, albums: () => s1.albums(),
    finder: s1.finder, keyOf, confirmMs: 300, pollMs: 50 });
  return { core, s1, link, listenLater, quick, changes: () => changes };
}

test("THE one for N2c-2: Roon's list read; a library album and a catalogue album put on it, one taken off — each believed once the list shows it", async (t) => {
  const w = await rig(t);
  const l = w.s1.listenLater;
  const first = await l.list();
  assert.deepEqual(first.entries.map((e) => [e.title, e.artist, e.service, e.inLibrary, e.albumId]), [
    ["Mezzanine", "Massive Attack", "tidal", true, LIB_ID(2)],
    ["Selected Ambient Works 85-92", "Aphex Twin", "tidal", false, CAT_ID(0)],
  ], "newest first: the library album was put aside after the TIDAL one");
  assert.equal(l.has({ title: "selected ambient works 85-92", artist: "aphex twin" }), true);
  assert.equal(l.has({ title: "Dummy", artist: "Portishead" }), false);

  // A library album: named by the AlbumId the library read keeps, no search.
  assert.deepEqual(await l.set({ title: "Dummy", artist: "Portishead" }, true), { ok: true, on: true });
  // A catalogue album: found by your server's search (the copy on the service asked, else the other's).
  assert.deepEqual(await l.set({ title: "Homogenic", artist: "Björk", service: "tidal" }, true), { ok: true, on: true });
  // Taken off: by the id Roon's list gave it.
  assert.deepEqual(await l.set({ title: "Mezzanine", artist: "Massive Attack" }, false), { ok: true, on: false });
  assert.deepEqual(w.core.rec.laterSets, [
    { profile: "cafebabe", albums: [LIB_ID(3)], state: 1 },
    { profile: "cafebabe", albums: [CAT_ID(1)], state: 1 },
    { profile: "cafebabe", albums: [LIB_ID(2)], state: 0 },
  ]);
  assert.deepEqual(w.core.rec.searches.map((x) => x.terms), ["Homogenic Björk"], "a library album was searched for");
  assert.deepEqual((await l.list(0)).entries.map((e) => e.title), ["Homogenic", "Dummy", "Selected Ambient Works 85-92"]);
  assert.ok(w.changes() >= 3, "every open screen told of each change");
  // Off a list that doesn't hold it: nothing sent.
  assert.deepEqual(await l.set({ title: "Blue", artist: "Joni Mitchell" }, false), { ok: true, on: false });
  assert.equal(w.core.rec.laterSets.length, 3);
  assertTidy(w.core.rec);
});

test("not sent — said, for today's way: not found, no id, refused, several profiles and none chosen; native mode off: nothing to say", async (t) => {
  const w = await rig(t);
  assert.match((await w.s1.listenLater.set({ title: "Nothing Like It", artist: "Nobody" }, true)).notSent, /didn't find this album on TIDAL or Qobuz/);
  assert.match((await w.s1.listenLater.set({ title: "Kid A", artist: "Radiohead", service: "tidal" }, true)).notSent, /not with the id/);
  assert.deepEqual(w.core.rec.laterSets, []);
  const refused = await rig(t, { refuseLaterSet: true });
  assert.match((await refused.s1.listenLater.set({ title: "Dummy", artist: "Portishead" }, true)).notSent, /refused it \("Refused"\)/);
  const two = await rig(t, { twoProfiles: true });
  assert.match((await two.s1.listenLater.set({ title: "Dummy", artist: "Portishead" }, true)).notSent, /Choose your profile/);
  assert.deepEqual(two.core.rec.laterSets, []);
  const off = await rig(t, {}, { off: true });
  assert.deepEqual(await off.s1.listenLater.set({ title: "Dummy", artist: "Portishead" }, true), { off: true });
  assert.equal(off.s1.listenLater.has({ title: "Dummy", artist: "Portishead" }), null, "native mode off: Rouen's own list says");
});

test("sent and not shown: said, never believed", async (t) => {
  const w = await rig(t, { laterSetIgnored: true });
  assert.match((await w.quick.set({ title: "Dummy", artist: "Portishead" }, true)).notShown, /didn't show it on the list/);
  assert.match((await w.quick.set({ title: "Mezzanine", artist: "Massive Attack" }, false)).notShown, /didn't show it taken off/);
  assert.equal(w.core.rec.laterSets.length, 2);
});

test("Rouen's own list moved onto Roon's: already there and the ones it took handed back to leave Rouen's list; the rest stay, said", async (t) => {
  const w = await rig(t);
  const rows = [{ title: "Selected Ambient Works 85-92", artist: "Aphex Twin" }, { title: "Moon Safari", artist: "Air" },
    { title: "Homogenic", artist: "Björk", service: "qobuz" }, { title: "Nothing Like It", artist: "Nobody" }];
  const moved = [];
  assert.equal(w.quick.listedOn(), null, "nothing read yet: no connection to move on");
  assert.deepEqual(w.quick.move(rows, (x) => moved.push(x.title)), { running: true, total: 4 });
  assert.match(w.quick.move(rows, () => {}).error, /already being moved/);
  assert.ok(await until(() => !w.quick.moveProgress().running));
  assert.deepEqual(w.quick.moveProgress().done.map((d) => [d.title, d.result]), [
    ["Selected Ambient Works 85-92", "already"], ["Moon Safari", "moved"], ["Homogenic", "moved"], ["Nothing Like It", "failed"]]);
  assert.deepEqual(moved, ["Selected Ambient Works 85-92", "Moon Safari", "Homogenic"], "only what Roon's list shows leaves Rouen's");
  assert.match(w.quick.moveProgress().done[3].why, /didn't find this album/);
  assert.deepEqual(w.core.rec.laterSets.map((x) => x.albums), [[LIB_ID(6)], [CAT_ID(1)]]);
  assert.equal(typeof w.quick.listedOn(), "number", "read on this connection, named by its number");
});

test("sent for the move and not shown: stays on Rouen's list, said", async (t) => {
  const w = await rig(t, { laterSetIgnored: true });
  const moved = [];
  w.quick.move([{ title: "Moon Safari", artist: "Air" }], (x) => moved.push(x.title));
  assert.ok(await until(() => !w.quick.moveProgress().running));
  assert.deepEqual(w.quick.moveProgress().done.map((d) => [d.result, d.why]), [["not-shown", "Your server took it, but its Listen Later didn't show it."]]);
  assert.deepEqual(moved, []);
});

test("only albums still to listen to, newest first; one with no id is left out", () => {
  const a = (title, albumId) => ({ title, artist: "X", source: "TIDAL", inLibrary: false, albumId, imageKey: null });
  const out = entriesOf([
    { state: 1, at: "2026-10-21T00:00:00.001Z", album: a("Old", "1") },
    { state: 2, at: "2026-10-21T00:00:00.009Z", album: a("Played", "2") },
    { state: 1, at: "2026-10-21T00:00:00.005Z", album: a("New", "3") },
    { state: 1, at: null, album: a("No id", null) },
    { state: 1, at: null, track: "A track", album: null },
  ]);
  assert.deepEqual(out.map((e) => [e.title, e.service]), [["New", "tidal"], ["Old", "tidal"]]);
});

// The review (v1.9.45): a read that fails or answers oddly never leaves a change half-said, nor swaps the list shown.
test("a read that throws, or answers with no list: not read, never a rejection; this connection's last list kept meanwhile", async () => {
  let mode = "ok", clock = 0;
  const item = { state: 1, at: null, album: { title: "Dummy", artist: "Portishead", source: "TIDAL", inLibrary: true, albumId: "7", imageKey: null } };
  const reader = { async read() {
    if (mode === "throw") throw new Error("timed out");
    if (mode === "notList") return { read: true, complete: true, list: { notList: true, items: [] } };
    return { read: true, complete: true, list: { items: [item] } };
  } };
  const sent = [];
  // A session as later.js uses one; its call answers "Success", and the reads after it fail.
  const s = { g: { uncertain: () => false, defineType: () => 1, call: async (oid, sig) => { sent.push(sig); mode = "throw"; return { success: true }; } },
    root: { profiles: [], profileId: Buffer.from("cafebabe", "hex"), library: { oid: 1n } },
    graph: { ofType: () => [{ oid: 9n }], maxObjects: 1e6, objects: { size: 0 } } };
  const make = (sess) => createLater({ reader, link: { session: () => sess }, inTurn: (fn) => fn(), on: () => true, profile: () => null,
    albums: () => [{ title: "Blue", artist: "Joni Mitchell", albumId: "2" }], finder: /** @type {any} */ ({}), keyOf,
    now: () => clock++, confirmMs: 100, pollMs: 10 });   // each look at the clock a millisecond on
  const l = make(s);
  assert.deepEqual((await l.list()).entries.map((e) => e.title), ["Dummy"]);
  clock = 60000;
  mode = "notList";
  assert.deepEqual((await l.list()).entries.map((e) => e.title), ["Dummy"], "a list that isn't one taken as empty");
  mode = "throw";
  assert.deepEqual((await l.list()).entries.map((e) => e.title), ["Dummy"], "a failed read swapped this connection's list for nothing");
  // Sent, then the reads that would confirm it fail: said as not shown — never thrown, so never kept on Rouen's list too.
  mode = "ok";
  const out = await l.set({ title: "Blue", artist: "Joni Mitchell" }, true);
  assert.equal(sent.length, 1);
  assert.match(out.notShown, /didn't show it/);
  // Read on one connection: says nothing on another until read there.
  let now = s;
  const moved = createLater({ reader, link: { session: () => now }, inTurn: (fn) => fn(), on: () => true, profile: () => null, albums: () => null,
    finder: /** @type {any} */ ({}), keyOf });
  mode = "ok";
  await moved.list();
  assert.equal(moved.has({ title: "Dummy", artist: "Portishead" }), true);
  now = Object.assign({}, s);
  assert.equal(moved.has({ title: "Dummy", artist: "Portishead" }), null, "another connection's list said for this one");
});
