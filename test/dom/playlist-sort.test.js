"use strict";
// ---------------------------------------------------------------------------
// v2.0.3-t4: a Roon playlist's tracks, each with its own artist, and a Sort (dev/design/playlist-artists.md).
//
// The request: "instead of composers it would be nice to have artist for each song and maybe a chance to choose to
// have the artists in alphabetic order." The official API's line under a track is often its composers; with native
// mode on, Rouen asks for each row's own artist and puts it there. A Sort above the rows — Playlist order, Artist,
// Title — reorders them, the choice kept on the device, and a tap still plays the track tapped. Native mode off: the
// lines stay as they were, and the Sort still works on them. The shipping page, the server a stand-in.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const ZONE = { zone_id: "z1", display_name: "Living Room", state: "stopped", settings: { shuffle: false, loop: "disabled", auto_radio: false },
  outputs: [{ output_id: "o1", display_name: "Living Room", is_muted: false, volume: null }], now_playing: null };
const TRACKS = [
  { index: 0, title: "Rosanna", subtitle: "David Paich", image_key: null },
  { index: 1, title: "Billie Jean", subtitle: "Michael Jackson", image_key: null },
  { index: 2, title: "Lowdown", subtitle: "Boz Scaggs, David Paich", image_key: null },
  { index: 3, title: "Another Day", subtitle: "", image_key: null },
  { index: 4, title: "Roxanne", subtitle: "Sting", image_key: null },
];
// Each row's own artist, as the server names them (the last it can't name).
const ARTISTS = ["Toto", "Michael Jackson", "Boz Scaggs", null, "The Police"];

const STUB = `
window.__mode = "ok";
window.__posts = [];
window.__asked = [];
try { localStorage.setItem("rra-zone", "z1"); localStorage.removeItem("rouen.playlist-sort"); } catch (e) {}
window.__installFetch(function (url, opts) {
  if (url.indexOf("/api/playlists") > -1)
    return window.__json({ playlists: [{ offset: 0, title: "Session Work", subtitle: "4 tracks", image_key: null }], total: 1 });
  if (url.indexOf("/api/playlist/art") > -1) return window.__json({ title: "Session Work", art_keys: [] });
  if (url.indexOf("/api/playlist/track-artists") > -1) {
    window.__asked.push(JSON.parse(opts.body));
    return window.__mode === "ok" ? window.__json({ status: "ok", artists: ${JSON.stringify(ARTISTS)} })
      : window.__json({ status: "off", why: "Native mode is off." });
  }
  if (url.indexOf("/api/playlist/play-ordered") > -1) return window.__json({ job: null });   // no run going (v2.0.3-t11)
  if (url.indexOf("/api/playlist/play") > -1) {
    window.__posts.push(JSON.parse((opts && opts.body) || "{}"));
    return window.__json({ ok: true, invoked: "Play Now" });
  }
  if (url.indexOf("/api/playlist") > -1)
    return window.__json({ title: "Session Work", subtitle: "4 tracks", image_key: null, tracks: ${JSON.stringify(TRACKS)}, total: 4, truncated: false, can_play: true });
  if (url.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (url.indexOf("/api/zones") > -1)      return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (url.indexOf("/api/queue") > -1)      return window.__json({ items: [] });
  if (url.indexOf("/api/filters") > -1)    return window.__json({ genres: [] });
  if (url.indexOf("/api/home/") > -1)      return window.__json({ albums: [], label: null });
  if (url.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  if (url.indexOf("/api/settings") > -1)   return window.__json({});
  if (url.indexOf("/api/random-albums") > -1) return window.__json({ albums: [], total: 0, filtered: false });
  return undefined;
});
`;

const DRIVER = `
  await window.__sleep(400);
  function rows() {
    return Array.prototype.map.call(document.querySelectorAll(".playlist-tracks .track-row"), function (li) {
      var t = li.querySelector(".track-title"), a = li.querySelector(".track-artist");
      return (t ? t.textContent : "") + " / " + (a ? a.textContent : "");
    });
  }
  function pressed() {
    var b = document.querySelector('.playlist-sort-btn[aria-pressed="true"]');
    return b ? b.textContent : null;
  }
  async function open() {
    document.getElementById("menu-toggle").click();
    await window.__sleep(200);
    document.querySelector('[data-action="playlists"]').click();
    await window.__sleep(600);
    document.querySelectorAll("#album-grid .album")[0].click();
    await window.__sleep(700);
  }

  await open();
  T("buttons", Array.prototype.map.call(document.querySelectorAll(".playlist-sort-btn"), function (b) { return b.textContent; }));
  T("pressed_first", pressed());
  T("asked", JSON.parse(JSON.stringify(window.__asked)));
  T("rows_native", rows());

  document.querySelector('.playlist-sort-btn[data-sort="artist"]').click();
  await window.__sleep(100);
  T("rows_by_artist", rows());
  T("pressed_artist", pressed());
  var top = document.querySelectorAll(".playlist-tracks .track-row")[0];
  T("number_top", getComputedStyle(top, "::before").content);
  T("saved", localStorage.getItem("rouen.playlist-sort"));
  document.querySelectorAll(".playlist-tracks .track-row")[0].click();
  await window.__sleep(300);
  T("played", window.__posts.map(function (p) { return [p.track_index, p.track_title]; }));

  document.querySelector('.playlist-sort-btn[data-sort="title"]').click();
  await window.__sleep(100);
  T("rows_by_title", rows());
  document.querySelector('.playlist-sort-btn[data-sort="order"]').click();
  await window.__sleep(100);
  T("rows_back", rows());

  // Native mode off; the choice kept: by artist on the line Roon's official API gave.
  document.querySelector('.playlist-sort-btn[data-sort="artist"]').click();
  window.__mode = "off";
  document.getElementById("topbar-back").click();
  await window.__sleep(500);
  document.querySelectorAll("#album-grid .album")[0].click();
  await window.__sleep(700);
  T("pressed_kept", pressed());
  T("rows_off", rows());
`;

test("a Roon playlist: each track's own artist, and Sort (v2.0.3-t4)", { skip: !harness.available && "no chromium" }, async (t) => {
  const R = harness.renderPage({ stub: STUB, driver: DRIVER, name: "playlist-sort" });
  harness.assertNoPageError(assert, R);
  await t.test("a Sort above the rows, the playlist's own order to begin with", () => {
    assert.deepEqual(R.buttons, ["Playlist order", "Artist", "Title"]);
    assert.equal(R.pressed_first, "Playlist order");
  });
  await t.test("THE one: native mode's artists in place of the composers, where the server named one", () => {
    assert.deepEqual(R.asked, [{ title: "Session Work", tracks: ["Rosanna", "Billie Jean", "Lowdown", "Another Day", "Roxanne"] }]);
    assert.deepEqual(R.rows_native, ["Rosanna / Toto", "Billie Jean / Michael Jackson", "Lowdown / Boz Scaggs", "Another Day / ", "Roxanne / The Police"]);
  });
  await t.test("Artist sorts A to Z by artist; a tap still plays the track tapped", () => {
    assert.deepEqual(R.rows_by_artist, ["Lowdown / Boz Scaggs", "Billie Jean / Michael Jackson", "Roxanne / The Police", "Rosanna / Toto", "Another Day / "],
      "\"The Police\" under P; a track with no artist last");
    assert.equal(R.number_top, '"3"', "the row keeps the number of its place in the playlist");
    assert.equal(R.pressed_artist, "Artist");
    assert.equal(R.saved, "artist");
    assert.deepEqual(R.played, [[2, "Lowdown"]], "the row on top plays its own track, not the playlist's first");
  });
  await t.test("Title sorts by title; Playlist order puts them back", () => {
    assert.deepEqual(R.rows_by_title.map((r) => r.split(" / ")[0]), ["Another Day", "Billie Jean", "Lowdown", "Rosanna", "Roxanne"]);
    assert.deepEqual(R.rows_back, R.rows_native);
  });
  await t.test("native mode off: the official lines as they were, sorted by the choice kept", () => {
    assert.equal(R.pressed_kept, "Artist");
    assert.deepEqual(R.rows_off, ["Lowdown / Boz Scaggs, David Paich", "Rosanna / David Paich", "Billie Jean / Michael Jackson", "Roxanne / Sting", "Another Day / "]);
  });
});
