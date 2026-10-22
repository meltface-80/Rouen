"use strict";
// ---------------------------------------------------------------------------
// N2e-3b-3 (lib/roon-direct/smart-move.js, v1.9.61, native-remote.md §12.16):
// Rouen's Dynamic Playlists moved onto Roon's smart playlists by themselves,
// end to end against the fake server — one already there (Folk, made by the
// test) recognised, one made, one Roon can't hold kept with why, one of a name
// Roon holds with another Focus kept; once a connection, again after a save.
// Not evidence that the real server takes it: the owner's Roon is.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createStage1 } = require("../../lib/roon-direct/stage1");
const { createLink } = require("../../lib/roon-direct/link");
const { readAlbumsOn } = require("../../lib/roon-direct/albums");
const { mapFocus } = require("../../lib/roon-direct/focus-map");
const { createSmartMove } = require("../../lib/roon-direct/smart-move");
const { startFakeCore } = require("../lib/fake-roon-core");
const { dotnetGuidBytes } = require("../../lib/roon-direct/brokerid");
const { CORE_ID, LIBRARY } = require("../lib/roon-direct-fixtures");

const keyOf = (title, artist) => (title ? `${title.toLowerCase()}||${artist.toLowerCase()}` : null);
const until = async (fn, n = 250) => { for (let i = 0; i < n && !fn(); i++) await new Promise((r) => { setTimeout(r, 20); }); return fn(); };
const PLAYLISTS = [{ name: "Morning", tracks: 3, items: 3 }];
const FOLK = { id: "sp_folk", name: "Folk - My Dynamic Playlist", view: { sort: "album", dir: "asc", seed: 1, played: "any", genre: ["Folk"] }, limit: 400 };
const SEVENTIES = { id: "sp_1970", name: "1970", view: { sort: "album", dir: "asc", seed: 1, played: "any", decade: ["1970"] }, limit: 25 };
const STEREO = { id: "sp_st", name: "Stereo", view: { sort: "album", dir: "asc", seed: 1, played: "any", chan: ["2"] }, limit: 100 };
const MORNING = { id: "sp_m", name: "Morning", view: { sort: "album", dir: "asc", seed: 1, played: "any", genre: ["Folk"] }, limit: 100 };

async function rig(t) {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY.map((a) => Object.assign({}, a)),
    playlists: PLAYLISTS.map((p) => Object.assign({}, p)), faults: { sentOnce: true } });
  let s1 = null;
  const reads = [];
  const link = createLink({ core: () => ({ host: "127.0.0.1", coreId: CORE_ID }), port: core.port, timeoutMs: 1500,
    settleMs: 800, retryFirstMs: 100, onUp: () => s1.linkUp() });
  s1 = createStage1({
    settings: { load: () => null, save() {} }, cache: { read: () => null, write() {}, remove() {} },
    core: () => ({ host: "127.0.0.1", coreId: CORE_ID, coreVersion: "2.0" }), rouenVersion: "1.9.61",
    records: () => [], keyOf, link, minGapMs: 0,
    read: async (s, ro) => { const r = await readAlbumsOn(s, Object.assign({ timeoutMs: 1000 }, ro)); reads.push(r.ok); return r; },
  });
  t.after(async () => { s1.turnOff(); await core.close(); });
  s1.turnOn();
  assert.ok(await until(() => reads.length >= 1 && s1.albums()), "the library was never read");
  return { core, s1, link };
}

test("THE one for N2e-3b-3: Folk found already moved, 1970 made, Stereo and Morning kept with why — once a connection, again after a save", async (t) => {
  const w = await rig(t);
  // Folk, as the owner's test made it (§12.8).
  assert.equal((await w.s1.smartMaker.make(FOLK.name, mapFocus(FOLK, 230, null).focus)).made, true);
  const before = w.core.rec.playlistCalls.length;
  const items = [FOLK, SEVENTIES, STEREO, MORNING].map((sp) => ({ sp, matched: sp === SEVENTIES ? 382 : 40, unavailable: null }));
  const moved = [];
  const started = w.s1.smartMove.maybe(() => items, (sp, roonId, how) => { moved.push([sp.id, how, /^[0-9a-f]+$/.test(roonId)]); });
  assert.deepEqual(started, { running: true, total: 4 });
  assert.ok(await until(() => !w.s1.smartMove.progress().running, 500), "the move never ended");
  assert.deepEqual(moved, [["sp_folk", "already", true], ["sp_1970", "moved", true]]);
  const done = w.s1.smartMove.progress().done.map((d) => [d.name, d.result, d.why]);
  assert.deepEqual(done, [
    ["Folk - My Dynamic Playlist", "already", null],
    ["1970", "moved", "Roon's smart playlists have no album limit: Roon holds all 382 albums it matches, not 25."],
    ["Stereo", "kept", "its Channels filter (Roon's channel layout names aren't known)"],
    ["Morning", "kept", "Your server has a playlist named \"Morning\" that isn't smart."]]);
  const calls = w.core.rec.playlistCalls.slice(before);
  assert.deepEqual(calls.map((c) => [c.kind, c.name]), [["smart", "1970"]], "anything but 1970 sent");
  assert.deepEqual([calls[0].extra.MinDate, calls[0].extra.MaxDate], [129105920, 129698847]);
  // Once a connection: nothing new, nothing sent; a save moves again.
  assert.deepEqual(w.s1.smartMove.maybe(() => items, () => {}), { idle: "Nothing new to move." });
  w.s1.smartMove.changed();
  assert.deepEqual(w.s1.smartMove.maybe(() => [], () => {}), { idle: "Rouen has no Dynamic Playlists of its own." });
});

test("a smart playlist of that name with another Focus stays Rouen's, said; native mode off or not connected: nothing", async (t) => {
  const w = await rig(t);
  assert.equal((await w.s1.smartMaker.make(FOLK.name, mapFocus(FOLK, 230, null).focus)).made, true);
  const other = Object.assign({}, FOLK, { view: Object.assign({}, FOLK.view, { sort: "artist" }) });
  w.s1.smartMove.maybe(() => [{ sp: other, matched: 40, unavailable: null }], () => { assert.fail("moved one with another Focus"); });
  assert.ok(await until(() => !w.s1.smartMove.progress().running, 500));
  assert.deepEqual(w.s1.smartMove.progress().done.map((d) => [d.result, d.why]),
    [["kept", "Your server already has a smart playlist named \"Folk - My Dynamic Playlist\" with another Focus: rename one of them."]]);
  const off = createSmartMove({ maker: () => w.s1.smartMaker, on: () => false, connection: () => ({}) });
  assert.deepEqual(off.maybe(() => [], () => {}), { idle: "Native mode is off." });
  const gone = createSmartMove({ maker: () => w.s1.smartMaker, on: () => true, connection: () => null });
  assert.deepEqual(gone.maybe(() => [], () => {}), { idle: "Native mode isn't connected to your server right now." });
});

test("the review: Roon's playlist of that name with its genres all required (And) is not Rouen's any-of one — kept, said", async (t) => {
  const w = await rig(t);
  w.core.rec.playlists.push({ n: 60, name: "Folk and R&B", smart: true, readOnly: true, tracks: 5, albums: 1,
    focus: { require: [28001n, 28000n], exclude: [] }, genresMode: 0, ordering: { Ordering: 4, Direction: 1 } });
  // Not yet sent to this connection: the fake pushes the list again on any change.
  assert.equal((await w.s1.smartMaker.make(FOLK.name, mapFocus(FOLK, 230, null).focus)).made, true);
  const anyOf = { id: "sp_fr", name: "Folk and R&B", view: { sort: "album", dir: "asc", seed: 1, played: "any", genre: ["Folk", "R&B"] }, limit: 100 };
  w.s1.smartMove.maybe(() => [{ sp: anyOf, matched: 40, unavailable: null }], () => { assert.fail("took an And playlist for Rouen's any-of one"); });
  assert.ok(await until(() => !w.s1.smartMove.progress().running, 500));
  assert.deepEqual(w.s1.smartMove.progress().done.map((d) => d.result), ["kept"]);
});

test("the review: deleted or edited while the move ran — not sent as it was, and moved again next", async (t) => {
  const w = await rig(t);
  const before = w.core.rec.playlistCalls.length;
  w.s1.smartMove.maybe(() => [{ sp: SEVENTIES, matched: 382, unavailable: null }], () => { assert.fail("moved a playlist since changed"); }, () => false);
  assert.ok(await until(() => !w.s1.smartMove.progress().running, 500));
  assert.deepEqual(w.s1.smartMove.progress().done.map((d) => d.result), ["kept"]);
  assert.equal(w.core.rec.playlistCalls.length, before, "sent anyway");
  assert.deepEqual(w.s1.smartMove.maybe(() => [], () => {}), { idle: "Rouen has no Dynamic Playlists of its own." }, "not asked again after the change");
});
