"use strict";
// ---------------------------------------------------------------------------
// N3-3a″, the recorder (lib/roon-direct/push-log.js, v1.9.66-t4/t5, native-remote.md §15.3/§15.4): started by hand,
// it records every update the server sends about the probe's kinds for some minutes, read by hand. The graph is objects.js's own;
// the updates are built here, so they are not evidence of what a real server sends (the owner's recording is).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { ObjectGraph, P } = require("../../lib/roon-direct/objects");
const { BinaryWriter } = require("../../lib/roon-direct/wire");
const { createRecorder, MAX_KEPT, MAX_OBJECTS, MAX_TICKING, MAX_SAME_BY, TICK_AFTER, TICK_SPAN_MS, TICK_GAP_MS } = require("../../lib/roon-direct/push-log");

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
/** One connection, the same each time asked (a new one each time reads as the connection changed). @param {any} g */
const once = (g) => { const s = { graph: g }; return () => s; };
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
  t += 1000; g.ingest(zone(5, { seek: 41 }));                                  // a zone's seek, come: kept
  g.ingest(zone(5, { seek: 42 }));                                             // the seek alone moved: same (t5)
  t += 1000; g.ingest(zone(3, { zoneId: true, name: "TV Speaker" }));         // whole
  g.ingest({ cmd: 3, isResponse: false, body: new BinaryWriter().long(30n).flexInt(2).flexInt(1).string("Blue").flexInt(0).toBuffer() });   // not the probe's kind
  const r = rec.read();
  assert.equal(r.recording, true);
  assert.deepEqual([r.updates, r.same, r.faults], [3, 1, 0]);
  assert.deepEqual(r.pushes.map((p) => [p.afterS, p.object, p.kind, p.identity, p.members]), [
    [2, "Zone \"TV Speaker\"", "UPDATEOBJ", false, { Crossfade: 8 }],
    [3, "Zone \"TV Speaker\"", "UPDATEOBJ", false, { SeekPosition: "41" }],
    [4, "Zone \"TV Speaker\"", "PUSHOBJ", true, { ZoneId: { bytes: 2 }, Name: "TV Speaker" }]]);
  assert.equal(r.pushes[0].at, "2026-10-23T01:00:02.000Z");
  // t5: compared with what Rouen held at the start (the push before it), not first by default
  assert.deepEqual(r.pushes.map((p) => [p.first, p.changed, p.dropped]), [
    ["held", ["Crossfade"], undefined], [undefined, ["SeekPosition"], undefined], [undefined, [], ["Crossfade", "SeekPosition"]]]);
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
  for (const m of [0, 16, 2.5, NaN]) assert.match(createRecorder({ session: once(g) }).start(m).error, /^minutes takes whole minutes/);
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
  // t5, the review: an object held at the start that can't be read is a fault too, never a start that throws
  const bad = {};
  Object.defineProperty(bad, `int ${API}Zone::Crossfade`, { enumerable: true, get() { throw new Error("held odd"); } });
  g.objects.set("98", { oid: 98n, typeName: API + "Zone", loaded: true, fields: bad });
  const rec = createRecorder({ session: once(g) });
  assert.equal(rec.start(5).recording, true);
  const o = { oid: 99n, typeName: API + "Zone", fields: {} };
  // a member describe() can't read: a getter that throws — on its second read, so after the compare (t5, the review)
  const pushed = {};
  let reads = 0;
  Object.defineProperty(pushed, `int ${API}Zone::Crossfade`, { enumerable: true, get() { if (++reads === 2) throw new Error("odd"); return 1; } });
  for (const w of g.watchers) assert.doesNotThrow(() => w(o, pushed, 5));
  let r = rec.read();
  assert.deepEqual([r.faults, r.faultsSeen], [2, [{ object: API + "Zone", oid: "98", why: "held odd" }, { object: API + "Zone", oid: "99", why: "odd" }]]);
  // t5, the review: a fault notes nothing, so the same object's next update is still its first
  for (const w of g.watchers) w(o, { [`int ${API}Zone::Crossfade`]: 3 }, 5);
  r = rec.read();
  assert.deepEqual(r.pushes.map((p) => p.first), ["new"]);
  rec.stop("test over");
});

test("t5, changes only (§15.4): an update the same as the last kept is counted, the tick aside; a whole one says what dropped", () => {
  const g = graph();
  const rec = createRecorder({ session: once(g) });
  rec.start(5);
  g.ingest(zone(5, { zoneId: true, crossfade: 5, seek: 1, name: "TV Speaker" }));   // kept: the first
  g.ingest(zone(5, { zoneId: true, crossfade: 5, seek: 2, name: "TV Speaker" }));   // the tick alone moved: same
  g.ingest(zone(5, { zoneId: true, crossfade: 5, name: "TV Speaker" }));            // SeekPosition gone: kept
  g.ingest(zone(5, { zoneId: true, name: "TV Speaker" }));                          // Crossfade back to default: kept
  g.ingest(zone(5, { zoneId: true, name: "TV Speaker" }));                          // same
  g.ingest(zone(5, { crossfade: 8 }));                                              // a field alone: kept
  g.ingest(zone(5, { crossfade: 8 }));                                              // same
  g.ingest(zone(5, { zoneId: true, name: "TV Speaker" }));                          // what a partial set, gone: kept
  g.ingest(zone(5, { zoneId: true, crossfade: 8, name: "TV Speaker" }));            // and back: kept
  g.ingest(zone(5, { zoneId: true, crossfade: 8, name: "TV Speaker" }));            // whole again, nothing new: same
  g.ingest(zone(5, { zoneId: true, crossfade: 9, name: "TV Speaker" }));            // a value changed: kept
  const r = rec.read();
  assert.deepEqual([r.updates, r.same, r.more], [7, 4, 0]);
  assert.deepEqual(r.pushes.map((p) => [Object.keys(p.members).join(","), p.first, p.changed, p.dropped]), [
    ["ZoneId,Crossfade,SeekPosition,Name", "new", undefined, undefined],
    ["ZoneId,Crossfade,Name", undefined, [], ["SeekPosition"]],
    ["ZoneId,Name", undefined, [], ["Crossfade"]],
    ["Crossfade", undefined, ["Crossfade"], undefined],
    ["ZoneId,Name", undefined, [], ["Crossfade"]],
    ["ZoneId,Crossfade,Name", undefined, ["Crossfade"], []],
    ["ZoneId,Crossfade,Name", undefined, ["Crossfade"], []]]);
  rec.stop("test over");
});

test("t5: past MAX_OBJECTS a new object's updates are all kept — none lost — and what it notes stays bounded", () => {
  const g = graph();
  const rec = createRecorder({ session: once(g) });
  rec.start(5);
  const [w] = g.watchers;
  const push = (/** @type {number} */ oid) => w({ oid: BigInt(oid), typeName: API + "Zone", fields: {} }, { [`string ${API}Zone::Name`]: "Z" }, 5);
  for (let i = 0; i < MAX_OBJECTS; i++) { push(i); push(i); }
  push(MAX_OBJECTS); push(MAX_OBJECTS);
  const r = rec.read();
  assert.equal(r.same, MAX_OBJECTS, "each noted object's repeat counted");
  assert.equal(r.updates + r.more, MAX_OBJECTS + 2, "the object past the bound kept both times");
  assert.equal(r.untracked, 2, "and said");
  rec.stop("test over");
  // what is held at the start leaves the queue out, and half the bound for what comes later
  const h = graph();
  for (let i = 100; i < MAX_OBJECTS + 100; i++) h.objects.set(String(i), { oid: BigInt(i), typeName: API + "QueueItem", loaded: true, fields: {} });
  for (let i = 2000; i < MAX_OBJECTS + 2000; i++) h.objects.set(String(i), { oid: BigInt(i), typeName: API + "Endpoint", loaded: true, fields: {} });
  h.objects.set("10", { oid: 10n, typeName: API + "Zone", loaded: true, fields: { [`string ${API}Zone::Name`]: "Z" } });
  const rec2 = createRecorder({ session: once(h) });
  rec2.start(5);
  const [x] = h.watchers;
  x({ oid: 2001n, typeName: API + "Endpoint", fields: {} }, { [`string ${API}Endpoint::Name`]: "E" }, 5);   // held
  x({ oid: 1n, typeName: API + "Zone", fields: {} }, { [`string ${API}Zone::Name`]: "Z" }, 5);               // come later
  x({ oid: 1n, typeName: API + "Zone", fields: {} }, { [`string ${API}Zone::Name`]: "Z" }, 5);
  const r2 = rec2.read();
  assert.deepEqual(r2.pushes.map((p) => p.first), ["held", "new"]);
  assert.deepEqual([r2.same, r2.untracked], [1, 0], "what came later is known, not untracked");
  rec2.stop("test over");
});

test("t5, the review: values compared whole as pushed, not as described; WaveformData a zone's tick, and a zone's only", () => {
  const g = graph();
  const rec = createRecorder({ session: once(g) });
  rec.start(5);
  const [w] = g.watchers;
  const push = (/** @type {string} */ type, /** @type {number} */ oid, /** @type {Record<string, any>} */ m) =>
    w({ oid: BigInt(oid), typeName: API + type, fields: {} }, Object.fromEntries(Object.entries(m).map(([k, v]) => [`x ${API}${type}::${k}`, v])), 5);
  push("DspConfig", 1, { Blob: Buffer.from("aa", "hex") });
  push("DspConfig", 1, { Blob: Buffer.from("bb", "hex") });            // same length, so the same described: kept
  push("DspConfig", 1, { Blob: Buffer.from("bb", "hex") });            // same
  push("Zone", 2, { Name: "Z", WaveformData: Buffer.from("01", "hex") });
  push("Zone", 2, { Name: "Z", WaveformData: Buffer.from("02", "hex") });   // a zone's tick moved: same
  push("Endpoint", 3, { SeekPosition: 1n });
  push("Endpoint", 3, { SeekPosition: 2n });                           // not a zone: a change, kept
  w({ oid: 4n, typeName: API + "DspConfig", fields: {} }, { $items: [1, 2] }, 5);
  w({ oid: 4n, typeName: API + "DspConfig", fields: {} }, { $items: [1, 3] }, 5);   // a list's items: said
  const r = rec.read();
  assert.deepEqual([r.updates, r.same], [7, 2]);
  assert.deepEqual(r.pushes.map((p) => p.changed), [undefined, ["Blob"], undefined, undefined, ["SeekPosition"], undefined, ["$items"]]);
  assert.deepEqual(r.pushes[6].items, { count: 2, first: [1, 3] });
  rec.stop("test over");
});

test("t5, the review: a member changing on every update for long is learned as a tick, said; a quick burst is not", () => {
  const g = graph();
  let t = 0;
  const rec = createRecorder({ session: once(g), now: () => t });
  rec.start(15);
  const [w] = g.watchers;
  const push = (/** @type {number} */ oid, /** @type {number} */ v) => w({ oid: BigInt(oid), typeName: API + "Transport", fields: {} }, { [`int ${API}Transport::Remaining`]: v }, 5);
  for (let i = 0; i < 40; i++) { push(1, i); t += 100; }                   // a burst, 4 s: each kept
  t = 0;
  for (let i = 0; i <= TICK_AFTER + 5; i++) { push(2, i); t += 1000; }      // a countdown, once a second
  t = 0;
  for (let i = 0; i < 3 * TICK_AFTER; i++) { push(3, i - (i % 20 === 19 ? 1 : 0)); t += 1000; }   // unchanged now and then: never
  t = 0;
  for (let i = 0; i < TICK_AFTER; i++) { push(4, i); t += 50; }            // a slider dragged,
  t += TICK_SPAN_MS + TICK_GAP_MS; push(4, -1);                             // left, and moved once: never
  t = 0;
  for (let i = 0; i < 3 * TICK_AFTER; i++) {                                // left out of one update in ten: never
    if (i % 10 === 9) w({ oid: 5n, typeName: API + "Transport", fields: {} }, { [`int ${API}Transport::Other`]: i }, 5);
    else push(5, i);
    t += 1000;
  }
  const r = rec.read();
  assert.equal(TICK_SPAN_MS <= TICK_AFTER * 1000, true);
  assert.deepEqual(r.ticking.map((x) => [x.member, x.afterS]), [["Remaining", TICK_AFTER]]);
  assert.equal(r.pushes.filter((p) => p.object.endsWith("1\"")).length, 40, "the burst kept whole");
  assert.equal(r.pushes.filter((p) => p.object.endsWith("2\"")).length, TICK_AFTER + 1, "the countdown counted once learned");
  assert.equal(r.same, 5 + 4, "the countdown's after it was learned, and the other's repeats");
  assert.equal(r.pushes.filter((p) => p.object.endsWith("4\"")).length, TICK_AFTER + 1, "the slider's every move kept");
  // past MAX_TICKING learned, the rest are counted
  t = 0;
  for (let i = 0; i <= TICK_AFTER + 1; i++) { for (let oid = 100; oid < 100 + MAX_TICKING; oid++) push(oid, i); t += 1000; }
  assert.deepEqual([rec.read().ticking.length, rec.read().tickingMore], [MAX_TICKING, 1]);
  rec.stop("test over");
});

// v1.9.66-t8 (§15.8): the owner's DSP recording, taps on Headroom, as its two objects were (DspConfigItem 1335848,
// here a DspFilter: since t9 a DspConfigItem is known whole, §15.9, and said as dropped — the last test below;
// DspConfig 1344089). Built here: what the server sends for an item turned off is what the next recording is to show.
test("t8, THE one: an update of a type not known whole that leaves a member out is kept, said — not counted the same", () => {
  const g = new ObjectGraph();
  const put = (oid, type, fields) => { const o = { oid: BigInt(oid), typeName: type.includes("<") ? type : API + type, loaded: true, fields }; g.objects.set(String(oid), o); return o; };
  const m = (type, f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [`x ${API}${type}::${k}`, v]));
  const list = (oid, items) => put(oid, "DataList<string>", { $count: items.length, $items: items });
  list(500, ["peq", "convolution"]);
  const item = put(1335848, "DspFilter", m("DspFilter", { SupportsSetEnabled: true, HeadroomAdjustment: { $ref: 9n } }));   // off when started
  const cfg = put(1344089, "DspConfig", m("DspConfig", { IsEnabled: true, AddItemTypes: { $ref: 500n } }));
  const zoneObj = put(10, "Zone", m("Zone", { ZoneId: Buffer.from("16aa", "hex"), Name: "TV Speaker", CrossFade: 10 }));
  const rec = createRecorder({ session: once(g) });
  rec.start(5);
  const [w] = g.watchers;
  const on = m("DspFilter", { SupportsSetEnabled: true, IsEnabled: true, HeadroomAdjustment: { $ref: 9n } });
  const off = m("DspFilter", { SupportsSetEnabled: true, HeadroomAdjustment: { $ref: 9n } });
  w(item, on, 5);                                                                    // on: changed
  list(501, ["peq", "convolution"]);
  w(cfg, m("DspConfig", { IsEnabled: true, AddItemTypes: { $ref: 501n } }), 5);      // its first update: kept, nothing changed
  list(503, ["peq", "convolution"]);
  w(cfg, m("DspConfig", { IsEnabled: true, AddItemTypes: { $ref: 503n } }), 5);      // the list sent anew, the same: same
  w(item, off, 5);                                                                   // off: left out, said
  w(item, on, 5);                                                                    // on again: back, said
  w(item, off, 5);                                                                   // off again: said
  w(item, off, 5);                                                                   // and once more: same
  list(502, ["peq"]);
  w(cfg, m("DspConfig", { IsEnabled: true, AddItemTypes: { $ref: 502n } }), 5);      // the list's content changed: kept
  w(zoneObj, m("Zone", { CrossFade: 8 }), 5);                                         // a Zone's partial update: never leftOut
  const r = rec.read();
  assert.deepEqual(r.pushes.map((p) => [p.object, p.changed, p.leftOut, p.back]), [
    ["DspFilter \"1335848\"", ["IsEnabled"], undefined, undefined],
    ["DspConfig \"1344089\"", [], undefined, undefined],
    ["DspFilter \"1335848\"", [], ["IsEnabled"], undefined],
    ["DspFilter \"1335848\"", [], undefined, ["IsEnabled"]],
    ["DspFilter \"1335848\"", [], ["IsEnabled"], undefined],
    ["DspConfig \"1344089\"", ["AddItemTypes"], undefined, undefined],
    ["Zone \"TV Speaker\"", ["CrossFade"], undefined, undefined]]);
  assert.deepEqual([r.updates, r.same], [7, 2]);
  assert.deepEqual(r.sameBy, [{ object: "DspConfig \"1344089\"", count: 1 }, { object: "DspFilter \"1335848\"", count: 1 }]);
  assert.equal(r.sameByMore, 0);
  rec.stop("test over");
});

test("t9 (§15.9): a DspConfigItem pushed with its part is whole — turned off it is said dropped, not leftOut", () => {
  const g = new ObjectGraph();
  const f = (k, v) => ({ [`x ${API}DspConfigItem::${k}`]: v });
  const part = f("HeadroomAdjustment", { $ref: 9n });
  const item = { oid: 61n, typeName: API + "DspConfigItem", loaded: true, fields: Object.assign(f("SupportsSetEnabled", true), f("IsEnabled", true), part) };
  g.objects.set("61", item);
  const rec = createRecorder({ session: once(g) });
  rec.start(5);
  const [w] = g.watchers;
  w(item, Object.assign(f("SupportsSetEnabled", true), part), 5);
  const p = rec.read().pushes[0];
  assert.deepEqual([p.identity, p.dropped, p.leftOut], [true, ["IsEnabled"], undefined]);
  rec.stop("test over");
});

test("t8: a list holding references is still compared by which object it is; the objects said the same stay bounded", () => {
  const g = new ObjectGraph();
  const put = (oid, type, fields) => { const o = { oid: BigInt(oid), typeName: API + type, loaded: true, fields }; g.objects.set(String(oid), o); return o; };
  put(600, "DataList<DspConfigItem>", { $count: 1, $items: [{ $ref: 700n }] });
  put(601, "DataList<DspConfigItem>", { $count: 1, $items: [{ $ref: 700n }] });
  const cfg = put(1, "DspConfig", { [`x ${API}DspConfig::Items`]: { $ref: 600n } });
  const rec = createRecorder({ session: once(g) });
  rec.start(5);
  const [w] = g.watchers;
  w(cfg, { [`x ${API}DspConfig::Items`]: { $ref: 601n } }, 5);
  assert.deepEqual(rec.read().pushes.map((p) => p.changed), [["Items"]], "items that are objects: not taken as the same by their oids");
  for (let i = 0; i < MAX_SAME_BY + 3; i++) {
    const o = put(100 + i, "DspConfigItem", { [`x ${API}DspConfigItem::SupportsSetEnabled`]: true });
    w(o, { [`x ${API}DspConfigItem::SupportsSetEnabled`]: true }, 5);
    w(o, { [`x ${API}DspConfigItem::SupportsSetEnabled`]: true }, 5);
  }
  // the review: a type outside the study sending partial updates by turns is the same, not kept each time
  const tr = put(2, "Transport", { [`x ${API}Transport::A`]: 1, [`x ${API}Transport::B`]: 2 });
  for (let i = 0; i < 6; i++) w(tr, { [`x ${API}Transport::${i % 2 ? "B" : "A"}`]: i % 2 ? 2 : 1 }, 5);
  const r = rec.read();
  // new since the start: its first kept, then B come; the four after it the same
  assert.deepEqual(r.pushes.filter((p) => p.object.startsWith("Transport")).length, 2, "its first two only");
  // each object's first update is kept (first), its second the same: MAX_SAME_BY said, the 3 items over and the
  // Transport's 4, come after, counted
  assert.deepEqual([r.sameBy.length, r.sameBy[0].count, r.sameByMore], [MAX_SAME_BY, 1, 7]);
  // counted by object, not by its name as it was then: one named meanwhile is still one, said by its name now
  const named = r.sameBy.length && rec.read();
  const first = g.get(100n);
  first.fields[`string ${API}DspConfigItem::Name`] = "Headroom";
  w(first, { [`x ${API}DspConfigItem::SupportsSetEnabled`]: true }, 5);
  const again = rec.read().sameBy;
  assert.deepEqual([named.sameBy.length, again.length, again[0]], [MAX_SAME_BY, MAX_SAME_BY, { object: "DspConfigItem \"Headroom\" (100)", count: 2 }]);
  rec.stop("test over");
});

// v1.9.66-t11 (§15.11): the DSP items' settings, as the owner's probe showed them (Headroom's part, 1344090; a
// parametric EQ's spec, its bands a list's bytes, as the graph reads one). Built here: how a setting changed is sent is
// what the next recording is to show.
test("t11, THE one: an item's part is recorded, its values in full; one left out said — a PEQ's bands each with its members", () => {
  const g = new ObjectGraph();
  g.types.set(50, { id: 50, name: API + "ParametricEqualizerBand", members: [{ name: `double ${API}ParametricEqualizerBand::FrequencyHz`, propType: P.Double },
    { name: `double ${API}ParametricEqualizerBand::GainDb`, propType: P.Double }] });
  const f = (type, k, v) => ({ [`x ${API}${type}::${k}`]: v });
  const head = { oid: 1344090n, typeName: API + "HeadroomAdjustmentItem", loaded: true,
    fields: Object.assign(f("HeadroomAdjustmentItem", "SupportsGainDb", true), f("HeadroomAdjustmentItem", "GainDb", -3)) };
  g.objects.set("1344090", head);
  // two bands, each an inline value object (marker 1, its type, its length, its sparse members), as readValue reads one
  const band = (hz, db) => { const m = new BinaryWriter().flexInt(1).double(hz).flexInt(2).double(db).flexInt(0).toBuffer();
    return new BinaryWriter().long(1n).integer(50).integer(m.length).bytes(m).toBuffer(); };
  const bands = new BinaryWriter().integer(2).bytes(band(100, 2)).bytes(band(1000, -1.5)).toBuffer();
  const spec = { $type: API + "ParametricEqualizerSpec", [`System.Collections.Generic.IList<${API}ParametricEqualizerBand> ${API}ParametricEqualizerSpec::Bands`]: bands };
  const peq = { oid: 1344111n, typeName: API + "ParametricEqualizerItem", loaded: true, fields: {} };
  g.objects.set("1344111", peq);
  const roon = { oid: 77n, typeName: "Roon.Broker.Api.BS2BItem", loaded: true, fields: f("BS2BItem", "FeedLevelDb", 4.5) };
  g.objects.set("77", roon);
  const list = { oid: 78n, typeName: `${API}DataList<${API}ParametricEqualizerBand>`, loaded: true, fields: { $count: 0, $items: [] } };
  const rec = createRecorder({ session: once(g) });
  rec.start(5);
  const [w] = g.watchers;
  w(head, Object.assign(f("HeadroomAdjustmentItem", "SupportsGainDb", true), f("HeadroomAdjustmentItem", "GainDb", -6)), 5);   // −3 → −6
  w(head, f("HeadroomAdjustmentItem", "SupportsGainDb", true), 5);                                                            // → 0: left out
  w(head, Object.assign(f("HeadroomAdjustmentItem", "SupportsGainDb", true), f("HeadroomAdjustmentItem", "GainDb", -Infinity)), 5);
  w(peq, f("ParametricEqualizerItem", "Spec", spec), 5);
  w(roon, {}, 5);                                                                                                               // a stub: counted
  w(roon, f("BS2BItem", "FeedLevelDb", 6), 5);                                                                                  // the other namespace
  w(list, { $count: 1, $items: [null] }, 5);                                                                                    // a list of bands: not a part
  w(peq, f("ParametricEqualizerItem", "Note", "x".repeat(7000)), 5);                                                            // too long to say
  const r = rec.read();
  assert.deepEqual(r.pushes.slice(0, 5).map((p) => [p.object, p.changed, p.leftOut, p.back, p.values]), [
    ["HeadroomAdjustmentItem \"1344090\"", ["GainDb"], undefined, undefined, { SupportsGainDb: true, GainDb: -6 }],
    ["HeadroomAdjustmentItem \"1344090\"", [], ["GainDb"], undefined, { SupportsGainDb: true }],
    ["HeadroomAdjustmentItem \"1344090\"", ["GainDb"], undefined, ["GainDb"], { SupportsGainDb: true, GainDb: "-Infinity" }],
    ["ParametricEqualizerItem \"1344111\"", ["Spec"], undefined, undefined, { Spec: { $type: "ParametricEqualizerSpec", Bands: { list: "ParametricEqualizerBand",
      count: 2, items: [{ $type: "ParametricEqualizerBand", FrequencyHz: 100, GainDb: 2 }, { $type: "ParametricEqualizerBand", FrequencyHz: 1000, GainDb: -1.5 }] } } }],
    ["BS2BItem \"77\"", ["FeedLevelDb"], undefined, undefined, { FeedLevelDb: 6 }]]);
  assert.equal(r.pushes.some((p) => /DataList/.test(p.object)), false, "a list of bands is not recorded as a part");
  assert.deepEqual(Object.keys(r.pushes[5].values), ["tooLong", "digest"], "a value too long to say: its length and digest");
  rec.stop("test over");
});
