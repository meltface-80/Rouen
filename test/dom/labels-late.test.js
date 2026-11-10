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
window.__labelsWait = 0; window.__labelsAsked = 0; window.__scanning = false; window.__noLabels = false;
(function () {
  var install = window.__installFetch;
  window.__installFetch = function (routes) {
    install(function (url, opts) {
      if (url.indexOf("/api/filters/labels") > -1) {
        window.__labelsAsked++;
        var answer = window.__json({ labels: window.__noLabels ? [] : [{ name: "Hyperdub", albumCount: 3 }, { name: "Warp", albumCount: 5 }],
          scanning: window.__scanning, progress: 0.4 });
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
  window.__labelsWait = 0;

  // A scan running: its progress is polled. An artist's page opened over the list drops a poll's answer; Back
  // asks again (the review of t12), or the list stopped following the scan.
  var labels = async function () { document.getElementById("menu-toggle").click(); await window.__sleep(200);
    document.getElementById("menu-item-labels").click(); await window.__sleep(600); };
  window.__scanning = true;
  await labels();
  window.__showArtistAlbums("Burial");
  await window.__sleep(6000);
  var asked = window.__labelsAsked;
  document.getElementById("topbar-back").click();
  await window.__sleep(600);
  T("unparked", { asked: window.__labelsAsked - asked, labels: document.querySelectorAll("#album-grid .label-tile").length });

  // No labels yet, the scan running: a poll left from before does not overtake a first load still coming, which
  // clears the skeletons.
  window.__noLabels = true;
  await menu("playlists");
  await labels();                                   // a poll is now due in 4 s
  await menu("playlists");
  window.__labelsWait = 2500;
  await window.__sleep(1500);
  await labels();                                   // its first load is out when the old poll comes due
  await window.__sleep(4000);
  window.__labelsWait = 0;
  window.__scanning = false;
  T("overtaken", { skeletons: document.querySelectorAll("#album-grid .skeleton").length, title: document.getElementById("album-count").textContent });

  // The merged labels' sheet goes with the list: a label's albums opened, it is shut.
  window.__noLabels = false;
  await labels();
  document.getElementById("label-unmerge-sheet").classList.remove("hidden");
  window.__showLabelAlbums("Warp", true);
  await window.__sleep(400);
  T("sheet", document.getElementById("label-unmerge-sheet").classList.contains("hidden"));
`;

test("the Labels list's answer, after Labels was left, paints nothing (v2.0.3-t12)", { skip: !harness.available && "no chromium" }, async (t) => {
  const R = harness.renderPage({ stub: LABELS + STUB, driver: DRIVER, name: "labels-late", windowSize: "390x844", budgetMs: 60000 });
  harness.assertNoPageError(assert, R);
  await t.test("Labels, answered while it is up, shows its labels", () => {
    assert.deepEqual([R.labels.labels, R.labels.title], [2, "Labels"]);
  });
  await t.test("THE one: the Playlists opened while the labels were coming stay the Playlists", () => {
    assert.equal(R.late.labels, 0);
    assert.equal(R.late.title, "Playlists");
    assert.ok(R.late.tiles.indexOf("Late Night") > -1, JSON.stringify(R.late.tiles));
  });
  await t.test("a scan's progress polled again after an artist's page over the list", () => {
    assert.ok(R.unparked.asked >= 1, JSON.stringify(R.unparked));
    assert.equal(R.unparked.labels, 2);
  });
  await t.test("a poll from before does not overtake a first load: no skeletons left under the scan's notice", () => {
    assert.deepEqual(R.overtaken, { skeletons: 0, title: "Labels" });
  });
  await t.test("a label's albums opened from the list: the merged labels' sheet is shut", () => {
    assert.equal(R.sheet, true);
  });
});
