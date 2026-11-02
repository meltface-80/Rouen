"use strict";
// ---------------------------------------------------------------------------
// v1.9.72-t69 §4.23: online, the phone is a Roon zone of its own ("Rouen <phone>", run by Rouen's server) and the page
// leaves Roon's zones alone (the owner, 2026-11-02: back to the phone as a Roon zone). The standalone "This phone" of
// §4.22 is gone online; offline it still plays the phone's downloads (offline-page.test.js).
//
// Rouen's own page (no offline.js), over the app's bridge stood in, at home:
//   - the zone list is Roon's, the phone's own zone among them, and no "This phone" beside it;
//   - Play Now to the phone's zone goes to Rouen (and so to Roon), not to the phone's own player;
//   - Home's first row is still Downloaded, with Roon's covers;
// and in a browser (no bridge) there is no Downloaded row.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const BRIDGE = `
var DONE = { key: "k1", title: "Heathen", artist: "David Bowie", image_key: "roon-heathen", state: "done", done: 2, total: 2, bytes: 1,
  tracks: [{ n: 1, title: "Sunday", disc: 1, track: 1, length: 285 }, { n: 2, title: "Cactus", disc: 1, track: 2, length: 174 }] };
window.__local = { state: "playing", index: 0, count: 2, position: 40, length: 285, title: "Sunday", artist: "David Bowie",
  album: "Heathen", key: "k1" };
window.__localCalls = [];
window.__pl = [];
window.__add = [];
window.RouenPhone = {
  settings: function () { return JSON.stringify({ network: "home", places: [] }); },
  albums: function () { return JSON.stringify([DONE]); },
  album: function (t, a) { return JSON.stringify(t === "Heathen" ? DONE : { state: "none" }); },
  albumState: function () { return '{"state":"none"}'; },
  localPlay: function () { return '{"ok":true}'; },
  localAdd: function (t, a, track, next) { window.__add.push([t, a, track, next]); return '{"ok":true}'; },
  localState: function () { return JSON.stringify(window.__local); },
  localQueue: function () {
    return window.__local.state === "stopped" ? "[]" : JSON.stringify([{ id: 0, title: "Sunday", artist: "David Bowie", album: "Heathen", key: "k1", length: 285 }]);
  },
  localJump: function (id) { window.__localCalls.push(["jump", id]); return '{"ok":true}'; },
  localControl: function (op) { window.__localCalls.push(["control", op]); return '{"ok":true}'; },
  localSeek: function (sec) { window.__localCalls.push(["seek", sec]); return '{"ok":true}'; },
  playLibrary: function (json, from) {
    var a = JSON.parse(json);
    window.__pl.push([a.title, a.artist, from, (a.tracks || []).length]);
    window.__local = { state: "playing", index: 0, count: (a.tracks || []).length, position: 1, length: 161,
      title: (a.tracks[0] || {}).title || "", artist: a.artist, album: a.title, key: "libkey", quality: "opus", rate: 48000 };
    return JSON.stringify({ ok: true });
  }
};`;

// Rouen's routes: a real Roon zone (Lounge) and the phone's own Roon zone (Rouen Pixel). POSTs are kept.
const SERVER = `
window.__sent = [];
window.__installFetch(function (u, opts) {
  if (opts && opts.method === "POST") window.__sent.push([u.replace(/^file:\\/\\//, ""), JSON.parse(opts.body || "{}")]);
  if (u.indexOf("/api/phone/album") > -1) {
    if (u.indexOf("Low") > -1) return window.__json({ title: "Low", artist: "David Bowie",
      tracks: [{ n: 1, title: "Speed of Life", disc: 1, track: 1, length: 161 }] });
    return window.__json({ error: "not in /music" }, 404);
  }
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [
    { zone_id: "z-lounge", display_name: "Lounge", state: "stopped", outputs: [{ display_name: "Lounge" }] },
    { zone_id: "z-phone", display_name: "Rouen Pixel", state: "stopped", outputs: [{ display_name: "Rouen Pixel" }] }] });
  if (opts && opts.method === "POST" && u.indexOf("/api/play") > -1) return window.__json({ ok: true });
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (u.indexOf("/api/settings/home-rows") > -1) return window.__json({ rows: ["downloads", "unplayed", "history", "later",
    "picks", "random", "library", "lotw", "genres"].map(function (id) { return { id: id, on: true }; }) });
  return undefined;
});`;

// Settings → Home Screen: the first two rows it offers (one hidden by the page's own style is not offered).
const SETTINGS = `
  var still = document.createElement("style");
  still.textContent = ".settings-sheet { animation: none !important; }";
  document.head.appendChild(still);
  document.getElementById("settings-toggle").click();
  await window.__sleep(300);
  document.querySelector('.settings-nav-item[data-pane="homescreen"]').click();
  await window.__sleep(400);
  T("settings", Array.prototype.filter.call(document.querySelectorAll("#home-rows-list .home-row-item"), function (li) { return getComputedStyle(li).display !== "none"; })
    .slice(0, 2).map(function (li) { return [li.dataset.row, li.querySelector(".home-row-name").textContent, !!li.querySelector(".home-row-grip")]; }));
`;

const DRIVER = `
  await window.__sleep(1500);
  var zones = await (await fetch("/api/zones")).json();
  T("zones", zones.zones.map(function (z) { return [z.zone_id, z.display_name]; }));
  var box = document.querySelector('#home-sections [data-row="downloads"]');
  T("row", box ? { first: box.parentElement.querySelector("[data-row]") === box, shown: getComputedStyle(box).display !== "none" && !box.classList.contains("hidden"),
    tiles: Array.prototype.map.call(box.querySelectorAll(".album"), function (t) { return [t.getAttribute("aria-label"), t.querySelector(".album-art-wrap").dataset.artKey]; }) } : null);
  // Play Now to the phone's own zone: Rouen's, as for any zone — never the phone's own player.
  window.__pl = [];
  await fetch("/api/play", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offset: 3, title: "Low", subtitle: "David Bowie", zone_or_output_id: "z-phone", kind: "play_now" }) });
  T("pl", JSON.parse(JSON.stringify(window.__pl)));
  T("sent", JSON.parse(JSON.stringify(window.__sent)).map(function (x) { return [x[0].slice(x[0].indexOf("/api/")), x[1].zone_or_output_id]; }));
` + SETTINGS;

test("v1.9.72-t69 §4.23: online, the zones are Roon's — the phone's own among them — and no This phone", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "phone-local-online", windowSize: "390x844", stub: BRIDGE + SERVER, driver: DRIVER });
  harness.assertNoPageError(assert, r);
  await t.test("THE one: the zone list is Roon's, the phone's own zone in it, no This phone beside it", () => {
    assert.deepEqual(r.zones, [["z-lounge", "Lounge"], ["z-phone", "Rouen Pixel"]]);
  });
  await t.test("Play Now to the phone's zone goes to Rouen, not to the phone's own player", () => {
    assert.deepEqual(r.pl, [], "the phone's own player was not asked");
    assert.deepEqual(r.sent, [["/api/play", "z-phone"]]);
  });
  await t.test("Downloaded is still Home's first row online, with Roon's covers", () => {
    assert.ok(r.row, "no Downloaded row");
    assert.equal(r.row.first, true);
    assert.equal(r.row.shown, true);
    assert.deepEqual(r.row.tiles, [["Heathen by David Bowie", "roon-heathen"]]);
  });
  await t.test("Settings → Home Screen lists it first, as Downloaded, with a grip to move it", () => {
    assert.deepEqual(r.settings, [["downloads", "Downloaded", true], ["unplayed", "Not played in 6 months", true]]);
  });
});

test("in a browser there is no Downloaded row", { skip: !harness.available }, async () => {
  const r = harness.renderPage({ name: "phone-local-browser", windowSize: "390x844", stub: SERVER,
    driver: `await window.__sleep(800); T("row", !!document.querySelector('[data-row="downloads"]')); T("local", !!window.RouenLocal);` + SETTINGS });
  harness.assertNoPageError(assert, r);
  assert.equal(r.row, false);
  assert.equal(r.local, false);
  assert.equal(r.settings[0][0], "unplayed", "Settings → Home Screen doesn't offer it");
});
