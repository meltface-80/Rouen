"use strict";
// ---------------------------------------------------------------------------
// N2d (lib/roon-direct/playlists.js, v1.9.42, native-remote.md §11): Roon's own
// playlists, read and changed by the server itself — end to end over the link
// against the fake server (test/lib/fake-roon-playlists.js), which reads each
// call strictly. The fake is not evidence that the real server sends these
// objects or takes these forms: the owner's Roon app showing the playlist is.
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
const MINE = [{ name: "Morning", tracks: 3 }, { name: "Roon's Daily Mix", readOnly: true, tracks: 25 }];

async function rig(t, faults, o = {}) {
  const albums = LIBRARY.map((a) => Object.assign({}, a));
  // Two of Blue's tracks of one name (a reprise, a second take): neither can be told apart by its title.
  if (o.twins) albums[1].titles = ["Blue 1", "Blue 2", "Blue 2"];
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums, playlists: MINE.map((p) => Object.assign({}, p)),
    faults: Object.assign({ sentOnce: true }, faults) });
  let s1 = null;
  const reads = [];
  const link = createLink({ core: () => ({ host: "127.0.0.1", coreId: CORE_ID }), port: core.port, timeoutMs: 1500,
    settleMs: 800, retryFirstMs: 100, onUp: () => s1.linkUp() });
  s1 = createStage1({
    settings: { load: () => (o.profile ? { on: false, profile: o.profile } : null), save() {} }, cache: { read: () => null, write() {}, remove() {} },
    core: () => ({ host: "127.0.0.1", coreId: CORE_ID, coreVersion: "2.0" }), rouenVersion: "1.9.42",
    records: () => [], keyOf, link, minGapMs: 0,
    read: async (s, ro) => { const r = await readAlbumsOn(s, Object.assign({ timeoutMs: 1000 }, ro)); reads.push(r.ok); return r; },
  });
  t.after(async () => { s1.turnOff(); await core.close(); });
  if (o.off) return { core, s1, link };
  s1.turnOn();
  assert.ok(await until(() => reads.length >= 1 && s1.albums()), "the library was never read");
  return { core, s1, link };
}

test("THE one for N2d: Roon's playlists read; one made, tracks and albums added at its end, renamed, deleted — each call as the catalogue has it", async (t) => {
  const w = await rig(t);
  const p = w.s1.playlists;
  const listed = await p.list();
  assert.deepEqual(listed.playlists.map((x) => [x.name, x.tracks, x.readOnly]), [["Morning", 3, false], ["Roon's Daily Mix", 25, true]]);
  assert.match(listed.playlists[0].id, /^[0-9a-f]{32}$/, "a playlist named by anything but its PlaylistId");
  const made = await p.create("From Rouen");
  assert.equal(made.name, "From Rouen");
  // Tracks by album: "Blue" also matches "Kind of Blue" by text — each track found on its own album, by its title.
  const added = await p.addTracks(made.id, [
    { title: "Blue 2", album_title: "Blue", album_subtitle: "Joni Mitchell" },
    { title: "Kind of Blue 1", album_title: "Kind of Blue", album_subtitle: "Miles Davis" },
    { title: "Blue 3", album_title: "Blue", album_subtitle: "Joni Mitchell" },
    { title: "Blue 99", album_title: "Blue", album_subtitle: "Joni Mitchell" },
    { title: "Anything", album_title: "Not In The Library", album_subtitle: "Nobody" },
  ]);
  assert.deepEqual(added, { sent: 3, missing: ["Blue 99", "Anything"], failed: [], why: null });
  const albums = await p.addAlbums(made.id, [{ title: "Dummy", subtitle: "Portishead" }, { title: "Gone", subtitle: "Nobody" }]);
  assert.deepEqual(albums, { sent: 1, missing: ["Gone"], failed: [], why: null });
  assert.deepEqual(await p.rename(made.id, "From Rouen, renamed"), { ok: true });
  assert.deepEqual(w.core.rec.playlists.map((x) => [x.name, x.tracks]), [["Morning", 3], ["Roon's Daily Mix", 25], ["From Rouen, renamed", 14]]);
  assert.deepEqual(await p.remove(made.id), { ok: true, name: "From Rouen, renamed" });
  assert.deepEqual(w.core.rec.playlists.map((x) => x.name), ["Morning", "Roon's Daily Mix"]);
  assert.deepEqual(w.core.rec.playlistCalls.map((c) => c.kind), ["create", "tracks", "tracks", "tracks", "albums", "rename", "remove"]);
  assert.deepEqual(w.core.rec.playlistCalls[0], { kind: "create", profile: "2", name: "From Rouen", description: "", overwrite: false });
  // In the order picked, across albums (each run of one album's tracks its own insert).
  assert.deepEqual(w.core.rec.playlistCalls.filter((c) => c.kind === "tracks").map((c) => c.tracks), [["Blue 2"], ["Kind of Blue 1"], ["Blue 3"]]);
  assert.equal(w.core.rec.playlistCalls[5].overwrite, false, "a rename that may overwrite another playlist");
  // Each album's track page released once and its query disposed once; nothing off the allowlist.
  assertTidy(w.core.rec);
  assert.deepEqual(w.core.rec.hearts, []);
});

test("nothing sent to a playlist that can't be changed or isn't there, nor when the server sends no playlists", async (t) => {
  const w = await rig(t);
  const { playlists } = await w.s1.playlists.list();
  assert.match((await w.s1.playlists.addTracks(playlists[1].id, [{ title: "Blue 1", album_title: "Blue", album_subtitle: "Joni Mitchell" }])).notSent, /can't be changed/);
  assert.match((await w.s1.playlists.rename("00".repeat(16), "x")).notSent, /doesn't list that playlist/);
  assert.deepEqual(w.core.rec.playlistCalls, []);
  const none = await rig(t, { noPlaylists: true });
  assert.match((await none.s1.playlists.list()).notSent, /didn't send its playlists/);
  assert.match((await none.s1.playlists.create("x")).notSent, /didn't send its playlists/);
  assert.deepEqual(none.core.rec.playlistCalls, []);
});

test("refused: said as the server said it; several profiles and none chosen: not made; native mode off: nothing to explain", async (t) => {
  const refused = await rig(t, { refusePlaylists: true });
  assert.match((await refused.s1.playlists.create("x")).error, /refused the new playlist \("Refused"\)/);
  const two = await rig(t, { twoProfiles: true });
  assert.match((await two.s1.playlists.create("x")).notSent, /Choose your profile/);
  assert.deepEqual(two.core.rec.playlistCalls, []);
  const off = await rig(t, {}, { off: true });
  assert.deepEqual(await off.s1.playlists.list(), { notSent: "" });
});

test("a title two of an album's tracks share is not sent: it can't be told which is meant", async (t) => {
  const w = await rig(t, {}, { twins: true });
  const made = await w.s1.playlists.create("Twins");
  assert.deepEqual(await w.s1.playlists.addTracks(made.id, [{ title: "Blue 2", album_title: "Blue", album_subtitle: "Joni Mitchell" },
    { title: "Blue 1", album_title: "Blue", album_subtitle: "Joni Mitchell" }]), { sent: 1, missing: ["Blue 2"], failed: [], why: null });
  assert.deepEqual(w.core.rec.playlistCalls.filter((c) => c.kind === "tracks").map((c) => c.tracks), [["Blue 1"]]);
});

test("before the library is read on this connection, or with a name Roon already has, nothing is sent — said, for today's way", async (t) => {
  const w = await rig(t);
  assert.match((await w.s1.playlists.create("Morning")).notSent, /already has a playlist named "Morning"/);
  // The library's objects as read on another connection (one cycled since, not read again yet).
  const { createPlaylists } = require("../../lib/roon-direct/playlists");
  const early = createPlaylists({ link: w.link, inTurn: (fn) => fn(), on: () => true, profile: () => null, albums: () => w.s1.albums(),
    readOn: () => ({ another: "session" }), keyOf });
  const { playlists } = await early.list();
  assert.match((await early.addTracks(playlists[0].id, [{ title: "Blue 1", album_title: "Blue", album_subtitle: "Joni Mitchell" }])).notSent,
    /hasn't been read on this connection/);
  assert.match((await early.addAlbums(playlists[0].id, [{ title: "Blue", subtitle: "Joni Mitchell" }])).notSent, /hasn't been read on this connection/);
  assert.deepEqual(w.core.rec.playlistCalls, [], "tracks called not in the library, and none kept");
});
