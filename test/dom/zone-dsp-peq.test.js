"use strict";
// ---------------------------------------------------------------------------
// public/zone-dsp-peq.js (v1.9.66-t15, native-remote.md §15.15): a Parametric EQ's bands in the DSP window, opened
// beneath its name and read afresh; each band's gain, frequency and Q by − value + (0.5 dB, 1/12 octave, 0.1) and each
// band on or off; each change sent once and shown as the server then holds it, one not taken said and put back. The
// server is stubbed here (lib/roon-direct/peq.js and peq-fresh.js are tested in test/unit).
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
const ITEMS = [{ id: "1335852", name: "Parametric EQ", on: true, can: true, settings: { kind: "peq", part: "1344111" } }];
const ALL = { gain: true, frequency: true, q: true, on: true };
// as the owner's TV Speaker was read (§15.14): a low shelf, a peak, a band stop, a high pass left off
const VIEW = { id: "1335852", gain: -3.1, bands: [
  { n: 1, type: "low_shelf", label: "Low shelf", frequency: 178, gain: -9, q: 1, order: null, on: true, can: ALL },
  { n: 2, type: "equalize_frequency", label: "Peak/dip", frequency: 386, gain: -11.8, q: 1, order: null, on: true, can: ALL },
  { n: 3, type: "band_stop", label: "Band stop", frequency: 1703, gain: -3.6, q: 3.3, order: null, on: true, can: { gain: false, frequency: true, q: true, on: true } },
  { n: 4, type: "high_pass", label: "High pass", frequency: 20, gain: 0, q: null, order: 1, on: false, can: { gain: false, frequency: true, q: false, on: true } },
  // a type Rouen doesn't know: said, not offered (the review)
  { n: 5, type: "tilt", label: "Band", frequency: 1000, gain: 0, q: null, order: null, on: true, can: { gain: false, frequency: false, q: false, on: false } }] };

// The stub server: each change taken and shown, but band 1's gain, which is said not shown (band 1 read as MUSE left it).
const STUB = `
window.__posts = [];
window.__reads = 0;
try { localStorage.setItem("rra-zone", "16aa01"); } catch (e) { /* always there here */ }
var view = ${JSON.stringify(VIEW)};
window.__installFetch(function (u, o) {
  if (u.indexOf("/api/roon/zone-dsp/peq") > -1) {
    if (o && o.method === "POST") {
      var b = JSON.parse(o.body); window.__posts.push(b);
      // not shown afterwards, the EQ as read then (band 1 changed in MUSE meanwhile): shown so, not as it was sent
      if (b.band === 1 && b.setting === "gain") { view = JSON.parse(JSON.stringify(view)); view.bands[0].gain = -8.5;
        return window.__json({ seen: false, why: "Your server took it, but the EQ read afterwards doesn't show it.", item: view }); }
      view = JSON.parse(JSON.stringify(view));
      view.bands[b.band - 1][b.setting] = b.value;
      return window.__json({ seen: true, item: view });
    }
    window.__reads++;
    return window.__json({ item: view });
  }
  if (u.indexOf("/api/roon/zone-settings") > -1) return window.__json(${JSON.stringify(ON)});
  if (u.indexOf("/api/roon/zone-dsp") > -1) return window.__json({ native: true, found: true, outputs: [{ output: "TV Speaker", id: "e1", items: ${JSON.stringify(ITEMS)} }] });
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
  var name = W.querySelector(".zone-dsp-item button[aria-expanded]");
  var panel = W.querySelector(".zone-dsp-settings");
  function rows() { return Array.prototype.map.call(panel.querySelectorAll(".zone-dsp-setting"), function (r) {
    var v = r.querySelector(".zone-dsp-value"), sw = r.querySelector("[role=switch]"), bs = r.querySelectorAll("button");
    return [r.dataset.band, r.dataset.setting, v ? v.textContent : sw ? sw.getAttribute("aria-checked") : "text " + r.lastChild.textContent]
      .concat(v ? [bs[0].disabled, bs[1].disabled] : []); }); }
  function tap(band, setting, which) {
    var r = panel.querySelector('.zone-dsp-setting[data-band="' + band + '"][data-setting="peq.' + setting + '"]');
    (which === "switch" ? r.querySelector("[role=switch]") : r.querySelectorAll("button")[which === "up" ? 1 : 0]).click();
  }
  T("opener", !!name);
  name.click();
  await window.__sleep(250);
  T("reads", window.__reads);
  T("rows", rows());
  T("gainNote", panel.textContent.indexOf("EQ gain -3.1 dB") > -1);
  T("slope", panel.textContent.indexOf("6 dB/octave") > -1);
  tap(2, "gain", "up"); await window.__sleep(250);         // −11.8 → −11.5 (to the step, the review)
  tap(1, "frequency", "up"); await window.__sleep(250);    // 178 → 189: 1/12 octave
  tap(3, "q", "down"); await window.__sleep(250);          // 3.3 → 3.2
  tap(4, "on", "switch"); await window.__sleep(250);       // off → on
  T("after", rows());
  tap(1, "gain", "down"); await window.__sleep(250);       // not taken: said, and band 1 as it was
  T("status", W.querySelector(".zone-dsp-status").textContent);
  T("band1Gain", rows().filter(function (r) { return r[0] === "1" && r[1] === "peq.gain"; })[0][2]);
  name.click(); name.click();                              // closed and opened again: read afresh
  await window.__sleep(250);
  T("readsAgain", window.__reads);
  T("posts", window.__posts);
`;

test("a Parametric EQ's bands beneath it, read afresh: − value + and a switch per band; each sent once, shown as held", { skip: !harness.available }, () => {
  const r = harness.renderPage({ name: "zone-dsp-peq", windowSize: "390x844", stub: STUB, driver: DRIVER });
  harness.assertNoPageError(assert, r);
  assert.equal(r.opener, true, "the EQ's name opens its bands");
  assert.equal(r.reads, 1, "read afresh when opened");
  assert.deepEqual(r.rows, [
    ["1", "peq.on", "true"], ["1", "peq.gain", "-9 dB", false, false], ["1", "peq.frequency", "178 Hz", false, false], ["1", "peq.q", "1", false, false],
    ["2", "peq.on", "true"], ["2", "peq.gain", "-11.8 dB", false, false], ["2", "peq.frequency", "386 Hz", false, false], ["2", "peq.q", "1", false, false],
    ["3", "peq.on", "true"], ["3", "peq.frequency", "1.7 kHz", false, false], ["3", "peq.q", "3.3", false, false],
    ["4", "peq.on", "false"], ["4", "peq.frequency", "20 Hz", true, false], ["5", "peq.on", "text On"]],
    "a band stop has no gain; a high pass only its frequency, at its bound; a type Rouen doesn't know, said only");
  assert.equal(r.gainNote, true, "the EQ's own gain, shown");
  assert.equal(r.slope, true, "a high pass's slope, as MUSE says it");
  assert.deepEqual(r.after.filter((x) => ["2 peq.gain", "1 peq.frequency", "3 peq.q", "4 peq.on"].includes(x[0] + " " + x[1])).map((x) => x[2]),
    ["189 Hz", "-11.5 dB", "3.2", "true"]);
  assert.equal(r.status, "Your server took it, but the EQ read afterwards doesn't show it.");
  assert.equal(r.band1Gain, "-8.5 dB", "not shown: the bands as the server then holds them, not as sent nor as they were");
  assert.equal(r.readsAgain, 2, "opened again: read afresh");
  assert.deepEqual(r.posts, [{ zone_id: "16aa01", item: "1335852", band: 2, setting: "gain", value: -11.5 },
    { zone_id: "16aa01", item: "1335852", band: 1, setting: "frequency", value: 189 }, { zone_id: "16aa01", item: "1335852", band: 3, setting: "q", value: 3.2 },
    { zone_id: "16aa01", item: "1335852", band: 4, setting: "on", value: true }, { zone_id: "16aa01", item: "1335852", band: 1, setting: "gain", value: -9.5 }]);
});
