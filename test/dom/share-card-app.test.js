"use strict";
// ---------------------------------------------------------------------------
// v1.9.72-t22: the share card in the Android app (dev/design/android-app.md §4.17). The owner, 2026-10-30: "Android
// app share card doesn't work correctly with copying the image of the share card … Download didn't work either.
// Compare to Mandarins android app". In the app's WebView none of the browser's ways works: a download link goes
// nowhere (a WebView downloads only through a listener, and Android's download manager can't fetch a blob:), there is
// no Web Share, and its image clipboard is refused or leaves nothing to paste. As Mandarin's page did with its app
// (window.MusicDShare), the page hands the card's PNG to the app: RouenPhone.cardCopy / cardSave.
// v1.9.72-t25: the owner, once Copy worked: "I want share removed to leave copy and download". The app offers no
// Share… for the card; in a browser it is still offered where Web Share is.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const ZONE = { zone_id: "z1", display_name: "Zone", state: "paused", outputs: [],
  now_playing: { line1: "Western Stars", line2: "Bruce Springsteen", line3: "Western Stars", image_key: "k0", length: 240, seek_position: 10 } };

// The app's bridge as the page sees it: each call kept, each answer as the app gives it (JSON text).
const BRIDGE = (answer) => `
window.__cardCalls = [];
window.RouenPhone = {
  settings: function () { return "{}"; },
  cardCopy: function (png, name) { window.__cardCalls.push(["copy", png, name]); return ${JSON.stringify(answer)}; },
  cardSave: function (png, name) { window.__cardCalls.push(["save", png, name]); return ${JSON.stringify(answer)}; }
};`;

const stub = (extra) => `
try { localStorage.setItem("rra-zone", "z1"); } catch (e) {}
${extra || ""}
window.__installFetch(function (u) {
  if (u.indexOf("/api/zones") > -1)      return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: null });
  if (u.indexOf("/api/home/") > -1)      return window.__json({ albums: [], label: null });
  if (u.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1)           return window.__json({});
  return undefined;
});`;

const DRIVER = `
  await window.__sleep(600);
  // A PNG's first bytes, so the bytes the app is handed can be checked (base64 "iVBORw0K").
  ShareCard.render = function () {
    return Promise.resolve(new Blob([new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A])], { type: "image/png" }));
  };
  // A blob is read in REAL time and every wait here is VIRTUAL (share-sheet-chrome.test.js says why), so FileReader
  // answers on the virtual clock: those same bytes, as the page's own reader would give them.
  window.FileReader = function () {
    var self = this;
    this.readAsDataURL = function () {
      setTimeout(function () { self.result = "data:image/png;base64," + btoa(String.fromCharCode(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A)); if (self.onload) self.onload(); }, 0);
    };
  };
  window.__openShareCard({ title: "Western Stars", artist: "Bruce Springsteen", image_key: "k0" });
  var actions = document.getElementById("share-actions"), hint = document.getElementById("share-hint");
  for (var w = 0; w < 80 && !hint.textContent; w++) await window.__sleep(50);
  function row() { return Array.prototype.map.call(actions.children, function (el) { return el.tagName + ":" + el.textContent.trim(); }); }
  T("row", row());
  T("links", actions.querySelectorAll("a[download]").length);
  function press(label) { var b = Array.prototype.find.call(actions.querySelectorAll("button"), function (x) { return x.textContent.trim() === label; }); if (b) b.click(); return !!b; }
  var pressed = [press("Copy image")]; await window.__sleep(100); T("afterCopy", row());
  T("hasShare", !!Array.prototype.find.call(actions.querySelectorAll("button"), function (x) { return x.textContent.trim() === "Share…"; }));
  pressed.push(press("Download")); await window.__sleep(100); T("afterSave", row());
  T("pressed", pressed);
  T("calls", window.__cardCalls);
  T("err", document.getElementById("share-err").textContent);
`;

test("v1.9.72-t22/t25: in the app, the card's Copy image and Download go through the app, and there is no Share…", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "share-card-app", windowSize: "390x844", stub: stub(BRIDGE('{"ok":true}')), driver: DRIVER });
  harness.assertNoPageError(assert, r);
  await t.test("THE one: the two, as buttons, and no download link (it goes nowhere in a WebView)", () => {
    assert.deepEqual(r.row, ["BUTTON:Copy image", "BUTTON:Download"]);
    assert.equal(r.links, 0);
  });
  await t.test("v1.9.72-t25: no Share… (the owner: \"share removed to leave copy and download\")", () => {
    assert.equal(r.hasShare, false);
  });
  await t.test("each hands the app the card's PNG and its name", () => {
    assert.deepEqual(r.pressed, [true, true]);
    assert.deepEqual(r.calls.map((c) => c[0]), ["copy", "save"]);
    for (const c of r.calls) {
      assert.equal(c[1], "iVBORw0K", "the PNG's own bytes, as base64 with no data: prefix");
      assert.equal(c[2], "Bruce_Springsteen-Western_Stars.png");
    }
  });
  await t.test("each says how it went", () => {
    assert.ok(r.afterCopy.includes("BUTTON:Copied!"), JSON.stringify(r.afterCopy));
    assert.ok(r.afterSave.includes("BUTTON:Saved to Pictures"), JSON.stringify(r.afterSave));
    assert.equal(r.err, "");
  });
});

test("v1.9.72-t22: the app refusing says why, under the card", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "share-card-app-refused", windowSize: "390x844",
    stub: stub(BRIDGE('{"error":"Allow Rouen to save to the phone\'s storage, then tap Download again"}')), driver: DRIVER });
  harness.assertNoPageError(assert, r);
  await t.test("the app's words, and nothing claimed done", () => {
    assert.match(r.err, /Allow Rouen to save/);
    assert.ok(!r.afterSave.includes("BUTTON:Saved to Pictures"));
    assert.ok(!r.afterCopy.includes("BUTTON:Copied!"));
  });
});

test("v1.9.72-t22: in a browser, nothing changes: a download link, no app", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "share-card-browser", windowSize: "390x844", stub: stub(""), driver: DRIVER });
  harness.assertNoPageError(assert, r);
  await t.test("Download is the browser's own link", () => {
    assert.equal(r.links, 1);
    assert.ok(r.row.includes("A:Download"), JSON.stringify(r.row));
  });
});
