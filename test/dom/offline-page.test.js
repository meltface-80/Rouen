"use strict";
// ---------------------------------------------------------------------------
// v1.9.72-t29: Rouen's page in the Android app with Rouen out of reach (public/offline.js, OfflineSite.kt;
// dev/design/android-app.md §4.19). The owner, 2026-10-30: "Offline use requires the app to have the same Rouen UI".
// The app serves its copy of the page with offline.js first in <head>; here it is run first, as the copy has it, over
// the app's bridge stood in:
//   - Home says the phone is offline, over "Downloaded": the albums wholly on the phone, each with its cover from the
//     app (/api/image/dl:<key>); one still downloading is not among them;
//   - Home's other rows are off, and none of their routes is asked;
//   - an album opens in Rouen's own album view, its tracks as they were downloaded;
//   - the Library is the albums on the phone.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const harness = require("./harness");

const OFFLINE = fs.readFileSync(path.join(__dirname, "..", "..", "public", "offline.js"), "utf8");

const BRIDGE = `
var DONE = { key: "k1", title: "Heathen", artist: "David Bowie", state: "done", done: 2, total: 2, bytes: 1,
  tracks: [{ n: 1, title: "Sunday", disc: 1, track: 1, length: 285 }, { n: 2, title: "Cactus", disc: 1, track: 2, length: 174 }] };
var GOING = { key: "k2", title: "Low", artist: "David Bowie", state: "downloading", done: 1, total: 11, bytes: 1 };
window.RouenPhone = {
  settings: function () { return JSON.stringify({ network: "offline", places: [] }); },
  albums: function () { return JSON.stringify([GOING, DONE]); },
  album: function (t, a) { return JSON.stringify(t === "Heathen" && a === "David Bowie" ? DONE : { state: "none" }); },
  albumState: function () { return '{"state":"none"}'; },
  // The phone's own player (v1.9.72-t31), as the app answers for it.
  localPlay: function (t, a, from) {
    window.__localCalls.push(["play", t, a, from]);
    window.__local = { state: "playing", index: 0, count: 2, position: 3, length: 285, title: "Sunday", artist: a, album: t, key: "k1" };
    return '{"ok":true}';
  },
  localState: function () { return JSON.stringify(window.__local); },
  localControl: function (op) {
    window.__localCalls.push(["control", op]);
    if (op === "playpause") window.__local.state = window.__local.state === "playing" ? "paused" : "playing";
    return '{"ok":true}';
  },
  localSeek: function (sec) { window.__localCalls.push(["seek", sec]); return '{"ok":true}'; }
};
window.__local = { state: "stopped" };
window.__localCalls = [];`;

// Every route the offline script doesn't answer goes to the stub, which answers nothing: so a route reaching it shows.
const STUB = `
${BRIDGE}
window.__installFetch(function (u) { return undefined; });
${OFFLINE}
`;

const DRIVER = `
  await window.__sleep(1200);
  T("offlineClass", document.documentElement.classList.contains("rouen-offline"));
  var box = document.getElementById("offline-home");
  T("note", box ? box.querySelector(".offline-note").textContent : null);
  T("tiles", box ? Array.prototype.map.call(box.querySelectorAll(".offline-album"), function (t) {
    return [t.querySelector(".offline-album-title").textContent, t.querySelector(".offline-album-artist").textContent, t.querySelector("img").getAttribute("src")]; }) : null);
  T("homeAsked", (window.__calls || []).filter(function (u) { return u.indexOf("/api/home/") > -1; }));
  var banner = document.getElementById("status-banner");
  T("banner", banner && !banner.classList.contains("hidden") ? banner.textContent : "");
  T("homeShown", !document.getElementById("home-view").classList.contains("hidden"));
  var lib = await (await fetch("/api/library/albums?offset=0&count=30")).json();
  T("library", lib);
  var first = box && box.querySelector(".offline-album");
  if (first) first.click();
  await window.__sleep(1300);
  T("albumTitle", (document.getElementById("modal-title") || {}).textContent || null);
  T("tracks", Array.prototype.map.call(document.querySelectorAll("#modal-tracks li.t-row .t-title"), function (e) { return e.textContent.trim(); }));
  // Play Now: on the phone's own player.
  var play = Array.prototype.find.call(document.querySelectorAll("#modal-actions .action-btn"), function (b) { return b.textContent.trim() === "Play Now"; });
  T("hasPlay", !!play);
  if (play) play.click();
  await window.__sleep(2500);
  T("zones", await (await fetch("/api/zones")).json());
  T("mini", { title: document.getElementById("mt-title").textContent.trim(), kicker: document.getElementById("mt-kicker").textContent.trim(),
              hidden: document.getElementById("mini-transport").classList.contains("hidden") });
  document.getElementById("mt-playpause").click();
  await window.__sleep(300);
  T("localCalls", JSON.parse(JSON.stringify(window.__localCalls)));
`;

test("v1.9.72-t29: offline, the app's copy of the page shows what's on the phone", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "offline-page", windowSize: "390x844", stub: STUB, driver: DRIVER });
  harness.assertNoPageError(assert, r);
  await t.test("THE one: Home says it is offline, over the albums wholly on the phone, with their covers from the app", () => {
    assert.equal(r.offlineClass, true);
    assert.match(r.note, /Offline: Rouen can't be reached/);
    assert.deepEqual(r.tiles, [["Heathen", "David Bowie", "/api/image/dl%3Ak1?size=300"]]);
  });
  await t.test("Rouen counts as there for the page: Home shows, with no \"Waiting for Roon\" over it", () => {
    assert.equal(r.banner, "");
    assert.equal(r.homeShown, true);
  });
  await t.test("Home's other rows are off: none of their routes is asked", () => {
    assert.deepEqual(r.homeAsked, []);
  });
  await t.test("the Library is the albums on the phone", () => {
    assert.deepEqual(r.library, { albums: [{ offset: 0, title: "Heathen", subtitle: "David Bowie", image_key: "dl:k1" }], total: 1 });
  });
  await t.test("an album opens in Rouen's own album view, its tracks as they were downloaded", () => {
    assert.match(String(r.albumTitle), /Heathen/);
    assert.deepEqual(r.tracks, ["Sunday", "Cactus"]);
  });
  await t.test("v1.9.72-t31, THE one for playing: Play Now plays it on the phone, the mini player shows it and drives it", () => {
    assert.equal(r.hasPlay, true);
    assert.deepEqual(r.localCalls[0], ["play", "Heathen", "David Bowie", "0"]);
    assert.equal(r.zones.zones.length, 1);
    assert.equal(r.zones.zones[0].display_name, "This phone");
    assert.equal(r.mini.hidden, false);
    assert.equal(r.mini.title, "Sunday");
    assert.equal(r.mini.kicker, "This phone");
    assert.deepEqual(r.localCalls.at(-1), ["control", "playpause"]);
  });
});
