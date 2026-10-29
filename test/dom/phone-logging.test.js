"use strict";
// v1.9.72-t11: Settings → Setup → Logging (public/phone-settings.js; dev/design/android-app.md §4.13), in the Rouen app
// only — the owner: "Build logging into the Android app like mandarin … Make logging an on/off item. Save logs to phone".
// The app's bridge is faked here (the app's own is not testable here); what it answers is §4.13's contract.

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const FETCH = `
window.__installFetch(function (u) {
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [] });
  if (u.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});
`;

const BRIDGE = `
window.__asked = [];
window.__log = { on: false, about: "", saving: false, saved: null, error: null };
window.RouenPhone = {
  settings: function () { return JSON.stringify({ homeQuality: "opus", awayQuality: "opus", network: "home", places: [] }); },
  set: function () { return "{}"; },
  logging: function () { return JSON.stringify(window.__log); },
  loggingUse: function (on) {
    window.__asked.push("use " + on);
    window.__log = { on: on === "true", about: on === "true" ? "1 KB logged, since 10-29 19:30:18.578" : "", saving: false, saved: null, error: null };
    return JSON.stringify(window.__log);
  },
  loggingSave: function () { window.__asked.push("save"); window.__log = Object.assign({}, window.__log, { saving: true }); return JSON.stringify(window.__log); },
  loggingClear: function () { window.__asked.push("clear"); window.__log = Object.assign({}, window.__log, { about: "Nothing logged yet" }); return JSON.stringify(window.__log); }
};
`;

const DRIVER = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const entry = document.querySelector('.settings-nav-item[data-pane="logging"]');
  T("entry", !!entry && !!entry.closest('.settings-pane[data-pane="setup"]'));
  if (!entry) return;
  document.querySelector('.settings-nav-item[data-pane="setup"]').click();
  await sleep(20);
  entry.click();
  await sleep(30);
  const $ = (id) => document.getElementById(id);
  T("off", [$("log-on").checked, $("log-what").textContent, $("log-kept").classList.contains("hidden")]);
  $("log-on").checked = true; $("log-on").dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(20);
  T("on", [$("log-what").textContent.slice(0, 16), $("log-kept").classList.contains("hidden"), $("log-about").textContent, window.__asked.slice()]);
  $("log-save").click();
  await sleep(20);
  T("saving", [$("log-save").disabled, $("log-save").textContent, window.__asked.slice(-1)[0]]);
  window.__log = Object.assign({}, window.__log, { saving: false, saved: "rouen-log-2026-10-29-193100.txt" });
  window.__rouenPhoneChanged();
  T("saved", [$("log-save").disabled, $("log-save").textContent, $("log-saved").textContent]);
  window.__log = Object.assign({}, window.__log, { error: "Couldn't save the log: no space" });
  window.__rouenPhoneChanged();
  T("failed", $("log-saved").textContent);
  $("log-on").checked = false; $("log-on").dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(20);
  T("offAgain", [$("log-kept").classList.contains("hidden"), $("log-what").textContent, window.__asked.slice(-1)[0]]);
`;

test("in the app: Logging — off by default, on with Save log to Downloads/Rouen and Clear; off again hides them (§4.13)", () => {
  const r = harness.renderPage({ stub: FETCH + BRIDGE, driver: DRIVER, name: "phone-logging" });
  harness.assertNoPageError(assert, r);
  assert.equal(r.entry, true);
  assert.deepEqual(r.off, [false, "Off: nothing is logged.", true]);
  assert.deepEqual(r.on, ["Logging is on. U", false, "1 KB logged, since 10-29 19:30:18.578", ["use true"]]);
  assert.deepEqual(r.saving, [true, "Saving…", "save"]);
  assert.deepEqual(r.saved, [false, "Save log", "Saved to Downloads/Rouen/rouen-log-2026-10-29-193100.txt."]);
  assert.equal(r.failed, "Couldn't save the log: no space");
  assert.deepEqual(r.offAgain, [true, "Off: nothing is logged.", "use false"]);
});

test("in a browser (no bridge): no Logging page", () => {
  const r = harness.renderPage({ stub: FETCH, driver: `T("entry", !!document.querySelector('[data-pane="logging"]'));`, name: "phone-logging-browser" });
  harness.assertNoPageError(assert, r);
  assert.equal(r.entry, false);
});
