"use strict";
// ---------------------------------------------------------------------------
// v2.0.3-t5: a share card's timings, sent to the server's log.
//
// A card that took many seconds said nothing about where they went. The page now times each part of making it (the
// font, the extras round trip, the pictures, the drawing, the PNG) and sends them to POST /api/debug/share-card,
// against the extras answer's trace id (X-Rouen-Trace), where they sit beside what the server's lookups waited on.
// A card of two seconds or more also says so on the console, which the Android app's log keeps (PAGE).
//
// The renderer is replaced with one that fills in its part of the timings, as the real one does, so this checks the
// wiring: that the timings reach the renderer, are sent once, name the right answer, and say how the card ended.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

function stub(extrasDelay) {
  return `
try { localStorage.setItem("rra-zone", "z1"); } catch (e) {}  // storage optional
window.__posts = [];
window.__warns = [];
var realWarn = console.warn;
console.warn = function () { window.__warns.push(Array.prototype.join.call(arguments, " ")); return realWarn.apply(console, arguments); };
window.__installFetch(function (u, opts) {
  if (u.indexOf("/api/debug/share-card") > -1) { window.__posts.push(JSON.parse(opts.body)); return window.__json({ kept: true }); }
  if (u.indexOf("/api/album/extras") > -1) {
    return window.__sleep(${extrasDelay}).then(function () {
      return new Response(JSON.stringify({ year: 1995, album: { description: "Timeless is the debut studio album by Goldie.",
        description_source: "Wikipedia", label: "FFRR" }, artist: null, links: { services: [], reviews: [] } }),
        { status: 200, headers: { "Content-Type": "application/json", "X-Rouen-Trace": "7",
          "Server-Timing": "year;dur=2310, qobuz;dur=4870, total;dur=4900" } });
    });
  }
  if (u.indexOf("/api/zones") > -1)      return window.__json({ zones: [{ zone_id: "z1", display_name: "Zone", state: "stopped", outputs: [] }] });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: null });
  if (u.indexOf("/api/home/") > -1)      return window.__json({ albums: [], label: null });
  if (u.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1)           return window.__json({});
  return undefined;
});
`;
}

const OPEN = `
  await window.__sleep(600);
  window.__rendered = null;
  window.__timingArg = null;
  ShareCard.render = function (data, timing) {
    window.__rendered = data;
    window.__timingArg = timing && typeof timing === "object";
    if (timing) { timing.images_ms = 5; timing.draw_ms = 30; timing.encode_ms = 60; timing.cover = true; timing.width = 1200; }
    return Promise.resolve(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }));
  };
  window.__openShareCard({ title: "Timeless", artist: "Goldie", image_key: "k0" });
`;

const DRAWN = OPEN + `
  for (var w = 0; w < 60 && !window.__posts.length; w++) await window.__sleep(100);
  await window.__sleep(300);
  T("posts", window.__posts);
  T("timing_arg", window.__timingArg);
  T("label", window.__rendered ? (window.__rendered.label || "") : "no render");
  T("extras_url", window.__calls.filter(function (u) { return u.indexOf("/api/album/extras") > -1; }));
  T("warns", window.__warns.filter(function (w) { return w.indexOf("share card") > -1; }));
`;

const CLOSED = OPEN + `
  await window.__sleep(200);
  var x = document.querySelector("#share-overlay [data-share-close]");
  if (x) x.click();
  await window.__sleep(3000);
  T("posts", window.__posts);
  T("rendered", !!window.__rendered);
`;

test("a share card's timings reach the server's log, once, against its extras answer", { skip: !harness.available && "no chromium" }, () => {
  const R = harness.renderPage({ stub: stub(50), driver: DRAWN, name: "share-card-timing", windowSize: "390x844" });
  harness.assertNoPageError(assert, R);
  assert.equal(R.timing_arg, true, "the renderer is given the card's timings to fill in");
  assert.equal(R.posts.length, 1, "sent once");
  const p = R.posts[0];
  assert.equal(p.result, "drawn");
  assert.equal(p.trace, "7", "named by the extras answer's X-Rouen-Trace");
  assert.equal(p.extras_status, 200);
  for (const k of ["total_ms", "font_ms", "extras_ms"]) assert.equal(typeof p[k], "number", k + " is timed");
  assert.equal(p.images_ms, 5, "the renderer's own parts come through");
  assert.equal(p.encode_ms, 60);
  assert.equal(p.where, "browser");
  assert.ok(!("t0" in p) && !("server" in p) && !("sent" in p), "only the timings, not the bookkeeping: " + Object.keys(p));
  assert.ok(!JSON.stringify(p).includes("Timeless"), "no album in what is sent");
  assert.match(R.extras_url[0], /[?&]for=card(&|$)/, "the server is told the share card asked");
  assert.deepEqual(R.warns, [], "a quick card says nothing on the console");
  // Mandarin's look (v2.0.3-t5): the release line is the date alone, so the label is not handed to the card.
  assert.equal(R.label, "");
});

test("a slow card says where its time went on the console, for the Android app's log", { skip: !harness.available && "no chromium" }, () => {
  const R = harness.renderPage({ stub: stub(2600), driver: DRAWN, name: "share-card-timing-slow", windowSize: "390x844" });
  harness.assertNoPageError(assert, R);
  assert.equal(R.posts.length, 1);
  assert.ok(R.posts[0].extras_ms >= 2500, "the round trip was timed: " + R.posts[0].extras_ms);
  assert.equal(R.warns.length, 1, "one line: " + JSON.stringify(R.warns));
  assert.match(R.warns[0], /^share card slow \(#7, drawn\): \d+ ms — font \d+ ms( \((gave up|failed)\))?, server \d+ ms \(HTTP 200; year;dur=2310, qobuz;dur=4870, total;dur=4900\), pictures 5 ms, drawing 30 ms, PNG 60 ms$/);
  assert.ok(!R.warns[0].includes("Timeless"), "no album on the console");
});

test("a card given up on (the sheet shut first) says so, and is not drawn", { skip: !harness.available && "no chromium" }, () => {
  const R = harness.renderPage({ stub: stub(1500), driver: CLOSED, name: "share-card-timing-closed", windowSize: "390x844" });
  harness.assertNoPageError(assert, R);
  assert.equal(R.rendered, false, "a shut sheet's card is not drawn");
  assert.equal(R.posts.length, 1, "sent once, when it was given up on");
  assert.equal(R.posts[0].result, "closed");
});
