"use strict";
// ---------------------------------------------------------------------------
// N3-3b (public/zone-settings.js, v1.9.66-t6, native-remote.md §15.6): a zone's crossfade, volume levelling and sleep
// timer in the zone sheet, read only — the main remote's "Play on" popover and the Shelf's zone menu, the owner's
// choice (2026-10-23). Shown for the zone the sheet has chosen; nothing at all when native mode is off. The server's
// answer is stubbed here (lib/roon-direct/zone-settings.js is tested in test/unit/roon-direct-zone-settings.test.js).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

// zone ids as the server's are, hex, so the request is one the real route takes (the review)
const ON = { native: true, found: true, zone_id: "16aa01", crossfade: { on: true, seconds: 10 },
  leveling: { on: true, mode: "album", value: 2, target: -14, adjustment: -5 },
  sleep: { on: true, minutes: 45, ends: "2026-10-23T18:53:47.764Z" } };
const OFF = { native: false, why: "Native mode is off." };
const ZONE = { zone_id: "16aa01", display_name: "TV Speaker", state: "paused", queue_items_remaining: 0,
  settings: { shuffle: false, loop: "disabled", auto_radio: false },
  outputs: [{ output_id: "o1", display_name: "TV Speaker", is_muted: false, volume: { type: "number", min: 0, max: 100, value: 20, step: 1 } }],
  now_playing: { line1: "So What", line2: "Miles Davis", line3: "Kind of Blue", length: 545, seek_position: 30 } };

const stub = (answer) => `
window.__asked = [];
try { localStorage.setItem("rra-zone", "16aa01"); localStorage.setItem("rra-shelf-help", JSON.stringify({ seen: "9.9.9", never: true })); } catch (e) { /* always there here */ }
window.__installFetch(function (u) {
  if (u.indexOf("/api/roon/zone-settings") > -1) { window.__asked.push(u.replace(/^.*\\/api\\//, "/api/")); return window.__json(${JSON.stringify(answer)}); }
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (u.indexOf("/api/queue") > -1) return window.__json({ items: [], history: [] });
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (u.indexOf("/api/shelf/albums") > -1) return window.__json({ total: 0, rev: "1.0", sig: "x", albums: [], genres: [], letters: [] });
  if (u.indexOf("/api/random-albums") > -1) return window.__json({ albums: [], total: 0, filtered: false });
  return undefined;
});
`;

/** What the section says, read from the page itself. */
const READ = `
  function said(sheet) {
    var box = sheet.querySelector(".zone-settings");
    return { present: !!box, hidden: !box || box.hidden,
      rows: box ? Array.prototype.map.call(box.querySelectorAll(".zone-setting"), function (r) {
        return Array.prototype.map.call(r.children, function (c) { return c.textContent; }); }) : null,
      prev: box && box.previousElementSibling ? box.previousElementSibling.id || null : null,
      next: box && box.nextElementSibling ? box.nextElementSibling.id || box.nextElementSibling.tagName : null };
  }
  // the time as this page's browser says it, from the same answer (one source)
  T("ends", "Ends at " + new Date("${ON.sleep.ends}").toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + " (45 minutes)");
`;

const MAIN = READ + `
  await window.__sleep(400);
  var bar = document.getElementById("mini-transport");
  for (var w = 0; w < 40 && bar.classList.contains("hidden"); w++) await window.__sleep(100);
  var pop = document.getElementById("mt-zone-popover");
  document.getElementById("mt-zone").click();
  await window.__sleep(600);
  T("open", !pop.classList.contains("hidden"));
  T("first", said(pop));
  // closed and opened again: read afresh, and still one section
  document.getElementById("mt-zone").click();
  await window.__sleep(200);
  document.getElementById("mt-zone").click();
  await window.__sleep(600);
  T("sections", pop.querySelectorAll(".zone-settings").length);
  T("asked", window.__asked);
`;

const SHELF = READ + `
  var S = function () { return window.__shelfState && window.__shelfState(); };
  for (var i = 0; i < 60 && !S(); i++) await window.__sleep(100);
  await window.__sleep(600);
  var zones = document.getElementById("zones");
  document.getElementById("mt-zone-btn").click();
  await window.__sleep(700);
  T("open", !zones.classList.contains("hidden"));
  var s = said(zones);
  s.last = zones.lastElementChild === zones.querySelector(".zone-settings");
  T("first", s);
  T("asked", window.__asked);
`;

test("the main remote's zone sheet: crossfade, levelling and the sleep timer for the chosen zone (v1.9.66-t6)", { skip: !harness.available }, () => {
  const r = harness.renderPage({ name: "zone-settings-main", windowSize: "390x844", stub: stub(ON), driver: MAIN });
  harness.assertNoPageError(assert, r);
  assert.equal(r.open, true);
  assert.deepEqual(r.first.rows, [["Crossfade", "10 seconds"], ["Volume levelling", "Album, target −14 LUFS"], ["Sleep timer", r.ends]]);
  assert.equal(r.first.hidden, false);
  assert.deepEqual([r.first.prev, r.first.next], ["mt-zone-list", "mt-group-open"], "under the zones, above the actions");
  assert.equal(r.sections, 1, "opened twice, one section");
  assert.deepEqual(r.asked, ["/api/roon/zone-settings?zone_id=16aa01", "/api/roon/zone-settings?zone_id=16aa01"], "the chosen zone, asked at each opening");
  r.asked.forEach((u) => assert.match(u, /zone_id=[0-9a-fA-F]{2,64}$/, "an id the route takes"));
});

test("native mode off: the zone sheet as it was, nothing more", { skip: !harness.available }, () => {
  const r = harness.renderPage({ name: "zone-settings-off", windowSize: "390x844", stub: stub(OFF), driver: MAIN });
  harness.assertNoPageError(assert, r);
  assert.equal(r.open, true);
  assert.equal(r.first.hidden, true);
});

test("the Shelf's zone menu: the same, at its foot (the owner: both now)", { skip: !harness.available }, () => {
  const r = harness.renderPage({ name: "zone-settings-shelf", page: "shelf", windowSize: "1366x1024", budgetMs: 30000, stub: stub(ON), driver: SHELF });
  harness.assertNoPageError(assert, r);
  assert.equal(r.open, true);
  assert.deepEqual(r.first.rows, [["Crossfade", "10 seconds"], ["Volume levelling", "Album, target −14 LUFS"], ["Sleep timer", r.ends]]);
  assert.equal(r.first.hidden, false);
  assert.equal(r.first.last, true, "at the menu's foot, under its zones");
  assert.deepEqual(r.asked, ["/api/roon/zone-settings?zone_id=16aa01"]);
});
