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
  document.querySelector('.settings-nav-item[data-pane="setup"]').click();
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
