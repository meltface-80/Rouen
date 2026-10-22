"use strict";
// ---------------------------------------------------------------------------
// lib/library-exact.js (moved out of index.js in v1.9.49): the library album a
// title and credit name exactly — by Rouen's key, and, for a title that key
// can't name (Ed Sheeran's "+", "Кино"), by the title and credit as written.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createExactIndex } = require("../../lib/library-exact");
const { loadIndexFunctions } = require("../lib/extract");
const { albumKey } = loadIndexFunctions(["albumKey", "normalize", "canonText", "canonArtist"], {});

const ALBUMS = [
  { title: "Rumours (Deluxe Edition)", subtitle: "Fleetwood Mac", offset: 0 },
  { title: "Rumours", subtitle: "Fleetwood Mac", offset: 1 },
  { title: "+", subtitle: "Ed Sheeran", offset: 2 },
  { title: "×", subtitle: "Ed Sheeran", offset: 3 },
  { title: "Кино", subtitle: "Кино", offset: 4 },
];

test("the exact edition by Rouen's key; a title it can't key, as written — and never another such title", () => {
  let builtAt = 1;
  const ex = createExactIndex({ index: () => ({ builtAt, albums: ALBUMS }), albumKey });
  assert.equal(ex.find("Rumours", "Fleetwood Mac").offset, 1, "the other edition taken");
  assert.equal(albumKey("+", "Ed Sheeran"), null, "precondition: Rouen's key can't name it");
  assert.equal(ex.find("+", "Ed Sheeran").offset, 2);
  assert.equal(ex.find("+", "ED  SHEERAN ").offset, 2, "case and spacing aside");
  assert.equal(ex.find("×", "Ed Sheeran").offset, 3, "two titles Rouen's key can't name taken for one album");
  assert.equal(ex.find("Кино", "Кино").offset, 4);
  assert.equal(ex.find("÷", "Ed Sheeran"), null);
  // Rebuilt when the library is.
  ALBUMS.push({ title: "÷", subtitle: "Ed Sheeran", offset: 5 });
  assert.equal(ex.find("÷", "Ed Sheeran"), null, "rebuilt with the library unchanged");
  builtAt = 2;
  assert.equal(ex.find("÷", "Ed Sheeran").offset, 5);
});
