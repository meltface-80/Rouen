"use strict";
// ---------------------------------------------------------------------------
// Settings → Plugins → iBroadcast in the page (2.0.6-t1, dev/design/ibroadcast.md §3.4): not installed, nothing of it
// is loaded or asked for; installed and signed out, Sign in on iBroadcast shows iBroadcast's link and the code and asks
// after it until it is approved; signed in, who, Premium, the formats and what the library holds; Sign out asks first.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const SIGNED = { connected: true, user: { name: "tester" }, premium: false, formats: ["flac", "mp3"], since: 1,
  library: { reading: false, albums: 1234, tracks: 15678, lossless: 15000, bytes: 512.3e9, at: Date.UTC(2026, 10, 20, 9, 30), error: null } };

function stub(o) {
  return `
window.__fx = ${JSON.stringify(o)};
window.__posts = [];
window.__installFetch(function (u, opts) {
  var m = (opts && opts.method) || "GET";
  if (m !== "GET") window.__posts.push(u);
  if (u.indexOf("/api/plugins") > -1) return window.__json([{ id: "hqplayer", name: "HQPWeb", enabled: false },
    { id: "ibroadcast", name: "iBroadcast", enabled: window.__fx.on, version: "2.0.6-t1", author: "Rouen", summary: "Sign in." }]);
  if (u.indexOf("/api/ibroadcast/signin/cancel") > -1) { window.__fx.state = { connected: false }; return window.__json(window.__fx.state); }
  if (u.indexOf("/api/ibroadcast/signin") > -1) {
    window.__fx.state = { connected: false, pending: { url: "https://media.ibroadcast.com/device?code=AB12CD", code: "AB12CD", expires_at: 0, error: null } };
    return window.__json(window.__fx.state);
  }
  if (u.indexOf("/api/ibroadcast/signout") > -1) { window.__fx.state = { connected: false }; return window.__json(window.__fx.state); }
  if (u.indexOf("/api/ibroadcast/status") > -1) return window.__json(window.__fx.state);
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});`;
}

const HELPERS = `
  await window.__sleep(500);
  await window.RouenPlugins.ready;
  var st = document.createElement("style"); st.textContent = ".settings-sheet { animation: none !important; }";
  document.head.appendChild(st);
  var shown = function (el) { return !!el && !el.closest(".hidden") && !el.closest("[hidden]") && getComputedStyle(el).display !== "none"; };
  var $ = function (id) { return document.getElementById(id); };
  var openPane = async function () {
    document.getElementById("settings-toggle").click();
    await window.__sleep(300);
    window.__openSettingsPane("ibroadcast");
    await window.__sleep(600);
  };
`;

const render = (name, o, driver) => harness.renderPage({ name, windowSize: "390x844", budgetMs: 30000, stub: stub(o), driver: HELPERS + driver });

test("not installed: nothing of iBroadcast loaded or asked for", async () => {
  const r = render("ibroadcast-off", { on: false, state: { connected: false } }, `
    await window.__sleep(1500);
    T("files", document.querySelectorAll('script[src^="ibroadcast/"], link[href^="ibroadcast/"]').length);
    T("calls", window.__callsMatching("/api/ibroadcast"));
    T("menu", !!document.getElementById("menu-item-ibroadcast"));
  `);
  harness.assertNoPageError(assert, r);
  assert.equal(r.files, 0);
  assert.equal(r.calls, 0);
  assert.equal(r.menu, false, "no side-menu entry: it has no screen");
});

test("signed out → Sign in shows the link and the code, asked after until approved → signed in", async () => {
  const r = render("ibroadcast-signin", { on: true, state: { connected: false } }, `
    await openPane();
    T("out", { status: $("ib-status").textContent, signin: shown($("ib-signin")), pending: shown($("ib-pending")), library: shown($("ib-library-block")) });
    $("ib-signin").click();
    await window.__sleep(300);
    T("pending", { status: $("ib-status").textContent, signin: shown($("ib-signin")), code: $("ib-code").textContent,
      link: $("ib-link").href, text: $("ib-link").textContent, target: $("ib-link").target, opened: window.__posts.slice() });
    var asked = window.__callsMatching("/api/ibroadcast/status");
    await window.__sleep(4500);
    T("asked", window.__callsMatching("/api/ibroadcast/status") - asked);
    window.__fx.state = ${JSON.stringify(SIGNED)};
    await window.__sleep(2500);
    T("in", { status: $("ib-status").textContent, pending: shown($("ib-pending")), signin: shown($("ib-signin")), premium: $("ib-premium").textContent,
      formats: $("ib-formats").textContent, library: $("ib-library").textContent, block: shown($("ib-library-block")) });
    var after = window.__callsMatching("/api/ibroadcast/status");
    await window.__sleep(4500);
    T("quiet", window.__callsMatching("/api/ibroadcast/status") - after);
    window.__asked = [];
    window.__confirmDialog = function (q) { window.__asked.push(q); return Promise.resolve(true); };
    $("ib-signout").click();
    await window.__sleep(400);
    T("out2", { status: $("ib-status").textContent, signin: shown($("ib-signin")), asked: window.__asked.length, block: shown($("ib-library-block")) });
  `);
  harness.assertNoPageError(assert, r);
  assert.deepEqual(r.out, { status: "Not signed in.", signin: true, pending: false, library: false });
  assert.equal(r.pending.status, "Waiting for Rouen to be approved on iBroadcast…");
  assert.equal(r.pending.signin, false);
  assert.equal(r.pending.code, "AB12CD");
  assert.equal(r.pending.link, "https://media.ibroadcast.com/device?code=AB12CD");
  assert.equal(r.pending.text, "media.ibroadcast.com/device?code=AB12CD");
  assert.equal(r.pending.target, "_blank");
  assert.deepEqual(r.pending.opened, ["/api/ibroadcast/signin"]);
  assert.ok(r.asked >= 2, "asked after every two seconds while the code waits: " + r.asked);
  assert.equal(r.in.status, "Signed in as tester");
  assert.equal(r.in.pending, false);
  assert.equal(r.in.signin, false);
  assert.equal(r.in.premium, "No: iBroadcast streams only 128 kbps MP3 copies");
  assert.equal(r.in.formats, "FLAC, MP3");
  assert.match(r.in.library, /^1,234 albums · 15,678 tracks \(15,000 lossless\) · 512\.3 GB · read /);
  assert.equal(r.in.block, true);
  assert.equal(r.quiet, 0, "signed in with nothing under way: no more asking");
  assert.equal(r.out2.asked, 1, "Sign out asks first");
  assert.equal(r.out2.status, "Not signed in.");
  assert.equal(r.out2.signin, true);
  assert.equal(r.out2.block, false);
});
