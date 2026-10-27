"use strict";
// ---------------------------------------------------------------------------
// v1.9.10: the Shelf routes, moved out of index.js into lib/shelf-routes.js.
// Driven through a stand-in Express app, so the handlers that ship are the
// ones under test. The behaviour pinned is the route's as it was — 503 while
// there is nothing to serve, the answer kept per state and reused, `same` for
// a signature the page already holds — plus the year the Years tab needs, and
// a rebuild when the state key moves (a year arriving bumps it).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { mountShelf } = require("../../lib/shelf-routes");

function fakeApp() {
  const routes = new Map();
  return { routes, get(p, h) { routes.set(p, h); } };
}
function call(handler, query) {
  return new Promise((resolve) => {
    const res = {
      code: 200,
      status(c) { this.code = c; return this; },
      json(body) { resolve({ code: this.code, body }); },
      sendFile(f) { resolve({ code: this.code, file: f }); },
    };
    Promise.resolve(handler({ query: query || {} }, res)).catch((e) => resolve({ code: "threw", body: e.message }));
  });
}

function setup(over) {
  const state = { paired: true, built: true, key: "1.0.0", rev: "1.0", views: 0, years: new Map([[1, 1971], [2, null]]) };
  const deps = Object.assign({
    publicDir: "/srv/public",
    canServe: () => state.paired || state.built,
    ensureIndex: async () => {},
    isIndexBuilt: () => state.built,
    stateKey: () => state.key,
    libraryRev: () => state.rev,
    libraryView: (q) => {
      state.views++;
      state.sort = q.sort;
      return [
        { offset: 1, title: "Blue", subtitle: "Joni Mitchell", image_key: "k1", f: "joni mitchell", g: ["Folk"] },
        { offset: 2, title: "Untitled", subtitle: "Nobody", image_key: null, f: "nobody", g: [] },
      ];
    },
    genresOf: (al) => al.g,
    firstOf: (al) => al.f,
    yearOf: (al) => state.years.get(al.offset) || null,
    labelOf: (al) => (al.offset === 1 ? "Reprise" : null),
    catOf: (al) => (al.offset === 1 ? "MS 2038" : null),
    typeOf: (al) => (al.offset === 1 ? "album" : null),
  }, over || {});
  const app = fakeApp();
  mountShelf(app, deps);
  return { app, state, albums: app.routes.get("/api/shelf/albums"), page: app.routes.get("/shelf") };
}

test("/shelf sends the page from the public folder", async () => {
  const { page } = setup();
  const r = await call(page);
  assert.equal(r.file, path.join("/srv/public", "shelf.html"));
});

test("/api/shelf/albums — 503 while there is nothing to serve", async (t) => {
  await t.test("not paired and no snapshot", async () => {
    const s = setup();
    s.state.paired = false; s.state.built = false;
    const r = await call(s.albums);
    assert.equal(r.code, 503);
    assert.match(r.body.error, /Not paired/);
  });
  await t.test("paired, the index still building", async () => {
    const s = setup();
    s.state.built = false;
    const r = await call(s.albums);
    assert.equal(r.code, 503);
    assert.match(r.body.error, /still building/);
  });
});

test("/api/shelf/albums — the whole library, in the artist order, with years", async () => {
  const s = setup();
  const r = await call(s.albums);
  assert.equal(r.code, 200);
  assert.equal(s.state.sort, "artist");
  assert.equal(r.body.total, 2);
  assert.equal(r.body.rev, "1.0");
  assert.match(r.body.sig, /^[0-9a-f]{16}$/);
  assert.deepEqual(r.body.genres, [{ name: "Folk", count: 1 }]);
  assert.deepEqual(r.body.albums.map((a) => [a.o, a.b, a.y]), [[1, "J", 1971], [2, "N", null]]);
});

test("/api/shelf/albums — kept per state, and `same` for a signature the page holds", async () => {
  const s = setup();
  const first = await call(s.albums);
  await call(s.albums);
  assert.equal(s.state.views, 1, "the same state built the shelf twice");
  const same = await call(s.albums, { sig: first.body.sig });
  assert.deepEqual(same.body, { same: true, rev: "1.0", sig: first.body.sig });
});

test("/api/shelf/albums — a year arriving moves the key, and the page is sent the new shelf", async () => {
  const s = setup();
  const first = await call(s.albums);
  s.state.years.set(2, 1969);
  s.state.key = "1.0.1";
  s.state.rev = "1.1";
  const again = await call(s.albums, { sig: first.body.sig });
  assert.equal(s.state.views, 2);
  assert.notEqual(again.body.sig, first.body.sig);
  assert.equal(again.body.same, undefined, "the old signature was told nothing changed");
  assert.equal(again.body.albums[1].y, 1969);
});

test("/api/shelf/albums — a state that moved for something the shelf doesn't show still answers `same`", async () => {
  const s = setup();
  const first = await call(s.albums);
  s.state.key = "1.0.2";   // a badge, a label: rebuilt, but the same shelf
  const again = await call(s.albums, { sig: first.body.sig });
  assert.equal(s.state.views, 2);
  assert.equal(again.body.same, true);
});

test("/api/shelf/albums — a failure is a 500 with its message, not a hung request", async () => {
  const s = setup({ libraryView: () => { throw new Error("view broke"); } });
  const r = await call(s.albums);
  assert.equal(r.code, 500);
  assert.equal(r.body.error, "view broke");
});

test("/api/shelf/albums — each album's label, catalogue number and kind ride along (v1.9.67)", async () => {
  const w = setup();
  const r = await call(w.albums);
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.labels, [{ name: "Reprise", count: 1 }]);
  assert.deepEqual(r.body.kinds.map((k) => k.id + ":" + k.one + ":" + k.many).slice(0, 2), ["album:Album:Albums", "ep:EP:EPs"], "the kinds, named once by the server");
  assert.deepEqual(r.body.albums.map((a) => [a.l, a.c, a.ty]), [[0, "MS 2038", ["album"]], [null, null, null]]);
});
