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
    cache: { read: () => null, write() {}, remove() {} },
    core: () => w.core, rouenVersion: "1.9.21", onChange: () => { w.changes++; },
    records: () => [], keyOf, link: w.l.link, view: () => ({ paired: 1, unpaired: 0 }),
    read: async (session) => { w.reads.push(session); return typeof w.result === "function" ? w.result(session) : w.result; },
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
