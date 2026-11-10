"use strict";
// ---------------------------------------------------------------------------
// 2.0.4-t10: the top of a playlist's page held while its tracks scroll (public/playlist-top.js, playlist-top.css;
// dev/design/playlist-artists.md §9). The owner, 2026-11-10: "I want the top section of the playlist screen to be fixed
// but reduced in size on the phone app and phone sizes screens, tablets can display the play options and sort options
// on a single line". The shipping page, touch, a phone and a tablet; the server a stand-in (playlist-play-kit.js)
// with a playlist of 50 tracks.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, TOUCH, HELPERS } = require("./playlist-head-kit");
const { STUB, LOOK, TRACKS } = require("./playlist-play-kit");

const MANY = Array.from({ length: 50 }, (_, i) => ({ index: i, title: "Track " + (i + 1), subtitle: "Someone", image_key: null }));
const LONG = STUB.replace(JSON.stringify(TRACKS), JSON.stringify(MANY));

const DRIVER = HELPERS + LOOK + `
  var q = function (sel) { var e = document.querySelector(sel); if (!e) return null; var r = e.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height) }; };
  // The first row whose foot is below y: what is seen just under the held top.
  var rowUnder = function (y) { return Array.prototype.filter.call(document.querySelectorAll(".playlist-detail ol.playlist-tracks > li"), function (li) {
    return li.getBoundingClientRect().bottom > y + 1; })[0]; };
  var look = function () { var blk = q(".playlist-detail .playlist-top"), first = rowUnder(blk ? blk.bottom : 0);
    // The name's text (its box has the padding that centres it).
    var rg = document.createRange(); rg.selectNodeContents(document.getElementById("album-count")); var nr = rg.getClientRects()[0];
    return { heading: q("#tnav-heading"), name: nr ? { top: Math.round(nr.top), bottom: Math.round(nr.bottom) } : null, back: q("#topbar-back"), block: blk, actions: q(".playlist-detail .playlist-actions"),
      sort: q(".playlist-detail .playlist-sort"), play: q(".playlist-detail .playlist-actions > .action-btn"),
      more: q(".playlist-detail .playlist-actions .overflow-btn"), chip: q(".playlist-detail .playlist-sort-btn"),
      count: (document.querySelector("#tnav-heading .plt-count") || {}).textContent || "",
      first: first ? first.querySelector(".track-title").textContent : null, scrolled: document.querySelector("main").scrollTop }; };
  await menu("playlists");
  await open("Session Work");
  await window.__sleep(200);
  T("top", look());
  document.querySelector("main").scrollTop = 1200;
  await window.__sleep(200);
  T("down", look());
`;

for (const [size, what] of [["390x844", "a phone"], ["820x1180", "a tablet"]]) {
  test(`2.0.4-t10, ${what}: the name, the buttons and the Sort held at the top while the tracks scroll under them`, async (t) => {
    if (!harness.available) { t.skip("no chromium binary available"); return; }
    const r = harness.renderPage({ stub: LONG, driver: DRIVER, name: "playlist-top-" + size, windowSize: size, chromeArgs: TOUCH, budgetMs: 40000 });
    harness.assertNoPageError(assert, r);
    const a = r.top, b = r.down;
    assert.ok(b.scrolled > 600, "the page did not scroll: the test shows nothing");
    // THE one: scrolled, the heading, the block and its parts are where they were.
    for (const k of ["heading", "block", "actions", "sort"]) assert.equal(b[k].top, a[k].top, `${k} moved with the rows: ${a[k].top} to ${b[k].top}`);
    assert.equal(b.name.top, a.name.top, "the name moved with the rows");
    assert.ok(Math.abs((b.name.top + b.name.bottom) / 2 - (b.back.top + b.back.bottom) / 2) <= 1.5, "held, the name is off the ‹'s line");
    assert.ok(b.block.top >= b.heading.bottom - 1, "the block is over the heading");
    assert.notEqual(b.first, "Track 1", "the rows did not go under the block");
    // Smaller: 36px buttons, the ⋯ as tall as they are, 34px Sort chips; the count beside the name.
    assert.equal(a.play.h, 36);
    assert.equal(a.more.h, 36);
    assert.equal(a.chip.h, 34);
    assert.equal(a.count, "5 Tracks");
    if (size === "390x844") {
      assert.ok(a.sort.top >= a.actions.bottom, "a phone: the Sort is not under the buttons");
      assert.ok(a.block.bottom <= 170, `a phone's held top ends at ${a.block.bottom}px (it was 232 before t10)`);
    } else {
      assert.ok(Math.abs((a.sort.top + a.sort.bottom) / 2 - (a.actions.top + a.actions.bottom) / 2) <= 2, "a tablet: the Sort is not on the buttons' line");
      assert.ok(a.sort.left >= a.actions.right, "a tablet: the Sort is not after the buttons");
    }
  });
}
