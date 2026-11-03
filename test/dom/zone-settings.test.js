"use strict";
// ---------------------------------------------------------------------------
// public/zone-settings.js: a zone's own settings on its device's own page, Settings → Audio Devices → a device, and
// only there (the owner, 2026-11-02: "Dont duplicate DSP controls … DSP settings only in Audio Devices and for the
// individual devices"; v1.9.72-t73). The main remote's "Play on" popover and the Shelf's zone menu, which carried them
// from v1.9.66-t6 (the owner's choice, 2026-10-23), no longer do.
//   N3-3b (v1.9.66-t6, native-remote.md §15.6): read for the zone the page is for; nothing when native mode is off.
//   N3-3c (v1.9.66-t7, §15.7): changed — each control shows the server's value, a change is sent and the section shown
//   as the server then holds it; a change not taken is said and the control put back.
//   N3-4 (v1.9.66-t9, §15.9): each output's DSP items, a switch for each that can be switched, drawn in place on the
//   page (zone-dsp.js render); the DSP row and the window it opened (§15.10, v1.9.66-t10) went in v1.9.72-t73.
// The server is stubbed here (lib/roon-direct/zone-settings.js and zone-controls.js are tested in test/unit).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

// zone ids as the server's are, hex, so the request is one the real route takes (the review)
const ON = { native: true, found: true, zone_id: "16aa01", crossfade: { on: true, seconds: 10 },
  leveling: { on: true, mode: "album", value: 2, target: -14, adjustment: -5 },
  sleep: { on: true, minutes: 45, ends: "2026-10-23T18:53:47.764Z" } };
const OFF = { native: false, why: "Native mode is off." };
// one output, as the owner's TV Speaker: Headroom on, Crossfeed off, and an item that can't be switched
const DSP = { native: true, found: true, outputs: [{ output: "TV Speaker", id: "e1", items: [{ id: "61", name: "Headroom management", on: true, can: true },
  { id: "62", name: "Crossfeed", on: false, can: true }, { id: "63", name: "Convolution", on: true, can: false }] }] };
// two outputs and a third: one with an item, one not read (said, with why), one with none (not shown)
const DSP2 = { native: true, found: true, outputs: [{ output: "TV Speaker", id: "e1", items: [{ id: "61", name: "Headroom management", on: true, can: true }] },
  { output: "Sub", id: "e2", why: "Your server didn't say." }, { output: "Kitchen", id: "e3", items: [] }] };
const ZONE = { zone_id: "16aa01", display_name: "TV Speaker", state: "paused", queue_items_remaining: 0,
  settings: { shuffle: false, loop: "disabled", auto_radio: false },
  outputs: [{ output_id: "o1", display_name: "TV Speaker", is_muted: false, volume: { type: "number", min: 0, max: 100, value: 20, step: 1 } }],
  now_playing: { line1: "So What", line2: "Miles Davis", line3: "Kind of Blue", length: 545, seek_position: 30 } };

// The stub server: a crossfade change is taken and shown — its answer also carries a timer changed meanwhile (60 min),
// which only a section shown afresh from the answer can show; a sleep timer change is sent and not shown (409's body).
const stub = (answer, dsp = DSP, noWindow = false) => `
window.__asked = []; window.__posts = [];
// the DSP's script made to fail to load, when asked: the page says so (the review)
if (${noWindow}) {
  var add = Node.prototype.appendChild;
  Node.prototype.appendChild = function (n) { if (n && n.tagName === "SCRIPT" && /zone-dsp\.js$/.test(n.src)) n.src = "/no-such-zone-dsp.js"; return add.call(this, n); };
}
try { localStorage.setItem("rra-zone", "16aa01"); localStorage.setItem("rra-shelf-help", JSON.stringify({ seen: "9.9.9", never: true })); } catch (e) { /* always there here */ }
window.__installFetch(function (u, o) {
  if (o && o.method === "POST" && u.indexOf("/api/roon/zone-") > -1) {
    var b = JSON.parse(o.body); window.__posts.push([u.replace(/^.*\\/api\\//, "/api/"), b]);
    if (u.indexOf("zone-dsp") > -1) {
      if (b.item === "62") return window.__json({ seen: false, why: "Your server took it, but the item didn't show it within 3 s." });
      var ok = window.__json({ seen: true, item: { id: b.item, name: "Headroom management", on: b.on, can: true } });
      // taken slowly when asked (window.__slowDsp): another switch's answer comes first
      return window.__slowDsp ? new Promise(function (r) { setTimeout(function () { r(ok); }, 400); }) : ok;
    }
    if (b.crossfade !== undefined) { var s = JSON.parse(${JSON.stringify(JSON.stringify(ON))}); s.crossfade = { on: b.crossfade > 0, seconds: b.crossfade }; s.sleep.minutes = 60; return window.__json({ seen: true, settings: s }); }
    return window.__json({ seen: false, why: "Your server took it, but the zone didn't show it within 3 s." });
  }
  if (u.indexOf("/api/roon/zone-settings") > -1) { window.__asked.push(u.replace(/^.*\\/api\\//, "/api/")); return window.__json(${JSON.stringify(answer)}); }
  if (u.indexOf("/api/roon/zone-dsp") > -1) { window.__dspReads = (window.__dspReads || 0) + 1; return window.__json(${JSON.stringify(dsp)}); }
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (u.indexOf("/api/queue") > -1) return window.__json({ items: [], history: [] });
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (u.indexOf("/api/shelf/albums") > -1) return window.__json({ total: 0, rev: "1.0", sig: "x", albums: [], genres: [], letters: [] });
  if (u.indexOf("/api/random-albums") > -1) return window.__json({ albums: [], total: 0, filtered: false });
  return undefined;
});
`;

/** What the section shows, read from the page itself. */
const READ = `
  function said(sheet) {
    var box = sheet.querySelector(".zone-settings");
    return { present: !!box, hidden: !box || box.hidden,
      rows: box ? Array.prototype.map.call(box.querySelectorAll(".zone-setting"), function (r) {
        var sel = r.querySelector("select"), sw = r.querySelector("[role=switch]");
        return [r.dataset.setting, sel ? sel.value : sw ? r.firstChild.textContent + ":" + sw.getAttribute("aria-checked") : r.textContent]; }) : null,
      status: box && box.querySelector(".zone-settings-status") ? box.querySelector(".zone-settings-status").textContent : null,
      note: box && box.querySelector('[data-setting="sleep"] small') ? box.querySelector('[data-setting="sleep"] small').textContent : null,
      prev: box && box.previousElementSibling ? box.previousElementSibling.id || null : null,
      next: box && box.nextElementSibling ? box.nextElementSibling.id || box.nextElementSibling.tagName : null };
  }
  function pick(sheet, key, value) {
    var sel = sheet.querySelector('.zone-settings [data-setting="' + key + '"] select');
    sel.value = value; sel.dispatchEvent(new Event("change", { bubbles: true }));
  }
  // the device page's DSP as it shows, in place: each output's heading, each item's name and state, the status line
  function dsp() {
    var w = document.querySelector("#ad-device-settings .zone-dsp");
    if (!w) return null;
    return { rows: Array.prototype.map.call(w.querySelectorAll(".zone-dsp-item"), function (x) {
        var sw = x.querySelector("[role=switch]");
        return [x.querySelector(".zone-dsp-name").textContent, sw ? sw.getAttribute("aria-checked") : x.lastChild.textContent]; }),
      text: w.textContent, status: w.querySelector(".zone-dsp-status") ? w.querySelector(".zone-dsp-status").textContent : null,
      tall: Array.prototype.every.call(w.querySelectorAll(".zone-dsp-item"), function (x) { return x.getBoundingClientRect().height >= 44; }) };
  }
  // Settings → Audio Devices → TV Speaker: the zone's own page
  var page = document.querySelector('.settings-pane[data-pane="audio-device"]'), host = document.getElementById("ad-device-settings");
  async function openDevice() {
    window.__openSettingsPane("playback");
    await window.__sleep(200);
    document.querySelector('#ad-devices .ad-card[data-zone="16aa01"]').click();
    await window.__sleep(700);
  }
  // the time as this page's browser says it, from the same answer (one source)
  T("ends", " ends " + new Date("${ON.sleep.ends}").toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
`;

const ROWS = [["crossfade", "10"], ["leveling", "album"], ["target", "-14"], ["sleep", "45"]];

const MAIN = READ + `
  await window.__sleep(400);
  await openDevice();
  T("open", !page.classList.contains("hidden"));
  var first = said(host);
  first.parent = host.querySelector(".zone-settings") && host.querySelector(".zone-settings").parentElement.id;
  T("first", first);
  pick(host, "crossfade", "5");                      // taken: the section shown as the server then holds it
  await window.__sleep(500);
  T("afterFade", said(host));
  pick(host, "sleep", "90");                         // not shown: said, and put back
  await window.__sleep(500);
  T("afterSleep", said(host));
  T("stillOpen", !page.classList.contains("hidden"));
  // the DSP, in place on the page, kept through the setting changed above
  T("win", dsp());
  var W = host.querySelector(".zone-dsp");
  W.querySelector('[data-item="61"]').click();       // Headroom off: taken
  await window.__sleep(500);
  T("afterDsp", dsp());
  W.querySelector('[data-item="62"]').click();       // Crossfeed on: not shown, said
  await window.__sleep(500);
  T("afterDsp2", dsp());
  // Headroom on, taken slowly; Crossfeed meanwhile, not taken: what Crossfeed said stays when Headroom's answer comes
  window.__slowDsp = true;
  W.querySelector('[data-item="61"]').click();
  await window.__sleep(50);
  W.querySelector('[data-item="62"]').click();
  await window.__sleep(800);
  T("afterBoth", dsp());
  window.__slowDsp = false;
  T("posts", window.__posts);
  // Back, and the page opened again: read afresh, and still one section
  page.querySelector("[data-settings-back]").click();
  await window.__sleep(100);
  document.querySelector('#ad-devices .ad-card[data-zone="16aa01"]').click();
  await window.__sleep(700);
  T("sections", host.querySelectorAll(".zone-settings").length);
  T("asked", window.__asked);
  T("dspReads", window.__dspReads || 0);
`;

// The main remote's Play on popover and the Shelf's zone menu, each opened and left to settle: nothing of the zone's
// settings or its DSP in either, and nothing asked for them.
const POPOVER = READ + `
  await window.__sleep(400);
  var bar = document.getElementById("mini-transport");
  for (var w = 0; w < 40 && bar.classList.contains("hidden"); w++) await window.__sleep(100);
  var pop = document.getElementById("mt-zone-popover");
  document.getElementById("mt-zone").click();
  await window.__sleep(1200);
  T("open", !pop.classList.contains("hidden"));
  T("listed", pop.querySelectorAll("#mt-zone-list *").length > 0);
  T("found", [pop.querySelectorAll(".zone-settings").length, pop.querySelectorAll('[data-setting="dsp"]').length,
    document.querySelectorAll(".zone-dsp-window").length]);
  T("asked", window.__asked);
`;

const SHELF = READ + `
  var S = function () { return window.__shelfState && window.__shelfState(); };
  for (var i = 0; i < 60 && !S(); i++) await window.__sleep(100);
  await window.__sleep(600);
  var zones = document.getElementById("zones");
  document.getElementById("mt-zone-btn").click();
  await window.__sleep(1200);
  T("open", !zones.classList.contains("hidden"));
  T("listed", zones.querySelectorAll("button[data-zone]").length);
  T("found", [zones.querySelectorAll(".zone-settings").length, zones.querySelectorAll('[data-setting="dsp"]').length,
    document.querySelectorAll(".zone-dsp-window").length]);
  T("asked", window.__asked);
`;

test("a device's own page: settings changeable, shown as held, refusals put back; its DSP in place (v1.9.66-t7, t9; v1.9.72-t73)", { skip: !harness.available }, () => {
  const r = harness.renderPage({ name: "zone-settings-main", windowSize: "390x844", stub: stub(ON), driver: MAIN });
  harness.assertNoPageError(assert, r);
  assert.equal(r.open, true);
  assert.deepEqual(r.first.rows, ROWS, "no DSP row: the DSP is drawn in place below the settings");
  assert.equal(r.first.note, r.ends, "when the timer ends, beside it");
  assert.equal(r.first.hidden, false);
  assert.equal(r.first.parent, "ad-device-settings", "on the device page's own settings block");
  assert.deepEqual([r.afterFade.rows[0], r.afterFade.rows[3]], [["crossfade", "5"], ["sleep", "60"]], "taken: the whole section as the server holds it");
  assert.deepEqual(r.afterSleep.rows[3], ["sleep", "60"], "not taken: put back");
  assert.equal(r.afterSleep.status, "Your server took it, but the zone didn't show it within 3 s.");
  assert.equal(r.stillOpen, true, "changing a setting keeps the page open");
  assert.deepEqual(r.win.rows, [["Headroom management", "true"], ["Crossfeed", "false"], ["Convolution", "On"]]);
  assert.match(r.win.text, /^DSPTV Speaker.*Each change pauses playback for a moment\.$/);
  // Was also: in view, at the foot, focus on Close — the DSP window's own layout; the window is gone (v1.9.72-t73).
  assert.equal(r.win.tall, true, "a phone: made to be tapped");
  assert.deepEqual(r.afterDsp.rows[0], ["Headroom management", "false"], "taken: the switch as the server holds it");
  assert.deepEqual(r.afterDsp2.rows[1], ["Crossfeed", "false"], "not taken: the switch as it was");
  assert.equal(r.afterDsp2.status, "Your server took it, but the item didn't show it within 3 s.");
  assert.deepEqual([r.afterBoth.rows[0], r.afterBoth.status], [["Headroom management", "true"], "Your server took it, but the item didn't show it within 3 s."],
    "one switch taken never clears what another said");
  // Was also: Tab kept in the window, Escape closing it alone and focus back to the zone button — the DSP window's
  // own keys; the window is gone (v1.9.72-t73), and the page is Settings' own.
  assert.deepEqual(r.posts, [["/api/roon/zone-settings", { zone_id: "16aa01", crossfade: 5 }], ["/api/roon/zone-settings", { zone_id: "16aa01", sleep: 90 }],
    ["/api/roon/zone-dsp", { zone_id: "16aa01", item: "61", on: false }], ["/api/roon/zone-dsp", { zone_id: "16aa01", item: "62", on: true }],
    ["/api/roon/zone-dsp", { zone_id: "16aa01", item: "61", on: true }], ["/api/roon/zone-dsp", { zone_id: "16aa01", item: "62", on: true }]]);
  assert.equal(r.dspReads, 2, "the page at each opening (a setting changed keeps its DSP), no window to read it again");
  assert.equal(r.sections, 1, "opened twice, one section");
  assert.deepEqual(r.asked, ["/api/roon/zone-settings?zone_id=16aa01", "/api/roon/zone-settings?zone_id=16aa01"], "the device's zone, asked at each opening");
  r.asked.forEach((u) => assert.match(u, /zone_id=[0-9a-fA-F]{2,64}$/, "an id the route takes"));
});

const UNTIL_PICK = MAIN.slice(0, MAIN.indexOf("pick(host"));

test("the page's DSP: each output under its name; one not read said with why, in the open; one with no items not shown", { skip: !harness.available }, () => {
  const r = harness.renderPage({ name: "zone-settings-dsp2", windowSize: "390x844", stub: stub(ON, DSP2), driver: UNTIL_PICK + `
    T("win", dsp());
    T("label", host.querySelector(".zone-dsp [role=switch]").getAttribute("aria-label"));
    var Z = window.RouenZoneDsp, out = function (items, why) { return items ? { output: "A", items: items } : { output: "A", why: why }; };
    T("summaries", [Z.summary({ found: true, outputs: [out([{ name: "X", on: false }])] }), Z.summary({ found: true, outputs: [out([{ name: "X", on: true }, { name: "Y", on: true }])] }),
      Z.summary({ found: true, outputs: [out(null, "no"), out([{ name: "X", on: false }])] }), Z.summary({ found: true, outputs: [out([])] }), Z.summary({ found: false })]);` });
  harness.assertNoPageError(assert, r);
  // Was also: the DSP row's text, "DSPHeadroom management ›" — the row is gone (v1.9.72-t73); summary() is pinned below.
  assert.deepEqual(r.win.rows, [["Headroom management", "true"], ["Can't read", "Your server didn't say."]]);
  assert.match(r.win.text, /TV Speaker.*Sub.*Can't read/);
  assert.doesNotMatch(r.win.text, /Kitchen/, "an output with no items: not shown");
  assert.equal(r.label, "Headroom management, TV Speaker");
  assert.deepEqual(r.summaries, ["Off", "2 on", "Can't read", null, null]);
});

test("the DSP's script not loaded: the page says so, not left out, and nothing opens", { skip: !harness.available }, () => {
  const r = harness.renderPage({ name: "zone-settings-nowin", windowSize: "390x844", stub: stub(ON, DSP, true), driver: UNTIL_PICK + `
    var d = host.querySelector(".zone-dsp");
    T("said", d && d.textContent);
    T("nothing", [host.querySelectorAll('[data-setting="dsp"], .zone-dsp button, .zone-dsp-item').length, document.querySelectorAll(".zone-dsp-window").length]);` });
  harness.assertNoPageError(assert, r);
  assert.equal(r.said, "DSP: Couldn't load — reload the page");
  assert.deepEqual(r.nothing, [0, 0], "no row, no switch, no window");
});

test("native mode off: the device page as it was, nothing more", { skip: !harness.available }, () => {
  const r = harness.renderPage({ name: "zone-settings-off", windowSize: "390x844", stub: stub(OFF), driver: UNTIL_PICK });
  harness.assertNoPageError(assert, r);
  assert.equal(r.open, true);
  assert.equal(r.first.hidden, true);
});

// The owner, 2026-11-02 (v1.9.72-t73): "Dont duplicate DSP controls … DSP settings only in Audio Devices and for the
// individual devices". The zone sheets that carried them from v1.9.66-t6 carry none.
test("only on a device's page: the main remote's Play on popover has no zone settings, no DSP row, no DSP window", { skip: !harness.available }, () => {
  const r = harness.renderPage({ name: "zone-settings-popover", windowSize: "390x844", stub: stub(ON), driver: POPOVER });
  harness.assertNoPageError(assert, r);
  assert.deepEqual([r.open, r.listed], [true, true], "the popover opened, its zones listed");
  assert.deepEqual(r.found, [0, 0, 0], "no .zone-settings, no DSP row, no DSP window");
  assert.deepEqual(r.asked, [], "nothing asked for a zone's settings");
});

test("only on a device's page: the Shelf's zone menu has no zone settings, no DSP row, no DSP window", { skip: !harness.available }, () => {
  const r = harness.renderPage({ name: "zone-settings-shelf", page: "shelf", windowSize: "1366x1024", budgetMs: 30000, stub: stub(ON), driver: SHELF });
  harness.assertNoPageError(assert, r);
  assert.equal(r.open, true);
  assert.ok(r.listed > 0, "the menu's zones listed");
  assert.deepEqual(r.found, [0, 0, 0], "no .zone-settings, no DSP row, no DSP window");
  assert.deepEqual(r.asked, [], "nothing asked for a zone's settings");
});
