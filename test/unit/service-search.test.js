"use strict";
// ---------------------------------------------------------------------------
// Qobuz's and TIDAL's catalogue search routes (lib/routes/service-search.js),
// moved out of index.js unchanged in v1.9.42: what they answer, from the
// services' own shapes (stubbed).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountServiceSearch } = require("../../lib/routes/service-search");

test("both searches: albums normalised, artists on the first page only, has_more from the raw page, errors by status", async () => {
  const routes = {};
  const app = { get: (p, h) => { routes[p] = h; } };
  const norm = (items) => items.filter((a) => a.id).map((a) => ({ id: String(a.id), title: a.title }));
  mountServiceSearch(app, {
    qobuzSearch: async (q, offset) => { if (q === "boom") throw Object.assign(new Error("Qobuz is down"), { status: 503 });
      return { albums: { items: [{ id: 1, title: "A" }, { title: "no id" }], total: offset ? 2 : 5 }, artists: { items: [{ id: 7, name: "X", albums_count: 3 }] } }; },
    qobuzFavIds: async () => new Set(), normalizeQobuzAlbums: norm, qobuzImage: () => "img",
    tidalAlbums: async () => ({ items: [{ id: 2, title: "B" }], total: 1 }), tidalArtists: async () => ({ items: [{ id: 8, name: "Y", picture: "p" }] }),
    tidalFavIds: async () => new Set(), normalizeTidalAlbums: norm, tidalPicture: (p) => "pic:" + p,
    parseOffset: (req) => Number(req.query.offset || 0), errorStatus: (e) => e.status || 502,
  });
  const call = async (path, query) => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes[path]({ query }, res);
    return res;
  };
  assert.equal((await call("/api/qobuz/search", {})).code, 400);
  assert.deepEqual((await call("/api/qobuz/search", { q: "a" })).body, { query: "a", offset: 0, limit: 50, total: 5, has_more: true,
    albums: [{ id: "1", title: "A" }], artists: [{ id: "7", name: "X", image: "img", albums_count: 3 }] });
  assert.deepEqual((await call("/api/qobuz/search", { q: "a", offset: "1" })).body.artists, [], "artists past the first page");
  assert.deepEqual(await call("/api/qobuz/search", { q: "boom" }).then((r) => [r.code, r.body]), [503, { error: "Qobuz is down" }]);
  assert.deepEqual((await call("/api/tidal/search", { q: "b" })).body, { query: "b", offset: 0, limit: 50, total: 1, has_more: false,
    albums: [{ id: "2", title: "B" }], artists: [{ id: "8", name: "Y", image: "pic:p", albums_count: 0 }] });
});
