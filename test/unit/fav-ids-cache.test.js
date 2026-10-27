"use strict";
// ---------------------------------------------------------------------------
// lib/fav-ids-cache.js (moved out of index.js in v1.9.70-t6, unchanged): a streaming service's favourited album ids,
// kept for cacheMs; callers on a cold cache share one fetch; a failed fetch serves the last ids while they are younger
// than staleMaxMs, else none — the list still renders, without favourite marks.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { makeFavIdsCache } = require("../../lib/fav-ids-cache");

test("one fetch for callers arriving together, then the ids kept", async () => {
  let calls = 0;
  const c = makeFavIdsCache({ name: "t", fetchIds: async () => { calls++; await new Promise((r) => { setTimeout(r, 5); }); return new Set(["1"]); } });
  const [a, b] = await Promise.all([c.get(), c.get()]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  await c.get();
  assert.equal(calls, 1, "kept within cacheMs");
  c.add(2);
  assert.ok((await c.get()).has("2"));
  c.remove("1");
  assert.ok(!(await c.get()).has("1"));
});

test("THE one: a failed fetch serves the last ids while young enough, else none; clear() asks again", async () => {
  let fail = false, calls = 0;
  const c = makeFavIdsCache({ name: "t", cacheMs: 0, staleMaxMs: 60000, fetchIds: async () => { calls++; if (fail) throw new Error("429"); return new Set(["9"]); } });
  assert.deepEqual([...await c.get()], ["9"]);
  fail = true;
  assert.deepEqual([...await c.get()], ["9"], "stale ids, not none");
  const young = makeFavIdsCache({ name: "t", staleMaxMs: -1, fetchIds: async () => { throw new Error("down"); } });
  assert.deepEqual([...await young.get()], []);
  c.clear();
  await c.get();
  assert.equal(calls, 3);
});
