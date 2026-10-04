"use strict";
// ---------------------------------------------------------------------------
// v1.8.77: tapping a Smart Pick goes somewhere.
//
// Asked for: "When in the smart picks screen and tapping on the album details
// or tapping on an album tile on smart picks carousel it should open to the
// album view screen if in the library and if not open to the preferred
// streaming service as set in share card."
//
// The same rule as a suggestion under the share card (v1.8.35): in the library
// it is the album; otherwise the device's default service — and on the full
// screen, which of the two is SAID before the tap.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const SERVICES = [
  { id: "qobuz",   name: "Qobuz",   url: "https://open.qobuz.com/album/q3" },
  { id: "spotify", name: "Spotify", url: "https://open.spotify.com/search/Further%20Flying%20Saucer%20Attack" },
];
const PICKS = [
  { kind: "adjacent", artist: "Labradford", album: "Mi Media Naranja",
    album_id: "q1", service: "qobuz", image: "", reason: "Because you play Stars of the Lid", genre: "",
    added: true, offset: 42, library_title: "Mi Media Naranja", library_subtitle: "Labradford",
    image_key: "k42", services: [] },
  { kind: "adjacent", artist: "Flying Saucer Attack", album: "Further",
    album_id: "q3", service: "qobuz", image: "", reason: "Because you play Bark Psychosis", genre: "",
    offset: null, services: SERVICES },
];
const ZONE = {
  zone_id: "z1", display_name: "Zone", state: "stopped", outputs: [],
  settings: { shuffle: false, loop: "disabled", auto_radio: false },
  now_playing: null,
};

function stub(opts) {
  opts = opts || {};
  const picks = opts.picks === undefined ? PICKS : opts.picks;
  const ready = opts.serviceReady === undefined ? true : opts.serviceReady;
  return `
var ZONE = ${JSON.stringify(ZONE)};
window.__favCalls = [];
window.__opened = [];
window.open = function (u) { window.__opened.push(String(u)); return null; };
try { localStorage.setItem("musicd-share-service", ${JSON.stringify(opts.pref || "")}); } catch (e) {}
window.__blockCalls = [];
window.__installFetch(function (url, init) {
  if (url.indexOf("/api/smart-picks/block") > -1) {
    window.__blockCalls.push(JSON.parse(init.body));
    return window.__json({ ok: true });
  }
  if (url.indexOf("/api/smart-picks") > -1)
    return window.__json({ day: "2026-08-04", service_ready: ${JSON.stringify(ready)},
                           picks: ${JSON.stringify(picks)} });
  if (url.indexOf("/favorite") > -1) {
    window.__favCalls.push({ url: url, body: JSON.parse(init.body) });
    return window.__json({ ok: true });
  }
  if (url.indexOf("/unfavorite") > -1) {
    window.__favCalls.push({ url: url, body: JSON.parse(init.body) });
    return window.__json({ ok: true });
  }
  if (url.indexOf("/api/library/albums") > -1)
    return window.__json({ albums: [], offset: 0, total: 0 });
  if (url.indexOf("/api/library/facets") > -1)
    return window.__json({ total: 0, facets: [], coverage: {}, hasPlays: false });
  if (url.indexOf("/api/random-albums") > -1)
    return window.__json({ albums: [], total: 0, filtered: false });
  if (url.indexOf("/api/zones") > -1)      return window.__json({ zones: [ZONE] });
  if (url.indexOf("/api/zone-state") > -1) return window.__json({ zone: ZONE });
  if (url.indexOf("/api/queue") > -1)      return window.__json({ items: [] });
  if (url.indexOf("/api/filters") > -1)    return window.__json({ genres: [] });
  if (url.indexOf("/api/home/") > -1)      return window.__json({ albums: [], label: null });
  if (url.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  if (url.indexOf("/api/version") > -1)    return window.__json({ version: "test" });
  if (url.indexOf("/api/settings") > -1)   return window.__json({});
  return undefined;
});
`;
}


const DRIVER = `
  await window.__sleep(600);
  var row = document.getElementById("home-picks");
  var cards = row.querySelectorAll(".pick-card");
  T("home_cards", cards.length);
  window.__opened = [];
  cards[1].click();
  await window.__sleep(200);
  T("home_service_open", window.__opened.slice());
  T("smart_screen_after_service", !!document.querySelector("#album-grid .pick-card-full"));

  window.__opened = [];
  cards[0].click();
  await window.__sleep(500);
  T("home_lib_calls", window.__calls.filter(function (u) { return u.indexOf("/api/album") > -1 && u.indexOf("42") > -1; }).length);
  T("home_lib_opened", window.__opened.length);
  var close = document.querySelector("#album-modal [data-close], .modal [data-close]");
  if (close) close.click();
  await window.__sleep(300);

  document.getElementById("menu-toggle").click();
  await window.__sleep(250);
  document.querySelector('.menu-item[data-action="smart-picks"]').click();
  await window.__sleep(600);
  var full = document.querySelectorAll("#album-grid .pick-card-full");
  T("full_opens", [].map.call(full, function (c) { var o = c.querySelector(".pick-opens"); return o ? o.textContent : null; }));
  window.__opened = [];
  full[1].querySelector(".pick-meta").click();
  full[1].querySelector(".pick-art").click();
  await window.__sleep(100);
  T("full_service_open", window.__opened.slice());
  // An action button still does its own job, not the open.
  window.__opened = [];
  var later = full[1].querySelector(".pick-later");
  if (later) later.click();
  await window.__sleep(100);
  T("button_opened", window.__opened.length);
  var before = window.__calls.length;
  full[0].querySelector(".pick-meta").click();
  await window.__sleep(500);
  T("full_lib_calls", window.__calls.slice(before).filter(function (u) { return u.indexOf("/api/album") > -1; }).length);
`;

for (const [pref, want] of [["", "qobuz"], ["spotify", "spotify"]]) {
  test("a Smart Pick opens the album, or the default service (" + (pref || "no default set") + ") (v1.8.77)", { skip: !harness.available && "no chromium" }, async (t) => {
    const R = harness.renderPage({ stub: stub({ picks: PICKS, pref }), driver: DRIVER, name: "picks-open-" + (pref || "none"), windowSize: "390x844" });
    harness.assertNoPageError(assert, R);
    const url = SERVICES.find(s => s.id === want).url;
    await t.test("Home tile: not in the library opens the service", () => {
      assert.equal(R.home_cards, 2);
      assert.deepEqual(R.home_service_open, [url]);
      assert.equal(R.smart_screen_after_service, false, "it opened the Smart Picks screen instead");
    });
    await t.test("Home tile: in the library opens the album view", () => {
      assert.ok(R.home_lib_calls >= 1, "the album view was not opened for the library pick");
      assert.equal(R.home_lib_opened, 0, "a library pick left the app");
    });
    await t.test("Smart Picks screen: cover and details open it, and say where first", () => {
      const name = SERVICES.find(s => s.id === want).name;
      assert.deepEqual(R.full_opens, ["In your library", "Opens in " + name + " \u2197"]);
      assert.deepEqual(R.full_service_open, [url, url]);
      assert.equal(R.button_opened, 0, "an action button opened the service");
      assert.ok(R.full_lib_calls >= 1, "the details of a library pick did not open the album view");
    });
  });
}
