"use strict";
// ---------------------------------------------------------------------------
// The A–Z slider on a playlist (public/playlist-az.js, dev/design/playlist-artists.md §8). 2.0.4-t6 was a strip of
// letters (gert_mogensen, the Roon forum, 2026-11-10: "it would be nice if i could jump to the letter S"); the owner,
// 2026-11-10, seeing it on a phone, asked for a slider (t8) and chose: the circle follows the scroll, the list moves
// live as it is slid, each digit its own letter. Shown only when sorted by Title or Artist (t6's choice). The shipping
// page at 390x844, touch; the server a stand-in (playlist-play-kit.js) with a playlist of 52 tracks.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, TOUCH, HELPERS } = require("./playlist-head-kit");
const { STUB, LOOK, TRACKS } = require("./playlist-play-kit");

// Two titles a letter (no Q, no X), and two starting with a digit: long enough to run well past the screen.
const MANY = ["1999", "2 Become 1"].concat(..."ABCDEFGHIJKLMNOPRSTUVWYZ".split("").map((l) => [l + "ardvark", l + "zure"]))
  .map((title, index) => ({ index, title, subtitle: "Someone", image_key: null }));
const LONG = STUB.replace(JSON.stringify(TRACKS), JSON.stringify(MANY));

const DRIVER = HELPERS + LOOK + `
  var ol = function () { return document.querySelector(".playlist-detail ol.playlist-tracks"); };
  var box = function () { return document.querySelector(".playlist-detail .playlist-az"); };
  var thumb = function () { return box().querySelector(".playlist-az-thumb"); };
  var letter = function (s) { return window.RouenPlaylistAZ.letterOf(s); };
  // The top row on screen: the first whose foot is below the screen's top (12px in, under the top bar where it lies
  // over the rows), or the first row while it is lower.
  var ceil = function () { var bar = document.querySelector(".topbar"), q = bar && bar.getBoundingClientRect();
    return q && q.height > 0 && q.top <= 1 ? q.bottom : 0; };
  var topRow = function () { var t = Math.max(ceil() + 12, ol().getBoundingClientRect().top);
    var li = Array.prototype.filter.call(ol().children, function (x) { return x.getClientRects().length && x.getBoundingClientRect().bottom > t + 1; })[0];
    return li ? li.querySelector(".track-title").textContent : null; };
  var look = function () { var b = box(), q = b.getBoundingClientRect(), h = thumb().getBoundingClientRect(), bub = b.querySelector(".playlist-az-bubble");
    var mini = document.querySelector(".mini-transport").getBoundingClientRect();
    return { seen: getComputedStyle(b).display !== "none" && q.height > 0, right: Math.round(innerWidth - q.right),
      lineTop: Math.round(q.top), lineBottom: Math.round(q.bottom), miniTop: Math.round(mini.top), thumbTop: Math.round(h.top), thumbBottom: Math.round(h.bottom),
      letter: thumb().textContent, top: topRow(), held: b.classList.contains("is-held"), last: Math.round(ol().lastElementChild.getBoundingClientRect().bottom),
      bubble: getComputedStyle(bub).display !== "none" ? { text: bub.textContent, bottom: Math.round(bub.getBoundingClientRect().bottom) } : null }; };
  var scroller = function () { for (var p = ol().parentElement; p && p !== document.body; p = p.parentElement) {
    var oy = getComputedStyle(p).overflowY; if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p; }
    return document.scrollingElement; };
  var ptr = function (type, y) { var q = thumb().getBoundingClientRect();
    thumb().dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: q.left + q.width / 2, clientY: y, bubbles: true, pointerType: "touch", isPrimary: true, button: 0 })); };
  var mid = function () { var q = thumb().getBoundingClientRect(); return q.top + q.height / 2; };

  await menu("playlists");
  await open("Session Work");
  T("order", look());
  await sort("title");
  await window.__sleep(100);
  T("first", { look: look(), want: letter(ol().children[0].querySelector(".track-title").textContent) });
  // Scrolled as far as the page goes: the circle at the foot of the line, its letter the top row's.
  // A browser sends "scroll" with its next frame; this headless page draws none, so the driver sends it.
  var scrolled = function () { scroller().dispatchEvent(new Event("scroll")); };
  scroller().scrollTop = scroller().scrollHeight; scrolled();
  await window.__sleep(150);
  var end = look(); T("end", { look: end, want: letter(end.top) });
  scroller().scrollTop = 0; scrolled();
  await window.__sleep(150);
  // A finger that moves before the press has lasted: nothing moves.
  var before = scroller().scrollTop, y0 = mid();
  ptr("pointerdown", y0); ptr("pointermove", y0 + 120); await window.__sleep(450); ptr("pointerup", y0 + 120);
  await window.__sleep(100);
  T("swipe", { moved: scroller().scrollTop !== before, held: box().classList.contains("is-held") });
  // A long press, then the finger down the line: the list goes with it, the letter above the finger.
  y0 = mid();
  ptr("pointerdown", y0); await window.__sleep(450);
  T("pressed", look());
  var line = box().getBoundingClientRect(), y1 = line.top + line.height / 2;
  ptr("pointermove", y1); await window.__sleep(80);
  var half = look(); T("half", { look: half, finger: Math.round(y1), want: letter(half.top) });
  ptr("pointermove", line.bottom - 2); await window.__sleep(80);
  var low = look(); T("low", { look: low, want: letter(low.top) });
  ptr("pointerup", line.bottom - 2); await window.__sleep(100);
  T("gone", look());
  // Set aside and put back, as an artist's page does with the playlist's (artist-view.js): it follows the scroll still.
  var page = document.querySelector(".playlist-detail"), home = page.parentNode, after = page.nextSibling;
  var aside = document.createDocumentFragment(); aside.appendChild(page);
  document.dispatchEvent(new Event("scroll")); await window.__sleep(100);   // the artist's page scrolled
  home.insertBefore(page, after); await window.__sleep(150);
  scroller().scrollTop = 0; scrolled(); await window.__sleep(150);
  T("back_top", look());
  scroller().scrollTop = scroller().scrollHeight; scrolled(); await window.__sleep(150);
  T("back_end", look());
  // The keyboard: the find's field focused and the screen 300px shorter (the app resizes the page for it).
  document.getElementById("tnav-search").click();
  await window.__sleep(200);
  var vv = window.visualViewport, tall = vv.height;
  var kb = function () { return { open: root.classList.contains("kb-open"), nav: getComputedStyle(document.getElementById("touch-nav")).display,
    mini: getComputedStyle(document.querySelector(".mini-transport")).display, slider: getComputedStyle(box()).display }; };
  T("focused", kb());
  Object.defineProperty(vv, "height", { configurable: true, get: function () { return tall - 300; } });
  vv.dispatchEvent(new Event("resize")); await window.__sleep(100);
  T("kb", kb());
  delete vv.height; vv.dispatchEvent(new Event("resize")); await window.__sleep(100);
  T("put_away", kb());
  await sort("order");
  T("back", look());
`;

test("the A–Z slider on a playlist sorted by Title or Artist (2.0.4-t6, a slider from t8)", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const r = harness.renderPage({ stub: LONG, driver: DRIVER, name: "playlist-az", windowSize: "390x844", chromeArgs: TOUCH, budgetMs: 60000 });
  harness.assertNoPageError(assert, r);

  await t.test("THE one: hidden in Playlist order; sorted by title, a line down the right edge with the first row's letter on top", () => {
    assert.equal(r.order.seen, false);
    const f = r.first.look;
    assert.equal(f.seen, true);
    assert.ok(f.right <= 12, "at the right edge: " + f.right);
    assert.ok(f.lineBottom <= f.miniTop, `above the mini player: ${f.lineBottom} > ${f.miniTop}`);
    assert.equal(f.thumbTop, f.lineTop, "the circle at the top of the line");
    assert.equal(f.letter, r.first.want);
    assert.equal(f.letter, "2", "a digit is its own letter (\"2 Become 1\", first by the Sort's numbers)");
  });
  await t.test("the circle follows the scroll: at the end, at the line's foot, with the top row's letter", () => {
    assert.ok(r.end.look.thumbBottom >= r.end.look.lineBottom - 1, JSON.stringify(r.end.look));
    assert.equal(r.end.look.letter, r.end.want);
    assert.ok(r.end.want > "M", "a late letter: " + r.end.want);
  });
  await t.test("a finger that moves before the press has lasted moves nothing", () => {
    assert.deepEqual(r.swipe, { moved: false, held: false });
  });
  await t.test("held, the list moves with the finger, and the top row's letter shows above it; letting go hides it", () => {
    assert.equal(r.pressed.held, true);
    assert.ok(r.pressed.bubble, "the larger circle shows");
    const h = r.half.look;
    assert.ok(h.top && h.top !== "2 Become 1", "the list moved: " + h.top);
    assert.equal(h.letter, r.half.want, "the circle's letter is the top row's");
    assert.equal(h.bubble.text, r.half.want, "and the larger one's");
    assert.ok(h.bubble.bottom < r.half.finger, `above the finger: ${h.bubble.bottom} >= ${r.half.finger}`);
    assert.ok(r.low.look.thumbBottom >= r.low.look.lineBottom - 1, "the circle at the line's foot");
    assert.ok(r.low.look.last <= r.low.look.lineBottom + 12 && r.low.look.last > r.low.look.lineBottom - 64,
      `the list at its end, its last row just above the mini player: ${r.low.look.last}`);
    assert.equal(r.low.look.letter, r.low.want);
    assert.equal(r.gone.held, false);
    assert.equal(r.gone.bubble, null);
  });
  await t.test("the review: set aside and put back (an artist's page), it follows the scroll as before", () => {
    assert.equal(r.back_top.thumbTop, r.back_top.lineTop, "at the top with the list: " + JSON.stringify(r.back_top));
    assert.ok(r.back_end.thumbBottom >= r.back_end.lineBottom - 1, "at the foot with it: " + JSON.stringify(r.back_end));
  });
  await t.test("the keyboard open: no bar, no mini player, no slider; put away, all back", () => {
    assert.equal(r.focused.open, false, "focused, but the screen no shorter: a hardware keyboard");
    assert.deepEqual(r.kb, { open: true, nav: "none", mini: "none", slider: "none" });
    assert.equal(r.put_away.open, false);
    assert.notEqual(r.put_away.nav, "none");
    assert.notEqual(r.put_away.mini, "none");
  });
  await t.test("Playlist order again hides it", () => {
    assert.equal(r.back.seen, false);
  });
});
