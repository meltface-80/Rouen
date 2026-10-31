"use strict";
// ---------------------------------------------------------------------------
// v1.9.72-t36/t38: the split head, B1 and its fixes (public/phone-local.js; dev/design/android-app.md §4.20). The
// owner's "B", 2026-10-31: away from home a local library album plays direct on the phone's own player, streamed from
// Rouen, not through Roon's zone; and (t38, the owner on device) away the zone list is This phone only, Now playing
// shows the album's cover and the quality. Here, over the app's bridge stood in, with the phone away:
//   - the zone list is This phone only (the Sonos and the rest, which can't be heard away, are hidden);
//   - Play Now on This phone of an album Rouen has in /music calls the bridge's playLibrary and does NOT play through
//     Roon; Now playing then has the album's cover and its quality badge;
//   - a TIDAL/Qobuz album Rouen won't serve can't play away (no zone), so it is refused honestly — "This phone plays
//     your own library files", never "not one of Roon's zones" (away there is no Roon zone; owner, 2026-10-31, t40) —
//     and not sent to Roon;
//   - at home the full zone list shows and the same Play Now goes to Roon.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const BRIDGE = `
window.__pl = [];
window.__network = "away";
window.__local = { state: "stopped", roon_zone: "Rouen A142" };
window.RouenPhone = {
  settings: function () { return JSON.stringify({ network: window.__network, places: [] }); },
  albums: function () { return "[]"; },
  album: function () { return '{"state":"none"}'; },
  albumState: function () { return '{"state":"none"}'; },
  localState: function () { return JSON.stringify(window.__local); },
  localQueue: function () { return "[]"; },
  localControl: function () { return '{"ok":true}'; },
  localSeek: function () { return '{"ok":true}'; },
  localJump: function () { return '{"ok":true}'; },
  playLibrary: function (json, from) {
    var a = JSON.parse(json);
    window.__pl.push([a.title, a.artist, from, (a.tracks || []).length, a.image_key || ""]);
    if (window.__network !== "away") return JSON.stringify({ error: "home" });
    window.__local = { state: "playing", index: 0, count: (a.tracks || []).length, position: 3, length: 285,
      title: (a.tracks[0] || {}).title || "", artist: a.artist, album: a.title, key: "libkey",
      image_key: a.image_key || "", quality: "opus", rate: 48000 };
    return JSON.stringify({ ok: true });
  }
};`;

const SERVER = `
window.__sent = [];
window.__installFetch(function (u, opts) {
  if (opts && opts.method === "POST") window.__sent.push([u.replace(/^file:\\/\\//, ""), JSON.parse(opts.body || "{}")]);
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [
    { zone_id: "z-lounge", display_name: "Lounge", state: "stopped", outputs: [{ display_name: "Lounge" }] },
    { zone_id: "z-phone", display_name: "Rouen A142", state: "stopped", outputs: [{ display_name: "Rouen A142" }] }] });
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (u.indexOf("/api/settings/home-rows") > -1) return window.__json({ rows: [] });
  if (u.indexOf("/api/phone/album") > -1) {
    if (u.indexOf("Heathen") > -1) return window.__json({ title: "Heathen", artist: "David Bowie",
      tracks: [{ n: 1, title: "Sunday", disc: 1, track: 1, length: 285 }, { n: 2, title: "Cactus", disc: 1, track: 2, length: 174 }] });
    return window.__json({ error: "Not one of the albums found in /music." }, 404);
  }
  return undefined;
});`;

const DRIVER = `
  await window.__sleep(400);
  var play = function (path, body) { return fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); };
  // Away: the zone list is This phone only — the Lounge and the phone's Roon zone are hidden.
  var z = await (await fetch("/api/zones")).json();
  T("awayZones", z.zones.map(function (x) { return x.display_name; }));
  // Away + a local album: plays direct on the phone, not through Roon.
  var r1 = await play("/api/play", { title: "Heathen", subtitle: "David Bowie", image_key: "roon-heathen", zone_id: "this-phone" });
  T("localOk", (await r1.json()).ok === true);
  T("pl", JSON.parse(JSON.stringify(window.__pl)));
  T("roonGotLocal", window.__sent.some(function (x) { return x[0].indexOf("/api/play") > -1; }));
  // Now playing (This phone) has the album's cover and the quality badge.
  var z2 = await (await fetch("/api/zones")).json();
  var np = (z2.zones[0] || {}).now_playing || {};
  T("np", { image_key: np.image_key, format: np.format });
  // Away + a streamed album Rouen won't serve: no zone to play on, so it is refused (not sent to Roon).
  window.__local = { state: "stopped", roon_zone: "Rouen A142" };
  var r3 = await play("/api/play-track", { album_title: "Random Access Memories", album_subtitle: "Daft Punk", track: 0, zone_id: "this-phone" });
  T("streamedStatus", r3.status);
  T("streamedErr", (await r3.json()).error);
  T("streamedToRoon", window.__sent.some(function (x) { return x[0].indexOf("/api/play-track") > -1; }));
  // At home: the full zone list shows, and the same Play Now goes to Roon.
  window.__network = "home";
  window.__local = { state: "stopped", roon_zone: "Rouen A142" };
  window.__sent = [];
  var zh = await (await fetch("/api/zones")).json();
  T("homeZones", zh.zones.map(function (x) { return x.display_name; }));
  await play("/api/play", { title: "Heathen", subtitle: "David Bowie", zone_id: "this-phone" });
  T("homeToRoon", window.__sent.some(function (x) { return x[0].indexOf("/api/play") > -1; }));
`;

test("v1.9.72-t38 B1: away = This phone only, plays direct with cover and quality; home keeps the zones", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "phone-direct-local", windowSize: "390x844", stub: BRIDGE + SERVER, driver: DRIVER });
  harness.assertNoPageError(assert, r);
  await t.test("THE one: away the zone list is This phone only", () => {
    assert.deepEqual(r.awayZones, ["This phone"]);
  });
  await t.test("away, a local album plays direct on the phone, not through Roon, with its cover and quality", () => {
    assert.equal(r.localOk, true);
    assert.deepEqual(r.pl, [["Heathen", "David Bowie", "0", 2, "roon-heathen"]]);
    assert.equal(r.roonGotLocal, false, "nothing was played through Roon for the local album");
    assert.deepEqual(r.np, { image_key: "roon-heathen", format: { kind: "opus", text: "256" } });
  });
  await t.test("away, a streamed album Rouen won't serve is refused honestly, not sent to Roon, never 'not one of Roon's zones'", () => {
    assert.equal(r.streamedStatus, 409);
    assert.equal(r.streamedToRoon, false);
    assert.match(r.streamedErr, /library files/, "the message says the phone plays your own library files");
    assert.doesNotMatch(r.streamedErr, /Roon's zones/, "away there is no Roon zone, so that message never shows");
  });
  await t.test("at home the full zone list shows and the same Play Now goes to Roon", () => {
    assert.deepEqual(r.homeZones, ["Lounge", "This phone"]);
    assert.equal(r.homeToRoon, true);
  });
});
