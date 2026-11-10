"use strict";
// ---------------------------------------------------------------------------
// v2.0.3-t12: the random wall's album count is asked again when Settings changes the columns — and only the random
// wall's. The guard named the screens it must not touch (Labels, Not played, the Library wall, the artist view, Home,
// a search) and missed every other one that shares the grid: a playlist's page, the Playlists screen, the Dynamic
// Playlists, TIDAL and Qobuz. Changing Columns with one of those open put random albums in its place. The class of
// error: a guard that lists the screens to leave alone, where a new screen is not on the list. Now the wall is asked
// whether it is on screen (its tiles say so), which a new screen cannot forget to answer.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, STUB, HELPERS } = require("./playlist-head-kit");

// Albums for the random wall, ahead of the kit's routes (its own answers none).
const RANDOM = `
(function () {
  var install = window.__installFetch;
  window.__installFetch = function (routes) {
    install(function (url, opts) {
      if (url.indexOf("/api/random-albums") > -1) {
        window.__draws = (window.__draws || 0) + 1;
        var answer = window.__json({ albums: [1, 2, 3, 4, 5, 6].map(function (i) {
          return { offset: i, title: "Random " + i, subtitle: "Artist " + i, image_key: null }; }), total: 6, filtered: url.indexOf("genre") > -1 });
        // window.__slowDraw holds the draw back, so the wall is still its skeletons when the columns change.
        return window.__slowDraw ? new Promise(function (r) { setTimeout(function () { r(answer); }, window.__slowDraw); }) : answer;
      }
      return routes(url, opts);
    });
  };
})();
`;

const DRIVER = HELPERS + `
  var draws = function () { return window.__draws || 0; };
  var wall = function () { return document.querySelector("#album-grid .playlist-detail") ? "playlist" :
    (document.querySelector("#album-grid .album") ? "tiles:" + document.querySelector("#album-grid .album .album-title").textContent : "other"); };

  // A playlist's page, and Settings' Columns changed under it.
  await menu("playlists");
  await open("Late Night");
  var before = draws();
  window.__uiSettings.set("cols", "3");
  await window.__sleep(800);
  T("playlist", { draws: draws() - before, wall: wall(), title: document.getElementById("album-count").textContent });

  // The Playlists screen itself.
  await back();
  before = draws();
  window.__uiSettings.set("cols", "auto");
  await window.__sleep(800);
  T("overview", { draws: draws() - before, wall: wall() });

  // The random wall: its count is asked again (the control).
  document.getElementById("menu-toggle").click();
  await window.__sleep(200);
  document.querySelector('[data-action="home"]') && document.querySelector('[data-action="home"]').click();
  await window.__sleep(400);
  if (!document.getElementById("home-view") || document.getElementById("home-view").classList.contains("hidden")) {
    document.getElementById("topbar-back").click();
    await window.__sleep(600);
  }
  document.getElementById("home-random-title").click();
  await window.__sleep(800);
  var shown = wall();
  before = draws();
  window.__uiSettings.set("cols", "3");
  await window.__sleep(800);
  T("random", { shown: shown, draws: draws() - before, wall: wall() });

  // A genre's wall (drawn by Roon, its tiles not keyed "random|"): asked again too (the review of t12).
  window.__applyFilter({ type: "genre", value: "Rock", label: "Rock" });
  await window.__sleep(800);
  shown = wall();
  before = draws();
  window.__uiSettings.set("cols", "auto");
  await window.__sleep(800);
  T("genre", { shown: shown, draws: draws() - before });

  // The wall still its skeletons, its draw out, when the columns change: drawn again at the new count.
  window.__slowDraw = 1500;
  window.__applyFilter(null);
  await window.__sleep(100);
  before = draws();
  window.__uiSettings.set("cols", "3");
  await window.__sleep(2000);
  window.__slowDraw = 0;
  T("skeletons", { draws: draws() - before });
`;

test("Settings' columns ask the random wall again, and no other screen (v2.0.3-t12)", { skip: !harness.available && "no chromium" }, async (t) => {
  const R = harness.renderPage({ stub: RANDOM + STUB, driver: DRIVER, name: "wall-count-guard", windowSize: "1280x800", budgetMs: 30000 });
  harness.assertNoPageError(assert, R);
  await t.test("THE one: a playlist's page stays, and nothing is drawn over it", () => {
    assert.deepEqual([R.playlist.draws, R.playlist.wall, R.playlist.title], [0, "playlist", "Late Night"]);
  });
  await t.test("the Playlists screen stays", () => {
    assert.equal(R.overview.draws, 0);
    assert.notEqual(R.overview.wall.indexOf("tiles:"), -1);
    assert.equal(R.overview.wall.indexOf("Random"), -1);
  });
  await t.test("the random wall itself is drawn again at the new count", () => {
    assert.equal(R.random.shown, "tiles:Random 1", "the random wall was on screen (or this proves nothing)");
    assert.equal(R.random.draws, 1);
  });
  await t.test("so is a genre's wall, and a wall still drawing", () => {
    assert.equal(R.genre.shown, "tiles:Random 1");
    assert.equal(R.genre.draws, 1);
    assert.equal(R.skeletons.draws, 1);
  });
});
