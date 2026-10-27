"use strict";
// v1.9.67-t4 (lib/roon-releases.js): what Rouen keeps of a walk of Roon's edit info — the cache's "roon" layer
// replaced whole, Roon's labels for the albums that have none, in one transaction; since v1.9.68-t3 a walk's parts
// kept as it goes, nothing dropped until a whole pass.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createRoonReleases } = require("../../lib/roon-releases");
const { createReleaseFacts } = require("../../lib/release-facts");

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const keysOf = (t, a) => [norm(t) + "|" + norm(a), norm(t)];   // a shared second key, as the badge's keys share one
const labelKey = (t, a) => norm(t) + "||" + norm(a);

function rig(o = {}) {
  const facts = createReleaseFacts();
  const known = new Map(o.known || []);
  const set = [], events = [], tx = [];
  const rr = createRoonReleases({
    facts, keysOf, labelKey, labelOf: (t, a) => known.get(labelKey(t, a)) || null, setLabel: (k, l) => set.push([k, l]),
    isLabel: (s) => !/management/i.test(s), labelsOn: () => o.labelsOn !== false,
    transaction: (fn) => { tx.push("begin"); fn(); tx.push("commit"); }, onLabels: () => events.push("labels"), onChange: () => events.push("change"),
  });
  return { rr, facts, set, events, tx };
}
const rec = (title, catno, types, labels = []) => ({ title, artist: "A", catno, types, labels });

test("THE one: kept whole under every key; a record that says nothing takes no key, so a sibling under a shared key is not shadowed and a stale number is dropped next walk", () => {
  const w = rig();
  let out = w.rr.keep([rec("Blue", "R-1", ["album", "live"]), rec("Blue (Deluxe)", null, [])], true);
  assert.deepEqual(out, { kept: 2, labelled: 0 }, "two keys of the one record that says something");
  assert.deepEqual(w.facts.get(norm("Blue")), { catno: "R-1", type: "live", types: ["album", "live"], src: "roon" });
  assert.deepEqual(w.tx, ["begin", "commit"]);
  assert.deepEqual(w.events, ["change"]);
  // Two editions: the empty one first must not claim the shared key.
  out = w.rr.keep([rec("Blue", null, []), rec("Blue", "R-2", ["album"])], true);
  assert.equal(w.facts.get(norm("Blue")).catno, "R-2", "the edition with something wins the shared key");
  // The owner clears the number in Roon: the next walk says nothing of it, and the old number goes (the review).
  out = w.rr.keep([rec("Blue", null, [])], true);
  assert.equal(w.facts.get(norm("Blue")), null, "a key no record of the walk fills is dropped from the layer");
  assert.equal(out.kept, 2);
});

test("labels: the first of Roon's that is a label, only where Rouen has none, only with Labels on; a walk cut short keeps nothing", () => {
  const w = rig({ known: [[labelKey("Known", "A"), "Warp"]] });
  const out = w.rr.keep([rec("Known", null, ["album"], ["Columbia"]), rec("Fresh", null, ["album"], ["XYZ Management", "Cruces Music"]), rec("None", null, ["ep"], [])], true);
  assert.deepEqual(w.set, [[labelKey("Fresh", "A"), "Cruces Music"]], "never over a label known; the first that is plainly a label");
  assert.deepEqual(out, { kept: 6, labelled: 1 });
  assert.deepEqual(w.events, ["labels", "change"]);
  const off = rig({ labelsOn: false });
  off.rr.keep([rec("Fresh", "R-9", ["album"], ["Cruces Music"])], true);
  assert.deepEqual(off.set, [], "Labels off: none of it runs; the number and kind still kept");
  assert.equal(off.facts.get(norm("Fresh")).catno, "R-9");
});

test("part of a walk is kept as it goes, nothing dropped; the whole pass at the end drops what Roon no longer says (v1.9.68-t3)", () => {
  const w = rig();
  w.rr.keep([rec("Old", "R-1", ["album"])], true);
  // a later walk, cut short after its first part: kept, written over its own, and Old not dropped
  assert.deepEqual(w.rr.keep([rec("Fresh", "R-9", ["album"], ["Cruces Music"])], false), { kept: 2, labelled: 1 });
  assert.equal(w.facts.get(norm("Fresh")).catno, "R-9");
  assert.equal(w.facts.get(norm("Old")).catno, "R-1", "a part says nothing of the albums it did not reach");
  assert.deepEqual(w.tx, ["begin", "commit", "begin", "commit"], "each part in one transaction");
  // the same part again: nothing changed
  assert.deepEqual(w.rr.keep([rec("Fresh", "R-9", ["album"])], false), { kept: 0, labelled: 0 });
  // the whole pass, which no longer names Old
  w.rr.keep([rec("Fresh", "R-9", ["album"])], true);
  assert.equal(w.facts.get(norm("Old")), null, "dropped once a whole pass has not named it");
});
