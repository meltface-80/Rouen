"use strict";
// ---------------------------------------------------------------------------
// A Roon playlist's track artists (v2.0.3-t4, dev/design/playlist-artists.md). The official API puts one line under a
// playlist's track — often its composers — so with native mode on each row is given its own artist, read from your
// server as its smart playlists are. Here: matching the server's tracks to the official rows (by place, then by a title
// only one artist has), finding the playlist by name (never guessing between two), the pages read to the ceiling and
// the room, what is kept and for how long, the route, and the probe. The read is proven for smart playlists on the
// owner's server; for any playlist only by its own run (the probe).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPlaylistArtists, alignArtists, norm } = require("../../lib/roon-direct/playlist-artists");
const { mountRoonPlaylist } = require("../../lib/routes/roon-playlist");

test("alignArtists: by place when the titles agree; else a title one artist alone has; else nothing", () => {
  const tracks = [
    { title: "Rosanna", artist: "Toto", album: "IV" },
    { title: "Africa", artist: "Toto", album: "IV" },
    { title: "Summertime", artist: "Ella Fitzgerald", album: "A" },
    { title: "Summertime", artist: "Miles Davis", album: "B" },
    null,
    { title: "Jóga", artist: "Björk", album: "Homogenic" },
  ];
  assert.deepEqual(alignArtists(["Rosanna", "Africa", "Summertime", "Summertime", "Hold the Line", "Jóga"], tracks),
    ["Toto", "Toto", "Ella Fitzgerald", "Miles Davis", null, "Björk"]);
  assert.deepEqual(alignArtists(["Rosanna", "Africa", "Jóga", "Summertime"], tracks, false), ["Toto", "Toto", null, "Miles Davis"],
    "THE one: a partial list names a row by its place only, never by a title it may hold only part of (the review)");
  assert.deepEqual(alignArtists(["Summertime", "Rosanna", "Jóga"], tracks), [null, "Toto", "Björk"],
    "out of step: a title only one artist has is still named; one two artists have is not guessed");
  assert.equal(norm("Hold  the LINE!"), "holdtheline");
  assert.equal(norm("坂本龍一"), "坂本龍一", "letters in any script count");
});

// A session with one profile, the playlists given, and room as asked.
function session(room) {
  return { g: { uncertain: () => "" }, root: { profiles: [], profileId: Buffer.from([1]) },
    graph: { maxObjects: 1e6, objects: { size: 1e6 - (room ?? 1e6) }, get: () => null } };
}
function make(o = {}) {
  const s = o.s || session();
  const pages = [];
  let t = 1000;
  const list = o.list || [{ oid: 5n, id: "aa", name: "Late Night", tracks: 3 }];
  const a = createPlaylistArtists({ link: { session: () => s }, inTurn: (fn) => fn(), on: () => o.on !== false, profile: () => null,
    known: () => new Map(), playlists: { read: async () => ({ list: o.lists ? o.lists() : list }) }, now: () => t,
    page: async (_s, opts) => { pages.push(opts.page); return o.page ? o.page(opts.page) : { count: 3, items: [
      { title: "Rosanna", artist: "Toto", album: "IV" }, { title: "Africa", artist: "Toto", album: "IV" }, { title: "Hold the Line", artist: "Toto", album: "Toto" }] }; } });
  return { a, pages, tick: (ms) => { t += ms; } };
}

test("read: the playlist by its name; none of that name, or two, gives no artists", async () => {
  const { a } = make();
  const r = await a.read("Late Night");
  assert.equal(r.status, "ok");
  assert.deepEqual(r.tracks.map((x) => x.artist), ["Toto", "Toto", "Toto"]);
  assert.equal((await make().a.read("Road Trip")).status, "none");
  const two = make({ list: [{ oid: 5n, id: "aa", name: "Mix", tracks: 3 }, { oid: 6n, id: "bb", name: "Mix", tracks: 9 }] });
  const r2 = await two.a.read("Mix");
  assert.equal(r2.status, "none");
  assert.match(r2.why, /2 playlists called "Mix"/, "THE one: never a guess between two playlists of one name");
  assert.equal((await make({ on: false }).a.read("Late Night")).status, "off");
});

test("read: page after page to the count, never past 1,000 tracks, never with too little room", async () => {
  const full = (n) => Array.from({ length: n }, (_, i) => ({ title: "T" + i, artist: "A", album: null }));
  const long = make({ page: (p) => ({ count: 250, items: full(p < 2 ? 100 : 50) }) });
  const r = await long.a.read("Late Night");
  assert.deepEqual(long.pages, [0, 1, 2]);
  assert.equal(r.tracks.length, 250);
  assert.equal(r.capped, undefined);
  const huge = make({ page: () => ({ count: 5000, items: full(100) }) });
  const h = await huge.a.read("Late Night");
  assert.equal(huge.pages.length, 10, "the official API's ceiling: 1,000 tracks");
  assert.equal(h.capped, true);
  const tight = make({ s: session(1000) });
  const t = await tight.a.read("Late Night");
  assert.equal(tight.pages.length, 0, "no page asked for with under 50,000 objects of room");
  assert.equal(t.capped, true);
});

test("read: kept until the playlist's track count changes or an hour passes; a partial answer is not kept", async () => {
  let list = [{ oid: 5n, id: "aa", name: "Late Night", tracks: 3 }];
  const m = make({ lists: () => list });
  await m.a.read("Late Night"); await m.a.read("Late Night");
  assert.equal(m.pages.length, 1, "asked once");
  list = [{ oid: 5n, id: "aa", name: "Late Night", tracks: 4 }];
  await m.a.read("Late Night");
  assert.equal(m.pages.length, 2, "a track added: read again");
  m.tick(30 * 60 * 1000);
  await m.a.read("Late Night");
  assert.equal(m.pages.length, 2, "half an hour on: still kept (each read costs the connection room)");
  m.tick(31 * 60 * 1000);
  await m.a.read("Late Night");
  assert.equal(m.pages.length, 3, "an hour on: read again");
  const partial = make({ page: () => ({ count: 2, items: [{ title: "A", artist: "X", album: null }, { arrived: false }] }) });
  const p = await partial.a.read("Late Night");
  assert.deepEqual(p.tracks, [{ title: "A", artist: "X", album: null }, null]);
  await partial.a.read("Late Night");
  assert.equal(partial.pages.length, 2, "a track that didn't arrive: asked again next time");
  const refused = make({ page: () => ({ error: "Your server refused the playlist's page." }) });
  assert.deepEqual(await refused.a.read("Late Night"), { status: "failed", why: "Your server refused the playlist's page." });
});

function routes(over) {
  const r = {};
  mountRoonPlaylist({ get: (p, fn) => { r["GET " + p] = fn; }, post: (p, fn) => { r["POST " + p] = fn; } }, Object.assign({
    core: () => ({}), withBrowseSession: (fn) => fn("sk"),
    loadPlaylistSession: async () => ({ item: {}, playMenu: null, total: 2,
      items: [{ title: "1. Rosanna", subtitle: "David Paich" }, { title: "Africa", subtitle: "David Paich, Jeff Porcaro" }] }),
    isTrackItem: () => true, stripTrackNumber: (s) => s.replace(/^\d+\.\s*/, ""), trackNumberOf: () => null, PLAYLIST_ITEMS: 1000,
    invokePlaylistAction: async () => ({}), invokePlaylistTrackAction: async () => ({}),
  }, over));
  return async (key, req) => {
    let status = 200, body = null;
    const res = { set() { return this; }, status(c) { status = c; return this; }, json(b) { body = b; return this; } };
    await r[key](Object.assign({ query: {}, body: {} }, req), res);
    return { status, body };
  };
}
const NATIVE = { read: async () => ({ status: "ok", name: "Late Night", count: 2, tracks: [{ title: "Rosanna", artist: "Toto", album: "IV" }, { title: "Africa", artist: "Toto", album: "IV" }] }) };

test("POST /api/playlist/track-artists: an artist per row on \"ok\"; any other answer passed on with no list", async () => {
  const call = routes({ playlistArtists: NATIVE });
  const r = await call("POST /api/playlist/track-artists", { body: { title: "Late Night", tracks: ["Rosanna", "Africa", "Gone"] } });
  assert.deepEqual(r.body, { status: "ok", artists: ["Toto", "Toto", null] });
  assert.equal((await call("POST /api/playlist/track-artists", { body: { title: "Late Night" } })).status, 400);
  assert.deepEqual((await routes({})("POST /api/playlist/track-artists", { body: { title: "X", tracks: [] } })).body, { status: "off", why: "Native mode is off." });
  const none = routes({ playlistArtists: { read: async () => ({ status: "none", why: "no such" }) } });
  assert.deepEqual((await none("POST /api/playlist/track-artists", { body: { title: "X", tracks: ["a"] } })).body, { status: "none", why: "no such" });
});

test("the probe: nothing read without run=1; with it, the official line beside the server's artist, row by row", async () => {
  const call = routes({ playlistArtists: NATIVE });
  const idle = await call("GET /api/debug/roon-playlist-artists", { query: {} });
  assert.equal(idle.body.ran, false);
  const r = await call("GET /api/debug/roon-playlist-artists", { query: { run: "1", title: "Late Night", offset: "0" } });
  assert.equal(r.body.readOnly, true);
  assert.deepEqual(r.body.sample.map((x) => [x.title, x.line, x.artist]), [["Rosanna", "David Paich", "Toto"], ["Africa", "David Paich, Jeff Porcaro", "Toto"]]);
  assert.deepEqual([r.body.named, r.body.lineIsArtist, r.body.lineDiffers], [2, 0, 2]);
  assert.equal((await call("GET /api/debug/roon-playlist-artists", { query: { run: "1" } })).status, 400);
});

test("read: one page a turn, stopped at a page that didn't arrive whole; no Count is capped and not kept", async () => {
  const full = (n) => Array.from({ length: n }, (_, i) => ({ title: "T" + i, artist: "A", album: null }));
  let turns = 0;
  const s = session();
  const pages = [];
  const mk = (pageFn) => createPlaylistArtists({ link: { session: () => s }, inTurn: (fn) => { turns++; return fn(); }, on: () => true, profile: () => null,
    known: () => new Map(), playlists: { read: async () => ({ list: [{ oid: 5n, id: "aa", name: "Big", tracks: 300 }] }) },
    page: async (_s, o) => { pages.push(o.page); return pageFn(o.page); } });
  const a = await mk(() => ({ count: 300, complete: true, items: full(100) })).read("Big");
  assert.equal(turns, 1 + 3, "the find, then each of three pages in a turn of its own");
  assert.equal(a.whole, true);
  pages.length = 0;
  const slow = mk((p) => ({ count: 300, complete: p === 0, items: p === 0 ? full(100) : full(99).concat([{ arrived: false }]) }));
  const b = await slow.read("Big");
  assert.deepEqual(pages, [0, 1], "stopped at the page that didn't arrive whole");
  assert.equal(b.whole, false);
  await slow.read("Big");
  assert.deepEqual(pages, [0, 1, 0, 1], "and not kept: asked again");
  pages.length = 0;
  const noCount = mk(() => ({ count: null, complete: true, items: full(100) }));
  const c = await noCount.read("Big");
  assert.deepEqual([c.capped, c.whole], [true, false], "no Count: how many more is unknown");
  await noCount.read("Big");
  assert.deepEqual(pages, [0, 0], "not kept");
});
