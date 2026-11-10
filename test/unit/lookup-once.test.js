"use strict";
// ---------------------------------------------------------------------------
// An album's lookups on other sites, asked once at a time and only their answers remembered (lib/lookup-once.js,
// lib/wiki-lookup.js, and index.js's MusicBrainz year and Pitchfork review; v2.0.3-t12).
//
// What the owner's log of 2026-11-09 showed of a slow share card: the card asked for an album's extras a second or two
// after the album view had, and every lookup ran again — four or five more requests to Wikipedia (one answered 429
// "too many requests", and the card had no review), another turn in MusicBrainz's one-a-second queue — and a lookup
// that failed was remembered as "nothing there" until Rouen restarted. The other sites are stand-ins.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { lookupOnce, mayPass } = require("../../lib/lookup-once");
const { createWikiLookup } = require("../../lib/wiki-lookup");
const { loadIndexFunctions } = require("../lib/extract");

const httpError = (status) => new Error("HTTP " + status);
const later = () => new Promise((r) => { setImmediate(r); });

test("which failures may pass: a time limit, a dropped connection, 408, 429 and 5xx; not 404 or 403, nor a fault of the lookup's own", () => {
  const timeout = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
  const reset = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
  for (const e of [timeout, reset, new TypeError("fetch failed"), Object.assign(new Error("x"), { code: "ENOTFOUND" }),
    httpError(408), httpError(429), httpError(500), httpError(503)]) {
    assert.equal(mayPass(e), true, e.message);
  }
  for (const s of [400, 403, 404, 410]) assert.equal(mayPass(httpError(s)), false, String(s));
  // The review of t12: a fault in reading a page (a scraper's TypeError, a body that wasn't JSON) is an answer, as
  // before; asked again every time, it would be asked for ever.
  assert.equal(mayPass(new TypeError("Cannot read properties of undefined (reading 'query')")), false);
  assert.equal(mayPass(new SyntaxError("Unexpected token < in JSON")), false);
});

test("a caller that asks to be told: a failure that may pass is thrown to it; one asking with it, not asking, gets null", async () => {
  const store = new Map();
  let land = () => {};
  const run = () => new Promise((resolve, reject) => { land = () => reject(httpError(429)); });
  const told = lookupOnce(store, "k", run, { throwPassing: true });
  const plain = lookupOnce(store, "k", run);
  await later();
  land();
  await assert.rejects(told, /HTTP 429/);
  assert.equal(await plain, null);
  assert.equal(store.has("k"), false);
  assert.equal(await lookupOnce(store, "gone", async () => { throw httpError(404); }, { throwPassing: true }), null,
    "a failure that will not pass is still the answer, to every caller");
});

test("one lookup per key at a time: a second ask while the first is out gets the first's answer", async () => {
  const store = new Map();
  let runs = 0;
  let land = () => {};
  const run = () => { runs++; return new Promise((r) => { land = () => r("found"); }); };
  const first = lookupOnce(store, "k", run);
  const second = lookupOnce(store, "k", run);
  await later();
  assert.equal(runs, 1, "the second ask did not start a lookup of its own");
  land();
  assert.deepEqual([await first, await second], ["found", "found"]);
  assert.equal(await lookupOnce(store, "k", run), "found");
  assert.equal(runs, 1, "and an answer is remembered");
  assert.equal(await lookupOnce(store, "other", async () => "else"), "else", "keys apart");
});

test("an answer is remembered, nothing-there and a refusal that will not change included; a failure that may pass is not", async () => {
  const store = new Map();
  let runs = 0;
  assert.equal(await lookupOnce(store, "none", async () => { runs++; return null; }), null);
  assert.equal(await lookupOnce(store, "none", async () => { runs++; return "late"; }), null, "nothing there is an answer");
  assert.equal(await lookupOnce(store, "gone", async () => { runs++; throw httpError(404); }), null);
  assert.equal(await lookupOnce(store, "gone", async () => { runs++; return "late"; }), null, "a 404 is an answer");
  assert.equal(runs, 2);

  assert.equal(await lookupOnce(store, "busy", async () => { throw httpError(429); }), null);
  assert.equal(store.has("busy"), false, "a 429 is not remembered");
  assert.equal(await lookupOnce(store, "busy", async () => "found"), "found", "the next ask tries again");
  assert.equal(await lookupOnce(store, "slow", async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); }), null);
  assert.equal(store.has("slow"), false, "a time limit is not remembered");

  const partly = await lookupOnce(store, "half", async () => { throw Object.assign(httpError(503), { value: { album: "a" } }); });
  assert.deepEqual(partly, { album: "a" }, "what was found in part is answered");
  assert.equal(store.has("half"), false, "and not remembered");
});

// ---- Wikipedia ---------------------------------------------------------------------------------------------------

const ALBUM_ARTICLE = { title: "Rumours (album)", extract: "Rumours is the eleventh studio album by Fleetwood Mac, released in 1977.", fullurl: "https://en.wikipedia.org/wiki/Rumours_(album)" };
const BAND_ARTICLE = { title: "Fleetwood Mac", extract: "Fleetwood Mac are a British-American rock band formed in London in 1967.", fullurl: "https://en.wikipedia.org/wiki/Fleetwood_Mac" };

/** A Wikipedia stand-in: its search and its extracts, each request counted; `fail` answers a request with an error. */
function fakeWikipedia(fail) {
  const asked = [];
  const httpJson = async (url) => {
    asked.push(url);
    await later();
    const f = fail && fail(url, asked.length);
    if (f) throw f;
    const q = decodeURIComponent(url);
    if (q.includes("list=search")) {
      if (q.includes('"Fleetwood Mac" "Rumours"')) return { query: { search: [{ title: "Fleetwood Mac" }] } };
      if (q.includes("band musician singer")) return { query: { search: [{ title: "Fleetwood Mac" }] } };
      return { query: { search: [{ title: "Rumours (album)" }] } };
    }
    const page = q.includes("titles=Fleetwood Mac") ? BAND_ARTICLE : ALBUM_ARTICLE;
    return { query: { pages: { 1: page } } };
  };
  const normalize = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
  const namesEqualLoose = (a, b) => normalize(a).replace(/^the /, "") === normalize(b).replace(/^the /, "");
  const w = createWikiLookup({ httpJson, normalize, namesEqualLoose, userAgent: "test", cache: new Map() });
  return { w, asked };
}

test("THE one: the album view's Wikipedia lookup and the share card's are one, not two", async () => {
  const { w, asked } = fakeWikipedia();
  const view = w.fetchWikipedia("Rumours", "Fleetwood Mac");
  const card = w.fetchWikipedia("Rumours", "Fleetwood Mac");
  const [a, b] = await Promise.all([view, card]);
  assert.equal(a.album.title, "Rumours (album)");
  assert.equal(a.artist.name, "Fleetwood Mac");
  assert.deepEqual(b, a);
  assert.equal(asked.length, 5, "one lookup's requests: two searches, two extracts and the artist's cross-check");
  await w.fetchWikipedia("Rumours", "Fleetwood Mac");
  assert.equal(asked.length, 5, "remembered");
});

test("Wikipedia's 429 is not remembered as no article: the next ask finds it", async () => {
  let busy = true;
  const { w, asked } = fakeWikipedia(() => (busy ? httpError(429) : null));
  assert.equal(await w.fetchWikipedia("Rumours", "Fleetwood Mac"), null);
  busy = false;
  const again = await w.fetchWikipedia("Rumours", "Fleetwood Mac");
  assert.equal(again && again.album && again.album.title, "Rumours (album)");
  assert.ok(asked.length > 2);
});

test("one half failing for now: the other half's article is shown, and the lookup is asked again later", async () => {
  // The artist's cross-check search is the one Wikipedia refuses.
  let busy = true;
  const { w } = fakeWikipedia((url) => (busy && decodeURIComponent(url).includes('"Fleetwood Mac" "Rumours"') ? httpError(429) : null));
  const first = await w.fetchWikipedia("Rumours", "Fleetwood Mac");
  assert.equal(first.album.title, "Rumours (album)");
  assert.equal(first.artist, null);
  busy = false;
  const second = await w.fetchWikipedia("Rumours", "Fleetwood Mac");
  assert.equal(second.artist && second.artist.name, "Fleetwood Mac", "asked again, and found");
});

test("an album Wikipedia has no article for is remembered as such", async () => {
  const asked = [];
  const none = createWikiLookup({ httpJson: async (url) => { asked.push(url); return { query: { search: [] } }; },
    normalize: (x) => String(x).toLowerCase(), namesEqualLoose: () => false, userAgent: "t", cache: new Map() });
  assert.equal(await none.fetchWikipedia("Nothing", "Nobody"), null);
  const n = asked.length;
  assert.equal(await none.fetchWikipedia("Nothing", "Nobody"), null);
  assert.equal(asked.length, n, "not asked again");
});

// ---- MusicBrainz's year and Pitchfork's review, in index.js ------------------------------------------------------

test("MusicBrainz's year: the share card's ask waits for the album view's; a 503 is asked again", async () => {
  let calls = 0, answer = null;
  const Y = loadIndexFunctions(["fetchAlbumYear", "yearOfDate"], {
    normalize: (s) => String(s).toLowerCase(), mbCache: new Map(), mbWait: async () => {}, lookupOnce,
    mbQuote: (s) => s, MB_USER_AGENT: "test", DEBUG: false,
    httpJson: async () => { calls++; await later(); if (answer) throw answer; return { "release-groups": [{ "first-release-date": "1977-02-04" }] }; },
  });
  const [view, card] = await Promise.all([Y.fetchAlbumYear("Rumours", "Fleetwood Mac"), Y.fetchAlbumYear("Rumours", "Fleetwood Mac")]);
  assert.deepEqual([view, card, calls], ["1977", "1977", 1]);
  answer = httpError(503);
  assert.equal(await Y.fetchAlbumYear("Tusk", "Fleetwood Mac"), null);
  answer = null;
  assert.equal(await Y.fetchAlbumYear("Tusk", "Fleetwood Mac"), "1977", "the 503 was not remembered");
});

test("Pitchfork: a review that is not there (404) is remembered; a 429 is asked again", async () => {
  let calls = 0, status = 404;
  const P = loadIndexFunctions(["fetchPitchfork", "fetchPitchforkOnce"], {
    normalize: (s) => String(s).toLowerCase(), pitchforkCache: new Map(), lookupOnce, pitchforkWait: async () => {},
    slugifyForPitchfork: (s) => String(s).toLowerCase().replace(/\s+/g, "-"), firstSignificantToken: (s) => String(s).toLowerCase().split(" ")[0],
    parsePitchforkReviewHtml: () => ({ description: "fleetwood review", score: 9.1, isBestNewMusic: false }),
    BROWSER_UA: "t", DEBUG: false,
    httpText: async () => { calls++; if (status) throw httpError(status); return "<html>"; },
  });
  assert.equal(await P.fetchPitchfork("Rumours", "Fleetwood Mac"), null);
  status = 0;
  assert.equal(await P.fetchPitchfork("Rumours", "Fleetwood Mac"), null, "no review: remembered");
  assert.equal(calls, 1);
  status = 429;
  assert.equal(await P.fetchPitchfork("Tusk", "Fleetwood Mac"), null);
  status = 0;
  const found = await P.fetchPitchfork("Tusk", "Fleetwood Mac");
  assert.equal(found && found.score, 9.1, "the 429 was not remembered");
});

test("Qobuz: a search with no such album is remembered; a 429 is asked again", async () => {
  let calls = 0, fail = null, page = "<html>no albums here</html>";
  const Q = loadIndexFunctions(["fetchQobuz", "fetchQobuzOnce"], {
    normalize: (s) => String(s).toLowerCase(), qobuzCache: new Map(), lookupOnce, qobuzWait: async () => {},
    firstSignificantToken: (s) => String(s).toLowerCase().split(" ")[0], BROWSER_UA: "t", DEBUG: false,
    labelDiskCache: new Map(), isLikelyNotALabel: () => false, setLabelName: () => {}, labelsIndexAddAlbum: () => {},
    albumIndex: { albums: [] },
    httpText: async () => { calls++; if (fail) throw fail; return page; },
  });
  assert.equal(await Q.fetchQobuz("Rumours", "Fleetwood Mac"), null);
  assert.equal(await Q.fetchQobuz("Rumours", "Fleetwood Mac"), null);
  assert.equal(calls, 1, "nothing there: remembered");
  fail = httpError(429);
  assert.equal(await Q.fetchQobuz("Tusk", "Fleetwood Mac"), null);
  fail = null;
  await Q.fetchQobuz("Tusk", "Fleetwood Mac");
  assert.equal(calls, 3, "the 429 was not remembered: asked again");
});

test("Qobuz: the labels scan is told of a failure that may pass (its stop after ten in a row works); a label not saved keeps the review", async () => {
  let fail = null, saveFails = false;
  const SEARCH = '<a href="/us-en/album/rumours-fleetwood-mac/abc123">Rumours</a>';
  const ALBUM = '<p>Album Review: Fleetwood Mac - Rumours\nA record about the band coming apart while making the best music of their lives, and selling forty million copies.\nAbout the album</p>' +
    'Released on 2/4/1977 by <a href="/l">Warner Records</a>';
  const Q = loadIndexFunctions(["fetchQobuz", "fetchQobuzOnce"], {
    normalize: (s) => String(s).toLowerCase(), qobuzCache: new Map(), lookupOnce, qobuzWait: async () => {},
    firstSignificantToken: (s) => String(s).toLowerCase().split(" ")[0], BROWSER_UA: "t", DEBUG: false,
    stripHtml: (h) => String(h).replace(/<[^>]*>/g, ""), leadArtistOf: () => null, namesOverlap: () => true, escapeReg: (x) => x,
    labelDiskCache: new Map(), isLikelyNotALabel: () => false, labelsIndexAddAlbum: () => {}, albumIndex: { albums: [] },
    setLabelName: () => { if (saveFails) throw new Error("attempt to write a readonly database"); },
    httpText: async (url) => { if (fail) throw fail; return url.indexOf("/search") > -1 ? SEARCH : ALBUM; },
  });
  fail = httpError(429);
  await assert.rejects(Q.fetchQobuz("Tusk", "Fleetwood Mac", { throwPassing: true }), /HTTP 429/, "the scan sees it");
  assert.equal(await Q.fetchQobuz("Tusk", "Fleetwood Mac"), null, "the album view does not");
  fail = null; saveFails = true;
  const found = await Q.fetchQobuz("Rumours", "Fleetwood Mac");
  assert.equal(found && found.label, "Warner Records", "the review and label found are answered");
  saveFails = false;
  assert.equal((await Q.fetchQobuz("Rumours", "Fleetwood Mac")).label, "Warner Records", "and remembered");
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "..", "index.js"), "utf8");
  assert.match(src, /fetchQobuz: fetchQobuzForScan,/, "the labels scan is given the lookup that tells it");
});
test("the wall display's artist bio: a failure that may pass is not remembered; one that will not is, as before", async () => {
  let fail = httpError(429);
  const D = loadIndexFunctions(["fetchDisplayArtistBio"], {
    normalize: (s) => String(s || "").toLowerCase(), displayArtistBioCache: new Map(), DISPLAY_BIO_CACHE_MAX: 100, mayPass,
    fetchServiceArtistBio: async () => null,
    fetchWikiArtist: async () => { if (fail) throw fail; return { name: "Camel", description: "An English band." }; },
  });
  assert.equal(await D.fetchDisplayArtistBio("Camel", "Moonmadness"), null);
  fail = null;
  assert.equal((await D.fetchDisplayArtistBio("Camel", "Moonmadness")).name, "Camel", "asked again, and found");
  fail = new TypeError("Cannot read properties of undefined");
  assert.equal(await D.fetchDisplayArtistBio("Yes", "Fragile"), null);
  fail = null;
  assert.equal(await D.fetchDisplayArtistBio("Yes", "Fragile"), null, "a fault of its own: remembered, as before");
});
