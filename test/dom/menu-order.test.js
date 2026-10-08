"use strict";
// ---------------------------------------------------------------------------
// v1.8.69: the side menu in Mandarin's order.
//
// Asked for: "Side menu to remain untouched other than place things in a
// similar order to that of Mandarin's side menu."
//
// Mandarin's drawer runs Home, Listen later, Random albums | Labels, Qobuz,
// Tidal, Pitchfork, Discover, Smart Picks, Dynamic Playlists, Playlists, Import
// a playlist | Rescan library | Settings. This app's differed in one place:
// Listen later sat after Discover. The Wall display row (v1.8.66) has no
// counterpart in Mandarin and keeps its place at the end of the first group.
// The rows themselves are moved, not edited, so their own tests still hold.
//
// v1.8.83: shorter, as Mandarin v0.7.0 — Pitchfork, Labels, Qobuz, Tidal,
// Listen later, Dynamic Playlists, Playlists | Rescan library | Settings.
// Home, Random albums and Smart Picks went (Home's rows lead to them, and every
// screen's ‹ goes Home); Import a playlist is the Playlists screen's Import
// button. Discover stays at the user's word ("Keep it in the menu"), after
// Listen later; Wall display and HQPlayer, Rouen's own, after Playlists.
//
// v1.8.74: HQPlayer joins the end of the first group, after Wall display —
// where the user asked for it ("accessed from the side menu"). Like Wall
// display it is hidden until switched on; this stub switches it on so its
// place is pinned too.
//
// v1.9.1: Shelf goes directly under Wall display ("Shelf will live on the side
// menu"), always listed — it has no switch.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const STUB = `
window.__installFetch(function (u) {
  if (u.indexOf("/api/hqp/settings") > -1) return window.__json({ enabled: true });
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1)       return window.__json({});
  return undefined;
});
`;

const DRIVER = `
  await window.__sleep(600);
  document.getElementById("menu-toggle").click();
  await window.__sleep(300);
  var list = document.querySelector("#menu-overlay .menu-list");
  T("order", Array.prototype.map.call(list.children, function (el) {
    if (el.classList.contains("menu-sep")) return "|";
    return el.getAttribute("data-action") || el.getAttribute("data-target") || el.tagName;
  }));
  T("hidden_row_items", ["menu-item-random", "menu-item-picks"].map(function (id) {
    var el = document.getElementById(id); return !!el && el.classList.contains("hidden"); }));
  T("labels", Array.prototype.map.call(list.querySelectorAll(".menu-item"), function (b) {
    var lines = b.querySelector(".menu-item-lines > span");
    return (lines || b.querySelector("span")).textContent.trim();
  }));
`;

test("the side menu runs in Mandarin's order (v1.8.69, v1.8.83)", async (t) => {
  const r = harness.renderPage({ stub: STUB, driver: DRIVER, name: "menu-order", windowSize: "390x844" });
  harness.assertNoPageError(assert, r);

  await t.test("the whole drawer, in Mandarin's order with Rouen's own rows (v1.8.83)", () => {
    assert.deepEqual(r.order, [
      "pitchfork-toggle", "labels-toggle", "qobuz-toggle", "tidal-toggle",
      "listen-later", "shuffle", "smart-picks", "discover", "smart-playlists", "playlists",
      "wall-display", "shelf", "hqplayer", "|",
      "rescan-library", "|",
      "settings-toggle",
    ]);
  });

  await t.test("Home and Import are no longer in it; Random albums and Smart Picks only stand in for a switched-off row", () => {
    for (const gone of ["home", "import-playlist"]) {
      assert.ok(!r.order.includes(gone), gone + " is still in the side menu");
    }
    // With both Home rows on (the default), their entries are hidden.
    assert.deepEqual(r.hidden_row_items, [true, true], "Random albums / Smart Picks are listed while their Home rows are on");
  });

  await t.test("every row is still there, under its own name", () => {
    assert.deepEqual(r.labels, [
      "Pitchfork", "Labels", "Qobuz", "Tidal", "Listen later", "Random albums", "Smart Picks", "Discover",
      "Dynamic Playlists", "Playlists", "Wall display", "Shelf", "HQPlayer",
      "Rescan library", "Settings",
    ]);
  });
});
