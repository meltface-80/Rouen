"use strict";
// ---------------------------------------------------------------------------
// v2.0.3-t5: what a share card waited on, in the log.
//
// The card is drawn only once /api/album/extras answers, and that answer waits on four outside sites at once. A slow
// card said nothing about which. lib/share-trace.js records each extras answer's steps and every outside request each
// made; lib/http.js tells it of each request; lib/routes/album-extras.js (moved out of index.js in the same build)
// runs each answer as one trace. These drive the real http.js with fetch stood in for, so the attribution that matters
// (a request made deep inside a lookup lands on the right step of the right answer) is the shipping path.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createShareTrace, siteOf } = require("../../lib/share-trace");
const http = require("../../lib/http");
const { mountAlbumExtras, callerOf } = require("../../lib/routes/album-extras");

// A clock the test moves, and fetch answered by host after a delay on that clock.
function rig() {
  let t = 1000;
  const waiters = [];
  const clock = { now: () => t };
  const advance = async (ms) => {
    const until = t + ms;
    await new Promise((res) => { setImmediate(res); });     // what is already settled ends at the time it settled
    for (;;) {
      waiters.sort((a, b) => a.at - b.at);
      const next = waiters[0];
      if (!next || next.at > until) break;
      waiters.shift();
      t = next.at;
      next.fn();
      await new Promise((res) => { setImmediate(res); });   // everything that answer set going, before the clock moves
    }
    t = until;
  };
  const sleep = (ms) => new Promise((r) => { waiters.push({ at: t + ms, fn: r }); });
  return { clock, advance, sleep };
}

function withFetch(r, answers, fn) {
  const real = globalThis.fetch, realNow = Date.now;
  globalThis.fetch = async (url) => {
    const host = new URL(url).hostname;
    const a = answers[host] || { ms: 10, status: 200 };
    await r.sleep(a.ms);
    return { ok: a.status === 200, status: a.status, json: async () => ({}), text: async () => "" };
  };
  Date.now = r.clock.now;
  return Promise.resolve(fn()).finally(() => { globalThis.fetch = real; Date.now = realNow; });
}

test("each outside site is named by its host", () => {
  assert.equal(siteOf("https://musicbrainz.org/ws/2/release-group/?query=x"), "musicbrainz");
  assert.equal(siteOf("https://www.qobuz.com/us-en/search?q=x"), "qobuz");
  assert.equal(siteOf("https://en.wikipedia.org/w/api.php"), "wikipedia");
  assert.equal(siteOf("https://pitchfork.com/reviews/albums/x/"), "pitchfork");
  assert.equal(siteOf("not a url"), "other");
});

test("THE one: an extras answer says which step it waited on, its requests, and the wait before them", async () => {
  const r = rig();
  const logged = [];
  const tr = createShareTrace({ now: r.clock.now, log: (l) => logged.push(l) });
  http.setHttpObserver(tr.request);
  try {
    await withFetch(r, {
      "musicbrainz.org": { ms: 300, status: 200 },
      "www.qobuz.com": { ms: 2000, status: 200 },
      "pitchfork.com": { ms: 100, status: 404 },
    }, async () => {
      const run = tr.run({ caller: "card", key: "timeless||goldie", title: "Timeless", artist: "Goldie" }, async (t) => {
        await Promise.all([
          // The year waits 1100 ms in its rate limit's queue before it asks.
          tr.step("year", async () => { await r.sleep(1100); return http.httpJson("https://musicbrainz.org/ws/2/x?query=Timeless", {}); }),
          // Qobuz: a search, then the album page.
          tr.step("qobuz", async () => {
            await http.httpText("https://www.qobuz.com/us-en/search?q=Timeless", {});
            return http.httpText("https://www.qobuz.com/us-en/album/timeless/1", {});
          }),
          tr.step("pitchfork", () => http.httpText("https://pitchfork.com/reviews/albums/goldie-timeless/", {})).catch(() => null),
          // Wikipedia was remembered: no request at all.
          tr.step("wikipedia", async () => ({ album: null })),
        ]);
        t.status = "answered";
      });
      await r.advance(5000);
      await run;
    });
  } finally {
    http.setHttpObserver(null);
  }
  const [got] = tr.recent();
  assert.equal(got.caller, "card");
  assert.equal(got.album, "Timeless — Goldie");
  assert.equal(got.ms, 4000, "the answer took as long as Qobuz's two pages");
  const step = Object.fromEntries(got.steps.map((s) => [s.step, s]));
  assert.equal(step.qobuz.ms, 4000);
  assert.equal(step.qobuz.requests, 2);
  assert.equal(step.year.waited_ms, 1100, "the year's time in the queue, before its one request");
  assert.equal(step.year.ms, 1400);
  assert.equal(step.wikipedia.remembered, true);
  assert.equal(step.pitchfork.outcome, "error");
  const pf = got.requests.find((q) => q.site === "pitchfork");
  assert.equal(pf.status, "404");
  assert.equal(pf.path, "/reviews/albums/goldie-timeless/");
  assert.ok(got.requests.every((q) => !/Timeless/.test(q.path) || q.site !== "musicbrainz"), "no query in a path");
  assert.equal(logged.length, 1, "a card's answer is always logged");
  assert.match(logged[0], /^\[share-card\] #1 card "Timeless — Goldie": 4000 ms, answered/);
  assert.match(logged[0], /qobuz 4000 ms \(2 req\)/);
  assert.match(logged[0], /year 1400 ms \(1 req, waited 1100 ms\)/);
  assert.match(logged[0], /pitchfork 100 ms \(1 req, 404\)/);
  assert.match(logged[0], /wikipedia 0 ms \(remembered\)/);
});

test("a request made outside an extras answer is not kept, and a quick album view's answer is not logged", async () => {
  const r = rig();
  const logged = [];
  const tr = createShareTrace({ now: r.clock.now, log: (l) => logged.push(l) });
  http.setHttpObserver(tr.request);
  try {
    await withFetch(r, {}, async () => {
      const stray = http.httpJson("https://musicbrainz.org/ws/2/label", {});   // the label scan's, say
      const run = tr.run({ caller: "album", key: "k", title: "T", artist: "A" }, async (t) => {
        await tr.step("year", () => http.httpJson("https://musicbrainz.org/ws/2/x", {}));
        t.status = "answered";
      });
      await r.advance(100);
      await Promise.all([stray, run]);
      // Work an answer set going, still asking after it finished, adds nothing to it.
      let late = null;
      await tr.run({ caller: "album", key: "k2", title: "T2", artist: "A" }, async (t) => {
        late = (async () => { await r.sleep(50); return http.httpJson("https://musicbrainz.org/ws/2/later", {}); })();
        t.status = "answered";
      });
      await r.advance(100);
      await late;
    });
  } finally {
    http.setHttpObserver(null);
  }
  assert.equal(tr.recent()[0].requests.length, 0, "a finished answer takes no more requests");
  const got = tr.recent()[1];
  assert.equal(got.requests.length, 1, "only the answer's own request");
  assert.equal(logged.length, 0, "an album view's answer under 2 s is not logged");
});

test("the share card and the album view asking for one album at once are each told of the other", async () => {
  const r = rig();
  const tr = createShareTrace({ now: r.clock.now });
  const first = tr.run({ caller: "album", key: "k", title: "T", artist: "A" }, async (t) => { await r.sleep(500); t.status = "answered"; });
  const second = tr.run({ caller: "card", key: "k", title: "T", artist: "A" }, async (t) => { await r.sleep(500); t.status = "answered"; });
  const other = tr.run({ caller: "card", key: "other", title: "O", artist: "A" }, async (t) => { t.status = "answered"; });
  await r.advance(1000);
  await Promise.all([first, second, other]);
  const byCaller = tr.recent().filter((x) => x.album === "T — A");
  const card = byCaller.find((x) => x.caller === "card");
  assert.deepEqual(card.alongside, [1], "the card's answer started while the album view's was out");
  assert.deepEqual(tr.recent().find((x) => x.album === "O — A").alongside, []);
});

test("the page's steps are kept on the answer they name, cleaned, or on their own", () => {
  const tr = createShareTrace();
  return tr.run({ caller: "card", key: "k", title: "T", artist: "A" }, async (t) => { t.status = "answered"; }).then(() => {
    const id = tr.recent()[0].id;
    assert.equal(tr.client({ trace: String(id), total_ms: 812.4, font_ms: 40, cover: true, result: "drawn",
      error: "x".repeat(300), title: "never kept", extras_ms: "slow" }), true);
    const page = tr.recent()[0].page;
    assert.deepEqual(Object.keys(page).sort(), ["cover", "error", "font_ms", "result", "total_ms"]);
    assert.equal(page.total_ms, 812);
    assert.equal(page.error.length, 120);
    assert.equal(tr.client({ trace: 999, total_ms: 9000, result: "failed" }), true, "an answer not kept: on its own");
    assert.equal(tr.recent()[0].status, "page only");
    assert.equal(tr.client({ title: "nothing to keep" }), false);
    assert.equal(tr.client(null), false);
  });
});

test("who asked: the share card says so, the album view asks for the day", () => {
  assert.equal(callerOf({ for: "card" }), "card");
  assert.equal(callerOf({ day: "1" }), "album");
  assert.equal(callerOf({}), "other");
});

test("the extras route answers as before, with Server-Timing and the trace's id; the debug routes list it", async () => {
  const tr = createShareTrace();
  const routes = {};
  const app = { get: (p, fn) => { routes["GET " + p] = fn; }, post: (p, fn) => { routes["POST " + p] = fn; } };
  mountAlbumExtras(app, {
    normalize: (s) => String(s).toLowerCase(), lookUpAlbumDay: async () => false,
    fetchAlbumYear: async () => "1995",
    fetchAlbumBios: async () => ({ album: { description: "D", year: "1996" }, artist: null, urls: {} }),
    notePageYear: () => {}, storedReleaseDate: () => "1995-08-07", albumReleaseOf: () => null,
    labelDiskCache: new Map([["timeless||goldie", "FFRR"]]), TYPE_NAMES: {}, ALBUM_PAGE_DAY_WAIT_MS: 1500,
    loadPersistedSettings: () => ({}), enabledServices: () => [], enabledReviews: () => [],
    shareLinks: { serviceLinks: () => [], reviewLinks: () => [], localeFromAcceptLanguage: () => "en" },
    trace: tr,
  });
  const call = (key, req) => new Promise((resolve) => {
    const headers = {};
    let status = 200;
    const res = {
      set(k, v) { headers[k] = v; return this; },
      status(c) { status = c; return this; },
      json(b) { resolve({ status, body: b, headers }); return this; },
    };
    routes[key](Object.assign({ query: {}, headers: {} }, req), res);
  });
  const a = await call("GET /api/album/extras", { query: { title: "Timeless", artist: "Goldie", for: "card" } });
  assert.equal(a.status, 200);
  assert.equal(a.body.year, "1995");
  assert.equal(a.body.album.year, "1995", "MusicBrainz's year over the edition's");
  assert.equal(a.body.album.label, "FFRR");
  assert.equal(a.body.release_date, "1995-08-07");
  assert.match(a.headers["Server-Timing"], /^year;dur=\d+, total;dur=\d+$/);
  assert.equal(a.headers["X-Rouen-Trace"], "1");
  const missing = await call("GET /api/album/extras", { query: {} });
  assert.equal(missing.status, 400);
  await call("POST /api/debug/share-card", { body: { trace: "1", total_ms: 700, result: "drawn" } });
  const list = await call("GET /api/debug/share-card", {});
  assert.equal(list.body.requests[0].caller, "card");
  assert.equal(list.body.requests[0].status, "answered");
  assert.equal(list.body.requests[0].page.total_ms, 700);
});
