"use strict";
// ---------------------------------------------------------------------------
// Stage 1 (dev/design/roon-native.md §10): the matching (source.js) and the
// switch (stage1.js) — off until turned on, the check after an update, off
// on any failure, the saved sources — with the read, the clock, the settings
// and the saved copy all stood in for. The read itself is in
// roon-direct-stage1-read.test.js.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildIndex, lookup, sourceOf, matchReport, serialise, deserialise } = require("../../lib/roon-direct/source");
const { createStage1 } = require("../../lib/roon-direct/stage1");

const keyOf = (title, artist) => (title ? `${title.toLowerCase()}||${artist.toLowerCase()}` : null);
const A = (title, artist, contentSource, imageKey) => ({ title, artist, contentSource, imageKey: imageKey || null });

// ---- source.js ----------------------------------------------------------------

test("each album's source is its ContentSource, by its exact key", () => {
  const idx = buildIndex([A("Blue", "Joni Mitchell", 1, "k1"), A("Dummy", "Portishead", 128), A("Rocket", "Alex G", 256)], keyOf);
  assert.equal(sourceOf(idx, "blue||joni mitchell"), "local");
  assert.equal(sourceOf(idx, "dummy||portishead"), "tidal");
  assert.equal(sourceOf(idx, "rocket||alex g"), "qobuz");
  assert.equal(sourceOf(idx, ["green||someone"]), null, "not listed at all: no answer");
  assert.equal(sourceOf(null, "blue||joni mitchell"), null);
});

// v1.9.20: matching by title alone was proposed and not taken (the owner: Roon tells the source).
test("only the exact key pairs: an album that shares just its title is not matched, and one without a source answers for no namesake", () => {
  const idx = buildIndex([A("Blue", "Joni Mitchell", 1), A("Rocket", "Alex G", null), A("Rocket", "Other", 256)], keyOf);
  assert.deepEqual(lookup(idx, ["blue||joni"]), { source: null, why: "not listed" }, "THE one: paired by its title alone");
  assert.deepEqual(lookup(idx, ["rocket||alex g"]), { source: null, why: "no source" });
  assert.equal(sourceOf(idx, ["rocket||other"]), "qobuz");
  assert.equal(sourceOf(idx, ["blue||joni mitchell", "blue||joni"]), "local", "the first, exact key only");
});

test("one key, two sources: unknown — Rouen's own inference decides", () => {
  const idx = buildIndex([A("Blue", "Joni Mitchell", 1), A("Blue", "Joni Mitchell", 256)], keyOf);
  assert.equal(sourceOf(idx, "blue||joni mitchell"), null, "THE one: never a coin flip between two sources");
  const same = buildIndex([A("Greatest Hits", "Queen", 256, "a"), A("Greatest Hits", "Queen", 256, "b")], keyOf);
  assert.equal(sourceOf(same, "greatest hits||queen"), "qobuz", "two editions of one source are that source");
  assert.equal(same.entries.get("greatest hits||queen").imageKey, null, "…with no single cover to compare");
});

test("a ContentSource that names no source, or none: no answer for that album", () => {
  const idx = buildIndex([A("X", "Y", 2), A("Z", "Y", null), A("", "Y", 1)], keyOf);
  assert.equal(idx.noSource, 2);
  assert.deepEqual(lookup(idx, "x||y"), { source: null, why: "no source" }, "listed, with no source: not matched");
  assert.deepEqual(lookup(idx, "z||y"), { source: null, why: "no source" });
  assert.equal(idx.entries.size, 2, "an album with no title has no key");
});

test("the report: matched by source, left, two sources, and covers that agree", () => {
  const idx = buildIndex([A("Blue", "Joni", 1, "c1"), A("Dummy", "P", 128, "c2"), A("Twice", "T", 1), A("Twice", "T", 128)], keyOf);
  const r = matchReport([{ keys: ["blue||joni"], imageKey: "c1" }, { keys: ["dummy||p"], imageKey: "zz" }, { keys: ["twice||t"], title: "Twice", artist: "T" },
    { keys: ["nope||n"], title: "Nope", artist: "N" }, { keys: [] }, { keys: ["blue||j. mitchell"], title: "Blue", artist: "J. Mitchell" }], idx);
  const { unmatched, ...counts } = r;
  assert.deepEqual(counts, { albums: 6, matched: 2, bySource: { local: 1, qobuz: 0, tidal: 1 }, twoSources: 1, noSource: 0, notListed: 3,
    left: 4, coverSame: 1, roonAlbums: 4, roonWithoutSource: 0 });
  assert.deepEqual(unmatched[0], { title: "Twice", artist: "T", why: "two sources", sources: ["local", "tidal"],
    sameTitle: [{ artist: "T", source: "local" }, { artist: "T", source: "tidal" }] });
  assert.deepEqual(unmatched[1], { title: "Nope", artist: "N", why: "not listed", sources: undefined, sameTitle: [] });
  assert.deepEqual(unmatched[3].sameTitle, [{ artist: "Joni", source: "local" }], "the Core's album of the same title, beside it");
  assert.equal(r.resolved.get("blue||joni"), "local");
  assert.equal(r.resolved.get("nope||n"), null);
});

test("the saved copy reads back as it was; anything else reads as none", () => {
  const idx = buildIndex([A("Blue", "Joni", 1, "c1"), A("Twice", "T", 1), A("Twice", "T", 128)], keyOf);
  const back = deserialise(JSON.parse(JSON.stringify(serialise(idx))));
  assert.deepEqual([...back.entries], [...idx.entries]);
  assert.equal(deserialise(null), null);
  assert.equal(deserialise({ entries: [["k", "spotify", null]], read: 1 }), null, "a source it does not know is not trusted");
});

// ---- stage1.js ----------------------------------------------------------------

/** A stage 1 with everything stood in for. */
function rig(o = {}) {
  const w = {
    saved: o.saved, cache: o.cache || null, clock: 1000, reads: 0, changes: 0, facts: 0, logs: [],
    core: o.core === undefined ? { host: "10.0.0.2", coreId: "core-1", coreVersion: "2.0 (1500)" } : o.core,
    result: o.result || { ok: true, albums: [A("Blue", "Joni", 1, "c1"), A("Dummy", "P", 128)], count: 2, pages: 1, ms: 40 },
  };
  w.s = createStage1({
    settings: { load: () => w.saved, save: (v) => { w.saved = JSON.parse(JSON.stringify(v)); } },
    cache: { read: () => w.cache, write: (v) => { w.cache = JSON.parse(JSON.stringify(v)); }, remove: () => { w.cache = null; } },
    core: () => w.core, rouenVersion: o.rouenVersion || "1.9.18",
    records: () => [{ keys: ["blue||joni"], imageKey: "c1" }, { keys: ["dummy||p"] }, { keys: ["other||x"] }],
    keyOf, now: () => w.clock, minGapMs: 60000, onChange: () => { w.changes++; }, onFacts: () => { w.facts++; }, log: (l) => w.logs.push(l),
    read: async () => { w.reads++; const r = typeof w.result === "function" ? w.result() : w.result; return r; },
  });
  return w;
}

test("off until turned on: no answer, no read, whatever happens", async () => {
  const w = rig();
  w.s.paired(); w.s.indexChanged();
  await w.s.settled();
  assert.equal(w.reads, 0);
  assert.equal(w.s.sourceOf("blue||joni"), null);
  assert.deepEqual(w.s.status().on, false);
});

test("turned on: reads at once, then answers, and records what it was turned on against", async () => {
  const w = rig();
  w.s.turnOn();
  await w.s.settled();
  assert.equal(w.reads, 1);
  assert.equal(w.s.sourceOf("blue||joni"), "local");
  assert.equal(w.s.sourceOf("dummy||p"), "tidal");
  assert.equal(w.s.active(), true);
  assert.equal(w.saved.on, true);
  assert.equal(w.saved.rouenVersion, "1.9.18");
  assert.equal(w.saved.coreVersion, "2.0 (1500)");
  assert.equal(w.saved.coreId, "core-1");
  assert.ok(w.cache && w.cache.coreId === "core-1", "the sources read are saved");
  assert.ok(w.changes >= 1, "the screens are told");
  const st = w.s.status();
  assert.deepEqual([st.report.matched, st.report.left, st.report.coverSame], [2, 1, 1]);
});

test("turned on with no Core paired: refused, and still off", () => {
  const w = rig({ core: null });
  assert.match(w.s.turnOn().error, /not paired/);
  assert.equal(w.s.status().on, false);
});

test("a failed read falls back to Rouen's own answers, says why, deletes the saved sources, and stays on (v1.9.21)", async () => {
  const w = rig();
  w.s.turnOn();
  await w.s.settled();
  w.result = { ok: false, why: "The Core refused page 3: Busy." };
  w.clock += 120000;
  w.s.indexChanged();
  await w.s.settled();
  const st = w.s.status();
  assert.equal(st.on, true, "THE one: a failure switched it off, where the next read could have put it right");
  assert.deepEqual(st.fellBack, { why: "The Core refused page 3: Busy.", at: w.clock });
  assert.equal(st.offReason, null);
  assert.equal(w.cache, null);
  assert.equal(w.s.sourceOf("blue||joni"), null, "Rouen's own answers again");
  assert.equal(w.s.albums(), null, "the official API's list again");
  w.result = { ok: true, albums: [A("Blue", "Joni", 1)], count: 1, pages: 1, ms: 5 };
  w.clock += 120000;
  w.s.indexChanged();
  await w.s.settled();
  assert.equal(w.reads, 3, "the next library change reads again");
  assert.equal(w.s.status().fellBack, null);
  assert.equal(w.s.sourceOf("blue||joni"), "local");
});

test("a read that throws is a failure like any other", async () => {
  const w = rig();
  w.result = () => { throw new Error("socket hang up"); };
  w.s.turnOn();
  await w.s.settled();
  assert.equal(w.s.status().fellBack.why, "socket hang up");
});

test("library changes read again, but not more often than the gap", async () => {
  const w = rig();
  w.s.turnOn();
  await w.s.settled();
  w.clock += 1000;
  w.s.indexChanged();
  await w.s.settled();
  assert.equal(w.reads, 1, "within the gap: not yet");
  w.clock += 60000;
  w.s.indexChanged();
  await w.s.settled();
  assert.equal(w.reads, 2);
});

test("a restart on the same versions uses the saved sources once paired, before any read", async () => {
  const first = rig();
  first.s.turnOn();
  await first.s.settled();
  const w = rig({ saved: first.saved, cache: first.cache });
  assert.equal(w.s.sourceOf("blue||joni"), null, "THE one: not before pairing — the Core may have been updated");
  let release;
  w.result = () => new Promise((r) => { release = () => r(first.result); });
  w.s.paired();
  assert.equal(w.s.sourceOf("blue||joni"), "local", "paired, nothing updated: the saved sources at once");
  assert.equal(w.reads, 1, "…while the read after pairing (§10.2) runs");
  release();
  await w.s.settled();
});

test("an update found at pairing while a read runs: that read is not the check", async () => {
  const w = rig();
  w.s.turnOn();
  await w.s.settled();                                 // a read done: the gap now counts
  w.clock += 60000;
  let release;
  w.result = () => new Promise((r) => { release = r; });
  w.s.indexChanged();                                  // a second read, under way…
  assert.equal(w.reads, 2);
  w.core = { host: "10.0.0.2", coreId: "core-1", coreVersion: "2.0 (1600)" };
  w.s.paired();                                        // …when pairing finds the Core updated
  const running = release;
  w.result = { ok: false, why: "3 message(s) from the Core could not be read." };
  running({ ok: true, albums: [A("Blue", "Joni", 1)], count: 1, pages: 1, ms: 5 });
  await w.s.settled();
  assert.equal(w.reads, 3, "the check did not run at once: it waited out the gap");
  const st = w.s.status();
  assert.equal(st.on, false);
  assert.match(st.offReason, /^Your server updated from 2\.0 \(1500\) to 2\.0 \(1600\), and the check that followed failed: 3 message/,
    "THE one: the read started before the update passed as its check");
});

test("a second update found while the first one's check runs: checked again at once, not after the gap", async () => {
  const w = rig();
  w.s.turnOn();
  await w.s.settled();
  w.clock += 1000;                                     // well within the gap
  let release;
  w.result = () => new Promise((r) => { release = r; });
  w.core = { host: "10.0.0.2", coreId: "core-1", coreVersion: "2.0 (1600)" };
  w.s.paired();
  w.core = { host: "10.0.0.2", coreId: "core-1", coreVersion: "2.0 (1700)" };
  w.s.paired();
  const running = release;
  w.result = { ok: true, albums: [A("Blue", "Joni", 1)], count: 1, pages: 1, ms: 5 };
  running({ ok: true, albums: [A("Blue", "Joni", 1)], count: 1, pages: 1, ms: 5 });
  await w.s.settled();
  assert.equal(w.reads, 3, "THE one: the check waited out the gap, its sources set aside all the while");
  assert.equal(w.saved.coreVersion, "2.0 (1700)");
  assert.equal(w.s.sourceOf("blue||joni"), "local");
});

test("turned off and on again while a read runs: a fresh read follows at once", async () => {
  const w = rig();
  let release;
  w.result = () => new Promise((r) => { release = r; });
  w.s.turnOn();
  w.s.turnOff();
  w.s.turnOn();
  w.result = { ok: true, albums: [A("Blue", "Joni", 1)], count: 1, pages: 1, ms: 5 };
  release({ ok: true, albums: [A("Blue", "Joni", 128)], count: 1, pages: 1, ms: 5 });
  await w.s.settled();
  assert.equal(w.reads, 2, "the read asked for by turning it on again waited out the gap");
  assert.equal(w.s.sourceOf("blue||joni"), "local");
});

test("a Core whose address Rouen does not know: refused at the switch, and off with why when it pairs", async () => {
  const w = rig({ core: { host: null, coreId: "core-1", coreVersion: "2.0" } });
  assert.match(w.s.turnOn().error, /address/);
  const first = rig();
  first.s.turnOn();
  await first.s.settled();
  const v = rig({ saved: first.saved, cache: first.cache, rouenVersion: "1.9.19", core: { host: null, coreId: "core-1", coreVersion: "2.0 (1500)" } });
  v.s.paired();
  await v.s.settled();
  assert.equal(v.s.status().on, false);
  assert.match(v.s.status().offReason, /address/);
});

test("after a Rouen update: the saved sources are set aside, and a read checks it", async () => {
  const first = rig();
  first.s.turnOn();
  await first.s.settled();
  const w = rig({ saved: first.saved, cache: first.cache, rouenVersion: "1.9.19" });
  assert.equal(w.s.sourceOf("blue||joni"), null, "THE one: nothing from before the update is used until it is checked");
  assert.match(w.s.status().checking, /^Rouen updated from 1\.9\.18 to 1\.9\.19$/);
  w.s.paired();
  await w.s.settled();
  const st = w.s.status();
  assert.equal(st.on, true, "the check passed: it stays on");
  assert.equal(st.checking, null);
  assert.match(st.checked.after, /Rouen updated from 1\.9\.18 to 1\.9\.19/);
  assert.equal(w.saved.rouenVersion, "1.9.19");
  assert.equal(w.s.sourceOf("blue||joni"), "local");
});

test("after a Roon Core update: a failed check turns it off, naming the update", async () => {
  const first = rig();
  first.s.turnOn();
  await first.s.settled();
  const w = rig({ saved: first.saved, cache: first.cache });
  w.core = { host: "10.0.0.2", coreId: "core-1", coreVersion: "2.0 (1600)" };
  w.result = { ok: false, why: "3 message(s) from the Core could not be read: Roon may have changed its protocol." };
  w.s.paired();
  assert.equal(w.s.sourceOf("blue||joni"), null, "set aside while the check runs");
  await w.s.settled();
  const st = w.s.status();
  assert.equal(st.on, false);
  assert.match(st.offReason, /^Your server updated from 2\.0 \(1500\) to 2\.0 \(1600\), and the check that followed failed: 3 message/);
});

test("paired with a different Core: checked like an update", async () => {
  const first = rig();
  first.s.turnOn();
  await first.s.settled();
  const w = rig({ saved: first.saved, cache: first.cache });
  w.core = { host: "10.0.0.9", coreId: "core-2", coreVersion: "2.0 (1500)" };
  w.s.paired();
  assert.match(w.s.status().checking, /different server/);
  await w.s.settled();
  assert.equal(w.saved.coreId, "core-2");
});

test("turned off while a read runs: what it read is not used", async () => {
  const w = rig();
  let release;
  w.result = () => new Promise((r) => { release = () => r({ ok: true, albums: [A("Blue", "Joni", 1)], count: 1, pages: 1, ms: 1 }); });
  w.s.turnOn();
  w.s.turnOff();
  release();
  await w.s.settled();
  assert.equal(w.s.sourceOf("blue||joni"), null);
  assert.equal(w.cache, null);
  assert.equal(w.s.status().offReason, null, "turned off by hand: no reason to show");
});

test("the albums not matched, each with why, for the page's list (v1.9.20)", async () => {
  const w = rig();
  w.s.turnOn();
  await w.s.settled();
  const list = w.s.unmatched();
  assert.equal(list.length, 1);
  assert.equal(list[0].why, "not listed");
  assert.equal(w.s.status().report.unmatched.length, 1);
  w.s.turnOff();
  assert.deepEqual(w.s.unmatched(), [], "off: nothing to list");
});

test("a saved copy from before v1.9.20 (no titles) reads as none, and the next read replaces it", () => {
  assert.equal(deserialise({ read: 1, noSource: 0, entries: [["blue||joni", "local", "c1"]] }), null);
});

test("v1.9.70-t5 (the review): the same list read again keeps the objects the records hold, with what the read says of each", async () => {
  const w = rig();
  w.result = () => ({ ok: true, albums: [Object.assign(A("Blue", "Joni", 1, "c1"), { favorite: w.reads > 1, genres: ["Folk"] }), A("Dummy", "P", 128)],
    count: 2, pages: 1, ms: 40 });
  w.s.turnOn();
  await w.s.settled();
  const held = w.s.albums()[0];   // as library.js's records hold it
  const before = [w.changes, w.s.factsRev()];
  w.clock += 60000;
  w.s.indexChanged();
  await w.s.settled();
  assert.equal(w.reads, 2);
  assert.equal(w.s.albums()[0], held, "THE one: the object the records hold is still the one in force");
  assert.equal(held.favorite, true, "with the read's favourite on it");
  assert.equal(w.changes, before[0], "the same list: the screens are not redone");
  assert.deepEqual([w.s.factsRev(), w.facts], [before[1] + 1, 1], "a favourite moved: counted, and the Shelf told");
  w.clock += 60000;
  w.s.indexChanged();
  await w.s.settled();
  assert.deepEqual([w.s.factsRev(), w.facts], [before[1] + 1, 1], "nothing moved: nothing counted");
});
