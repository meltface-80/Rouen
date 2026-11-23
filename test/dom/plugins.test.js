"use strict";
// ---------------------------------------------------------------------------
// Plugins in the page (v1.9.19, dev/design/plugins.md §4–§7): HQPlayer
// control not installed from the start is not there at all — no file of it
// loaded, no call to it, only its card under Available; installed, it is;
// removed with its screen open, it stops and goes. Settings → Plugins is
// Lyrion-style since v1.9.34 (§7): Installed and Available, a card each,
// Install, Settings and Remove. And its credit box: Hide, and "Don't show
// this again".
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
  if (u.indexOf("/api/plugins/") > -1) { window.__fx.on = JSON.parse(opts.body).enabled; return window.__json({ id: "hqplayer", name: "HQPWeb", enabled: window.__fx.on }); }
  if (u.indexOf("/api/plugins") > -1) return window.__json([{ id: "hqplayer", name: "HQPWeb", enabled: window.__fx.on, version: "1.9.34",
    summary: "Change HQPlayer's filters, modulator and dither from Rouen, with presets and undo.", author: "Rouen",
    credit: { name: "hqpweb", by: "statelycurmudgeon", url: "https://github.com/statelycurmudgeon/hqpweb" } }]);
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
  // A plugin's page, as its card's Settings opens it (window.__openSettingsPane, app.js).
  var openPane = async function () { window.__openSettingsPane("hqplayer"); await window.__sleep(400); };
  var closeSettings = async function () { document.querySelector("[data-settings-close]").click(); await window.__sleep(300); };
  var page = function () {
    return { blocks: Array.prototype.filter.call(pane().querySelectorAll(".settings-block"), shown).length,
             credit: shown(document.getElementById("hqp-credit")), line: shown(document.getElementById("hqp-credit-line")),
             players: shown(document.getElementById("hqp-players")), on: installed() };
  };
  // Settings → Plugins, and its cards (v1.9.34).
  var installed = function () { var c = document.querySelector('[data-plugin="hqplayer"]'); return !!c && !!c.closest('[data-plugins="installed"]'); };
  var openPlugins = async function () {
    if (!shown(document.querySelector('.settings-pane[data-pane="plugins"]'))) {
      document.getElementById("settings-toggle").click();
      await window.__sleep(300);
      document.querySelector('.settings-nav-item[data-pane="plugins"]').click();
      await window.__sleep(400);
    }
  };
  var installViaPlugins = async function () { await openPlugins(); document.querySelector('[data-plugin-install="hqplayer"]').click(); await window.__sleep(1500); };
  var removeViaPlugins = async function (answer) {
    await openPlugins();
    window.__asked = [];
    window.__confirmDialog = function (q) { window.__asked.push(q); return Promise.resolve(answer !== false); };
    document.querySelector('[data-plugin-remove="hqplayer"]').click();
    await window.__sleep(400);
  };
`;

const render = (name, o, driver) => harness.renderPage({ name, windowSize: "390x844", budgetMs: 30000, stub: stub(o), driver: HELPERS + driver });

test("not installed from the start: nothing of HQPlayer loaded, asked for, or shown but its card", async (t) => {
  const r = render("plugins-off", { on: false }, `
    await window.__sleep(2500);
    T("files", document.querySelectorAll('script[src^="hqp/"], link[href^="hqp/"]').length);
    T("menu", shown(document.getElementById("menu-item-hqplayer")));
    await openPlugins();
    T("page", page());
    T("install", shown(document.querySelector('[data-plugin-install="hqplayer"]')));
    T("calls", window.__callsMatching("/api/hqp"));
  `);
  harness.assertNoPageError(assert, r);
  await t.test("THE one: no file of it, no call to it", () => {
    assert.equal(r.files, 0, "a plugin that is off was loaded");
    assert.equal(r.calls, 0, "a plugin that is off was asked for something");
  });
  await t.test("no menu entry, no page; under Available, with Install", () => {
    assert.equal(r.menu, false);
    assert.deepEqual(r.page, { blocks: 0, credit: false, line: false, players: false, on: false });
    assert.equal(r.install, true);
  });
});

test("installed, then removed with its screen open: it stops, and goes", async (t) => {
  const r = render("plugins-on-off", { on: true }, `
    T("files", document.querySelectorAll('script[src^="hqp/"], link[href^="hqp/"]').length);
    document.getElementById("menu-toggle").click();
    await window.__sleep(300);
    document.getElementById("menu-item-hqplayer").click();
    await window.__sleep(2000);
    T("screen", !!document.querySelector("#album-grid .hqp-screen"));
    await openPane();
    T("page_on", page());
    pane().querySelector("[data-settings-back]").click();
    await window.__sleep(300);
    await removeViaPlugins(true);
    T("asked", window.__asked[0]);
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
    assert.equal(r.polls_after, 0, "the HQPWeb screen kept polling after it was switched off");
  });
  await t.test("removed (asked first): the menu entry, its screen and its page are gone; that was saved", () => {
    assert.match(r.asked, /^Remove HQPWeb\? Its screen and settings page go; its settings are kept/);
    assert.deepEqual(r.page_off, { blocks: 0, credit: false, line: false, players: false, on: false });
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

test("installed from Settings → Plugins: its Settings opens its whole page, Your setup included", async (t) => {
  const r = render("plugins-switch-on", { on: false }, `
    await installViaPlugins();
    T("posts", window.__posts.filter(function (p) { return p.url.indexOf("/api/plugins") > -1; }));
    var open = Array.prototype.find.call(document.querySelectorAll('[data-plugin="hqplayer"] button'), function (b) { return b.textContent === "Settings"; });
    open.click();
    await window.__sleep(600);
    T("page", page());
    T("setup_calls", window.__callsMatching("/api/hqp/setup"));
    T("menu", !document.getElementById("menu-item-hqplayer").classList.contains("hidden"));
  `);
  harness.assertNoPageError(assert, r);
  await t.test("its page, its menu entry, and Your setup read at once", () => {
    assert.deepEqual(r.posts, [{ url: "/api/plugins/hqplayer", body: { enabled: true } }]);
    assert.equal(r.page.on, true, "installed, it is not under Installed");
    assert.equal(r.page.players, true);
    assert.equal(r.page.credit, true);
    assert.equal(r.menu, true);
    assert.ok(r.setup_calls >= 1, "THE one: Your setup stayed empty until Settings was opened again");
  });
});

test("removed on another device: Settings, opened here, says so and the plugin goes", async (t) => {
  const r = render("plugins-other-device", { on: true }, `
    window.__fx.on = false;   // another device removed it
    await openPlugins();
    await window.__sleep(500);
    T("page", page());
    T("menu", !document.getElementById("menu-item-hqplayer").classList.contains("hidden"));
  `);
  harness.assertNoPageError(assert, r);
  await t.test("THE one: what is installed read again when Settings opens", () => {
    assert.deepEqual(r.page, { blocks: 0, credit: false, line: false, players: false, on: false });
    assert.equal(r.menu, false);
  });
});

test("THE one for v1.9.34: Settings → Plugins, Lyrion-style — Installed and Available, a card each", async (t) => {
  const off = render("plugins-list-off", { on: false }, `
    document.getElementById("settings-toggle").click();
    await window.__sleep(300);
    var top = Array.prototype.map.call(document.querySelectorAll('.settings-view[data-view="home"] > .settings-nav .settings-nav-item'),
      function (b) { return b.getAttribute("data-pane"); });
    T("top", top);
    await openPlugins();
    var names = function (g) { return Array.prototype.map.call(document.querySelectorAll('[data-plugins="' + g + '"] [data-plugin] .settings-label'), function (e) { return e.textContent; }); };
    T("installed", names("installed")); T("available", names("available"));
    T("empty", document.querySelector('[data-plugins="installed"]').textContent.trim());
    var card = document.querySelector('[data-plugin="hqplayer"]');
    T("meta", card.querySelector(".plugin-meta").textContent);
    T("link", card.querySelector(".plugin-meta a").href);
    T("summary", card.querySelector(".settings-note").textContent);
    T("buttons", Array.prototype.map.call(card.querySelectorAll("button"), function (b) { return b.textContent; }));
  `);
  harness.assertNoPageError(assert, off);
  await t.test("a Plugins row in the Settings list, before Setup, and no HQPlayer row of its own", () => {
    assert.equal(off.top.indexOf("plugins") + 1, off.top.indexOf("setup"));
    assert.equal(off.top.includes("hqplayer"), false);
  });
  await t.test("not installed: under Available, with who made it, what it is built on, its summary and Install", () => {
    assert.deepEqual([off.installed, off.available], [[], ["HQPWeb"]]);
    assert.equal(off.empty, "Nothing installed yet.");
    assert.equal(off.meta, "By Rouen, built on hqpweb by statelycurmudgeon · Comes with Rouen v1.9.34");
    assert.equal(off.link, "https://github.com/statelycurmudgeon/hqpweb");
    assert.match(off.summary, /filters, modulator and dither/);
    assert.deepEqual(off.buttons, ["Install"]);
  });

  const on = render("plugins-list-on", { on: true }, `
    await openPlugins();
    var card = document.querySelector('[data-plugin="hqplayer"]');
    T("where", card.closest("[data-plugins]").getAttribute("data-plugins"));
    T("buttons", Array.prototype.map.call(card.querySelectorAll("button"), function (b) { return b.textContent; }));
    card.querySelector("button").click();                      // Settings
    await window.__sleep(400);
    T("hqp_open", shown(pane().querySelector("h2")));
    pane().querySelector("[data-settings-back]").click();
    await window.__sleep(300);
    T("back_to", shown(document.querySelector('.settings-pane[data-pane="plugins"] h2')));
    await removeViaPlugins(false);                             // asked, and No
    T("kept", installed());
    T("posts", window.__posts.filter(function (p) { return p.url.indexOf("/api/plugins") > -1; }));
  `);
  harness.assertNoPageError(assert, on);
  await t.test("installed: under Installed, Settings opens its page and Back returns to Plugins", () => {
    assert.equal(on.where, "installed");
    assert.deepEqual(on.buttons, ["Settings", "Remove"]);
    assert.equal(on.hqp_open, true);
    assert.equal(on.back_to, true);
  });
  await t.test("Remove asks first, and No keeps it", () => {
    assert.equal(on.kept, true);
    assert.deepEqual(on.posts, [], "removed although the answer was No");
  });
});

// The review of v1.9.34.
test("the review: no answer about the plugins — the cards stand on what is known, Install offered", async (t) => {
  const r = harness.renderPage({ name: "plugins-down", windowSize: "390x844", budgetMs: 15000, stub: `
window.__installFetch(function (u) {
  if (u.indexOf("/api/plugins") > -1) return window.__json({ error: "restarting" }, 503);
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});`, driver: HELPERS + `
    await openPlugins();
    T("install", !!document.querySelector('[data-plugin-install="hqplayer"]'));
  ` });
  harness.assertNoPageError(assert, r);
  assert.equal(r.install, true, "THE one: no cards when the server could not answer");
});

test("the review: a double tap on Remove asks once and removes once", async (t) => {
  const r = render("plugins-double", { on: true }, `
    await openPlugins();
    window.__asked = [];
    window.__confirmDialog = function (q) { window.__asked.push(q); return new Promise(function (res) { setTimeout(function () { res(true); }, 200); }); };
    var b = document.querySelector('[data-plugin-remove="hqplayer"]');
    b.click(); b.click();
    await window.__sleep(800);
    T("asked", window.__asked.length);
    T("posts", window.__posts.filter(function (p) { return p.url.indexOf("/api/plugins") > -1; }).length);
  `);
  harness.assertNoPageError(assert, r);
  assert.deepEqual([r.asked, r.posts], [1, 1], "asked or removed twice");
});
