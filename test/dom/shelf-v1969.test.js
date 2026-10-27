"use strict";
// ---------------------------------------------------------------------------
// v1.9.69-t1 (the owner, 2026-10-27, from a phone): "the focus drop down
// window needs to open full screen on phones. Side pull out for tablets and
// desktops can remain the same as it currently is." On a phone, either way
// up, the choices cover the screen and "Show N albums" takes them away; a
// phone opens on the shelf and keeps nothing; a tablet's lane is untouched.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");
const { buildShelf, shelfSignature } = require("../../lib/shelf");

const RECORDS = [
  ["Air", "Moon Safari"], ["Burial", "Untrue"], ["Daft Punk", "Discovery"], ["Depeche Mode", "Violator"],
  ["Kraftwerk", "Trans-Europe Express"], ["Massive Attack", "Mezzanine"], ["Pink Floyd", "The Wall"], ["Portishead", "Dummy"],
  ...Array.from({ length: 22 }, (_, i) => ["Zeta Band " + String(i + 1).padStart(2, "0"), "Record " + (i + 1)]),
];
const SHELF = buildShelf(
  RECORDS.map(([artist, title], i) => ({ offset: 100 + i, title, subtitle: artist, image_key: "k" + i })),
  { genresOf: () => ["Rock"], firstOf: (al) => al.subtitle.toLowerCase() });
const ANSWER = Object.assign({ total: SHELF.albums.length, rev: "1.0", sig: shelfSignature(SHELF) }, SHELF);
const ZONE = { zone_id: "z1", display_name: "Lounge", state: "paused", queue_items_remaining: 0, outputs: [] };

const stub = (store) => `
window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(performance.now()); }, 16); };
window.cancelAnimationFrame = function (id) { clearTimeout(id); };
try { localStorage.clear(); localStorage.setItem("rra-zone", "z1");
      localStorage.setItem("rra-shelf-help", JSON.stringify({ seen: "1.9.69", never: true }));
      ${store || ""} } catch (e) { /* always there here */ }
window.__installFetch(function (u) {
  if (u.indexOf("/api/shelf/albums") > -1) return window.__json(${JSON.stringify(ANSWER)});
  if (u.indexOf("/api/update/status") > -1) return window.__json({ current: "1.9.69" });
  if (u.indexOf("/api/live") > -1) return window.__json({ rev: { library: "1.0", settings: "1" } });
  if (u.indexOf("/api/settings/display") > -1) return window.__json({ enabled: true });
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (u.indexOf("/api/queue?") > -1) return window.__json({ items: [], history: [] });
  return undefined;
});
`;

const DRIVE = `
  var S = function () { return window.__shelfState(); };
  for (var i = 0; i < 80 && !(S() && S().N); i++) await window.__sleep(100);
  await window.__sleep(900);
  var st = document.createElement("style"); st.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}"; document.head.appendChild(st);
  var screen = document.getElementById("screen"), pick = document.getElementById("pick"), tab = document.getElementById("pick-tab"), done = document.getElementById("pick-done");
  function box(el) { if (typeof el === "string") el = document.querySelector(el); var b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; }
  function hit(el) { var b = el.getBoundingClientRect(); if (!b.width) return false; var top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!top && (top === el || el.contains(top)); }
  function seen() { return { off: screen.classList.contains("pick-off"), shown: getComputedStyle(pick).visibility === "visible", tab: hit(tab), stageH: box("#stage").h, kept: localStorage.getItem("rra-shelf-pick") }; }
  var W = document.documentElement.clientWidth, H = window.innerHeight;
`;

function render(name, size, driver, store) {
  return harness.renderPage({ name, page: "shelf", windowSize: size, budgetMs: 30000, stub: stub(store), driver: DRIVE + driver });
}

for (const [size, what] of [["390x844", "a phone held upright"], ["844x390", "a phone on its side"]]) {
  test(`${what}: the choices open full screen, and Show N albums takes them away (v1.9.69-t1)`, { skip: !harness.available }, async (t) => {
    // left open on a bigger screen: a phone opens on the shelf all the same
    const r = render("shelf1969-" + size, size, `
      T("start", seen());
      tab.click(); await window.__sleep(200);
      var p = box(pick);
      T("open", Object.assign(seen(), { cover: Math.abs(p.l) < 1 && Math.abs(p.t) < 1 && Math.abs(p.r - W) < 1 && Math.abs(p.b - H) < 1,
        tiles: hit(document.querySelector(".tile")), done: hit(done), doneAtFoot: H - box(done).b < 40, says: done.textContent }));
      document.querySelector('.tab[data-tab="artist"]').click(); await window.__sleep(100);
      document.querySelector('.tile[data-cat="artist"][data-id="D"]').click(); await window.__sleep(300);
      T("chosen", { says: done.textContent, N: S().N });
      done.click(); await window.__sleep(200);
      T("done", Object.assign(seen(), { N: S().N }));
      tab.click(); await window.__sleep(200);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await window.__sleep(200);
      T("escaped", seen());
    `, 'localStorage.setItem("rra-shelf-pick", "on");');
    harness.assertNoPageError(assert, r);
    await t.test("it opens on the shelf, the tab there to bring the choices", () => {
      assert.deepEqual([r.start.off, r.start.shown, r.start.tab], [true, false, true], JSON.stringify(r.start));
    });
    await t.test("THE one: open, the choices are the whole screen; their tiles and Show N albums at the foot are what a tap reaches", () => {
      assert.deepEqual({ off: r.open.off, shown: r.open.shown, cover: r.open.cover, tiles: r.open.tiles, done: r.open.done, doneAtFoot: r.open.doneAtFoot, tab: r.open.tab },
        { off: false, shown: true, cover: true, tiles: true, done: true, doneAtFoot: true, tab: false }, JSON.stringify(r.open));
      assert.equal(r.open.says, "Show 30 albums");
      assert.equal(r.open.stageH, r.start.stageH, "the shelf was laid out again under the choices");
    });
    await t.test("the button says what it will show, and shows it", () => {
      assert.deepEqual(r.chosen, { says: "Show 2 albums", N: 2 });
      assert.deepEqual([r.done.off, r.done.shown, r.done.tab, r.done.N], [true, false, true, 2]);
    });
    await t.test("Escape takes them away too; a phone keeps nothing of it", () => {
      assert.equal(r.escaped.off, true);
      assert.equal(r.escaped.kept, "on");
    });
  });
}

test("a tablet keeps its side pull-out, with no Show button (v1.9.69-t1)", { skip: !harness.available }, async (t) => {
  const r = render("shelf1969-tablet", "1366x1024", `
    var p = box(pick);
    T("open", Object.assign(seen(), { side: p.l < 1 && p.r < W / 2 && p.h > H - 2, doneShown: getComputedStyle(done).display !== "none" && box(done).w > 0 }));
    tab.click(); await window.__sleep(200);
    T("shut", seen());
  `);
  harness.assertNoPageError(assert, r);
  await t.test("the choices a column at the left, as before; folded away, that is kept", () => {
    assert.deepEqual([r.open.off, r.open.side, r.open.tab, r.open.doneShown], [false, true, true, false], JSON.stringify(r.open));
    assert.deepEqual([r.shut.off, r.shut.kept], [true, "off"]);
  });
});
