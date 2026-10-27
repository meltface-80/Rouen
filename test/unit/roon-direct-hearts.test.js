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
const { createMarks } = require("../../lib/roon-direct/marks");
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

/** @param {(n: number, core: any, s1: any) => Promise<void>} [hook]  run as each read ends, before stage 1 takes it */
async function rig(t, faults, hook, edit) {
  // And one more by the same artist whose title holds "Blue": only the album's id tells its tracks apart.
  const albums = LIBRARY.map((a) => Object.assign({}, a)).concat([{ title: "Blue (Deluxe)", artist: "Joni Mitchell", source: "local", tracks: 3 }]);
  if (edit) edit(albums);
  // As the owner's server does (v1.9.28): each object sent once a connection.
  const f = Object.assign({ sentOnce: true }, faults);
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums, faults: f });
  let s1 = null;
  let reads = 0;
  const link = createLink({ core: () => ({ host: "127.0.0.1", coreId: CORE_ID }), port: core.port, timeoutMs: 1500,
    settleMs: 800, retryFirstMs: 100, onUp: () => s1.linkUp() });
  s1 = createStage1({
    settings: { load: () => (faults && faults.saved) || null, save() {} }, cache: { read: () => null, write() {}, remove() {} },
    core: () => ({ host: "127.0.0.1", coreId: CORE_ID, coreVersion: "2.0" }), rouenVersion: "1.9.27",
    records: () => [], keyOf, link, minGapMs: 0,
    read: async (s, o) => { const r = await readAlbumsOn(s, o); reads++; if (hook) await hook(reads, core, s1); return r; },
  });
  t.after(async () => { s1.turnOff(); await core.close(); });
  s1.turnOn();
  assert.ok(await until(() => reads === 1 && s1.albums()), "the library was never read");
  return { core, s1, albums, faults: f, marks: s1.marks, reads: () => reads };
}

test("THE one: an album heart reaches the Core, for Rouen's profile, by the album's stable id", async (t) => {
  const w = await rig(t);
  assert.deepEqual(w.marks.albumState("Blue", "Joni Mitchell"), { available: true, favorite: false, tracks: true, tracksWhy: null });
  assert.deepEqual(await w.marks.setAlbum("Blue", "Joni Mitchell", true), { ok: true, favorite: true });
  assert.deepEqual(w.core.rec.hearts, [{ albums: ["7000000000001"], state: 1 }]);
  assert.equal(w.albums[1].favorite, true, "the fake Core did not take it");
  assert.equal(w.marks.albumState("Blue", "Joni Mitchell").favorite, true);
  assert.ok(w.s1.factsRev() >= 1, "v1.9.70-t5: the heart counted, so the Shelf asks again (shelf-focus.md §2)");
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

// The protocol review (v1.9.27): a heart and a library read on the one
// session each took over the graph's object watch, and each put back what it
// found — so one went blind, the read came short and the whole library fell
// back. They take turns now.
test("THE one for the review: a track heart and a library read at once both succeed", async (t) => {
  const w = await rig(t);
  w.s1.linkUp();                                            // a read, now
  const heart = w.marks.setTracks("Blue", "Joni Mitchell", BLUE, [0], true);
  w.s1.linkUp();                                            // and another, behind the heart
  assert.deepEqual(await heart, { ok: true, count: 1, favorite: true });
  await w.s1.settled();
  await w.s1.settled();
  assert.ok(await until(() => w.reads() >= 3), "the reads did not all run");
  assert.equal(w.s1.status().fellBack, null, "THE one: the library fell back to the official API");
  assert.equal(w.s1.albums().length, LIBRARY.length + 1);
});

test("a heart made while a read runs is not judged by that read", async (t) => {
  const w = await rig(t, { slowRetainMs: 300 });
  w.s1.linkUp();                                            // a read that takes a while
  await new Promise((r) => { setTimeout(r, 50); });
  assert.equal((await w.marks.setAlbum("Blue", "Joni Mitchell", true)).ok, true);
  await w.s1.settled();
  assert.equal(w.marks.status().album.on, true, "THE one: a read begun before the heart turned album hearts off");
  assert.equal(w.marks.albumState("Blue", "Joni Mitchell").favorite, true);
});

test("an album nobody has hearted, its IsFavorite left out (a sparse struct), can be hearted; a track can be un-hearted", async (t) => {
  const w = await rig(t, { sparseFavorites: true });
  assert.deepEqual(w.marks.albumState("Blue", "Joni Mitchell"), { available: true, favorite: false, tracks: true, tracksWhy: null },
    "THE one for the review: an IsFavorite left out made the album unheartable");
  assert.equal((await w.marks.setTracks("Blue", "Joni Mitchell", BLUE, [2], true)).ok, true);
  const off = await w.marks.setTracks("Blue", "Joni Mitchell", BLUE, [2], false);
  assert.deepEqual(off, { ok: true, count: 1, favorite: false }, "a heart taken off, its IsFavorite now left out, was never believed");
  assert.equal(w.marks.status().track.on, true);
});

test("fallen back on one connection, hearts are tried again on the next", async (t) => {
  const w = await rig(t, { refuseHearts: true });
  assert.equal((await w.marks.setAlbum("Blue", "Joni Mitchell", true)).status, 409);
  assert.equal(w.marks.albumState("Blue", "Joni Mitchell").available, false);
  w.core.drop();
  assert.ok(await until(() => w.reads() === 2));
  assert.equal(w.marks.albumState("Blue", "Joni Mitchell").available, true, "the fallback outlived its connection");
});

test("native mode off: hearts set before are forgotten, not checked against what comes next", async (t) => {
  const w = await rig(t);
  await w.marks.setAlbum("Blue", "Joni Mitchell", true);
  assert.equal(w.marks.status().awaiting, 1);
  w.s1.turnOff();
  assert.equal(w.marks.status().awaiting, 0);
});

test("a connection with a call left unanswered: no heart is written on it", async () => {
  const { createMarks } = require("../../lib/roon-direct/marks");
  const sent = [];
  const s = { g: { uncertain: () => "a call went unanswered", call: async (...a) => { sent.push(a); return { success: true }; } }, graph: { ofType: () => [{ oid: 9n }] },
    root: { library: { oid: 3n }, profileId: Buffer.from("cafebabe", "hex") } };
  const m = createMarks({ link: { session: () => s }, albums: () => [{ oid: "1", title: "Blue", artist: "Joni", contentSource: 1, imageKey: null, albumId: "5", favorite: false }] });
  for (const r of [await m.setAlbum("Blue", "Joni", true), await m.setTracks("Blue", "Joni", ["a"], [0], true)]) {
    assert.deepEqual([r.status, /being checked/.test(r.error)], [503, true]);
  }
  assert.equal(sent.length, 0, "THE one for the review: a heart written on an uncertain connection");
});

// Hearts are always on with native mode since v1.9.63 (the owner, native-remote.md §13): no switch, and a "hearts: false"
// saved by an earlier version is not read. Reads still come before writes (roon-native.md §3): a heart waits for the read.
test("THE one for v1.9.63: hearts are on once the library is read, whatever an earlier version saved", async (t) => {
  const w = await rig(t, { saved: { hearts: false } });
  w.albums[1].favorite = true;                          // in the Core now; the next read will see it
  w.core.drop();
  assert.ok(await until(() => w.reads() === 2));
  assert.equal(w.marks.albumState("Blue", "Joni Mitchell").available, true, "a saved switch from before still turned hearts off");
  assert.equal((await w.marks.setAlbum("Blue", "Joni Mitchell", true)).ok, true);
  assert.equal(w.core.rec.hearts.length, 1, "the heart never reached the server");
  assert.equal(w.s1.status().hearts.favourites, 1, "the favourites the read found");
  assert.equal("enabled" in w.s1.status().hearts, false, "a switch's state is still reported");
  assert.equal("setHearts" in w.s1, false, "the switch is still there to turn hearts off");
});

test("THE one for the owner's §8.4: several profiles — hearts wait for one to be chosen, and are that profile's", async (t) => {
  const w = await rig(t, { twoProfiles: true });
  assert.deepEqual(w.s1.status().hearts.profiles, [{ id: "cafebabe", name: "Owner" }, { id: "deadbeef", name: "Guest" }]);
  assert.match(w.marks.albumState("Blue", "Joni Mitchell").why, /^Choose whose favourites/);
  assert.equal("error" in w.s1.setProfile("00ff00"), true, "a profile the server does not have");
  w.s1.setProfile("deadbeef");
  assert.ok(await until(() => w.reads() === 2), "the list was not read again for the profile");
  // The fake gives Guest the opposite of the owner's: Blue (not the owner's) is Guest's.
  assert.equal(w.marks.albumState("Blue", "Joni Mitchell").favorite, true, "the read still gave the first profile's hearts");
  assert.equal((await w.marks.setAlbum("Blue", "Joni Mitchell", false)).ok, true);
  assert.equal(w.core.rec.hearts.at(-1).profile, "deadbeef", "the heart went to the first profile, not the one chosen");
});

// v1.9.28: the server sends each track once a connection; a second heart on the
// same album finds its tracks named by rows only, and their album long let go.
test("THE one for v1.9.28: a second track heart on one album, on one connection", async (t) => {
  const w = await rig(t);
  assert.deepEqual(await w.marks.setTracks("Blue", "Joni Mitchell", BLUE, [0], true), { ok: true, count: 1, favorite: true });
  assert.deepEqual(await w.marks.setTracks("Blue", "Joni Mitchell", BLUE, [1], true), { ok: true, count: 1, favorite: true },
    "the second heart found no tracks: they were not sent again");
  w.s1.linkUp();                                            // and the library read again on the same connection
  await w.s1.settled();
  assert.ok(await until(() => w.reads() >= 2));
  assert.equal(w.s1.status().fellBack, null, "the second read on one connection came short");
});

// Reported by the owner (v1.9.27): a heart taken off in Roon's own app stayed in
// Rouen. The server pushes the album's changed IsFavorite to a client it believes
// holds it; Rouen takes it at once (v1.9.28), and counts them.
test("THE one for the owner's report: a heart taken off (or set) in the server's own app shows at once", async (t) => {
  const w = await rig(t);
  assert.equal((await w.marks.setAlbum("Blue", "Joni Mitchell", true)).ok, true);
  const rev = w.s1.factsRev();
  w.core.favoriteElsewhere(1, false);                        // taken off in Roon's app
  assert.ok(await until(() => w.marks.albumState("Blue", "Joni Mitchell").favorite === false),
    "the heart taken off elsewhere stayed");
  w.core.favoriteElsewhere(0, true);                         // Kind of Blue hearted in Roon's app
  assert.ok(await until(() => w.marks.albumState("Kind of Blue", "Miles Davis").favorite === true));
  assert.equal(w.s1.status().hearts.live, 2);
  assert.ok(w.s1.factsRev() >= rev + 2, "v1.9.70-t5: each counted, so the Shelf asks again (shelf-focus.md §2)");
  assert.equal(w.marks.status().album.on, true, "a change made elsewhere was taken as the server refusing a heart");
  assert.equal(w.marks.status().awaiting, 0);
});

// The review of v1.9.28: the second read on a connection was given the albums as Rouen held them,
// its own hearts included, so a heart the server never kept was "confirmed" by it.
test("THE one for the review of v1.9.28: a heart the server never kept is not confirmed by a read on the same connection", async (t) => {
  const w = await rig(t, { heartsIgnored: true });
  assert.equal((await w.marks.setAlbum("Blue", "Joni Mitchell", true)).ok, true);
  w.s1.linkUp();                                             // read again, on the same connection
  assert.ok(await until(() => w.reads() === 2));
  assert.equal(w.marks.status().albumConfirmed, 0, "THE one: Rouen's own heart confirmed itself");
  const st = w.marks.albumState("Blue", "Joni Mitchell");
  assert.equal(st.available, false);
  assert.match(st.why, /next read of the library didn't show it/);
});

for (const when of [true, "first"]) {
  test(`a heart the server pushes back as it keeps it (${when === "first" ? "before" : "after"} its answer) is confirmed then, and is not counted as changed elsewhere`, async (t) => {
    const w = await rig(t, { albumHeartPushed: when });
    assert.equal((await w.marks.setAlbum("Blue", "Joni Mitchell", true)).ok, true);
    assert.ok(await until(() => w.marks.status().albumConfirmed === 1), "the server's own update did not confirm it");
    assert.deepEqual([w.marks.status().awaiting, w.s1.status().hearts.live], [0, 0], "Rouen's own heart counted as changed elsewhere");
    assert.equal(w.marks.albumState("Blue", "Joni Mitchell").favorite, true);
  });
}

test("a favourite taken off elsewhere, the server sending the whole album again (IsFavorite left out): off, now and at the next read", async (t) => {
  const w = await rig(t, { wholeUpdates: true });
  w.core.favoriteElsewhere(1, true);
  assert.ok(await until(() => w.marks.albumState("Blue", "Joni Mitchell").favorite === true));
  w.core.favoriteElsewhere(1, false);                        // left out: no one's favourite
  assert.ok(await until(() => w.marks.albumState("Blue", "Joni Mitchell").favorite === false), "THE one: the heart taken off elsewhere stayed");
  w.s1.linkUp();                                             // and a read on the same connection agrees
  assert.ok(await until(() => w.reads() === 2));
  assert.equal(w.marks.albumState("Blue", "Joni Mitchell").favorite, false, "the graph kept the IsFavorite the whole album left out");
  assert.equal(w.s1.status().hearts.live, 2);
});

// v1.9.70-t7 (the review): an album sent again whole names its genres' list, which the server sent once on this
// connection and the read let go; the next read kept the genres it knew, rather than finding none.
test("an album sent again whole, naming its genres' list already read: its genres kept at the next read", async (t) => {
  const w = await rig(t, { wholeUpdates: true }, undefined, (albums) => { albums[1].genres = ["Folk", "Singer-Songwriter"]; });
  const genres = () => (w.s1.albums() || []).filter((a) => a.title === "Blue").map((a) => a.genres);
  assert.deepEqual(genres(), [["Folk", "Singer-Songwriter"]]);
  w.core.favoriteElsewhere(1, true);                         // the album sent again, whole
  assert.ok(await until(() => w.marks.albumState("Blue", "Joni Mitchell").favorite === true));
  w.s1.linkUp();                                             // read again, on the same connection
  assert.ok(await until(() => w.reads() === 2));
  assert.deepEqual(genres(), [["Folk", "Singer-Songwriter"]], "THE one: the list let go after the first read, the genres lost");
});

// The second review of v1.9.28: a push that came while a read on the same connection ran — after
// its album's page — was overwritten by that read's result, which was built from what was known before.
test("THE one for the second review: a favourite pushed while a read runs is not lost by that read", async (t) => {
  const w = await rig(t, {}, async (n, core, s1) => {
    if (n !== 2) return;
    const live = s1.status().hearts.live;
    core.favoriteElsewhere(1, true);                         // hearted in Roon's app, mid-read
    await until(() => s1.status().hearts.live > live);
  });
  w.s1.linkUp();
  assert.ok(await until(() => w.reads() === 2));
  await w.s1.settled();
  assert.equal(w.s1.status().hearts.live, 1);
  assert.equal(w.marks.albumState("Blue", "Joni Mitchell").favorite, true, "THE one: the read's result undid the push");
});

test("the second review: Rouen's heart, confirmed by a push during the next read, still shows", async (t) => {
  const w = await rig(t, { heartsIgnored: true }, async (n, core, s1) => {
    if (n !== 2) return;
    core.favoriteElsewhere(1, true);                         // the server's own update of the heart, mid-read
    await until(() => s1.marks.status().albumConfirmed === 1);
  });
  assert.equal((await w.marks.setAlbum("Blue", "Joni Mitchell", true)).ok, true);
  w.s1.linkUp();
  assert.ok(await until(() => w.reads() === 2));
  await w.s1.settled();
  assert.equal(w.marks.albumState("Blue", "Joni Mitchell").favorite, true, "a confirmed heart shows off");
  assert.equal(w.marks.status().album.on, true);
});

test("THE one for the second review: an album pushed unchanged while its heart is in flight does not drop that heart's check", async (t) => {
  const w = await rig(t, { heartsIgnored: true });
  const p = w.marks.setAlbum("Blue", "Joni Mitchell", true);
  w.core.favoriteElsewhere(1, false);                        // pushed, still not a favourite, as the heart is sent
  assert.equal((await p).ok, true);
  w.core.drop();
  assert.ok(await until(() => w.reads() === 2));
  await w.s1.settled();
  assert.equal(w.marks.status().album.on, false, "THE one: a heart the server never kept went unnoticed");
});

test("the second review: a heart whose call never comes back is not awaited, and no read holds it against the server", async () => {
  const pid = Buffer.from([1, 2, 3]);
  const s = {
    g: { uncertain: () => "", defineType: () => 1, call: async () => { throw new Error("connection closed: gone"); } },
    graph: { ofType: () => [{ oid: 5n }] },
    root: { library: { oid: 9n }, profiles: [], profileId: pid },
  };
  const albums = [{ oid: "100", title: "Blue", artist: "Joni", contentSource: 1, imageKey: null, albumId: "7", favorite: false }];
  const m = createMarks({ link: { session: () => s }, albums: () => albums });
  await assert.rejects(m.setAlbum("Blue", "Joni", true), /connection closed/);
  assert.equal(albums[0].favorite, false);
  assert.equal(m.status().awaiting, 0, "THE one: a heart that never reached the server is awaited");
  m.afterRead([Object.assign({}, albums[0], { favorite: false })]);
  assert.equal(m.status().album.on, true, "album hearts dropped for a heart that was never answered");
});

test("the second review: an album renamed in Roon (its Title sent alone) keeps its heart", async (t) => {
  const w = await rig(t, { wholeUpdates: true });
  w.core.favoriteElsewhere(1, true);
  assert.ok(await until(() => w.marks.albumState("Blue", "Joni Mitchell").favorite === true));
  w.core.renamed(1);                                         // a change sent as the field changed, AlbumId not with it
  w.s1.linkUp();
  assert.ok(await until(() => w.reads() === 2));
  assert.equal(w.marks.albumState("Blue", "Joni Mitchell").favorite, true, "a rename sent alone took the heart off");
});

test("the second review: favourites changed elsewhere are counted for this connection, as Settings says", async (t) => {
  const w = await rig(t);
  w.core.favoriteElsewhere(0, true);
  assert.ok(await until(() => w.s1.status().hearts.live === 1));
  w.core.drop();
  assert.ok(await until(() => w.reads() === 2));
  assert.equal(w.s1.status().hearts.live, 0, "a count from the last connection shown as this one's");
});

test("the second review: an update of fields alone (a rename) is laid over the album known, not read as the whole album", async (t) => {
  const w = await rig(t);                                    // updates carry the fields changed
  w.core.favoriteElsewhere(1, true);
  assert.ok(await until(() => w.marks.albumState("Blue", "Joni Mitchell").favorite === true));
  w.core.renamed(1);
  w.s1.linkUp();
  assert.ok(await until(() => w.reads() === 2));
  await w.s1.settled();
  const blue = w.s1.albums().find((a) => a.title === "Blue");
  assert.deepEqual([blue.artist, blue.albumId !== null, blue.contentSource !== null, blue.favorite], ["Joni Mitchell", true, true, true],
    "a Title sent alone lost the album's other fields");
});
