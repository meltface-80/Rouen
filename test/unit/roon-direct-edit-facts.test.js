"use strict";
// ---------------------------------------------------------------------------
// t4 (lib/roon-direct/edit-facts.js, v1.9.67-t4, dev/design/catalogue.md §4):
// every library album's catalogue number, kinds and labels as Roon holds them,
// walked in batches over native mode's connection after a library read; since
// v1.9.68-t3 kept as it goes, and taken on where it stopped when cut short. End to end against the fake server
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

test("an item naming an album the batch never asked about is left, never paired by position (the review)", async (t) => {
  const w = await rig(t, { faults: { editInfoMisnamed: true } });
  assert.ok(await until(() => w.kept.length === 1));
  const { records, whole } = w.kept[0];
  assert.equal(whole, true);
  assert.equal(records.length, 7, "the misnamed one left out");
  assert.ok(!records.some((r) => r.title === "Kind of Blue"), "the first album's facts given to no one");
  assert.equal(w.s1.editFacts.status().last.unpaired, 1);
});

test("a walk refused thrice says why, has nothing to keep, and is armed to go on (v1.9.68-t3)", async (t) => {
  const w = await rig(t, { faults: { refuseEditInfo: true } });
  assert.ok(await until(() => w.s1.editFacts.status().last));
  assert.deepEqual(w.kept, [], "nothing read, nothing kept");
  assert.match(w.s1.editFacts.status().last.why, /refused 3 times/);
  assert.equal(w.core.rec.editInfoAsks.length, 3);
  assert.deepEqual(w.s1.editFacts.status().pass, { at: 0, albums: 8 }, "the pass waits to go on where it stopped");
});

// A scripted connection (v1.9.68-t3): each call answered or refused as the test says, each answer's items named by
// the albums asked (itemsOf: the real decoding is the fake server's tests' above).
function scripted(o = {}) {
  const kept = [], asked = [], timers = [], sleeps = [];
  let on = true, unsure = o.unsure || 0, n = 0;
  const session = { g: { uncertain: () => (unsure > 0 ? (unsure--, "being checked") : ""), defineType: () => 9,
    call: async () => { n++; if (o.refuse && o.refuse(n)) return { success: false, status: "Refused" }; if (o.offAt === n) on = false; return { success: true, payload: Buffer.alloc(0) }; } },
    root: { library: { oid: 7n } }, graph: {} };
  const known = new Map([...Array(o.albums || 7).keys()].map((i) => [String(i), { oid: String(i), title: "T" + i, artist: "A" }]));
  const ef = createEditFacts({ link: { session: () => session }, inTurn: (fn) => fn(), on: () => on, known: () => known,
    keep: (records, whole) => { kept.push([records.map((r) => r.title), whole]); return { kept: records.length }; },
    batch: 2, pauseMs: 0, retryMs: 600000, keepEvery: o.keepEvery || 2, waitMax: o.waitMax || 5, now: () => 0,
    sleep: async (ms) => { sleeps.push(ms); },
    timer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {},
    itemsOf: (g, payload, ids) => { asked.push([...ids]); return { items: [...ids].map((oid) => ({ oid, facts: { catno: null, types: ["album"], labels: [] } })), unpaired: 0 }; } });
  return { ef, session, kept, asked, timers, sleeps, off: () => { on = false; } };
}

test("THE one for t3: kept as it goes; cut short, it keeps what it read, and its own timer takes it on where it stopped to the whole pass", async () => {
  // seven albums, two a call: calls 1 and 2 answered, 3 to 5 refused (the walk cut short), then the rest
  const w = scripted({ refuse: (n) => n >= 3 && n <= 5 });
  assert.equal(w.ef.start(w.session), true);
  assert.ok(await until(() => !w.ef.status().running && w.ef.status().last));
  assert.deepEqual(w.kept, [[["T0", "T1", "T2", "T3"], false]], "the four read kept at once (every two calls), not lost to the cut");
  assert.match(w.ef.status().last.why, /refused 3 times/);
  assert.deepEqual(w.timers.map((x) => x.ms), [600000], "again on its own timer, not at the next library read");
  assert.deepEqual(w.ef.status().pass, { at: 4, albums: 7 });
  w.timers[0].fn();
  assert.ok(await until(() => !w.ef.status().running && w.ef.status().last.whole));
  assert.deepEqual(w.asked, [["0", "1"], ["2", "3"], ["4", "5"], ["6"]], "on from the fifth album, none asked twice");
  assert.deepEqual(w.kept.at(-1), [["T0", "T1", "T2", "T3", "T4", "T5", "T6"], true], "the whole pass, every album of it, replaces Roon's layer");
  assert.equal(w.ef.status().pass, null);
  assert.equal(w.ef.start(w.session), false, "not walked again within twelve hours");
});

test("while the connection is being checked the walk waits for it, the same batch next; too long a check ends it (v1.9.68-t3)", async () => {
  const w = scripted({ unsure: 3 });
  w.ef.start(w.session);
  assert.ok(await until(() => !w.ef.status().running && w.ef.status().last));
  assert.equal(w.ef.status().last.whole, true, "three checks waited out");
  assert.deepEqual(w.asked[0], ["0", "1"]);
  const long = scripted({ unsure: 99, waitMax: 4 });
  long.ef.start(long.session);
  assert.ok(await until(() => !long.ef.status().running && long.ef.status().last));
  assert.match(long.ef.status().last.why, /being checked/);
  assert.equal(long.timers.length, 1, "and is tried again later");
});

test("native mode turned off: the walk ends at its next call keeping what it read, and is not tried again", async () => {
  const w = scripted({ offAt: 2, keepEvery: 10 });
  w.ef.start(w.session);
  assert.ok(await until(() => !w.ef.status().running && w.ef.status().last));
  assert.deepEqual(w.asked, [["0", "1"], ["2", "3"]], "the third batch never sent");
  assert.deepEqual(w.kept, [[["T0", "T1", "T2", "T3"], false]]);
  assert.match(w.ef.status().last.why, /turned off/);
  assert.deepEqual(w.timers, [], "no retry: native mode is off");
});
