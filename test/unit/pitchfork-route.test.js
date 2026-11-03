"use strict";
// ---------------------------------------------------------------------------
// The Pitchfork listing (lib/routes/pitchfork.js, moved out of index.js in
// v1.9.72-t64): GET /api/pitchfork/reviews and GET /api/pitchfork/review, the
// 6-hour per-tab cache that keeps only a non-empty list, the RSS fallback the
// Latest tab alone has, and the global search's Pitchfork section. All on
// fakes: no request leaves the process.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPitchfork } = require("../../lib/routes/pitchfork");

/** A listing page as Pitchfork serves it: the state is a script assignment inside a larger page. */
function listingPage(items) {
  return "<html><script>window.__PRELOADED_STATE__ = " + JSON.stringify({ transformed: { bundle: { items } } }) +
    ";</script><p>{not state}</p></html>";
}

/** One review item in the shape the listing walk matches on. */
function review(slug, title, artist, date, rating) {
  return {
    contentType: "review", url: "/reviews/albums/" + slug + "/?utm=x", dangerousHed: "<em>" + title + "</em>",
    subHed: { name: artist }, pubDate: date, ratingValue: rating || { score: "7.5" },
    image: { sources: { sm: { url: "sm.jpg" }, lg: { url: "lg.jpg" } } },
  };
}

const RSS = '<rss><channel><item><title><![CDATA[Moon Safari]]></title>' +
  "<link>https://pitchfork.com/reviews/albums/air-moon-safari/?utm=rss</link>" +
  '<media:thumbnail url="rss.jpg"/><pubDate>Mon, 02 Nov 2026</pubDate></item>' +
  "<item><title>Not a review</title><link>https://pitchfork.com/news/x/</link></item></channel></rss>";

/**
 * pages: url -> body, or an Error to throw. Every fetch is recorded, as is every throttle wait.
 * @param {Record<string, string | Error>} pages
 */
function rig(pages, library) {
  const fetched = [];
  let waits = 0;
  const searched = [];
  const albums = library || [];
  const pf = createPitchfork({
    DEBUG: false,
    BROWSER_UA: "test-ua",
    httpText: async (url, headers, timeoutMs) => {
      fetched.push({ url, headers, timeoutMs });
      const body = pages[url];
      if (body instanceof Error) throw body;
      if (body === undefined) throw new Error("no page " + url);
      return body;
    },
    pitchforkWait: async () => { waits++; },
    slugifyForPitchfork: (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
    stripHtml: (h) => String(h || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " "),
    normalize: (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
    searchAlbums: (q, limit) => { searched.push({ q, limit }); return albums.slice(0, limit); },
    albumIndex: { albums },
  });
  const routes = [];
  pf.mount({ get: (p, fn) => { routes.push({ p, fn }); } });
  const call = async (p, query) => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes.find((r) => r.p === p).fn({ query }, res);
    return res;
  };
  return { pf, routes, call, fetched, searched, waits: () => waits };
}

const LATEST = "https://pitchfork.com/reviews/albums/";
const BEST = "https://pitchfork.com/reviews/best/albums/";
const FEED = "https://pitchfork.com/feed/feed-album-reviews/rss";

test("the two routes are registered in index.js's order", () => {
  const w = rig({});
  assert.deepEqual(w.routes.map((r) => r.p), ["/api/pitchfork/reviews", "/api/pitchfork/review"]);
});

test("Latest: the listing page's items, newest first, throttled and sent as a browser", async () => {
  // The page lists newest first; the state walk meets them the other way round, so only the sort restores it.
  const w = rig({ [LATEST]: listingPage([
    review("bjork-homogenic", "Homogenic", "Björk", "2026-10-03T00:00:00Z"),
    review("air-moon-safari", "Moon Safari", "Air", "2026-10-01T00:00:00Z", { score: "8.5", isBestNewMusic: true }),
  ]) });
  const res = await w.call("/api/pitchfork/reviews", {});
  assert.equal(res.code, 200);
  assert.equal(res.body.type, "latest");
  assert.deepEqual(res.body.items, [
    { url: "https://pitchfork.com/reviews/albums/bjork-homogenic/", album: "Homogenic", artist: "Björk", cover: "lg.jpg",
      score: 7.5, isBestNewMusic: false, date: "2026-10-03T00:00:00Z" },
    { url: "https://pitchfork.com/reviews/albums/air-moon-safari/", album: "Moon Safari", artist: "Air", cover: "lg.jpg",
      score: 8.5, isBestNewMusic: true, date: "2026-10-01T00:00:00Z" },
  ]);
  assert.equal(w.fetched.length, 1);
  assert.deepEqual(w.fetched[0], { url: LATEST, timeoutMs: 15000,
    headers: { "User-Agent": "test-ua", "Accept-Language": "en-US,en;q=0.9" } });
  assert.equal(w.waits(), 1, "a scrape not behind the 1 req/s throttle");
});

test("a non-empty list is cached; an empty one is asked for again", async () => {
  const w = rig({ [BEST]: listingPage([review("air-moon-safari", "Moon Safari", "Air", "2026-10-01")]) });
  await w.call("/api/pitchfork/reviews", { type: "best" });
  const again = await w.call("/api/pitchfork/reviews", { type: "best" });
  assert.equal(again.body.items.length, 1);
  assert.equal(w.fetched.length, 1, "a cached tab scraped again");

  const empty = rig({ [BEST]: "<html>no state</html>" });
  assert.deepEqual((await empty.call("/api/pitchfork/reviews", { type: "best" })).body, { type: "best", items: [] });
  await empty.call("/api/pitchfork/reviews", { type: "best" });
  assert.equal(empty.fetched.length, 2, "an empty list locked in for 6 hours");
});

test("concurrent misses share one scrape", async () => {
  const w = rig({ [LATEST]: listingPage([review("air-moon-safari", "Moon Safari", "Air", "2026-10-01")]) });
  const [a, b] = await Promise.all([w.pf.getPitchforkReviews("latest"), w.pf.getPitchforkReviews("latest")]);
  assert.equal(a, b);
  assert.equal(w.fetched.length, 1);
});

test("Latest falls back to the RSS feed, artist from the slug; with both down the route says 500", async () => {
  const w = rig({ [LATEST]: new Error("403"), [FEED]: RSS });
  const res = await w.call("/api/pitchfork/reviews", { type: "nonsense" });
  assert.deepEqual(res.body, { type: "latest", items: [
    { url: "https://pitchfork.com/reviews/albums/air-moon-safari/", album: "Moon Safari", artist: "Air", cover: "rss.jpg",
      score: null, isBestNewMusic: false, date: "Mon, 02 Nov 2026" },
  ] });

  const down = rig({ [LATEST]: new Error("listing blocked"), [FEED]: new Error("feed down") });
  const failed = await down.call("/api/pitchfork/reviews", {});
  assert.equal(failed.code, 500);
  assert.deepEqual(failed.body, { error: "listing blocked" });
});

test("Best New Music has no fallback: a failed listing is a 500", async () => {
  const w = rig({ [BEST]: new Error("blocked"), [FEED]: RSS });
  const res = await w.call("/api/pitchfork/reviews", { type: "best" });
  assert.equal(res.code, 500);
  assert.deepEqual(res.body, { error: "blocked" });
  assert.deepEqual(w.fetched.map((f) => f.url), [BEST]);
});

test("/api/pitchfork/review: never the review, only a library match, and only for a review URL", async () => {
  const lib = [{ offset: 4, title: "Moon Safari (Deluxe)", subtitle: "Air", image_key: "k", nTitle: "x" }];
  const w = rig({}, lib);
  assert.deepEqual((await w.call("/api/pitchfork/review", { url: "not a url" })).body, { error: "Invalid url" });
  const other = await w.call("/api/pitchfork/review", { url: "https://example.com/reviews/albums/a/" });
  assert.equal(other.code, 400);
  assert.deepEqual(other.body, { error: "Not a Pitchfork album-review URL" });
  assert.equal((await w.call("/api/pitchfork/review", { url: "https://pitchfork.com/news/a/" })).code, 400);

  const ok = await w.call("/api/pitchfork/review",
    { url: "https://pitchfork.com/reviews/albums/air-moon-safari/", album: "Moon Safari", artist: "Air" });
  assert.equal(ok.code, 200);
  assert.deepEqual(ok.body, { review: null, match: { offset: 4, title: "Moon Safari (Deluxe)", subtitle: "Air", image_key: "k" } });
  assert.deepEqual(w.searched, [{ q: "Air Moon Safari", limit: 3 }]);
  assert.deepEqual((await w.call("/api/pitchfork/review",
    { url: "https://pitchfork.com/reviews/albums/x/", album: "Talkie Walkie" })).body, { review: null, match: null });
  assert.equal(w.fetched.length, 0, "the review page fetched");
});

test("search: both tabs, deduped by URL, up to the limit; a failed tab is no section, not an error", async () => {
  const w = rig({
    [LATEST]: listingPage([review("air-moon-safari", "Moon Safari", "Air", "2026-10-01"),
      review("air-talkie-walkie", "Talkie Walkie", "Air", "2026-10-02")]),
    [BEST]: listingPage([review("air-moon-safari", "Moon Safari", "Air", "2026-10-01"),
      review("bjork-homogenic", "Homogenic", "Björk", "2026-10-03")]),
  });
  assert.deepEqual((await w.pf.searchPitchforkReviews("air", 6)).map((it) => it.album), ["Talkie Walkie", "Moon Safari"]);
  assert.deepEqual((await w.pf.searchPitchforkReviews("homogenic", 6)).map((it) => it.album), ["Homogenic"]);
  assert.equal((await w.pf.searchPitchforkReviews("air", 1)).length, 1);
  assert.deepEqual(await w.pf.searchPitchforkReviews("!!!", 6), []);

  const down = rig({ [LATEST]: new Error("x"), [FEED]: new Error("y"), [BEST]: new Error("z") });
  assert.deepEqual(await down.pf.searchPitchforkReviews("air", 6), []);
});
