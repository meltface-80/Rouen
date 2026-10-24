"use strict";
// ---------------------------------------------------------------------------
// public/zone-dsp-settings.js (v1.9.66-t12, native-remote.md §15.12): a DSP item's settings in the DSP window, opened
// beneath it by tapping its name (the owner's choice); numbers by − value +, choices by the server's own lists, each
// change sent once and shown as the server then holds it, one not taken said and put back. The server is stubbed here
// (lib/roon-direct/dsp-parts.js and dsp-settings.js are tested in test/unit).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const ON = { native: true, found: true, zone_id: "16aa01", crossfade: { on: false, seconds: 0 },
  leveling: { on: false, mode: "off", value: 0, target: -14, adjustment: -5 }, sleep: { on: false, minutes: 30, ends: null } };
const ZONE = { zone_id: "16aa01", display_name: "TV Speaker", state: "paused", queue_items_remaining: 0,
  settings: { shuffle: false, loop: "disabled", auto_radio: false },
  outputs: [{ output_id: "o1", display_name: "TV Speaker", is_muted: false, volume: { type: "number", min: 0, max: 100, value: 20, step: 1 } }],
  now_playing: { line1: "So What", line2: "Miles Davis", line3: "Kind of Blue", length: 545, seek_position: 30 } };
// as the owner's server held them (§15.12): Headroom −3 dB; Crossfeed on its default preset; SRC in custom, two rules
const ITEMS = [
  { id: "61", name: "Headroom management", on: true, can: true, settings: { kind: "headroom", part: "71", gain: -3, min: -30, max: 0, canGain: true, clipping: false, canClipping: true } },
  { id: "62", name: "Crossfeed", on: false, can: true, settings: { kind: "crossfeed", part: "72", preset: "default", presets: ["default", "cmoy", "meier", "custom"], canPreset: true,
    cut: 700, cutMin: 300, cutMax: 2000, canCut: false, feed: 4.5, feedMin: 1, feedMax: 15, canFeed: false } },
  { id: "63", name: "Sample rate conversion", on: true, can: true, settings: { kind: "src", part: "73", mode: "custom", modes: ["none", "max_sample_rate", "custom"], canMode: true,
    filter: "minimum_phase", filters: ["linear_phase", "minimum_phase"], canFilter: true,
    dsdToPcm: null, dsdToPcms: ["lowpass_24khz", "lowpass_30khz"], canDsdToPcm: true, canRules: true, rulesComplete: true,
    rules: [{ id: "81", input: 44100, output: null, outputs: [44100, 48000] }] } },
  { id: "64", name: "Convolution", on: false, can: true },
  // settings it can't change: nothing to open (the review: no empty panel)
  { id: "65", name: "Headroom management", on: false, can: true, settings: { kind: "headroom", part: "75", gain: 0, min: -30, max: 0, canGain: false, clipping: false, canClipping: false } },
];

// The stub server: each setting taken and shown, but the SRC filter, which is said not taken.
const STUB = `
window.__posts = [];
try { localStorage.setItem("rra-zone", "16aa01"); } catch (e) { /* always there here */ }
var items = ${JSON.stringify(ITEMS)};
window.__installFetch(function (u, o) {
  if (o && o.method === "POST" && u.indexOf("/api/roon/zone-dsp/setting") > -1) {
    var b = JSON.parse(o.body); window.__posts.push(b);
    if (b.setting === "src.filter") return window.__json({ seen: false, why: "Your server took it, but the item didn't show it within 3 s." });
    var it = JSON.parse(JSON.stringify(items.filter(function (x) { return x.id === b.item; })[0])), st = it.settings;
    if (b.setting === "headroom.gain") st.gain = b.value;
    if (b.setting === "headroom.clipping") st.clipping = b.value;
    if (b.setting === "crossfeed.preset") { st.preset = b.value; st.canCut = st.canFeed = b.value === "custom"; if (b.value === "custom") st.feed = 14.8; }
    if (b.setting === "crossfeed.feed") st.feed = b.value;
    if (b.setting === "src.rule") st.rules[0].output = b.value;
    items = items.map(function (x) { return x.id === it.id ? it : x; });
    return window.__json({ seen: true, item: it });
  }
  if (u.indexOf("/api/roon/zone-settings") > -1) return window.__json(${JSON.stringify(ON)});
  if (u.indexOf("/api/roon/zone-dsp") > -1) return window.__json({ native: true, found: true, outputs: [{ output: "TV Speaker", id: "e1", items: items }] });
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (u.indexOf("/api/queue") > -1) return window.__json({ items: [], history: [] });
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  return undefined;
});
`;

const DRIVER = `
  await window.__sleep(400);
  var bar = document.getElementById("mini-transport");
  for (var w = 0; w < 40 && bar.classList.contains("hidden"); w++) await window.__sleep(100);
  document.getElementById("mt-zone").click();
  await window.__sleep(700);
  document.querySelector('#mt-zone-popover .zone-settings [data-setting="dsp"]').click();
  await window.__sleep(600);
  var W = document.querySelector(".zone-dsp-window");
  var names = W.querySelectorAll(".zone-dsp-item button[aria-expanded]");
  function panel(i) { return W.querySelectorAll(".zone-dsp-settings")[i]; }
  function rows(p) { return Array.prototype.map.call(p.querySelectorAll(".zone-dsp-setting"), function (r) {
    var sel = r.querySelector("select"), v = r.querySelector(".zone-dsp-value"), sw = r.querySelector("[role=switch]"), bs = r.querySelectorAll("button");
    return [r.dataset.setting, sel ? sel.value : v ? v.textContent : sw ? sw.getAttribute("aria-checked") : null].concat(v ? [bs[0].disabled, bs[1].disabled] : []); }); }
  T("openers", names.length);
  T("closedFirst", panel(0).hidden);
  names[0].click();                                   // Headroom: opens beneath it
  await window.__sleep(100);
  T("head", rows(panel(0)));
  T("expanded", names[0].getAttribute("aria-expanded"));
  panel(0).querySelector('[data-setting="headroom.gain"] button:last-child').click();   // + : −3 → −2.5
  await window.__sleep(300);
  T("headUp", rows(panel(0)));
  panel(0).querySelector('[data-setting="headroom.clipping"] [role=switch]').click();
  await window.__sleep(300);
  T("headClip", rows(panel(0)));
  names[0].click();                                   // tapped again: closes
  T("closedAgain", panel(0).hidden);
  names[1].click();                                   // Crossfeed: cut and feed not changeable but in custom
  await window.__sleep(100);
  T("cross", rows(panel(1)));
  T("crossNote", panel(1).textContent.indexOf("Choose the Custom preset to change these.") > -1);
  var pre = panel(1).querySelector('[data-setting="crossfeed.preset"] select');
  pre.value = "custom"; pre.dispatchEvent(new Event("change", { bubbles: true }));
  await window.__sleep(300);
  T("crossCustom", rows(panel(1)));
  panel(1).querySelector('[data-setting="crossfeed.feed"] button:last-child').click();   // 14.8 up: to its bound, 15
  await window.__sleep(300);
  T("crossTop", rows(panel(1)));
  names[2].click();                                   // SRC: a rule, to 48 kHz and back; the filter, not taken
  await window.__sleep(100);
  T("src", rows(panel(2)));
  T("notSet", (panel(2).querySelector('[data-setting="src.dsdToPcm"] select').selectedOptions[0] || {}).textContent);
  // Tab from a select mid-window is left to the page: the window's trap knows its selects (the review: one left out
  // was taken for the end, and focus thrown back to Close)
  var midSel = panel(2).querySelector('[data-setting="src.filter"] select');
  midSel.focus();
  midSel.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  T("tabFromSelect", [document.activeElement.tagName, document.activeElement.getAttribute("aria-label")]);
  var rule = panel(2).querySelector('[data-setting="src.rule"] select');
  rule.value = "48000"; rule.dispatchEvent(new Event("change", { bubbles: true }));
  await window.__sleep(300);
  rule = panel(2).querySelector('[data-setting="src.rule"] select');
  T("rule48", rule.value);
  rule.value = ""; rule.dispatchEvent(new Event("change", { bubbles: true }));
  await window.__sleep(300);
  T("ruleSame", panel(2).querySelector('[data-setting="src.rule"] select').value);
  var fil = panel(2).querySelector('[data-setting="src.filter"] select');
  fil.value = "linear_phase"; fil.dispatchEvent(new Event("change", { bubbles: true }));
  await window.__sleep(300);
  T("filterBack", panel(2).querySelector('[data-setting="src.filter"] select').value);
  T("status", W.querySelector(".zone-dsp-status").textContent);
  T("posts", window.__posts);
`;

test("an item's settings beneath it: tapped open and shut; − value +, a switch, the server's lists; each sent once, shown as held", { skip: !harness.available }, () => {
  const r = harness.renderPage({ name: "zone-dsp-settings", windowSize: "390x844", stub: STUB, driver: DRIVER });
  harness.assertNoPageError(assert, r);
  assert.equal(r.openers, 3, "only the items with settings open (Convolution has none here)");
  assert.equal(r.closedFirst, true);
  assert.deepEqual(r.head, [["headroom.gain", "-3 dB", false, false], ["headroom.clipping", "false"]]);
  assert.equal(r.expanded, "true");
  assert.deepEqual(r.headUp[0], ["headroom.gain", "-2.5 dB", false, false], "+ steps 0.5 dB, as the server then holds it");
  assert.deepEqual(r.headClip[1], ["headroom.clipping", "true"]);
  assert.equal(r.closedAgain, true, "tapped again, closed");
  assert.deepEqual(r.cross, [["crossfeed.preset", "default"], ["crossfeed.cut", "700 Hz", true, true], ["crossfeed.feed", "4.5 dB", true, true]],
    "only custom's values can be changed: their buttons disabled");
  assert.equal(r.crossNote, true);
  assert.deepEqual(r.crossCustom, [["crossfeed.preset", "custom"], ["crossfeed.cut", "700 Hz", false, false], ["crossfeed.feed", "14.8 dB", false, false]]);
  assert.deepEqual(r.crossTop[2], ["crossfeed.feed", "15 dB", false, true], "a value off the step reaches its bound, then + is disabled");
  assert.deepEqual(r.src.map((x) => x[0]), ["src.mode", "src.filter", "src.rule", "src.dsdToPcm"]);
  assert.equal(r.notSet, "Not set", "a value the server didn't send: said, not shown as the first choice");
  assert.deepEqual(r.tabFromSelect, ["SELECT", "Filter"]);
  assert.deepEqual([r.rule48, r.ruleSame], ["48000", ""]);
  assert.equal(r.filterBack, "minimum_phase", "not taken: shown as it was");
  assert.equal(r.status, "Your server took it, but the item didn't show it within 3 s.");
  assert.deepEqual(r.posts, [{ zone_id: "16aa01", item: "61", setting: "headroom.gain", value: -2.5 }, { zone_id: "16aa01", item: "61", setting: "headroom.clipping", value: true },
    { zone_id: "16aa01", item: "62", setting: "crossfeed.preset", value: "custom" }, { zone_id: "16aa01", item: "62", setting: "crossfeed.feed", value: 15 },
    { zone_id: "16aa01", item: "63", setting: "src.rule", value: 48000, rule: "81" },
    { zone_id: "16aa01", item: "63", setting: "src.rule", value: null, rule: "81" }, { zone_id: "16aa01", item: "63", setting: "src.filter", value: "linear_phase" }]);
});
