"use strict";
// ---------------------------------------------------------------------------
// v1.9.72-t32: online and offline in harmony in the Android app (public/phone-local.js, public/home-downloads.js;
// dev/design/android-app.md §4.19). The owner, 2026-10-30, testing t31: "When I went back online during playing the
// album it stopped playback, this should not happen", "Online and offline modes should work in harmony", and "I want a
// downloads carousel to be present when there are downloaded albums regardless of being offline". Decided with the
// owner: online, a download still playing is shown and driven by Rouen's page as This phone until something is played
// through Roon; online, a downloaded album plays through Roon; the Downloaded row is the app's only, first by default.
//
// Rouen's own page (no offline.js), over the app's bridge stood in, with the phone playing a download, then not:
//   - the zone list has This phone in place of the phone's zone in Roon, and it is the zone shown;
//   - the mini player shows the download and its buttons drive the phone, not Roon;
//   - the Queue is the phone's own;
//   - Play Now on This phone, the phone's own play over, goes through Roon to the phone's zone there;
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
window.RouenPhone = {
  settings: function () { return JSON.stringify({ network: "home", places: [] }); },
  albums: function () { return JSON.stringify([DONE]); },
  album: function (t, a) { return JSON.stringify(t === "Heathen" ? DONE : { state: "none" }); },
  albumState: function () { return '{"state":"none"}'; },
  localPlay: function () { return '{"ok":true}'; },
  localAdd: function () { return '{"ok":true}'; },
  localState: function () { return JSON.stringify(window.__local); },
  localQueue: function () {
    return window.__local.state === "stopped" ? "[]" : JSON.stringify([{ id: 0, title: "Sunday", artist: "David Bowie", album: "Heathen", key: "k1", length: 285 }]);
  },
  localJump: function (id) { window.__localCalls.push(["jump", id]); return '{"ok":true}'; },
  localControl: function (op) { window.__localCalls.push(["control", op]); return '{"ok":true}'; },
  localSeek: function (sec) { window.__localCalls.push(["seek", sec]); return '{"ok":true}'; }
};`;

// Rouen's routes: two zones in Roon, one of them the phone's. What the page sends to the server is kept.
const SERVER = `
window.__sent = [];
window.__installFetch(function (u, opts) {
  if (opts && opts.method === "POST") window.__sent.push([u.replace(/^file:\\/\\//, ""), JSON.parse(opts.body || "{}")]);
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
  // The phone's own play over: This phone is the phone's zone in Roon.
  window.__local = { state: "stopped", roon_zone: "Rouen A142" };
  await fetch("/api/play", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offset: 3, title: "Low", subtitle: "David Bowie", zone_or_output_id: "this-phone", kind: "play_now" }) });
  T("localCalls", window.__localCalls);
  T("sent", window.__sent);
` + SETTINGS;

test("v1.9.72-t32: online, the phone's own play is This phone, and Downloaded is Home's row", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "phone-local-online", windowSize: "390x844", stub: BRIDGE + SERVER, driver: DRIVER });
  harness.assertNoPageError(assert, r);
  await t.test("THE one: a download still playing when Rouen comes back is This phone, shown, and driven on the phone", () => {
    assert.deepEqual(r.zones, [["z-lounge", "Lounge"], ["this-phone", "This phone"]], "the phone's zone in Roon is This phone");
    assert.equal(r.selected, "this-phone");
    assert.equal(r.mini.title, "Sunday");
    assert.equal(r.mini.kicker, "This phone");
    assert.deepEqual(r.localCalls[0], ["control", "playpause"]);
    assert.ok(!r.sent.some(([u]) => u === "/api/control"), "Roon was not asked: " + JSON.stringify(r.sent));
  });
  await t.test("its Queue is the phone's own, with Roon's covers online", () => {
    assert.deepEqual(r.queue.items.map((i) => [i.title, i.image_key]), [["Sunday", "roon-heathen"]]);
  });
  await t.test("THE one for Play Now: the phone's own play over, it goes through Roon, to the phone's zone there", () => {
    const play = r.sent.find(([u]) => u === "/api/play");
    assert.ok(play, JSON.stringify(r.sent));
    assert.equal(play[1].zone_or_output_id, "z-phone");
    assert.equal(play[1].title, "Low");
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

test("v1.9.72-t32: in a browser there is no Downloaded row", { skip: !harness.available }, async () => {
  const r = harness.renderPage({ name: "phone-local-browser", windowSize: "390x844", stub: SERVER,
    driver: `await window.__sleep(800); T("row", !!document.querySelector('[data-row="downloads"]')); T("local", !!window.RouenLocal);` + SETTINGS });
  harness.assertNoPageError(assert, r);
  assert.equal(r.row, false);
  assert.equal(r.local, false);
  assert.equal(r.settings[0][0], "unplayed", "Settings → Home Screen doesn't offer it");
});
