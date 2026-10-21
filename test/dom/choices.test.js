"use strict";
// ---------------------------------------------------------------------------
// The one-time choice on the page (public/login.js, v1.9.32, dev/design/
// login.md §5): before anything else, one sheet asks whether Rouen has
// accounts and whether it has native mode; Save is offered only with both
// answered and the box ticked; saved, the page reloads and never asks again.
// On an install with an account the login comes first. In the real page,
// against stubbed answers; the stub keeps its state in sessionStorage, which
// the reload keeps.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

// start: "unchosen" (a new install) | "account" (an install with an account, this device not logged in)
const STUB_FOR = (start) => `
window.__ss = function (k, v) {
  try { if (v === undefined) return JSON.parse(sessionStorage.getItem(k) || "null"); sessionStorage.setItem(k, JSON.stringify(v)); }
  catch (e) { /* no sessionStorage on this page: the test reports it */ }
  return null;
};
if (!window.__ss("state")) window.__ss("state", ${JSON.stringify(start)});
window.__ss("loads", (window.__ss("loads") || 0) + 1);
window.__installFetch(function (u, init) {
  var post = init && init.method === "POST" ? JSON.parse(init.body || "{}") : null;
  var st = window.__ss("state");
  if (post && u.indexOf("/api/choices") > -1) {
    window.__ss("posts", (window.__ss("posts") || []).concat([post]));
    window.__ss("state", "chosen");
    return window.__json({ ok: true, accounts: post.accounts, native: post.native });
  }
  if (u.indexOf("/api/choices") > -1 && st === "legacy") {
    // Answered late, after the guarded requests' 401s: the worse order (the review).
    return new Promise(function (res) { setTimeout(function () { res(window.__json({ made: false, account: false, legacy: true, loginFirst: false })); }, 1000); });
  }
  if (st === "legacy" && u.indexOf("/api/login") < 0 && u.indexOf("/api/") > -1) return window.__json({ error: "Choose how Rouen works first.", choose: true, legacy: true }, 401);
  if (u.indexOf("/api/choices") > -1) {
    if (st === "chosen") return window.__json({ made: true, accounts: false, native: false });
    return window.__json({ made: false, account: st === "account", legacy: false, loginFirst: st === "account" });
  }
  if (u.indexOf("/api/login") > -1) {
    if (st === "chosen") return window.__json({ accounts: false, account: false, setup: false, legacy: false, loggedIn: false });
    return window.__json({ account: st === "account", setup: st !== "account", legacy: false, loggedIn: false });
  }
  // Every other request as the real guard answers it (lib/choices.js) — late, so what the page shows at
  // first is its own reading of /api/choices and /api/login, not these 401s reopening the sheet.
  if (u.indexOf("/api/") > -1 && st === "unchosen") {
    return new Promise(function (res) { setTimeout(function () { res(window.__json({ error: "Choose how Rouen works first.", choose: true }, 401)); }, 1500); });
  }
  if (u.indexOf("/api/") > -1 && st === "account") return window.__json({ error: "Log in to Rouen first.", login: true }, 401);
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});`;

const SEEN = `
  function vis(id) { var el = document.getElementById(id); return !!el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().height > 0; }
  function seen() { return { open: vis("rouen-gate"), choose: vis("rouen-choose-form"), login: vis("rouen-gate-form"),
    title: (document.getElementById("rouen-gate-title") || {}).textContent, save: !document.getElementById("rouen-choose-go").disabled }; }
  function pick(name, value) { var r = document.querySelector('input[name="' + name + '"][value="' + value + '"]'); r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); }
`;

const DRIVER = SEEN + `
  if (window.__ss("loads") === 1) {
    await window.__sleep(600);
    var first = { at_load: seen() };
    pick("rouen-accounts", "no");
    first.one = seen().save;
    pick("rouen-native", "no");
    first.two = seen().save;
    var box = document.getElementById("rouen-choose-understood"); box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true }));
    first.ticked = seen().save;
    window.__ss("first", first);
    document.getElementById("rouen-choose-go").click();
    await window.__sleep(3000);                      // the reload comes first
    T("no_reload", true);
    return;
  }
  await window.__sleep(500);
  T("first", window.__ss("first"));
  T("posts", window.__ss("posts"));
  T("after", seen().open);
  document.getElementById("settings-toggle").click();
  await window.__sleep(300);
  var roon = document.querySelector('.settings-nav-item[data-pane="roon"]');
  T("native_row", !!roon && getComputedStyle(roon).display !== "none");
  document.querySelector('.settings-nav-item[data-pane="system"]').click();
  await window.__sleep(400);
  T("choices", document.getElementById("choices-status").textContent);
  T("account_block", vis("login-block"));
`;

test("THE one for the choice: a new install asks both before anything, Save only when both are answered and understood; then never again", async () => {
  if (!harness.available) return;
  const r = harness.renderPage({ name: "choices-new", windowSize: "390x844", budgetMs: 20000, stub: STUB_FOR("unchosen"), driver: DRIVER });
  harness.assertNoPageError(assert, r);
  assert.equal(r.no_reload, undefined, "the page did not reload once the choice was saved");
  const f = r.first;
  assert.deepEqual([f.at_load.open, f.at_load.choose, f.at_load.login], [true, true, false], "THE one: no choice sheet on a new install");
  assert.equal(f.at_load.save, false, "Save offered with nothing answered");
  assert.deepEqual([f.one, f.two, f.ticked], [false, false, true], "Save offered before both were answered and the box ticked");
  assert.deepEqual(r.posts, [{ accounts: false, native: false, understood: true }]);
  assert.equal(r.after, false, "the sheet came back after the choice was saved");
  assert.equal(r.choices, "User accounts: off. Native mode: not chosen.");
  assert.equal(r.account_block, false, "an Account section on a Rouen without accounts");
  assert.equal(r.native_row, false, "Native mode offered on a Rouen that didn't choose it");
});

const DRIVER_ACCOUNT = SEEN + `
  await window.__sleep(600);
  T("seen", seen());
`;

test("an install with an account: its login comes first, never the choice to a device that isn't logged in", async () => {
  if (!harness.available) return;
  const r = harness.renderPage({ name: "choices-account", windowSize: "390x844", budgetMs: 15000, stub: STUB_FOR("account"), driver: DRIVER_ACCOUNT });
  harness.assertNoPageError(assert, r);
  assert.deepEqual([r.seen.open, r.seen.login, r.seen.choose, r.seen.title], [true, true, false, "Log in to Rouen"]);
});

const DRIVER_LEGACY = SEEN + `
  await window.__sleep(1600);
  T("current", vis("rouen-choose-current"));
  T("label", document.getElementById("rouen-gate").getAttribute("aria-label"));
  T("labelledby", document.getElementById("rouen-gate").getAttribute("aria-labelledby"));
`;

test("the review: a v1.9.22 password install asks for that password, whichever answer comes first; the sheet has its own name", async () => {
  if (!harness.available) return;
  const r = harness.renderPage({ name: "choices-legacy", windowSize: "390x844", budgetMs: 15000, stub: STUB_FOR("legacy"), driver: DRIVER_LEGACY });
  harness.assertNoPageError(assert, r);
  assert.equal(r.current, true, "THE one: the password a v1.9.22 install needs was hidden for good");
  assert.deepEqual([r.label, r.labelledby], ["Choose how Rouen works", null], "a screen reader hears the login form's name");
});

const DRIVER_ELSEWHERE = SEEN + `
  if (window.__ss("loads") === 1) {
    await window.__sleep(600);
    window.__ss("state", "chosen");                  // made on another device
    await window.__sleep(5000);
    T("no_reload", true);
    return;
  }
  await window.__sleep(400);
  T("open", seen().open);
`;

test("the review: made on another device, a page showing the sheet starts afresh by itself", async () => {
  if (!harness.available) return;
  const r = harness.renderPage({ name: "choices-elsewhere", windowSize: "390x844", budgetMs: 20000, stub: STUB_FOR("unchosen"), driver: DRIVER_ELSEWHERE });
  harness.assertNoPageError(assert, r);
  assert.equal(r.no_reload, undefined, "THE one: the sheet stayed after the choice was made elsewhere");
  assert.equal(r.open, false);
});
