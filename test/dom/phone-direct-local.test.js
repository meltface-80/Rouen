"use strict";
// ---------------------------------------------------------------------------
// v1.9.72 §4.22: This phone is the phone's own standalone player, home and away (public/phone-local.js;
// dev/design/android-app.md §4.22). The owner, 2026-10-31: "This phone is this phone at all times" — a local library
// album plays direct on the phone's own player, streamed from Rouen, not through Roon, home and away alike (this
// supersedes t36/t38's split head, where only away played direct and home relayed through Roon). Here, over the app's
// bridge stood in:
//   - away the zone list is This phone only (the Sonos and the rest, which can't be heard away, are hidden);
//   - Play Now on This phone of an album Rouen has in /music calls the bridge's playLibrary and does NOT play through
//     Roon; Now playing then has the album's cover and its quality badge;
//   - a TIDAL/Qobuz album Rouen won't serve is refused honestly — "This phone plays your own library files", never
//     "not one of Roon's zones" (owner, 2026-10-31) — and not sent to Roon;
//   - at home the real Roon zones show beside This phone, and the same Play Now of a library album still plays direct
//     on the phone, not Roon.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const BRIDGE = `
window.__pl = [];
window.__network = "away";
window.__local = { state: "stopped" };
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
    if (a.service) (window.__svc = window.__svc || []).push([a.service, a.id, a.title, (a.tracks || []).length]);
    window.__pl.push([a.title, a.artist, from, (a.tracks || []).length, a.image_key || ""]);
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
    { zone_id: "z-lounge", display_name: "Lounge", state: "stopped", outputs: [{ display_name: "Lounge" }] }] });
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (u.indexOf("/api/settings/home-rows") > -1) return window.__json({ rows: [] });
  // Your TIDAL albums (v1.9.72-t64): asked only when the album has no files on the server.
  if (u.indexOf("/api/phone/service/album") > -1) {
    if (u.indexOf("Instinct") > -1) return window.__json({ service: "tidal", id: "77646290", title: "Instinct", artist: "Ang\u00e8le",
      tracks: [{ n: 1, title: "Intro", disc: 1, track: 1, length: 61 }, { n: 2, title: "Ligne", disc: 1, track: 2, length: 200 }] });
    return window.__json({ error: "Not one of your TIDAL albums." }, 404);
  }
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
  window.__local = { state: "stopped" };
  var r3 = await play("/api/play-track", { album_title: "Random Access Memories", album_subtitle: "Daft Punk", track: 0, zone_id: "this-phone" });
  T("streamedStatus", r3.status);
  T("streamedErr", (await r3.json()).error);
  T("streamedToRoon", window.__sent.some(function (x) { return x[0].indexOf("/api/play-track") > -1; }));
  // Away + one of your TIDAL albums (no files on the server): played on the phone through Rouen's TIDAL, not Roon.
  window.__local = { state: "stopped" };
  var rt = await play("/api/play", { title: "Instinct", subtitle: "Ang\u00e8le", zone_id: "this-phone" });
  T("tidalOk", (await rt.json()).ok === true);
  T("tidalSvc", JSON.parse(JSON.stringify(window.__svc || [])));
  T("tidalToRoon", window.__sent.some(function (x) { return x[0].indexOf("/api/play") > -1; }));
  // At home: the real Roon zones show beside This phone, and the same Play Now of a library album plays DIRECT on the
  // phone (§4.22) — not through Roon.
  window.__network = "home";
  window.__local = { state: "stopped" };
  window.__sent = [];
  window.__pl = [];
  var zh = await (await fetch("/api/zones")).json();
  T("homeZones", zh.zones.map(function (x) { return x.display_name; }));
  var rh = await play("/api/play", { title: "Heathen", subtitle: "David Bowie", zone_id: "this-phone" });
  T("homeOk", (await rh.json()).ok === true);
  T("homeDirect", JSON.parse(JSON.stringify(window.__pl)));
  T("homeToRoon", window.__sent.some(function (x) { return x[0].indexOf("/api/play") > -1; }));
`;

test("v1.9.72 §4.22: This phone plays direct, away and home; away = This phone only, with cover and quality", { skip: !harness.available }, async (t) => {
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
    assert.match(r.streamedErr, /library files and your TIDAL albums/, "the message says what the phone plays");
    assert.doesNotMatch(r.streamedErr, /Roon's zones/, "away there is no Roon zone, so that message never shows");
  });
  await t.test("THE one for v1.9.72-t64: away, one of your TIDAL albums plays on the phone through Rouen's TIDAL, not Roon", () => {
    assert.equal(r.tidalOk, true);
    assert.deepEqual(r.tidalSvc, [["tidal", "77646290", "Instinct", 2]], "the phone was handed the TIDAL album, its id and tracks");
    assert.equal(r.tidalToRoon, false);
  });
  await t.test("at home the real Roon zones show beside This phone, and a library album plays direct on the phone, not Roon (§4.22)", () => {
    assert.deepEqual(r.homeZones, ["Lounge", "This phone"]);
    assert.equal(r.homeOk, true, "it played");
    assert.deepEqual(r.homeDirect, [["Heathen", "David Bowie", "0", 2, ""]], "the phone's own player was asked to play it");
    assert.equal(r.homeToRoon, false, "at home This phone still plays its own, not Roon's relay");
  });
});
