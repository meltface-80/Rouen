"use strict";
// ---------------------------------------------------------------------------
// Qobuz's new releases, artist albums and featured lists (lib/routes/qobuz-releases.js), moved out of index.js
// unchanged in v1.9.72-t56. Qobuz itself is a fake; the featured cache is the real lib/ttl-cache.js, so what is
// checked includes that a second tap on a list is answered from it. Each route is checked on its main path, on a
// refusal of its own (a bad parameter), and on a failure upstream, which takes the shared status.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { makeTtlCache } = require("../../lib/ttl-cache");
const { mountQobuzReleases, QOBUZ_FEATURED_TYPES } = require("../../lib/routes/qobuz-releases");

const DAY = 24 * 60 * 60 * 1000;
const secs = (ms) => Math.floor(ms / 1000);

function rig({ featured = {}, artist = null, favs = ["2"], fail = null } = {}) {
  const routes = {};
  const app = { get: (p, h) => { routes["GET " + p] = h; } };
  const fetched = [];
  const asked = [];
  const featuredCache = makeTtlCache(10 * 60 * 1000);
  mountQobuzReleases(app, {
    featuredCache,
    fetchFeatured: async (type) => { fetched.push(type); if (fail) throw fail; return featured[type] || []; },
    favIds: async () => new Set(favs),
    getArtist: async (artistId, offset) => { asked.push([artistId, offset]); if (fail) throw fail; return artist; },
    releaseTs: (a) => (a.released_at ? a.released_at * 1000 : null),
    normalizeAlbum: (a, favIds) => ({ id: String(a.id), released_at: a.released_at ? a.released_at * 1000 : null,
                                      favourited: favIds.has(String(a.id)) }),
    normalizeAlbums: (items, favIds) => (items || []).filter(a => a && a.id)
      .map(a => ({ id: String(a.id), favourited: favIds.has(String(a.id)) })),
    stripHtml: (html) => html.replace(/<[^>]*>/g, ""),
    parseOffset: (req) => { const o = parseInt(req.query.offset, 10); return (Number.isFinite(o) && o > 0) ? o : 0; },
    errorStatus: (e) => (e && e.code === 429 ? 429 : (/not connected/i.test(e.message) ? 400 : 502)),
  });
  const call = async (key, query = {}) => {
    const res = { code: 200, body: null,
      status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes[key]({ query }, res);
    return res;
  };
  return { call, routes, fetched, asked };
}

test("all three routes are mounted, under the paths the Qobuz browser calls", () => {
  const w = rig();
  assert.deepEqual(Object.keys(w.routes).sort(),
    ["GET /api/qobuz/artist-albums", "GET /api/qobuz/featured", "GET /api/qobuz/new-releases"]);
});

test("/new-releases: inside the window only, newest first, favourites marked, the list cached", async () => {
  const now = Date.now();
  const w = rig({ featured: { "new-releases-full": [
    { id: 1, released_at: secs(now - 3 * DAY) },
    { id: 2, released_at: secs(now - 1 * DAY) },
    { id: 3, released_at: secs(now - 40 * DAY) },   // older than 30 days
    { id: 4, released_at: secs(now + 5 * DAY) },    // further ahead than the two days' skew
    { id: 5 },                                       // no date: kept, sorted last
    null, { title: "no id" },
  ] } });
  const r = await w.call("GET /api/qobuz/new-releases");
  assert.equal(r.code, 200);
  assert.equal(r.body.days, 30);
  assert.deepEqual(r.body.albums.map(a => a.id), ["2", "1", "5"]);
  assert.deepEqual(r.body.albums.map(a => a.favourited), [true, false, false]);

  const wide = await w.call("GET /api/qobuz/new-releases", { days: "60" });
  assert.equal(wide.body.days, 60);
  assert.deepEqual(wide.body.albums.map(a => a.id), ["2", "1", "3", "5"]);
  assert.deepEqual(w.fetched, ["new-releases-full"], "the second call is answered from the featured cache");

  for (const days of ["0", "-3", "366", "soon"]) {
    assert.equal((await w.call("GET /api/qobuz/new-releases", { days })).body.days, 30, "days=" + days);
  }
});

test("/new-releases: a failure upstream is the shared status, and is not cached", async () => {
  const notConnected = rig({ fail: new Error("Qobuz not connected") });
  const r = await notConnected.call("GET /api/qobuz/new-releases");
  assert.equal(r.code, 400);
  assert.deepEqual(r.body, { error: "Qobuz not connected" });
  await notConnected.call("GET /api/qobuz/new-releases");
  assert.equal(notConnected.fetched.length, 2, "a failed fetch is asked again on the next tap");

  const limited = Object.assign(new Error("slow down"), { code: 429 });
  assert.equal((await rig({ fail: limited }).call("GET /api/qobuz/new-releases")).code, 429);
  assert.equal((await rig({ fail: new Error("boom") }).call("GET /api/qobuz/new-releases")).code, 502);
});

test("/artist-albums: one page in Qobuz's order, has_more from the raw length, the biography on the first page only", async () => {
  const artist = { artist: { id: 9, name: "Talk Talk" }, biography: "<p>From <b>London</b>.</p> ",
                   albums: { total: 3, items: [{ id: 2 }, null, { id: 7 }] } };
  const w = rig({ artist });
  const r = await w.call("GET /api/qobuz/artist-albums", { artist_id: " 9 " });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body, {
    artist: { id: 9, name: "Talk Talk" }, offset: 0, limit: 50, total: 3, has_more: false,
    albums: [{ id: "2", favourited: true }, { id: "7", favourited: false }], biography: "From London.",
  });
  assert.deepEqual(w.asked, [["9", 0]]);

  const next = await w.call("GET /api/qobuz/artist-albums", { artist_id: "9", offset: "50" });
  assert.equal(next.body.offset, 50);
  assert.equal(next.body.biography, "", "no biography past the first page");
  assert.equal(next.body.has_more, false);
  const short = rig({ artist: { ...artist, biography: null, albums: { total: 120, items: [{ id: 1 }] } } });
  const s = await short.call("GET /api/qobuz/artist-albums", { artist_id: "9" });
  assert.equal(s.body.has_more, true);
  assert.equal(s.body.biography, "");
});

test("/artist-albums: no artist_id is a 400 and Qobuz is not asked; a failure upstream is the shared status", async () => {
  const w = rig();
  const none = await w.call("GET /api/qobuz/artist-albums", { artist_id: "   " });
  assert.equal(none.code, 400);
  assert.deepEqual(none.body, { error: "artist_id required" });
  assert.deepEqual(w.asked, []);

  const bad = await rig({ fail: new Error("upstream 500") }).call("GET /api/qobuz/artist-albums", { artist_id: "9" });
  assert.equal(bad.code, 502);
  assert.deepEqual(bad.body, { error: "upstream 500" });
});

test("/featured: every listed type answers in Qobuz's own order; anything else is a 400 and Qobuz is not asked", async () => {
  assert.deepEqual([...QOBUZ_FEATURED_TYPES], ["new-releases-full", "best-sellers", "most-streamed",
    "press-awards", "editor-picks", "qobuzissims", "ideal-discography", "recent-releases"]);
  const w = rig({ featured: { "best-sellers": [{ id: 7 }, { id: 2 }, null, { id: 1 }] } });
  const r = await w.call("GET /api/qobuz/featured", { type: " best-sellers " });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body, { type: "best-sellers",
    albums: [{ id: "7", favourited: false }, { id: "2", favourited: true }, { id: "1", favourited: false }] });
  await w.call("GET /api/qobuz/featured", { type: "best-sellers" });
  assert.deepEqual(w.fetched, ["best-sellers"], "a second tap is answered from the cache");

  for (const type of ["", "new", "top", "__proto__"]) {
    const bad = await w.call("GET /api/qobuz/featured", { type });
    assert.equal(bad.code, 400, "type=" + type);
    assert.deepEqual(bad.body, { error: "invalid type" });
  }
  assert.deepEqual(w.fetched, ["best-sellers"]);

  const down = await rig({ fail: new Error("Qobuz not connected") }).call("GET /api/qobuz/featured", { type: "qobuzissims" });
  assert.equal(down.code, 400);
  assert.deepEqual(down.body, { error: "Qobuz not connected" });
});
