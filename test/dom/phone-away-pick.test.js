"use strict";
// ---------------------------------------------------------------------------
// v1.9.72-t82: away from home, the phone's own zone is the one selected (the owner, 2026-11-03: "if I'm on a Roon zone
// at the time of going onto mobile data, the phone doesn't automatically become the selected zone so I have to
// manually select it … As soon as I drop the same WiFi/subnet Roon server is on the phones app must become the default
// selected zone"). phone-local.js:
//   - away, the page read afresh while the phone's zone was out of Roon (its way to Rouen still coming up) picked no
//     zone; once the zone is listed, the page is read afresh so that it picks it;
//   - away with a home zone still selected (the page never told it had left home): read afresh, so that it picks it;
//   - away with the phone's zone already selected, and at home, the page is left as it is.
// window.__rouenReload stands in for the read afresh, so the page stays to be asked.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const stub = (network, phoneListed) => `
window.__net = ${JSON.stringify(network)};
window.__phoneListed = ${JSON.stringify(phoneListed)};
window.__reloads = 0;
window.__rouenReload = function () { window.__reloads++; };
try { localStorage.setItem("rra-zone", "z-lounge"); } catch (e) {}
window.RouenPhone = {
  settings: function () { return JSON.stringify({ network: window.__net, places: [] }); },
  albums: function () { return "[]"; },
  album: function () { return '{"state":"none"}'; },
  albumState: function () { return '{"state":"none"}'; },
  localState: function () { return JSON.stringify({ state: "stopped", roon_zone: "Rouen Pixel" }); },
  localQueue: function () { return "[]"; }
};
window.__installFetch(function (u) {
  if (u.indexOf("/api/zones") > -1) {
    var zones = [{ zone_id: "z-lounge", display_name: "Lounge", state: "playing", outputs: [{ display_name: "Lounge" }] }];
    if (window.__phoneListed) zones.push({ zone_id: "z-phone", display_name: "Rouen Pixel", state: "stopped", outputs: [{ display_name: "Rouen Pixel" }] });
    return window.__json({ zones: zones });
  }
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  return undefined;
});`;

const DRIVER = `
  await window.__sleep(1500);
  var sel = document.getElementById("zone-select");
  var picked = function () { var o = sel.options[sel.selectedIndex]; return o ? o.textContent : ""; };
  T("first", picked());
  T("readsBefore", window.__reloads);
  // The phone's zone back in Roon (its way to Rouen up again).
  window.__phoneListed = true;
  await window.__sleep(6000);
  T("reads", window.__reloads);
  // Not again and again while the page settles: at most once in 15 s.
  await window.__sleep(6000);
  T("readsLater", window.__reloads);
`;

// Loaded at home with Lounge selected; the phone leaves home and the page isn't told (no __rouenPhoneChanged).
const SILENT = `
  await window.__sleep(1500);
  var sel = document.getElementById("zone-select");
  T("first", sel.options[sel.selectedIndex].textContent);
  window.__net = "away";
  await window.__sleep(6000);
  T("reads", window.__reloads);
`;

test("v1.9.72-t82: away from home the phone's own zone becomes the one selected", { skip: !harness.available }, async (t) => {
  const late = harness.renderPage({ name: "phone-away-pick-late", windowSize: "390x844", stub: stub("away", false), driver: DRIVER, budgetMs: 30000 });
  harness.assertNoPageError(assert, late);
  const there = harness.renderPage({ name: "phone-away-pick-there", windowSize: "390x844", stub: stub("away", true), driver: DRIVER, budgetMs: 30000 });
  harness.assertNoPageError(assert, there);
  const home = harness.renderPage({ name: "phone-home-pick", windowSize: "390x844", stub: stub("home", false), driver: DRIVER, budgetMs: 30000 });
  harness.assertNoPageError(assert, home);
  const silent = harness.renderPage({ name: "phone-away-pick-silent", windowSize: "390x844", stub: stub("home", true), driver: SILENT, budgetMs: 20000 });
  harness.assertNoPageError(assert, silent);
  await t.test("THE one: away, the phone's zone not yet in Roon when the page loaded: read afresh once it is", () => {
    assert.equal(late.first, "No zones available", "the page's own pick, before the phone's zone was back");
    assert.equal(late.readsBefore, 0, "nothing to pick yet");
    assert.equal(late.reads, 1, "the phone's zone listed and not selected: the page isn't read afresh to pick it");
    assert.equal(late.readsLater, 1, "read afresh again and again");
  });
  await t.test("away with a home zone still selected, the page not told it left home: read afresh to pick the phone's", () => {
    assert.equal(silent.first, "Lounge");
    assert.equal(silent.reads, 1);
  });
  await t.test("away, the phone's zone listed as the page loaded: it is the one selected, nothing more", () => {
    assert.equal(there.first, "Rouen Pixel");
    assert.equal(there.reads, 0);
  });
  await t.test("at home, the zone you chose stays chosen", () => {
    assert.equal(home.first, "Lounge");
    assert.equal(home.reads, 0);
    assert.equal(home.readsLater, 0);
  });
});
