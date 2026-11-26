"use strict";
// ---------------------------------------------------------------------------
// The Artists screen asks for the photos of the names on screen without waiting for a frame (dev/lessons.md: an
// observer reports at a frame, and the harness's clock can outrun frames). artists-screen.test.js timed out once on
// dev's CI at "the photos asked for": the asking began only when an IntersectionObserver reported, which needs a
// frame, and virtual time ran past the wait before one came. Here the observer never reports — a page with no frame
// yet — and the names on screen must be asked for all the same; the ones far below are left to the observer, which is
// what keeps the asking to what is seen. Broken on purpose once (the measuring at opening left out) and failed.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const NAMES = Array.from({ length: 160 }, (_, i) => "Artist " + String(i).padStart(3, "0"));
const ARTISTS = NAMES.map((name) => ({ name, albums: 1, cover: null, photo: null, letter: "A" }));

const STUB = `
window.__asked = [];
// No frame yet: the observer is made and watches, and never reports.
window.IntersectionObserver = function () { return { observe: function () {}, unobserve: function () {}, disconnect: function () {} }; };
window.__installFetch(function (u) {
  if (u.indexOf("/api/artists/photos") > -1) { window.__asked.push(decodeURIComponent(u)); return window.__json({ photos: {} }); }
  if (u.indexOf("/api/artists") > -1) return window.__json({ ready: true, artists: ${JSON.stringify(ARTISTS)} });
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});
`;

const DRIVER = `
  await window.__sleep(800);
  document.getElementById("tnav-artists").click();
  for (var i = 0; i < 40 && !document.querySelectorAll(".artist-tile").length; i++) await window.__sleep(50);
  await window.__sleep(2000);   // past every batch (60 names each, 250 ms apart), on the virtual clock
  var asked = window.__asked.join("|");
  T("asked", { calls: window.__asked.length, first: asked.indexOf("n=Artist 000") > -1, last: asked.indexOf("n=Artist 159") > -1,
    tiles: document.querySelectorAll(".artist-tile").length });
`;

test("the Artists screen asks for the photos on screen before any frame (the flake of artists-screen.test.js)", { skip: !harness.available && "no chromium" }, () => {
  const R = harness.renderPage({ stub: STUB, driver: DRIVER, name: "artists-no-frame", windowSize: "390x844", budgetMs: 15000 });
  harness.assertNoPageError(assert, R);
  assert.equal(R.asked.tiles, 160);
  assert.ok(R.asked.calls >= 1 && R.asked.first, "THE one: nothing asked for until an observer reported, which waits for a frame");
  assert.equal(R.asked.last, false, "a name far below the screen asked for: the asking is no longer kept to what is seen");
});
