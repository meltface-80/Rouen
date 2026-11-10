"use strict";
// ---------------------------------------------------------------------------
// 2.0.4-t6: the A–Z strip on a playlist (public/playlist-az.js, dev/design/playlist-artists.md §8). gert_mogensen, the
// Roon forum, 2026-11-10: "I have a playlist with 1500 songs, it would be nice if i could jump to the letter S instead
// of scrolling"; the owner chose: only when sorted by Title or Artist. The shipping page at 390x844, touch; the server a
// stand-in (playlist-play-kit.js: Rosanna/Toto, Billie Jean/Michael Jackson, Lowdown/Boz Scaggs, Another Day/—,
// Roxanne/The Police).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, TOUCH, HELPERS } = require("./playlist-head-kit");
const { STUB, LOOK } = require("./playlist-play-kit");

const DRIVER = HELPERS + LOOK + `
  var went = [];
  var real = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (o) { went.push(this.querySelector && this.querySelector(".track-title") ? this.querySelector(".track-title").textContent : "?"); return real.call(this, o); };
  var strip = function () { var s = document.querySelector(".playlist-detail .playlist-az"); if (!s) return null;
    var q = s.getBoundingClientRect();
    return { seen: !s.classList.contains("hidden") && q.height > 0, right: Math.round(innerWidth - q.right), h: Math.round(q.height), vh: innerHeight,
      live: Array.prototype.filter.call(s.children, function (b) { return !b.classList.contains("is-empty"); }).map(function (b) { return b.dataset.letter; }) }; };
  var tap = function (l) { var b = document.querySelector('.playlist-detail .playlist-az-letter[data-letter="' + l + '"]'); var q = b.getBoundingClientRect();
    var o = { pointerId: 5, clientX: q.left + q.width / 2, clientY: q.top + q.height / 2, bubbles: true, pointerType: "touch", isPrimary: true };
    b.dispatchEvent(new PointerEvent("pointerdown", o)); b.dispatchEvent(new PointerEvent("pointerup", o)); };
  await menu("playlists");
  await open("Session Work");
  T("order", strip());
  await sort("title");
  T("title", strip());
  went.length = 0; tap("R"); T("r", went.slice());
  went.length = 0; tap("C"); T("c", went.slice());
  went.length = 0; tap("Z"); T("z", went.slice());
  await sort("artist");
  T("artist", strip());
  went.length = 0; tap("P"); T("p", went.slice());
  // A find typed: its hidden rows passed over.
  document.getElementById("tnav-search").click();
  await window.__sleep(150);
  var f = document.querySelector(".playlist-detail .playlist-find-input"); f.value = "ro"; f.dispatchEvent(new Event("input", { bubbles: true }));
  await window.__sleep(100);
  T("found", strip());
  await sort("order");
  T("back", strip());
`;

test("A–Z on a playlist sorted by Title or Artist (2.0.4-t6)", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const r = harness.renderPage({ stub: STUB, driver: DRIVER, name: "playlist-az", windowSize: "390x844", chromeArgs: TOUCH, budgetMs: 60000 });
  harness.assertNoPageError(assert, r);

  await t.test("THE one: hidden in Playlist order; sorted by title, down the right edge, the letters with rows lit", () => {
    assert.equal(r.order.seen, false);
    assert.equal(r.title.seen, true);
    assert.ok(r.title.right <= 4, "at the right edge: " + r.title.right);
    assert.ok(r.title.h <= r.title.vh * 0.65, "not over the bars");
    assert.deepEqual(r.title.live, ["A", "B", "L", "R"]);
  });
  await t.test("a tap brings the first row of that letter, else of the next letter that has one; none past the last", () => {
    assert.deepEqual(r.r, ["Rosanna"]);
    assert.deepEqual(r.c, ["Lowdown"], "C has none: L is next");
    assert.deepEqual(r.z, []);
  });
  await t.test("sorted by artist, the artist's letter, a lead The off; a find's hidden rows passed over; Playlist order hides it", () => {
    assert.deepEqual(r.artist.live, ["B", "M", "P", "T", "#"], "Another Day has no artist: #");
    assert.deepEqual(r.p, ["Roxanne"], "The Police under P");
    assert.deepEqual(r.found.live, ["P", "T"], "only Roxanne and Rosanna left");
    assert.equal(r.back.seen, false);
  });
});
