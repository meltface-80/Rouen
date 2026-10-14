"use strict";
// ---------------------------------------------------------------------------
// Rouen's account on the page (public/login.js, v1.9.26, dev/design/login.md):
// the sheet that will not close until the account is made or this device logs
// in — on the remote, the wall display and Shelf — and Settings → System's
// Account section. In the real page, against stubbed answers.
//
// Made or logged in, the page reloads. The stub keeps what each answer did in
// sessionStorage, which a reload keeps, so the second load answers as the
// server would after it, and the driver reports what the first load did.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

// start: "none" | "legacy" | "out" (an account, this device not logged in) | "in" | "silent" (no account field at all)
const STUB_FOR = (start) => `
window.__ss = function (k, v) {
  try { if (v === undefined) return JSON.parse(sessionStorage.getItem(k) || "null"); sessionStorage.setItem(k, JSON.stringify(v)); }
  catch (e) { /* no sessionStorage on this page: the test reports it */ }
  return null;
};
if (!window.__ss("state")) window.__ss("state", ${JSON.stringify(start)});
window.__ss("loads", (window.__ss("loads") || 0) + 1);
window.__zone = { zone_id: "z1", display_name: "Living Room", state: "playing", is_previous_allowed: true, is_next_allowed: true,
  settings: { shuffle: false, loop: "disabled", auto_radio: false },
  outputs: [{ output_id: "o1", display_name: "Living Room", volume: { type: "number", min: 0, max: 100, value: 40, step: 1 } }],
  now_playing: { line1: "Sunday", line2: "David Bowie", line3: "Heathen", image_key: "k", length: 285, seek_position: 34 } };
try { localStorage.setItem("rra-zone", "z1"); } catch (e) { /* storage optional: the zone falls back to the first */ }
window.__guardBody = function (st) {
  return { error: "Rouen's account has to be made first.", setup: true, legacy: st === "legacy" };
};
window.__installFetch(function (u, init) {
  var post = init && init.method === "POST" ? JSON.parse(init.body || "{}") : null;
  var st = window.__ss("state");
  if (post && u.indexOf("/api/login") > -1) {
    var posts = window.__ss("posts") || []; posts.push([u, post]); window.__ss("posts", posts);
  }
  if (u.indexOf("/api/login/setup") > -1 && st === "taken") return window.__json({ error: "Rouen already has an account. Log in with it." }, 409);
  if (u.indexOf("/api/login/setup") > -1) { window.__ss("state", "in"); return window.__json({ ok: true }); }
  if (u.indexOf("/api/login/password") > -1) return window.__json({ ok: true });
  if (u.indexOf("/api/login/username") > -1) return window.__json({ ok: true, user: post.user.trim() });
  if (u.indexOf("/api/logout") > -1) { window.__ss("state", "out"); return window.__json({ ok: true }); }
  if (u.indexOf("/api/login") > -1 && post) {
    if (post.user === "Lewis" && post.password === "right password") { window.__ss("state", "in"); return window.__json({ ok: true }); }
    return window.__json({ error: "Wrong username or password." }, 401);
  }
  if (u.indexOf("/api/login") > -1) {
    if (st === "silent") return window.__json({});
    return window.__json({ account: st === "in" || st === "out", setup: st === "none" || st === "legacy" || st === "taken", legacy: st === "legacy",
                           loggedIn: st === "in", user: st === "in" ? "Lewis" : undefined });
  }
  if (u.indexOf("/api/zones-guarded") > -1) return window.__json({ error: "Log in to Rouen first.", login: true }, 401);
  // Every other request as the real guard answers it (lib/login.js): the fakes are not evidence,
  // and the screens behind the sheet keep asking while it is up.
  if (u.indexOf("/api/") > -1 && (st === "none" || st === "legacy" || st === "taken")) return window.__json(window.__guardBody(st), 401);
  if (u.indexOf("/api/") > -1 && st === "out") return window.__json({ error: "Log in to Rouen first.", login: true }, 401);
  // A zone playing, so the mini transport (z-index 70) is up for the sheet to be drawn over.
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: window.__zone });
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [window.__zone] });
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});`;

// What the sheet shows, as a person would see it.
const SEEN = `
  function seen() {
    var g = document.getElementById("rouen-gate");
    var vis = function (id) { var el = document.getElementById(id); return !!el && getComputedStyle(el).display !== "none"; };
    var r = g ? g.getBoundingClientRect() : null;
    return { exists: !!g, open: !!g && getComputedStyle(g).display !== "none", title: (document.getElementById("rouen-gate-title") || {}).textContent,
      user: vis("rouen-gate-user"), current: vis("rouen-gate-current"), password: vis("rouen-gate-password"), again: vis("rouen-gate-again"),
      covers: !!r && r.width >= innerWidth && r.height >= innerHeight,
      // A 5 x 5 grid of points, the corners and the foot (where the mini transport sits) among them.
      on_top: !!g && [0.02, 0.25, 0.5, 0.75, 0.97].every(function (fx) { return [0.02, 0.25, 0.5, 0.75, 0.97].every(function (fy) {
        var el = document.elementFromPoint(innerWidth * fx, innerHeight * fy); return !!el && g.contains(el); }); }),
      mini: (function () { var m = document.getElementById("mini-transport"); return !!m && !m.classList.contains("hidden") && m.getBoundingClientRect().height > 0; })(),
      error: (document.getElementById("rouen-gate-error") || {}).textContent };
  }
  function fill(id, v) { document.getElementById(id).value = v; }
  function go() { document.getElementById("rouen-gate-go").click(); }
`;

// The first load does the steps up to the reload; the second reports.
const DRIVER_SETUP = SEEN + `
  if (window.__ss("loads") === 1) {
    await window.__sleep(600);
    // Nothing of the app loads without the account (every request is a 401), so
    // the highest thing it can show — the mini transport, z-index 70 — is put up
    // by hand, for the sheet to be drawn over.
    document.getElementById("mini-transport").classList.remove("hidden");
    await window.__sleep(100);
    var first = { at_load: seen() };
    fill("rouen-gate-user", "Lewis"); fill("rouen-gate-password", "short"); fill("rouen-gate-again", "short"); go();
    await window.__sleep(100);
    first.short = { error: seen().error, posts: (window.__ss("posts") || []).length };
    fill("rouen-gate-password", "a good one!"); fill("rouen-gate-again", "a good two!"); go();
    await window.__sleep(100);
    first.differ = { error: seen().error, posts: (window.__ss("posts") || []).length };
    fill("rouen-gate-again", "a good one!");
    window.__ss("first", first);
    go();
    await window.__sleep(3000);                      // the reload comes first
    T("no_reload", true);
    return;
  }
  await window.__sleep(400);
  T("first", window.__ss("first"));
  T("posts", window.__ss("posts"));
  T("after", seen());
  T("loads", window.__ss("loads"));
  document.getElementById("settings-toggle").click();
  await window.__sleep(300);
  document.querySelector('.settings-nav-item[data-pane="system"]').click();
  await window.__sleep(400);
  T("status", document.getElementById("login-status").textContent);
  T("system_panes", document.querySelectorAll('.settings-pane[data-pane="system"]').length);
  T("update_btn", !!document.getElementById("check-update-btn"));
`;

test("no account yet: the remote shows only 'Create Rouen's account' until it is made", async () => {
  const r = harness.available ? harness.renderPage({ name: "login-setup", windowSize: "390x844", budgetMs: 20000,
    stub: STUB_FOR("none"), driver: DRIVER_SETUP }) : null;
  if (!r) return;
  harness.assertNoPageError(assert, r);
  assert.equal(r.no_reload, undefined, "the page did not reload once the account was made");
  const f = r.first;
  assert.deepEqual([f.at_load.open, f.at_load.title], [true, "Create Rouen's account"], "THE one: no sheet on a Rouen with no account");
  assert.deepEqual([f.at_load.user, f.at_load.password, f.at_load.again, f.at_load.current], [true, true, true, false]);
  assert.equal(f.at_load.covers, true, "the sheet does not cover the page");
  assert.equal(f.at_load.mini, true, "the mini transport is not up — nothing high is there for the sheet to cover");
  assert.equal(f.at_load.on_top, true, "something is drawn over the sheet");
  assert.deepEqual(f.short, { error: "At least 8 characters for the password, please.", posts: 0 });
  assert.deepEqual(f.differ, { error: "The two passwords are not the same.", posts: 0 });
  assert.deepEqual(r.posts, [["/api/login/setup", { user: "Lewis", password: "a good one!" }]]);
  assert.equal(r.after.open, false, "the sheet is still up after the account was made");
  assert.equal(r.status, "Logged in as Lewis. Changing either needs the current password.");
  assert.deepEqual([r.system_panes, r.update_btn], [1, true], "Settings → System is missing or doubled");
});

const DRIVER_LEGACY = SEEN + `
  if (window.__ss("loads") === 1) {
    await window.__sleep(400);
    window.__ss("first", seen());
    fill("rouen-gate-user", "Lewis"); fill("rouen-gate-current", "the old one");
    go();
    await window.__sleep(3000);
    T("no_reload", true);
    return;
  }
  T("seen", window.__ss("first"));
  T("posts", window.__ss("posts"));
`;

test("an install that had a password: the account is a username and that password", async () => {
  if (!harness.available) return;
  const r = harness.renderPage({ name: "login-legacy", windowSize: "390x844", budgetMs: 20000, stub: STUB_FOR("legacy"), driver: DRIVER_LEGACY });
  harness.assertNoPageError(assert, r);
  assert.equal(r.no_reload, undefined, "the page did not reload once the account was made");
  assert.deepEqual([r.seen.open, r.seen.title, r.seen.current, r.seen.password, r.seen.again], [true, "Create Rouen's account", true, false, false]);
  assert.deepEqual(r.posts, [["/api/login/setup", { user: "Lewis", current: "the old one" }]],
    "THE one: the old password was not asked for, so the first device to arrive could take the install");
});

const DRIVER_LOGIN = SEEN + `
  if (window.__ss("loads") === 1) {
    await window.__sleep(400);
    var first = { at_load: seen() };
    fill("rouen-gate-user", "Lewis"); fill("rouen-gate-password", "wrong");
    go();
    await window.__sleep(200);
    first.wrong = seen();
    window.__ss("first", first);
    fill("rouen-gate-password", "right password");
    go();
    await window.__sleep(3000);
    T("no_reload", true);
    return;
  }
  await window.__sleep(400);
  T("first", window.__ss("first"));
  T("after", seen());
  // Logged in, a request answered 401 { login } (the login ended on another device) opens it again.
  var r = await fetch("/api/zones-guarded");
  await window.__sleep(100);
  T("ended", { status: r.status, sheet: seen() });
`;

test("an account, this device not logged in: 'Log in to Rouen', which will not close until it does", async () => {
  if (!harness.available) return;
  const r = harness.renderPage({ name: "login-out", windowSize: "390x844", budgetMs: 20000, stub: STUB_FOR("out"), driver: DRIVER_LOGIN });
  harness.assertNoPageError(assert, r);
  assert.equal(r.no_reload, undefined, "the page did not reload once logged in");
  assert.deepEqual([r.first.at_load.open, r.first.at_load.title, r.first.at_load.again, r.first.at_load.current],
    [true, "Log in to Rouen", false, false], "THE one: a device not logged in reached the remote");
  assert.deepEqual([r.first.wrong.open, r.first.wrong.error], [true, "Wrong username or password."]);
  assert.equal(r.after.open, false);
  assert.deepEqual([r.ended.status, r.ended.sheet.open, r.ended.sheet.title], [401, true, "Log in to Rouen"]);
});

const DRIVER_PAGE = SEEN + `
  await window.__sleep(600);
  T("seen", seen());
`;

for (const page of ["display", "shelf"]) {
  test(`the ${page === "display" ? "wall display" : "Shelf"} asks too`, async () => {
    if (!harness.available) return;
    const r = harness.renderPage({ name: "login-" + page, windowSize: "1280x800", page, stub: STUB_FOR("out"), driver: DRIVER_PAGE });
    harness.assertNoPageError(assert, r);
    assert.deepEqual([r.seen.open, r.seen.title, r.seen.covers], [true, "Log in to Rouen", true], `THE one: the ${page} page shows without a login`);
  });
}

test("an answer that says nothing about an account shows nothing", async () => {
  if (!harness.available) return;
  const r = harness.renderPage({ name: "login-silent", windowSize: "390x844", stub: STUB_FOR("silent"), driver: DRIVER_PAGE });
  harness.assertNoPageError(assert, r);
  assert.equal(r.seen.exists, true, "login.js never put the sheet in the page — the case is not tested");
  assert.equal(r.seen.open, false);
});

const DRIVER_TAKEN = SEEN + `
  await window.__sleep(400);
  fill("rouen-gate-user", "Lewis"); fill("rouen-gate-password", "a good one!"); fill("rouen-gate-again", "a good one!");
  go();
  await window.__sleep(300);
  T("seen", seen());
`;

test("someone made the account first: the sheet turns to 'Log in to Rouen' and says so", async () => {
  if (!harness.available) return;
  const r = harness.renderPage({ name: "login-taken", windowSize: "390x844", stub: STUB_FOR("taken"), driver: DRIVER_TAKEN });
  harness.assertNoPageError(assert, r);
  assert.deepEqual([r.seen.open, r.seen.title, r.seen.again, r.seen.error],
    [true, "Log in to Rouen", false, "Rouen already has an account. Log in with it."]);
});

const DRIVER_SETTINGS = SEEN + `
  var st = document.createElement("style"); st.textContent = ".settings-sheet { animation: none !important; }";
  document.head.appendChild(st);
  await window.__sleep(400);
  T("sheet", seen().open);
  document.getElementById("settings-toggle").click();
  await window.__sleep(300);
  document.querySelector('.settings-nav-item[data-pane="system"]').click();
  await window.__sleep(400);
  var s = function () { return document.getElementById("login-status").textContent; };
  fill("login-current", "right password"); fill("login-new", "short"); fill("login-again", "short");
  document.getElementById("login-save").click();
  await window.__sleep(100);
  T("short", s());
  fill("login-new", "another one"); fill("login-again", "another one");
  document.getElementById("login-save").click();
  await window.__sleep(200);
  T("changed", s());
  fill("login-current", "another one"); fill("login-user", " Mo ");
  document.getElementById("login-rename").click();
  await window.__sleep(300);
  T("renamed", s());
  T("posts", window.__ss("posts"));
`;

test("Settings → System → Account: change the password, change the username", async () => {
  if (!harness.available) return;
  const r = harness.renderPage({ name: "login-settings", windowSize: "390x844", stub: STUB_FOR("in"), driver: DRIVER_SETTINGS });
  harness.assertNoPageError(assert, r);
  assert.equal(r.sheet, false, "the sheet is up for a device that is logged in");
  assert.equal(r.short, "At least 8 characters for the password, please.");
  assert.equal(r.changed, "Password changed. Every other device logs in with it.");
  assert.equal(r.renamed, "Username changed to Mo.");
  assert.deepEqual(r.posts, [["/api/login/password", { current: "right password", password: "another one" }],
    ["/api/login/username", { current: "another one", user: " Mo " }]]);
});
