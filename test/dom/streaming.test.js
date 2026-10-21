"use strict";
// ---------------------------------------------------------------------------
// N2c-1 (public/streaming.js, v1.9.39, native-remote.md §10.3): TIDAL and
// Qobuz as Roon shows them, from the side menu's own entries. The server is
// stubbed with levels shaped as lib/provider/public/streaming.js answers
// (test/unit/streaming-browse.test.js holds the server to them).
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
const LEVELS = {
  "[]": { title: "TIDAL", count: 3, offset: 0, page: null, items: [
    { title: "What's New", subtitle: null, hint: "list", image_key: null, pos: 0 },
    { title: "Play My Mix", subtitle: null, hint: "action", image_key: null, pos: 1 },
    { title: "Your Favorites", subtitle: null, hint: "list", image_key: null, pos: 2 }] },
  '[["What\'s New",0]]': { title: "What's New", count: 3, offset: 0, page: null, items: [
    { title: "Dopamine Chamber", subtitle: "Fontaines D.C.", hint: "list", image_key: "k1", pos: 0 },
    { title: "Kid A", subtitle: "Radiohead", hint: "list", image_key: "k2", pos: 1 },
    { title: "expectations", subtitle: "Olivia Rodrigo", hint: "action_list", image_key: null, pos: 2 }] },
  '[["What\'s New",0],["Dopamine Chamber",0]]': { title: "Dopamine Chamber", count: 2, offset: 0, items: [], page: {
    kind: "album", menu: "Play Album", library_offset: null,
    self: { title: "Dopamine Chamber", subtitle: "Fontaines D.C.", hint: "list", image_key: "k1", pos: 0 },
    actions: [{ kind: "play_now", title: "Play Now" }, { kind: "play_next", title: "Add Next" }, { kind: "queue", title: "Queue" }, { kind: "radio", title: "Start Radio" }],
    tracks: [{ title: "1. Six Shot Morning", subtitle: "Fontaines D.C.", pos: 1 }, { title: "2. Marianne", subtitle: "Fontaines D.C.", pos: 2 }] } },
  '[["What\'s New",0],["Kid A",1]]': { title: "Kid A", count: 0, offset: 0, items: [], page: {
    kind: "album", menu: "Play Album", library_offset: 41,
    self: { title: "Kid A", subtitle: "Radiohead", hint: "list", image_key: "k2", pos: 1 },
    actions: [{ kind: "play_now", title: "Play Now" }], tracks: [] } },
  // Two of three shown, the rest under More (the review).
  '[["Your Favorites",2]]': { title: "Your Favorites", count: 3, offset: 0, page: null, items: [
    { title: "Mezzanine", subtitle: "Massive Attack", hint: "list", image_key: "k3", pos: 0 }] },
  '[["Your Favorites",2]]@1': { title: "Your Favorites", count: 3, offset: 1, page: null, items: [
    { title: "Blue Lines", subtitle: "Massive Attack", hint: "list", image_key: "k4", pos: 1 },
    { title: "Aphex Twin", subtitle: null, hint: "list", image_key: null, pos: 2 }] },
  // An artist's page: its menu, and the lists it holds beside it.
  '[["Your Favorites",2],["Aphex Twin",2]]': { title: "Aphex Twin", count: 2, offset: 0, items: [
    { title: "Albums", subtitle: null, hint: "list", image_key: null, pos: 1 }], page: {
    kind: "other", menu: "Play Artist", library_offset: null, shown: 2,
    self: { title: "Aphex Twin", subtitle: null, hint: "list", image_key: null, pos: 2 },
    actions: [{ kind: "shuffle", title: "Shuffle" }, { kind: "radio", title: "Start Radio" }], tracks: [] } },
};

const STUB = `
try { localStorage.setItem("rra-zone", "z1"); } catch (e) { /* storage optional */ }
window.__asked = []; window.__posts = []; window.__opened = [];
window.__installFetch(function (url, init) {
  if (url.indexOf("/api/streaming/level") > -1) {
    var q = new URL(url, location.href).searchParams;
    window.__asked.push({ service: q.get("service"), q: q.get("q"), path: q.get("path"), zone: q.get("zone_or_output_id") });
    if (q.get("service") === "search") return window.__json({ title: "Search", count: 1, offset: 0, page: null,
      items: [{ title: "Albums", subtitle: null, hint: "list", image_key: null, pos: 0 }] });
    var all = ${JSON.stringify(LEVELS)}, off = q.get("offset");
    var lv = off && off !== "0" ? all[q.get("path") + "@" + off] : all[q.get("path")];
    return lv ? window.__json(lv) : window.__json({ error: "gone" }, 404);
  }
  if (init && init.method === "POST" && url.indexOf("/api/streaming/") > -1) {
    window.__posts.push([url.replace(/^.*\\/api/, "/api"), JSON.parse(init.body)]);
    return window.__json({ invoked: "Play Now" });
  }
  if (url.indexOf("/api/settings/qobuz") > -1) return window.__json({ connected: true });
  if (url.indexOf("/api/settings/tidal") > -1) return window.__json({ connected: true });
  if (url.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (url.indexOf("/api/zones") > -1) return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (url.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (url.indexOf("/api/queue") > -1) return window.__json({ items: [], history: [] });
  if (url.indexOf("/api/random-albums") > -1) return window.__json({ albums: [], total: 0, filtered: false });
  if (url.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});`;

const DRIVER = `
  await window.__sleep(700);
  window.__openAlbum = function (a) { window.__opened.push(a); };
  var view = function () { return document.querySelector(".streaming-view"); };
  var texts = function (sel) { return Array.prototype.map.call((view() || document).querySelectorAll(sel), function (e) { return e.textContent.trim(); }); };
  document.getElementById("menu-toggle").click();
  await window.__sleep(200);
  document.getElementById("menu-item-tidal").click();
  await window.__sleep(500);
  T("top_rows", texts(".track-row .track-title"));
  T("top_has_search", !!(view() && view().querySelector("input[type=search]")));
  view().querySelector(".track-row").click();
  await window.__sleep(500);
  T("level_tiles", texts(".album .album-title"));
  T("level_art", Array.prototype.map.call(view().querySelectorAll(".album .album-art-wrap"), function (w) { return w.dataset.artKey; }));
  T("level_src", Array.prototype.map.call(view().querySelectorAll(".album img"), function (i) { return i.getAttribute("src"); }));
  T("level_rows", texts(".track-row .track-title"));
  T("level_order", Array.prototype.map.call(view().querySelector(".streaming-items").children, function (c) { return c.classList.contains("streaming-tiles") ? "tiles" : "rows"; }));
  view().querySelector(".track-row").click();          // a track on the level: played where it is
  await window.__sleep(200);
  view().querySelector(".album").click();              // Dopamine Chamber's page
  await window.__sleep(500);
  T("page_title", texts(".playlist-title"));
  T("page_sub", texts(".playlist-sub"));
  T("page_pills", texts(".playlist-actions .action-btn"));
  T("page_tracks", texts(".track-row .track-title"));
  T("page_menu", texts(".playlist-actions .overflow-menu .sel-menu-item"));
  view().querySelector(".playlist-actions .action-btn").click();   // Play Now, tapped twice before Roon answers: sent once
  view().querySelector(".playlist-actions .action-btn").click();
  await window.__sleep(200);
  view().querySelectorAll(".track-row")[1].click();                 // 2. Marianne
  await window.__sleep(200);
  T("posts", window.__posts);
  view().querySelector(".playlist-back").click();
  await window.__sleep(500);
  view().querySelectorAll(".album")[1].click();                    // Kid A, in the library
  await window.__sleep(500);
  var lib = Array.prototype.find.call(view().querySelectorAll("button"), function (b) { return /In your library/.test(b.textContent); });
  T("library_button", !!lib);
  if (lib) lib.click();
  await window.__sleep(100);
  T("opened", window.__opened);
  view().querySelector(".playlist-back").click();
  await window.__sleep(400);
  view().querySelector(".playlist-back").click();
  await window.__sleep(400);
  var input = view().querySelector("input[type=search]");
  input.value = "homogenic";
  view().querySelector("form").dispatchEvent(new Event("submit", { cancelable: true }));
  await window.__sleep(500);
  T("search_rows", texts(".track-row .track-title"));
  T("asked", window.__asked.slice());
  view().querySelector(".playlist-back").click();                   // the search, back to TIDAL
  await window.__sleep(400);
  view().querySelectorAll(".track-row")[1].click();                // Your Favorites
  await window.__sleep(500);
  T("fav_tiles", texts(".album .album-title"));
  var moreBtn = view().querySelector(".streaming-more");
  T("fav_more", !!moreBtn);
  if (moreBtn) moreBtn.click();
  await window.__sleep(500);
  T("fav_tiles_after", texts(".album .album-title"));
  T("fav_rows_after", texts(".track-row .track-title"));
  T("fav_more_after", !!view().querySelector(".streaming-more"));
  view().querySelector(".track-row").click();                      // Aphex Twin's page
  await window.__sleep(500);
  T("artist_pills", texts(".playlist-actions .action-btn"));
  T("artist_lists", texts(".streaming-items .track-title"));
`;

test("TIDAL from the side menu: Roon's sections, an album's page and its play, a library album opened in Rouen's own view, and Roon's search", async () => {
  if (!harness.available) return;
  const r = harness.renderPage({ name: "streaming", windowSize: "390x844", budgetMs: 20000, stub: STUB, driver: DRIVER });
  harness.assertNoPageError(assert, r);
  // Lists as rows; an action ("Play My Mix") is not offered.
  assert.deepEqual(r.top_rows, ["What's New", "Your Favorites"]);
  assert.equal(r.top_has_search, true);
  assert.deepEqual(r.level_tiles, ["Dopamine Chamber", "Kid A"]);
  assert.deepEqual(r.level_art, ["k1", "k2"]);
  // Served by Rouen's image route; here, with none, each <img> has removed itself and the key is what remains.
  assert.ok(r.level_src.every((src) => /^\/api\/image\/k[12]\?size=300$/.test(src)), JSON.stringify(r.level_src));
  assert.deepEqual(r.level_rows, ["expectations"]);
  assert.deepEqual(r.level_order, ["tiles", "rows"], "not in Roon's order");
  assert.deepEqual([r.page_title, r.page_sub], [["Dopamine Chamber"], ["Fontaines D.C."]]);
  // The album view's own row: Play Now and Queue on it, the rest behind ⋯ — and no Listen later of Rouen's.
  assert.deepEqual(r.page_pills, ["Play Now", "Queue"]);
  assert.deepEqual(r.page_menu, ["Play Next", "Radio"]);
  assert.deepEqual(r.page_tracks, ["1. Six Shot Morning", "2. Marianne"]);
  assert.deepEqual(r.posts, [
    ["/api/streaming/play-track", { service: "tidal", path: [["What's New", 0]], pos: 2, title: "expectations", kind: "play_now", zone_or_output_id: "z1" }],
    ["/api/streaming/play", { service: "tidal", path: [["What's New", 0], ["Dopamine Chamber", 0]], kind: "play_now", zone_or_output_id: "z1" }],
    ["/api/streaming/play-track", { service: "tidal", path: [["What's New", 0], ["Dopamine Chamber", 0]], pos: 2, title: "2. Marianne", kind: "play_now", zone_or_output_id: "z1" }],
  ]);
  assert.equal(r.library_button, true, "an album in the library not said so");
  assert.deepEqual(r.opened, [{ offset: 41, title: "Kid A", subtitle: "Radiohead", image_key: "k2" }]);
  assert.deepEqual(r.search_rows, ["Albums"]);
  // Read in the zone chosen, as a play from it walks it.
  assert.deepEqual(r.asked[r.asked.length - 1], { service: "search", q: "homogenic", path: "[]", zone: "z1" });
  assert.deepEqual([r.fav_tiles, r.fav_more], [["Mezzanine"], true]);
  assert.deepEqual([r.fav_tiles_after, r.fav_rows_after, r.fav_more_after], [["Mezzanine", "Blue Lines"], ["Aphex Twin"], false]);
  assert.deepEqual(r.artist_pills, ["Shuffle", "Radio"]);
  assert.deepEqual(r.artist_lists, ["Albums"], "an artist's lists dropped");
});
