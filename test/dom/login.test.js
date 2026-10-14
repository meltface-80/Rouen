"use strict";
// ---------------------------------------------------------------------------
// Rouen's password on the page (public/login.js, v1.9.22, dev/design/login.md):
// Settings → System, moved out of index.html, with its Password section; and
// the sheet a 401 { login: true } opens, after which the request goes again —
// in the real page, against stubbed answers.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const STUB = `
window.__posts = [];
window.__loggedIn = false;
window.__enabled = false;
window.__installFetch(function (u, init) {
  var post = init && init.method === "POST" ? JSON.parse(init.body || "{}") : null;
  if (post) window.__posts.push([u, post]);
  if (u.indexOf("/api/login/password") > -1) { window.__enabled = true; window.__loggedIn = true; return window.__json({ ok: true, enabled: true }); }
  if (u.indexOf("/api/login") > -1 && post) {
    if (post.password === "right password") { window.__loggedIn = true; return window.__json({ ok: true }); }
    return window.__json({ error: "That isn't Rouen's password." }, 401);
  }
  if (u.indexOf("/api/login") > -1) return window.__json({ enabled: window.__enabled, loggedIn: window.__loggedIn });
  if (u.indexOf("/api/settings/guarded") > -1) {
    return window.__loggedIn ? window.__json({ saved: true }) : window.__json({ error: "This needs Rouen's password.", login: true }, 401);
  }
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});`;

const DRIVER = `
  var st = document.createElement("style"); st.textContent = ".settings-sheet { animation: none !important; }";
  document.head.appendChild(st);
  document.getElementById("settings-toggle").click();
  await window.__sleep(300);
  var nav = document.querySelector('.settings-nav-item[data-pane="system"]');
  nav.click();
  await window.__sleep(400);
  var pane = document.querySelector('.settings-pane[data-pane="system"]');
  T("system", { shown: !pane.classList.contains("hidden"), panes: document.querySelectorAll('.settings-pane[data-pane="system"]').length,
    update: !!document.getElementById("check-update-btn"), status: document.getElementById("login-status").textContent,
    current: getComputedStyle(document.getElementById("login-current-row")).display === "none",
    remove: getComputedStyle(document.getElementById("login-remove")).display === "none" || getComputedStyle(document.getElementById("login-actions")).display === "none",
    save: document.getElementById("login-save").textContent });
  document.getElementById("login-new").value = "short";
  document.getElementById("login-again").value = "short";
  document.getElementById("login-save").click();
  await window.__sleep(100);
  T("short", { status: document.getElementById("login-status").textContent, posts: window.__posts.length });
  document.getElementById("login-new").value = "a good one!";
  document.getElementById("login-again").value = "a good one!";
  document.getElementById("login-save").click();
  await window.__sleep(300);
  T("set", { posts: JSON.stringify(window.__posts), status: document.getElementById("login-status").textContent,
    current: getComputedStyle(document.getElementById("login-current-row")).display === "none",
    save: document.getElementById("login-save").textContent });

  // A guarded request from a device not logged in: the sheet, then the request again.
  window.__loggedIn = false;
  var answer = fetch("/api/settings/guarded", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  await window.__sleep(200);
  var overlay = document.getElementById("login-overlay");
  T("asked", { open: !overlay.classList.contains("hidden") });
  document.getElementById("login-password").value = "wrong";
  document.getElementById("login-go").click();
  await window.__sleep(200);
  T("wrong", { open: !overlay.classList.contains("hidden"), error: document.getElementById("login-error").textContent });
  document.getElementById("login-password").value = "right password";
  document.getElementById("login-go").click();
  var r = await answer;
  T("retried", { status: r.status, body: await r.json(), open: !overlay.classList.contains("hidden"),
    guarded: window.__callsMatching("/api/settings/guarded") });

  // Cancelled: the screen gets the 401 as it came.
  window.__loggedIn = false;
  var answer2 = fetch("/api/settings/guarded", { method: "POST", body: "{}" });
  await window.__sleep(200);
  document.getElementById("login-cancel").click();
  var r2 = await answer2;
  T("cancelled", { status: r2.status, open: !overlay.classList.contains("hidden") });

  // A backup's download is a link the browser follows (app.js), not a fetch.
  nav.click();                                     // the page reads that this device is logged out
  await window.__sleep(300);
  var followed = [];
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[download]");
    if (a && !e.defaultPrevented) { followed.push(a.getAttribute("href") + (a.dataset.loginAsked ? " (after login)" : "")); e.preventDefault(); }
  });
  var link = document.createElement("a");
  link.href = "/api/backups/b1/download"; link.download = "b1.json";
  document.body.appendChild(link); link.click(); link.remove();
  await window.__sleep(200);
  var askedFirst = !overlay.classList.contains("hidden");
  document.getElementById("login-password").value = "right password";
  document.getElementById("login-go").click();
  await window.__sleep(300);
  T("download", { askedFirst: askedFirst, followed: followed });
`;

test("Settings → System and the password", async (t) => {
  const r = harness.renderPage({ name: "login", windowSize: "390x844", budgetMs: 15000, driver: DRIVER, stub: STUB });
  harness.assertNoPageError(assert, r);

  await t.test("System is there, once, as before, with Password under Updates", () => {
    assert.deepEqual([r.system.shown, r.system.panes, r.system.update], [true, 1, true], "THE one: the moved System page is missing or doubled");
    assert.match(r.system.status, /^No password: anyone on your network can change Rouen's settings\.$/);
    assert.equal(r.system.current, true, "THE one for the review: a current-password field shown with no password set");
    assert.equal(r.system.remove, true, "Remove password shown with no password set");
    assert.equal(r.system.save, "Set");
  });

  await t.test("setting one: too short refused on the page; then sent, and the section says On", () => {
    assert.deepEqual(r.short, { status: "At least 8 characters, please.", posts: 0 });
    assert.ok(r.set.posts.includes('["/api/login/password",{"password":"a good one!"}]'), r.set.posts);
    assert.match(r.set.status, /^Password set\./);
    assert.deepEqual([r.set.current, r.set.save], [false, "Change"]);
  });

  await t.test("THE one: a guarded request asks for the password, then goes again and succeeds", () => {
    assert.equal(r.asked.open, true, "no sheet: the screen got a 401 it can only show as an error");
    assert.deepEqual(r.wrong, { open: true, error: "That isn't Rouen's password." });
    assert.deepEqual(r.retried, { status: 200, body: { saved: true }, open: false, guarded: 2 });
  });

  await t.test("cancelled: the screen gets the 401 as it came", () => {
    assert.deepEqual(r.cancelled, { status: 401, open: false });
  });

  await t.test("a backup's download asks first, then follows the link — never saving the 401 as the file", () => {
    assert.equal(r.download.askedFirst, true, "THE one for the review: the browser followed the link to a 401");
    assert.deepEqual(r.download.followed, ["/api/backups/b1/download (after login)"]);
  });
});
