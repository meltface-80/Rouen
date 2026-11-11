"use strict";
// ---------------------------------------------------------------------------
// 2.0.4-t11 (the owner, 2026-11-10, an iPad and a phone): "Move the title - Playlists further to the [top] and sit next
// to the back < chevron maintaining the same spacing as other screens where their titles are next to the < button.
// [Move] Import to the top also." And: "On the side menu I want the X that closes it out moved to the left side ...
// Phone app it's not brass so make it brass". The Playlists and Dynamic Playlists screens (playlist-head.js's
// pl-list, touchnav.css) and the menu's head (drawer-heads.css), touch, a phone and a tablet.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, TOUCH, STUB, HELPERS, mid } = require("./playlist-head-kit");

const DRIVER = HELPERS + `
  var imp = function () { var b = document.querySelector("#content-count .playlists-import"); return b && b.getClientRects().length ? box(b) : null; };
  await menu("playlists");
  T("list", { head: read(), imp: imp(), cls: root.classList.contains("pl-list") });
  await open("Late Night");
  T("page", { head: read(), cls: root.classList.contains("pl-list") });
  await back();
  T("again", { head: read(), imp: imp() });
  await menu("smart-playlists");
  T("dyn", { head: read(), cls: root.classList.contains("pl-list") });
  document.getElementById("tnav-home").click();
  await window.__sleep(600);
  T("home", { cls: root.classList.contains("pl-list"), imp: imp() });
  // The side menu: its ✕ before its title, in the brass of every corner button (Import's colour).
  document.getElementById("menu-toggle").click();
  await window.__sleep(300);
  var x = document.querySelector(".menu-head [data-menu-close]"), brand = document.querySelector(".menu-head .menu-brand");
  var b = document.createElement("button"); b.className = "playlists-import"; document.body.appendChild(b);
  T("menu", { x: box(x), brand: box(brand), bg: getComputedStyle(x).backgroundColor, brass: getComputedStyle(b).backgroundColor });
  b.remove();
`;

for (const [size, what] of [["390x844", "a phone"], ["820x1180", "a tablet"]]) {
  test(`2.0.4-t11, touch, ${what}: the Playlists screens' name on the ‹'s line, Import at its right; the menu's ✕ first, in brass`, async (t) => {
    if (!harness.available) { t.skip("no chromium binary available"); return; }
    const r = harness.renderPage({ stub: STUB, driver: DRIVER, name: "playlists-head-" + size, windowSize: size, chromeArgs: TOUCH, budgetMs: 40000 });
    harness.assertNoPageError(assert, r);
    for (const k of ["list", "again", "dyn"]) {
      const g = r[k].head;
      assert.equal(g.lines.length, 1, k + ": the name is not one line");
      assert.ok(Math.abs(mid(g.lines[0]) - mid(g.back)) <= 1.5, `${k}: the name (${mid(g.lines[0])}) is not on the ‹'s line (${mid(g.back)})`);
      assert.ok(g.lines[0].left >= g.back.right && g.lines[0].left <= g.back.right + 24, `${k}: the name starts at ${g.lines[0].left}, the ‹ ends at ${g.back.right}`);
    }
    assert.equal(r.list.head.title, "Playlists");
    assert.equal(r.dyn.head.title, "Dynamic Playlists");
    assert.deepEqual([r.list.cls, r.dyn.cls, r.page.cls, r.home.cls], [true, true, false, false], "only the two lists are marked");
    for (const k of ["list", "again"]) {
      const i = r[k].imp, g = r[k].head;
      assert.ok(i, k + ": no Import");
      assert.ok(Math.abs(mid(i) - mid(g.back)) <= 2, `${k}: Import (${mid(i)}) is not on the ‹'s line (${mid(g.back)})`);
      assert.ok(i.right <= g.width && i.right >= g.width - 30, `${k}: Import ends at ${i.right}, not at the page's right edge (${g.width})`);
      assert.ok(i.left > g.lines[0].right, k + ": Import is over the name");
    }
    assert.equal(r.home.imp, null, "Import stayed after the screen was left");
    const m = r.menu;
    assert.ok(m.x.right <= m.brand.left, `the menu's ✕ (ending ${m.x.right}) is not before its title (${m.brand.left})`);
    assert.equal(m.bg, m.brass, "the menu's ✕ is not brass");
  });
}
