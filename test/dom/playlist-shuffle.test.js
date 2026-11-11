"use strict";
// ---------------------------------------------------------------------------
// 2.0.4-t4: Shuffle on a Roon playlist's page (public/playlist-play.js). gert_mogensen, the Roon forum, 2026-11-10:
// "And maybe a Shuffle play in playlist?". Roon's own Shuffle of the whole playlist (its Play menu has one: the server's
// /api/playlist/play with kind "shuffle"), a square button with Roon's shuffle mark after Queue, so Play now and Queue
// keep their width on a phone. The shipping page at 390x844, touch; the server a stand-in (playlist-play-kit.js).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, TOUCH, HELPERS } = require("./playlist-head-kit");
const { STUB, LOOK } = require("./playlist-play-kit");

const ROW = `
  var row = function () {
    return Array.prototype.map.call(document.querySelectorAll(".playlist-detail .playlist-actions > button"), function (b) {
      var q = b.getBoundingClientRect();
      return { cls: b.className, text: (b.textContent || "").trim(), label: b.getAttribute("aria-label"), top: Math.round(q.top), w: Math.round(q.width) };
    });
  };
`;
const DRIVER = HELPERS + LOOK + ROW + `
  await menu("playlists");
  await open("Session Work");
  T("row", row());
  T("fits", btns());
  document.querySelector(".playlist-shuffle").click();
  await window.__sleep(300);
  T("plain", { whole: clone(window.__whole), ordered: window.__ordered.length });
  // Sorted: still Roon's own Shuffle of the whole playlist, never a run in the order shown.
  await sort("artist");
  document.querySelector(".playlist-shuffle").click();
  await window.__sleep(300);
  T("sorted", { whole: clone(window.__whole), ordered: window.__ordered.length });
  // Left and come back: one Shuffle, not two.
  await back();
  await open("Session Work");
  T("again", document.querySelectorAll(".playlist-shuffle").length);
  // A playlist made in Rouen has no Roon Play menu, so no Shuffle.
  await back();
  await open("Own Mix");
  T("own", document.querySelectorAll(".playlist-shuffle").length);
`;

test("Shuffle on a Roon playlist: Roon's own, beside Play now and Queue (2.0.4-t4)", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const r = harness.renderPage({ stub: STUB, driver: DRIVER, name: "playlist-shuffle", windowSize: "390x844", chromeArgs: TOUCH, budgetMs: 60000 });
  harness.assertNoPageError(assert, r);

  await t.test("THE one: after Queue, a square Shuffle button on the same line, Play now and Queue unchanged", () => {
    const row = r.row;
    const shuffle = row.find((b) => /playlist-shuffle/.test(b.cls));
    assert.ok(shuffle, "a Shuffle button");
    assert.equal(shuffle.label, "Shuffle");
    const at = row.indexOf(shuffle);
    assert.equal(row[at - 1].text, "Queue", "right after Queue");
    assert.ok(row.every((b) => b.top === row[0].top), "one line at 390px: " + JSON.stringify(row));
    assert.ok(shuffle.w <= 60, "square, as the ⋯ is");
    assert.deepEqual(r.fits.map((b) => [b.text, b.fits]), [["Play now", true], ["Queue", true]]);
  });

  await t.test("a tap is Roon's Shuffle of the whole playlist, sorted or not", () => {
    assert.deepEqual(r.plain.whole.map((w) => [w.kind, w.title, w.offset]), [["shuffle", "Session Work", 0]]);
    assert.equal(r.plain.ordered, 0);
    assert.deepEqual(r.sorted.whole.map((w) => w.kind), ["shuffle", "shuffle"]);
    assert.equal(r.sorted.ordered, 0, "never a run in the order shown");
  });

  await t.test("one button however often the page is opened; none on a playlist made in Rouen", () => {
    assert.equal(r.again, 1);
    assert.equal(r.own, 0);
  });
});
