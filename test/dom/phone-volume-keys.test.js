"use strict";
// ---------------------------------------------------------------------------
// v1.9.72-t74: the phone's volume keys (the owner, 2026-11-02: "unlink zone volume from the device buttons … use the
// phone's volume control"). The app asks the page where a press goes (window.__rouenVolumeKeyAt, phone-local.js):
//   - the phone's own Roon zone selected ("Rouen <phone>", as the app's hello learned it): "phone" — the app moves the
//     phone's own media volume, and the Roon zone is not touched;
//   - another Roon zone selected: that zone is nudged, as before (window.__rouenVolumeKey), and "roon" answered;
//   - the app not knowing its zone yet: never taken for the phone's.
// The app's half (MainActivity, PlayerService) is Kotlin, compiled by CI only: test/static/phone-volume-app.test.js.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const BRIDGE = `
window.__local = { state: "stopped", roon_zone: "Rouen Pixel" };
window.RouenPhone = {
  settings: function () { return JSON.stringify({ network: "home", places: [] }); },
  albums: function () { return "[]"; },
  album: function () { return '{"state":"none"}'; },
  albumState: function () { return '{"state":"none"}'; },
  localState: function () { return JSON.stringify(window.__local); },
  localQueue: function () { return "[]"; }
};`;

const SERVER = `
window.__installFetch(function (u) {
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [
    { zone_id: "z-lounge", display_name: "Lounge", state: "stopped", outputs: [{ display_name: "Lounge" }] },
    { zone_id: "z-phone", display_name: "Rouen Pixel", state: "stopped", outputs: [{ display_name: "Rouen Pixel" }] }] });
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  return undefined;
});`;

const DRIVER = `
  await window.__sleep(1500);
  var nudged = [];
  window.__rouenVolumeKey = function (d) { nudged.push(d); };
  var sel = document.getElementById("zone-select");
  var pick = function (id) { sel.value = id; };
  T("options", Array.prototype.map.call(sel.options, function (o) { return [o.value, o.textContent]; }));
  pick("z-phone");
  T("mine", [window.__rouenVolumeKeyAt(1), window.__rouenVolumeKeyAt(-1), nudged.slice()]);
  pick("z-lounge");
  T("other", [window.__rouenVolumeKeyAt(1), window.__rouenVolumeKeyAt(-1), nudged.slice()]);
  window.__local = { state: "stopped" };
  nudged.length = 0;
  pick("z-phone");
  T("unknown", [window.__rouenVolumeKeyAt(1), nudged.slice()]);
`;

test("v1.9.72-t74: the volume keys move the phone's own volume on its own zone, and nudge any other zone", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "phone-volume-keys", windowSize: "390x844", stub: BRIDGE + SERVER, driver: DRIVER });
  harness.assertNoPageError(assert, r);
  await t.test("the zones are Roon's, the phone's own among them", () => {
    assert.deepEqual(r.options, [["z-lounge", "Lounge"], ["z-phone", "Rouen Pixel"]]);
  });
  await t.test("THE one: the phone's own zone selected — the phone's volume, the Roon zone untouched", () => {
    assert.deepEqual(r.mine, ["phone", "phone", []]);
  });
  await t.test("another zone selected: that zone nudged, as before", () => {
    assert.deepEqual(r.other, ["roon", "roon", [1, -1]]);
  });
  await t.test("the app not knowing its zone yet: the press is the selected zone's, never taken for the phone's", () => {
    assert.deepEqual(r.unknown, ["roon", [1]]);
  });
});

test("in a browser there is no volume-key answer", { skip: !harness.available }, async () => {
  const r = harness.renderPage({ name: "phone-volume-keys-browser", windowSize: "390x844", stub: SERVER,
    driver: `await window.__sleep(800); T("at", typeof window.__rouenVolumeKeyAt);` });
  harness.assertNoPageError(assert, r);
  assert.equal(r.at, "undefined");
});
