"use strict";
// ---------------------------------------------------------------------------
// v1.9.3: what the album view shows below the review — the routes.
//
// /api/album/more: the album's lead artist's OTHER albums and the albums they
// appear on, from the snapshot. /api/lastfm/similar-*: Last.fm's similar
// artists and albums, each told whether the library has it. The handlers are
// the shipping source, sliced out of index.js, with the real normalize and
// the real lastfmArtistJson / lastfmFailure; the library and Last.fm are
// stand-ins.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { indexSource, loadIndexFunctions } = require("../lib/extract");

function handler(route, deps) {
  const src = indexSource();
  const at = src.indexOf('app.get("' + route + '", ');
  assert.ok(at > 0, route + " moved");
  const start = src.indexOf("(req, res) =>", at) - (src.slice(at, src.indexOf("(req, res) =>", at)).includes("async") ? 6 : 0);
  const end = src.indexOf("\n});", start);
  const body = src.slice(start, end + 2);
  const names = Object.keys(deps);
  // eslint-disable-next-line no-new-func
  return new Function(...names, "return (" + body + ");")(...names.map((n) => deps[n]));
}
function call(h, query, opts) {
  let status = 200, out = null;
  const closers = [];
  const res = {
    writableEnded: false,
    status(c) { status = c; return this; },
    json(b) { out = b; this.writableEnded = true; return this; },
    on(ev, fn) { if (ev === "close") closers.push(fn); return this; },
  };
  // opts.leave: the page aborts the request partway (after the similar artists).
  if (opts && opts.leave) opts.leave(() => closers.forEach((f) => f()));
  return Promise.resolve(h({ query }, res)).then(() => ({ status, body: out }));
}

const { normalize } = loadIndexFunctions(["normalize"]);
const slimAlbum = (al) => ({ offset: al.offset, title: al.title, subtitle: al.subtitle });
const LIB = {
  "Radiohead": {
    primary: [{ offset: 1, title: "Amnesiac", subtitle: "Radiohead" },
              { offset: 2, title: "Kid A", subtitle: "Radiohead" },
              { offset: 3, title: "OK Computer", subtitle: "Radiohead" }],
    featured: [{ offset: 9, title: "Help!", subtitle: "Various / Radiohead" }],
  },
  "Thom Yorke": { primary: [{ offset: 20, title: "The Eraser", subtitle: "Thom Yorke" }], featured: [] },
};
const artistLibraryAlbums = (a) => LIB[a] || { primary: [], featured: [] };

test("the album view's library sections (v1.9.3)", async (t) => {
  const h = handler("/api/album/more", {
    splitCreditIntoArtists: (c) => c.split(" & "), artistLibraryAlbums, normalize, slimAlbum,
  });
  await t.test("THE one: the artist's other albums, not this one, and what they appear on", async () => {
    const r = await call(h, { title: "Kid A", artist: "Radiohead" });
    assert.equal(r.body.artist, "Radiohead");
    assert.deepEqual(r.body.by.map((a) => a.title), ["Amnesiac", "OK Computer"]);
    assert.deepEqual(r.body.appears.map((a) => a.title), ["Help!"]);
  });
  await t.test("a two-act credit is about its lead act, the first artist link", async () => {
    const r = await call(h, { title: "x", artist: "Thom Yorke & Jonny Greenwood" });
    assert.equal(r.body.artist, "Thom Yorke");
    assert.deepEqual(r.body.by.map((a) => a.title), ["The Eraser"]);
  });
  await t.test("no artist, no answer", async () => {
    assert.equal((await call(h, { title: "x" })).status, 400);
  });
});

function lastfmFake(over) {
  return Object.assign({
    similarArtists: async () => ({ artist: "Radiohead", url: "https://www.last.fm/music/Radiohead",
      artists: [{ name: "Thom Yorke", url: "https://www.last.fm/music/Thom+Yorke", image: "" },
                { name: "Muse", url: "https://www.last.fm/music/Muse", image: "" }] }),
    similarAlbums: async () => ({ artist: "Radiohead", albums: [
      { title: "The Eraser", artist: "Thom Yorke", url: "https://www.last.fm/music/Thom+Yorke/The+Eraser", image: "https://x/e.jpg" },
      { title: "Absolution", artist: "Muse", url: "https://www.last.fm/music/Muse/Absolution", image: "https://x/a.jpg" }] }),
  }, over || {});
}
function lastfmRoutes(key, fake) {
  const F = loadIndexFunctions(["lastfmArtistJson", "lastfmFailure"], {
    artistLibraryAlbums, console: { log() {} },
  });
  const deps = {
    lastfmKey: key, LASTFM: fake, splitCreditIntoArtists: (c) => [c],
    lastfmArtistJson: F.lastfmArtistJson, lastfmFailure: F.lastfmFailure, slimAlbum,
    resolveLibraryAlbum: (title) => (title === "The Eraser" ? LIB["Thom Yorke"].primary[0] : null),
  };
  return { artists: handler("/api/lastfm/similar-artists", deps), albums: handler("/api/lastfm/similar-albums", deps) };
}

test("the album view's Last.fm sections (v1.9.3)", async (t) => {
  await t.test("THE one: similar artists, each told whether the library has them", async () => {
    const r = await call(lastfmRoutes("k", lastfmFake()).artists, { artist: "Radiohead" });
    assert.equal(r.body.enabled, true);
    assert.equal(r.body.url, "https://www.last.fm/music/Radiohead");
    assert.deepEqual(r.body.artists.map((a) => [a.name, a.in_library]), [["Thom Yorke", true], ["Muse", false]]);
  });
  await t.test("similar albums: the library's own record where Roon has it, Last.fm's page where not", async () => {
    const r = await call(lastfmRoutes("k", lastfmFake()).albums, { artist: "Radiohead" });
    assert.deepEqual(r.body.albums.map((a) => [a.title, a.album ? a.album.offset : null]),
      [["The Eraser", 20], ["Absolution", null]]);
    assert.equal(r.body.albums[1].url, "https://www.last.fm/music/Muse/Absolution");
  });
  await t.test("a page that has gone stops the run: nothing more is asked, nothing is sent", async () => {
    let leave = null, asked = 0;
    const fake = lastfmFake({ similarAlbums: async (a, n, wanted) => {
      leave();                       // the page moves on before the first artist's album
      asked = wanted() ? 1 : 0;
      return { artist: a, albums: [] };
    } });
    const r = await call(lastfmRoutes("k", fake).albums, { artist: "Radiohead" }, { leave: (fn) => { leave = fn; } });
    assert.equal(asked, 0, "wanted() still said yes after the page left");
    assert.equal(r.body, null, "an answer was written to a closed request");
  });
  await t.test("no key: Last.fm is not asked at all", async () => {
    let asked = 0;
    const routes = lastfmRoutes("", lastfmFake({ similarArtists: async () => { asked++; return {}; } }));
    assert.deepEqual((await call(routes.artists, { artist: "Radiohead" })).body, { enabled: false });
    assert.deepEqual((await call(routes.albums, { artist: "Radiohead" })).body, { enabled: false });
    assert.equal(asked, 0);
  });
  await t.test("a refused key is said so; anything else is 'not now'", async () => {
    const bad = (code) => lastfmFake({ similarArtists: async () => { const e = new Error("x"); e.code = code; throw e; } });
    const r10 = await call(lastfmRoutes("k", bad(10)).artists, { artist: "Radiohead" });
    assert.match(r10.body.error, /refused the API key/);
    const r29 = await call(lastfmRoutes("k", bad(29)).artists, { artist: "Radiohead" });
    assert.equal(r29.body.error, "Last.fm did not answer");
  });
});
