"use strict";
// ---------------------------------------------------------------------------
// v1.9.67-t2 (lib/labels-discogs-pass.js): the label scan's Discogs pass, with
// its second queue — the albums whose tags gave no catalogue number. A miss is
// remembered so no album is asked about twice; an error is not, so it is asked
// again next scan; ten errors in a row end the pass; five minutes a scan.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { runDiscogsPass } = require("../../lib/labels-discogs-pass");

function harness(answers, opts = {}) {
  const got = { labels: [], releases: [], tried: [], log: [], progress: [] };
  let clock = 0;
  const d = {
    release: async (title) => { if (opts.tick) clock += opts.tick; const a = answers[title]; if (a instanceof Error) throw a; return a === undefined ? null : a; },
    onLabel: async (key, label) => { got.labels.push([key, label]); },
    onRelease: (al, rel) => { got.releases.push([al.title, rel]); },
    tried: (key) => got.tried.push(key),
    progress: (done, total) => got.progress.push(done + "/" + total),
    log: (line) => got.log.push(line),
    now: () => clock,
    limitMs: opts.limitMs,
  };
  return { d, got };
}
const item = (title, wantLabel = true) => ({ al: { title, subtitle: "Artist" }, key: title.toLowerCase() + "||artist", wantLabel });

test("THE one: a label miss gets its label, number and kind from one answer; an album with a label gets the number alone; a miss is tried, an error is not", async () => {
  const { d, got } = harness({
    "Unlabelled": { label: "Warp Records", catno: "WARP 61", types: ["album"] },
    "Labelled": { label: "Other Label", catno: "ZIQ028", types: ["ep"] },
    "Nowhere": null,
    "Named only": { label: null, catno: null, types: [] },
    "Broken": new Error("HTTP 500"),
  });
  const out = await runDiscogsPass([item("Unlabelled"), item("Labelled", false), item("Nowhere", false), item("Named only"), item("Broken", false)], d);
  assert.deepEqual(got.labels, [["unlabelled||artist", "Warp Records"]], "the label kept for the label miss only: the labelled album's label is not Discogs' to change");
  assert.deepEqual(got.releases, [["Unlabelled", { catno: "WARP 61", types: ["album"] }], ["Labelled", { catno: "ZIQ028", types: ["ep"] }]]);
  assert.deepEqual(got.tried, ["unlabelled||artist", "labelled||artist", "nowhere||artist", "named only||artist"], "answered, with something or nothing: tried; the error: not");
  assert.deepEqual(out, { done: 5, labels: 1, releases: 2, errors: 1, aborted: "" });
  assert.equal(got.progress[4], "5/5");
  assert.match(got.log[0], /pass 4 \(Discogs\): 5 albums \(3 for a catalogue number only\)/);
  assert.match(got.log[got.log.length - 1], /complete, 2 catalogue numbers or kinds kept, 1 errors total/);
});

test("ten errors in a row end the pass; the rest wait for the next scan", async () => {
  const answers = {};
  const queue = [];
  for (let i = 0; i < 12; i++) { answers["E" + i] = new Error("HTTP 429"); queue.push(item("E" + i, false)); }
  const { d, got } = harness(answers);
  const out = await runDiscogsPass(queue, d);
  assert.equal(out.aborted, "errors");
  assert.equal(out.done, 10, "the eleventh was never asked");
  assert.deepEqual(got.tried, [], "nothing is remembered as tried");
  assert.match(got.log[1], /10 consecutive errors — aborting/);
  assert.match(got.log[2], /complete \(aborted\)/);
});

test("the time limit: five minutes a scan, then the remainder next time; a good answer resets the error count", async () => {
  const answers = { A: null, B: new Error("x"), C: null, D: null };
  const { d, got } = harness(answers, { tick: 2 * 60 * 1000, limitMs: 5 * 60 * 1000 });
  const out = await runDiscogsPass([item("A", false), item("B", false), item("C", false), item("D", false)], d);
  assert.equal(out.aborted, "time");
  assert.equal(out.done, 3, "A at 2 min, B at 4, C at 6: over the limit after C");
  assert.deepEqual(got.tried, ["a||artist", "c||artist"]);
  assert.match(got.log[1], /5-minute time limit reached/);
});

test("an empty queue: nothing asked, nothing logged", async () => {
  const { d, got } = harness({});
  assert.deepEqual(await runDiscogsPass([], d), { done: 0, labels: 0, releases: 0, errors: 0, aborted: "" });
  assert.deepEqual(got.log, []);
});
