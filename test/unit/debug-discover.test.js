"use strict";
// /api/debug/discover, moved out of index.js in v1.9.72-t2 (lib/routes/debug-discover.js) with its behaviour unchanged:
// the seeds without an artist, a skip without an exact Deezer match, each row's verdict from the build's own classifier.
const test = require("node:test");
const assert = require("node:assert/strict");
const { mountDebugDiscover } = require("../../lib/routes/debug-discover");

function route(deps) {
  let handler = null;
  mountDebugDiscover({ get: (p, h) => { assert.equal(p, "/api/debug/discover"); handler = h; } }, deps);
  return (query) => new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    handler({ query }, res);
  });
}

const deps = (http) => ({ seeds: () => [{ name: "Low", days: 4 }], httpJson: http,
  similar: { SEARCH_ROWS: 5, readDeezerArtists: (search) => search.data },
  newRel: { classify: (a) => (a.record_type === "album" ? { ok: true } : { ok: false, reason: "a single" }), coverOf: (a) => a.cover_big || null } });

test("without an artist: the seeds the build would ask about", async () => {
  const r = await route(deps(async () => { throw new Error("not asked"); }))({});
  assert.deepEqual(r.body.seeds, [{ name: "Low", days_played: 4 }]);
});

test("no exact match is skipped; an exact one has each row's verdict; Deezer failing is a 502", async () => {
  const none = await route(deps(async () => ({ data: [{ name: "Lowe", id: 1, exact: false }] })))({ artist: "Low" });
  assert.equal(none.body.used, null);
  assert.match(none.body.note, /no exact name match/);
  const urls = [];
  const ok = await route(deps(async (url) => {
    urls.push(url);
    return /search/.test(url) ? { data: [{ name: "Low", id: 7, exact: true }] }
      : { data: [{ title: "Hey What", record_type: "album", cover_big: "c" }, { title: "Days", record_type: "single" }] };
  }))({ artist: "Low" });
  assert.match(urls[0], /search\/artist\?limit=5&q=Low$/);
  assert.match(urls[1], /artist\/7\/albums\?limit=50$/);
  assert.equal(ok.body.row_count, 2);
  assert.deepEqual(ok.body.rows.map((r) => [r.title, r.kept, r.rejected_because, r.cover_used]),
    [["Hey What", true, null, "c"], ["Days", false, "a single", null]]);
  assert.match(ok.body.summary, /^1 of 2 rows/);
  const down = await route(deps(async () => { throw new Error("Deezer is down"); }))({ artist: "Low" });
  assert.deepEqual(down, { code: 502, body: { error: "Deezer is down" } });
});
