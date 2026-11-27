"use strict";
// ---------------------------------------------------------------------------
// Native mode always on (2.0.6-t21, dev/design/roon-native.md §11; the owner, 2026-11-26: "I also want native mode to
// be permanently on no toggle switch to turn it off. But I do want fall back to full official API if native mode
// starts to have errors due to roon closing the reverse code path"). Asked: tried again "Nightly + on updates";
// an emergency off by "Container setting only". Each test was broken on purpose once and failed.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createStage1 } = require("../../lib/roon-direct/stage1");
const { createLink } = require("../../lib/roon-direct/link");
const { emergencyOff, openingFault, stored } = require("../../lib/roon-direct/always-on");

const keyOf = (title, artist) => (title ? `${title.toLowerCase()}||${artist.toLowerCase()}` : null);
const OK = { ok: true, albums: [{ oid: "7", title: "Blue", artist: "Joni", contentSource: 1, imageKey: null }], count: 1, pages: 1, ms: 5 };

function fakeLink() {
  const l = { calls: [], s: null };
  l.link = {
    start: () => l.calls.push("start"), stop: () => { l.calls.push("stop"); l.s = null; },
    refresh: () => l.calls.push("refresh"), cycle: (why) => { l.calls.push("cycle: " + why); },
    session: () => l.s, status: () => ({ up: !!l.s }),
  };
  return l;
}

function rig(o = {}) {
  const w = { saved: o.saved, reads: 0, l: fakeLink(), result: OK, clock: Date.UTC(2026, 10, 26, 12),
    core: { host: "10.0.0.2", coreId: "core-1", coreVersion: "2.0" } };
  w.s = createStage1({
    settings: { load: () => w.saved, save: (v) => { w.saved = JSON.parse(JSON.stringify(v)); } },
    cache: { read: () => null, write() {}, remove() {} },
    core: () => w.core, rouenVersion: "2.0.6-t21", records: () => [], keyOf, link: w.l.link, minGapMs: 0,
    now: () => w.clock, view: () => null,
    read: async () => { w.reads++; return typeof w.result === "function" ? w.result() : w.result; },
  });
  return w;
}
/** A session opened on the fake link, read. */
async function session(w, gen) { w.l.s = { gen }; w.s.linkUp(); await w.s.settled(); }

test("the emergency off: ROUEN_NATIVE=off, or Lite's settings file; nothing else", () => {
  assert.match(emergencyOff({ env: { ROUEN_NATIVE: "off" }, settings: {} }), /ROUEN_NATIVE=off/);
  assert.match(emergencyOff({ env: { ROUEN_NATIVE: " OFF " }, settings: {} }), /ROUEN_NATIVE=off/);
  assert.match(emergencyOff({ env: {}, settings: { native: "off" } }), /"native": "off"/);
  assert.equal(emergencyOff({ env: { ROUEN_NATIVE: "on" }, settings: { native: true } }), null);
  assert.equal(emergencyOff({ env: {}, settings: null }), null);
});

test("a saved switch turned off before 2.0.6-t21 is read as on; a suspension is kept", () => {
  assert.equal(stored({ on: false }).on, true, "THE one: the old switch's off survived the update");
  assert.deepEqual(stored({ suspended: { why: "refused", at: 5 } }).suspended, { why: "refused", at: 5 });
  assert.equal(stored({ suspended: { at: 5 } }).suspended, null);
});

test("what a failed opening says: refused, broken, or only out of reach", () => {
  assert.equal(openingFault("the Core refused the connection (the Core refused the handshake (reply 0x2 at step 1))"), "refused");
  assert.equal(openingFault("the Core sent something other than ROON at handshake step 2"), "failed");
  assert.equal(openingFault("the Core's graph arrived without its Library or a profile"), "failed");
  assert.equal(openingFault("could not reach the Core: connect ECONNREFUSED 10.0.0.2:9332"), null, "a server restarting is a drop");
  assert.equal(openingFault("connect ETIMEDOUT"), null);
});

test("three reads failing in a row, on three connections, suspend it; the official API serves everything", async () => {
  const w = rig();
  w.s.paired();
  await session(w, 1);
  assert.ok(w.s.albums(), "in use");
  w.result = { ok: false, why: "a page the server would not send" };
  await session(w, 2);
  await session(w, 3);
  assert.equal(w.s.status().suspended, null, "two: a fallback, still trying on each new connection");
  await session(w, 4);
  const st = w.s.status();
  assert.match(st.suspended.why, /^three reads of your library failed in a row; the last: a page the server would not send$/);
  assert.equal(w.s.albums(), null, "the official API's list");
  assert.equal(w.l.calls.at(-1), "stop", "nothing native is sent until the next try");
  // Every feature steps aside, as with native mode off: today's way, the official API's (the review).
  assert.deepEqual(await w.s.adder.add({ title: "Blue", artist: "Joni", service: "tidal" }), { off: true });
  assert.deepEqual(await w.s.listenLater.set({ title: "Blue", artist: "Joni" }, true), { off: true });
  const before = w.reads;
  w.s.indexChanged(); await session(w, 5);
  assert.equal(w.reads, before, "THE one: suspended, it kept knocking on every library change");
});

test("one good read between failures starts the count again", async () => {
  const w = rig();
  w.s.paired();
  w.result = { ok: false, why: "busy" };
  await session(w, 1); await session(w, 2);
  w.result = OK; await session(w, 3);
  w.result = { ok: false, why: "busy" };
  await session(w, 4); await session(w, 5);
  assert.equal(w.s.status().suspended, null);
});

test("the review: the emergency off can't be passed by the one-time choice, paired or not", async () => {
  const w = rig();
  w.s = createStage1({ settings: { load: () => undefined, save() {} }, cache: { read: () => null, write() {}, remove() {} },
    core: () => null, rouenVersion: "2.0.6-t21", records: () => [], keyOf, link: w.l.link,
    emergency: () => "The container was started with ROUEN_NATIVE=off." });
  w.l.calls.length = 0;
  w.s.optIn();
  assert.equal(w.s.status().on, false, "THE one: on, and its connection started, with ROUEN_NATIVE=off");
  assert.deepEqual(w.l.calls, []);
});

test("tried again at start: in use again when the read is whole; suspended anew, with why, when not", async () => {
  const w = rig({ saved: { on: true, rouenVersion: "2.0.6-t21", coreVersion: "2.0", coreId: "core-1", suspended: { why: "refused", at: 1 } } });
  assert.match(w.s.status().checking, /^Rouen restarted; native mode had stopped: refused$/);
  assert.deepEqual(w.l.calls, ["start"], "its connection opens to try");
  w.s.paired();
  await session(w, 1);
  assert.equal(w.s.status().suspended, null, "THE one: never tried again but by hand");
  assert.ok(w.s.albums());
  const bad = rig({ saved: { on: true, rouenVersion: "2.0.6-t21", coreVersion: "2.0", coreId: "core-1", suspended: { why: "refused", at: 1 } } });
  bad.result = { ok: false, why: "still refused" };
  bad.s.paired();
  await session(bad, 1);
  assert.match(bad.s.status().suspended.why, /^Rouen restarted; native mode had stopped: refused, and the check that followed failed: still refused$/);
});

test("suspended: tried again when the server updates or changes, not on every pairing", async () => {
  const w = rig();
  w.s.paired();
  await session(w, 1);
  w.s.linkBroken("the Core refused the connection");
  assert.match(w.s.status().suspended.why, /refused/);
  w.s.paired();
  assert.equal(w.s.status().checking, null, "the same server, the same version: it waits for 04:00");
  w.core = { host: "10.0.0.2", coreId: "core-1", coreVersion: "2.1" };
  w.s.paired();
  assert.match(w.s.status().checking, /^Trying native mode again \(Your server updated from 2\.0 to 2\.1\)/);
  await session(w, 2);
  assert.equal(w.s.status().suspended, null);
  assert.equal(w.saved.coreVersion, "2.1");
});

test("suspended: tried again at 04:00, and only then", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"], now: 0 });
  const w = rig();
  w.s.paired();
  await session(w, 1);
  w.s.linkBroken("the Core refused the connection");
  const calls = w.l.calls.length;
  const msTo4 = (() => { const d = new Date(w.clock); const n = new Date(d); n.setHours(4, 0, 0, 0); if (n <= d) n.setDate(n.getDate() + 1); return n - d; })();
  t.mock.timers.tick(msTo4 - 1000);
  assert.equal(w.s.status().checking, null, "not before 04:00");
  t.mock.timers.tick(1000);
  assert.match(w.s.status().checking, /^Trying native mode again \(the nightly try at 04:00\)/);
  assert.ok(w.l.calls.slice(calls).includes("start"), "its connection opened to try");
});

test("the link: refused at once, or three openings in a row that reached the server, say the path is broken; out of reach never", async () => {
  /** A link whose every opening fails with `answer`, and what it said broke. */
  const run = async (answer, spins, failingMs = 0) => {
    const broken = [];
    const answers = Array.isArray(answer) ? answer : [answer];
    const link = createLink({ core: () => ({ host: "10.0.0.2", coreId: "aa".repeat(16) }), retryFirstMs: 1, failingMs,
      connect: async () => ({ session: null, tried: answers.map((error, i) => ({ label: "id" + i, id: "x", ok: false, error })) }),
      onBroken: (why) => broken.push(why) });
    link.start();
    for (let i = 0; i < spins; i++) await new Promise((r) => { setTimeout(r, 10); });
    link.stop();
    return broken;
  };
  assert.match((await run("the Core refused the handshake (reply 0x2 at step 1)", 2))[0] || "", /refused the handshake/,
    "THE one: refused, and retried every five minutes for ever");
  assert.deepEqual(await run("connect ECONNREFUSED 10.0.0.2:9332", 8), [], "a server out of reach is a drop");
  assert.match((await run("the Core sent something other than ROON at handshake step 2", 12))[0] || "",
    /^openings kept failing for 0 minutes; the last: the Core answered, and no session came up \(the Core sent something other than ROON/);
  // The review: one broker id refused (the wrong one) beside a slow handshake on the right one is a drop.
  assert.deepEqual(await run(["the Core did not finish the handshake in time", "the Core refused the handshake (reply 0x2 at step 1)"], 8), []);
  // The review: a server restarting (a proxy closing at once, the root service unanswered) for less than half an hour.
  assert.deepEqual(await run("the Core closed the connection during the handshake", 12, 30 * 60 * 1000), [],
    "THE one: three quick failures while the server restarts suspended it until 04:00");
  assert.equal(openingFault("call 3 failed: the connection closed"), "failed", "the root service closed on: the path closed");
  assert.equal(openingFault("the Core did not answer call 2 within 10000 ms"), "failed");
});
