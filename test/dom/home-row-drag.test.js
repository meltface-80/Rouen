"use strict";
// ---------------------------------------------------------------------------
// v1.8.77: Settings → Home Screen, dragging a row into place.
//
// Reported: "for the one you move you need to tap the handle after it's moved
// for it to stick. Also, the action isn't fluid. It's one step at a time. If
// you don't tap the handle after setting it down and return to the home screen
// it reverts."
//
// The cause: the move/up listeners were on the GRIP, behind setPointerCapture,
// and each swap moved the dragged row with insertBefore — which takes the grip
// out of the document for an instant, and a capturing element that leaves the
// document loses its capture. After the first swap the grip heard nothing: the
// row stopped (one step), and pointerup — the save — never came until the grip
// was tapped again.
//
// Events here are dispatched where the browser would hit-test them
// (elementFromPoint), with NO capture at all. That is the state the old code
// fell into after its first swap, so it fails these from the first move.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const ROWS = ["unplayed", "history", "picks", "random", "library", "lotw", "genres"];

const STUB = `
try { localStorage.setItem("rra-zone", "z1"); } catch (e) { /* storage optional: the zone falls back to the first */ }
window.__rows = ${JSON.stringify(ROWS)}.map(function (id) { return { id: id, on: true }; });
window.__posts = [];
window.__installFetch(function (u, opts) {
  if (u.indexOf("/api/settings/home-rows") > -1) {
    if (opts && opts.method === "POST") {
      var body = JSON.parse(opts.body);
      window.__posts.push(body.rows.map(function (r) { return r.id; }));
      window.__rows = body.rows.map(function (r) { return { id: r.id, on: r.on !== false }; });
    }
    return window.__json({ rows: window.__rows });
  }
  if (u.indexOf("/api/zones") > -1)      return window.__json({ zones: [{ zone_id: "z1", display_name: "Zone", state: "stopped", outputs: [] }] });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: null });
  if (u.indexOf("/api/queue") > -1)      return window.__json({ items: [] });
  if (u.indexOf("/api/home/") > -1)      return window.__json({ albums: [], label: null });
  if (u.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1)           return window.__json({});
  return undefined;
});
`;

const DRIVER = `
  await window.__sleep(600);
  var still = document.createElement("style");
  still.textContent = ".settings-sheet { animation: none !important; }";
  document.head.appendChild(still);
  document.getElementById("settings-toggle").click();
  await window.__sleep(300);
  document.querySelector('.settings-nav-item[data-pane="homescreen"]').click();
  await window.__sleep(400);

  var list = document.getElementById("home-rows-list");
  function order() { return [].map.call(list.querySelectorAll(".home-row-item"), function (x) { return x.dataset.row; }); }
  function item(id) { return list.querySelector('.home-row-item[data-row="' + id + '"]'); }
  T("before", order());

  // Was the dragged row ever taken out of the document? That is what ends a
  // touch's implicit capture on iOS.
  var dragged = item("unplayed");
  // Counted only while the drag is live: the save redraws the whole list
  // afterwards, which is fine — the finger has already lifted by then.
  var removedDragged = 0, dropped = false;
  new MutationObserver(function (ms) {
    if (dropped) return;
    ms.forEach(function (m) { [].forEach.call(m.removedNodes, function (n) { if (n === dragged) removedDragged++; }); });
  }).observe(list, { childList: true });

  var PID = 7;
  function fire(type, x, y, target) {
    var t = target || document.elementFromPoint(x, y) || document.body;
    t.dispatchEvent(new PointerEvent(type, { pointerId: PID, pointerType: "touch", isPrimary: true,
      clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, buttons: type === "pointerup" ? 0 : 1 }));
  }

  var grip = dragged.querySelector(".home-row-grip");
  var g = grip.getBoundingClientRect();
  var x = g.left + g.width / 2, y0 = g.top + g.height / 2;
  var grabDY = y0 - dragged.getBoundingClientRect().top;
  var rowH = dragged.getBoundingClientRect().height;
  fire("pointerdown", x, y0, grip);

  // Down in small steps, the way a finger moves: two and a half rows.
  var steps = [], y = y0;
  for (var i = 1; i <= 25; i++) {
    y = y0 + (rowH * 2.5) * i / 25;
    fire("pointermove", x, y);
    var top = dragged.getBoundingClientRect().top;
    steps.push(Math.round((top - (y - grabDY)) * 10) / 10);
  }
  await window.__sleep(50);
  T("follow_err_max", Math.max.apply(null, steps.map(Math.abs)));
  T("mid_order", order());
  T("posts_mid", window.__posts.length);
  T("dragging_class_mid", dragged.classList.contains("is-dragging"));

  dropped = true;
  fire("pointerup", x, y);
  await window.__sleep(400);
  T("after", order());
  T("posts", window.__posts.slice());
  T("dragging_class_after", item("unplayed").classList.contains("is-dragging"));
  T("transform_after", item("unplayed").style.transform || "");
  T("removed_dragged", removedDragged);

  // The Home screen behind the sheet follows the saved order.
  T("home_order", [].map.call(document.querySelectorAll("#home-sections > [data-row]"), function (x) { return x.dataset.row; }));

  // A second drag works with no extra tap in between: "history" back to the top.
  var h = item("history"), hg = h.querySelector(".home-row-grip").getBoundingClientRect();
  var hx = hg.left + hg.width / 2, hy = hg.top + hg.height / 2;
  fire("pointerdown", hx, hy, h.querySelector(".home-row-grip"));
  for (var j = 1; j <= 10; j++) fire("pointermove", hx, hy - rowH * 1.5 * j / 10);
  fire("pointerup", hx, hy - rowH * 1.5);
  await window.__sleep(400);
  T("after2", order());
  T("posts2", window.__posts.length);

  // Held near the bottom edge of the scrolling pane, the page scrolls by
  // itself and the row goes with it — the drag carries on until let go.
  var sc = null;
  for (var p = list.parentElement; p; p = p.parentElement) {
    var oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) { sc = p; break; }
  }
  T("has_scroller", !!sc);
  if (sc) {
    sc.scrollTop = 0;
    await window.__sleep(50);
    var first = list.querySelector(".home-row-item");
    var fg = first.querySelector(".home-row-grip").getBoundingClientRect();
    var fx = fg.left + fg.width / 2, fy = fg.top + fg.height / 2;
    var box = sc.getBoundingClientRect();
    fire("pointerdown", fx, fy, first.querySelector(".home-row-grip"));
    var ty = box.bottom - 8;
    for (var k = 1; k <= 10; k++) fire("pointermove", fx, fy + (ty - fy) * k / 10);
    var st0 = sc.scrollTop;
    await window.__sleep(1000);
    T("scrolled_by", sc.scrollTop - st0);
    T("scroll_follow_err", Math.round(Math.abs(first.getBoundingClientRect().top - (ty - (fy - fg.top) - (first.getBoundingClientRect().height - fg.height) / 2))));
    fire("pointerup", fx, ty);
    await window.__sleep(300);
    T("last_after_scroll", order()[order().length - 1] === first.dataset.row);
  }
`;

test("Home Screen rows drag fluidly and stick when let go (v1.8.77)", { skip: !harness.available && "no chromium" }, async (t) => {
  const R = harness.renderPage({ stub: STUB, driver: DRIVER, name: "home-row-drag", windowSize: "390x560" });
  harness.assertNoPageError(assert, R);

  await t.test("the row follows the finger the whole way, not one step", () => {
    assert.deepEqual(R.before, ROWS);
    assert.ok(R.follow_err_max <= 1, "the dragged row sat " + R.follow_err_max + "px from the finger at some step");
    assert.deepEqual(R.mid_order.slice(0, 3), ["history", "picks", "unplayed"],
      "two and a half rows down did not carry the row past two neighbours: " + R.mid_order.join(", "));
    assert.equal(R.dragging_class_mid, true);
    assert.equal(R.posts_mid, 0, "it saved before it was let go");
  });

  await t.test("letting go saves it — no second tap on the handle", () => {
    assert.deepEqual(R.after.slice(0, 3), ["history", "picks", "unplayed"]);
    assert.equal(R.posts.length, 1, "letting go did not save (" + R.posts.length + " saves)");
    assert.deepEqual(R.posts[0], R.after, "the saved order is not the order on screen");
    assert.equal(R.dragging_class_after, false, "the row was left mid-drag");
    assert.equal(R.transform_after, "", "the row was left offset");
    const home = R.home_order.filter((id) => ROWS.includes(id));
    assert.deepEqual(home, R.after,
      "the Home screen did not take the new order: " + R.home_order.join(", "));
  });

  await t.test("the dragged row never leaves the document", () => {
    assert.equal(R.removed_dragged, 0,
      "the dragged row was taken out of the list " + R.removed_dragged + " times — on iOS that ends the touch");
  });

  await t.test("a second drag straight after works too", () => {
    assert.equal(R.after2[0], "history", "the second drag did not move the row: " + R.after2.join(", "));
    assert.equal(R.posts2, 2);
  });

  await t.test("held at the edge, the pane scrolls and the row goes with it", () => {
    assert.equal(R.has_scroller, true, "the Home Screen pane does not scroll at this size — the test needs it to");
    assert.ok(R.scrolled_by > 20, "the pane scrolled " + R.scrolled_by + "px while the row was held at its edge");
    assert.ok(R.scroll_follow_err <= 2, "the row lagged the finger by " + R.scroll_follow_err + "px while scrolling");
    assert.equal(R.last_after_scroll, true, "the row did not end at the bottom after scrolling there");
  });
});
