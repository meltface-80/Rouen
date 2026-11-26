"use strict";
// ---------------------------------------------------------------------------
// The catalogue walk on connections of its own (lib/roon-direct/walk-conn.js, edit-facts.js; dev/design/catalogue.md
// §4.1, 2.0.8-t5). The owner's server, 2026-11-26: native mode's connection held 175,752 objects six minutes after it
// opened, the walk having read 600 of 13,095 albums on it, and playlists were refused for want of room. Scripted
// connections: not evidence of what a real server does.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createEditFacts, OWN_ROOM, MAX_CONNECTIONS } = require("../../lib/roon-direct/edit-facts");
const { createWalkConnections } = require("../../lib/roon-direct/walk-conn");

const until = async (fn) => { for (let i = 0; i < 250 && !fn(); i++) await new Promise((r) => { setTimeout(r, 4); }); return fn(); };

/** Native mode's connection, and the walk's own, each answer leaving `grow` objects in the connection it was asked on. */
function world(o = {}) {
  const asked = [], kept = [], opened = [], closed = [];
  const albums = o.albums || 20;
  const known = () => new Map([...Array(albums).keys()].map((i) => [String(i), { oid: String(i), title: "T" + i, artist: "A" }]));
  let calls = 0;
  let stopIt = () => {};
  const conn = (name) => {
    const graph = { maxObjects: 200000, objects: { size: o.fullFromStart ? 190000 : 0 }, overflowed: false };
    return { name, g: { uncertain: () => "", defineType: () => 9, call: async () => {
      asked.push(name); calls++;
      if (o.throwAt === calls) { if (o.stopFirst) stopIt(); throw new Error("call 1 failed: no answer in 10000 ms"); }
      graph.objects.size += o.grow || 60000;
      if (o.overflowAt === calls) graph.overflowed = true;
      return { success: true, payload: Buffer.alloc(0) };
    } }, root: { library: { oid: 7n } }, graph };
  };
  const main = conn("main");
  let n = 0;
  const fresh = async () => {
    if (o.stopDuringOpen) { stopIt(); return { why: "the connection closed" }; }
    if (o.refuseOpen) return { why: "Your server didn't take a connection for the walk." };
    const c = conn("own" + ++n);
    opened.push(c.name);
    return { session: c, known: known(), close: () => closed.push(c.name) };
  };
  const timers = [];
  const ef = createEditFacts({ link: { session: () => main }, inTurn: (fn) => fn(), on: () => true, known: () => known(),
    keep: (records, whole) => { kept.push([records.length, whole]); return { kept: records.length }; },
    batch: 2, pauseMs: 0, retryMs: 600000, keepEvery: 2, now: () => 0, sleep: async () => {},
    timer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {},
    itemsOf: (g, payload, ids) => ({ items: [...ids].map((oid) => ({ oid, facts: { catno: null, types: ["album"], labels: [] } })), unpaired: 0 }),
    fresh });
  stopIt = () => ef.stop();
  const records = [];
  return { ef, main, asked, kept, opened, closed, timers, records };
}

test("THE one for the owner's server: the walk never calls on native mode's connection, and goes on from one connection of its own to the next until the library is whole", async () => {
  const w = world();
  assert.equal(w.ef.start(w.main), true);
  assert.ok(await until(() => !w.ef.status().running && w.ef.status().last && w.ef.status().last.whole));
  assert.equal(w.asked.filter((x) => x === "main").length, 0, "THE one: the walk filled native mode's connection");
  assert.equal(w.main.graph.objects.size, 0);
  // 200,000 a connection, 60,000 an answer, OWN_ROOM left: four answers (eight albums) on each; twenty albums, three connections.
  assert.deepEqual(w.opened, ["own1", "own2", "own3"]);
  assert.deepEqual(w.closed, ["own1", "own2", "own3"], "a connection of the walk's left open");
  assert.deepEqual(w.asked, ["own1", "own1", "own1", "own1", "own2", "own2", "own2", "own2", "own3", "own3"]);
  assert.deepEqual(w.kept.at(-1), [20, true], "the whole pass, across its own connections, in one go");
  assert.deepEqual(w.timers, [], "waited for a timer or the next night between connections");
  assert.ok(OWN_ROOM < 60000, "each own connection left as much room as native mode's once did");
});

test("no connection of its own: said, and tried again on its own timer; never on native mode's in its place", async () => {
  const w = world({ refuseOpen: true });
  w.ef.start(w.main);
  assert.ok(await until(() => !w.ef.status().running && w.ef.status().last));
  assert.match(w.ef.status().last.why, /a connection of its own for the walk: Your server didn't take/);
  assert.deepEqual([w.asked, w.timers.map((t) => t.ms)], [[], [600000]]);
});

test("a library bigger than MAX_CONNECTIONS connections' worth: stops after that many, kept, and goes on by itself on its timer (the review)", async () => {
  const w = world({ albums: (MAX_CONNECTIONS + 1) * 8 });
  w.ef.start(w.main);
  assert.ok(await until(() => !w.ef.status().running && w.ef.status().last), "the walk never ended");
  assert.equal(w.opened.length, MAX_CONNECTIONS);
  assert.equal(w.ef.status().last.next, "connection");
  assert.deepEqual(w.timers.map((t) => t.ms), [600000], "THE one: the board said it goes on by itself, and nothing would start it");
  w.timers[0].fn();
  assert.ok(await until(() => !w.ef.status().running && w.ef.status().last.whole));
  assert.equal(w.kept.at(-1)[0], (MAX_CONNECTIONS + 1) * 8);
});

test("walk-conn: a connection opened, its root and library read, the albums by object id; each failure closes what it opened", async () => {
  const closed = [];
  // A server whose root graph brings a Library and a Profile (o.bare: neither).
  const objs = (o) => (o.bare ? [] : [{ oid: 3n, typeName: "Sooloos.Broker.Api.Library", loaded: true, fields: {} },
    { oid: 2n, typeName: "Sooloos.Broker.Api.Profile", loaded: true, fields: { "System.Sooid Sooloos.Broker.Api.Profile::ProfileId": Buffer.from("cafebabe", "hex") } }]);
  const s0 = (o) => {
    if (o.none) return { session: null };
    const list = objs(o);
    const graph = { objects: new Map(list.map((x) => [String(x.oid), x])), ofType: (t) => list.filter((x) => x.typeName.endsWith("." + t)), get: () => undefined };
    return { session: { remoting: { getService: async () => ({}) }, graph, close: () => closed.push(1) } };
  };
  const core = () => ({ host: "h", coreId: "c" });
  const mk = (o) => createWalkConnections({ core: o.unpaired ? () => null : core, connect: async () => s0(o), settleMs: 1,
    read: async () => (o.readFails ? { ok: false, why: "timed out" } : { ok: true, albums: [{ oid: 5n, title: "X", artist: "Y" }] }) });
  // readRoot is the real one: a graph that sends nothing gives no Library, so the connection is closed and said.
  const ok = await mk({}).open();
  assert.deepEqual([...ok.known.keys()], ["5"], "the albums by object id, as the walk names them");
  assert.equal(ok.session.root.library.oid, 3n);
  assert.equal(closed.length, 0, "closed before the walk had it");
  ok.close();
  assert.equal(closed.length, 1);
  assert.match((await mk({ bare: true }).open()).why, /without its Library/);
  assert.match((await mk({ readFails: true }).open()).why, /library couldn't be read on the walk's connection: timed out/);
  assert.equal(closed.length, 3, "a failed opening left its connection open");
  assert.match((await mk({ none: true }).open()).why, /didn't take a connection/);
  assert.match((await mk({ unpaired: true }).open()).why, /isn't paired/);
});

test("the review: a call that throws on the walk's own connection closes it, and the walk goes on on its timer, not at the next library read", async () => {
  const w = world({ throwAt: 2 });
  w.ef.start(w.main);
  assert.ok(await until(() => !w.ef.status().running && w.ef.status().last));
  assert.match(w.ef.status().last.why, /the walk failed on its own connection: call 1 failed/);
  assert.deepEqual(w.closed, ["own1"], "left open");
  assert.deepEqual(w.timers.map((t) => t.ms), [600000], "THE one: nothing armed, so hours idle");
  w.timers[0].fn();
  assert.ok(await until(() => !w.ef.status().running && w.ef.status().last.whole));
});

test("the review: an answer past the room left (objects dropped at the cap) is not read: its batch asked again, first, on the next connection", async () => {
  const w = world({ overflowAt: 2, albums: 6 });
  w.ef.start(w.main);
  assert.ok(await until(() => !w.ef.status().running && w.ef.status().last && w.ef.status().last.whole));
  // own1: batch 1 read, batch 2's answer overflowed; own2: batch 2 again, then batch 3.
  assert.deepEqual(w.asked, ["own1", "own1", "own2", "own2"], "THE one: a batch read short kept as Roon's");
  assert.deepEqual(w.kept.at(-1), [6, true]);
});

test("the review: a connection full before its first answer opens no other (40 library reads for nothing); native mode off while one opens arms nothing", async () => {
  const w = world({ fullFromStart: true });
  w.ef.start(w.main);
  assert.ok(await until(() => !w.ef.status().running && w.ef.status().last));
  assert.deepEqual([w.opened, w.asked], [["own1"], []], "THE one: connection after connection opened, each reading the library");
  assert.deepEqual(w.timers.map((t) => t.ms), [600000]);
  const off = world({ stopDuringOpen: true });
  off.ef.start(off.main);
  assert.ok(await until(() => !off.ef.status().running));
  assert.deepEqual(off.timers, [], "a retry armed after native mode was turned off");
  assert.equal(off.ef.status().last, null, "native mode turned off said as a connection that failed");
  const thrown = world({ throwAt: 1, stopFirst: true });
  thrown.ef.start(thrown.main);
  assert.ok(await until(() => !thrown.ef.status().running && thrown.ef.status().last));
  assert.deepEqual(thrown.timers, [], "a retry armed after native mode was turned off, from a call that failed as it was");
});

test("native mode turned off between two of the walk's connections: no next one opened", async () => {
  const w = world();
  const fresh0 = w.ef;
  let n = 0;
  // Off as the first connection closes: the closes are counted by the world.
  const close = w.closed.push.bind(w.closed);
  w.closed.push = (x) => { n++; if (n === 1) fresh0.stop(); return close(x); };
  w.ef.start(w.main);
  assert.ok(await until(() => !w.ef.status().running));
  assert.deepEqual(w.opened, ["own1"], "THE one: a connection opened after native mode was turned off");
  assert.deepEqual(w.timers, []);
});
