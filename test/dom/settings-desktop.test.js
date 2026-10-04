"use strict";
// ---------------------------------------------------------------------------
// v1.8.78: Settings on a desktop.
//
// Asked for (desktop screens only): "Make the settings page open to the same
// width as the side menu. Make all other individual settings pages only open
// as wide as they need to." On a TV the full-screen Settings was a column of
// short rows, with the controls stranded on the far side of the screen from
// their labels.
//
// "Desktop" is the test Now playing's × uses — a large screen with a mouse —
// so a landscape tablet, which is large but touched, keeps full screen.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const STUB = `
window.__installFetch(function (u) {
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [] });
  if (u.indexOf("/api/") > -1)      return window.__json({});
  return undefined;
});
`;

const DRIVER = `
  await window.__sleep(500);
  var st = document.createElement("style");
  st.textContent = ".settings-sheet, .menu-drawer { animation: none !important; }";
  document.head.appendChild(st);
  document.getElementById("menu-toggle").click();
  await window.__sleep(200);
  T("menu_w", Math.round(document.querySelector(".menu-drawer").getBoundingClientRect().width));
  document.getElementById("menu-toggle").click();
  await window.__sleep(200);
  document.getElementById("settings-toggle").click();
  await window.__sleep(300);
  var ov = document.getElementById("settings-overlay");
  var sh = ov.querySelector(".settings-sheet");
  function box() { var r = sh.getBoundingClientRect(); return { left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) }; }
  T("list", box());
  T("vw", innerWidth); T("vh", innerHeight);
  var panes = {};
  var ids = [].map.call(document.querySelectorAll(".settings-nav-item"), function (b) { return b.dataset.pane; });
  for (var i = 0; i < ids.length; i++) {
    document.querySelector('.settings-nav-item[data-pane="' + ids[i] + '"]').click();
    await window.__sleep(80);
    var b = box();
    panes[ids[i]] = { left: b.left, w: b.w, over: sh.scrollWidth - sh.clientWidth };
    document.querySelector('.settings-pane[data-pane="' + ids[i] + '"] [data-settings-back]').click();
    await window.__sleep(50);
  }
  T("panes", panes);
  T("back_to_list_w", box().w);
  // A click on the dimmed page beside the panel closes Settings.
  ov.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: innerWidth - 50, clientY: 300 }));
  await window.__sleep(100);
  T("outside_closes", ov.classList.contains("hidden"));
`;

test("Settings on a desktop: the list is the side menu's width, a page its content's (v1.8.78)", { skip: !harness.available && "no chromium" }, async (t) => {
  const R = harness.renderPage({ stub: STUB, driver: DRIVER, name: "settings-desktop", windowSize: "1920x1080", chromeArgs: harness.MOUSE });
  harness.assertNoPageError(assert, R);
  await t.test("the list is a panel down the left, the side menu's width", () => {
    assert.equal(R.list.left, 0, "the Settings list is not against the left edge");
    assert.equal(R.list.w, R.menu_w, "the Settings list is " + R.list.w + "px, the side menu " + R.menu_w + "px");
    assert.equal(R.list.h, R.vh, "the Settings list is not full height");
    assert.equal(R.back_to_list_w, R.menu_w, "Back to the list did not narrow it again");
  });
  await t.test("each page is as wide as it needs, within a readable cap", () => {
    const ws = [];
    for (const [id, p] of Object.entries(R.panes)) {
      assert.equal(p.left, 0, id + " does not open from the left");
      assert.ok(p.w >= R.menu_w && p.w <= 640, id + " is " + p.w + "px wide");
      assert.ok(p.over <= 0, id + " scrolls sideways by " + p.over + "px — its content does not fit");
      ws.push(p.w);
    }
    assert.ok(new Set(ws).size > 1, "every page came out the same width — they are not sized to their content");
    assert.ok(R.panes.ui.w < 640, "UI Settings filled the cap rather than its content");
  });
  await t.test("a click beside the panel closes Settings", () => {
    assert.equal(R.outside_closes, true);
  });
});

for (const [name, size, args] of [["phone", "390x844", undefined], ["touch tablet", "1366x1024", undefined]]) {
  test("Settings on a " + name + " stays full screen (v1.8.78)", { skip: !harness.available && "no chromium" }, async (t) => {
    const R = harness.renderPage({ stub: STUB, driver: DRIVER, name: "settings-full-" + size.split("x")[0], windowSize: size, chromeArgs: args });
    harness.assertNoPageError(assert, R);
    await t.test("list and pages fill the screen", () => {
      assert.equal(R.list.w, R.vw);
      for (const [id, p] of Object.entries(R.panes)) assert.equal(p.w, R.vw, id + " is " + p.w + "px on a " + name);
    });
  });
}
