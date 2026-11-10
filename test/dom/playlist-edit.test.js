"use strict";
// ---------------------------------------------------------------------------
// 2.0.4-t13: a Roon playlist's tracks moved and removed from its page (public/playlist-edit.js, playlist-edit.css;
// dev/design/playlist-edit.md §1, §4.1). The owner, 2026-11-10: "I don't see a way to reorder tracks or delete tracks
// from playlists"; their choices: an edit mode (⋯ → Edit playlist, a red − on the left, a ≡ on the right, Done) and a
// question before each removal. The shipping page; the server a stand-in (playlist-play-kit.js) with native mode able
// to change "Session Work", answering /api/roon-playlists/move and /remove as lib/routes/roon-playlist-edit.js does.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, TOUCH, HELPERS } = require("./playlist-head-kit");
const { STUB, LOOK } = require("./playlist-play-kit");

const NATIVE = `
  if (url.indexOf("/api/roon-playlists/") > -1) {
    window.__edits.push([url.replace(/^.*\\/api\\/roon-playlists\\//, ""), body]);
    var no = window.__editRefuse.shift();
    return no ? window.__json({ ok: false, error: no }, 502) : window.__json({ ok: true });
  }
  if (url.indexOf("/api/roon-playlists") > -1) return window.__json({ available: true, playlists: [{ id: "ab12", name: "Session Work", tracks: 5 }] });`;
const EDIT_STUB = STUB.replace('window.__refuse = {};', 'window.__refuse = {}; window.__edits = []; window.__editRefuse = [];')
  .replace('  if (url.indexOf("/api/roon-playlists") > -1) return window.__json({ available: false, why: "" });', NATIVE);

const DRIVER = HELPERS + LOOK + `
  var ol = function () { return document.querySelector(".playlist-detail ol.playlist-tracks"); };
  var titles = function () { return Array.prototype.map.call(ol().children, function (li) { return li.querySelector(".track-title").textContent; }); };
  var row = function (t) { return Array.prototype.find.call(ol().children, function (li) { return li.querySelector(".track-title").textContent === t; }); };
  var seen = function (el) { return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden"; };
  var look = function () {
    var page = document.querySelector(".playlist-detail");
    return { titles: titles(), editing: page.classList.contains("is-editing"),
      minus: ol().querySelectorAll(".ple-remove").length, grips: ol().querySelectorAll(".ple-grip").length,
      done: seen(page.querySelector(".ple-done")), sortBar: seen(page.querySelector(".playlist-sort")),
      buttons: Array.prototype.filter.call(page.querySelectorAll(".playlist-actions > .action-btn:not(.ple-done)"), seen).length,
      pressed: (page.querySelector('.playlist-sort-btn[aria-pressed="true"]') || {}).dataset.sort,
      count: Array.prototype.map.call(document.querySelectorAll(".playlist-detail .playlist-head *, #tnav-heading .plt-count"), function (e) { return e.children.length ? "" : e.textContent; })
        .filter(function (x) { return /Tracks?$/.test(x); }) };
  };
  var grip = function (t) { return row(t).querySelector(".ple-grip"); };
  var mid = function (el) { var q = el.getBoundingClientRect(); return q.top + q.height / 2; };
  var ptr = function (el, type, y) { var q = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent(type, { pointerId: 9, clientX: q.left + q.width / 2, clientY: y, bubbles: true, button: 0, pointerType: "touch", isPrimary: true })); };
  // A drag by a row's ≡ to just under another row's middle.
  var dragTo = async function (t, under) { var g = grip(t); ptr(g, "pointerdown", mid(g)); await window.__sleep(30);
    var y = mid(row(under)) + 4; ptr(g, "pointermove", y); await window.__sleep(30); ptr(g, "pointerup", y); await window.__sleep(250); };

  await menu("playlists");
  await open("Session Work");
  await sort("title");
  await window.__sleep(300);
  T("before", look());
  // ⋯ → Edit playlist.
  document.querySelector(".playlist-detail .playlist-actions .overflow-btn").click();
  await window.__sleep(150);
  var item = Array.prototype.find.call(document.querySelectorAll(".sel-menu-item"), function (b) { return b.textContent === "Edit playlist"; });
  T("offered", !!item);
  item.click();
  await window.__sleep(200);
  T("editing", look());
  // The review: editing's Playlist order is not kept as this device's Sort (the page may be left without Done).
  T("saved", (function () { try { return localStorage.getItem("rouen.playlist-sort"); } catch (e) { return "no storage"; } })());
  // The review: a − while a row is held by its ≡ is refused, and nothing is sent.
  said();
  ptr(grip("Roxanne"), "pointerdown", mid(grip("Roxanne")));
  row("Lowdown").querySelector(".ple-remove").click();
  await window.__sleep(150);
  ptr(grip("Roxanne"), "pointerup", mid(grip("Roxanne")));
  await window.__sleep(150);
  T("heldRemove", { sent: window.__edits.length, asked: !document.getElementById("confirm-overlay").classList.contains("hidden"), toasts: said() });
  // A tap on a row plays nothing while editing.
  row("Lowdown").querySelector(".track-title").click();
  await window.__sleep(150);
  T("tapped", window.__taps.length);
  // − asks first: Cancel sends nothing; Remove sends the row's place and title, and the row goes once it is kept.
  row("Billie Jean").querySelector(".ple-remove").click();
  await window.__sleep(150);
  var ov = document.getElementById("confirm-overlay");
  T("asked", { shown: !ov.classList.contains("hidden"), msg: document.getElementById("confirm-msg").textContent,
    yes: document.getElementById("confirm-yes").textContent, no: document.getElementById("confirm-no").textContent });
  document.getElementById("confirm-no").click();
  await window.__sleep(150);
  // Any other question the app asks afterwards says No and Yes, as it did.
  window.RouenMenus.confirmDialog("Something else?");
  await window.__sleep(100);
  var plain = [document.getElementById("confirm-yes").textContent, document.getElementById("confirm-no").textContent];
  document.getElementById("confirm-no").click();
  await window.__sleep(100);
  T("cancelled", { sent: window.__edits.length, titles: titles(), plain: plain });
  row("Billie Jean").querySelector(".ple-remove").click();
  await window.__sleep(150);
  document.getElementById("confirm-yes").click();
  await window.__sleep(300);
  T("removed", { sent: window.__edits.slice(), look: look() });
  // ≡ dragged: Rosanna to under Another Day's middle.
  await dragTo("Rosanna", "Another Day");
  T("moved", { sent: window.__edits.slice(1), titles: titles() });
  // A move Roon didn't take: the row goes back, and the page says why.
  window.__editRefuse.push("Roon didn't take that change.");
  said();
  await dragTo("Roxanne", "Lowdown");
  T("refused", { sent: window.__edits.slice(2), titles: titles(), toasts: said() });
  // The arrow keys move a row one place.
  grip("Lowdown").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await window.__sleep(250);
  T("keyed", { sent: window.__edits.slice(3), titles: titles() });
  // Done: the controls gone, the Sort the page had back, and a row's tap plays its track at its new place.
  document.querySelector(".ple-done").click();
  await window.__sleep(200);
  T("done", look());
  await sort("order");
  T("order", titles());
  row("Rosanna").click();
  await window.__sleep(200);
  T("tap", window.__taps.slice(-1)[0]);
`;

for (const [size, what, args] of [["390x844", "a phone (touch)", TOUCH], ["1280x900", "a desktop (mouse)", harness.MOUSE]]) {
  test(`2.0.4-t13, ${what}: ⋯ → Edit playlist; − asks then removes; ≡ drags; each change kept once the server shows it; Done`, async (t) => {
    if (!harness.available) { t.skip("no chromium binary available"); return; }
    const r = harness.renderPage({ stub: EDIT_STUB, driver: DRIVER, name: "playlist-edit-" + size, windowSize: size, chromeArgs: args, budgetMs: 40000 });
    harness.assertNoPageError(assert, r);
    assert.equal(r.before.pressed, "title");
    assert.equal(r.offered, true, "Edit playlist in the ⋯");
    // THE one: the playlist's own order, a − and a ≡ on every row, Done alone in the top block.
    const e = r.editing;
    assert.deepEqual(e.titles, ["Rosanna", "Billie Jean", "Lowdown", "Another Day", "Roxanne"], "Playlist order while editing");
    assert.deepEqual([e.editing, e.minus, e.grips, e.done, e.sortBar, e.buttons], [true, 5, 5, true, false, 0]);
    assert.equal(r.tapped, 0, "a tap on a row played nothing");
    assert.equal(r.saved, "title", "the Sort this device keeps is still Title");
    assert.deepEqual([r.heldRemove.sent, r.heldRemove.asked], [0, false], "− refused while a row is held");
    assert.ok(r.heldRemove.toasts.includes("One change at a time"), JSON.stringify(r.heldRemove.toasts));
    assert.deepEqual(r.asked, { shown: true, msg: 'Remove "Billie Jean" from this playlist?', yes: "Remove", no: "Cancel" });
    assert.deepEqual(r.cancelled, { sent: 0, titles: e.titles, plain: ["Yes", "No"] }, "Cancel: nothing sent; the next question's words as ever");
    assert.deepEqual(r.removed.sent, [["remove", { id: "ab12", at: 1, title: "Billie Jean", count: 5 }]], "with the page's count: it has them all");
    assert.deepEqual(r.removed.look.titles, ["Rosanna", "Lowdown", "Another Day", "Roxanne"]);
    assert.ok(r.removed.look.count.length && r.removed.look.count.every((c) => c === "4 Tracks"), "the count: " + JSON.stringify(r.removed.look.count));
    assert.deepEqual(r.moved.sent, [["move", { id: "ab12", from: 0, from_title: "Rosanna", to: 2, to_title: "Another Day", count: 4 }]]);
    assert.deepEqual(r.moved.titles, ["Lowdown", "Another Day", "Rosanna", "Roxanne"]);
    // Dropped just under Lowdown's middle: its new place is after Lowdown, before Another Day.
    assert.deepEqual(r.refused.sent, [["move", { id: "ab12", from: 3, from_title: "Roxanne", to: 1, to_title: "Another Day", count: 4 }]]);
    assert.deepEqual(r.refused.titles, r.moved.titles, "put back where it was");
    assert.ok(r.refused.toasts.includes("Roon didn't take that change."), JSON.stringify(r.refused.toasts));
    assert.deepEqual(r.keyed.sent, [["move", { id: "ab12", from: 0, from_title: "Lowdown", to: 1, to_title: "Another Day", count: 4 }]]);
    assert.deepEqual(r.keyed.titles, ["Another Day", "Lowdown", "Rosanna", "Roxanne"]);
    assert.deepEqual([r.done.editing, r.done.minus, r.done.grips, r.done.done, r.done.pressed], [false, 0, 0, false, "title"]);
    assert.deepEqual(r.order, ["Another Day", "Lowdown", "Rosanna", "Roxanne"], "Playlist order is the playlist as it now is");
    assert.deepEqual([r.tap.track_index, r.tap.track_title], [2, "Rosanna"], "a row's tap names its track at its new place");
  });
}
