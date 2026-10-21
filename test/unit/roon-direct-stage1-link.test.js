"use strict";
// ---------------------------------------------------------------------------
// Stage 1 on the native remote's one connection (stage1.js with link.js,
// dev/design/native-remote.md §4, v1.9.21): the switch starts and stops the
// connection, each session it opens is read at once, nothing is read while
// there is none — and, end to end against the fake Core (not evidence of a
// real one), the Core's album list arrives over it and again after a drop.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createStage1 } = require("../../lib/roon-direct/stage1");
const { createLink } = require("../../lib/roon-direct/link");
const { readAlbumsOn } = require("../../lib/roon-direct/albums");
const { startFakeCore } = require("../lib/fake-roon-core");
const { dotnetGuidBytes } = require("../../lib/roon-direct/brokerid");
const { CORE_ID, LIBRARY } = require("../lib/roon-direct-fixtures");

const keyOf = (title, artist) => (title ? `${title.toLowerCase()}||${artist.toLowerCase()}` : null);
const OK = { ok: true, albums: [{ oid: "7", title: "Blue", artist: "Joni", contentSource: 1, imageKey: null }], count: 1, pages: 1, ms: 5 };

function fakeLink() {
  const l = { calls: [], s: null };
  l.link = {
    start: () => l.calls.push("start"), stop: () => { l.calls.push("stop"); l.s = null; },
    refresh: () => l.calls.push("refresh"), cycle: (why) => { l.calls.push("cycle: " + why); l.s = null; },
    session: () => l.s, status: () => ({ up: !!l.s }),
  };
  return l;
}

function rig(o = {}) {
  const w = { saved: o.saved, reads: [], l: fakeLink(), changes: 0, result: OK,
    core: { host: "10.0.0.2", coreId: "core-1", coreVersion: "2.0" } };
  w.s = createStage1({
    settings: { load: () => w.saved, save: (v) => { w.saved = JSON.parse(JSON.stringify(v)); } },
    cache: { read: () => null, write() {}, remove() { w.removed = (w.removed || 0) + 1; } },
    core: () => w.core, rouenVersion: "1.9.21", onChange: () => { w.changes++; },
    records: () => [], keyOf, link: w.l.link, view: () => ({ paired: 1, unpaired: 0 }),
    read: async (session) => { w.reads.push(session); return typeof w.result === "function" ? w.result(session) : w.result; },
    chosen: o.chosen,
  });
  return w;
}

test("the switch starts and stops the connection; on at start-up, it is started", async () => {
  const w = rig();
  assert.deepEqual(w.l.calls, [], "off: nothing of it runs");
  w.s.turnOn();
  assert.equal(w.l.calls[0], "start");
  w.s.turnOff();
  assert.equal(w.l.calls.at(-1), "stop");
  const again = rig({ saved: { on: true, rouenVersion: "1.9.21", coreVersion: "2.0", coreId: "core-1" } });
  assert.deepEqual(again.l.calls, ["start"]);
});

test("no session yet: nothing is read until one opens, then it is read on it", async () => {
  const w = rig();
  w.s.turnOn();
  await w.s.settled();
  assert.deepEqual(w.reads, [], "THE one: read with no connection to read on");
  assert.ok(w.l.calls.includes("refresh"));
  w.l.s = { gen: 1 };
  w.s.linkUp();
  await w.s.settled();
  assert.deepEqual(w.reads, [{ gen: 1 }]);
  assert.deepEqual(w.s.albums(), OK.albums);
  const st = w.s.status();
  assert.deepEqual([st.link, st.library], [{ up: true }, { paired: 1, unpaired: 0 }]);
});

test("every new session is read afresh, whatever the gap", async () => {
  const w = rig();
  w.l.s = { gen: 1 };
  w.s.turnOn();
  await w.s.settled();
  w.l.s = { gen: 2 };
  w.s.linkUp();
  await w.s.settled();
  assert.deepEqual(w.reads.map((s) => s.gen), [1, 2]);
});

// The review's cases (v1.9.21).
test("a new session's read that finds the same list tells the screens nothing", async () => {
  const w = rig();
  w.l.s = { gen: 1 };
  w.s.turnOn();
  await w.s.settled();
  assert.equal(w.changes, 1);
  w.l.s = { gen: 2 };
  w.s.linkUp();
  await w.s.settled();
  assert.equal(w.reads.length, 2);
  assert.equal(w.changes, 1, "THE one: every nightly reconnect republished an unchanged library to every screen");
  w.result = Object.assign({}, OK, { albums: [Object.assign({}, OK.albums[0], { contentSource: 256 })] });
  w.l.s = { gen: 3 };
  w.s.linkUp();
  await w.s.settled();
  assert.equal(w.changes, 2, "a changed list was not published");
});

test("another Core paired (or an update): the check is read on a fresh connection, not the old one", async () => {
  const w = rig();
  w.l.s = { gen: 1 };
  w.s.turnOn();
  await w.s.settled();
  w.core = { host: "10.0.0.9", coreId: "core-2", coreVersion: "2.0" };
  w.s.paired();
  assert.ok(w.l.calls.some((c) => /^cycle: .*different server/.test(c)), "THE one: the old Core's connection was kept for the new Core's check");
  await w.s.settled();
  assert.equal(w.reads.length, 1, "the check read the old Core's connection");
  w.l.s = { gen: 2 };
  w.s.linkUp();
  await w.s.settled();
  assert.deepEqual(w.reads.at(-1), { gen: 2 });
  assert.equal(w.saved.coreId, "core-2");
});

test("a check after an update that cannot even connect has failed: off, saying why", async () => {
  const w = rig({ saved: { on: true, rouenVersion: "1.9.20", coreVersion: "2.0", coreId: "core-1" } });
  w.s.paired();
  w.s.linkDown("the Roon Core is restarting", true);
  assert.equal(w.s.status().on, true, "a planned close is no failure");
  w.s.linkDown("connect ECONNREFUSED 10.0.0.2:9332", false);
  const st = w.s.status();
  assert.equal(st.on, false, "THE one: 'Checking after an update…' for ever");
  assert.match(st.offReason, /^Rouen updated from 1\.9\.20 to 1\.9\.21, and the check that followed failed: connect ECONNREFUSED/);
  const fine = rig();
  fine.l.s = { gen: 1 };
  fine.s.turnOn();
  await fine.s.settled();
  fine.s.linkDown("the connection closed", false);
  assert.equal(fine.s.status().on, true, "a drop with no check pending turns nothing off");
});

test("a read cut short by a planned reconnect is no failure: no fallback, the next session reads", async () => {
  const w = rig();
  w.l.s = { gen: 1 };
  w.s.turnOn();
  await w.s.settled();
  let release;
  w.result = () => new Promise((r) => { release = r; });
  w.s.linkUp();
  w.l.s = { gen: 2 };                      // the nightly reconnect, under the read
  release({ ok: false, why: "the connection closed", ms: 1, lifetime: null });
  await w.s.settled();
  assert.equal(w.s.status().fellBack, null, "THE one: every screen flipped to the official list for a planned reconnect");
  assert.deepEqual(w.s.albums(), OK.albums);
});

test("end to end: the Core's list over the one connection, and again after it drops", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY });
  /** @type {any} */
  let s1 = null;
  const changes = [];
  const reads = [];
  const link = createLink({ core: () => ({ host: "127.0.0.1", coreId: CORE_ID }), port: core.port, timeoutMs: 1500,
    settleMs: 800, retryFirstMs: 100, onUp: () => s1.linkUp() });
  s1 = createStage1({
    settings: { load: () => null, save() {} }, cache: { read: () => null, write() {}, remove() {} },
    core: () => ({ host: "127.0.0.1", coreId: CORE_ID, coreVersion: "2.0" }), rouenVersion: "1.9.21",
    records: () => [], keyOf, link, minGapMs: 0, onChange: () => changes.push(s1.albums() ? s1.albums().length : 0),
    read: async (s) => { const r = await readAlbumsOn(s, {}); reads.push(s.gen + ":" + r.ok); return r; },
  });
  t.after(async () => { s1.turnOff(); await core.close(); });
  s1.turnOn();
  const until = async (fn) => { for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => { setTimeout(r, 20); }); return fn(); };
  assert.ok(await until(() => changes.length === 1), "no read arrived over the connection");
  assert.equal(s1.albums().length, LIBRARY.length);
  assert.equal(s1.sourceOf("mezzanine||massive attack"), "tidal");
  core.drop();
  assert.ok(await until(() => reads.length === 2), "THE one: dropped, and the new session never read");
  assert.deepEqual(reads, ["1:true", "2:true"]);
  assert.equal(changes.length, 1, "the same list, read again, is nothing new for the screens");
  assert.equal(core.rec.connections, 2);
  assert.equal(s1.status().link.reconnects, 1);
});

// v1.9.28, reported from the owner's server: "The album list came short: 0 of 12968
// albums arrived with their details" at the second read on one connection. The
// server sends an album's details once a connection (the v1.9.17 probe saw pages
// come "as rows alone"), and the first read let them go — so the second read,
// which kept connections alive since v1.9.24 made possible, had nothing to read.
test("THE one for v1.9.28: a second read on the same connection, the server sending no album twice", async (t) => {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY, faults: { sentOnce: true } });
  let s1 = null;
  const reads = [];
  const link = createLink({ core: () => ({ host: "127.0.0.1", coreId: CORE_ID }), port: core.port, timeoutMs: 1500,
    settleMs: 800, retryFirstMs: 100, onUp: () => s1.linkUp() });
  s1 = createStage1({
    settings: { load: () => null, save() {} }, cache: { read: () => null, write() {}, remove() {} },
    core: () => ({ host: "127.0.0.1", coreId: CORE_ID, coreVersion: "2.0" }), rouenVersion: "1.9.28",
    records: () => [], keyOf, link, minGapMs: 0,
    read: async (s, o) => { const r = await readAlbumsOn(s, Object.assign({ timeoutMs: 1000 }, o)); reads.push(s.gen + ":" + r.ok + (r.ok ? "" : " " + r.why)); return r; },
  });
  t.after(async () => { s1.turnOff(); await core.close(); });
  s1.turnOn();
  const until = async (fn) => { for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => { setTimeout(r, 20); }); return fn(); };
  assert.ok(await until(() => reads.length === 1), "no first read");
  s1.linkUp();                                         // read again, on the same connection
  assert.ok(await until(() => reads.length === 2), "no second read");
  assert.deepEqual(reads, ["1:true", "1:true"], "THE one: the second read on one connection came short");
  assert.equal(s1.status().fellBack, null);
  assert.equal(s1.albums().length, LIBRARY.length);
  assert.equal(s1.albums().find((a) => a.title === "Blue").artist, "Joni Mitchell", "an album's details lost at the second read");
});

test("v1.9.28: hearts on, the read failed — the status says hearts wait for a read, not nothing", async () => {
  const w = rig();
  w.s.turnOn();
  w.s.setHearts(true);
  w.result = { ok: false, why: "The album list came short: 0 of 8 albums arrived with their details.", ms: 5, lifetime: null };
  w.l.s = { gen: 1 };
  w.s.linkUp();
  await w.s.settled();
  assert.match(w.s.status().hearts.off, /^Hearts wait for a read of your server's library to succeed/);
});

/** Stage 1 on the link, against the fake Core sending each album once a connection; its reads, as "session:ok why". */
async function sentOnceRig(t, faults) {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY, faults });
  let s1 = null;
  const reads = [];
  const link = createLink({ core: () => ({ host: "127.0.0.1", coreId: CORE_ID }), port: core.port, timeoutMs: 1500,
    settleMs: 800, retryFirstMs: 100, onUp: () => s1.linkUp() });
  s1 = createStage1({
    settings: { load: () => null, save() {} }, cache: { read: () => null, write() {}, remove() {} },
    core: () => ({ host: "127.0.0.1", coreId: CORE_ID, coreVersion: "2.0" }), rouenVersion: "1.9.28",
    records: () => [], keyOf, link, minGapMs: 0,
    read: async (s, o) => { const r = await readAlbumsOn(s, Object.assign({ timeoutMs: 1000 }, o)); reads.push(s.gen + ":" + r.ok + (r.ok ? "" : " " + r.why)); return r; },
  });
  t.after(async () => { s1.turnOff(); await core.close(); });
  const until = async (fn) => { for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => { setTimeout(r, 20); }); return fn(); };
  return { s1, reads, until };
}

// The review of v1.9.28: a read that failed let go of what it was sent, and the fallback forgot the
// last whole read's albums — every later read on the connection then came short, until the nightly reconnect.
test("THE one for the review of v1.9.28: a read that fails on a connection does not stop the next on it", async (t) => {
  const faults = { sentOnce: true, extraRow: true };         // the library changed while it was read
  const w = await sentOnceRig(t, faults);
  w.s1.turnOn();
  assert.ok(await w.until(() => w.reads.length === 1), "no first read");
  faults.extraRow = false;
  w.s1.linkUp();
  assert.ok(await w.until(() => w.reads.length === 2), "no second read");
  faults.extraRow = true;
  w.s1.linkUp();
  assert.ok(await w.until(() => w.reads.length === 3), "no third read");
  faults.extraRow = false;
  w.s1.linkUp();
  assert.ok(await w.until(() => w.reads.length === 4), "no fourth read");
  const mismatch = "1:false The album list did not match its count: 9 albums for 8.";
  assert.deepEqual(w.reads, [mismatch, "1:true", mismatch, "1:true"], "THE one: a read after a failed one came short");
  assert.equal(w.s1.status().fellBack, null);
  assert.equal(w.s1.albums().find((a) => a.title === "Blue").artist, "Joni Mitchell");
});

test("the review of v1.9.28: native mode turned on while on reads again, on the same connection, whole", async (t) => {
  const w = await sentOnceRig(t, { sentOnce: true });
  w.s1.turnOn();
  assert.ok(await w.until(() => w.reads.length === 1), "no first read");
  w.s1.turnOn();
  assert.ok(await w.until(() => w.reads.length === 2), "no second read");
  assert.deepEqual(w.reads, ["1:true", "1:true"], "THE one: on again, the read came short");
  assert.equal(w.s1.status().fellBack, null);
});

// v1.9.32 (dev/design/login.md §5): native mode chosen, or not, once per install.
test("THE one for the choice: native mode not chosen — off at every start, and it can't be turned on", async () => {
  const w = rig({ chosen: () => false, saved: { on: true, rouenVersion: "1.9.21", coreVersion: "2.0", coreId: "core-1", hearts: true } });
  assert.ok(!w.l.calls.includes("start"), "native mode not chosen still started its connection");
  assert.equal(w.saved.on, false, "native mode not chosen stayed on");
  const r = w.s.turnOn();
  assert.match(r.error, /wasn't chosen/);
  assert.ok(!w.l.calls.includes("start"));
  assert.equal(w.s.status().offered, false);
  assert.equal(rig({ chosen: () => true }).s.status().offered, true);
  assert.equal(rig().s.status().offered, true, "an install before the choice has native mode offered");
});

test("native mode chosen: on now when paired; not paired yet, on at the first pairing, read without an after-update check", async () => {
  const paired = rig({ chosen: () => true });
  paired.s.optIn();
  assert.equal(paired.saved.on, true);
  assert.equal(paired.l.calls[0], "start");
  const w = rig({ chosen: () => true });
  const core = w.core;
  w.core = null;                       // not paired yet
  w.s.optIn();
  assert.equal(w.saved.on, true, "chosen before pairing, native mode stayed off");
  assert.equal(w.l.calls[0], "start", "its connection does not wait for pairing to start");
  w.core = core;                       // and now Rouen pairs
  w.s.paired();
  assert.equal(w.s.status().checking, null, "the first pairing taken as a server update");
});

test("the review: not chosen at start is switched off as its switch would — the saved sources gone, the last read kept", async () => {
  const w = rig({ chosen: () => false, saved: { on: true, rouenVersion: "1.9.21", coreVersion: "2.0", coreId: "core-1", lastRead: { at: 5, ms: 1, albums: 1, pages: 1 } } });
  assert.equal(w.removed, 1, "the saved sources were left on disk");
  assert.deepEqual(w.saved.lastRead, { at: 5, ms: 1, albums: 1, pages: 1 });
});

test("the review: chosen where it is on already — left as it is, its after-an-update check kept", async () => {
  const w = rig({ chosen: () => true, saved: { on: true, rouenVersion: "1.9.20", coreVersion: "2.0", coreId: "core-1" } });
  const before = w.s.status().checking;
  assert.match(before, /Rouen updated from 1\.9\.20/);
  w.s.optIn();
  assert.equal(w.s.status().checking, before, "choosing native mode skipped its check after the update");
});

test("the review: chosen, paired, but the server's address unknown — off, saying why", async () => {
  const w = rig({ chosen: () => true });
  w.core = { host: null, coreId: "core-1", coreVersion: "2.0" };
  w.s.optIn();
  assert.equal(w.saved.on, false);
  assert.match(w.saved.offReason, /address/);
});
