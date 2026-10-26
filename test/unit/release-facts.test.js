"use strict";
// ---------------------------------------------------------------------------
// v1.9.67 (lib/release-facts.js): an album's catalogue number and kind of
// release, read from its files' tags and kept by album key — what the Shelf's
// spine, its Labels/Types tiles and its label order, and the Library's Album
// type focus and label sort are built on. Nothing is guessed from a tag that
// says nothing.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { releaseType, catalogueNumber, compareCatalogue, createReleaseFacts, TYPES, TYPE_NAMES, KINDS } = require("../../lib/release-facts");

test("releaseType — MusicBrainz's primary and secondary types, as Picard and beets write them; iTunes' compilation flag", () => {
  assert.equal(releaseType({ releasetype: ["album"] }), "album");
  assert.equal(releaseType({ releasetype: ["EP"] }), "ep");
  assert.equal(releaseType({ releasetype: "single" }), "single");
  assert.equal(releaseType({ releasetype: ["album", "compilation"] }), "compilation", "a secondary type says more than the primary");
  assert.equal(releaseType({ releasetype: ["album; live"] }), "live", "Picard's one string, separated");
  assert.equal(releaseType({ releasetype: ["Album/Soundtrack"] }), "soundtrack");
  assert.equal(releaseType({ releasetype: ["album", "dj-mix"] }), "remix");
  assert.equal(releaseType({ releasetype: ["broadcast"] }), "other");
  assert.equal(releaseType({ releasetype: ["lp"] }), "album");
  assert.equal(releaseType({ compilation: true }), "compilation", "iTunes' flag alone");
  assert.equal(releaseType({ releasetype: ["single"], compilation: true }), "single", "a RELEASETYPE outranks the flag");
  assert.equal(releaseType({ releasetype: ["interview"] }), null, "a kind Rouen doesn't show is not guessed at");
  assert.equal(releaseType({}), null);
  assert.equal(releaseType(null), null);
  assert.deepEqual(TYPES.map(([id]) => id), ["album", "ep", "single", "compilation", "live", "soundtrack", "remix", "other"]);
  assert.equal(TYPE_NAMES.ep, "EP");
  assert.deepEqual(KINDS[1], { id: "ep", one: "EP", many: "EPs" }, "the kinds as the Shelf is sent them");
});

test("catalogueNumber — the tag as written, tidied; nothing for a tag that says there is none", () => {
  assert.equal(catalogueNumber({ catalognumber: ["WARP 61"] }), "WARP 61");
  assert.equal(catalogueNumber({ catalognumber: "  ZIQ028\t" }), "ZIQ028");
  assert.equal(catalogueNumber({ catalognumber: ["", "HDBCD002"] }), "HDBCD002", "the first value that says something");
  assert.equal(catalogueNumber({ catalognumber: ["1C  064-82\n306"] }), "1C 064-82 306", "one line, one space between its parts");
  assert.equal(catalogueNumber({ catalognumber: ["none"] }), null);
  assert.equal(catalogueNumber({ catalognumber: ["N/A"] }), null);
  assert.equal(catalogueNumber({ catalognumber: ["x".repeat(41)] }), null, "a tag that isn't a number");
  assert.equal(catalogueNumber({}), null);
  assert.equal(catalogueNumber(undefined), null);
});

test("compareCatalogue — a shop's order: numbers as numbers, case alike", () => {
  const sorted = ["WARP 123", "warp 61", "WAP 105", "ZIQ110", "ZIQ028", "KOMPAKT 410", "KOMPAKT 150"].sort(compareCatalogue);
  assert.deepEqual(sorted, ["KOMPAKT 150", "KOMPAKT 410", "WAP 105", "warp 61", "WARP 123", "ZIQ028", "ZIQ110"]);
});

test("the cache — one record per key and source, read fact by fact from the best source that has it; a tie keeps the first; saved, loaded and cleared", () => {
  const saved = [], removed = [];
  const rf = createReleaseFacts({ save: (k, f) => saved.push([k, f.src]), remove: (s) => removed.push(s) });
  assert.equal(rf.set("k1", { catno: "WARP 61", type: "album" }, "file"), true);
  assert.equal(rf.set("k1", { catno: "WARP 61 (disc 2)", type: "album" }, "file"), false, "a tie keeps the first writer (a set's second disc)");
  assert.equal(rf.set("k1", { catno: "D-123", type: "ep" }, "discogs"), false, "a Discogs match changes nothing a tag has said");
  assert.deepEqual(rf.get("k1"), { catno: "WARP 61", type: "album", src: "file" });
  assert.equal(rf.set("k2", { catno: "D-9", type: null }, "discogs"), true);
  assert.equal(rf.set("k2", { catno: null, type: "ep" }, "roon"), true, "Roon's kind beside Discogs' number");
  assert.deepEqual(rf.get("k2"), { catno: "D-9", type: "ep", src: "roon" }, "each fact from the best source that has it; src the best that gave one");
  assert.equal(rf.set("k2", { catno: "FILE-2", type: null }, "file"), true, "a tag's number over Discogs' (the review: a tag with a kind but no number must not shut a number out)");
  assert.deepEqual(rf.get("k2"), { catno: "FILE-2", type: "ep", src: "file" });
  assert.equal(rf.set("k3", { catno: "", type: "sideways" }, "file"), false, "nothing to keep: an empty number and a kind Rouen hasn't");
  assert.equal(rf.get("k3"), null);
  assert.equal(rf.set("", { catno: "x" }, "file"), false);
  assert.deepEqual(rf.forKeys(["none", "k2", "k1"]), { catno: "FILE-2", type: "ep", src: "file" }, "the first of an album's keys that is known");
  assert.equal(rf.forKeys([]), null);
  assert.deepEqual(saved, [["k1", "file"], ["k1", "discogs"], ["k2", "discogs"], ["k2", "roon"], ["k2", "file"]], "every source's record is saved, a tie's is not");
  assert.equal(rf.clear("roon"), 1);
  assert.deepEqual(removed, ["roon"]);
  assert.deepEqual(rf.get("k2"), { catno: "FILE-2", type: null, src: "file" }, "Roon's kind gone, the rest stays");
  rf.load([{ key: "k9", catno: "ZEN 61", rtype: "album", src: "file" }, { key: "k9", catno: "D-61", rtype: "ep", src: "discogs" },
    { key: "k10", catno: null, rtype: "bogus", src: "file" }, null]);
  assert.deepEqual(rf.get("k9"), { catno: "ZEN 61", type: "album", src: "file" }, "loaded rows rank as set ones do");
  assert.equal(rf.get("k10"), null, "a kind the database holds that Rouen no longer shows is nothing known");
  assert.equal(rf.size(), 3);
});

test("a source read whole again replaces what it said before: a corrected tag, a tag removed; the other sources' records stay (the review)", () => {
  const saved = [], removed = [];
  const rf = createReleaseFacts({ save: (k, f) => saved.push([k, f.catno]), remove: (s) => removed.push(s) });
  rf.set("k1", { catno: "WARP 16", type: "album" }, "file");   // tagged by mistake
  rf.set("k2", { catno: "ZEN 61", type: null }, "file");          // the tag later removed
  rf.set("k3", { catno: "D-9", type: null }, "discogs");         // another source's
  rf.set("k4", { catno: "R-1", type: "ep" }, "roon");
  const v = rf.version();
  const changed = rf.replaceSource("file", new Map([["k1", { catno: "WARP 61", type: "album" }], ["k3", { catno: "FILE-3", type: null }], ["k4", { catno: "FILE-4", type: null }], ["k5", { catno: "", type: "x" }]]));
  assert.equal(changed, 4, "k1 replaced, k2 removed, k3 and k4 added; k5 nothing");
  assert.deepEqual(rf.get("k1"), { catno: "WARP 61", type: "album", src: "file" });
  assert.equal(rf.get("k2"), null);
  assert.deepEqual(rf.get("k3"), { catno: "FILE-3", type: null, src: "file" }, "a tag outranks a Discogs match");
  assert.deepEqual(rf.get("k4"), { catno: "FILE-4", type: "ep", src: "file" }, "a tag's number, Roon's kind");
  assert.ok(rf.version() > v);
  assert.deepEqual(removed, ["file"]);
  assert.equal(rf.replaceSource("file", new Map([["k1", { catno: "WARP 61", type: "album" }], ["k3", { catno: "FILE-3" }], ["k4", { catno: "FILE-4" }]])), 0, "read again the same: nothing changed");
  assert.equal(rf.replaceSource("file", new Map([["k3", { catno: "FILE-3" }], ["k4", { catno: "FILE-4" }]])), 1, "k1's tag removed");
  assert.deepEqual(rf.get("k3"), { catno: "FILE-3", type: null, src: "file" }, "the kept rows written again after the removal");
  assert.equal(rf.get("k1"), null);
});
