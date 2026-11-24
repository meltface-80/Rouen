"use strict";
// ---------------------------------------------------------------------------
// 2.0.6-t8 (dev/design/rouen-lite.md §4): what Rouen Lite's page leaves out. The owner, 2026-11-23: "Remove hqpweb as
// without a server this feature doesn't work", "Wall display wasn't removed as requested", and, of Tailscale, whether
// their Roon server's own would do. Lite's server says it is Lite (the display switch answers lite: true, off), lists
// no plugin, and its Tailscale answers lite: true. The page: no Wall Display in Settings or the menu, no Plugins, and
// (2.0.6-t10, the owner shelved it: "Remove it and tailscale from Rouen lite only") no Away from home. Every other
// install as it was.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const stub = (lite) => `
window.__installFetch(function (u) {
  if (u.indexOf("/api/settings/display") > -1) return window.__json(${lite} ? { enabled: false, seconds: 10, lite: true } : { enabled: true, seconds: 10 });
  if (u.indexOf("/api/plugins") > -1) return window.__json(${lite} ? [] : [{ id: "hqplayer", name: "HQPWeb", enabled: false, version: "2" }]);
  if (u.indexOf("/api/tailscale") > -1) return window.__json(${lite} ? { available: false, enabled: false, state: "Stopped", away: false, lite: true }
    : { available: true, enabled: false, state: "Stopped", away: false });
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});`;

const DRIVER = `
  await window.__sleep(800);
  if (window.RouenPlugins) await window.RouenPlugins.ready;
  var st = document.createElement("style"); st.textContent = ".settings-sheet { animation: none !important; }";
  document.head.appendChild(st);
  var shown = function (el) { return !!el && !el.closest(".hidden") && !el.closest("[hidden]") && getComputedStyle(el).display !== "none"; };
  var nav = function (p) { return shown(document.querySelector('.settings-nav-item[data-pane="' + p + '"]')); };
  document.getElementById("settings-toggle").click();
  await window.__sleep(400);
  T("nav", { display: nav("display"), plugins: nav("plugins"), setup: nav("setup") });
  // Away from home's entry is in Setup's own list (not on screen here): its own hidden mark (2.0.6-t10).
  var awayEntry = document.querySelector('.settings-nav-item[data-pane="away"]');
  T("awayEntry", !!awayEntry && !awayEntry.classList.contains("hidden"));
  // The entry's own switch (the side menu itself is closed here).
  T("menu", !document.getElementById("menu-item-display").classList.contains("hidden"));
  window.__openSettingsPane("away");
  await window.__sleep(600);
  var pane = document.querySelector('.settings-pane[data-pane="away"]');
  T("away", { line: document.getElementById("away-status").textContent, lineShown: shown(document.getElementById("away-status")),
    switchShown: shown(document.getElementById("away-enabled")), signInShown: shown(document.getElementById("away-login")),
    desc: pane.querySelector(".settings-pane-desc").textContent });
  T("lite", document.documentElement.classList.contains("rouen-lite"));
`;

test("Rouen Lite: no Wall Display, no Plugins, no Away from home", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "lite-page", windowSize: "390x844", budgetMs: 30000, stub: stub(true), driver: DRIVER });
  harness.assertNoPageError(assert, r);
  await t.test("THE one: Settings has no Wall Display, the menu no entry for it", () => {
    assert.equal(r.nav.display, false);
    assert.equal(r.menu, false);
  });
  await t.test("no Plugins: the server lists none (no HQPWeb)", () => assert.equal(r.nav.plugins, false));
  await t.test("Setup stays", () => assert.equal(r.nav.setup, true));
  await t.test("2.0.6-t10 (the owner shelved it in Lite): no Away from home in Setup", () => assert.equal(r.awayEntry, false));
  await t.test("and its page, opened all the same, says so, with no switch or sign-in", () => {
    assert.equal(r.away.line, "Away from home isn't in Rouen Lite.");
    assert.equal(r.away.lineShown, true);
    assert.equal(r.away.switchShown, false);
    assert.equal(r.away.signInShown, false);
    assert.equal(r.away.desc, "Not in Rouen Lite");
  });
  await t.test("the page is marked Lite", () => assert.equal(r.lite, true));
});

test("every other install: as it was", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "lite-page-not", windowSize: "390x844", budgetMs: 30000, stub: stub(false), driver: DRIVER });
  harness.assertNoPageError(assert, r);
  await t.test("Wall Display and Plugins in Settings, the wall display in the menu", () => {
    assert.deepEqual(r.nav, { display: true, plugins: true, setup: true });
    assert.equal(r.menu, true);
  });
  await t.test("Away from home in Setup, with its switch and sign-in", () => {
    assert.equal(r.awayEntry, true);
    assert.equal(r.away.switchShown, true);
    assert.equal(r.away.signInShown, true);
    assert.doesNotMatch(r.away.line, /Rouen Lite/);
  });
  await t.test("not marked Lite", () => assert.equal(r.lite, false));
});
