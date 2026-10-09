"use strict";
// ---------------------------------------------------------------------------
// v1.9.3: the Last.fm client (lib/lastfm.js) — read-only, spaced, remembered.
//
// Driven against a fake Last.fm that records every request. What matters is
// what a real one would punish or what a user would see: no call without a
// key, never more than one call at a time and four a second, each artist
// asked about once a week, the grey placeholder star never shown as an
// artist's picture, and one unreadable artist costing one entry, not the row.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createLastfm, pickImage, siteUrl, PLACEHOLDER } = require("../../lib/lastfm");

const STAR = "https://lastfm.freetls.fastly.net/i/u/300x300/" + PLACEHOLDER + ".png";
const img = (u) => [{ "#text": u.replace(".jpg", "-s.jpg"), size: "small" }, { "#text": u, size: "extralarge" }];

function fakeLastfm(routes, opts) {
  opts = opts || {};
  const log = [];
  let clock = 1000;
  let inFlight = 0, maxInFlight = 0;
  const fetch = async (url) => {
    const q = Object.fromEntries(new URL(url).searchParams);
    log.push({ at: clock, q });
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setImmediate(r));
    inFlight--;
    const body = routes(q);
    if (body instanceof Error) throw body;
    return { ok: !(body && body.error), status: body && body.error ? (body.error === 10 ? 403 : 400) : 200,
             json: async () => body };
  };
  const lf = createLastfm({
    fetch, getKey: () => (opts.key === undefined ? "k" : opts.key),
    now: () => clock, sleep: async (ms) => { clock += ms; }, spacingMs: 250,
  });
  return { lf, log, tick: (ms) => { clock += ms; }, maxInFlight: () => maxInFlight };
}

const SIMILAR = {
  similarartists: {
    "@attr": { artist: "Radiohead" },
    artist: [
      { name: "Thom Yorke", match: "1", url: "https://www.last.fm/music/Thom+Yorke", image: [{ "#text": STAR, size: "large" }] },
      { name: "Atoms for Peace", match: "0.8", url: "https://www.last.fm/music/Atoms+for+Peace", image: [] },
      { name: "Muse", match: "0.6", url: "https://www.last.fm/music/Muse", image: [] },
      { name: "muse", match: "0.5", url: "https://www.last.fm/music/Muse", image: [] },
    ],
  },
};
const TOP = (artist) => ({
  topalbums: { album: [
    { name: "(null)", artist: { name: artist }, url: "https://www.last.fm/music/x/(null)", image: [] },
    { name: artist + " LP", artist: { name: artist }, url: "https://www.last.fm/music/" + artist + "/LP",
      image: img("https://lastfm.freetls.fastly.net/i/u/300x300/" + artist.length + ".jpg") },
  ] },
});

function routes(q) {
  if (q.method === "artist.getSimilar") return SIMILAR;
  if (q.method === "artist.getTopAlbums") {
    if (q.artist === "Atoms for Peace") return { error: 6, message: "The artist you supplied could not be found" };
    return TOP(q.artist);
  }
  return { error: 3, message: "Invalid Method" };
}

test("Last.fm, read-only (v1.9.3)", async (t) => {
  await t.test("similar artists: closest first, one row per name, Last.fm's own name and page", async () => {
    const { lf } = fakeLastfm(routes);
    const r = await lf.similarArtists("radiohead");
    assert.equal(r.artist, "Radiohead");
    assert.equal(r.url, "https://www.last.fm/music/Radiohead");
    assert.deepEqual(r.artists.map((a) => a.name), ["Thom Yorke", "Atoms for Peace", "Muse"]);
  });
  await t.test("THE grey star is never an artist's picture", async () => {
    const { lf } = fakeLastfm(routes);
    const r = await lf.similarArtists("radiohead");
    assert.equal(r.artists[0].image, "", "Last.fm's placeholder star was passed off as a photo");
    assert.equal(pickImage([{ "#text": STAR, size: "mega" }]), "");
  });
  await t.test("similar albums: each similar artist's top album, skipping untitled rows and unknown artists", async () => {
    const { lf } = fakeLastfm(routes);
    const r = await lf.similarAlbums("Radiohead", 9);
    assert.deepEqual(r.albums.map((a) => a.title), ["Thom Yorke LP", "Muse LP"]);
    assert.match(r.albums[0].image, /extralarge|\/10\.jpg$/);
    assert.equal(r.albums[0].image, "https://lastfm.freetls.fastly.net/i/u/300x300/10.jpg", "not the largest picture");
  });
  await t.test("one call at a time, at least 250 ms apart", async () => {
    const f = fakeLastfm(routes);
    await f.lf.similarAlbums("Radiohead", 9);
    assert.equal(f.maxInFlight(), 1, "calls overlapped");
    for (let i = 1; i < f.log.length; i++) {
      assert.ok(f.log[i].at - f.log[i - 1].at >= 250, "calls " + (i - 1) + " and " + i + " were too close");
    }
  });
  await t.test("each answer is remembered: a second album view of the same artist costs nothing", async () => {
    const f = fakeLastfm(routes);
    await f.lf.similarAlbums("Radiohead", 9);
    const n = f.lf.calls();
    await f.lf.similarArtists("Radiohead");
    await f.lf.similarAlbums("Radiohead", 9);
    assert.equal(f.lf.calls(), n);
  });
  await t.test("…for a week, then asked again", async () => {
    const f = fakeLastfm(routes);
    await f.lf.similarArtists("Radiohead");
    f.tick(7 * 24 * 60 * 60 * 1000 + 1);
    await f.lf.similarArtists("Radiohead");
    assert.equal(f.lf.calls(), 2);
  });
  await t.test("two views asking at once share one call", async () => {
    const f = fakeLastfm(routes);
    await Promise.all([f.lf.similarArtists("Radiohead"), f.lf.similarArtists("Radiohead")]);
    assert.equal(f.lf.calls(), 1);
  });
  await t.test("no key: no call at all, and a key saved later works on the next ask", async () => {
    let key = "";
    const log = [];
    const lf = createLastfm({ fetch: async (u) => { log.push(u); return { ok: true, status: 200, json: async () => SIMILAR }; },
                              getKey: () => key, sleep: async () => {}, spacingMs: 0 });
    await assert.rejects(lf.similarArtists("Radiohead"), (e) => e.code === "nokey");
    assert.equal(log.length, 0);
    key = "k";
    const r = await lf.similarArtists("Radiohead");
    assert.equal(r.artists.length, 3);
  });
  await t.test("similar albums stop asking once nobody wants the answer", async () => {
    const f = fakeLastfm(routes);
    let n = 0;
    await f.lf.similarAlbums("Radiohead", 9, () => n++ < 1);
    assert.equal(f.log.filter((x) => x.q.method === "artist.getTopAlbums").length, 1,
      "kept asking for an album view that had gone");
  });
  await t.test("a refused key fails the whole row, not one entry at a time", async () => {
    const f = fakeLastfm((q) => (q.method === "artist.getSimilar" ? SIMILAR : { error: 10, message: "Invalid API key" }));
    await assert.rejects(f.lf.similarAlbums("Radiohead", 9), (e) => e.code === 10);
  });
  await t.test("a moment's rate limit is not remembered against the artist, and costs one entry, not the row", async () => {
    let limited = true;
    const f = fakeLastfm((q) => {
      if (q.method === "artist.getTopAlbums" && q.artist === "Thom Yorke" && limited) return { error: 29, message: "Rate limit exceeded" };
      return routes(q);
    });
    const r = await f.lf.similarAlbums("Radiohead", 9);
    assert.deepEqual(r.albums.map((a) => a.title), ["Muse LP"], "one rate-limited artist emptied the whole row");
    limited = false;
    const again = await f.lf.similarAlbums("Radiohead", 9);
    assert.deepEqual(again.albums.map((a) => a.title), ["Thom Yorke LP", "Muse LP"], "the rate limit was remembered");
  });
  await t.test("an answer to a call made with the old key is not kept after a new key is saved", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const lf = createLastfm({
      fetch: async () => { await gate; return { ok: false, status: 403, json: async () => ({ error: 10, message: "Invalid API key" }) }; },
      getKey: () => "k", sleep: async () => {}, spacingMs: 0,
    });
    const old = lf.similarArtists("Radiohead").catch((e) => e.code);
    lf.clear();                // the new key is saved while the old call is out
    release();
    assert.equal(await old, 10);
    const lf2calls = lf.calls();
    await lf.similarArtists("Radiohead").catch(() => null);
    assert.equal(lf.calls(), lf2calls + 1, "the old key's refusal was served from the cache");
  });
  await t.test("only Last.fm's own https pages are linked", () => {
    assert.equal(siteUrl("https://www.last.fm/music/Muse"), "https://www.last.fm/music/Muse");
    assert.equal(siteUrl("http://www.last.fm/music/Muse"), "");
    assert.equal(siteUrl("https://evil.example/last.fm/"), "");
    assert.equal(siteUrl("javascript:alert(1)"), "");
  });
  await t.test("the key goes to Last.fm and nowhere else, as api_key", async () => {
    const f = fakeLastfm(routes);
    await f.lf.similarArtists("Radiohead");
    assert.equal(f.log[0].q.api_key, "k");
    assert.equal(f.log[0].q.method, "artist.getSimilar");
    assert.equal(f.log[0].q.format, "json");
  });
});
