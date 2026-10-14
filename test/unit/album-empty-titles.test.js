"use strict";
// ---------------------------------------------------------------------------
// v1.9.21: titles with no Latin letter or digit ("+", "=", "÷" — Ed Sheeran's
// — and "στίγμα", from the owner's library). normalize() reduces each to "",
// so by it alone they are one album, and "" is "contained" in every title.
// Finding an album by name (Roon's search) and checking that an offset holds
// the album asked for must tell them apart by their own strings, or opening
// "+" plays "=".
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadIndexFunctions } = require("../lib/extract");
const { createAlbumSearch } = require("../../lib/provider/public/album-search");

const F = loadIndexFunctions(["albumIdentityMatches", "normalize"]);
const ED = (title) => ({ title, subtitle: "Ed Sheeran", item_key: "k" + title });

function search(results) {
  const opened = [];
  const s = createAlbumSearch({
    normalize: F.normalize,
    creditHasArtist: (credit, artist) => credit === artist,
    zones: () => ({ z1: {} }),
    browse: async (q) => { if (q.item_key) opened.push(q.item_key); return { action: "list" }; },
    load: async () => (opened.length ? { items: results } : { items: [{ title: "Albums", item_key: "albums" }] }),
  });
  return s.findAlbumViaSearch("sk", results.wanted, "Ed Sheeran", "z1");
}

test("Roon's search: \"+\" is found as \"+\", never as the first album whose title normalises to nothing", async () => {
  const results = [ED("="), ED("÷"), ED("+")];
  results.wanted = "+";
  const hit = await search(results);
  assert.equal(hit && hit.item.title, "+", "THE one: \"+\" opened \"=\"");
  const none = [ED("="), ED("÷")];
  none.wanted = "+";
  assert.equal(await search(none), null, "an album search did not find is not another one");
});

test("an offset's album is the one asked for: by its own title when that normalises to nothing", () => {
  assert.equal(F.albumIdentityMatches(ED("="), { title: "+", subtitle: "Ed Sheeran" }), false, "THE one: \"=\" passed for \"+\"");
  assert.equal(F.albumIdentityMatches(ED("+"), { title: "+", subtitle: "Ed Sheeran" }), true);
  assert.equal(F.albumIdentityMatches(ED(" + "), { title: "+", subtitle: "Ed Sheeran" }), true, "the ends trimmed, as everywhere");
  assert.equal(F.albumIdentityMatches({ title: "Blue!", subtitle: "Joni" }, { title: "blue", subtitle: "joni" }), true, "the rest unchanged");
});
