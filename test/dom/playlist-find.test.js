"use strict";
// ---------------------------------------------------------------------------
// 2.0.4-t5: find in a playlist (public/playlist-find.js, dev/design/playlist-artists.md §8). The owner, 2026-11-10:
// "When on the playlist screen showing the tracks in the playlist the search function from the bottom bar when pressed
// will only then search within that playlist" (gert_mogensen's 1,515 tracks). Asked, the owner chose that Play now and
// Queue still play the whole playlist while a find is typed. The shipping page at 390x844, touch; the server a
// stand-in (playlist-play-kit.js).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, TOUCH, HELPERS } = require("./playlist-head-kit");
const { STUB, LOOK } = require("./playlist-play-kit");

const DRIVER = HELPERS + LOOK + `
  var shown = function () { return Array.prototype.filter.call(document.querySelectorAll(".playlist-detail ol.playlist-tracks > li"), function (li) {
    return li.getClientRects().length > 0; }).map(function (li) { return li.querySelector(".track-title").textContent; }); };
  var field = function () { return document.querySelector(".playlist-detail .playlist-find-input"); };
  var type = async function (s) { var f = field(); f.value = s; f.dispatchEvent(new Event("input", { bubbles: true })); await window.__sleep(50); };
  await menu("playlists");
  await open("Session Work");
  T("glass", !!document.querySelector(".playlist-detail .playlist-sort .playlist-find-btn"));
  T("closed", { box: document.querySelector(".playlist-detail .playlist-find").classList.contains("hidden"), rows: shown().length });
  // The bar's Search, on a playlist's page: the playlist's find, not Home's search.
  document.getElementById("tnav-search").click();
  await window.__sleep(200);
  T("opened", { box: !document.querySelector(".playlist-detail .playlist-find").classList.contains("hidden"), focus: document.activeElement === field(),
    home: !!document.querySelector("#topbar-search.is-open"), page: !!document.querySelector(".playlist-detail") });
  await type("ro");
  T("ro", { rows: shown(), count: document.querySelector(".playlist-find-count").textContent });
  await type("POLICE");
  T("artist", shown());
  await type("billie jean");
  T("words", shown());
  await type("zzz");
  T("none", { rows: shown(), count: document.querySelector(".playlist-find-count").textContent });
  // A find typed, Play now: the whole playlist (in Playlist order, Roon's own action).
  await type("ro");
  await press(0);
  T("plain", { whole: clone(window.__whole), ordered: window.__ordered.length });
  // Sorted by artist, a find typed: the run still sends every track, in the Sort's order.
  await sort("artist");
  T("sorted_rows", shown());
  await press(0);
  T("sorted", { tracks: (window.__ordered[0] || { tracks: [] }).tracks.length });
  window.__run.done = true; await poll();
  // Escape clears and closes it: every row back.
  field().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await window.__sleep(100);
  T("escaped", { box: document.querySelector(".playlist-detail .playlist-find").classList.contains("hidden"), rows: shown().length, value: field().value,
    page: !!document.querySelector(".playlist-detail") });
`;

test("find in a playlist: the bar's Search on a playlist's page (2.0.4-t5)", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const r = harness.renderPage({ stub: STUB, driver: DRIVER, name: "playlist-find", windowSize: "390x844", chromeArgs: TOUCH, budgetMs: 60000 });
  harness.assertNoPageError(assert, r);

  await t.test("THE one: the bar's Search opens the playlist's find, focused; Home's search stays shut", () => {
    assert.equal(r.glass, true, "a glass at the end of the Sort row");
    assert.deepEqual(r.closed, { box: true, rows: 5 });
    assert.deepEqual(r.opened, { box: true, focus: true, home: false, page: true });
  });
  await t.test("what is typed keeps the rows whose title or artist has it, any case, every word; how many is said", () => {
    assert.deepEqual(r.ro, { rows: ["Rosanna", "Roxanne"], count: "2 of 5" });
    assert.deepEqual(r.artist, ["Roxanne"], "by its artist");
    assert.deepEqual(r.words, ["Billie Jean"]);
    assert.deepEqual(r.none, { rows: [], count: "0 of 5" });
  });
  await t.test("Play now with a find typed plays the whole playlist (the owner's choice), sorted or not", () => {
    assert.equal(r.plain.whole.length, 1);
    assert.equal(r.plain.ordered, 0);
    assert.deepEqual(r.sorted_rows, ["Roxanne", "Rosanna"], "the find kept through the Sort");
    assert.equal(r.sorted.tracks, 5, "every track sent, not the two shown");
  });
  await t.test("Escape clears and closes it, the page staying", () => {
    assert.deepEqual(r.escaped, { box: true, rows: 5, value: "", page: true });
  });
});
