"use strict";
// ---------------------------------------------------------------------------
// The native remote's one connection (lib/roon-direct/link.js,
// dev/design/native-remote.md §4): kept open, opened again when it drops,
// every night, and when it can no longer be trusted; closed for good when
// Roon direct is switched off. Against the fake Core over real TCP, which is
// not evidence of a real Core (§6).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { startFakeCore } = require("../lib/fake-roon-core");
const { createLink, msUntilHour } = require("../../lib/roon-direct/link");
const { readAlbumsOn } = require("../../lib/roon-direct/albums");
const { dotnetGuidBytes } = require("../../lib/roon-direct/brokerid");
const { CORE_ID, LIBRARY, fast, assertTidy } = require("../lib/roon-direct-fixtures");

const until = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => { setTimeout(r, 20); }); }
  return fn();
};

async function rig(t, extra) {
  const core = await startFakeCore({ brokerId: dotnetGuidBytes(CORE_ID), albums: LIBRARY });
  const ups = [], downs = [];
  const link = createLink(Object.assign({ core: () => ({ host: "127.0.0.1", coreId: CORE_ID }), port: core.port,
    timeoutMs: 1500, settleMs: 800, retryFirstMs: 100, onUp: (s) => ups.push(s), onDown: (w) => downs.push(w) }, extra));
  t.after(async () => { link.stop(); await core.close(); });
  return { core, link, ups, downs };
}

test("started: one session, open, with the Core's Library and a profile", async (t) => {
  const { core, link, ups } = await rig(t);
  link.start();
  const s = await until(() => link.session());
  assert.ok(s, "no session opened");
  assert.equal(s.gen, 1);
  assert.ok(s.root.library && s.root.profileId);
  assert.equal(ups.length, 1);
  assert.equal(core.rec.connections, 1);
  const st = link.status();
  assert.deepEqual([st.running, st.up, st.session, st.reconnects], [true, true, 1, 0]);
});

test("the album list, read twice on the one session: it stays open, and each read tidies after itself", async (t) => {
  const { core, link } = await rig(t);
  link.start();
  const s = await until(() => link.session());
  const a = await readAlbumsOn(s, fast);
  const b = await readAlbumsOn(s, fast);
  assert.equal(a.ok, true, a.why);
  assert.equal(b.ok, true, b.why);
  assert.equal(b.albums.length, LIBRARY.length);
  assert.ok(b.albums.every((x) => /^\d+$/.test(x.oid)), "each album keeps its object id");
  assert.equal(link.session(), s, "THE one: a read closed the link's session");
  assert.equal(core.rec.connections, 1);
  link.stop();
  await core.idle();
  assertTidy(core.rec);
});

test("dropped by the Core: a new session, the old ids gone with the old one", async (t) => {
  const { core, link, ups, downs } = await rig(t);
  link.start();
  await until(() => link.session());
  core.drop();
  await until(() => downs.length === 1);
  assert.equal(downs[0], "the connection closed");
  const s2 = await until(() => link.session() && link.session().gen === 2 && link.session());
  assert.ok(s2, "THE one: dropped, and not opened again");
  assert.equal(ups.length, 2);
  assert.equal(link.status().reconnects, 1);
});

test("cycled (the nightly reconnect, or a session no longer trusted): closed, and a fresh one at once", async (t) => {
  const { link, downs } = await rig(t);
  link.start();
  await until(() => link.session());
  link.cycle("the nightly reconnect");
  assert.equal(link.session(), null);
  assert.deepEqual(downs, ["the nightly reconnect"]);
  assert.ok(await until(() => link.session() && link.session().gen === 2));
});

test("stopped (Roon direct off): closed, and nothing opens again", async (t) => {
  const { core, link, downs } = await rig(t);
  link.start();
  await until(() => link.session());
  link.stop();
  assert.equal(link.session(), null);
  assert.deepEqual(downs, ["native mode switched off"]);
  await new Promise((r) => { setTimeout(r, 400); });
  assert.equal(link.session(), null, "THE one: switched off, and opened again");
  assert.equal(core.rec.connections, 1);
  await core.idle();
});

test("not paired: nothing is tried until pairing asks", async (t) => {
  let paired = null;
  const { link, core } = await rig(t, { core: () => paired });
  link.start();
  await new Promise((r) => { setTimeout(r, 200); });
  assert.equal(core.rec.connections, 0);
  paired = { host: "127.0.0.1", coreId: CORE_ID };
  link.refresh();
  assert.ok(await until(() => link.session()));
});

test("a session that can no longer be trusted is replaced at the next look", async () => {
  const graphs = [];
  const fakeSession = () => {
    const graph = { objects: new Map(), decodeErrors: 0, overflowed: false };
    graphs.push(graph);
    return { session: { remoting: { uncertain: "", call() {}, callNoReply() {}, getService() {}, defineType() {} }, graph,
      conn: { onclosed: () => {} }, close: () => {} }, tried: [], used: "x" };
  };
  const link = createLink({ core: () => ({ host: "h", coreId: CORE_ID }), connect: async () => fakeSession(),
    readRoot: async () => ({ library: {}, profileId: Buffer.alloc(1), profiles: [], profileName: "p" }) });
  link.start();
  await until(() => link.session());
  graphs[0].decodeErrors = 2;
  link.check();
  assert.equal(link.status().lastDown.why, "2 message(s) from the Core could not be read");
  assert.ok(await until(() => link.session() && link.session().gen === 2));
  link.stop();
});

// The review's cases (v1.9.21): switched off and on while a connection opens.
function slowLink() {
  const w = { closed: 0, connects: [], roots: [], slowConnect: false };
  const fake = () => ({ session: { remoting: { uncertain: () => "", call() {}, callNoReply() {}, getService() {}, defineType() {} },
    graph: { objects: new Map(), decodeErrors: 0, overflowed: false }, conn: { onclosed: () => {} }, close: () => { w.closed++; } }, tried: [] });
  w.link = createLink({ core: () => ({ host: "h", coreId: CORE_ID }),
    connect: () => (w.slowConnect ? new Promise((r) => { w.connects.push(() => r(fake())); }) : Promise.resolve(fake())),
    readRoot: () => new Promise((r) => { w.roots.push(() => r({ library: {}, profileId: Buffer.alloc(1), profiles: [], profileName: "p" })); }) });
  return w;
}

test("switched off while the root is read: closed, and nothing of it runs", async () => {
  const w = slowLink();
  w.link.start();
  await until(() => w.roots.length === 1);
  w.link.stop();
  w.roots[0]();
  await new Promise((r) => { setTimeout(r, 50); });
  assert.equal(w.link.session(), null, "THE one: a connection held open with Roon direct off");
  assert.equal(w.closed, 1);
  assert.equal(w.link.status().running, false);
});

test("switched off while it connects, then on again: it opens", async () => {
  const w = slowLink();
  w.slowConnect = true;
  w.link.start();
  await until(() => w.connects.length === 1);
  w.link.stop();
  w.connects[0]();
  await until(() => w.closed === 1);
  w.link.start();
  assert.ok(await until(() => w.connects.length === 2), "THE one: never able to open again");
  w.connects[1]();
  await until(() => w.roots.length === 1);
  w.roots[0]();
  assert.ok(await until(() => w.link.session()));
  w.link.stop();
});

test("switched off and on again while the root is read: that opening is used", async () => {
  const w = slowLink();
  w.link.start();
  await until(() => w.roots.length === 1);
  w.link.stop();
  w.link.start();
  w.roots[0]();
  assert.ok(await until(() => w.link.session()));
  w.link.stop();
});

test("the nightly reconnect's hour: the next 04:00, today or tomorrow", () => {
  const at = (h, m) => { const d = new Date(2026, 9, 14, h, m, 0, 0); return d; };
  assert.equal(msUntilHour(4, at(3, 0)), 60 * 60 * 1000);
  assert.equal(msUntilHour(4, at(4, 0)), 24 * 60 * 60 * 1000, "at 04:00 itself: tomorrow's");
  assert.equal(msUntilHour(4, at(23, 30)), 4.5 * 60 * 60 * 1000);
});
