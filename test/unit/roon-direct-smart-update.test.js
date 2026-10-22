"use strict";
// ---------------------------------------------------------------------------
// N2e-3a (lib/roon-direct/smart-update.js, v1.9.55, native-remote.md §12.9):
// Roon's update tried once by hand — a smart playlist's order changed with
// Playlists::UpdatePlaylist, its genres carried over as its Focus holds them —
// end to end against the fake server (fake-roon-playlists.js), which reads the
// call strictly: the playlist by reference, then PlaylistParameters; a
// PlaylistId among them refused, as the owner's server refuses it (§12.13).
// Not evidence that the real server takes it: the owner's Roon showing the new
// order is.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createStage1 } = require("../../lib/roon-direct/stage1");
const { createLink } = require("../../lib/roon-direct/link");
const { readAlbumsOn } = require("../../lib/roon-direct/albums");
const { ALLOWED, SIG } = require("../../lib/roon-direct/methods");
const { mapFocus } = require("../../lib/roon-direct/focus-map");
const { createSmartUpdater, readFocus } = require("../../lib/roon-direct/smart-update");
const { startFakeCore } = require("../lib/fake-roon-core");
const { dotnetGuidBytes } = require("../../lib/roon-direct/brokerid");
const { CORE_ID, LIBRARY } = require("../lib/roon-direct-fixtures");

const keyOf = (title, artist) => (title ? `${title.toLowerCase()}||${artist.toLowerCase()}` : null);
const until = async (fn) => { for (let i = 0; i < 250 && !fn(); i++) await new Promise((r) => { setTimeout(r, 20); }); return fn(); };
const PLAYLISTS = [{ name: "Morning", tracks: 3, items: 3 }, { name: "r&b random", tracks: 30, items: 30, smart: true }];
const FOLK = { name: "Folk - My Dynamic Playlist", view: { sort: "album", dir: "asc", seed: 1, played: "any", genre: ["Folk", "!R&B"] }, limit: 400 };

async function rig(t, faults) {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY.map((a) => Object.assign({}, a)),
    playlists: PLAYLISTS.map((p) => Object.assign({}, p)), faults: Object.assign({ sentOnce: true }, faults) });
  let s1 = null;
  const reads = [];
  const link = createLink({ core: () => ({ host: "127.0.0.1", coreId: CORE_ID }), port: core.port, timeoutMs: 1500,
    settleMs: 800, retryFirstMs: 100, onUp: () => s1.linkUp() });
  s1 = createStage1({
    settings: { load: () => null, save() {} }, cache: { read: () => null, write() {}, remove() {} },
    core: () => ({ host: "127.0.0.1", coreId: CORE_ID, coreVersion: "2.0" }), rouenVersion: "1.9.55",
    records: () => [], keyOf, link, minGapMs: 0,
    read: async (s, ro) => { const r = await readAlbumsOn(s, Object.assign({ timeoutMs: 1000 }, ro)); reads.push(r.ok); return r; },
  });
  t.after(async () => { s1.turnOff(); await core.close(); });
  s1.turnOn();
  assert.ok(await until(() => reads.length >= 1 && s1.albums()), "the library was never read");
  // Folk made first, as the owner's was (§12.8).
  const made = await s1.smartMaker.make(FOLK.name, mapFocus(FOLK, 40, null).focus);
  assert.equal(made.made, true);
  return { core, s1, link };
}

test("THE one for N2e-3a: previewed, asking nothing; sent with the playlist, the new order and the genres it held; believed once it reads back so — Artist, the default the server leaves out (v1.9.58)", async (t) => {
  const w = await rig(t);
  const before = w.core.rec.playlistCalls.length;
  const seen = await w.s1.smartUpdater.preview(FOLK.name, "artist", "asc");
  assert.deepEqual([seen.wouldUpdate, seen.now.genres, seen.now.ordering, seen.sending.ordering], [true, { require: ["Folk"], exclude: ["R&B"] }, 4, 0]);
  assert.equal(w.core.rec.playlistCalls.length, before, "the preview asked something of the server");
  const out = await w.s1.smartUpdater.update(FOLK.name, "artist", "asc", { omit: ["playlistId"] });
  assert.deepEqual(out, { updated: true, name: FOLK.name, tried: { omit: ["playlistId"], carry: [] }, ordering: 0, direction: 1, genres: { require: ["Folk"], exclude: ["R&B"] }, albums: 2, tracks: 24,
    before: { albums: 2, tracks: 24 } });
  const call = w.core.rec.playlistCalls[w.core.rec.playlistCalls.length - 1];
  assert.deepEqual([call.kind, call.playlist, call.name, call.requireNames, call.excludeNames, call.ordering, call.genresMode],
    ["update", FOLK.name, FOLK.name, ["Folk"], ["R&B"], { Ordering: 0, Direction: 1 }, 1], "the genres' Or not carried over as made");
  for (const sig of w.core.rec.signatures) assert.ok(ALLOWED.has(sig), "off the allowlist: " + sig);
  assert.ok(w.core.rec.signatures.includes(SIG.updateSmartPlaylist));
});

test("not sent, and said: an order it has already, a Focus it can't carry over whole, a playlist that isn't smart or isn't there", async (t) => {
  const w = await rig(t);
  const before = w.core.rec.playlistCalls.length;
  assert.match((await w.s1.smartUpdater.update(FOLK.name, "album", "asc")).why[0], /in that order already/);
  const rnb = (await w.s1.smartUpdater.update("r&b random", "artist", "asc")).why;
  assert.ok(rnb.some((x) => /RequireIsFavorite/.test(x)) && rnb.some((x) => /RequireLabels/.test(x)), JSON.stringify(rnb));
  assert.match((await w.s1.smartUpdater.update("Morning", "artist", "asc")).why[0], /isn't a smart playlist/);
  assert.match((await w.s1.smartUpdater.update("Nope", "artist", "asc")).why[0], /no playlist named/);
  assert.match((await w.s1.smartUpdater.update(FOLK.name, "plays", "asc")).why[0], /isn.t an order this test sends/);
  assert.equal(w.core.rec.playlistCalls.length, before);
});

test("taken and not shown: \"unknown\", and not sent again until Rouen restarts", async (t) => {
  const w = await rig(t, { updateIgnored: true });
  const quick = createSmartUpdater({ link: w.link, inTurn: (fn) => fn(), on: () => true, profile: () => null, settleMs: 300 });
  const out = await quick.update(FOLK.name, "artist", "asc");
  assert.equal(out.updated, "unknown");
  const before = w.core.rec.playlistCalls.length;
  assert.match((await quick.update(FOLK.name, "artist", "asc")).why[0], /was sent and not shown/);
  assert.equal(w.core.rec.playlistCalls.length, before);
});

test("the review: a change of direction alone is believed only when it reads back so; \"constructor\" is no order", async (t) => {
  const w = await rig(t, { updateIgnored: true });
  const quick = createSmartUpdater({ link: w.link, inTurn: (fn) => fn(), on: () => true, profile: () => null, settleMs: 300 });
  // Folk is in Album name ascending: descending, ignored by the server, must not read back as made.
  assert.equal((await quick.update(FOLK.name, "album", "desc")).updated, "unknown");
  assert.match((await w.s1.smartUpdater.preview(FOLK.name, "constructor", "asc")).why[0], /isn't an order this test sends/);
});

test("the review: genres that must ALL match (GenresMode And) are sent so, never Or", async (t) => {
  const w = await rig(t);
  // A smart playlist made in Roon: Folk AND R&B, Album name ascending.
  w.core.rec.playlists.push({ n: 50, name: "Folk and R&B", smart: true, readOnly: true, tracks: 5, albums: 1,
    focus: { require: [28001n, 28000n], exclude: [] }, genresMode: 0, ordering: { Ordering: 4, Direction: 1 } });
  const quick = createSmartUpdater({ link: w.link, inTurn: (fn) => fn(), on: () => true, profile: () => null, settleMs: 300 });
  // Not yet sent to this connection: ask again once it has been (the fake pushes the list again on any change).
  await w.s1.smartMaker.make("Nudge", mapFocus({ name: "Nudge", view: { genre: ["Folk"] }, limit: 400 }, 40, null).focus);
  const out = await quick.update("Folk and R&B", "artist", "asc", { omit: ["playlistId"] });
  assert.equal(out.updated, true, JSON.stringify(out));
  const call = w.core.rec.playlistCalls[w.core.rec.playlistCalls.length - 1];
  assert.deepEqual([call.kind, call.genresMode, call.requireNames], ["update", 0, ["Folk", "R&B"]], "an And Focus sent as Or");
});

test("v1.9.56 (§12.10): refused with a member sent, the same update with it left out gets through; what was tried is said", async (t) => {
  const w = await rig(t);   // a PlaylistId refused, as the owner's server refuses it
  const refused = await w.s1.smartUpdater.update(FOLK.name, "artist", "asc");
  assert.deepEqual(refused, { updated: false, tried: { omit: [], carry: [] }, why: ["Your server refused it (\"InvalidArgument\")."] });
  const out = await w.s1.smartUpdater.update(FOLK.name, "artist", "asc", { omit: ["playlistId"] });
  assert.equal(out.updated, true, JSON.stringify(out));
  assert.deepEqual(out.tried, { omit: ["playlistId"], carry: [] });
  const call = w.core.rec.playlistCalls[w.core.rec.playlistCalls.length - 1];
  assert.deepEqual([call.playlistId, call.profile !== undefined, call.name], [undefined, true, FOLK.name], "left out more, or less, than asked");
});

test("v1.9.56: the profile left out; the description and folder carried over as the playlist holds them; anything else ignored", async (t) => {
  const w = await rig(t);
  assert.equal((await w.s1.smartUpdater.update(FOLK.name, "artist", "asc", { omit: ["playlistId", "profile", "name"], carry: ["description", "folder"] })).updated, true);
  const call = w.core.rec.playlistCalls[w.core.rec.playlistCalls.length - 1];
  assert.deepEqual([call.profile, call.name, call.description, call.folder], [undefined, FOLK.name, "", null], "the name left out, or the form not as asked");
});

test("the review: an update taken as a new playlist of the name is never believed from the new one; said, not sent again", async (t) => {
  const w = await rig(t, { updateWithoutIdMakesNew: true });
  const quick = createSmartUpdater({ link: w.link, inTurn: (fn) => fn(), on: () => true, profile: () => null, settleMs: 300 });
  const out = await quick.update(FOLK.name, "artist", "asc", { omit: ["playlistId"] });
  assert.equal(out.updated, "unknown", "believed from the copy it made");
  assert.match(out.why[0], /now lists 2 playlists named/);
});

test("v1.9.58: not answered — \"unknown\", said in the log as well as the answer, and not sent again", async (t) => {
  const w = await rig(t, { updateUnanswered: true });
  const logs = [];
  const quick = createSmartUpdater({ link: w.link, inTurn: (fn) => fn(), on: () => true, profile: () => null, settleMs: 300, log: (l) => logs.push(l) });
  const out = await quick.update(FOLK.name, "artist", "asc");
  assert.equal(out.updated, "unknown", JSON.stringify(out));
  assert.match(out.why[0], /didn't answer/);
  assert.ok(logs.some((l) => /the update of "Folk - My Dynamic Playlist" failed, with no answer read/.test(l)), JSON.stringify(logs));
  const before = w.core.rec.playlistCalls.length;
  assert.match((await quick.update(FOLK.name, "artist", "asc")).why[0], /was sent and not shown/);
  assert.equal(w.core.rec.playlistCalls.length, before);
});

test("v1.9.58 (§12.13): an order left out of an AlbumQueryOrdering is the default; one not decoded, or not sent, stays unknown", () => {
  const G = "Sooloos.Broker.Api.GenreLite";
  const genre = { oid: 7n, loaded: true, fields: { [`string ${G}::Name`]: "Folk" } };
  const graph = { get: (oid) => (oid === 7n ? genre : null), readValue: (r) => ({ $ref: r.long() }) };
  const AQC = "Sooloos.Broker.Api.AlbumQueryCriteria";
  const { BinaryWriter } = require("../../lib/roon-direct/wire");
  const folk = new BinaryWriter().flexInt(1).long(7n).toBuffer();
  const playlist = (ordering) => ({ fields: { [`${AQC} Sooloos.Broker.Api.Playlist::AlbumCriteria`]: Object.assign({ $type: AQC,
    [`System.Collections.Generic.IList<${G}> ${AQC}::RequireGenreObjects`]: folk }, ordering === undefined ? {} : { [`Sooloos.Broker.Api.AlbumQueryOrdering ${AQC}::Ordering`]: ordering }) } });
  const read = (ordering) => { const r = readFocus(graph, playlist(ordering)); assert.ok("focus" in r, JSON.stringify(r, (_k, x) => (typeof x === "bigint" ? String(x) : x))); return [r.focus.ordering, r.focus.direction]; };
  const DIR = "Sooloos.Broker.Api.OrderingDirection Sooloos.Broker.Api.AlbumQueryOrdering::Direction";
  assert.deepEqual(read({ $type: "Sooloos.Broker.Api.AlbumQueryOrdering", [DIR]: 1 }), [0, 1], "Folk by artist, as the owner's server sent it");
  assert.deepEqual(read({ $type: "Roon.Broker.Api.AlbumQueryOrdering" }), [0, 0]);
  assert.deepEqual(read({ $inline: 99 }), [null, null], "a type not known read as the defaults");
  assert.deepEqual(read({ $ref: 5n }), [null, null], "a reference read as the defaults");
  assert.deepEqual(read(undefined), [null, null], "an order not sent read as the defaults");
});
