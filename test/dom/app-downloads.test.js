"use strict";
// ---------------------------------------------------------------------------
// v1.9.72-t23: the page's downloads in the Android app (dev/design/android-app.md §4.17). After the share card (t22)
// the owner said: "Yes, fix the other downloads the same way". A download link does nothing in the app's WebView, so
// a shared playlist's .musicd, the labels scan log and a backup are handed to the app (RouenPhone.fileSave), which
// saves them to the phone's Downloads/Rouen. In a browser each stays the browser's own download.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const ZONE = { zone_id: "z1", display_name: "Zone", state: "stopped", outputs: [] };
const BACKUP = "{\"backup\":\"rouen\",\"parts\":{\"settings\":{}}}";
const SCAN_LOG = "scan: 3 labels from tags\n";

// The app's bridge, as the page sees it: each call kept, the app's answer given back.
const BRIDGE = (answer) => `
window.__saved = [];
window.RouenPhone = { settings: function () { return "{}"; },
  fileSave: function (data, name) { window.__saved.push([atob(data), name]); return ${JSON.stringify(answer)}; } };`;

// A blob is read in REAL time and every wait here is VIRTUAL (share-sheet-chrome.test.js says why), so FileReader
// answers on the virtual clock with what can be known of the blob at once: its size, which the bytes must match.
const READER = `
window.FileReader = function () {
  var self = this;
  this.readAsDataURL = function (blob) {
    setTimeout(function () { self.result = "data:application/octet-stream;base64," + btoa("size " + blob.size); if (self.onload) self.onload(); }, 0);
  };
};
// A download link followed: one the page clicks itself, or one a tap reaches that nothing stopped. Neither is let go
// anywhere (the page would leave).
window.__links = [];
HTMLAnchorElement.prototype.click = function () { window.__links.push([this.getAttribute("href") || "", this.download]); };
window.addEventListener("click", function (e) {
  var a = e.target && e.target.closest && e.target.closest("a[download]");
  if (!a) return;
  if (!e.defaultPrevented) window.__links.push([a.getAttribute("href") || "", a.download]);
  e.preventDefault();
});`;

const stub = (extra) => `
try { localStorage.setItem("rra-zone", "z1"); } catch (e) {}
${READER}
${extra || ""}
window.__installFetch(function (u, opts) {
  if (u.indexOf("/api/share/encode") > -1) return window.__json({ blob: "MDRP1:ZmFrZQ", bytes: 12, track_count: 1, skipped: 0, truncated: false });
  if (u.indexOf("/api/playlists") > -1) return window.__json({ playlists: [{ offset: 0, title: "Late Night", subtitle: "1 track", image_key: null }], total: 1 });
  if (u.indexOf("/api/playlist/art") > -1) return window.__json({ title: "Late Night", art_keys: [] });
  if (u.indexOf("/api/playlist") > -1) return window.__json({ title: "Late Night", subtitle: "1 track", image_key: null,
    tracks: [{ index: 0, title: "Teen Age Riot", subtitle: "Sonic Youth", image_key: null, track_no: 1 }], total: 1, truncated: false, can_play: true });
  if (u.indexOf("/api/filters/labels") > -1) return window.__json({ labels: [{ name: "Hyperdub", albumCount: 3 }], scanning: false });
  if (u.indexOf("/api/labels-scan-log") > -1) return Promise.resolve(new Response(${JSON.stringify(SCAN_LOG)}, { status: 200 }));
  if (u.indexOf("/download") > -1 && u.indexOf("/api/backups/") > -1) return Promise.resolve(new Response(${JSON.stringify(BACKUP)}, { status: 200 }));
  if (u.indexOf("/api/backups") > -1) return window.__json({ boot: "b1", parts: ["settings"], keep: { manual: 10, before: 5 }, ok: true,
    backups: [{ id: "rouen-backup-20261030-120000", kind: "manual", created: "2026-10-30T12:00:00.000Z", version: "1.9.72", parts: ["settings"], size: 40 }] });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: null });
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (u.indexOf("/api/home/") > -1) return window.__json({ albums: [], label: null });
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});`;

const DRIVER = `
  await window.__sleep(500);
  var still = document.createElement("style");
  still.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}";
  document.head.appendChild(still);
  var toast = document.getElementById("toast");
  function btn(sel, label) { return Array.prototype.find.call(document.querySelectorAll(sel), function (b) { return b.textContent.trim() === label; }); }

  // 1. A playlist, shared: the sheet's Download
  document.getElementById("menu-toggle").click(); await window.__sleep(200);
  document.querySelector('[data-action="playlists"]').click(); await window.__sleep(600);
  document.querySelectorAll("#album-grid .album")[0].click(); await window.__sleep(600);
  btn(".playlist-actions button", "Share").click(); await window.__sleep(500);
  var dl = btn(".lib-sheet-foot button", "Download");
  T("playlistButton", !!dl);
  if (dl) dl.click();
  await window.__sleep(300);
  T("playlistToast", toast ? toast.textContent : "");
  var done = btn(".lib-sheet-foot button", "Done"); if (done) done.click();
  await window.__sleep(300);

  // 2. Labels: the scan log
  document.getElementById("labels-toggle").click(); await window.__sleep(800);
  var log = document.querySelector(".scan-log-link a");
  T("logLink", !!log);
  if (log) log.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await window.__sleep(300);
  T("logText", log ? log.textContent : "");

  // 3. Settings → Backup & restore: a backup's Download
  document.getElementById("settings-toggle").click(); await window.__sleep(300);
  document.querySelector('.settings-nav-item[data-pane="backup"]').click(); await window.__sleep(600);
  var bd = btn("#backup-list button", "Download");
  T("backupButton", !!bd);
  if (bd) bd.click();
  await window.__sleep(300);
  T("backupSays", document.getElementById("backup-status").textContent);

  T("saved", window.__saved || null);
  T("links", window.__links);
`;

const size = (s) => "size " + Buffer.byteLength(s, "utf8");

test("v1.9.72-t23: in the app, the three downloads are saved by the app to Downloads/Rouen", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "app-downloads", windowSize: "390x844", stub: stub(BRIDGE('{"ok":true}')), driver: DRIVER });
  harness.assertNoPageError(assert, r);
  await t.test("precondition: each screen's download is there", () => {
    assert.deepEqual([r.playlistButton, r.logLink, r.backupButton], [true, true, true]);
  });
  await t.test("THE one: each file's bytes and name are handed to the app, and no download link is followed", () => {
    assert.deepEqual(r.saved, [[size("MDRP1:ZmFrZQ"), "Late_Night.musicd"], [size(SCAN_LOG), "labels-scan.log"],
      [size(BACKUP), "rouen-backup-20261030-120000.json"]]);
    assert.deepEqual(r.links, []);
  });
  await t.test("each says where it went", () => {
    assert.match(r.playlistToast, /Saved to Downloads\/Rouen/);
    assert.match(r.logText, /Saved to Downloads\/Rouen/);
    assert.match(r.backupSays, /Saved to Downloads\/Rouen/);
  });
});

test("v1.9.72-t23: the app refusing says why", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "app-downloads-refused", windowSize: "390x844",
    stub: stub(BRIDGE('{"error":"Allow Rouen to save to the phone\'s storage, then try again"}')), driver: DRIVER });
  harness.assertNoPageError(assert, r);
  await t.test("the app's words, and nothing claimed saved", () => {
    assert.match(r.playlistToast, /Allow Rouen to save/);
    assert.match(r.backupSays, /Allow Rouen to save/);
    assert.doesNotMatch(r.logText, /Saved/);
  });
});

test("v1.9.72-t23: in a browser, each is the browser's own download, as before", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "browser-downloads", windowSize: "390x844", stub: stub(""), driver: DRIVER });
  harness.assertNoPageError(assert, r);
  await t.test("three download links followed, with their names", () => {
    assert.equal(r.saved, null);
    assert.deepEqual(r.links.map((l) => l[1]), ["Late_Night.musicd", "labels-scan.log", "rouen-backup-20261030-120000.json"]);
    assert.match(r.links[0][0], /^blob:/);
    assert.equal(r.links[2][0], "/api/backups/rouen-backup-20261030-120000/download");
  });
});
