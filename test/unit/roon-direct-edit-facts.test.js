"use strict";
// ---------------------------------------------------------------------------
// t4 (lib/roon-direct/edit-facts.js, v1.9.67-t4, dev/design/catalogue.md §4):
// every library album's catalogue number, kinds and labels as Roon holds them,
// walked in batches over native mode's connection after a library read, and
// kept whole or not at all. End to end against the fake server
// (test/lib/fake-roon-edit-info.js), which reads each call strictly and
// answers by value as the owner's server did on the t3 probe.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createStage1 } = require("../../lib/roon-direct/stage1");
const { createLink } = require("../../lib/roon-direct/link");
const { readAlbumsOn } = require("../../lib/roon-direct/albums");
const { kindsFromRoon, createEditFacts } = require("../../lib/roon-direct/edit-facts");
const { ALLOWED, SIG } = require("../../lib/roon-direct/methods");
const { startFakeCore } = require("../lib/fake-roon-core");
const { dotnetGuidBytes } = require("../../lib/roon-direct/brokerid");
const { CORE_ID, LIBRARY } = require("../lib/roon-direct-fixtures");

const keyOf = (title, artist) => (title ? `${title.toLowerCase()}||${artist.toLowerCase()}` : null);
const until = async (fn) => { for (let i = 0; i < 400 && !fn(); i++) await new Promise((r) => { setTimeout(r, 20); }); return fn(); };
// The owner's server (the t3 run): a Main release with a number only in the file's tag; a Main + Live one; a Main +
// Compilation one with the service's label; an Unknown type; the rest nothing but a Title.
const EDIT = [
  { type: 0, labels: ["Columbia"], catno: "CK 64935", localCatno: "CS 8163" },
  { type: 0, live: true, labels: ["Reprise"], catno: "none" },
  { type: 0, compilation: true, labels: ["Virgin"] },
  { type: 5, labels: ["Warner Records"] },
];

async function rig(t, o = {}) {
  const albums = LIBRARY.map((a) => Object.assign({}, a));
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums, editInfo: EDIT, faults: Object.assign({ sentOnce: true }, o.faults) });
  let s1 = null;
  const reads = [], kept = [];
  const link = createLink({ core: () => ({ host: "127.0.0.1", coreId: CORE_ID }), port: core.port, timeoutMs: 1500,
    settleMs: 800, retryFirstMs: 100, onUp: () => s1.linkUp() });
  s1 = createStage1({
    settings: { load: () => null, save() {} }, cache: { read: () => null, write() {}, remove() {} },
    core: () => ({ host: "127.0.0.1", coreId: CORE_ID, coreVersion: "2.0" }), rouenVersion: "1.9.67-t4",
    records: () => [], keyOf, link, minGapMs: 0,
    roonRelease: (records, whole) => { kept.push({ records, whole }); return { kept: records.length }; },
    read: async (s, ro) => { const r = await readAlbumsOn(s, Object.assign({ timeoutMs: 1000 }, ro)); reads.push(r.ok); return r; },
  });
  t.after(async () => { s1.turnOff(); await core.close(); });
  s1.turnOn();
  assert.ok(await until(() => reads.length === 1 && s1.albums()), "the library was never read");
  return { core, s1, kept, link };
}

test("kindsFromRoon — a Type and flags read as several kinds; Unknown alone is nothing; a bootleg shows by its Type", () => {
  assert.deepEqual(kindsFromRoon(0, {}), ["album"]);
  assert.deepEqual(kindsFromRoon(0, { live: true }), ["album", "live"], "the owner's MTV Unplugged: Main + Live");
  assert.deepEqual(kindsFromRoon(0, { compilation: true, live: true }), ["album", "compilation", "live"]);
  assert.deepEqual(kindsFromRoon(5, {}), [], "Unknown: not guessed at");
  assert.deepEqual(kindsFromRoon(5, { live: true }), ["live"]);
  assert.deepEqual(kindsFromRoon(6, {}), ["ep"]);
  assert.deepEqual(kindsFromRoon(2, {}), ["live"]);
  assert.deepEqual(kindsFromRoon(null, { compilation: null }), []);
});

test("THE one for t4: after the library read, every album's edit info in batches, kept whole — numbers, kinds and labels as Roon shows them", async (t) => {
  const w = await rig(t);
  assert.ok(await until(() => w.kept.length === 1), "the walk never finished");
  const { records, whole } = w.kept[0];
  assert.equal(whole, true);
  assert.equal(records.length, 8, "every album the connection was sent");
  const by = Object.fromEntries(records.map((r) => [r.title, r]));
  assert.deepEqual(by["Kind of Blue"], { title: "Kind of Blue", artist: "Miles Davis", catno: "CK 64935", types: ["album"], labels: ["Columbia"] },
    "the value Roon shows (its metadata's number, not the file's: the owner's AlbumPreferLocalCatalogNumber is Roon's own business)");
  assert.deepEqual(by.Blue, { title: "Blue", artist: "Joni Mitchell", catno: null, types: ["album", "live"], labels: ["Reprise"] }, "Main + Live is album and live; a number of \"none\" is none");
  assert.deepEqual(by.Mezzanine.types, ["album", "compilation"]);
  assert.deepEqual([by.Dummy.types, by.Dummy.labels, by.Dummy.catno], [[], ["Warner Records"], null], "Unknown type: no kind, the label still");
  assert.deepEqual([by.Untrue.types, by.Untrue.labels, by.Untrue.catno], [[], [], null], "nothing but a Title: nothing kept, the album still counted as read");
  // Batches of 40 would be one call for eight albums; the default is what runs on the owner's server.
  assert.deepEqual(w.core.rec.editInfoAsks.map((a) => [a.albums.length, a.languages]), [[8, []]]);
  assert.equal(w.core.rec.signatures.filter((s) => s === SIG.albumEditInfo).length, 1);
  for (const sig of w.core.rec.signatures) assert.ok(ALLOWED.has(sig), "off the allowlist: " + sig);
  assert.deepEqual(w.core.rec.hearts, []);
  const st = w.s1.editFacts.status();
  assert.deepEqual([st.running, st.last.read, st.last.calls, st.last.whole, st.last.why], [false, 8, 1, true, null]);
  // Not walked again on the same connection: the next read on it starts nothing.
  assert.equal(w.s1.editFacts.start(w.link.session()), false);
});

test("a walk cut short keeps nothing and says why: refused thrice; native mode turned off between batches", async (t) => {
  const w = await rig(t, { faults: { refuseEditInfo: true } });
  assert.ok(await until(() => w.kept.length === 1));
  assert.deepEqual([w.kept[0].whole, w.kept[0].records.length], [false, 0]);
  assert.match(w.s1.editFacts.status().last.why, /refused 3 times/);
  assert.equal(w.core.rec.editInfoAsks.length, 3);
});

test("in batches, paused between them; stopped when native mode goes off, the connection's own work untouched", async (t) => {
  const kept = [];
  let on = true, session = { g: { uncertain: () => "", defineType: () => 9 }, root: { library: { oid: 7n } }, graph: {} };
  const calls = [];
  session.g.call = async (oid, sig, args) => { calls.push(args.length); if (calls.length === 2) on = false; return { success: true, payload: Buffer.from([0]) }; };
  const known = new Map([...Array(7).keys()].map((i) => [String(i), { oid: String(i), title: "T" + i, artist: "A" }]));
  const ef = createEditFacts({ link: { session: () => session }, inTurn: (fn) => fn(), on: () => on, known: () => known,
    keep: (records, whole) => { kept.push([records.length, whole]); }, batch: 3, pauseMs: 0, sleep: async () => {} });
  assert.equal(ef.start(session), true);
  assert.ok(await until(() => kept.length === 1));
  assert.equal(calls.length, 2, "the third batch never sent");
  assert.deepEqual(kept[0], [0, false], "an empty collection read as nothing; off before the end: not whole");
  assert.deepEqual(calls, [calls[0], calls[0]], "two batches of three sent");
  assert.match(ef.status().last.why, /turned off/);
});
