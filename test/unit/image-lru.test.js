"use strict";
// ---------------------------------------------------------------------------
// The cover art cache in memory (lib/image-lru.js, moved out of index.js unchanged in 2.0.6-t21): least recently used
// goes first, no one image takes more than a quarter, and a key put twice is counted once.
// ---------------------------------------------------------------------------
const test = require("node:test");
const assert = require("node:assert/strict");
const { createImageLru } = require("../../lib/image-lru");

const img = (/** @type {number} */ n) => ({ body: Buffer.alloc(n), type: "image/jpeg", bytes: n });

test("the least recently used goes first; a hit is used again", () => {
  const c = createImageLru(100);
  for (const k of ["a", "b", "c", "d"]) c.put(k, img(25));
  assert.ok(c.get("a"), "a hit");
  c.put("e", img(25));   // 125 > 100: the least recently used (b) goes
  assert.equal(c.get("b"), null);
  assert.ok(c.get("a") && c.get("e"));
  assert.deepEqual(c.size(), { entries: 4, bytes: 100 });
});

test("one image never more than a quarter; a key put twice counted once", () => {
  const c = createImageLru(100);
  c.put("big", img(26));
  assert.equal(c.get("big"), null);
  c.put("a", img(20)); c.put("a", img(20));
  assert.deepEqual(c.size(), { entries: 1, bytes: 20 }, "the accounting drifted");
});
