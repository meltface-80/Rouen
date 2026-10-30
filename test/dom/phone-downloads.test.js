"use strict";
// ---------------------------------------------------------------------------
// v1.9.72-t28: albums downloaded to the phone, the page's side (public/phone-settings.js, public/album-actions.js;
// dev/design/android-app.md §4.19). The owner, 2026-10-30: "I want to work on downloads from Roon to the Android app
// for offline use". In the app, the album view's ⋯ offers Download to this phone, hands the app the album (its title,
// artist and cover), then says how far it has got as the app tells it; Settings → Streaming & downloads lists the
// albums on the phone, each with Remove. A browser has no bridge, and offers none of it.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const ZONE = { zone_id: "z1", display_name: "Living Room", state: "stopped", outputs: [] };
const ALBUMS = [{ offset: 0, title: "Heathen", subtitle: "David Bowie", image_key: "k1" }];
const DETAIL = {
  title: "Heathen", subtitle: "David Bowie", image_key: "k1", year: 2002,
  actions: [{ kind: "play_now", title: "Play Now" }, { kind: "queue", title: "Queue" }, { kind: "play_next", title: "Play Next" }],
  tracks: [{ title: "Sunday", subtitle: "David Bowie" }, { title: "Cactus", subtitle: "David Bowie" }],
};

// The app's bridge as the page sees it: the phone settings it already had, and the downloads, kept in memory.
const BRIDGE = `
window.__dlCalls = [];
window.__albums = {};
window.RouenPhone = {
  settings: function () { return JSON.stringify({ homeQuality: "opus", awayQuality: "opus", network: "home", downloadQuality: "original",
    downloadLocation: "phone", downloadWifiOnly: true, downloadLimitGb: 0, places: [{ id: "phone", label: "Phone storage", free: 1 }] }); },
  set: function () { return this.settings(); },
  albumState: function (t, a) { var x = window.__albums[t + "|" + a]; return JSON.stringify(x || { state: "none" }); },
  albumDownload: function (t, a, k) {
    window.__dlCalls.push(["download", t, a, k]);
    window.__albums[t + "|" + a] = { title: t, artist: a, image_key: k, state: "queued", done: 0, total: 0, bytes: 0 };
    return JSON.stringify(window.__albums[t + "|" + a]);
  },
  albumRemove: function (t, a) { window.__dlCalls.push(["remove", t, a]); delete window.__albums[t + "|" + a]; return '{"ok":true}'; },
  albums: function () { var out = []; for (var k in window.__albums) out.push(window.__albums[k]); return JSON.stringify(out); }
};`;

const stub = (extra) => `
try { localStorage.setItem("rra-zone", "z1"); } catch (e) { /* storage optional */ }
${extra || ""}
window.__installFetch(function (u) {
  if (u.indexOf("/api/album/extras") > -1) return window.__json({});
  if (u.indexOf("/api/album") > -1)        return window.__json(${JSON.stringify(DETAIL)});
  if (u.indexOf("/api/random-albums") > -1) return window.__json({ albums: ${JSON.stringify(ALBUMS)}, total: 1, filtered: false });
  if (u.indexOf("/api/zone-state") > -1)   return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (u.indexOf("/api/zones") > -1)        return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (u.indexOf("/api/home/") > -1)        return window.__json({ albums: [], label: null });
  if (u.indexOf("/api/status") > -1)       return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1)             return window.__json({});
  return undefined;
});`;

const DRIVER = `
  await window.__sleep(600);
  window.__openAlbum(${JSON.stringify(ALBUMS[0])}, { source: "search" });
  await window.__sleep(1300);
  function items() { return Array.prototype.map.call(document.querySelectorAll("#album-modal .overflow-menu .sel-menu-item"), function (b) { return b.textContent.trim(); }); }
  function press(re) { var b = Array.prototype.find.call(document.querySelectorAll("#album-modal .overflow-menu .sel-menu-item"), function (x) { return re.test(x.textContent); }); if (b) b.click(); return !!b; }
  T("before", items());
  T("pressed", press(/^Download to this phone$/));
  await window.__sleep(100);
  T("calls", JSON.parse(JSON.stringify(window.__dlCalls || null)));
  T("afterAsk", items());
  if (window.__albums) {
    // The app says the download moved on: the item follows.
    var a = window.__albums["Heathen|David Bowie"];
    if (a) { a.state = "downloading"; a.done = 1; a.total = 2; }
    if (window.__rouenDownloadsChanged) window.__rouenDownloadsChanged();
    await window.__sleep(50);
    T("moving", items());
    if (a) { a.state = "done"; a.done = 2; a.bytes = 3 * 1048576; }
    // Settings → Streaming & downloads → On this phone.
    var nav = document.querySelector('.settings-nav-item[data-pane="phone"]');
    if (nav) nav.click();
    await window.__sleep(100);
    var list = document.getElementById("phone-albums");
    T("list", list ? list.textContent.replace(/\\s+/g, " ").trim() : null);
    var rm = list && Array.prototype.find.call(list.querySelectorAll("button"), function (b) { return b.textContent.trim() === "Remove"; });
    if (rm) rm.click();
    await window.__sleep(100);
    T("afterRemove", list ? list.textContent.replace(/\\s+/g, " ").trim() : null);
    T("callsAfter", window.__dlCalls);
  }
`;

test("v1.9.72-t28: in the app, an album is downloaded to the phone from its ⋯, and listed in Settings", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "phone-downloads", windowSize: "390x844", stub: stub(BRIDGE), driver: DRIVER });
  harness.assertNoPageError(assert, r);
  await t.test("THE one: the ⋯ offers it, and hands the app the album: its title, artist and cover", () => {
    assert.ok(r.before.includes("Download to this phone"), JSON.stringify(r.before));
    assert.equal(r.pressed, true);
    assert.deepEqual(r.calls, [["download", "Heathen", "David Bowie", "k1"]]);
  });
  await t.test("then says how far it has got, as the app tells it", () => {
    assert.ok(r.afterAsk.includes("Waiting to download · Remove"), JSON.stringify(r.afterAsk));
    assert.ok(r.moving.includes("Downloading 1 of 2 · Remove"), JSON.stringify(r.moving));
  });
  await t.test("Settings lists the albums on the phone, how much each takes, and removes one", () => {
    assert.match(r.list, /Heathen — David Bowie/);
    assert.match(r.list, /On this phone · 3 MB/);
    assert.deepEqual(r.callsAfter.at(-1), ["remove", "Heathen", "David Bowie"]);
    assert.match(r.afterRemove, /No albums on this phone yet/);
  });
});

test("v1.9.72-t28: in a browser, no Download: there is no app to keep it", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "phone-downloads-browser", windowSize: "390x844", stub: stub(""), driver: DRIVER });
  harness.assertNoPageError(assert, r);
  await t.test("the ⋯ as it was", () => {
    assert.ok(!r.before.some((s) => /Download/.test(s)), JSON.stringify(r.before));
    assert.equal(r.pressed, false);
  });
});
