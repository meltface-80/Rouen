"use strict";
// v1.9.72-t65: Settings → Audio Devices (public/audio-devices.js), laid out as Mandarin's (the owner, 2026-11-02): the
// zone chosen, then every device as a card — name, what it is, state, chevron — each opening the device's own page
// with its settings as the zone sheet shows them (zone-settings.js). No switch and no Hide / unhide (the owner).
// Rouen's server is stubbed here.

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const ON = { native: true, found: true, zone_id: "16aa01", crossfade: { on: true, seconds: 10 },
  leveling: { on: true, mode: "album", value: 2, target: -14, adjustment: -5 }, sleep: { on: false, minutes: 0 } };
const ZONES = [
  { zone_id: "16aa01", display_name: "TV Speaker", state: "paused", outputs: [{ output_id: "o1", display_name: "TV Speaker" }] },
  { zone_id: "16bb02", display_name: "Lounge + Kitchen", state: "playing", outputs: [{ output_id: "o2", display_name: "Lounge" }, { output_id: "o3", display_name: "Kitchen" }] },
  { zone_id: "16cc03", display_name: "<b>Study</b>", state: "stopped", outputs: [{ output_id: "o4", display_name: "Chord Poly:Mojo2" }] }];

const STUB = `
window.__asked = [];
window.__installFetch(function (u) {
  if (u.indexOf("/api/roon/zone-settings") > -1) { window.__asked.push(u.replace(/^.*\\/api\\//, "/api/")); return window.__json(${JSON.stringify(ON)}); }
  if (u.indexOf("/api/roon/zone-dsp") > -1) return window.__json({ native: true, found: true, outputs: [] });
  if (u.indexOf("/api/zones") > -1) { window.__zonesAsked = (window.__zonesAsked || 0) + 1; return window.__json({ zones: ${JSON.stringify(ZONES)} }); }
  if (u.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});`;

const DRIVER = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  T("nav", document.querySelector('.settings-nav-item[data-pane="playback"] .settings-nav-title').textContent);
  window.__openSettingsPane("playback");
  await sleep(150);
  const pane = document.querySelector('.settings-pane[data-pane="playback"]');
  T("title", pane.querySelector("h2").textContent);
  const cards = [...document.querySelectorAll("#ad-devices .ad-card")];
  T("cards", cards.map((c) => [c.querySelector(".ad-name").textContent, c.querySelector(".ad-sub").textContent, c.querySelector(".ad-state").textContent]));
  T("markup", document.querySelectorAll("#ad-devices b").length);
  T("noSwitch", [document.querySelectorAll("#ad-devices input, #ad-devices .switch").length, /hide/i.test(pane.textContent)]);
  T("order", [...pane.querySelectorAll("#zone-select, #ad-devices, #waveform-enabled, #radio-toggle")].map((e) => e.id));
  // A card: the device's own page, its name, and its settings as the zone sheet shows them.
  cards[0].click();
  await sleep(200);
  const dev = document.querySelector('.settings-pane[data-pane="audio-device"]');
  T("device", [dev.classList.contains("hidden"), document.getElementById("ad-device-name").textContent, document.getElementById("ad-device-sub").textContent]);
  T("asked", window.__asked.slice());
  T("section", !!document.querySelector("#ad-device-settings .zone-settings:not([hidden])"));
  // A device with no DSP to show (outputs: [] here): nothing of DSP on its page, as no row in the zone sheet (§15.10).
  await sleep(200);
  T("noDsp", document.querySelector("#ad-device-settings .zone-dsp").textContent);
  // Back, and the grouped zone's page asks for that zone.
  dev.querySelector("[data-settings-back]").click();
  await sleep(100);
  T("back", pane.classList.contains("hidden"));
  document.querySelectorAll("#ad-devices .ad-card")[1].click();
  await sleep(200);
  T("asked2", window.__asked.slice(-1)[0]);
  // Back on Audio Devices, the list is read again — and each card is kept, updated where it is, never rebuilt.
  const first = document.querySelector("#ad-devices .ad-card");
  document.querySelector('.settings-pane[data-pane="audio-device"] [data-settings-back]').click();
  const was = window.__zonesAsked;
  await sleep(5600);
  T("again", [window.__zonesAsked - was >= 2, document.querySelector("#ad-devices .ad-card") === first]);
  // Closed from Audio Devices itself, the list is asked no more.
  const before = window.__zonesAsked;
  document.querySelector("[data-settings-close]").click();
  await sleep(5600);
  T("closed", window.__zonesAsked - before);
`;

test("Settings → Audio Devices: Mandarin's layout — every device a card, each opening its own settings", () => {
  const r = harness.renderPage({ stub: STUB, driver: DRIVER, name: "audio-devices", windowSize: "390x844" });
  harness.assertNoPageError(assert, r);
  assert.equal(r.nav, "Audio Devices");
  assert.equal(r.title, "Audio Devices");
  assert.deepEqual(r.cards, [["TV Speaker", "Roon", "PAUSED"], ["Lounge + Kitchen", "Lounge + Kitchen", "PLAYING"], ["<b>Study</b>", "Chord Poly:Mojo2", "STOPPED"]]);
  assert.equal(r.markup, 0, "a device's name is shown as text, never as markup");
  assert.deepEqual(r.noSwitch, [0, false], "no enable switch and no Hide / unhide (the owner)");
  assert.deepEqual(r.order, ["zone-select", "ad-devices", "waveform-enabled", "radio-toggle"], "zone, devices, then waveform and the radios");
  assert.deepEqual(r.device, [false, "TV Speaker", "Roon"]);
  assert.deepEqual(r.asked, ["/api/roon/zone-settings?zone_id=16aa01"], "the device's own settings, read for it");
  assert.equal(r.section, true, "its settings shown on its page");
  assert.equal(r.noDsp, "", "a device with no DSP shows none");
  assert.equal(r.back, false, "Back returns to Audio Devices");
  assert.equal(r.asked2, "/api/roon/zone-settings?zone_id=16bb02");
  assert.deepEqual(r.again, [true, true], "read again while on screen, the cards kept");
  assert.equal(r.closed, 0, "Settings closed: the list is not asked again");
});

// This phone's card, in the app: This phone's own page (its streaming quality), Back to Audio Devices; Setup has no
// entry for it (v1.9.72-t67).
const PHONE_ZONES = [{ zone_id: "this-phone", display_name: "This phone", state: "playing", outputs: [] }].concat(ZONES);
const PHONE_STUB = STUB.replace(JSON.stringify(ZONES), JSON.stringify(PHONE_ZONES)) + `
window.RouenPhone = { settings: function () { return JSON.stringify({ homeQuality: "opus", awayQuality: "opus", network: "home",
  downloadQuality: "original", downloadLocation: "phone", downloadWifiOnly: true, downloadLimitGb: 0, places: [] }); },
  set: function () { return "{}"; } };`;

const PHONE_DRIVER = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shown = () => { const p = document.querySelector(".settings-view:not(.hidden)"); return p && (p.getAttribute("data-pane") || p.getAttribute("data-view")); };
  window.__openSettingsPane("playback");
  await sleep(200);
  const phone = document.querySelector('#ad-devices .ad-card[data-zone="this-phone"]');
  T("phone", [phone && phone.getAttribute("data-pane"), phone && phone.querySelector(".ad-sub").textContent]);
  phone.click();
  await sleep(150);
  T("opened", shown());
  document.querySelector('.settings-pane[data-pane="phone-streaming"] [data-settings-back]').click();
  await sleep(150);
  T("back", shown());
  // No entry for it in Setup (v1.9.72-t67, the owner: "remove the duplicate streaming settings in setup").
  T("inSetup", document.querySelectorAll('.settings-pane[data-pane="setup"] .settings-nav-item[data-pane="phone-streaming"]').length);
`;

test("This phone's card opens This phone's own page, Back returns to Audio Devices, and Setup has no entry for it", () => {
  const r = harness.renderPage({ stub: PHONE_STUB, driver: PHONE_DRIVER, name: "audio-devices-phone", windowSize: "390x844" });
  harness.assertNoPageError(assert, r);
  assert.deepEqual(r.phone, ["phone-streaming", "Phone"]);
  assert.equal(r.opened, "phone-streaming");
  assert.equal(r.back, "playback", "Back from This phone's page returns to Audio Devices");
  assert.equal(r.inSetup, 0, "no duplicate in Setup");
});

// v1.9.72-t66: each device's page shows its own DSP, in place (the owner, 2026-11-02: "Each device will show their own
// DSP settings that we have added via reverse eng code"): each item with its switch, and its settings beneath its name —
// no DSP row and no window.
const DSP_ITEMS = [
  { id: "61", name: "Headroom management", on: true, can: true, settings: { kind: "headroom", part: "71", gain: -3, min: -30, max: 0, canGain: true, clipping: false, canClipping: true } },
  { id: "62", name: "Crossfeed", on: false, can: true },
];
const DSP_STUB = STUB.replace('if (u.indexOf("/api/roon/zone-dsp") > -1) return window.__json({ native: true, found: true, outputs: [] });', `
  if (u.indexOf("/api/roon/zone-dsp") > -1 && o && o.method === "POST") {
    var b = JSON.parse(o.body); window.__dspPosts = (window.__dspPosts || []).concat([b]);
    return window.__json({ seen: true, item: { id: b.item, name: "Crossfeed", on: b.on, can: true } });
  }
  if (u.indexOf("/api/roon/zone-dsp") > -1) { window.__dspAsked = (window.__dspAsked || []).concat([u.replace(/^.*\\/api\\//, "/api/")]);
    return window.__json({ native: true, found: true, outputs: [{ output: "TV Speaker", id: "e1", items: ${JSON.stringify(DSP_ITEMS)} }] }); }`)
  .replace("window.__installFetch(function (u) {", "window.__installFetch(function (u, o) {");

const DSP_DRIVER = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__openSettingsPane("playback");
  await sleep(200);
  document.querySelector('#ad-devices .ad-card[data-zone="16aa01"]').click();
  await sleep(400);
  const host = document.getElementById("ad-device-settings");
  T("asked", window.__dspAsked || []);
  T("items", [...host.querySelectorAll(".zone-dsp .zone-dsp-item .zone-dsp-name")].map((e) => e.textContent));
  T("noRow", [host.querySelectorAll('[data-setting="dsp"]').length, document.querySelectorAll(".zone-dsp-window").length]);
  host.querySelector('.zone-dsp [role="switch"][data-item="62"]').click();
  await sleep(150);
  T("sent", window.__dspPosts || []);
  T("shown", host.querySelector('.zone-dsp [role="switch"][data-item="62"]').getAttribute("aria-checked"));
  const name = host.querySelector(".zone-dsp button[aria-expanded]");
  name.click();
  await sleep(150);
  T("settings", [name.getAttribute("aria-expanded"), !host.querySelector(".zone-dsp-settings").hidden]);
`;

test("a device's page shows its own DSP in place: each item, its switch, its settings beneath — no row, no window", () => {
  assert.notEqual(DSP_STUB, STUB, "the DSP stub took");
  const r = harness.renderPage({ stub: DSP_STUB, driver: DSP_DRIVER, name: "audio-devices-dsp", windowSize: "390x844" });
  harness.assertNoPageError(assert, r);
  assert.deepEqual(r.asked, ["/api/roon/zone-dsp?zone_id=16aa01"], "the device's own DSP, read for it");
  assert.deepEqual(r.items, ["Headroom management", "Crossfeed"]);
  assert.deepEqual(r.noRow, [0, 0], "no DSP row and no window on a device's page");
  assert.deepEqual(r.sent, [{ zone_id: "16aa01", item: "62", on: true }]);
  assert.equal(r.shown, "true");
  assert.deepEqual(r.settings, ["true", true], "an item's settings open beneath it");
});

// v1.9.72-t70 (dev/design/android-app.md §4.23): in the app, the phone's own Roon zone ("Rouen <phone>", as the app's
// hello learned it) is the card that says "This phone", and its page leads to its streaming quality — the Streaming
// page's only way in now that Setup has no entry for it (v1.9.72-t67) and "This phone" is offline only.
const OWN_ZONES = ZONES.concat([{ zone_id: "16dd04", display_name: "Rouen Pixel", state: "stopped", outputs: [{ output_id: "o9", display_name: "Rouen Pixel" }] }]);
const OWN_STUB = STUB.replace(JSON.stringify(ZONES), JSON.stringify(OWN_ZONES)) + `
window.RouenPhone = { localState: function () { return JSON.stringify({ state: "stopped", roon_zone: "Rouen Pixel" }); },
  settings: function () { return JSON.stringify({ homeQuality: "opus", awayQuality: "opus", network: "home",
    downloadQuality: "original", downloadLocation: "phone", downloadWifiOnly: true, downloadLimitGb: 0, places: [] }); },
  set: function () { return "{}"; } };`;

const OWN_DRIVER = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shown = () => { const p = document.querySelector(".settings-view:not(.hidden)"); return p && (p.getAttribute("data-pane") || p.getAttribute("data-view")); };
  window.__openSettingsPane("playback");
  await sleep(200);
  const cards = [...document.querySelectorAll("#ad-devices .ad-card")];
  T("cards", cards.map((c) => [c.querySelector(".ad-name").textContent, c.querySelector(".ad-sub").textContent, c.getAttribute("data-pane")]));
  const row = () => document.getElementById("ad-stream-row");
  // Another device first: no row on its page.
  cards[0].click();
  await sleep(150);
  T("other", row() ? row().hidden : null);
  document.querySelector('.settings-pane[data-pane="audio-device"] [data-settings-back]').click();
  await sleep(100);
  document.querySelector('#ad-devices .ad-card[data-zone="16dd04"]').click();
  await sleep(150);
  T("mine", [shown(), document.getElementById("ad-device-name").textContent, !!row() && !row().hidden]);
  row().click();
  await sleep(150);
  T("stream", [shown(), document.querySelector('.settings-pane[data-pane="phone-streaming"] h2').textContent]);
`;

test("in the app, the phone's own Roon zone says This phone, and its page leads to its streaming quality", () => {
  const r = harness.renderPage({ stub: OWN_STUB, driver: OWN_DRIVER, name: "audio-devices-own", windowSize: "390x844" });
  harness.assertNoPageError(assert, r);
  assert.deepEqual(r.cards[3], ["Rouen Pixel", "This phone", "audio-device"], "the phone's own zone, named as This phone, opens its page");
  assert.deepEqual(r.cards.slice(0, 3).map((c) => c[1]), ["Roon", "Lounge + Kitchen", "Chord Poly:Mojo2"], "the others as before");
  assert.equal(r.other, null, "no Streaming quality row on another device's page");
  assert.deepEqual(r.mine, ["audio-device", "Rouen Pixel", true], "its page, with the Streaming quality row");
  assert.deepEqual(r.stream, ["phone-streaming", "This phone"], "the row opens the streaming quality page");
});
