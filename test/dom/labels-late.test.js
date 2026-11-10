"use strict";
// ---------------------------------------------------------------------------
// v2.0.3-t12: the Labels list's answer, arriving after Labels has been left, paints nothing.
//
// showLabelsList asked for the labels and, when they came, drew them into the shared grid and titled the screen
// "Labels" — whatever was on screen by then. Left for the Playlists while a slow list was still coming (a large
// library, a scan running), the Playlists screen was replaced by label tiles under the Playlists' own bar. The class
// of error: an answer drawn without asking whether the screen that asked is still the one showing. Each list asked
// for now has a number, and leaving Labels moves it on; an answer for an old number is dropped.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, STUB, HELPERS } = require("./playlist-head-kit");

// The labels, answered late (window.__labelsWait ms), ahead of the kit's routes.
const LABELS = `
window.__labelsWait = 0;
(function () {
  var install = window.__installFetch;
  window.__installFetch = function (routes) {
    install(function (url, opts) {
      if (url.indexOf("/api/filters/labels") > -1) {
        var answer = window.__json({ labels: [{ name: "Hyperdub", albumCount: 3 }, { name: "Warp", albumCount: 5 }], scanning: false });
        return window.__labelsWait ? new Promise(function (r) { setTimeout(function () { r(answer); }, window.__labelsWait); }) : answer;
      }
      if (url.indexOf("/api/settings/labels") > -1) return window.__json({ enabled: true });
      return routes(url, opts);
    });
  };
})();
`;

const DRIVER = HELPERS + `
  var screen = function () { return { labels: document.querySelectorAll("#album-grid .label-tile").length,
    title: document.getElementById("album-count").textContent, tiles: texts("#album-grid .album:not(.label-tile) .album-title") }; };

  // Labels, answered at once: the control.
  document.getElementById("menu-toggle").click();
  await window.__sleep(200);
  document.getElementById("menu-item-labels").click();
  await window.__sleep(800);
  T("labels", screen());

  // Labels again, the answer slow; the Playlists opened meanwhile.
  await menu("playlists");
  window.__labelsWait = 1500;
  document.getElementById("menu-toggle").click();
  await window.__sleep(200);
  document.getElementById("menu-item-labels").click();
  await window.__sleep(200);
  await menu("playlists");
  await window.__sleep(2000);
  T("late", screen());
`;

test("the Labels list's answer, after Labels was left, paints nothing (v2.0.3-t12)", { skip: !harness.available && "no chromium" }, async (t) => {
  const R = harness.renderPage({ stub: LABELS + STUB, driver: DRIVER, name: "labels-late", windowSize: "390x844", budgetMs: 30000 });
  harness.assertNoPageError(assert, R);
  await t.test("Labels, answered while it is up, shows its labels", () => {
    assert.deepEqual([R.labels.labels, R.labels.title], [2, "Labels"]);
  });
  await t.test("THE one: the Playlists opened while the labels were coming stay the Playlists", () => {
    assert.equal(R.late.labels, 0);
    assert.equal(R.late.title, "Playlists");
    assert.ok(R.late.tiles.indexOf("Late Night") > -1, JSON.stringify(R.late.tiles));
  });
});
