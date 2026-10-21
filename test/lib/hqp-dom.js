"use strict";
// ---------------------------------------------------------------------------
// The HQPlayer page tests' shared rig (moved out of test/dom/hqplayer.test.js
// in v1.9.34, which was over its length): the answers the page is fed are
// produced by the real /api/hqp handlers driving the fake HQPlayer
// (lib/hqp/fake.js), so the shapes the tests stub are the shapes the server
// sends. See hqplayer.test.js's header for what is pinned.
// ---------------------------------------------------------------------------

require("./no-real-hqplayer");
const harness = require("../dom/harness");
const { FakeHqp, loadProfile } = require("../../lib/hqp/fake");
const { createHqpService } = require("../../lib/hqp/service");

const FAST = { graceMs: 50, healthyMs: 150, maxMs: 600, sampleMs: 20, minSpeed: 0.85, stoppedMs: 150 };

// Real answers, from the real handlers against the fake.
async function fixtures() {
  const fake = new FakeHqp(loadProfile("desktop5-mac-sdm"), { timeScale: 0 });
  await fake.listen();
  let saved = { hqpEnabled: true, hqpHost: "127.0.0.1", hqpPort: fake.port };
  const zones = { z1: { zone_id: "z1", display_name: "Lounge", state: "playing",
    outputs: [{ output_id: "o1", source_controls: [{ display_name: "HQPlayer" }] }],
    now_playing: { image_key: "k1", three_line: { line1: "So What", line2: "Miles Davis", line3: "Kind of Blue" } } } };
  const svc = createHqpService({
    dataDir: null, getSettings: () => saved,
    saveSettings: (p) => { saved = Object.assign({}, saved, p); return true; },
    zones: () => zones, pollMs: 30, speedWindowMs: 300,
    timing: { quick: FAST, major: Object.assign({}, FAST, { maxMs: 800 }) },
  });
  const call = async (m, p, b) => (await svc.dispatch({ method: m, path: p, headers: { "content-type": "application/json" }, body: b })).body;
  // Closed whatever happens: a fake left listening would keep the run from exiting.
  try {
    return await record(call, fake);
  } finally {
    await svc.close();
    await fake.close();
  }
}

async function record(call, fake) {
  const fx = {};
  await call("POST", "/presets", { name: "DSD1024 xla", fromCurrent: true });
  await call("POST", "/presets", { name: "PCM 384k", settings: { mode: "PCM", rate: 384000, shaper: "NS5" } });
  await call("GET", "/now");
  await new Promise((r) => { setTimeout(r, 450); });       // fill the speed window
  fx.now = await call("GET", "/now");
  fx.caps = await call("GET", "/capabilities");
  fx.guide = await call("GET", "/guide");                  // nothing answered yet
  fx.setup = await call("GET", "/setup");
  fx.dacs = await call("GET", "/dacs");
  fx.presets = await call("GET", "/presets");
  fx.change = await call("POST", "/change", { shaper: "ASDM7EC" });
  fx.nowAfter = await call("GET", "/now");
  // A fixed DSD512: AHM7EC8B is now predicted not to play, and saying so is the picker's job.
  await call("POST", "/change", { rate: 22579200 });
  fx.capsDsd512 = await call("GET", "/capabilities");
  fx.guideDsd512 = await call("GET", "/guide");
  // The guide answered: a direct-DSD DAC, any other amp, the volume fixed.
  await call("POST", "/setup", { dsd: "direct", amp: "other", volume: "fixed" });
  fx.guideAnswered = await call("GET", "/guide");
  fx.setupAnswered = await call("GET", "/setup");
  await call("POST", "/setup", { dsd: null, amp: null, volume: null });
  await new Promise((r) => { setTimeout(r, 120); });      // let the poller see it
  fx.nowDsd512 = await call("GET", "/now");
  // The measured stall, applied anyway: it is undone, and the answer says so.
  fx.rollback = await call("POST", "/change", { shaper: "AHM7EC8B" });
  // v1.8.78 (hqpweb 0.1.0-beta.2): a 44.1k track in PCM at a FIXED 192k, where
  // sinc-M cannot do the 4.35× ratio — and HQPlayer's counters above zero.
  await call("POST", "/change", { mode: "PCM" });
  await call("POST", "/change", { filter1x: "poly-sinc-gauss-long", rate: 192000 });
  fake.apod = 15;
  fake.clips = 2;
  fx.capsPcm192 = await call("GET", "/capabilities");
  await new Promise((r) => { setTimeout(r, 120); });
  fx.nowPcm192 = await call("GET", "/now");
  return fx;
}

let FX = null;
async function fx() {
  if (!FX) FX = await fixtures();
  return FX;
}

// The page's API, from the fixtures. `over` replaces any of them.
function stub(f, over) {
  return `
window.__fx = ${JSON.stringify(Object.assign({}, f, over || {}))};
window.__posts = [];
try { localStorage.setItem("rra-zone", "z1"); } catch (e) {}
window.__installFetch(function (u, opts) {
  var m = (opts && opts.method) || "GET";
  if (m !== "GET") {
    var h = (opts && opts.headers) || {};
    window.__posts.push({ url: u, method: m, type: h["Content-Type"] || h["content-type"] || "", body: opts && opts.body ? JSON.parse(opts.body) : null });
  }
  if (u.indexOf("/api/plugins") > -1) return window.__json(u.indexOf("/api/plugins/") > -1 ? { enabled: JSON.parse(opts.body).enabled } : [{ id: "hqplayer", name: "HQPlayer", enabled: window.__fx.pluginOff !== true }]);   // a plugin, v1.9.19
  if (u.indexOf("/api/hqp/now") > -1) {
    // nowDelay: the status is the one the server held when it was ASKED,
    // delivered that much later.
    var snap = window.__fx.now;
    if (!window.__fx.nowDelay) return window.__json(snap);
    return new Promise(function (res) { setTimeout(function () { res(window.__json(snap)); }, window.__fx.nowDelay); });
  }
  if (u.indexOf("/api/hqp/capabilities") > -1) {
    if (window.__fx.capsAnswer) return window.__json(window.__fx.capsAnswer.body, window.__fx.capsAnswer.status);
    return window.__json(window.__fx.caps);
  }
  if (u.indexOf("/api/hqp/presets") > -1 && m === "GET") return window.__json(window.__fx.presets);
  if (u.indexOf("/api/hqp/guide") > -1) return window.__json(window.__fx.guideNow || window.__fx.guide);
  if (u.indexOf("/api/hqp/setup") > -1) {
    if (m === "GET") return window.__json(window.__fx.setupNow || window.__fx.setup);
    // A saved answer: the guide from then on is the answered one.
    window.__fx.guideNow = window.__fx.guideAnswered;
    return window.__json({ setup: window.__fx.guideAnswered.setup });
  }
  if (u.indexOf("/api/hqp/dacs") > -1) return window.__json(window.__fx.dacs);
  if (u.indexOf("/api/hqp/settings") > -1 && m === "GET") return window.__json(window.__fx.settings || { enabled: true, host: "192.0.2.10", port: 4321, learned_count: 0 });
  if (u.indexOf("/api/hqp/change") > -1) {
    // What the server reports from then on, as it would after this change.
    window.__fx.now = window.__fx.nowAfter || window.__fx.now;
    if (window.__fx.changeAnswer) return window.__json(window.__fx.changeAnswer.body, window.__fx.changeAnswer.status);
    return window.__json(window.__fx.change);
  }
  if (u.indexOf("/api/update/status") > -1) return window.__json({ is_docker: true, available: false });
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});`;
}

const OPEN = `
  await window.__sleep(700); await window.RouenPlugins.ready;
  document.getElementById("menu-toggle").click();
  await window.__sleep(300);
  var item = document.getElementById("menu-item-hqplayer");
  T("menu_shown", !item.classList.contains("hidden"));
  item.click();
  await window.__sleep(2000);
  window.__text = function (sel) { var e = document.querySelector(sel); return e ? e.textContent : null; };
  window.__shown = function (sel) {
    var e = document.querySelector(sel);
    return !!e && !e.closest(".hidden") && getComputedStyle(e).display !== "none";
  };
  window.__nowCalls = function () { return window.__callsMatching("/api/hqp/now"); };
`;

const render = (name, stubSrc, driver, size) =>
  harness.renderPage({ name, stub: stubSrc, driver: OPEN + driver, windowSize: size || "390x844", budgetMs: 30000 });


module.exports = { fx, stub, OPEN, render };
