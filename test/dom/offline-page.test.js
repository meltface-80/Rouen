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
// v1.9.72-t32, the owner's tests of t31 (2026-10-30): "Albums downloaded have no track times", "no add to queue
// buttons", "Playing a downloaded album offline shows no queue on the queue screen". Downloaded is Home's row
// (home-downloads.js), and the phone's zone is phone-local.js's.
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
  localSeek: function (sec) { window.__localCalls.push(["seek", sec]); return '{"ok":true}'; },
  localAdd: function (t, a, track, next) { window.__localCalls.push(["add", t, a, track, next]); return '{"ok":true}'; },
  localQueue: function () {
    return window.__local.state === "stopped" ? "[]" : JSON.stringify([{ id: 0, title: "Sunday", artist: "David Bowie", album: "Heathen", key: "k1", length: 285 },
      { id: 1, title: "Cactus", artist: "David Bowie", album: "Heathen", key: "k1", length: 174 }]);
  },
  localJump: function (id) { window.__localCalls.push(["jump", id]); return '{"ok":true}'; }
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
  var note = document.getElementById("offline-home");
  T("note", note ? note.textContent : null);
  var box = document.querySelector('#home-sections [data-row="downloads"]');
  T("rowShown", !!box && !box.classList.contains("hidden") && getComputedStyle(box).display !== "none");
  T("rowFirst", !!box && box.parentElement.querySelector("[data-row]") === box);
  T("tiles", box ? Array.prototype.map.call(box.querySelectorAll(".album"), function (t) {
    return [t.getAttribute("aria-label"), t.querySelector(".album-art-wrap").dataset.artKey]; }) : null);
  T("homeAsked", (window.__calls || []).filter(function (u) { return u.indexOf("/api/home/") > -1; }));
  var banner = document.getElementById("status-banner");
  T("banner", banner && !banner.classList.contains("hidden") ? banner.textContent : "");
  T("homeShown", !document.getElementById("home-view").classList.contains("hidden"));
  var lib = await (await fetch("/api/library/albums?offset=0&count=30")).json();
  T("library", lib);
  var first = box && box.querySelector(".album");
  if (first) first.click();
  await window.__sleep(1300);
  T("albumTitle", (document.getElementById("modal-title") || {}).textContent || null);
  T("tracks", Array.prototype.map.call(document.querySelectorAll("#modal-tracks li.t-row .t-title"), function (e) { return e.textContent.trim(); }));
  T("times", Array.prototype.map.call(document.querySelectorAll("#modal-tracks li.t-row"), function (li) { var l = li.querySelector(".t-len"); return l ? l.textContent.trim() : ""; }));
  T("actions", Array.prototype.map.call(document.querySelectorAll("#modal-actions .action-btn"), function (b) { return b.textContent.trim(); }));
  // Queue on the album, and on its second track.
  var queueBtn = Array.prototype.find.call(document.querySelectorAll("#modal-actions .action-btn"), function (b) { return b.textContent.trim() === "Queue"; });
  if (queueBtn) queueBtn.click();
  await window.__sleep(400);
  var row2 = document.querySelectorAll("#modal-tracks li.t-row")[1];
  if (row2) row2.click();
  await window.__sleep(300);
  var next2 = row2 && Array.prototype.find.call(row2.querySelectorAll(".t-act"), function (b) { return b.textContent.trim() === "Play next"; });
  if (next2) next2.click();
  await window.__sleep(400);
  // Play Now: on the phone's own player.
  var play = Array.prototype.find.call(document.querySelectorAll("#modal-actions .action-btn"), function (b) { return b.textContent.trim() === "Play Now"; });
  T("hasPlay", !!play);
  if (play) play.click();
  await window.__sleep(2500);
  T("zones", await (await fetch("/api/zones")).json());
  T("queue", await (await fetch("/api/queue?zone=this-phone")).json());
  await fetch("/api/play-from-here", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ zone_or_output_id: "this-phone", queue_item_id: 1 }) });
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
    assert.equal(r.rowShown, true, "Downloaded, Home's row");
    assert.equal(r.rowFirst, true, "the first of Home's rows");
    assert.deepEqual(r.tiles, [["Heathen by David Bowie", "dl:k1"]]);
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
  await t.test("v1.9.72-t32, THE one for track times: the album's rows have the download's lengths", () => {
    assert.deepEqual(r.times, ["4:45", "2:54"]);
  });
  await t.test("v1.9.72-t32, THE one for Queue: the album has Queue and Play Next, and they add to the phone's own queue", () => {
    assert.ok(r.actions.includes("Queue"), JSON.stringify(r.actions));
    assert.deepEqual(r.localCalls[0], ["add", "Heathen", "David Bowie", "", "0"], "the album, at the end");
    assert.deepEqual(r.localCalls[1], ["add", "Heathen", "David Bowie", "1", "1"], "its second track, next");
  });
  await t.test("v1.9.72-t32, THE one for the Queue screen: it lists the phone's queue, and a tap plays from there", () => {
    assert.deepEqual(r.queue.items.map((i) => [i.queue_item_id, i.title, i.length, i.image_key]),
      [[0, "Sunday", 285, "dl:k1"], [1, "Cactus", 174, "dl:k1"]]);
    assert.deepEqual(r.localCalls.find((c) => c[0] === "jump"), ["jump", "1"]);
  });
  await t.test("v1.9.72-t31, THE one for playing: Play Now plays it on the phone, the mini player shows it and drives it", () => {
    assert.equal(r.hasPlay, true);
    assert.deepEqual(r.localCalls.find((c) => c[0] === "play"), ["play", "Heathen", "David Bowie", "0"]);
    assert.equal(r.zones.zones.length, 1);
    assert.equal(r.zones.zones[0].display_name, "This phone");
    assert.equal(r.mini.hidden, false);
    assert.equal(r.mini.title, "Sunday");
    assert.equal(r.mini.kicker, "This phone");
    assert.deepEqual(r.localCalls.find((c) => c[0] === "control"), ["control", "playpause"]);
  });
});

test("v1.9.72-t32: offline with nothing on the phone, Home says how to put an album there", { skip: !harness.available }, async () => {
  const empty = BRIDGE.replace("albums: function () { return JSON.stringify([GOING, DONE]); }", "albums: function () { return JSON.stringify([GOING]); }");
  assert.notEqual(empty, BRIDGE);
  const r = harness.renderPage({ name: "offline-page-empty", windowSize: "390x844", driver: `
    await window.__sleep(1200);
    T("note", (document.getElementById("offline-home") || {}).textContent || null);
    var box = document.querySelector('#home-sections [data-row="downloads"]');
    T("rowShown", !!box && getComputedStyle(box).display !== "none");`,
    stub: `${empty}\nwindow.__installFetch(function () { return undefined; });\n${OFFLINE}` });
  harness.assertNoPageError(assert, r);
  assert.match(r.note, /no albums on this phone\. Download one from its ⋯/);
  assert.equal(r.rowShown, false, "an empty Downloaded row hides itself");
});
