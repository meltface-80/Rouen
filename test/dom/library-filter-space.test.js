"use strict";
// ---------------------------------------------------------------------------
// v1.9.20: the Library wall's "Starts with…" field took no space (the
// owner's report). Every keystroke rebuilds the controls (applyLibView →
// renderLibraryControls), and the rebuilt field was filled from the TRIMMED
// filter — so "the " came back as "the" and the next letter ran on: "thew".
// Typed here as the browser types: the live field's value plus one character,
// then an input event, each time on whatever field is live after the rebuild.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const ALBUMS = [
  { offset: 0, title: "The Wall", subtitle: "Pink Floyd", image_key: "k0" },
  { offset: 1, title: "Theatre", subtitle: "Someone", image_key: "k1" },
];

const STUB = `
var ALBUMS = ${JSON.stringify(ALBUMS)};
window.__installFetch(function (url) {
  if (url.indexOf("/api/library/facets") > -1) return window.__json({ total: 2, dated: 0, decades: [], sources: [], hasPlays: false });
  if (url.indexOf("/api/library/albums") > -1) return window.__json({ albums: ALBUMS, offset: 0, total: ALBUMS.length });
  if (url.indexOf("/api/random-albums") > -1) return window.__json({ albums: ALBUMS, total: ALBUMS.length, filtered: false });
  if (url.indexOf("/api/zones") > -1) return window.__json({ zones: [] });
  if (url.indexOf("/api/home/") > -1) return window.__json({ albums: [], label: null });
  if (url.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (url.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});
try { localStorage.removeItem("rra-library-view"); } catch (e) {}
`;

test("the Library's Starts with… field takes a space (v1.9.20)", async (t) => {
  const r = harness.renderPage({ name: "library-filter-space", windowSize: "390x844", budgetMs: 15000, stub: STUB, driver: `
    await window.__sleep(400);
    document.getElementById("home-library-title").click();
    await window.__sleep(500);
    var filt = document.getElementById("library-filter");
    filt.querySelector(".lib-filter-btn").click();
    await window.__sleep(150);
    var live = function () { return filt.querySelector(".lib-filter-input"); };
    var typed = [];
    for (var ch of ["t", "h", "e", " ", "w"]) {
      var inp = live();
      inp.value = inp.value + ch;
      inp.dispatchEvent(new Event("input"));
      await window.__sleep(150);
      typed.push(live().value);
    }
    T("typed", typed);
    var hits = window.__calls.filter(function (u) { return u.indexOf("/api/library/albums") > -1; });
    T("prefix", new URLSearchParams((hits[hits.length - 1] || "").split("?")[1] || "").get("prefix"));
  ` });
  harness.assertNoPageError(assert, r);
  await t.test("THE one: the space stays in the field, and the next letter follows it", () => {
    assert.deepEqual(r.typed, ["t", "th", "the", "the ", "the w"]);
  });
  await t.test("what is asked for is what was typed", () => {
    assert.equal(r.prefix, "the w");
  });
});

test("a space typed, then Home: the field opens empty when the Library comes back", async () => {
  const r = harness.renderPage({ name: "library-filter-space-home", windowSize: "390x844", budgetMs: 15000, stub: STUB, driver: `
    await window.__sleep(400);
    document.getElementById("home-library-title").click();
    await window.__sleep(500);
    var filt = document.getElementById("library-filter");
    filt.querySelector(".lib-filter-btn").click();
    await window.__sleep(150);
    var inp = filt.querySelector(".lib-filter-input");
    inp.value = " "; inp.dispatchEvent(new Event("input"));
    await window.__sleep(200);
    window.__showHome();
    await window.__sleep(300);
    document.getElementById("home-library-title").click();
    await window.__sleep(500);
    filt.querySelector(".lib-filter-btn").click();
    await window.__sleep(150);
    T("value", filt.querySelector(".lib-filter-input").value);
  ` });
  harness.assertNoPageError(assert, r);
  assert.equal(r.value, "", "a space typed before leaving the wall came back in the field");
});
