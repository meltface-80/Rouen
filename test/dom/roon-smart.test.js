"use strict";
// ---------------------------------------------------------------------------
// N2e-1's page side (public/playlists-native.js, v1.9.51, native-remote.md
// §12.3): with native mode on, Roon's smart playlists come after Rouen's own
// Dynamic Playlists under "In Roon"; one opens on its tracks, 100 at a time
// with More, and Play / Shuffle post the whole playlist to the zone chosen in
// Rouen; the Playlists screen leaves out the Roon playlists that are smart.
// Native mode off: both screens as before. The server is stubbed as
// lib/routes/smart-roon.js answers (smart-roon-routes.test.js holds it).
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
const page = (n) => ({ name: "r&b random", count: 150, page: n, pages: 2, complete: n === 0,
  items: n === 0 ? [{ title: "Rumours 1", artist: "Fleetwood Mac", album: "Rumours" }, { arrived: false }]
    : [{ title: "Rumours 27", artist: "Fleetwood Mac", album: "Rumours" }] });

const stubFor = (native, rouen = true) => `
try { localStorage.setItem("rra-zone", "z1"); } catch (e) { /* storage optional */ }
window.__plays = []; window.__pages = [];
window.__installFetch(function (url, init) {
  var post = init && init.method === "POST" ? JSON.parse(init.body || "{}") : null;
  if (url.indexOf("/api/roon-smart/play") > -1) {
    window.__plays.push(post);
    return window.__plays.length === 1 ? window.__json({ ok: true, by: "id" })
      : window.__json({ error: "Your server took it, but the zone didn't start playing.", sent: true }, 502);
  }
  if (url.indexOf("/api/roon-smart/items") > -1) {
    var n = Number((url.match(/page=(\\d+)/) || [0, 0])[1]);
    window.__pages.push(n);
    return window.__json(n === 0 ? ${JSON.stringify(page(0))} : ${JSON.stringify(page(1))});
  }
  if (url.indexOf("/api/roon-smart") > -1) return window.__json(${native
    ? `{ available: true, playlists: [{ id: "ef56", name: "Folk", tracks: 2813, images: [], moved: true }, { id: "cd34", name: "Chill", tracks: 40, images: ["c1", "c2", "c3"] }, { id: "ab12", name: "r&b random", tracks: 5007, images: ["r1"] }] }` : `{ available: false, why: "" }`});
  if (url.indexOf("/api/roon-playlists") > -1) return window.__json({ available: false, why: "" });
  if (url.indexOf("/api/smart-playlists") > -1) return window.__json({ playlists: ${rouen ? `[{ id: "sp1", name: "Nineties", album_total: 3, art_keys: [], mode: "albums", view: {} }]` : "[]"} });
  if (url.indexOf("/api/user-playlists") > -1) return window.__json({ playlists: [] });
  if (url.indexOf("/api/playlists") > -1) return window.__json({ playlists: [{ offset: 0, title: "Morning", subtitle: "3 Tracks", image_key: null },
    { offset: 1, title: "Chill", subtitle: "12 Tracks", image_key: null }, { offset: 2, title: "r&b random", subtitle: "5007 Tracks", image_key: null }], total: 3 });
  if (url.indexOf("/api/playlist/art") > -1) return window.__json({ art_keys: [] });
  if (url.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (url.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (url.indexOf("/api/zones") > -1) return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (url.indexOf("/api/queue") > -1) return window.__json({ items: [], history: [] });
  if (url.indexOf("/api/random-albums") > -1) return window.__json({ albums: [], total: 0, filtered: false });
  if (url.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});`;

const DRIVER = `
  await window.__sleep(600);
  var texts = function (sel) { return Array.prototype.map.call(document.querySelectorAll(sel), function (e) { return e.textContent; }); };
  var menu = function (action) { document.getElementById("menu-toggle").click(); return window.__sleep(200).then(function () { document.querySelector('[data-action="' + action + '"]').click(); }); };
  await menu("smart-playlists");
  await window.__sleep(600);
  T("heads", texts("#album-grid .roon-smart-head"));
  // v1.9.61 (§12.16): the grid in its order — a moved one among Rouen's own, before "In Roon".
  T("order", Array.prototype.map.call(document.querySelectorAll("#album-grid .album .album-title, #album-grid .roon-smart-head"), function (e) { return e.textContent; }));
  T("titles", texts("#album-grid .album .album-title"));
  T("subs", texts("#album-grid .album .album-artist"));
  var tiles = document.querySelectorAll("#album-grid .album");
  var roon = tiles[tiles.length - 1];
  // v1.9.59: each Roon tile's cover art, as the tile was given it — a mosaic's keys, one key, or none.
  T("art", Array.prototype.slice.call(tiles, -2).map(function (t) {
    var w = t.querySelector(".album-art-wrap");
    return w.dataset.artKeys || w.dataset.artKey || (w.classList.contains("no-image") ? "none" : "?");
  }));
  if (texts("#album-grid .roon-smart-head").length) {
    roon.click();
    await window.__sleep(600);
    T("title", texts(".playlist-detail .playlist-title"));
    T("rows", texts(".playlist-tracks .track-row"));
    T("status", texts(".playlist-detail .playlist-empty"));
    var more = document.querySelector(".playlist-more");
    T("moreShown", !!more && !more.classList.contains("hidden"));
    more.click();
    await window.__sleep(500);
    T("rows2", document.querySelectorAll(".playlist-tracks .track-row").length);
    T("moreAfter", more.classList.contains("hidden"));
    T("status2", texts(".playlist-detail .playlist-empty"));
    var btns = Array.prototype.filter.call(document.querySelectorAll(".playlist-actions button"), function (b) { return /^(Play|Shuffle)$/.test(b.textContent); });
    T("buttons", btns.map(function (b) { return b.textContent; }));
    btns[0].click();
    await window.__sleep(400);
    T("toast1", texts(".toast").pop() || (document.getElementById("toast") || {}).textContent || "");
    btns[1].click();
    await window.__sleep(400);
    T("toast2", texts(".toast").pop() || (document.getElementById("toast") || {}).textContent || "");
    T("plays", window.__plays.slice());
    T("pages", window.__pages.slice());
    document.querySelector(".playlist-back").click();
    await window.__sleep(600);
    T("backTitles", texts("#album-grid .album .album-title"));
  }
  await menu("playlists");
  await window.__sleep(800);
  T("playlists", texts("#album-grid .album .album-title"));
`;

test("native mode on: Roon's smart playlists under Dynamic Playlists, opened a page at a time, played and shuffled; left out of Playlists", async () => {
  if (!harness.available) return;
  const r = harness.renderPage({ name: "roon-smart", windowSize: "390x844", budgetMs: 20000, stub: stubFor(true), driver: DRIVER });
  harness.assertNoPageError(assert, r);
  assert.deepEqual(r.heads, ["In Roon"]);
  assert.deepEqual(r.titles.slice(-3), ["Folk", "Chill", "r&b random"]);
  assert.deepEqual(r.order.slice(-5), ["Nineties", "Folk", "In Roon", "Chill", "r&b random"], "a moved playlist not where Rouen's own stood (§12.16)");
  assert.equal(r.subs[r.subs.length - 1], "5007 Tracks");
  assert.deepEqual(r.art, ["c1,c2,c3", "r1"], "Roon's tiles without their cover art (v1.9.59)");
  assert.deepEqual(r.title, ["r&b random"]);
  assert.equal(r.rows.length, 2);
  assert.match(r.rows[0], /Rumours 1.*Fleetwood Mac · Rumours/);
  assert.match(r.rows[1], /Not sent in time/);
  assert.match(r.status[0], /2 of 150 tracks shown · 1 didn't arrive/);
  assert.equal(r.moreShown, true);
  assert.equal(r.rows2, 3);
  assert.equal(r.moreAfter, true, "More offered past the last page");
  assert.match(r.status2[0], /3 of 150 tracks shown · Play and Shuffle play them all/);
  assert.deepEqual(r.buttons, ["Play", "Shuffle"]);
  assert.deepEqual(r.plays, [{ id: "ab12", zone_or_output_id: "z1", shuffle: false }, { id: "ab12", zone_or_output_id: "z1", shuffle: true }]);
  assert.match(r.toast1, /Playing "r&b random"/);
  assert.match(r.toast2, /didn't start playing/);
  assert.deepEqual(r.pages, [0, 1]);
  assert.deepEqual(r.backTitles.slice(-4), ["Nineties", "Folk", "Chill", "r&b random"]);
  // "Chill" of 12 tracks only shares a smart playlist's name (40 tracks): it stays (the review).
  assert.deepEqual(r.playlists, ["Morning", "Chill"], "a smart playlist still listed as a Playlists row, or one only sharing its name left out");
});

test("native mode off: Dynamic Playlists and Playlists as before", async () => {
  if (!harness.available) return;
  const r = harness.renderPage({ name: "roon-smart-off", windowSize: "390x844", budgetMs: 20000, stub: stubFor(false), driver: DRIVER });
  harness.assertNoPageError(assert, r);
  assert.deepEqual(r.heads, []);
  assert.equal(r.titles[r.titles.length - 1], "Nineties");
  assert.deepEqual(r.playlists, ["Morning", "Chill", "r&b random"]);
});

test("v1.9.61 (§12.16): every Dynamic Playlist moved to Roon — their tiles, and no \"No Dynamic Playlists yet\"", async () => {
  if (!harness.available) return;
  const driver = `
  await window.__sleep(600);
  document.getElementById("menu-toggle").click();
  await window.__sleep(200);
  document.querySelector('[data-action="smart-playlists"]').click();
  await window.__sleep(900);
  var b = document.getElementById("status-banner");
  T("banner", b && !b.classList.contains("hidden") ? b.textContent : "");
  T("titles", Array.prototype.map.call(document.querySelectorAll("#album-grid .album .album-title"), function (e) { return e.textContent; }));
`;
  const r = harness.renderPage({ name: "roon-smart-moved", windowSize: "390x844", budgetMs: 20000, stub: stubFor(true, false), driver });
  harness.assertNoPageError(assert, r);
  assert.deepEqual(r.titles.slice(-3), ["Folk", "Chill", "r&b random"]);
  assert.equal(r.banner, "", "the empty banner shown above the moved playlists");
});
