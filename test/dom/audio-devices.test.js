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
  assert.equal(r.back, false, "Back returns to Audio Devices");
  assert.equal(r.asked2, "/api/roon/zone-settings?zone_id=16bb02");
  assert.deepEqual(r.again, [true, true], "read again while on screen, the cards kept");
  assert.equal(r.closed, 0, "Settings closed: the list is not asked again");
});

// This phone's card, in the app: its Streaming page, and Back to Audio Devices — while Setup's own row still goes Back
// to Setup.
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
  document.querySelector('.settings-pane[data-pane="playback"] [data-settings-back]').click();
  await sleep(100);
  document.querySelector('.settings-nav-item[data-pane="setup"]').click();
  await sleep(100);
  document.querySelector('.settings-pane[data-pane="setup"] .settings-nav-item[data-pane="phone-streaming"]').click();
  await sleep(150);
  document.querySelector('.settings-pane[data-pane="phone-streaming"] [data-settings-back]').click();
  await sleep(150);
  T("setupBack", shown());
`;

test("This phone's card opens its Streaming page, and Back returns to Audio Devices; from Setup, Back is still Setup's", () => {
  const r = harness.renderPage({ stub: PHONE_STUB, driver: PHONE_DRIVER, name: "audio-devices-phone", windowSize: "390x844" });
  harness.assertNoPageError(assert, r);
  assert.deepEqual(r.phone, ["phone-streaming", "Phone"]);
  assert.equal(r.opened, "phone-streaming");
  assert.equal(r.back, "playback", "Back from This phone's page returns to Audio Devices");
  assert.equal(r.setupBack, "setup", "opened from Setup, Back is Setup's as before");
});
