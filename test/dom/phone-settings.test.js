"use strict";
// v1.9.72-t9: Settings → Setup → Streaming & downloads (public/phone-settings.js; dev/design/android-app.md §4.11), in
// the Rouen app only: the page shows the phone's own settings and changes them through the app's bridge,
// window.RouenPhone. Without the bridge (any browser) neither the page nor its entry exists. The bridge here is a fake,
// as the app's is not testable here; what it answers is §4.11's contract.

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
window.__sets = [];
window.__phone = { homeQuality: "opus", awayQuality: "opus", network: "away", downloadQuality: "original",
  downloadLocation: "phone", downloadWifiOnly: true, downloadLimitGb: 0,
  places: [{ id: "phone", label: "Phone storage", free: 5368709120 }, { id: "sd", label: "SD card", free: 1073741824 }] };
window.RouenPhone = {
  settings: function () { return JSON.stringify(window.__phone); },
  set: function (k, v) {
    window.__sets.push([k, v]);
    if (k === "downloadLocation" && v === "sd") return JSON.stringify({ error: "The SD card is not there." });
    window.__phone[k] = v === "true" ? true : v === "false" ? false : /^\\d+$/.test(v) ? Number(v) : v;
    return JSON.stringify(window.__phone);
  }
};
`;

const DRIVER = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const entry = document.querySelector('.settings-nav-item[data-pane="phone"]');
  T("entry", !!entry);
  T("entryBeforeAway", !!entry && !!entry.nextElementSibling && entry.nextElementSibling.getAttribute("data-pane") === "away");
  if (!entry) return;
  document.querySelector('.settings-nav-item[data-pane="setup"]').click();
  await sleep(50);
  entry.click();
  await sleep(50);
  const pane = document.querySelector('.settings-pane[data-pane="phone"]');
  T("open", !pane.classList.contains("hidden"));
  const sel = (k) => pane.querySelector('[data-phone-set="' + k + '"]');
  T("shown", [sel("homeQuality").value, sel("awayQuality").value, sel("downloadQuality").value, sel("downloadLocation").value,
    sel("downloadLimitGb").value, sel("downloadWifiOnly").checked]);
  T("places", Array.from(sel("downloadLocation").options).map((o) => o.textContent));
  T("network", document.getElementById("phone-network").textContent);
  const change = (el, v) => { if (el.type === "checkbox") el.checked = v; else el.value = v; el.dispatchEvent(new Event("change", { bubbles: true })); };
  change(sel("awayQuality"), "lossless");
  change(sel("downloadWifiOnly"), false);
  change(sel("downloadLocation"), "sd");
  await sleep(20);
  T("sets", window.__sets);
  T("error", document.getElementById("phone-error").textContent);
  T("afterError", sel("downloadLocation").value);
  window.__phone.homeQuality = "lossless";
  window.__rouenPhoneChanged();
  T("followed", sel("homeQuality").value);
`;

test("in the app: the phone's streaming and download settings, shown and changed through its bridge", () => {
  const r = harness.renderPage({ stub: FETCH + BRIDGE, driver: DRIVER, name: "phone-settings" });
  harness.assertNoPageError(assert, r);
  assert.equal(r.entry, true);
  assert.equal(r.entryBeforeAway, true, "Mandarin's place: before Away from home");
  assert.equal(r.open, true);
  assert.deepEqual(r.shown, ["opus", "opus", "original", "phone", "0", true]);
  assert.deepEqual(r.places, ["Phone storage · 5.0 GB free", "SD card · 1.0 GB free"]);
  assert.equal(r.network, "This phone is away from home now.");
  assert.deepEqual(r.sets, [["awayQuality", "lossless"], ["downloadWifiOnly", "false"], ["downloadLocation", "sd"]]);
  assert.equal(r.error, "The SD card is not there.");
  assert.equal(r.afterError, "phone", "a refused change shows what the app kept");
  assert.equal(r.followed, "lossless", "a change made in the app reaches the open page");
});

test("in a browser (no bridge): no page and no entry", () => {
  const r = harness.renderPage({ stub: FETCH, driver: `T("entry", !!document.querySelector('[data-pane="phone"]'));`, name: "phone-settings-browser" });
  harness.assertNoPageError(assert, r);
  assert.equal(r.entry, false);
});

const UPDATES = `
window.__asked = [];
window.__update = { current: "1.9.72-t8", latest: "1.9.72-t8", available: false, busy: false, error: null };
window.RouenPhone.appUpdate = function () { return JSON.stringify(window.__update); };
window.RouenPhone.appUpdateCheck = function () {
  window.__asked.push("check");
  window.__update = { current: "1.9.72-t8", latest: "1.9.72-t9", available: true, busy: false, error: null };
  return "{}";
};
window.RouenPhone.appUpdateInstall = function () {
  window.__asked.push("install");
  window.__update = Object.assign({}, window.__update, { busy: true });
  return "{}";
};
`;

const UPDATE_DRIVER = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btn = document.getElementById("app-update-btn");
  T("row", !!btn && !!btn.closest('.settings-pane[data-pane="system"]'));
  if (!btn) return;
  const line = document.getElementById("app-update-status");
  document.querySelector('.settings-nav-item[data-pane="system"]').click();
  await sleep(20);
  T("opened", [btn.textContent, line.textContent, window.__asked.slice()]);
  btn.click();
  await sleep(20);
  T("installing", [btn.textContent, btn.disabled, line.textContent, window.__asked.slice()]);
  window.__update = { current: "1.9.72-t8", latest: "1.9.72-t9", available: true, busy: false, error: "Couldn't download the update: no answer" };
  window.__rouenPhoneChanged();
  T("failed", [btn.textContent, btn.disabled, line.textContent]);
`;

test("in the app: Settings → Updates has the app's own update — looked for on opening, then Update installs it (§4.12)", () => {
  const r = harness.renderPage({ stub: FETCH + BRIDGE + UPDATES, driver: UPDATE_DRIVER, name: "phone-settings-update" });
  harness.assertNoPageError(assert, r);
  assert.equal(r.row, true);
  assert.deepEqual(r.opened, ["Update", "Version 1.9.72-t9 is ready to install (this is 1.9.72-t9).", ["check"]]);
  assert.deepEqual(r.installing, ["Working…", true, "Downloading version 1.9.72-t9…", ["check", "install"]]);
  assert.deepEqual(r.failed, ["Update", false, "Couldn't download the update: no answer"]);
});
