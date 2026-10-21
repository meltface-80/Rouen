"use strict";
// ---------------------------------------------------------------------------
// N2b-2 (lib/roon-direct/adder.js, v1.9.41, native-remote.md §9.2): a TIDAL or
// Qobuz album added to the library by the server itself — Roon's own search,
// then Library::AddToLibrary — end to end over the link against the fake
// server (test/lib/fake-roon-add.js), which reads the add strictly and never
// answers it. The fake is not evidence that the real server takes this form:
// the album showing in the owner's library is.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createStage1 } = require("../../lib/roon-direct/stage1");
const { createLink } = require("../../lib/roon-direct/link");
const { readAlbumsOn } = require("../../lib/roon-direct/albums");
const { startFakeCore } = require("../lib/fake-roon-core");
const { dotnetGuidBytes } = require("../../lib/roon-direct/brokerid");
const { CORE_ID, LIBRARY } = require("../lib/roon-direct-fixtures");
const { ALLOWED, SIG } = require("../../lib/roon-direct/methods");

const keyOf = (title, artist) => (title ? `${title.toLowerCase()}||${artist.toLowerCase()}` : null);
const until = async (fn) => { for (let i = 0; i < 250 && !fn(); i++) await new Promise((r) => { setTimeout(r, 20); }); return fn(); };
const CATALOG = [
  { title: "Selected Ambient Works 85-92", artist: "Aphex Twin", source: "tidal" },
  { title: "Homogenic", artist: "Björk", source: "qobuz" },
  { title: "Kid A", artist: "Radiohead", source: "tidal", noAlbumId: true },
  { title: "Selected Ambient Works 85-92", artist: "Aphex Twin", source: "qobuz" },   // on both services: the one asked for is added
];

async function rig(t, faults, o = {}) {
  const albums = LIBRARY.map((a) => Object.assign({}, a));
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums, catalog: CATALOG, faults: Object.assign({ sentOnce: true }, faults) });
  let s1 = null;
  const reads = [];
  let clock = 1000;
  const link = createLink({ core: () => ({ host: "127.0.0.1", coreId: CORE_ID }), port: core.port, timeoutMs: 1500,
    settleMs: 800, retryFirstMs: 100, onUp: () => s1.linkUp() });
  s1 = createStage1({
    settings: { load: () => null, save() {} }, cache: { read: () => null, write() {}, remove() {} },
    core: () => ({ host: "127.0.0.1", coreId: CORE_ID, coreVersion: "2.0" }), rouenVersion: "1.9.41",
    records: () => [], keyOf, link, minGapMs: 0, now: () => clock,
    // The library Rouen plays from, as the official API would come to list it: here, the fake's own.
    inLibrary: (title, artist) => { const i = albums.findIndex((a) => keyOf(a.title, a.artist) === keyOf(title, artist)); return i < 0 ? null : i; },
    read: async (s, ro) => { const r = await readAlbumsOn(s, Object.assign({ timeoutMs: 1000 }, ro)); reads.push(r.ok); return r; },
  });
  t.after(async () => { s1.turnOff(); await core.close(); });
  if (o.off) return { core, s1, albums };
  s1.turnOn();
  assert.ok(await until(() => reads.length === 1 && s1.albums()), "the library was never read");
  return { core, s1, albums, tick: (ms) => { clock += ms; } };
}

test("THE one for N2b-2: an album on TIDAL, not in the library, is searched for and added by its AlbumId — believed once it is in the library", async (t) => {
  const w = await rig(t);
  const added = await w.s1.adder.add({ title: "Selected Ambient Works 85-92", artist: "Aphex Twin", service: "tidal" });
  assert.deepEqual(added, { state: "waiting", via: "roon" });
  // Searched first, as the profile chosen; then the add, by the album's AlbumId, for the Profile object.
  assert.deepEqual(w.core.rec.searches.map((x) => x.terms), ["Selected Ambient Works 85-92 Aphex Twin"]);
  assert.ok(await until(() => w.core.rec.adds.length === 1), "the add never reached the server");
  assert.deepEqual(w.core.rec.adds, [{ profile: "2", albums: ["8000000000000"] }]);
  for (const sig of w.core.rec.signatures) assert.ok(ALLOWED.has(sig), "called off the allowlist: " + sig);
  assert.equal(w.core.rec.signatures.filter((s) => s === SIG.addToLibrary).length, 1, "added more than once");
  assert.deepEqual(w.core.rec.hearts, [], "a heart was written");
  // In the library now (the fake adds it): believed, and said where.
  assert.ok(await until(() => w.s1.adder.state("Selected Ambient Works 85-92", "Aphex Twin").state === "in-library"));
});

test("an album on both services: the copy on the service asked for is the one added", async (t) => {
  const w = await rig(t);
  assert.deepEqual(await w.s1.adder.add({ title: "Selected Ambient Works 85-92", artist: "Aphex Twin", service: "qobuz" }), { state: "waiting", via: "roon" });
  assert.ok(await until(() => w.core.rec.adds.length === 1));
  assert.deepEqual(w.core.rec.adds, [{ profile: "2", albums: ["8000000000003"] }], "the TIDAL copy added for a Qobuz page");
});

test("nothing is sent for an album already in the library, or one the search can't name on the service asked", async (t) => {
  const w = await rig(t);
  assert.deepEqual(await w.s1.adder.add({ title: "Mezzanine", artist: "Massive Attack", service: "tidal" }), { state: "in-library" });
  const qobuzOnly = await w.s1.adder.add({ title: "Homogenic", artist: "Björk", service: "tidal" });
  assert.match(qobuzOnly.notSent, /found this album, but not on TIDAL/);
  const noId = await w.s1.adder.add({ title: "Kid A", artist: "Radiohead", service: "tidal" });
  assert.match(noId.notSent, /without the id an add names it by/);
  const none = await w.s1.adder.add({ title: "Nothing Like It", artist: "Nobody", service: "qobuz" });
  assert.match(none.notSent, /didn't find this album on Qobuz/);
  await new Promise((r) => { setTimeout(r, 200); });
  assert.deepEqual(w.core.rec.adds, [], "something was added");
});

test("an add the server does not bear out is 'not taken' after three minutes, and can be sent again", async (t) => {
  const w = await rig(t, { addIgnored: true });
  // The adder's clock is the stage's, which the test moves.
  assert.deepEqual(await w.s1.adder.add({ title: "Selected Ambient Works 85-92", artist: "Aphex Twin", service: "tidal" }), { state: "waiting", via: "roon" });
  assert.ok(await until(() => w.core.rec.adds.length === 1));
  const st = w.s1.adder.state("Selected Ambient Works 85-92", "Aphex Twin");
  assert.equal(st.state, "waiting");
  w.tick(3 * 60 * 1000 - 1);
  assert.equal(w.s1.adder.state("Selected Ambient Works 85-92", "Aphex Twin").state, "waiting", "not taken before its three minutes");
  w.tick(2);
  assert.deepEqual(w.s1.adder.state("Selected Ambient Works 85-92", "Aphex Twin"), { state: "not-taken" });
  assert.deepEqual(await w.s1.adder.add({ title: "Selected Ambient Works 85-92", artist: "Aphex Twin", service: "tidal" }), { state: "waiting", via: "roon" });
  assert.ok(await until(() => w.core.rec.adds.length === 2), "a second add was not sent");
});

test("native mode off: nothing searched, nothing sent, and nothing to explain — today's way takes over", async (t) => {
  const w = await rig(t, {}, { off: true });
  const out = await w.s1.adder.add({ title: "Selected Ambient Works 85-92", artist: "Aphex Twin", service: "tidal" });
  assert.deepEqual(out, { off: true });
  assert.deepEqual(w.core.rec.searches, []);
  assert.deepEqual(w.core.rec.adds, []);
  assert.deepEqual(w.s1.adder.state("Selected Ambient Works 85-92", "Aphex Twin"), { state: "none" });
});

// ---- the review (v1.9.41): what can go wrong between the search and the add, against a stub session ----------
const { createAdder } = require("../../lib/roon-direct/adder");

function stubbed(o = {}) {
  const sent = [];
  const profile = (id, name) => ({ oid: id === "cafebabe" ? 2n : 12n, typeName: "Sooloos.Broker.Api.Profile",
    fields: { "System.Sooid Sooloos.Broker.Api.Profile::ProfileId": Buffer.from(id, "hex"), "string Sooloos.Broker.Api.Profile::Name": name } });
  const session = { g: { uncertain: () => "", defineType: () => 1, callNoReply: (oid, sig, args) => { sent.push(sig); return o.closed ? false : true; } },
    graph: { ofType: () => [{ oid: 9n }] },
    root: { library: { oid: 3n }, profileId: null, profiles: o.twoProfiles ? [profile("cafebabe", "Owner"), profile("deadbeef", "Guest")] : [profile("cafebabe", "Owner")] } };
  const hit = { title: "Syro", artist: "Aphex Twin", contentSource: 128, albumId: "8000000000009", inLibrary: false };
  const adder = createAdder({ link: { session: () => session }, inTurn: (fn) => fn(), on: () => true, keyOf, profile: () => o.chosen || null,
    inLibrary: () => null, now: () => 0,
    finder: { searchIn: async () => { if (o.unanswered) throw new Error("no answer in 15000 ms"); return { finding: { verdict: "found" }, hits: [hit] }; } } });
  return { adder, sent };
}
const SYRO = { title: "Syro", artist: "Aphex Twin", service: "tidal" };

test("the review: an add that never left Rouen, a search not answered, or a profile not chosen is not sent — each said, for today's way", async () => {
  const closed = stubbed({ closed: true });
  assert.match((await closed.adder.add(SYRO)).notSent, /closed before the add could be sent/);
  assert.deepEqual(closed.adder.state("Syro", "Aphex Twin"), { state: "none" }, "an add that never left counted as sent");
  const unanswered = stubbed({ unanswered: true });
  assert.match((await unanswered.adder.add(SYRO)).notSent, /search didn't answer: no answer in 15000 ms/);
  assert.deepEqual(unanswered.sent, []);
  const two = stubbed({ twoProfiles: true });
  assert.match((await two.adder.add(SYRO)).notSent, /Choose your profile/);
  assert.deepEqual(two.sent, [], "added for whichever profile came first");
  const chosen = stubbed({ twoProfiles: true, chosen: "deadbeef" });
  assert.deepEqual(await chosen.adder.add(SYRO), { state: "waiting", via: "roon" });
  assert.deepEqual(chosen.sent, [SIG.addToLibrary]);
  // Made another way since (a service favourite): its old add no longer followed.
  chosen.adder.forget("Syro", "Aphex Twin");
  assert.deepEqual(chosen.adder.state("Syro", "Aphex Twin"), { state: "none" });
});
