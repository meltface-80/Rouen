"use strict";
// ---------------------------------------------------------------------------
// Plugins in the page (v1.9.19, dev/design/plugins.md §4–§6): HQPlayer
// control off from the start is not there at all — no file of it loaded, no
// call to it, its Settings page only the switch; on, it is; switched off with
// its screen open, it stops and goes. And its credit box: Hide, and "Don't
// show this again".
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

function stub(o) {
  return `
window.__fx = ${JSON.stringify(o)};
window.__posts = [];
window.__installFetch(function (u, opts) {
  var m = (opts && opts.method) || "GET";
  if (m !== "GET") window.__posts.push({ url: u, body: opts && opts.body ? JSON.parse(opts.body) : null });
  if (u.indexOf("/api/plugins/") > -1) { window.__fx.on = JSON.parse(opts.body).enabled; return window.__json({ id: "hqplayer", name: "HQPlayer", enabled: window.__fx.on }); }
  if (u.indexOf("/api/plugins") > -1) return window.__json([{ id: "hqplayer", name: "HQPlayer", enabled: window.__fx.on }]);
  if (u.indexOf("/api/hqp/settings") > -1) {
    if (m === "POST") window.__fx.creditHidden = !!JSON.parse(opts.body).credit_hidden;
    return window.__json({ enabled: true, credit_hidden: !!window.__fx.creditHidden, players: [], active: "", current: "", dacs: [], dac: "main", learned_count: 0 });
  }
  if (u.indexOf("/api/hqp/now") > -1) return window.__json({ enabled: true, configured: false, players: [], active: "", dacs: [], dac: "main" });
  if (u.indexOf("/api/hqp/setup") > -1) return window.__json({ setup: {}, questions: [] });
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});`;
}

const HELPERS = `
  await window.__sleep(500);
  await window.RouenPlugins.ready;
  var st = document.createElement("style"); st.textContent = ".settings-sheet { animation: none !important; }";
  document.head.appendChild(st);
  var pane = function () { return document.querySelector('.settings-pane[data-pane="hqplayer"]'); };
  var shown = function (el) { return !!el && !el.closest(".hidden") && !el.closest("[hidden]") && getComputedStyle(el).display !== "none"; };
  var openPane = async function () {
    document.getElementById("settings-toggle").click();
    await window.__sleep(300);
    document.querySelector('.settings-nav-item[data-pane="hqplayer"]').click();
    await window.__sleep(400);
  };
  var closeSettings = async function () { document.querySelector("[data-settings-close]").click(); await window.__sleep(300); };
  var page = function () {
    return { blocks: Array.prototype.filter.call(pane().querySelectorAll(".settings-block"), shown).length,
             credit: shown(document.getElementById("hqp-credit")), line: shown(document.getElementById("hqp-credit-line")),
             players: shown(document.getElementById("hqp-players")), on: document.getElementById("hqp-enabled").checked };
  };
`;

const render = (name, o, driver) => harness.renderPage({ name, windowSize: "390x844", budgetMs: 30000, stub: stub(o), driver: HELPERS + driver });

test("off from the start: nothing of HQPlayer loaded, asked for, or shown but its switch", async (t) => {
  const r = render("plugins-off", { on: false }, `
    await window.__sleep(2500);
    T("files", document.querySelectorAll('script[src^="hqp/"], link[href^="hqp/"]').length);
    T("menu", shown(document.getElementById("menu-item-hqplayer")));
    await openPane();
    T("page", page());
    T("calls", window.__callsMatching("/api/hqp"));
  `);
  harness.assertNoPageError(assert, r);
  await t.test("THE one: no file of it, no call to it", () => {
    assert.equal(r.files, 0, "a plugin that is off was loaded");
    assert.equal(r.calls, 0, "a plugin that is off was asked for something");
  });
  await t.test("no menu entry; its page is the switch, and nothing else", () => {
    assert.equal(r.menu, false);
    assert.deepEqual(r.page, { blocks: 1, credit: false, line: false, players: false, on: false });
  });
});

test("on, then switched off with its screen open: it stops, and goes", async (t) => {
  const r = render("plugins-on-off", { on: true }, `
    T("files", document.querySelectorAll('script[src^="hqp/"], link[href^="hqp/"]').length);
    document.getElementById("menu-toggle").click();
    await window.__sleep(300);
    document.getElementById("menu-item-hqplayer").click();
    await window.__sleep(2000);
    T("screen", !!document.querySelector("#album-grid .hqp-screen"));
    await openPane();
    T("page_on", page());
    var box = document.getElementById("hqp-enabled");
    box.checked = false; box.dispatchEvent(new Event("change"));
    await window.__sleep(400);
    T("page_off", page());
    await closeSettings();
    var before = window.__callsMatching("/api/hqp/now");
    await window.__sleep(4000);
    T("polls_after", window.__callsMatching("/api/hqp/now") - before);
    T("menu_after", shown(document.getElementById("menu-item-hqplayer")));
    T("screen_after", shown(document.querySelector("#album-grid .hqp-screen")));
    T("posts", window.__posts.filter(function (p) { return p.url.indexOf("/api/plugins") > -1; }));
  `);
  harness.assertNoPageError(assert, r);
  await t.test("on: its files loaded, its screen and its whole page there", () => {
    assert.equal(r.files, 8);
    assert.equal(r.screen, true);
    assert.equal(r.page_on.players, true);
    assert.equal(r.page_on.on, true);
  });
  await t.test("THE one: off, its poll stops — no call to it after", () => {
    assert.equal(r.polls_after, 0, "the HQPlayer screen kept polling after it was switched off");
  });
  await t.test("off: the menu entry, its screen and its page are gone; the switch was saved", () => {
    assert.deepEqual(r.page_off, { blocks: 1, credit: false, line: false, players: false, on: false });
    assert.equal(r.menu_after, false);
    assert.equal(r.screen_after, false, "its screen stayed on show after it was switched off");
    assert.deepEqual(r.posts, [{ url: "/api/plugins/hqplayer", body: { enabled: false } }]);
  });
});

test("the credit box: Hide, and Don't show this again (v1.9.19)", async (t) => {
  const r = render("plugins-credit", { on: true }, `
    await openPane();
    T("first", page());
    document.getElementById("hqp-credit-hide").click();
    await window.__sleep(300);
    T("hidden_once", page());
    T("saved_once", window.__posts.filter(function (p) { return p.url.indexOf("/api/hqp/settings") > -1; }).length);
    T("line_link", document.querySelector("#hqp-credit-line a").href);
  `);
  harness.assertNoPageError(assert, r);
  await t.test("shown at first, the line not", () => {
    assert.equal(r.first.credit, true);
    assert.equal(r.first.line, false);
  });
  await t.test("Hide alone: hidden for now, nothing saved, the line credits hqpweb", () => {
    assert.equal(r.hidden_once.credit, false);
    assert.equal(r.hidden_once.line, true);
    assert.equal(r.saved_once, 0);
    assert.equal(r.line_link, "https://github.com/statelycurmudgeon/hqpweb");
  });

  const r2 = render("plugins-credit-never", { on: true }, `
    await openPane();
    document.getElementById("hqp-credit-never").click();
    document.getElementById("hqp-credit-hide").click();
    await window.__sleep(400);
    T("posts", window.__posts.filter(function (p) { return p.url.indexOf("/api/hqp/settings") > -1; }));
  `);
  harness.assertNoPageError(assert, r2);
  await t.test("THE one: ticked, it is saved — for every device", () => {
    assert.deepEqual(r2.posts, [{ url: "/api/hqp/settings", body: { credit_hidden: true } }]);
  });

  const r3 = render("plugins-credit-saved", { on: true, creditHidden: true }, `
    await openPane();
    T("page", page());
  `);
  harness.assertNoPageError(assert, r3);
  await t.test("saved hidden: the next time, only the line", () => {
    assert.equal(r3.page.credit, false);
    assert.equal(r3.page.line, true);
  });
});

test("switched on from Settings: the whole page fills, Your setup included", async (t) => {
  const r = render("plugins-switch-on", { on: false }, `
    await openPane();
    var box = document.getElementById("hqp-enabled");
    box.checked = true; box.dispatchEvent(new Event("change"));
    await window.__sleep(1500);
    T("page", page());
    T("setup_calls", window.__callsMatching("/api/hqp/setup"));
    T("menu", !document.getElementById("menu-item-hqplayer").classList.contains("hidden"));
  `);
  harness.assertNoPageError(assert, r);
  await t.test("its page, its menu entry, and Your setup read at once", () => {
    assert.equal(r.page.players, true);
    assert.equal(r.page.credit, true);
    assert.equal(r.menu, true);
    assert.ok(r.setup_calls >= 1, "THE one: Your setup stayed empty until Settings was opened again");
  });
});

test("switched off on another device: Settings, opened here, says so and the plugin goes", async (t) => {
  const r = render("plugins-other-device", { on: true }, `
    window.__fx.on = false;   // another device switched it off
    await openPane();
    await window.__sleep(500);
    T("page", page());
    T("menu", !document.getElementById("menu-item-hqplayer").classList.contains("hidden"));
  `);
  harness.assertNoPageError(assert, r);
  await t.test("THE one: the switch read again when Settings opens", () => {
    assert.deepEqual(r.page, { blocks: 1, credit: false, line: false, players: false, on: false });
    assert.equal(r.menu, false);
  });
});
