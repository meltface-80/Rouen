"use strict";
// v1.9.72-t10: Settings → Setup → Away from home → This phone (public/away.js; dev/design/android-app.md §4.7), in the
// Rouen app only — the owner: "Mandarin logs the server in and then I add the app/phone". The phone's own built-in
// Tailscale, through the app's bridge (window.RouenPhone, faked here: the app's is not testable here).

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const FETCH = `
window.__installFetch(function (u) {
  if (u.indexOf("/api/tailscale") > -1) return window.__json({ available: true, enabled: true, running: true, state: "Running",
    address: "http://100.90.1.2:3399", dns_name: "rouen.tail1.ts.net", hostname: "rouen", online: true, away: false });
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [] });
  if (u.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});
`;

const BRIDGE = `
window.__asked = [];
window.__ts = { installed: true, on: true, signedIn: false, canSignOut: false, hostname: "rouen-a142", text: "Needs sign-in.",
  way: "Now: at home.\\nRouen's tailnet address: http://100.90.1.2:3399." };
window.RouenPhone = {
  settings: function () { return JSON.stringify({ homeQuality: "opus", awayQuality: "opus", network: "home", places: [] }); },
  set: function () { return "{}"; },
  tailscale: function () { return JSON.stringify(window.__ts); },
  tailscaleLook: function () { window.__asked.push("look"); return "{}"; },
  tailscaleSignIn: function () { window.__asked.push("signIn"); window.__ts = Object.assign({}, window.__ts, { text: "Asking Tailscale for a sign-in link…" }); return JSON.stringify(window.__ts); },
  tailscaleSignOut: function () { window.__asked.push("signOut"); return "{}"; },
  tailscaleUse: function (on) { window.__asked.push("use " + on); window.__ts = Object.assign({}, window.__ts, { on: on === "true" }); return JSON.stringify(window.__ts); }
};
`;

const DRIVER = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const box = document.getElementById("away-phone");
  T("shown", !!box && !box.classList.contains("hidden"));
  if (!box || box.classList.contains("hidden")) return;
  // Settings opened first, as a person does: since v1.9.72-t62 the page asks only while it is on screen.
  window.__openSettingsPane("setup");
  await sleep(20);
  document.querySelector('.settings-nav-item[data-pane="away"]').click();
  await sleep(50);
  T("opened", [document.getElementById("away-phone-host").textContent, document.getElementById("away-phone-status").textContent,
    document.getElementById("away-phone-login").disabled, document.getElementById("away-phone-logout").disabled, window.__asked.slice()]);
  document.getElementById("away-phone-login").click();
  await sleep(20);
  T("signingIn", [document.getElementById("away-phone-status").textContent, window.__asked.slice(-1)[0]]);
  window.__ts = Object.assign({}, window.__ts, { signedIn: true, canSignOut: true, text: "Connected as rouen-a142.tail1.ts.net" });
  window.__rouenPhoneChanged();
  T("signedIn", [document.getElementById("away-phone-status").textContent, document.getElementById("away-phone-login").disabled,
    document.getElementById("away-phone-logout").disabled]);
  const sw = document.getElementById("away-phone-on");
  sw.checked = false; sw.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(20);
  T("off", [window.__asked.slice(-1)[0], sw.checked]);
`;

test("in the app: This phone — its own Tailscale, signed in from Rouen's page with the same account (§4.7)", () => {
  const r = harness.renderPage({ stub: FETCH + BRIDGE, driver: DRIVER, name: "away-phone" });
  harness.assertNoPageError(assert, r);
  assert.equal(r.shown, true);
  assert.deepEqual(r.opened, ["“rouen-a142”", "Needs sign-in.", false, true, ["look"]]);
  assert.deepEqual(r.signingIn, ["Asking Tailscale for a sign-in link…", "signIn"]);
  assert.deepEqual(r.signedIn, ["Connected as rouen-a142.tail1.ts.net", true, false]);
  assert.deepEqual(r.off, ["use false", false]);
});

test("in a browser (no bridge): Away from home is the server's alone", () => {
  const r = harness.renderPage({ stub: FETCH, driver: `const b = document.getElementById("away-phone"); T("hidden", !!b && b.classList.contains("hidden"));`, name: "away-phone-browser" });
  harness.assertNoPageError(assert, r);
  assert.equal(r.hidden, true);
});

// v1.9.72-t62: closed, Away from home asks no more. It asked Rouen (/api/tailscale) every 3 s, and the app's
// Tailscale every 3 s, for as long as the app ran once the page had been opened, because it only stopped when its own
// pane was hidden — and closing Settings hides the sheet, not the pane. (The same flaw catchup.js fixed in t59.)
const POLL = `
window.__installFetch(function (u) {
  if (u.indexOf("/api/tailscale") > -1) return window.__json({ available: true, enabled: true, running: true, state: "NeedsLogin", away: false });
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [] });
  if (u.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});
`;
const CLOSE = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__openSettingsPane("setup");
  await sleep(20);
  document.querySelector('.settings-nav-item[data-pane="away"]').click();
  await sleep(3300);
  const asked = window.__callsMatching("/api/tailscale"), looked = window.__asked.filter((a) => a === "look").length;
  document.querySelector("[data-settings-close]").click();
  await sleep(3500);
  T("open", [asked >= 2, looked >= 2]);
  T("closed", [window.__callsMatching("/api/tailscale") - asked, window.__asked.filter((a) => a === "look").length - looked]);
  const before = window.__callsMatching("/api/tailscale");
  window.__openSettingsPane("away");
  await sleep(50);
  T("direct", window.__callsMatching("/api/tailscale") - before);
`;

test("closed, Away from home stops asking Rouen and the app; opened straight to it, it asks at once", () => {
  const r = harness.renderPage({ stub: POLL + BRIDGE, driver: CLOSE, name: "away-closed" });
  harness.assertNoPageError(assert, r);
  assert.deepEqual(r.open, [true, true], "while open it asks again every few seconds");
  assert.deepEqual(r.closed, [0, 0], "Settings closed, it went on asking Rouen and the app's Tailscale");
  assert.equal(r.direct, 1, "opened straight to the page (window.__openSettingsPane), it did not ask");
});

// The owner's screen, 2026-11-10: Rouen out of reach from the phone (the app's offline copy of the page answers
// /api/tailscale 503, offline.js), and Away from home said "Tailscale is not in this install" while Rouen's was running.
const UNREACHABLE = `
window.__installFetch(function (u) {
  if (u.indexOf("/api/tailscale") > -1) return window.__json({ error: "Rouen can't be reached." }, 503);
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [] });
  if (u.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});
`;
test("Rouen out of reach: said so, never \"not in this install\"; its controls off; this phone's part still works", () => {
  const r = harness.renderPage({ stub: UNREACHABLE + BRIDGE, name: "away-unreachable", driver: `
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    window.__openSettingsPane("setup");
    await sleep(20);
    document.querySelector('.settings-nav-item[data-pane="away"]').click();
    await sleep(80);
    T("server", [document.getElementById("away-status").textContent, document.getElementById("away-enabled").disabled,
      document.getElementById("away-login").disabled, document.getElementById("away-logout").disabled]);
    T("phone", [document.getElementById("away-phone-status").textContent, document.getElementById("away-phone-login").disabled]);
  ` });
  harness.assertNoPageError(assert, r);
  assert.deepEqual(r.server, ["Rouen can't be reached from here right now, so its own Tailscale can't be read. This phone's part, below, works without it.", true, true, true]);
  assert.doesNotMatch(r.server[0], /not in this install/);
  assert.deepEqual(r.phone, ["Needs sign-in.", false], "this phone's sign-in needs no Rouen");
});

// The review of 2.0.3-t18: Rouen answering with a refusal of its own (a login run out, 401) is not out of reach.
test("Rouen refusing (401) is said as Rouen says it, not as out of reach", () => {
  const stub = UNREACHABLE.replace(`window.__json({ error: "Rouen can't be reached." }, 503)`, `window.__json({ error: "Log in to Rouen first." }, 401)`);
  assert.notEqual(stub, UNREACHABLE);
  const r = harness.renderPage({ stub: stub + BRIDGE, name: "away-refused", driver: `
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    window.__openSettingsPane("setup");
    await sleep(20);
    document.querySelector('.settings-nav-item[data-pane="away"]').click();
    await sleep(80);
    T("server", document.getElementById("away-status").textContent);
  ` });
  harness.assertNoPageError(assert, r);
  assert.equal(r.server, "Log in to Rouen first.");
});
