"use strict";
// ---------------------------------------------------------------------------
// v2.0.3-t12: a playlist's page, left for an artist's page and come back to, works as it did before it was left.
//
// The artist page takes the shared grid and puts the screen it came from back on Back — its nodes, its scroll, its
// title. But on the way in it told every playlist screen it had been left (their flags off, their reads orphaned),
// and nothing told them they were back: a Dynamic Playlist's Load more did nothing, and a Roon playlist's artists,
// still arriving, were dropped. The class of error: a screen's state held beside the nodes that are put back, and
// not put back with them. Now the artist page keeps what it cleared and gives it back with the nodes — unless
// another screen has been opened since, which owns the grid then.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const ZONE = { zone_id: "z1", display_name: "Living Room", state: "stopped", settings: { shuffle: false, loop: "disabled", auto_radio: false },
  outputs: [{ output_id: "o1", display_name: "Living Room", is_muted: false, volume: null }], now_playing: null };
const SAVED = { id: "sp1", name: "Nineties, unheard", album_total: 3, art_keys: [], mode: "tracks",
  view: { sort: "year", dir: "desc", seed: 1, decade: ["1990"], source: [], played: "12" } };
const PAGE1 = { id: "sp1", name: SAVED.name, view: SAVED.view, album_offset: 0, albums_expanded: 2, album_total: 3, done: false,
  tracks: [{ album_offset: 10, album_title: "Perfect From Now On", album_artist: "Built to Spill", image_key: null, track_index: 0,
    title: "Randy Described Eternity", subtitle: "Built to Spill" }] };
const PAGE2 = { id: "sp1", name: SAVED.name, view: SAVED.view, album_offset: 2, albums_expanded: 1, album_total: 4, done: false,
  tracks: [{ album_offset: 20, album_title: "Goo", album_artist: "Sonic Youth", image_key: null, track_index: 0,
    title: "Dirty Boots", subtitle: "Sonic Youth" }] };
const PAGE3 = { id: "sp1", name: SAVED.name, view: SAVED.view, album_offset: 3, albums_expanded: 1, album_total: 4, done: true,
  tracks: [{ album_offset: 30, album_title: "Goo", album_artist: "Sonic Youth", image_key: null, track_index: 1,
    title: "Kool Thing", subtitle: "Sonic Youth" }] };

const STUB = `
window.__pages = [];
try { localStorage.setItem("rra-zone", "z1"); } catch (e) { /* storage optional */ }
window.__installFetch(function (url) {
  if (url.indexOf("/api/smart-playlist?") > -1) {
    var off = parseInt((/offset=(\\d+)/.exec(url) || [0, "0"])[1], 10);
    window.__pages.push(off);
    return window.__json(off === 0 ? ${JSON.stringify(PAGE1)} : off === 2 ? ${JSON.stringify(PAGE2)} : ${JSON.stringify(PAGE3)});
  }
  if (url.indexOf("/api/smart-playlists") > -1) return window.__json({ playlists: [${JSON.stringify(SAVED)}] });
  if (url.indexOf("/api/roon-smart") > -1) return window.__json({ available: false, playlists: [] });
  if (url.indexOf("/api/artist-albums") > -1)
    return window.__json({ primary: [{ offset: 10, title: "Perfect From Now On", subtitle: "Built to Spill", image_key: null }], featured: [] });
  if (url.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (url.indexOf("/api/zones") > -1) return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (url.indexOf("/api/queue") > -1) return window.__json({ items: [], history: [] });
  if (url.indexOf("/api/random-albums") > -1) return window.__json({ albums: [], total: 0, filtered: false });
  if (url.indexOf("/api/update/status") > -1) return window.__json({ is_docker: true });
  if (url.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (url.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});
`;

const DRIVER = `
  await window.__sleep(400);
  var rows = function () { return Array.prototype.map.call(document.querySelectorAll(".playlist-tracks .track-title"), function (e) { return e.textContent; }); };
  document.getElementById("menu-toggle").click();
  await window.__sleep(200);
  document.querySelector('[data-action="smart-playlists"]').click();
  await window.__sleep(700);
  document.querySelector("#album-grid .album:not(#new-smart-tile)").click();
  await window.__sleep(800);
  T("before", rows());

  // To the artist's page, and back.
  window.__showArtistAlbums("Built to Spill");
  await window.__sleep(700);
  T("artist_up", !document.querySelector(".playlist-detail"));
  document.getElementById("topbar-back").click();
  await window.__sleep(700);
  T("back", { rows: rows(), title: document.getElementById("album-count").textContent });

  document.querySelector(".playlist-more").click();
  await window.__sleep(700);
  T("more", { rows: rows(), pages: window.__pages.slice() });

  // What the artist page gives back is refused once the playlist screens have been left again since (their reads
  // moved on): a later screen owns them then.
  var snap = window.__leavePlaylistScreens({ keepChrome: true });
  window.__leavePlaylistScreens({ keepChrome: true });
  window.__restorePlaylistScreens(snap);
  var rowsNow = rows().length;
  document.querySelector(".playlist-more").click();
  await window.__sleep(700);
  T("stale", { before: rowsNow, after: rows().length });

  // Left for the artist page, and another screen opened from there: the playlist's reads stay orphaned.
  window.__showArtistAlbums("Built to Spill");
  await window.__sleep(500);
  document.getElementById("menu-toggle").click();
  await window.__sleep(200);
  document.querySelector('[data-action="smart-playlists"]').click();
  await window.__sleep(700);
  T("elsewhere", { detail: !!document.querySelector(".playlist-detail"), tiles: document.querySelectorAll("#album-grid .album").length });
`;

test("a playlist's page, left for an artist's page and come back to (v2.0.3-t12)", { skip: !harness.available && "no chromium" }, async (t) => {
  const R = harness.renderPage({ stub: STUB, driver: DRIVER, name: "artist-return", windowSize: "390x844", budgetMs: 30000 });
  harness.assertNoPageError(assert, R);
  await t.test("the page and its first rows were up, and the artist page took the grid", () => {
    assert.deepEqual(R.before, ["Randy Described Eternity"]);
    assert.equal(R.artist_up, true);
    assert.deepEqual(R.back.rows, ["Randy Described Eternity"]);
    assert.equal(R.back.title, "Nineties, unheard");
  });
  await t.test("THE one: back on the Dynamic Playlist, Load more loads the next page", () => {
    assert.deepEqual(R.more.pages, [0, 2]);
    assert.deepEqual(R.more.rows, ["Randy Described Eternity", "Dirty Boots"]);
  });
  await t.test("a snapshot given back after the playlist screens were left again since is refused", () => {
    assert.equal(R.stale.before, 2);
    assert.equal(R.stale.after, 2, "nothing drawn by a read a later screen owns");
  });
  await t.test("another screen opened from the artist page owns the grid: the playlist is not put back", () => {
    assert.equal(R.elsewhere.detail, false);
    assert.ok(R.elsewhere.tiles >= 1);
  });
});
