"use strict";
// ---------------------------------------------------------------------------
// v1.8.81: the mini player on a desktop and on touch screens (Mandarin v0.7.10,
// v0.7.11; ported from its test/mini-drag.test.js).
//
// On a desktop (a mouse, 1024px and wider) the bar is a card in the
// bottom-right corner, and it can be moved:
//   - pressed on the bar (not a button) and dragged, it follows the pointer —
//     a quick flick whose first move already leaves the bar included, because
//     the moves are followed on the WINDOW;
//   - dragged past an edge, it stays wholly on screen;
//   - a drag is not a click: the cover and title don't open Now playing at its
//     end, and the NEXT real click still does (the swallow flag is cleared
//     straight after a release that fires no click);
//   - near the top of the screen the zone list opens under it, and the volume
//     sheet opens beside it;
//   - where it was put is remembered; a double-click sends it back.
// On a touch screen it does not move, and it is the taller touch size.
//
// The pointer events are dispatched by script — the harness has no real mouse —
// so this pins the logic; how a real drag feels is for a real desktop.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const ZONE = {
  zone_id: "z1", display_name: "Living Room", state: "paused",
  is_previous_allowed: true, is_next_allowed: true, is_seek_allowed: true,
  settings: { shuffle: false, loop: "disabled", auto_radio: false },
  outputs: [{ output_id: "o1", display_name: "Living Room", is_muted: false,
              volume: { type: "number", min: 0, max: 100, value: 40, step: 1 } }],
  now_playing: { line1: "Generate", line2: "Collective Soul", line3: "Here to Eternity",
                 image_key: "k", length: 285, seek_position: 34 },
};
const TOUCH = ["--blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=1,availableHoverTypes=1"];

const stub = (preset) => `
window.__zone = ${JSON.stringify(ZONE)};
try { localStorage.setItem("rra-zone", "z1"); ${preset ? `localStorage.setItem("rra-mini-pos", ${JSON.stringify(JSON.stringify(preset))});` : ""} } catch (e) {}
window.__installFetch(function (u) {
  if (u.indexOf("/api/user-playlists") > -1) return window.__json({ playlists: [] });
  if (u.indexOf("/api/random-albums") > -1) return window.__json({ albums: [], total: 0, filtered: false });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: window.__zone });
  if (u.indexOf("/api/zones") > -1)      return window.__json({ zones: [window.__zone] });
  if (u.indexOf("/api/filters") > -1)    return window.__json({ genres: [] });
  if (u.indexOf("/api/home/") > -1)      return window.__json({ albums: [], label: null });
  if (u.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  if (u.indexOf("/api/settings") > -1)   return window.__json({});
  if (u.indexOf("/api/queue") > -1)      return window.__json({ items: [], history: [] });
  return undefined;
});
`;

const COMMON = `
  var bar = document.getElementById("mini-transport");
  for (var i = 0; i < 60 && bar.classList.contains("hidden"); i++) await window.__sleep(100);
  await window.__sleep(200);
  window.__infoClicks = 0;
  // Counted in the capture phase on the info area, so it sees exactly the
  // clicks that reach it (the bar's own swallow runs earlier, on the bar).
  document.querySelector("#mini-transport .mt-info").addEventListener("click", function (e) {
    window.__infoClicks++;
    if (window.__letInfoOpen) return;   // a test that wants Now playing opened for real
    e.stopPropagation(); e.preventDefault(); }, true);
  function box() { var b = bar.getBoundingClientRect();
    return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom),
             w: Math.round(b.width), h: Math.round(b.height), down: bar.classList.contains("mt-drop-down"),
             clicks: window.__infoClicks, vw: innerWidth, vh: innerHeight }; }
  function grip() { var b = bar.getBoundingClientRect(); var x = b.right - 6, y = b.top + 6;
    return { x: x, y: y, bare: document.elementFromPoint(x, y) === bar }; }
  function titleAt() { var b = document.getElementById("mt-title").getBoundingClientRect();
    return { x: b.left + 8, y: b.top + b.height / 2 }; }
  function pe(type, target, x, y) {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0,
      buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: y, pointerType: "mouse", isPrimary: true }));
  }
  async function drag(from, dx, dy, steps, clickAtEnd) {
    var start = document.elementFromPoint(from.x, from.y);
    pe("pointerdown", start, from.x, from.y);
    for (var k = 1; k <= steps; k++) {
      var x = from.x + dx * k / steps, y = from.y + dy * k / steps;
      // Each move goes to whatever is under the pointer, NOT the bar — a flick
      // leaves the bar on its first move.
      pe("pointermove", document.elementFromPoint(x, y) || document.body, x, y);
      await window.__sleep(10);
    }
    var ex = from.x + dx, ey = from.y + dy;
    var under = document.elementFromPoint(ex, ey) || document.body;
    pe("pointerup", under, ex, ey);
    // A browser clicks the nearest common ancestor of press and release.
    if (clickAtEnd) start.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: ex, clientY: ey }));
    await window.__sleep(80);
  }
  function clickAt(p) { var el = document.elementFromPoint(p.x, p.y);
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y })); }
`;

test("the desktop mini player: a corner card that can be dragged, stays on screen, and is remembered (v1.8.81)", { concurrency: 1 }, async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const r = harness.renderPage({
    name: "mini-drag", windowSize: "1600x900", stub: stub(null), chromeArgs: harness.MOUSE, budgetMs: 30000,
    driver: COMMON + `
      await window.__sleep(400);
      T("home", box());
      var g = grip(); T("grip_bare", g.bare);
      // A flick: four moves of 225px.
      await drag(g, -900, -400, 4, false);
      T("moved", box());
      T("stored", localStorage.getItem("rra-mini-pos"));
      // A click on the title, straight after a drag that fired no click.
      clickAt(titleAt()); await window.__sleep(60);
      T("after_click", box().clicks);
      // Dragged BY THE TITLE past the top left, the browser clicking at the end.
      await drag(titleAt(), -3000, -3000, 8, true);
      T("edge", box());
      // The volume sheet beside it.
      var p = document.getElementById("mt-vol-popover");
      p.classList.remove("hidden"); await window.__sleep(80);
      var vr = p.getBoundingClientRect();
      T("vol", { l: Math.round(vr.left), t: Math.round(vr.top), b: Math.round(vr.bottom) });
      p.classList.add("hidden"); await window.__sleep(40);
      // A double-click: back to the corner, and forgotten.
      var g2 = grip();
      document.elementFromPoint(g2.x, g2.y).dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: g2.x, clientY: g2.y }));
      await window.__sleep(80);
      T("reset", box());
      T("stored_after_reset", localStorage.getItem("rra-mini-pos"));
    `,
  });
  harness.assertNoPageError(assert, r);

  await t.test("it starts as a card in the bottom-right corner", () => {
    const h = r.home;
    assert.ok(h.r > h.vw - 40 && h.b > h.vh - 40, "not in its corner: " + JSON.stringify(h));
    assert.ok(h.w >= 400 && h.w < h.vw / 2, `it is ${h.w}px wide — still the full-width strip`);
    assert.ok(h.h >= 140, `it is ${h.h}px tall — not the two-row card`);
  });

  await t.test("it follows the pointer, a flick that leaves the bar included", () => {
    assert.equal(r.grip_bare, true, "the grip spot is the bar itself");
    assert.equal(r.moved.l, r.home.l - 900, "it follows the pointer across");
    assert.equal(r.moved.t, r.home.t - 400, "and up");
    assert.equal(r.moved.clicks, 0, "a drag is not a click");
    assert.ok(r.stored, "where it was put is remembered");
  });

  await t.test("the next real click still opens Now playing", () => {
    assert.equal(r.after_click, 1);
  });

  await t.test("dragged past the top left: no click at its end, and wholly on screen", () => {
    const e = r.edge;
    assert.equal(e.clicks, 1, "the click at the end of a drag reached the cover/title");
    assert.ok(e.l >= 0 && e.t >= 0 && e.l <= 16 && e.t <= 16, "not kept on screen: " + JSON.stringify(e));
    assert.equal(e.down, true, "near the top the zone list must open under it");
  });

  await t.test("the volume sheet opens beside it, under it when there is no room above", () => {
    assert.equal(r.vol.l, r.edge.l, "the volume sheet does not line up with the bar");
    assert.ok(r.vol.t >= r.edge.b, `the sheet is at ${r.vol.t}, over the bar (its foot is ${r.edge.b})`);
  });

  await t.test("a double-click puts it back in its corner and forgets", () => {
    assert.deepEqual([r.reset.l, r.reset.t], [r.home.l, r.home.t]);
    assert.equal(r.stored_after_reset, null);
  });
});

test("the desktop mini player is where it was put after a reload (v1.8.81)", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const r = harness.renderPage({
    name: "mini-drag-reload", windowSize: "1600x900", stub: stub({ left: 100, top: 120 }), chromeArgs: harness.MOUSE,
    driver: COMMON + `T("at", box());`,
  });
  harness.assertNoPageError(assert, r);
  assert.deepEqual([r.at.l, r.at.t], [100, 120]);
});

test("on a touch screen the mini player is the taller touch size and does not move (v1.8.81)", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const r = harness.renderPage({
    name: "mini-drag-touch", windowSize: "1180x820", stub: stub(null), chromeArgs: TOUCH,
    driver: COMMON + `
      var before = box();
      await drag(grip(), -400, -300, 8, false);
      T("before", before); T("after", box());
      T("art", Math.round(document.getElementById("mt-art").getBoundingClientRect().height));
      T("play", Math.round(document.getElementById("mt-playpause").getBoundingClientRect().height));
    `,
  });
  harness.assertNoPageError(assert, r);
  assert.deepEqual([r.after.l, r.after.t], [r.before.l, r.before.t], "on a touch screen it must not move");
  assert.equal(r.art, 64, "the touch size's cover is 64px");
  assert.equal(r.play, 53, "the touch size's play button is 53px");
});

// Found in review (v1.8.81), each one measured before it was fixed.
test("the desktop card's room follows its real height, and toasts stay on screen (v1.8.81)", { concurrency: 1 }, async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }

  await t.test("at twice the text size nothing sits under the card and the volume sheet clears it", () => {
    const r = harness.renderPage({
      name: "mini-room-x2", windowSize: "1280x800", chromeArgs: harness.MOUSE,
      stub: stub(null).replace('try { localStorage.setItem("rra-zone", "z1");',
                               'try { localStorage.setItem("rra-ui-chrome", "2"); localStorage.setItem("rra-zone", "z1");'),
      driver: COMMON + `
        await window.__sleep(300);
        T("bar", box());
        T("main_pad", parseFloat(getComputedStyle(document.querySelector("main")).paddingBottom));
        var p = document.getElementById("mt-vol-popover");
        p.classList.remove("hidden"); await window.__sleep(80);
        T("vol_bottom", Math.round(p.getBoundingClientRect().bottom));
      `,
    });
    harness.assertNoPageError(assert, r);
    const needed = r.bar.vh - r.bar.t;
    assert.ok(r.bar.h > 166, `the fixture's card is ${r.bar.h}px — not grown by the text size, so this tests nothing`);
    assert.ok(r.main_pad >= needed, `the page keeps ${r.main_pad}px under it but the card takes ${needed}px`);
    assert.ok(r.vol_bottom <= r.bar.t, `the volume sheet ends at ${r.vol_bottom}, over the card's top at ${r.bar.t}`);
  });

  await t.test("a toast is on screen with the card moved to the top", () => {
    const r = harness.renderPage({
      name: "mini-toast-top", windowSize: "1280x800", stub: stub({ left: 300, top: 8 }), chromeArgs: harness.MOUSE,
      driver: COMMON + `
        await window.__sleep(200);
        window.__showToast("Queued 2 albums");
        await window.__sleep(300);
        var tr = document.getElementById("toast").getBoundingClientRect();
        T("toast", { t: Math.round(tr.top), b: Math.round(tr.bottom) });
      `,
    });
    harness.assertNoPageError(assert, r);
    assert.ok(r.toast.t >= 0 && r.toast.b <= 800, "the toast is off screen: " + JSON.stringify(r.toast));
  });

  await t.test("the cover cannot be dragged out as a picture", () => {
    const r = harness.renderPage({
      name: "mini-art-drag", windowSize: "1280x800", stub: stub(null), chromeArgs: harness.MOUSE,
      driver: COMMON + `
        var img = document.getElementById("mt-art");
        var ev = new DragEvent("dragstart", { bubbles: true, cancelable: true });
        img.dispatchEvent(ev);
        T("draggable", img.draggable);
        T("prevented", ev.defaultPrevented);
      `,
    });
    harness.assertNoPageError(assert, r);
    assert.equal(r.draggable, false);
    assert.equal(r.prevented, true, "a dragstart on the cover would cancel the pointer and stop the move");
  });
});

test("on a desktop, Now playing's queue scrolls clear of the card (v1.8.81)", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const items = Array.from({ length: 30 }, (_, i) => ({ title: "Track " + (i + 1), subtitle: "Artist", length: 200, image_key: "q" + i }));
  const r = harness.renderPage({
    name: "mini-np-queue", windowSize: "1280x800", chromeArgs: harness.MOUSE, budgetMs: 30000,
    stub: stub(null).replace('return window.__json({ items: [], history: [] });',
                             'return window.__json({ items: ' + JSON.stringify(items) + ', history: [] });'),
    driver: COMMON + `
      window.__letInfoOpen = true;
      document.querySelector("#mini-transport .mt-info").click();
      await window.__sleep(1200);
      T("np_open", !document.getElementById("album-modal").classList.contains("hidden"));
      document.querySelector('.modal-tab[data-tab="queue"]').click();
      await window.__sleep(800);
      var rows = Array.prototype.filter.call(document.querySelectorAll("#queue-list li"),
        function (li) { return li.getBoundingClientRect().height > 0; });
      // Scroll whatever actually scrolls the list to its end.
      for (var el = rows[rows.length - 1]; el && el !== document.body; el = el.parentElement) {
        if (el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) el.scrollTop = el.scrollHeight;
      }
      await window.__sleep(200);
      T("rows", rows.length);
      T("last", rows.length ? Math.round(rows[rows.length - 1].getBoundingClientRect().bottom) : null);
      T("bar_shown", !bar.classList.contains("hidden"));
      // The harness never finishes the panel's entrance animation, which
      // starts it 8px low; a real screen settles at 0.
      T("panel_off", Math.round(document.querySelector("#album-modal .modal-panel").getBoundingClientRect().top));
      T("bar", box());
    `,
  });
  harness.assertNoPageError(assert, r);
  assert.equal(r.np_open, true, "Now playing did not open");
  assert.ok(r.rows >= 20, "the queue did not render: " + r.rows);
  if (!r.bar_shown) return;   // the card is hidden on this screen: nothing to clear
  const last = r.last - r.panel_off;
  assert.ok(last <= r.bar.t, `the last queue row ends at ${last}, under the card's top at ${r.bar.t}`);
});
