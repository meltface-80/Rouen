"use strict";
// ---------------------------------------------------------------------------
// public/zone-settings.js: a zone's own settings in the zone sheet — the main remote's "Play on" popover and the
// Shelf's zone menu (the owner's choice, 2026-10-23).
//   N3-3b (v1.9.66-t6, native-remote.md §15.6): read for the zone the sheet has chosen; nothing when native mode is off.
//   N3-3c (v1.9.66-t7, §15.7): changed — each control shows the server's value, a change is sent and the section shown
//   as the server then holds it; a change not taken is said and the control put back; each output's DSP on or off.
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
const DSP = { native: true, found: true, outputs: [{ output: "TV Speaker", id: "e1", dsp: true }] };
// an output whose DSP can't be read: shown as such, with why (the review)
const DSP2 = { native: true, found: true, outputs: [{ output: "TV Speaker", id: "e1", dsp: true }, { output: "Sub", id: "e2", dsp: null, why: "Your server didn't say." }] };
const ZONE = { zone_id: "16aa01", display_name: "TV Speaker", state: "paused", queue_items_remaining: 0,
  settings: { shuffle: false, loop: "disabled", auto_radio: false },
  outputs: [{ output_id: "o1", display_name: "TV Speaker", is_muted: false, volume: { type: "number", min: 0, max: 100, value: 20, step: 1 } }],
  now_playing: { line1: "So What", line2: "Miles Davis", line3: "Kind of Blue", length: 545, seek_position: 30 } };

// The stub server: a crossfade change is taken and shown — its answer also carries a timer changed meanwhile (60 min),
// which only a section shown afresh from the answer can show; a sleep timer change is sent and not shown (409's body).
const stub = (answer, dsp = DSP) => `
window.__asked = []; window.__posts = [];
try { localStorage.setItem("rra-zone", "16aa01"); localStorage.setItem("rra-shelf-help", JSON.stringify({ seen: "9.9.9", never: true })); } catch (e) { /* always there here */ }
window.__installFetch(function (u, o) {
  if (o && o.method === "POST" && u.indexOf("/api/roon/zone-") > -1) {
    var b = JSON.parse(o.body); window.__posts.push([u.replace(/^.*\\/api\\//, "/api/"), b]);
    if (u.indexOf("zone-dsp") > -1) return window.__json({ seen: true, dsp: b.on });
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
        return [r.dataset.setting, sel ? sel.value : sw ? sw.getAttribute("aria-checked") : null]; }) : null,
      status: box && box.querySelector(".zone-settings-status") ? box.querySelector(".zone-settings-status").textContent : null,
      note: box && box.querySelector('[data-setting="sleep"] small') ? box.querySelector('[data-setting="sleep"] small').textContent : null,
      prev: box && box.previousElementSibling ? box.previousElementSibling.id || null : null,
      next: box && box.nextElementSibling ? box.nextElementSibling.id || box.nextElementSibling.tagName : null };
  }
  function pick(sheet, key, value) {
    var sel = sheet.querySelector('.zone-settings [data-setting="' + key + '"] select');
    sel.value = value; sel.dispatchEvent(new Event("change", { bubbles: true }));
  }
  // the time as this page's browser says it, from the same answer (one source)
  T("ends", " ends " + new Date("${ON.sleep.ends}").toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
`;

const ROWS = [["crossfade", "10"], ["leveling", "album"], ["target", "-14"], ["sleep", "45"], ["dsp", "true"]];

const MAIN = READ + `
  await window.__sleep(400);
  var bar = document.getElementById("mini-transport");
  for (var w = 0; w < 40 && bar.classList.contains("hidden"); w++) await window.__sleep(100);
  var pop = document.getElementById("mt-zone-popover");
  document.getElementById("mt-zone").click();
  await window.__sleep(700);
  T("open", !pop.classList.contains("hidden"));
  T("first", said(pop));
  pick(pop, "crossfade", "5");                       // taken: the section shown as the server then holds it
  await window.__sleep(500);
  T("afterFade", said(pop));
  pick(pop, "sleep", "90");                          // not shown: said, and put back
  await window.__sleep(500);
  T("afterSleep", said(pop));
  pop.querySelector('.zone-settings [role=switch]').click();   // DSP off
  await window.__sleep(500);
  T("afterDsp", said(pop));
  T("stillOpen", !pop.classList.contains("hidden"));
  T("posts", window.__posts);
  T("dspReads", window.__dspReads);
  // closed and opened again: read afresh, and still one section
  document.getElementById("mt-zone").click();
  await window.__sleep(200);
  document.getElementById("mt-zone").click();
  await window.__sleep(700);
  T("sections", pop.querySelectorAll(".zone-settings").length);
  T("asked", window.__asked);
`;

const SHELF = READ + `
  var S = function () { return window.__shelfState && window.__shelfState(); };
  for (var i = 0; i < 60 && !S(); i++) await window.__sleep(100);
  await window.__sleep(600);
  var zones = document.getElementById("zones");
  document.getElementById("mt-zone-btn").click();
  await window.__sleep(800);
  T("open", !zones.classList.contains("hidden"));
  var s = said(zones);
  s.last = zones.lastElementChild === zones.querySelector(".zone-settings");
  var sw = zones.querySelector(".zone-settings [role=switch]");
  // the menu's own buttons fill its width; the DSP switch keeps its own (the review: shelf-bar.css .zones button)
  s.switchNarrow = !!sw && sw.getBoundingClientRect().width < zones.getBoundingClientRect().width / 2;
  T("first", s);
  pick(zones, "crossfade", "3");
  await window.__sleep(500);
  T("stillOpen", !zones.classList.contains("hidden"));
  // opened again, with the DSP switch on in the menu: the zone asked is still the menu's checked zone
  document.body.click();
  await window.__sleep(200);
  document.getElementById("mt-zone-btn").click();
  await window.__sleep(800);
  T("asked", window.__asked);
`;

test("the main remote's zone sheet: each setting changeable, shown as the server holds it (v1.9.66-t7)", { skip: !harness.available }, () => {
  const r = harness.renderPage({ name: "zone-settings-main", windowSize: "390x844", stub: stub(ON), driver: MAIN });
  harness.assertNoPageError(assert, r);
  assert.equal(r.open, true);
  assert.deepEqual(r.first.rows, ROWS);
  assert.equal(r.first.note, r.ends, "when the timer ends, beside it");
  assert.equal(r.first.hidden, false);
  assert.deepEqual([r.first.prev, r.first.next], ["mt-zone-list", "mt-group-open"], "under the zones, above the actions");
  assert.deepEqual([r.afterFade.rows[0], r.afterFade.rows[3]], [["crossfade", "5"], ["sleep", "60"]], "taken: the whole section as the server holds it");
  assert.deepEqual(r.afterSleep.rows[3], ["sleep", "60"], "not taken: put back");
  assert.equal(r.afterSleep.status, "Your server took it, but the zone didn't show it within 3 s.");
  assert.deepEqual(r.afterDsp.rows[4], ["dsp", "false"]);
  assert.equal(r.stillOpen, true, "changing a setting keeps the sheet open");
  assert.deepEqual(r.posts, [["/api/roon/zone-settings", { zone_id: "16aa01", crossfade: 5 }], ["/api/roon/zone-settings", { zone_id: "16aa01", sleep: 90 }],
    ["/api/roon/zone-dsp", { zone_id: "16aa01", output: "TV Speaker", on: false }]]);
  assert.equal(r.dspReads, 1, "a setting changed keeps the DSP rows as read, not read again (the review)");
  assert.equal(r.sections, 1, "opened twice, one section");
  assert.deepEqual(r.asked, ["/api/roon/zone-settings?zone_id=16aa01", "/api/roon/zone-settings?zone_id=16aa01"], "the chosen zone, asked at each opening");
  r.asked.forEach((u) => assert.match(u, /zone_id=[0-9a-fA-F]{2,64}$/, "an id the route takes"));
});

test("an output whose DSP can't be read: said so, with why, beside the others", { skip: !harness.available }, () => {
  const r = harness.renderPage({ name: "zone-settings-dsp2", windowSize: "390x844", stub: stub(ON, DSP2), driver: MAIN.slice(0, MAIN.indexOf("pick(pop")) + `
    T("dspText", Array.prototype.map.call(pop.querySelectorAll('.zone-settings [data-setting="dsp"]'), function (r) { return r.textContent; }));
    T("dspWhy", (pop.querySelector('.zone-settings [data-setting="dsp"] span[title]') || {}).title || null);` });
  harness.assertNoPageError(assert, r);
  assert.deepEqual(r.dspText, ["DSP: TV SpeakerOn", "DSP: SubCan't read"]);
  assert.equal(r.dspWhy, "Your server didn't say.");
});

test("native mode off: the zone sheet as it was, nothing more", { skip: !harness.available }, () => {
  const r = harness.renderPage({ name: "zone-settings-off", windowSize: "390x844", stub: stub(OFF), driver: MAIN.slice(0, MAIN.indexOf("pick(pop")) });
  harness.assertNoPageError(assert, r);
  assert.equal(r.open, true);
  assert.equal(r.first.hidden, true);
});

test("the Shelf's zone menu: the same controls, at its foot (the owner: both now)", { skip: !harness.available }, () => {
  const r = harness.renderPage({ name: "zone-settings-shelf", page: "shelf", windowSize: "1366x1024", budgetMs: 30000, stub: stub(ON), driver: SHELF });
  harness.assertNoPageError(assert, r);
  assert.equal(r.open, true);
  assert.deepEqual(r.first.rows, ROWS);
  assert.equal(r.first.hidden, false);
  assert.equal(r.first.last, true, "at the menu's foot, under its zones");
  assert.equal(r.first.switchNarrow, true);
  assert.equal(r.stillOpen, true, "a setting changed keeps the menu open");
  assert.deepEqual(r.asked, ["/api/roon/zone-settings?zone_id=16aa01", "/api/roon/zone-settings?zone_id=16aa01"]);
});
