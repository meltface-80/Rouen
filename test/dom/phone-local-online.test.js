"use strict";
// ---------------------------------------------------------------------------
// v1.9.72 §4.22: "This phone" is the phone's own standalone player, always (public/phone-local.js, public/home-downloads.js;
// dev/design/android-app.md §4.22). The owner, 2026-10-31: "This phone is this phone at all times" — it is never a Roon
// zone; it plays the phone's own files direct, home and away. (This supersedes the t32 §4.19 harmony, where online the
// phone's own play relayed through Roon; the relay is gone.)
//
// Rouen's own page (no offline.js), over the app's bridge stood in, at home, with the phone playing a download, then not:
//   - the zone list shows the real Roon zones beside This phone, with this phone's own server zone hidden (one phone,
//     shown once as This phone), and This phone is the zone shown while it plays;
//   - the mini player shows the download and its buttons drive the phone, not Roon;
//   - the Queue is the phone's own;
//   - Play Now on This phone of a local library album plays DIRECT on the phone, not through Roon;
//   - Home's first row is Downloaded, with Roon's covers;
// and in a browser (no bridge) there is no Downloaded row.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const BRIDGE = `
var DONE = { key: "k1", title: "Heathen", artist: "David Bowie", image_key: "roon-heathen", state: "done", done: 2, total: 2, bytes: 1,
  tracks: [{ n: 1, title: "Sunday", disc: 1, track: 1, length: 285 }, { n: 2, title: "Cactus", disc: 1, track: 2, length: 174 }] };
window.__local = { state: "playing", index: 0, count: 2, position: 40, length: 285, title: "Sunday", artist: "David Bowie",
  album: "Heathen", key: "k1", roon_zone: "Rouen A142" };
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

// Rouen's routes: a real Roon zone (Lounge) and this phone's own server zone (Rouen A142, hidden by This phone, still
// present until it is retired server-side). A local library album is served to the phone's own player. POSTs are kept.
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
    { zone_id: "z-phone", display_name: "Rouen A142", state: "stopped", outputs: [{ display_name: "Rouen A142" }] }] });
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
  var sel = document.getElementById("zone-select");
  T("selected", sel ? sel.value : null);
  T("mini", { title: document.getElementById("mt-title").textContent.trim(), kicker: document.getElementById("mt-kicker").textContent.trim() });
  document.getElementById("mt-playpause").click();
  await window.__sleep(300);
  T("queue", await (await fetch("/api/queue?zone=this-phone")).json());
  var box = document.querySelector('#home-sections [data-row="downloads"]');
  T("row", box ? { first: box.parentElement.querySelector("[data-row]") === box, shown: getComputedStyle(box).display !== "none" && !box.classList.contains("hidden"),
    tiles: Array.prototype.map.call(box.querySelectorAll(".album"), function (t) { return [t.getAttribute("aria-label"), t.querySelector(".album-art-wrap").dataset.artKey]; }) } : null);
  // The phone's own play over: Play Now on This phone of a local library album plays DIRECT on the phone, not Roon (§4.22).
  window.__local = { state: "stopped", roon_zone: "Rouen A142" };
  window.__pl = [];
  await fetch("/api/play", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offset: 3, title: "Low", subtitle: "David Bowie", zone_or_output_id: "this-phone", kind: "play_now" }) });
  T("localCalls", window.__localCalls);
  T("pl", JSON.parse(JSON.stringify(window.__pl)));
  T("sent", JSON.parse(JSON.stringify(window.__sent)));
  T("playToRoon", window.__sent.some(function (x) { return x[0].indexOf("/api/play") > -1; }));
  // Queue on This phone adds to the phone's own queue (localAdd), not Play Now, and not Roon (§4.22).
  window.__add = [];
  await fetch("/api/play-track", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ album_title: "Low", album_subtitle: "David Bowie", track: 1, zone_or_output_id: "this-phone", kind: "queue" }) });
  T("add", JSON.parse(JSON.stringify(window.__add)));
  T("plAfterQueue", JSON.parse(JSON.stringify(window.__pl)));
` + SETTINGS;

test("v1.9.72 §4.22: online at home, This phone is the phone's own player, and Downloaded is Home's row", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "phone-local-online", windowSize: "390x844", stub: BRIDGE + SERVER, driver: DRIVER });
  harness.assertNoPageError(assert, r);
  await t.test("THE one: a download still playing is This phone, shown beside the real Roon zones, driven on the phone", () => {
    assert.deepEqual(r.zones, [["z-lounge", "Lounge"], ["this-phone", "This phone"]], "the real zone shows; this phone's server zone is hidden, This phone stands for it");
    assert.equal(r.selected, "this-phone");
    assert.equal(r.mini.title, "Sunday");
    assert.equal(r.mini.kicker, "This phone");
    assert.deepEqual(r.localCalls[0], ["control", "playpause"]);
    assert.ok(!r.sent.some(([u]) => u === "/api/control"), "Roon was not asked: " + JSON.stringify(r.sent));
  });
  await t.test("its Queue is the phone's own, with Roon's covers online", () => {
    assert.deepEqual(r.queue.items.map((i) => [i.title, i.image_key]), [["Sunday", "roon-heathen"]]);
  });
  await t.test("THE one for Play Now: a local library album plays direct on the phone, not through Roon (§4.22)", () => {
    assert.deepEqual(r.pl, [["Low", "David Bowie", "0", 1]], "the phone's own player was asked to play it");
    assert.equal(r.playToRoon, false, "This phone plays its own, not Roon's relay");
  });
  await t.test("Queue on This phone adds to the phone's own queue (localAdd), not Play Now (§4.22)", () => {
    assert.deepEqual(r.add, [["Low", "David Bowie", "1", "0"]], "it was added to the phone's queue, not played");
    assert.deepEqual(r.plAfterQueue, [["Low", "David Bowie", "0", 1]], "Play Now was not called again — pl is unchanged");
  });
  await t.test("THE one for the row: Downloaded is Home's first row online too, with Roon's covers", () => {
    assert.ok(r.row, "no Downloaded row");
    assert.equal(r.row.first, true);
    assert.equal(r.row.shown, true);
    assert.deepEqual(r.row.tiles, [["Heathen by David Bowie", "roon-heathen"]]);
  });
  await t.test("Settings → Home Screen lists it first, as Downloaded, with a grip to move it", () => {
    assert.deepEqual(r.settings, [["downloads", "Downloaded", true], ["unplayed", "Not played in 6 months", true]]);
  });
});

test("v1.9.72 §4.22: in a browser there is no Downloaded row", { skip: !harness.available }, async () => {
  const r = harness.renderPage({ name: "phone-local-browser", windowSize: "390x844", stub: SERVER,
    driver: `await window.__sleep(800); T("row", !!document.querySelector('[data-row="downloads"]')); T("local", !!window.RouenLocal);` + SETTINGS });
  harness.assertNoPageError(assert, r);
  assert.equal(r.row, false);
  assert.equal(r.local, false);
  assert.equal(r.settings[0][0], "unplayed", "Settings → Home Screen doesn't offer it");
});
