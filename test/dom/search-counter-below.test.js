"use strict";
// ---------------------------------------------------------------------------
// v2.0.2: the Home search's results counter sits BELOW the field, not beside it.
//
// Reported from the Android app by a user with the phone's system font enlarged:
// typing "Metallica" showed only the last letters, the first couple never
// visible, and under heavy enlargement the letters even came out scrambled
// ("allicatme"). Two things combined. The WebView scales web text by the
// phone's font-size setting, so everything was larger than designed; and the
// results counter ("8 artists, 10 labels, 60+ albums", #search-status) is a
// flex SIBLING of the field's pill, so the longer the counter grew the less
// width the pill had — squeezed to a sliver, the typed text scrolled its start
// out of view.
//
// The counter moving to its own line below the pill is the half of the fix that
// is layout, and the half this file can see: the pill keeps the full width of
// the bar and the count drops beneath it. (The other half — capping the
// WebView's text zoom against the system font scale — lives in the Android
// shell, MainActivity, and is not web-testable here: CLAUDE.md.)
//
// WHAT IS PINNED, and why it is measured rather than assumed: with the counter
// present after a real search, #search-status's top is at or below the pill's
// bottom (its own line), and the pill's width is the row's full width. Before
// this change both are false — the status shares the pill's line and the pill
// is narrower than the row by the counter's width — which is the bug. The two
// positions compared (status vs pill, pill vs row) are read from one layout,
// one source (dev/lessons.md).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

// Enough artists, labels and albums that the counter is long — "8 artists,
// 10 labels, 60+ albums" — exactly the string that used to squeeze the field.
const ALBUMS = Array.from({ length: 60 }, (_, i) => ({
  offset: i, title: "Album " + (i + 1), subtitle: "Artist One", image_key: "k" + i,
}));
const ARTISTS = Array.from({ length: 8 }, (_, i) => ({ title: "Artist " + (i + 1), image_key: "a" + i }));
const LABELS = Array.from({ length: 10 }, (_, i) => ({ title: "Label " + (i + 1) }));

const STUB = `
var ALBUMS = ${JSON.stringify(ALBUMS)};
var ARTISTS = ${JSON.stringify(ARTISTS)};
var LABELS = ${JSON.stringify(LABELS)};
window.__installFetch(function (url) {
  if (url.indexOf("/api/search/external") > -1)
    return window.__json({ pitchfork: null });
  if (url.indexOf("/api/search") > -1)
    return window.__json({ albums: ALBUMS, artists: ARTISTS, labels: LABELS });
  if (url.indexOf("/api/library/albums") > -1)
    return window.__json({ albums: ALBUMS, offset: 0, total: ALBUMS.length });
  if (url.indexOf("/api/random-albums") > -1)
    return window.__json({ albums: ALBUMS, total: ALBUMS.length, filtered: false });
  if (url.indexOf("/api/zones") > -1)
    return window.__json({ zones: [{ zone_id: "z1", display_name: "Zone", state: "stopped", outputs: [] }] });
  if (url.indexOf("/api/zone-state") > -1) return window.__json({ zone: null });
  if (url.indexOf("/api/queue") > -1)      return window.__json({ items: [] });
  if (url.indexOf("/api/filters") > -1)    return window.__json({ genres: [] });
  if (url.indexOf("/api/home/") > -1)      return window.__json({ albums: [], label: null });
  if (url.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  if (url.indexOf("/api/settings") > -1)   return window.__json({});
  return undefined;
});
try { localStorage.removeItem("rra-library-view"); } catch (e) {}
`;

const DRIVER = `
  await window.__sleep(400);

  var glass  = document.getElementById("search-open");
  var box    = function () { return document.querySelector("#topbar-search .search-box"); };
  var status = function () { return document.getElementById("search-status"); };
  var row    = function () { return document.getElementById("search-row"); };
  var input  = function () { return document.getElementById("search-input"); };
  function rect(el) { return el.getBoundingClientRect(); }

  // Open the field and run a real search so the counter is populated.
  glass.click();
  await window.__sleep(120);
  input().value = "a";
  input().dispatchEvent(new Event("input", { bubbles: true }));
  await window.__sleep(600);

  var b = rect(box()), s = rect(status()), w = rect(row());
  T("status_text", status().textContent);
  T("status_top", Math.round(s.top));
  T("box_bottom", Math.round(b.bottom));
  T("box_width", Math.round(b.width));
  T("row_width", Math.round(w.width));
  // The counter is on its own line below the pill, not sharing the pill's line.
  T("status_below_box", Math.round(s.top) >= Math.round(b.bottom) - 1);
  // The pill keeps the full width of the row (the counter steals none of it).
  T("box_fills_row", Math.round(b.width) >= Math.round(w.width) - 2);
`;

test("the Home search counter sits below the field, pill keeps full width", { concurrency: 1 }, async (t) => {
  const r = harness.renderPage({
    stub: STUB, driver: DRIVER, name: "search-counter-below", windowSize: "390x844", chromeArgs: harness.MOUSE,
  });
  harness.assertNoPageError(assert, r);

  await t.test("the search actually ran and the counter is showing", () => {
    assert.match(String(r.status_text), /\d/,
      "the counter never populated — the geometry below would prove nothing");
  });

  await t.test("THE one: the counter is on its own line, below the pill", () => {
    assert.equal(r.status_below_box, true,
      "the counter still shares the pill's line (status top " + r.status_top +
      ", pill bottom " + r.box_bottom + ") — it squeezes the field as before");
  });

  await t.test("the pill keeps the full width of the bar", () => {
    assert.equal(r.box_fills_row, true,
      "the pill is narrower than the row (pill " + r.box_width + ", row " + r.row_width +
      ") — the counter is still stealing its width");
  });
});
