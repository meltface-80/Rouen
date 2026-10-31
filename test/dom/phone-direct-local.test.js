"use strict";
// ---------------------------------------------------------------------------
// v1.9.72-t36: the split head, B1 (public/phone-local.js playLibrary; dev/design/android-app.md §4.20). The owner's
// "B", 2026-10-31: away from home a local library album plays direct on the phone's own player, streamed from Rouen,
// not through Roon's zone. Here, over the app's bridge stood in, with the phone away:
//   - Play Now on This phone of an album Rouen has in /music calls the bridge's playLibrary and does NOT play through
//     Roon (B2 adds Roon's silent-zone count later);
//   - a TIDAL/Qobuz album Rouen won't serve (its /api/phone/album is 404) falls through to Roon, as now;
//   - at home, the same Play Now goes to Roon (playLibrary answers "home").
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const BRIDGE = `
window.__pl = [];
window.__network = "away";
window.RouenPhone = {
  settings: function () { return JSON.stringify({ network: window.__network, places: [] }); },
  albums: function () { return "[]"; },
  album: function () { return '{"state":"none"}'; },
  albumState: function () { return '{"state":"none"}'; },
  localState: function () { return '{"state":"stopped","roon_zone":"Rouen A142"}'; },
  localQueue: function () { return "[]"; },
  localControl: function () { return '{"ok":true}'; },
  localSeek: function () { return '{"ok":true}'; },
  localJump: function () { return '{"ok":true}'; },
  // The split head's direct play: records the album and the from, and (unless told to fail) plays.
  playLibrary: function (json, from) {
    var a = JSON.parse(json);
    window.__pl.push([a.title, a.artist, from, (a.tracks || []).length]);
    if (window.__network !== "away") return JSON.stringify({ error: "home" });
    return JSON.stringify({ ok: true });
  }
};`;

const SERVER = `
window.__sent = [];
window.__installFetch(function (u, opts) {
  if (opts && opts.method === "POST") window.__sent.push([u.replace(/^file:\\/\\//, ""), JSON.parse(opts.body || "{}")]);
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [
    { zone_id: "z-phone", display_name: "Rouen A142", state: "stopped", outputs: [{ display_name: "Rouen A142" }] }] });
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (u.indexOf("/api/settings/home-rows") > -1) return window.__json({ rows: [] });
  // Rouen's own album (local): its tracks. A streamed one (Daft Punk) is not in /music: 404.
  if (u.indexOf("/api/phone/album") > -1) {
    if (u.indexOf("Heathen") > -1) return window.__json({ title: "Heathen", artist: "David Bowie",
      tracks: [{ n: 1, title: "Sunday", disc: 1, track: 1, length: 285 }, { n: 2, title: "Cactus", disc: 1, track: 2, length: 174 }] });
    return window.__json({ error: "Not one of the albums found in /music." }, 404);
  }
  return undefined;
});`;

const DRIVER = `
  await window.__sleep(400);
  // The phone's zone in Roon is read, so This phone stands for it (roonId resolves).
  var play = function (path, body) { return fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); };
  // Away + a local album: Play Now on This phone plays direct, not through Roon.
  var r1 = await play("/api/play", { title: "Heathen", subtitle: "David Bowie", zone_id: "this-phone" });
  T("localOk", (await r1.json()).ok === true);
  T("pl", JSON.parse(JSON.stringify(window.__pl)));
  T("roonGotLocal", window.__sent.some(function (x) { return x[0].indexOf("/api/play") > -1; }));
  // Away + a streamed album Rouen won't serve: falls through to Roon.
  await play("/api/play-track", { album_title: "Random Access Memories", album_subtitle: "Daft Punk", track: 0, zone_id: "this-phone" });
  T("streamedToRoon", window.__sent.some(function (x) { return x[0].indexOf("/api/play-track") > -1; }));
  // At home: the same Play Now goes to Roon (playLibrary answers "home", the page falls through).
  window.__network = "home";
  window.__sent = [];
  await play("/api/play", { title: "Heathen", subtitle: "David Bowie", zone_id: "this-phone" });
  T("homeToRoon", window.__sent.some(function (x) { return x[0].indexOf("/api/play") > -1; }));
`;

test("v1.9.72-t36 B1: away, a local album plays direct; a streamed one and home go to Roon", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "phone-direct-local", windowSize: "390x844", stub: BRIDGE + SERVER, driver: DRIVER });
  harness.assertNoPageError(assert, r);
  await t.test("THE one: away, a local album plays direct on the phone, not through Roon", () => {
    assert.equal(r.localOk, true);
    assert.deepEqual(r.pl, [["Heathen", "David Bowie", "0", 2]]);
    assert.equal(r.roonGotLocal, false, "nothing was played through Roon for the local album");
  });
  await t.test("a streamed album Rouen won't serve falls through to Roon", () => {
    assert.equal(r.streamedToRoon, true);
  });
  await t.test("at home the same Play Now goes to Roon", () => {
    assert.equal(r.homeToRoon, true);
  });
});
