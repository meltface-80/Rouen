"use strict";
// ---------------------------------------------------------------------------
// v1.7.20: a disconnected streaming service must leave no way in.
//
// Qobuz was gated on ONE thing — the Disconnect button in Settings. The top-bar
// button and the side-menu entry were never touched, and loadQobuzStatus() was
// never called at boot, so after logging out of Qobuz the browser stayed one
// tap away from an account that no longer existed and every catalogue call
// behind it threw "Qobuz not connected".
//
// Tidal had the gating from the start (it was built second). This test holds
// BOTH services to the same rule, in both directions, so the next service
// cannot be added with half the wiring either.
//
// Since v1.9.43 (the owner: "native access without additional logging in to
// Rouen TIDAL and Qobuz") the rule was the top bar's alone — Rouen's own service
// browsers, which needed its sign-in. The side menu's TIDAL and Qobuz entries
// open them through your server (streaming.js), and follow what your server
// offers (GET /api/streaming/services), whatever Rouen's sign-in.
//
// Since v1.9.72-t77 (the owner, 2026-11-02: "Services from tidal and Qobuz
// logins are still showing in the app. You must remove these and their code";
// the sign-ins kept for waveforms only) Rouen's own browsers are gone, and with
// them the top-bar buttons: there is no way in through Rouen's sign-in, signed
// in or not. What this holds now is that no top-bar button comes back, in any
// state, and that the side menu still follows your server alone.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const ZONE = {
  zone_id: "z1", display_name: "Living Room", state: "stopped",
  settings: { shuffle: false, loop: "disabled", auto_radio: false },
  outputs: [{ output_id: "o1", display_name: "Living Room", is_muted: false, volume: null }],
  now_playing: null,
};

function stub(qobuzConnected, tidalConnected, offered = ["tidal", "qobuz"]) {
  return `
window.__installFetch(function (url) {
  if (url.indexOf("/api/streaming/services") > -1) return window.__json({ services: ${JSON.stringify(offered)} });
  if (url.indexOf("/api/settings/qobuz") > -1)
    return window.__json({ connected: ${qobuzConnected}, displayName: "Someone" });
  if (url.indexOf("/api/settings/tidal") > -1)
    return window.__json({ connected: ${tidalConnected}, displayName: "Someone" });
  if (url.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (url.indexOf("/api/zones") > -1)      return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (url.indexOf("/api/queue") > -1)      return window.__json({ items: [] });
  if (url.indexOf("/api/filters") > -1)    return window.__json({ genres: [] });
  if (url.indexOf("/api/home/") > -1)      return window.__json({ albums: [], label: null });
  if (url.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  if (url.indexOf("/api/settings") > -1)   return window.__json({});
  if (url.indexOf("/api/random-albums") > -1)
    return window.__json({ albums: [], total: 0, filtered: false });
  return undefined;
});
`;
}

// Read WITHOUT opening Settings: the side menu must follow your server from the
// start, and nothing may put a top-bar button back on the way.
const DRIVER = `
  await window.__sleep(700);
  function shown(id) {
    var el = document.getElementById(id);
    return el ? !el.classList.contains("hidden") : null;
  }
  T("qobuz_topbar", shown("qobuz-toggle"));
  T("qobuz_menu",   shown("menu-item-qobuz"));
  T("tidal_topbar", shown("tidal-toggle"));
  T("tidal_menu",   shown("menu-item-tidal"));
  T("own_overlays", ["qobuz-overlay", "tidal-overlay"].filter(function (id) { return !!document.getElementById(id); }));

  // And the entry must not merely be invisible — it must be absent from the
  // menu a user actually reads.
  document.getElementById("menu-toggle").click();
  await window.__sleep(200);
  T("visible_menu_labels", Array.prototype.filter.call(
    document.querySelectorAll(".menu-drawer .menu-item"),
    function (b) { return !b.classList.contains("hidden"); })
    .map(function (b) { return (b.querySelector("span") || {}).textContent || ""; }));
`;

test("no way into Rouen's own service browsers; the side menu follows your server (v1.7.20, v1.9.72-t77)", { concurrency: 1 }, async (t) => {
  if (!harness.available) {
    t.skip("no chromium binary available");
    return;
  }

  const off = harness.renderPage({
    stub: stub(false, false), driver: DRIVER, name: "service-gating-off", windowSize: "390x844",
  });
  harness.assertNoPageError(assert, off);

  await t.test("logged out of both: no top-bar buttons and no own browser at all", () => {
    assert.equal(off.qobuz_topbar, null, "Rouen's own Qobuz button is back");
    assert.equal(off.tidal_topbar, null, "Rouen's own TIDAL button is back");
    assert.deepEqual(off.own_overlays, []);
  });

  await t.test("logged out of both: the side-menu entries stay — they are your server's (v1.9.43)", () => {
    assert.equal(off.qobuz_menu, true,
      "the owner, v1.9.42: signed out of Rouen's own, TIDAL and Qobuz went from the side menu");
    assert.equal(off.tidal_menu, true);
    assert.ok(off.visible_menu_labels.includes("Qobuz"));
    assert.ok(off.visible_menu_labels.includes("Tidal"));
  });

  await t.test("the side menu is read at boot, not on opening Settings", () => {
    // The driver never opens Settings.
    // (Home has no menu entry since v1.8.83 — Playlists is always listed.)
    assert.ok(off.visible_menu_labels.includes("Playlists"),
      "sanity: the drawer rendered, so the assertions above mean something");
  });

  const on = harness.renderPage({
    stub: stub(true, true), driver: DRIVER, name: "service-gating-on", windowSize: "390x844",
  });
  harness.assertNoPageError(assert, on);

  await t.test("signed in to both: still no top-bar buttons — the sign-ins are for waveforms only (v1.9.72-t77)", () => {
    assert.equal(on.qobuz_topbar, null, "THE one: Rouen's own Qobuz button comes back with its sign-in");
    assert.equal(on.tidal_topbar, null, "Rouen's own TIDAL button comes back with its sign-in");
    assert.deepEqual(on.own_overlays, []);
  });

  await t.test("signed in to both: both services are reachable through your server", () => {
    assert.equal(on.qobuz_menu, true);
    assert.equal(on.tidal_menu, true);
    assert.ok(on.visible_menu_labels.includes("Qobuz"));
    assert.ok(on.visible_menu_labels.includes("Tidal"));
  });

  const mixed = harness.renderPage({
    stub: stub(false, true, ["qobuz"]), driver: DRIVER, name: "service-gating-mixed", windowSize: "390x844",
  });
  harness.assertNoPageError(assert, mixed);

  await t.test("each side-menu entry on what your server offers, whatever Rouen's sign-in", () => {
    assert.equal(mixed.qobuz_topbar, null);
    assert.equal(mixed.tidal_topbar, null);
    assert.equal(mixed.qobuz_menu, true, "Qobuz, which your server offers, hidden for Rouen's sign-in");
    assert.equal(mixed.tidal_menu, false, "TIDAL, which your server doesn't offer, shown for Rouen's sign-in");
  });
});
