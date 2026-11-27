"use strict";
/*
 * GET /api/label-albums, moved out of index.js unchanged in 2.0.6-t4 (lib/routes/label-albums.js): off, nothing; no
 * label, 400; unknown, empty while the scan says whether it runs; known, its albums by title (or shuffled), each with
 * its source, and the label's logo.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { mountLabelAlbums } = require("../../lib/routes/label-albums");
const { indexSource } = require("../lib/extract");

function route(d) {
  let handler = null;
  mountLabelAlbums({ get: (p, h) => { assert.equal(p, "/api/label-albums"); handler = h; } }, d);
  return (query) => new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ status: this.code, body: b }); } };
    handler({ query }, res);
  });
}

test("a label's albums, as before", async () => {
  const stored = [{ title: "b side" }, { title: "A side" }];
  const d = { enabled: () => true, index: { map: new Map([["warp", { albums: stored }]]), building: false }, groupKey: (n) => n.toLowerCase(),
    withSource: (a) => Object.assign(a, { source: "local" }), logos: new Map([["warp", "logo.png"]]) };
  const r = route(d);
  assert.equal((await r({})).status, 400);
  assert.deepEqual((await r({ label: "Nope" })).body, { albums: [], total: 0, label: "Nope", order: "alpha", scanning: false });
  const ok = (await r({ label: "Warp" })).body;
  assert.deepEqual(ok.albums.map((a) => a.title), ["A side", "b side"]);
  assert.equal(ok.albums[0].source, "local");
  assert.equal(stored[0].source, undefined, "the stored index is not written on");
  assert.equal(ok.logo_url, "logo.png");
  assert.equal((await r({ label: "Warp", order: "random" })).body.albums.length, 2);
  const off = route(Object.assign({}, d, { enabled: () => false }));
  assert.deepEqual((await off({ label: "Warp" })).body, { label: null, albums: [] });
});

test("index.js mounts it with the label scan's own state", () => {
  assert.match(indexSource(), /\nmountLabelAlbums\(app, \{ enabled: \(\) => labelsEnabled, index: labelsIndex, groupKey: labelGroupKey, withSource, logos: labelLogoCache \}\);\n/);
});
