"use strict";
// ---------------------------------------------------------------------------
// v1.9.72-t79: away from home, the phone's own zone only (the owner, 2026-11-02: "I'm still seeing other Roon zones
// after I've left the same WiFi/subnet as Roon server. It must be a straight drop-off … On mobile data or another WiFi
// I must only see the phone as a zone"). phone-local.js: the app says where the phone is (settings().network);
//   - away: /api/zones and /api/outputs keep the phone's own Roon zone ("Rouen Pixel", from localState().roon_zone);
//   - home: every zone, as before;
//   - home → away while the page is open: the page is read afresh at once (window.__rouenPhoneChanged).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const stub = (network) => `
window.__net = ${JSON.stringify(network)};
window.__reloads = 0;
window.RouenPhone = {
  settings: function () { return JSON.stringify({ network: window.__net, places: [] }); },
  albums: function () { return "[]"; },
  album: function () { return '{"state":"none"}'; },
  albumState: function () { return '{"state":"none"}'; },
  localState: function () { return JSON.stringify({ state: "stopped", roon_zone: "Rouen Pixel" }); },
  localQueue: function () { return "[]"; }
};
window.__installFetch(function (u) {
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [
    { zone_id: "z-lounge", display_name: "Lounge", state: "playing", outputs: [{ display_name: "Lounge" }] },
    { zone_id: "z-phone", display_name: "Rouen Pixel", state: "stopped", outputs: [{ display_name: "Rouen Pixel" }] }] });
  if (u.indexOf("/api/outputs") > -1) return window.__json({ outputs: [
    { output_id: "o1", display_name: "Lounge", zone_name: "Lounge" }, { output_id: "o2", display_name: "Rouen Pixel", zone_name: "Rouen Pixel" }] });
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  return undefined;
});`;

const DRIVER = `
  await window.__sleep(1200);
  var names = function (j, k) { return (j[k] || []).map(function (z) { return z.display_name; }); };
  T("zones", names(await (await fetch("/api/zones")).json(), "zones"));
  T("outputs", names(await (await fetch("/api/outputs")).json(), "outputs"));
  T("select", Array.prototype.map.call(document.getElementById("zone-select").options, function (o) { return o.textContent; }));
  // Crossing over while the page is open: read afresh. (window.__rouenReload stands in for the reload, so the page stays to be asked.)
  var reloaded = 0;
  window.__rouenReload = function () { reloaded++; };
  window.__net = window.__net === "away" ? "home" : "away";
  if (window.__rouenPhoneChanged) window.__rouenPhoneChanged();
  T("crossed", reloaded);
`;

test("v1.9.72-t79: away from home only the phone's own zone; at home every zone", { skip: !harness.available }, async (t) => {
  const away = harness.renderPage({ name: "phone-away-zones", windowSize: "390x844", stub: stub("away"), driver: DRIVER });
  harness.assertNoPageError(assert, away);
  const home = harness.renderPage({ name: "phone-home-zones", windowSize: "390x844", stub: stub("home"), driver: DRIVER });
  harness.assertNoPageError(assert, home);
  await t.test("THE one: away, the zone list and the outputs are the phone's own zone and nothing else", () => {
    assert.deepEqual(away.zones, ["Rouen Pixel"]);
    assert.deepEqual(away.outputs, ["Rouen Pixel"]);
    assert.deepEqual(away.select, ["Rouen Pixel"], "the page's own zone picker");
  });
  await t.test("at home, every zone as before", () => {
    assert.deepEqual(home.zones, ["Lounge", "Rouen Pixel"]);
    assert.deepEqual(home.outputs, ["Lounge", "Rouen Pixel"]);
  });
  await t.test("crossing between home and away re-reads the page at once", () => {
    assert.equal(away.crossed, 1);
    assert.equal(home.crossed, 1);
  });
});
