"use strict";
// ---------------------------------------------------------------------------
// 2.0.4-t3: the signal path away from home (public/signal-path.js, dev/design/signal-path.md §3.4). The owner,
// 2026-11-10 (Now playing on mobile data, "Rouen A142" playing): the card said Lossless and ended at "Output: Rouen
// A142 · Squeezebox", while Rouen's server turned it into Opus 256 for the phone, "so away from home needs to be taken
// into consideration and shown within the signal path". Roon's path is the owner's (Source FLAC 44.1/16, the phone's
// zone on Rouen's server); Rouen's leg comes from the zone's now_playing.format, which fills Now playing's badge.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const ZONE = { zone_id: "a142", display_name: "Rouen A142", state: "playing", is_previous_allowed: true, is_next_allowed: true, is_seek_allowed: true,
  settings: { shuffle: false, loop: "disabled", auto_radio: false }, outputs: [{ output_id: "o1", display_name: "Rouen A142", is_muted: false, volume: null }],
  now_playing: { line1: "Nightrain", line2: "Guns N' Roses", line3: "Appetite for Destruction", artists: [], length: 267, seek_position: 30,
    format: { kind: "opus", text: "256kbps" } } };
const s = (kind, quality, name, text) => ({ kind, quality, name, text });
const PATH = { quality: "lossless", speed: 0.7, format: "FLAC 44.1kHz 16-bit", steps: [
  s("Source", "lossless", "Source", "FLAC 44.1kHz 16-bit · Stereo · Library"), s("Output", "lossless", "Output", "Rouen A142 · Squeezebox")] };

/** @param {string} app  JS that stands in for the Android app's bridge, or "" for a browser */
const stub = (app) => `
window.__zone = ${JSON.stringify(ZONE)};
window.__out = "to Bluetooth (A2DP)";
${app}
try { localStorage.setItem("rra-zone", "a142"); } catch (e) {}
window.__installFetch(function (url) {
  if (url.indexOf("/api/roon/signal-path") > -1) return window.__json({ native: true, found: true, zone_id: "a142", path: ${JSON.stringify(PATH)} });
  if (url.indexOf("/api/zone-state") > -1) return window.__json({ zone: window.__zone });
  if (url.indexOf("/api/zones") > -1) return window.__json({ zones: [window.__zone] });
  if (url.indexOf("/api/queue") > -1) return window.__json({ items: [] });
  if (url.indexOf("/api/filters") > -1) return window.__json({ genres: [] });
  if (url.indexOf("/api/home/") > -1) return window.__json({ albums: [], label: null });
  if (url.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (url.indexOf("/api/settings") > -1) return window.__json({});
  if (url.indexOf("/api/random-albums") > -1) return window.__json({ albums: [], total: 0, filtered: false });
  return undefined;
});`;
// Only what the signal path asks of the app; the page's other uses of the bridge find nothing they need.
const APP = `window.RouenPhone = { localState: function () { return JSON.stringify({ state: "stopped", roon_zone: "Rouen A142" }); },
  output: function () { return JSON.stringify({ output: window.__out }); } };`;

const DRIVER = `
  var st = document.createElement("style"); st.textContent = "*, *::before, *::after { animation: none !important; transition: none !important; }";
  document.head.appendChild(st);
  function $(q) { return document.querySelector(q); }
  function words(e) { return e ? (e.textContent || "").replace(/\\s+/g, " ").trim() : null; }
  function look() { var b = $("#np-signal");
    return { dot: b && b.querySelector(".sp-dot") ? b.querySelector(".sp-dot").className.replace("sp-dot", "").trim() : null, label: b ? b.getAttribute("aria-label") : null,
      quality: words($(".sp-quality")), steps: Array.prototype.map.call(document.querySelectorAll(".sp-step"), function (li) {
        return [li.querySelector(".sp-dot").className.replace("sp-dot", "").trim(), words(li.querySelector(".sp-name")), li.querySelector(".sp-text") ? words(li.querySelector(".sp-text")) : null]; }) }; }
  await window.__sleep(500);
  var bar = document.getElementById("mini-transport");
  for (var w = 0; w < 40 && bar.classList.contains("hidden"); w++) await window.__sleep(100);
  document.querySelector(".mt-info").click();
  await window.__sleep(900);
  $("#np-signal").click();
  await window.__sleep(200);
  T("opus", look());
  // The phone's server switched to lossless (Wi-Fi, say): the card follows the badge, Roon's path unchanged.
  window.__zone.now_playing = Object.assign({}, window.__zone.now_playing, { format: { kind: "lossless", text: "Lossless · 16-bit/44.1 kHz" } });
  window.__out = "connected: wired, the phone's speaker";
  for (var i = 0; i < 80 && !/lossless/.test(($("#np-format") || {}).className || ""); i++) await window.__sleep(100);
  await window.__sleep(5600);
  T("lossless", look());
  // A zone the server serves no phone through: no badge, so Roon's path alone.
  window.__zone.now_playing = Object.assign({}, window.__zone.now_playing, { format: null });
  for (var j = 0; j < 80 && !$("#np-format").classList.contains("hidden"); j++) await window.__sleep(100);
  await window.__sleep(200);
  T("none", look());
`;

function steps(r, key) { return r[key].steps.map((x) => x.join(" | ")); }

test("signal path away from home: Rouen's leg after Roon's, Opus making it High quality", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const r = harness.renderPage({ stub: stub(""), driver: DRIVER, name: "signal-path-away", windowSize: "390x844", budgetMs: 60000 });
  harness.assertNoPageError(assert, r);

  await t.test("THE one: Opus 256 — Rouen's step after Roon's output, and the path green, High quality", () => {
    assert.deepEqual(steps(r, "opus"), [
      "is-lossless | Source | FLAC 44.1kHz 16-bit · Stereo · Library", "is-lossless | Output | Rouen A142 · Squeezebox",
      "is-high | Rouen | Encoded to Opus 256 kbps by Rouen's server"]);
    assert.equal(r.opus.quality, "High quality");
    assert.equal(r.opus.dot, "is-high", "the button's dot green too");
    assert.equal(r.opus.label, "Signal path: High quality. FLAC 44.1kHz 16-bit");
  });

  await t.test("lossless passed through: Rouen's step says so, the path stays Lossless; no badge, no Rouen step", () => {
    assert.deepEqual(steps(r, "lossless").slice(-1), ["is-lossless | Rouen | Passed through lossless by Rouen's server · 16-bit/44.1 kHz"]);
    assert.equal(r.lossless.quality, "Lossless");
    assert.deepEqual(steps(r, "none").map((x) => x.split(" | ")[1]), ["Source", "Output"]);
    assert.equal(r.none.quality, "Lossless");
  });

  await t.test("in a browser, no phone step: only the app knows where the sound comes out", () => {
    assert.ok(!steps(r, "opus").some((x) => /This phone/.test(x)));
  });
});

test("signal path in the app, on this phone's own zone: 'This phone' and where the sound comes out", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const r = harness.renderPage({ stub: stub(APP), driver: DRIVER, name: "signal-path-app", windowSize: "390x844", budgetMs: 60000 });
  harness.assertNoPageError(assert, r);

  await t.test("the last step: This phone · Bluetooth (A2DP), in the dot of the step before", () => {
    assert.deepEqual(steps(r, "opus").slice(-2), ["is-high | Rouen | Encoded to Opus 256 kbps by Rouen's server", "is-high | This phone | Bluetooth (A2DP)"]);
  });
  await t.test("before Android 13, what is connected; and with no badge, after Roon's output", () => {
    assert.deepEqual(steps(r, "lossless").slice(-1), ["is-lossless | This phone | Connected: wired, the phone's speaker"]);
    assert.deepEqual(steps(r, "none").map((x) => x.split(" | ")[1]), ["Source", "Output", "This phone"]);
  });
});
