"use strict";
// ---------------------------------------------------------------------------
// N3-3a″, the recorder (lib/roon-direct/push-log.js, v1.9.66-t4, native-remote.md §15.3): started by hand, it records
// every update the server sends about the probe's kinds for some minutes, read by hand. The graph is objects.js's own;
// the updates are built here, so they are not evidence of what a real server sends (the owner's recording is).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { ObjectGraph, P } = require("../../lib/roon-direct/objects");
const { BinaryWriter } = require("../../lib/roon-direct/wire");
const { createRecorder, MAX_KEPT } = require("../../lib/roon-direct/push-log");

const API = "Sooloos.Broker.Api.";

/** A graph with a Zone (ZoneId, Crossfade, SeekPosition, Name) and an Album type declared. */
function graph() {
  const g = new ObjectGraph();
  g.types.set(1, { id: 1, name: API + "Zone", members: [{ name: `System.Sooid ${API}Zone::ZoneId`, propType: P.Sooid },
    { name: `int ${API}Zone::Crossfade`, propType: P.Int }, { name: `long ${API}Zone::SeekPosition`, propType: P.Long },
    { name: `string ${API}Zone::Name`, propType: P.String }] });
  g.types.set(2, { id: 2, name: API + "Album", members: [{ name: `string ${API}Album::Title`, propType: P.String }] });
  return g;
}
/** An update to the zone (oid 10): cmd 3 PUSHOBJ or 5 UPDATEOBJ, with the members given. */
function zone(cmd, f) {
  const w = new BinaryWriter().long(10n).flexInt(1);
  if (f.zoneId) w.flexInt(1).sooid(Buffer.from("16aa", "hex"));
  if (f.crossfade !== undefined) w.flexInt(2).integer(f.crossfade);
  if (f.seek !== undefined) w.flexInt(3).long(BigInt(f.seek));
  if (f.name) w.flexInt(4).string(f.name);
  w.flexInt(0);
  return { cmd, isResponse: false, body: w.toBuffer() };
}

test("THE one: started, it records each update about a zone — when, its kind, whether whole — and is read by hand", () => {
  const g = graph(), s = { graph: g };
  let t = Date.UTC(2026, 9, 23, 1, 0, 0);
  const rec = createRecorder({ session: () => s, now: () => t });
  assert.deepEqual(rec.read(), { recording: false, none: "Nothing has been recorded. Start with ?record=start." });
  g.ingest(zone(3, { zoneId: true, crossfade: 5, name: "TV Speaker" }));   // before the start: not recorded
  const started = rec.start(10);
  assert.equal(started.recording, true);
  t += 2000; g.ingest(zone(5, { crossfade: 8 }));                              // a field alone
  t += 1000; g.ingest(zone(5, { seek: 41 }));                                  // a zone's seek alone: counted
  t += 1000; g.ingest(zone(3, { zoneId: true, name: "TV Speaker" }));         // whole, Crossfade left out
  g.ingest({ cmd: 3, isResponse: false, body: new BinaryWriter().long(30n).flexInt(2).flexInt(1).string("Blue").flexInt(0).toBuffer() });   // not the probe's kind
  const r = rec.read();
  assert.equal(r.recording, true);
  assert.deepEqual([r.updates, r.seekOnly, r.faults], [2, 1, 0]);
  assert.deepEqual(r.pushes.map((p) => [p.afterS, p.object, p.kind, p.identity, p.members]), [
    [2, "Zone \"TV Speaker\"", "UPDATEOBJ", false, { Crossfade: 8 }],
    [4, "Zone \"TV Speaker\"", "PUSHOBJ", true, { ZoneId: { bytes: 2 }, Name: "TV Speaker" }]]);
  assert.equal(r.pushes[0].at, "2026-10-23T01:00:02.000Z");
  rec.stop("test over");
});

test("past the cap it counts; a stub is counted; it stops at its time or when the connection changes — said — and lets the graph go", async () => {
  const g = graph();
  let s = { graph: g };
  const rec = createRecorder({ session: () => s, checkMs: 10 });
  rec.start(1);
  for (let i = 0; i < MAX_KEPT + 5; i++) g.ingest(zone(5, { crossfade: i }));
  for (const w of g.watchers) w({ oid: 10n, typeName: API + "Zone", fields: {} }, {}, 4);   // a stub: no member
  let r = rec.read();
  assert.deepEqual([r.recording, r.updates, r.more, r.stubs], [true, MAX_KEPT, 5, 1], "the rest counted, still recording (§15.3)");
  rec.start(1);
  assert.equal(rec.read().updates, 0, "starting again starts afresh");
  assert.equal(g.watchers.size, 1, "the first recording's watcher left on the graph");
  s = { graph: graph() };   // reconnected: noticed by the check, not only when read
  await new Promise((res) => { setTimeout(res, 40); });
  assert.equal(g.watchers.size, 0, "the watcher left on the old graph");
  r = rec.read();
  assert.equal(r.recording, false);
  assert.match(r.stopped, /^The connection to your server changed, so the recording stopped there/);
  // no connection: nothing to record, said; minutes out of range refused
  assert.match(createRecorder({ session: () => null }).start(5).error, /^Rouen has no connection to your server open now/);
  for (const m of [0, 16, 2.5, NaN]) assert.match(createRecorder({ session: () => ({ graph: g }) }).start(m).error, /^minutes takes whole minutes/);
});

test("the review: a connection lost before the time is up is said as lost, not as time up", async () => {
  const g = graph();
  let s = { graph: g };
  const rec = createRecorder({ session: () => s, checkMs: 60000 });   // the check too slow to see it first
  rec.start(1);
  s = { graph: graph() };
  // the time runs out (the timer, called here at once rather than in a minute)
  const timers = [];
  const real = global.setTimeout;
  global.setTimeout = (fn, ms) => { timers.push(fn); return real(() => {}, 0); };
  try {
    const rec2 = createRecorder({ session: () => s, checkMs: 60000 });
    rec2.start(1);
    s = { graph: graph() };
    timers[0]();
    assert.match(rec2.read().stopped, /^The connection to your server changed/);
  } finally {
    global.setTimeout = real;
    rec.stop("test over");
  }
});

test("a fault while recording never reaches the graph's own reading: counted, the first few said with what failed", () => {
  const g = graph();
  const rec = createRecorder({ session: () => ({ graph: g }) });
  rec.start(5);
  const o = { oid: 99n, typeName: API + "Zone", fields: {} };
  // a member describe() can't read: a getter that throws
  const pushed = {};
  Object.defineProperty(pushed, `int ${API}Zone::Crossfade`, { enumerable: true, get() { throw new Error("odd"); } });
  for (const w of g.watchers) assert.doesNotThrow(() => w(o, pushed, 5));
  const r = rec.read();
  assert.deepEqual([r.faults, r.faultsSeen], [1, [{ object: API + "Zone", oid: "99", why: "odd" }]]);
  rec.stop("test over");
});
