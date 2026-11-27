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
//
// 2.0.6-t14, the owner (2026-11-24): "Smart pick and share card suggestions
// don't open to the album screen of that album tapped on … You must make the
// share card and smart pick suggestions open to those albums that are shown …
// The album screens must be the uniform album screen for all albums in the grid
// screens." A pick opens THE album view for it, in the library or not
// (public/streaming.js find): not in it, by its title and artist, which the
// server finds by Roon's own search; its ⋯ adds it to the library; and where
// Roon's search can't name it, the view says so and offers that search. It had
// opened the search itself (2.0.6-t12), a list to choose from.
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
  { kind: "adjacent", artist: "Nobody", album: "Unnamed",
    album_id: "q9", service: "qobuz", image: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", reason: "Because you play Nothing", genre: "",
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
  if (url.indexOf("/api/album?") > -1) {
    var q = new URL(url, location.href).searchParams;
    if (q.get("title") === "Unnamed") return window.__json({ error: "Roon's official API doesn't list this album under the same title and artist, and its search didn't find it." }, 409);
    return window.__json({ album: { title: q.get("title"), subtitle: q.get("subtitle"), image_key: "roon-" + q.get("offset") },
      tracks: [{ title: "One", subtitle: "" }], actions: [{ kind: "play_now", title: "Play Now" }, { kind: "queue", title: "Queue" }],
      offset: Number(q.get("offset")) });
  }
  if (url.indexOf("/api/smart-picks") > -1)
    return window.__json({ day: "2026-08-04", service_ready: ${JSON.stringify(ready)},
                           picks: ${JSON.stringify(picks)} });
  // v1.9.41: + Add is one call, to the library (lib/library-add.js); answered here as today's way, a service favourite.
  if (url.indexOf("/api/library/add") > -1) {
    if (init && init.method === "POST") {
      window.__favCalls.push({ url: url, body: JSON.parse(init.body) });
      return window.__json({ ok: true, via: "service", state: "waiting", why: null });
    }
    if (window.__inLib) return window.__json({ state: "in-library", offset: 77, library_title: "Further", library_subtitle: "Flying Saucer Attack" });
    return window.__json({ state: "waiting", via: "service" });
  }
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
  window.__searched = [];
  window.RouenStreaming.search = function (s, q) { window.__searched.push([s, q]); };
  var modal = document.getElementById("album-modal");
  async function until(fn) { for (var i = 0; i < 200; i++) { if (fn()) return true; await window.__sleep(25); } return false; }
  /** The album view a tap opened: what it asked the server for, and what it shows. */
  async function opened(name, before) {
    await until(function () { return !modal.classList.contains("hidden") && document.querySelector("#album-modal .modal-actions button"); });
    await window.__sleep(150);
    T(name, { asked: window.__calls.slice(before).filter(function (u) { return u.indexOf("/api/album?") > -1; })
        .map(function (u) { var q = new URL(u, location.href).searchParams; return [Number(q.get("offset")), q.get("title"), q.get("subtitle")]; }),
      shown: !modal.classList.contains("hidden") && !modal.classList.contains("np-mode"),
      title: document.getElementById("modal-title").textContent,
      buttons: [].map.call(document.querySelectorAll("#album-modal .modal-actions > button, #album-modal .modal-actions .action-btn"), function (b) { return b.textContent; }),
      error: (function () { var e = document.querySelector("#album-modal .modal-error"); return e && e.firstChild ? e.firstChild.textContent : null; })() });
  }
  function closeAlbum() { if (window.__closeAlbum) window.__closeAlbum(); }

  var row = document.getElementById("home-picks");
  var cards = row.querySelectorAll(".pick-card");
  T("home_cards", cards.length);
  window.__opened = [];
  var before = window.__calls.length;
  cards[1].click();
  await opened("home_service", before);
  T("home_service_left", window.__opened.slice());
  T("home_searched", window.__searched.splice(0));
  T("smart_screen_after_service", !!document.querySelector("#album-grid .pick-card-full"));
  closeAlbum();
  await window.__sleep(200);

  before = window.__calls.length;
  cards[0].click();
  await opened("home_lib", before);
  T("home_lib_left", window.__opened.length);
  closeAlbum();
  await window.__sleep(300);

  document.getElementById("menu-toggle").click();
  await window.__sleep(250);
  document.getElementById("menu-overlay").classList.add("hidden"); window.__showSmartPicks();   // a menu item until v1.8.83
  await window.__sleep(600);
  var full = document.querySelectorAll("#album-grid .pick-card-full");
  T("full_opens", [].map.call(full, function (c) { var o = c.querySelector(".pick-opens"); return o ? o.textContent : null; }));
  window.__opened = [];
  before = window.__calls.length;
  full[1].querySelector(".pick-meta").click();
  await opened("full_meta", before);
  closeAlbum();
  await window.__sleep(200);
  before = window.__calls.length;
  full[1].querySelector(".pick-art").click();
  await opened("full_art", before);
  // Its ⋯: Add to library first, from the pick's service (lib/library-add.js), Roon's own play actions on the row.
  var more = document.querySelector("#album-modal .modal-actions .overflow-btn");
  if (more) more.click();
  await window.__sleep(150);
  var items = [].map.call(document.querySelectorAll("#album-modal .modal-actions .overflow-menu .sel-menu-item"), function (b) { return b; });
  T("menu", items.map(function (b) { return b.textContent; }));
  var addItem = items.filter(function (b) { return b.textContent === "Add to library"; })[0];
  window.__favCalls = [];
  window.__inLib = true;   // once added, the server has it in the library: the view reopens it there
  before = window.__calls.length;
  if (addItem) addItem.click();
  await window.__sleep(300);
  T("add_calls", window.__favCalls.map(function (c) { return c.body; }));
  await window.__sleep(3600);
  T("reopened", window.__calls.slice(before).filter(function (u) { return u.indexOf("/api/album?") > -1; })
    .map(function (u) { var q = new URL(u, location.href).searchParams; return [Number(q.get("offset")), q.get("title")]; }));
  T("reopened_menu", [].map.call(document.querySelectorAll("#album-modal .modal-actions .overflow-menu .sel-menu-item"), function (b) { return b.textContent; }));
  window.__inLib = false;
  T("full_left", window.__opened.slice());
  T("full_searched", window.__searched.splice(0));
  closeAlbum();
  await window.__sleep(200);

  // An action button still does its own job, not the open.
  var later = full[1].querySelector(".pick-later");
  before = window.__calls.length;
  if (later) later.click();
  await window.__sleep(150);
  T("button_opened", window.__calls.slice(before).filter(function (u) { return u.indexOf("/api/album?") > -1; }).length + window.__searched.length);

  // A pick Roon's search can't name: the view says so, and offers that search; it closes for it.
  before = window.__calls.length;
  full[2].querySelector(".pick-meta").click();
  await opened("unnamed", before);
  var offer = [].filter.call(document.querySelectorAll("#album-modal .modal-actions button"), function (b) { return /Search Roon/.test(b.textContent); })[0];
  T("offer_whole", offer ? { inError: !!offer.closest(".modal-error"), cut: offer.scrollWidth > offer.clientWidth + 1,
    w: Math.round(offer.getBoundingClientRect().width) } : null);
  if (offer) offer.click();
  await window.__sleep(200);
  T("unnamed_cover", document.getElementById("modal-img").getAttribute("src"));
  T("unnamed_searched", window.__searched.splice(0));
  T("unnamed_closed", modal.classList.contains("hidden"));
`;

// The default service decides which of Roon's (Qobuz, TIDAL) the album would be added from: Spotify set as the default
// still adds from Qobuz, the one of Roon's services the pick names.
for (const pref of ["", "spotify"]) {
  test("a Smart Pick opens its album view, in the library or not (" + (pref || "no default set") + ") (2.0.6-t14)", { skip: !harness.available && "no chromium" }, async (t) => {
    const R = harness.renderPage({ stub: stub({ picks: PICKS, pref }), driver: DRIVER, name: "picks-open-" + (pref || "none"), windowSize: "390x844" });
    harness.assertNoPageError(assert, R);
    const notIn = [999999, "Further", "Flying Saucer Attack"];
    await t.test("THE one — Home tile: not in the library, ITS album view, and nothing leaves the app or searches", () => {
      assert.equal(R.home_cards, 3);
      assert.deepEqual(R.home_service.asked, [notIn], "not the album view for this pick");
      assert.equal(R.home_service.shown, true);
      assert.equal(R.home_service.title, "Further");
      assert.deepEqual(R.home_service.buttons.slice(0, 2), ["Play Now", "Queue"], "Roon's own actions for it");
      assert.deepEqual(R.home_searched, [], "it searched instead of opening the album");
      assert.deepEqual(R.home_service_left, [], "a pick left the app");
      assert.equal(R.smart_screen_after_service, false, "it opened the Smart Picks screen instead");
    });
    await t.test("Home tile: in the library opens the album view at its place, under the library's strings", () => {
      assert.deepEqual(R.home_lib.asked, [[42, "Mi Media Naranja", "Labradford"]]);
      assert.equal(R.home_lib.shown, true);
      assert.equal(R.home_lib_left, 0, "a library pick left the app");
    });
    await t.test("Smart Picks screen: cover and details open the album view, and say so first", () => {
      assert.deepEqual(R.full_opens, ["In your library \u203a", "Open album \u203a", "Open album \u203a"]);
      assert.deepEqual(R.full_meta.asked, [notIn]);
      assert.deepEqual(R.full_art.asked, [notIn]);
      assert.deepEqual(R.full_left, []);
      assert.deepEqual(R.full_searched, []);
      assert.equal(R.button_opened, 0, "an action button opened the album or searched");
    });
    await t.test("its album view's ⋯ adds it to the library, from Roon's service the pick names", () => {
      assert.equal(R.menu[0], "Add to library");
      assert.deepEqual(R.add_calls, [{ title: "Further", artist: "Flying Saucer Attack", service: "qobuz", album_id: "q3" }],
        "not the pick's own service and album");
    });
    await t.test("once added, the view reopens it as the library's: at its place, nothing left to add", () => {
      assert.deepEqual(R.reopened, [[77, "Further"]]);
      assert.equal(R.reopened_menu.includes("Add to library"), false);
    });
    await t.test("a pick Roon's search can't name: the view says so and offers that search, which closes it", () => {
      assert.equal(R.unnamed.error, "Roon's search didn't find this album by its title and artist.");
      assert.equal(R.unnamed_cover, "data:image/gif;base64,R0lGODlhAQABAAAAACw=", "the pick's own picture, kept");
      assert.equal(R.unnamed_searched.length, 1);
      assert.deepEqual(R.unnamed_searched, [["qobuz", "Nobody Unnamed"]]);
      // The owner's screen (2026-11-24): the button beside the words was cut to "h Roon". Under them, whole.
      assert.equal(R.offer_whole.inError, true, "the offer sits beside the words, not under them");
      assert.equal(R.offer_whole.cut, false, "the offer's words are cut");
      assert.equal(R.unnamed_closed, true, "the album view stayed over the search");
    });
  });
}
