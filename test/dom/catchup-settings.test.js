"use strict";
// v1.9.72-t59: Settings → Setup → Catch-up (public/catchup.js; dev/design/android-app.md §4.22, slice 3c). The switch
// for Rouen's catch-up (POST /api/catchup) and how it is getting on (GET /api/catchup), as the server's
// lib/catchup/mount.js answers them; Rouen's server is faked here.

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const FETCH = `
window.__posted = [];
window.__cu = { enabled: false, waiting: 3, replaying: null, replayed: 0, dropped: 0, zone: null, recent: [],
  player: { running: false, connected: false, playing: false, elapsedMs: 0, log: [] }, zone_name: "Rouen catch-up" };
window.__installFetch(function (u, opts) {
  if (u.indexOf("/api/catchup") > -1) {
    if (opts && opts.method === "POST") {
      const b = JSON.parse(opts.body);
      window.__posted.push(b.enabled);
      if (window.__refuse) return window.__json({ error: "enabled: true or false, please" }, 400);
      window.__cu = Object.assign({}, window.__cu, { enabled: b.enabled });
    }
    return window.__json(window.__cu);
  }
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [] });
  return undefined;
});
`;

const DRIVER = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (id) => document.getElementById(id);
  T("listed", !!document.querySelector('.settings-pane[data-pane="setup"] .settings-nav-item[data-pane="catchup"]'));
  // Settings opened, as a person does, then Setup, then Catch-up.
  window.__openSettingsPane("setup");
  await sleep(20);
  document.querySelector('.settings-nav-item[data-pane="catchup"]').click();
  await sleep(50);
  T("off", [$("catchup-enabled").checked, $("catchup-status").textContent]);

  const sw = $("catchup-enabled");
  sw.checked = true; sw.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(50);
  T("onNotPaired", [window.__posted.slice(), sw.checked, $("catchup-status").textContent]);

  const show = async (patch) => {
    window.__cu = Object.assign({}, window.__cu, patch);
    // Back to Setup and in again: the page asks afresh as it comes on screen.
    document.querySelector('.settings-pane[data-pane="catchup"] [data-settings-back]').click();
    await sleep(20);
    document.querySelector('.settings-nav-item[data-pane="catchup"]').click();
    await sleep(50);
    return $("catchup-status").textContent;
  };
  T("joining", await show({ player: { running: true, connected: false, lastError: "connect ECONNREFUSED" } }));
  T("enableInRoon", await show({ player: { running: true, connected: true } }));
  T("replaying", await show({ zone: "1601", replaying: { album: "Low", track: "Speed of Life" } }));
  T("upToDate", await show({ replaying: null, waiting: 0, replayed: 3, dropped: 1, recent: [
    { album: "Low", track: "Sound and Vision", result: "replayed", why: null },
    { album: "<b>Heroes</b>", track: "Blackout", result: "dropped", why: "not in the library: <b>Heroes</b> by David Bowie" }] }));
  T("counts", [$("catchup-counts").textContent, $("catchup-counts").classList.contains("hidden")]);
  T("recent", [$("catchup-recent-block").classList.contains("hidden"), Array.from($("catchup-recent").children).map((li) => li.textContent),
    $("catchup-recent").querySelectorAll("b").length]);

  window.__refuse = true;
  sw.checked = false; sw.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(50);
  T("refused", [sw.checked, sw.disabled, $("catchup-status").textContent]);
  window.__refuse = false;

  // Polled every 2 s while a play is replayed — and not at all once Settings is closed.
  await show({ replaying: { album: "Low", track: "Warszawa" }, waiting: 1 });
  await sleep(2300);
  const polled = window.__callsMatching("/api/catchup");
  document.querySelector("[data-settings-close]").click();
  await sleep(2500);
  T("closed", [polled > 2, window.__callsMatching("/api/catchup") - polled]);

  // Opened straight to the page (as HQPWeb's "Open Settings → …" does), it asks at once.
  const before = window.__callsMatching("/api/catchup");
  window.__openSettingsPane("catchup");
  await sleep(50);
  T("direct", [window.__callsMatching("/api/catchup") - before, $("catchup-status").textContent]);
`;

test("Setup → Catch-up: off by default; switched on, it says each step to Roon counting This phone's plays (§4.22)", () => {
  const r = harness.renderPage({ stub: FETCH, driver: DRIVER, name: "catchup-settings" });
  harness.assertNoPageError(assert, r);
  assert.equal(r.listed, true);
  assert.deepEqual(r.off, [false, "Off: This phone's plays reach neither Roon nor Last.fm. 3 plays are kept for when it is switched on."]);
  assert.deepEqual(r.onNotPaired, [[true], true, "Waiting for Rouen to be paired with your Roon Core. 3 plays wait to be replayed."]);
  assert.equal(r.joining, "Joining your Roon Core… (connect ECONNREFUSED) 3 plays wait to be replayed.");
  assert.equal(r.enableInRoon, "“Rouen catch-up” has joined Roon. Enable it once in Roon: Settings → Audio, where it is listed under Squeezebox, then Enable. 3 plays wait to be replayed.");
  // The play being replayed is one of the three waiting: two more after it.
  assert.equal(r.replaying, "Replaying “Speed of Life” (Low) to Roon… 2 more plays wait to be replayed.");
  assert.equal(r.upToDate, "Up to date: every play from This phone has reached Roon.");
  assert.deepEqual(r.counts, ["Since Rouen started: 3 plays replayed, 1 dropped (Lately says why).", false]);
  // Album and track names are the user's own: shown as text, never as markup.
  assert.deepEqual(r.recent, [false, ["“Sound and Vision” (Low): replayed",
    "“Blackout” (<b>Heroes</b>): dropped — not in the library: <b>Heroes</b> by David Bowie"], 0]);
  // Refused, the switch goes back to what it was and says why.
  assert.deepEqual(r.refused, [true, false, "enabled: true or false, please"]);
  // Closed, it asks no more (it used to go on polling Rouen for as long as the app ran).
  assert.deepEqual(r.closed, [true, 0]);
  assert.deepEqual(r.direct, [1, "Replaying “Warszawa” (Low) to Roon…"]);
});
