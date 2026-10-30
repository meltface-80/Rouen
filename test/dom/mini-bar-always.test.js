"use strict";
// ---------------------------------------------------------------------------
// v1.9.72-t26: the mini player is always there (public/mini-bar.js), and in the Android app docked on the row along
// the foot (public/touchnav.css), as Mandarin's (its bug list item 102). The owner, 2026-10-30: "when no zone is
// selected there is no mini transport bar / I want the mini transport bar to be permanently visible on the android app
// as well as browsers / I want the mini transport bar for the app like Mandarin's which is docked to the bottom bar and
// not translucent".
//   - with no zone chosen it says so, and the speaker (and the volume button) opens the zone list;
//   - with a zone that is silent, whose it is and that nothing is playing;
//   - only Now playing, which has its own transport, hides it;
//   - in the app (its User-Agent says RouenAndroid/), edge to edge, its foot on the row's top edge, square, solid in
//     the row's colour, no shadow; a browser on a phone keeps the floating pill.
// Positions compared in one assertion are read from the same page in the same pass (dev/lessons.md).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const TOUCH = "--blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=1,availableHoverTypes=1";
const APP_UA = "--user-agent=Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 RouenAndroid/1.9.72-t26";

const OUT = [{ output_id: "o1", display_name: "Living Room", is_muted: false,
               volume: { type: "number", min: 0, max: 100, value: 40, step: 1 } }];
const PLAYING = { zone_id: "z1", display_name: "Living Room", state: "playing",
  is_previous_allowed: true, is_next_allowed: true, is_seek_allowed: true,
  settings: { shuffle: false, loop: "disabled", auto_radio: false }, outputs: OUT,
  now_playing: { line1: "Our First Trip", line2: "The Odyssey Cult", line3: "Vol. 3", image_key: "", length: 212, seek_position: 40 } };
const SILENT = { zone_id: "z1", display_name: "Living Room", state: "stopped",
  settings: { shuffle: false, loop: "disabled", auto_radio: false }, outputs: OUT };

// zones: what /api/zones lists; zone: what /api/zone-state answers; chosen: the zone kept from before, if any.
const stub = ({ zones, zone, chosen }) => `
try {
  localStorage.removeItem("rra-transport");
  ${chosen ? `localStorage.setItem("rra-zone", ${JSON.stringify(chosen)});` : `localStorage.removeItem("rra-zone");`}
} catch (e) { /* storage optional */ }
window.__installFetch(function (u) {
  if (u.indexOf("/api/zones") > -1)      return window.__json({ zones: ${JSON.stringify(zones)} });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(zone)} });
  if (u.indexOf("/api/home/") > -1)      return window.__json({ albums: [], label: null });
  if (u.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1)           return window.__json({});
  return undefined;
});`;

const DRIVER = `
  await window.__sleep(2500);
  var bar = document.getElementById("mini-transport");
  function txt(id) { var el = document.getElementById(id); return el ? el.textContent.trim() : null; }
  T("hidden", bar.classList.contains("hidden"));
  T("title", txt("mt-title")); T("artist", txt("mt-artist")); T("kicker", txt("mt-kicker"));
  T("app", document.documentElement.classList.contains("rouen-app"));
  var cs = getComputedStyle(bar), nav = document.getElementById("touch-nav");
  var b = bar.getBoundingClientRect(), n = nav ? nav.getBoundingClientRect() : null;
  var pg = bar.querySelector(".mt-progress").getBoundingClientRect();
  T("geo", { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: window.innerWidth, navTop: n ? n.top : null,
             progTop: pg.top, progBottom: pg.bottom });
  T("look", { radius: cs.borderTopLeftRadius, bg: cs.backgroundColor, shadow: cs.boxShadow, borderTop: cs.borderTopWidth, backdrop: cs.backdropFilter || "none" });
  // The volume button with no zone: the zone list, as the speaker does.
  document.getElementById("mt-vol-btn").click(); await window.__sleep(300);
  T("zonePopOpen", !document.getElementById("mt-zone-popover").classList.contains("hidden"));
  T("volPopOpen", !document.getElementById("mt-vol-popover").classList.contains("hidden"));
`;

// Fully opaque: "rgb(...)", or "rgba(..., 1)".
function opaque(c) { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return false; const p = m[1].split(",").map((s) => s.trim()); return p.length === 3 || Number(p[3]) === 1; }

test("v1.9.72-t26: with no zone chosen, the mini player is there and says so", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "mini-always-nozone", windowSize: "390x844", chromeArgs: [TOUCH],
    stub: stub({ zones: [], zone: null, chosen: null }), driver: DRIVER });
  harness.assertNoPageError(assert, r);
  await t.test("THE one: shown, not hidden", () => assert.equal(r.hidden, false));
  await t.test("its words: no zone, and where to choose one", () => {
    assert.equal(r.title, "No Zone Selected");
    assert.equal(r.artist, "Tap the speaker to choose where to play");
  });
  await t.test("the volume button opens the zone list (there is no volume to set)", () => {
    assert.equal(r.zonePopOpen, true);
    assert.equal(r.volPopOpen, false);
  });
});

test("v1.9.72-t26: with a zone that is silent, whose it is and that nothing is playing", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "mini-always-silent", windowSize: "390x844", chromeArgs: [TOUCH],
    stub: stub({ zones: [SILENT], zone: SILENT, chosen: "z1" }), driver: DRIVER });
  harness.assertNoPageError(assert, r);
  await t.test("shown, with the zone's name over \"Nothing playing\"", () => {
    assert.equal(r.hidden, false);
    assert.equal(r.kicker, "Living Room");
    assert.equal(r.title, "Nothing playing");
    assert.equal(r.artist, "Pick an album to play here");
  });
});

test("v1.9.72-t26: in the Android app, the mini player is docked on the row along the foot, solid", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "mini-docked-app", windowSize: "390x844", chromeArgs: [TOUCH, APP_UA],
    stub: stub({ zones: [PLAYING], zone: PLAYING, chosen: "z1" }), driver: DRIVER });
  harness.assertNoPageError(assert, r);
  await t.test("the app is told apart by its User-Agent", () => assert.equal(r.app, true));
  await t.test("THE one: edge to edge, its foot on the row's top edge", () => {
    assert.equal(r.hidden, false);
    assert.equal(r.geo.left, 0);
    assert.equal(r.geo.right, r.geo.width);
    assert.ok(Math.abs(r.geo.bottom - r.geo.navTop) < 1, JSON.stringify(r.geo));
  });
  await t.test("square, solid, no shadow, a hairline along its top", () => {
    assert.equal(r.look.radius, "0px");
    assert.ok(opaque(r.look.bg), r.look.bg);
    assert.equal(r.look.shadow, "none");
    assert.equal(r.look.borderTop, "1px");
    assert.equal(r.look.backdrop, "none");
  });
  await t.test("the track's progress along its top, above the cover and the words (Mandarin's)", () => {
    assert.ok(r.geo.progTop - r.geo.top < 15 && r.geo.progBottom - r.geo.top < 20, JSON.stringify(r.geo));
  });
});

test("v1.9.72-t26: a browser on a phone keeps the floating pill", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "mini-pill-browser", windowSize: "390x844", chromeArgs: [TOUCH],
    stub: stub({ zones: [PLAYING], zone: PLAYING, chosen: "z1" }), driver: DRIVER });
  harness.assertNoPageError(assert, r);
  await t.test("not the app; rounded and clear of the row and the screen's edges", () => {
    assert.equal(r.app, false);
    assert.notEqual(r.look.radius, "0px");
    assert.ok(r.geo.left > 0, JSON.stringify(r.geo));
    assert.ok(r.geo.bottom < r.geo.navTop, JSON.stringify(r.geo));
  });
});
