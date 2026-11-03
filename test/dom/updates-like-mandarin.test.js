"use strict";
// ---------------------------------------------------------------------------
// v2.0.0-beta2: Settings → Updates as Mandarin's (the owner, 2026-11-03: "I want Rouen's update screen to be like Mandarin.
// Rouen's is confusing", with Mandarin's screen: "Server v1.1.15-t25 [Check for update]", "Android app v1.1.15-t25
// [Check for update]", nothing else). public/update-check.js (the server's row), public/phone-settings.js (the app's),
// public/login.js (the page):
//   - two rows, each "Server v…" / "Android app v…" and Check for update; no description, no ⓘ, no Choices row, no
//     "Version …" line (and, without accounts, no Account section);
//   - a look that finds nothing says "Up to date" on its button for a few seconds, on each row;
//   - in a browser, the server's row alone.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const FETCH = `
window.__installFetch(function (u) {
  if (u.indexOf("/api/update/status") > -1) return window.__json({ current: "2.0.0-beta1", latest: "2.0.0-beta1", available: false,
    checking: false, error: null, apply: { phase: "idle", error: null, version: null } });
  if (u.indexOf("/api/update/check") > -1) return window.__json({ ok: true });
  if (u.indexOf("/api/choices") > -1) return window.__json({ made: true, accounts: false, native: true });
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});`;

const BRIDGE = `
window.__update = { current: "2.0.0-beta1", latest: "2.0.0-beta1", available: false, busy: false, error: null };
window.RouenPhone = {
  localState: function () { return JSON.stringify({ state: "stopped", roon_zone: "Rouen Pixel" }); },
  settings: function () { return JSON.stringify({ homeQuality: "opus", awayQuality: "opus", network: "home", places: [] }); },
  set: function () { return "{}"; },
  appUpdate: function () { return JSON.stringify(window.__update); },
  appUpdateCheck: function () { window.__update = Object.assign({}, window.__update, { busy: false }); return "{}"; },
  appUpdateInstall: function () { return "{}"; }
};`;

const DRIVER = `
  var st = document.createElement("style"); st.textContent = ".settings-sheet { animation: none !important; }";
  document.head.appendChild(st);
  document.getElementById("settings-toggle").click();
  await window.__sleep(300);
  document.querySelector('.settings-nav-item[data-pane="system"]').click();
  await window.__sleep(500);
  var pane = document.querySelector('.settings-pane[data-pane="system"]');
  var shown = function (el) { return !!el && !el.closest(".hidden") && getComputedStyle(el).display !== "none"; };
  T("rows", Array.prototype.filter.call(pane.querySelectorAll(".settings-row"), shown).map(function (row) {
    var b = row.querySelector("button.settings-update-btn");
    return [row.querySelector(".settings-label").textContent.trim(), b ? b.textContent : null];
  }));
  T("extra", {
    desc: !!pane.querySelector(".settings-pane-desc"),
    info: Array.prototype.filter.call(pane.querySelectorAll(".settings-info-btn"), shown).length,
    choices: !!document.getElementById("choices-status"),
    notes: Array.prototype.filter.call(pane.querySelectorAll(".settings-note"), shown).map(function (n) { return n.textContent; })
  });
  var server = document.getElementById("check-update-btn");
  server.click();
  var app = document.getElementById("app-update-btn");
  if (app) app.click();
  await window.__sleep(400);
  T("after", [server.textContent, app ? app.textContent : null]);
`;

test("v2.0.0-beta2: Updates is Mandarin's two rows, each its version and Check for update", { skip: !harness.available }, async (t) => {
  const inApp = harness.renderPage({ name: "updates-mandarin-app", windowSize: "390x844", budgetMs: 20000, stub: FETCH + BRIDGE, driver: DRIVER });
  harness.assertNoPageError(assert, inApp);
  const browser = harness.renderPage({ name: "updates-mandarin-browser", windowSize: "390x844", budgetMs: 20000, stub: FETCH, driver: DRIVER });
  harness.assertNoPageError(assert, browser);
  await t.test("THE one: in the app, the server's row and the app's, as Mandarin draws them", () => {
    assert.deepEqual(inApp.rows, [["Server v2.0.0-beta1", "Check for update"], ["Android app v2.0.0-beta1", "Check for update"]]);
  });
  await t.test("nothing else on the page: no description, no ⓘ, no Choices, no version line", () => {
    assert.deepEqual(inApp.extra, { desc: false, info: 0, choices: false, notes: [] });
  });
  await t.test("a look that finds nothing says so on its own button", () => {
    assert.deepEqual(inApp.after, ["Up to date", "Up to date"]);
  });
  await t.test("in a browser, the server's row alone", () => {
    assert.deepEqual(browser.rows, [["Server v2.0.0-beta1", "Check for update"]]);
    assert.deepEqual(browser.after, ["Up to date", null]);
  });
});
