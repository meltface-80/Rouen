"use strict";
// ---------------------------------------------------------------------------
// v1.9.67-t2 (lib/release-lookup.js): which albums the label scan asks Discogs
// about for a catalogue number, where the answer is kept, and the memory of who
// has been asked. The pass itself: labels-discogs-pass.test.js.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createReleaseLookup } = require("../../lib/release-lookup");
const { createReleaseFacts } = require("../../lib/release-facts");

const normalize = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const keysOf = (al) => al.srcKeys && al.srcKeys.length ? al.srcKeys : [normalize(al.title) + "|" + normalize(al.subtitle)];
const labelKey = (al) => normalize(al.title) + "||" + normalize(al.subtitle);

test("needing — an album with no catalogue number from any source, not yet asked about; one with a number, or asked, is left out", () => {
  const facts = createReleaseFacts();
  facts.set(keysOf({ title: "Tagged", subtitle: "A" })[0], { catno: "WARP 61", type: "album" }, "file");
  facts.set(keysOf({ title: "Typed only", subtitle: "A" })[0], { catno: null, type: "ep" }, "file");
  const lookup = createReleaseLookup({ facts, keysOf, labelKey });
  lookup.load(["asked||a", "", null]);
  const albums = [{ title: "Tagged", subtitle: "A" }, { title: "Typed only", subtitle: "A" }, { title: "Asked", subtitle: "A" }, { title: "Fresh", subtitle: "A" }];
  assert.deepEqual(lookup.needing(albums).map((al) => al.title), ["Typed only", "Fresh"],
    "a kind without a number still wants the number; a number from the tags does not; an album already answered about does not");
  assert.equal(lookup.size(), 1);
});

test("keep — under the album's keys, ranked below a tag, filling what the tag left empty; mark and clear keep the database in step", () => {
  const facts = createReleaseFacts();
  facts.set(keysOf({ title: "Typed", subtitle: "A" })[0], { catno: null, type: "album" }, "file");
  const saved = [], removed = [];
  const lookup = createReleaseLookup({ facts, keysOf, labelKey, save: (k, at) => saved.push([k, at]), remove: () => removed.push(1), now: () => 777 });
  lookup.keep({ title: "Typed", subtitle: "A" }, { catno: "D-1", types: ["ep"] });
  assert.deepEqual(facts.forKeys(keysOf({ title: "Typed", subtitle: "A" })), { catno: "D-1", type: "album", types: ["album"], src: "file" },
    "THE one (the review): the tag's kind stays, Discogs' number fills the gap the tag left");
  lookup.keep({ title: "Untagged", subtitle: "A", srcKeys: ["k-src-1", "k-src-2"] }, { catno: "D-2", types: ["ep"] });
  assert.deepEqual(facts.forKeys(["k-src-2"]), { catno: "D-2", type: "ep", types: ["ep"], src: "discogs" }, "under every key the lookup reads (the badge's srcKeys when the record has them)");
  lookup.mark("untagged||a");
  assert.ok(lookup.has("untagged||a"));
  assert.deepEqual(saved, [["untagged||a", 777]]);
  lookup.clear();
  assert.equal(lookup.size(), 0);
  assert.equal(removed.length, 1);
});
