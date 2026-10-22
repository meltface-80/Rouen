"use strict";
// ---------------------------------------------------------------------------
// N2e-2b (lib/roon-direct/smart-make.js, v1.9.53, native-remote.md §12.7): the
// one test — a Dynamic Playlist made by hand as a Roon smart playlist with
// Playlists::CreatePlaylistFromParameters, end to end against the fake server
// (fake-roon-playlists.js), which reads the PlaylistParameters strictly: the
// profile, the name, the Focus's order and genres, each genre a GenreLite it
// sent, its lists declared LengthPrefixed as the owner's server declares them.
// Not evidence that the real server takes it: the owner's Roon showing it is.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createStage1 } = require("../../lib/roon-direct/stage1");
const { createLink } = require("../../lib/roon-direct/link");
const { readAlbumsOn } = require("../../lib/roon-direct/albums");
const { ALLOWED, SIG } = require("../../lib/roon-direct/methods");
const { mapFocus } = require("../../lib/roon-direct/focus-map");
const { createSmartMaker } = require("../../lib/roon-direct/smart-make");
const { startFakeCore } = require("../lib/fake-roon-core");
const { dotnetGuidBytes } = require("../../lib/roon-direct/brokerid");
const { CORE_ID, LIBRARY } = require("../lib/roon-direct-fixtures");

const keyOf = (title, artist) => (title ? `${title.toLowerCase()}||${artist.toLowerCase()}` : null);
const until = async (fn) => { for (let i = 0; i < 250 && !fn(); i++) await new Promise((r) => { setTimeout(r, 20); }); return fn(); };
const PLAYLISTS = [{ name: "Morning", tracks: 3, items: 3 }, { name: "r&b random", tracks: 30, items: 30, smart: true }];
// The owner's test (§12.6), as Rouen keeps a Dynamic Playlist.
const FOLK = { name: "Folk - My Dynamic Playlist", view: { sort: "random", dir: "asc", seed: 42, played: "any", genre: ["Folk", "!R&B"] }, limit: 100, mode: "tracks", order: "random" };

async function rig(t, faults) {
  const albums = LIBRARY.map((a) => Object.assign({}, a));
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums, playlists: PLAYLISTS.map((p) => Object.assign({}, p)),
    faults: Object.assign({ sentOnce: true }, faults) });
  let s1 = null;
  const reads = [];
  const link = createLink({ core: () => ({ host: "127.0.0.1", coreId: CORE_ID }), port: core.port, timeoutMs: 1500,
    settleMs: 800, retryFirstMs: 100, onUp: () => s1.linkUp() });
  s1 = createStage1({
    settings: { load: () => null, save() {} }, cache: { read: () => null, write() {}, remove() {} },
    core: () => ({ host: "127.0.0.1", coreId: CORE_ID, coreVersion: "2.0" }), rouenVersion: "1.9.53",
    records: () => [], keyOf, link, minGapMs: 0,
    read: async (s, ro) => { const r = await readAlbumsOn(s, Object.assign({ timeoutMs: 1000 }, ro)); reads.push(r.ok); return r; },
  });
  t.after(async () => { s1.turnOff(); await core.close(); });
  s1.turnOn();
  assert.ok(await until(() => reads.length >= 1 && s1.albums()), "the library was never read");
  return { core, s1, link };
}
const focusOf = (sp, matched = 40) => /** @type {any} */ (mapFocus(sp, matched, null)).focus;

test("THE one for N2e-2b: previewed, asking nothing; made with the profile, the name, the order and each genre by its GenreLite; believed once it lists as smart with them", async (t) => {
  const w = await rig(t);
  const focus = focusOf(FOLK);
  const seen = await w.s1.smartMaker.preview(FOLK.name, focus);
  assert.deepEqual([seen.made, seen.wouldMake, seen.why], [false, true, []]);
  assert.deepEqual(seen.genresSent, { count: 2, first: ["Folk", "R&B"] });
  assert.deepEqual(w.core.rec.playlistCalls, [], "the preview asked something of the server");
  const made = await w.s1.smartMaker.make(FOLK.name, focus);
  assert.deepEqual(made, { made: true, name: FOLK.name, genres: { require: ["Folk"], exclude: ["R&B"] }, albums: 2, tracks: 24 });
  assert.equal(w.core.rec.playlistCalls.length, 1);
  const call = w.core.rec.playlistCalls[0];
  assert.deepEqual([call.kind, call.name, call.uiLanguage, call.genresMode, call.requireNames, call.excludeNames],
    ["smart", FOLK.name, "en", 1, ["Folk"], ["R&B"]]);
  assert.deepEqual(call.ordering, { Ordering: 7, Direction: 1, RandomSeed: 42 });
  for (const sig of w.core.rec.signatures) assert.ok(ALLOWED.has(sig), "off the allowlist: " + sig);
  assert.ok(w.core.rec.signatures.includes(SIG.createSmartPlaylist));
});

test("not made, and said: a genre the server never sent, a name Roon already has; a second make of the same is refused by its name", async (t) => {
  const w = await rig(t);
  const jazz = Object.assign({}, FOLK, { name: "Jazz", view: Object.assign({}, FOLK.view, { genre: ["Jazz"] }) });
  assert.deepEqual((await w.s1.smartMaker.make(jazz.name, focusOf(jazz))).why, ["Your server hasn't sent Rouen the genre \"Jazz\"."]);
  const taken = Object.assign({}, FOLK, { name: "Morning" });
  assert.deepEqual((await w.s1.smartMaker.make(taken.name, focusOf(taken))).why, ["Your server already has a playlist named \"Morning\"."]);
  assert.deepEqual(w.core.rec.playlistCalls, []);
  assert.equal((await w.s1.smartMaker.make(FOLK.name, focusOf(FOLK))).made, true);
  assert.match((await w.s1.smartMaker.make(FOLK.name, focusOf(FOLK))).why[0], /already has a playlist named/);
  assert.equal(w.core.rec.playlistCalls.length, 1);
});

test("refused: said as the server said it; taken and not shown: made \"unknown\", look in Roon", async (t) => {
  const refused = await rig(t, { refusePlaylists: true });
  assert.deepEqual(await refused.s1.smartMaker.make(FOLK.name, focusOf(FOLK)), { made: false, why: ["Your server refused it (\"Refused\")."] });
  const ignored = await rig(t, { smartIgnored: true });
  // On the same connection, with a short wait (the build's is 15 s).
  const quick = createSmartMaker({ link: ignored.link, inTurn: (fn) => fn(), on: () => true, profile: () => null, settleMs: 300 });
  const out = await quick.make(FOLK.name, focusOf(FOLK));
  assert.equal(out.made, "unknown");
  assert.match(out.why[0], /didn't show a smart playlist of that name/);
  // The review: nothing is sent again for that name until Rouen restarts (§12.7.2: look in Roon first).
  const again = await quick.make(FOLK.name, focusOf(FOLK));
  assert.match(again.why[0], /was sent and not shown/);
  assert.equal(ignored.core.rec.playlistCalls.length, 1);
});

test("the review: listed as smart but its genres read back otherwise — not believed, said, and not sent again", async (t) => {
  const w = await rig(t, { smartNoGenres: true });
  const quick = createSmartMaker({ link: w.link, inTurn: (fn) => fn(), on: () => true, profile: () => null, settleMs: 300 });
  const out = await quick.make(FOLK.name, focusOf(FOLK));
  assert.equal(out.made, "unknown");
  assert.match(out.why[0], /its genres read back as \{"require":\[\],"exclude":\[\]\}/);
});

// The owner's "1970" (§12.15): Decade 1970, 25 of 382 albums — and every other filter Roon can hold, at once.
const SEVENTIES = { name: "1970", view: { sort: "added", dir: "desc", seed: 1, played: "6", genre: ["Folk"], decade: ["1970"],
  source: ["local"], format: ["FLAC", "!MPEG"], rate: ["96000", "!44100"], bits: ["24"], label: ["Stax", "!Motown"], added: ["365"] }, limit: 25 };

test("v1.9.60 (§12.15): the owner's 1970 with every filter Roon can hold — made, each member sent as the server declares it, believed once all read back", async (t) => {
  const w = await rig(t);
  const mapped = mapFocus(SEVENTIES, 382, null);
  assert.deepEqual(mapped.notes, ["Roon's smart playlists have no album limit: Roon holds all 382 albums it matches, not 25."]);
  const made = await w.s1.smartMaker.make(SEVENTIES.name, /** @type {any} */ (mapped).focus);
  assert.equal(made.made, true, JSON.stringify(made));
  const call = w.core.rec.playlistCalls[w.core.rec.playlistCalls.length - 1];
  assert.deepEqual(call.ordering, { Ordering: 1, Direction: 2 }, "Recently added, newest first");
  assert.deepEqual(call.extra, {
    RequireFileFormats: [1], ExcludeFileFormats: [15, 12, 17, 4], RequireSampleRates: [96000], ExcludeSampleRates: [44100],
    RequireBitsPerSample: [24], LabelsMode: 1, RequireLabels: ["Stax"], ExcludeLabels: ["Motown"], ExcludePlayedInLastNDays: 180,
    RequireImportedInLastNDays: 365, MinDate: 129105920, MaxDate: 129698847 });
});

test("v1.9.60 (§12.15): a member the server didn't keep — not believed, said which, and not sent again", async (t) => {
  const w = await rig(t, { smartDrops: "MinDate" });
  const quick = createSmartMaker({ link: w.link, inTurn: (fn) => fn(), on: () => true, profile: () => null, settleMs: 400 });
  const out = await quick.make(SEVENTIES.name, focusOf(SEVENTIES, 382));
  assert.equal(out.made, "unknown", JSON.stringify(out));
  assert.match(out.why[0], /made a smart playlist "1970", but it has one end of a date range\. Look in Roon\./);
  const before = w.core.rec.playlistCalls.length;
  assert.match((await quick.make(SEVENTIES.name, focusOf(SEVENTIES, 382))).why[0], /was sent and not shown/);
  assert.equal(w.core.rec.playlistCalls.length, before);
});

test("v1.9.60: labels kept, but not as any-of — not believed, said", async (t) => {
  const w = await rig(t, { smartDrops: "LabelsMode" });
  const quick = createSmartMaker({ link: w.link, inTurn: (fn) => fn(), on: () => true, profile: () => null, settleMs: 400 });
  const out = await quick.make(SEVENTIES.name, focusOf(SEVENTIES, 382));
  assert.match(out.why[0], /but its labels \(not any-of\) read back otherwise than sent\. Look in Roon\./, JSON.stringify(out));
});
