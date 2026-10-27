"use strict";
// lib/routes/library-stats.js (v1.9.67-t6): the two start-up reads, moved out of index.js unchanged.

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountLibraryStats } = require("../../lib/routes/library-stats");

function rig(o = {}) {
  const routes = {};
  const app = { get: (p, h) => { routes["GET " + p] = h; } };
  mountLibraryStats(app, { paired: () => o.paired !== false, index: () => ({ count: o.count || 0, building: o.building }), mounted: () => !!o.mounted, musicDir: "/music" });
  const call = async (path) => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes["GET " + path]({ query: {} }, res);
    return res;
  };
  return call;
}

test("library stats: 503 until paired; the count, and building only while the index is empty and being built", async () => {
  assert.deepEqual((await rig({ paired: false })("/api/library-stats")).code, 503);
  assert.deepEqual((await rig({ count: 12968 })("/api/library-stats")).body, { albums: 12968, building: false });
  assert.deepEqual((await rig({ count: 0, building: {} })("/api/library-stats")).body, { albums: 0, building: true });
  assert.deepEqual((await rig({ count: 3, building: {} })("/api/library-stats")).body, { albums: 3, building: false }, "albums already counted: not 'building'");
});

test("music mount: whether /music is there, and its path", async () => {
  assert.deepEqual((await rig({ mounted: true })("/api/music-mount")).body, { mounted: true, path: "/music" });
  assert.deepEqual((await rig({})("/api/music-mount")).body, { mounted: false, path: "/music" });
});
