"use strict";
// ---------------------------------------------------------------------------
// v1.9.2: an album opened from the artist page while a genre filter is on.
//
// Reported from a Synology (present since at least v1.8.64): with a genre
// filter active, open an album, tap the artist, open any album from the
// artist page — "Album not found at offset N", no tracks, and a 500.
//
// AN OFFSET MEANS NOTHING WITHOUT THE LIST IT INDEXES. /api/artist-albums
// answers with FULL-LIBRARY offsets, but the artist page built its tiles with
// the default opener, and the default opener resolves an offset in the list
// of whatever filter is active. Offset 2527 of the whole library, looked up in
// a 500-album genre list, is nothing at all — the server threw before any of
// its relocation could run. The random wall's own tiles are the other case:
// their offsets ARE positions in the genre list, so they must keep the filter.
//
// Pinned for every way an album is reached from the artist page: a tap, a
// step to the next tile, and a multi-select sent to Roon — the one the report
// did not mention, which sent every selected album with the genre filter. A
// label's albums are the same case (whole-library offsets, a screen that
// leaves the filter on): their tap was already right, their multi-select was
// not. And Now playing's album link, which opens a SEARCH result — a
// whole-library offset — named no list either, and so took the genre's: the
// review of this fix found it, and the fix moved to the default, which is the
// whole library now, with the random wall the one screen that says otherwise.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const ZONE = {
  zone_id: "z1", display_name: "Lounge", state: "stopped",
  settings: { shuffle: false, loop: "disabled", auto_radio: false },
  outputs: [{ output_id: "o1", display_name: "Lounge", is_muted: false, volume: null }],
  now_playing: null,
};
// The genre wall: offsets are positions in the GENRE's list.
const WALL = [
  { offset: 231, title: "La collection 81-89", subtitle: "Jean-Jacques Goldman", image_key: null },
  { offset: 232, title: "Rouge", subtitle: "Jean-Jacques Goldman", image_key: null },
];
// The artist page: offsets are positions in the WHOLE library.
const ARTIST = {
  artist: "Jean-Jacques Goldman",
  primary: [
    { offset: 2527, title: "Concert très très privé RTL2", subtitle: "Jean-Jacques Goldman", image_key: null },
    { offset: 2530, title: "Entre gris clair et gris foncé", subtitle: "Jean-Jacques Goldman", image_key: null },
  ],
  featured: [],
};
// A label's albums: whole-library offsets too.
const LABEL = [
  { offset: 1801, title: "Non homologué", subtitle: "Jean-Jacques Goldman", image_key: null },
  { offset: 1802, title: "Positif", subtitle: "Jean-Jacques Goldman", image_key: null },
];
const DETAIL = {
  title: "x", subtitle: "Jean-Jacques Goldman", image_key: null,
  actions: [{ kind: "play_now", title: "Play Now" }, { kind: "queue", title: "Queue" }],
  tracks: [{ title: "One", subtitle: "Jean-Jacques Goldman" }],
};

const STUB = `
window.__albumUrls = [];
window.__multi = [];
try { localStorage.setItem("rra-zone", "z1"); localStorage.removeItem("rra-filter"); } catch (e) { /* storage optional: the page starts unfiltered either way */ }
window.__installFetch(function (url, opts) {
  if (url.indexOf("/api/artist-albums") > -1) return window.__json(${JSON.stringify(ARTIST)});
  if (url.indexOf("/api/artist-bio") > -1)    return window.__json({});
  if (url.indexOf("/api/label-albums") > -1)  return window.__json({ albums: ${JSON.stringify(LABEL)}, logo_url: null });
  if (url.indexOf("/api/album?") > -1) { window.__albumUrls.push(url); return window.__json(${JSON.stringify(DETAIL)}); }
  if (url.indexOf("/api/play-multi") > -1) {
    window.__multi.push(JSON.parse((opts && opts.body) || "{}"));
    return window.__json({ ok: true, queued: 2, failed: 0, total: 2 });
  }
  if (url.indexOf("/api/random-albums") > -1)
    return window.__json({ albums: ${JSON.stringify(WALL)}, total: 2, filtered: true });
  if (url.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (url.indexOf("/api/zones") > -1)      return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (url.indexOf("/api/queue") > -1)      return window.__json({ items: [] });
  if (url.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  return undefined;
});
// A real long press: press, wait past the threshold, release with the click a
// browser dispatches (multi-select.test.js).
window.__longPress = async function (el) {
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  await window.__sleep(700);
  el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await window.__sleep(80);
};
`;

const DRIVER = `
  await window.__sleep(600);
  var qs = function (u) { var o = {}; new URL(u, location.href).searchParams.forEach(function (v, k) { o[k] = v; }); return o; };
  var lastAlbum = function () { return qs(window.__albumUrls[window.__albumUrls.length - 1]); };
  var closeModal = function () { var x = document.querySelector("#album-modal [data-close]"); if (x) x.click(); };
  var tiles = function () { return document.querySelectorAll("#album-grid .album"); };

  // A genre is picked: the wall shows that genre's albums.
  window.__applyFilter({ type: "genre", value: "International" });
  await window.__sleep(500);

  // ---- control: a WALL tile keeps the filter (its offset is in the genre list)
  tiles()[0].click();
  await window.__sleep(400);
  T("wall_open", lastAlbum());
  closeModal();
  await window.__sleep(200);

  // ---- the reported path: the artist page (as the album view's artist link opens it)
  await window.__showArtistAlbums("Jean-Jacques Goldman");
  await window.__sleep(400);
  T("artist_tiles", tiles().length);
  tiles()[0].click();
  await window.__sleep(400);
  T("artist_open", lastAlbum());
  // ...and the next album, stepped to from the album view.
  var next = document.getElementById("modal-next");
  T("step_shown", !!next && !next.classList.contains("hidden"));
  if (next) next.click();
  await window.__sleep(400);
  T("artist_step", lastAlbum());
  closeModal();
  await window.__sleep(200);

  // ---- multi-select on the artist page, sent to Roon
  await window.__longPress(tiles()[0]);
  tiles()[1].click();
  await window.__sleep(80);
  document.getElementById("select-menu-btn").click();
  await window.__sleep(120);
  document.querySelector('[data-sel-act="queue"]').click();
  await window.__sleep(400);
  T("artist_multi", window.__multi[window.__multi.length - 1] || null);

  // ---- Back to the genre wall: its own selection still carries the genre
  document.getElementById("topbar-back").click();
  await window.__sleep(300);
  T("back_on_wall", tiles().length);
  await window.__longPress(tiles()[0]);
  tiles()[1].click();
  await window.__sleep(80);
  document.getElementById("select-menu-btn").click();
  await window.__sleep(120);
  document.querySelector('[data-sel-act="queue"]').click();
  await window.__sleep(400);
  T("wall_multi", window.__multi[window.__multi.length - 1] || null);

  // ---- a label's albums, the filter still on
  T("filter_still_on", (function () { try { return localStorage.getItem("rra-filter"); } catch (e) { return "storage unavailable"; } })());
  window.__showLabelAlbums("Barclay");
  await window.__sleep(500);
  T("label_tiles", tiles().length);
  tiles()[0].click();
  await window.__sleep(400);
  T("label_open", lastAlbum());
  closeModal();
  await window.__sleep(200);
  await window.__longPress(tiles()[0]);
  tiles()[1].click();
  await window.__sleep(80);
  document.getElementById("select-menu-btn").click();
  await window.__sleep(120);
  document.querySelector('[data-sel-act="queue"]').click();
  await window.__sleep(400);
  T("label_multi", window.__multi[window.__multi.length - 1] || null);

  // ---- an open that names no list (Now playing's album link opens a search
  // result this way), the genre filter still on
  closeModal();
  await window.__sleep(150);
  window.__openAlbum({ offset: 2527, title: "Concert très très privé RTL2", subtitle: "Jean-Jacques Goldman" },
                     { source: "search" });
  await window.__sleep(400);
  T("unnamed_open", lastAlbum());
  closeModal();
  await window.__sleep(200);

  // ---- a decade wall: its offsets are whole-library positions
  window.__applyFilter({ type: "decade", value: "1980s" });
  await window.__sleep(500);
  T("decade_tiles", tiles().length);
  tiles()[0].click();
  await window.__sleep(400);
  T("decade_open", lastAlbum());
  closeModal();
  await window.__sleep(200);
`;

// Which list each album in a play-multi body is to be found in. An item may
// name its own (since v1.9.2); one that does not falls back to the request's.
function listsOf(body) {
  return (body.items || []).map((it) => {
    const own = Object.prototype.hasOwnProperty.call(it, "filter_type");
    const t = own ? it.filter_type : body.filter_type;
    const v = own ? it.filter_value : body.filter_value;
    return { offset: it.offset, list: t ? t + ":" + v : "library" };
  });
}

test("albums reached from the artist page are found in the whole library, whatever filter is on (v1.9.2)", async (t) => {
  const r = harness.renderPage({ name: "artist-filter", stub: STUB, driver: DRIVER, windowSize: "1280x800", budgetMs: 30000 });
  harness.assertNoPageError(assert, r);

  await t.test("control: a tile on the genre wall is opened in the genre's list", () => {
    assert.equal(r.wall_open.offset, "231");
    assert.equal(r.wall_open.filter_type, "genre");
    assert.equal(r.wall_open.filter_value, "International");
  });
  await t.test("THE one: a tile on the artist page is opened in the whole library", () => {
    assert.equal(r.artist_tiles, 2, "precondition: the artist page did not draw its albums");
    assert.equal(r.artist_open.offset, "2527");
    assert.equal(r.artist_open.filter_type || "", "",
      "a full-library offset was sent with the genre filter — the server looks it up in the genre's list");
  });
  await t.test("and so is the next album, stepped to from the album view", () => {
    assert.equal(r.step_shown, true, "precondition: no next album to step to");
    assert.equal(r.artist_step.offset, "2530");
    assert.equal(r.artist_step.filter_type || "", "");
  });
  await t.test("a multi-select on the artist page sends its albums as whole-library offsets", () => {
    assert.ok(r.artist_multi, "precondition: nothing was sent to Roon");
    assert.deepEqual(listsOf(r.artist_multi),
      [{ offset: 2527, list: "library" }, { offset: 2530, list: "library" }]);
  });
  await t.test("control: a multi-select on the genre wall still sends the genre", () => {
    assert.equal(r.back_on_wall, 2, "precondition: Back did not return to the genre wall");
    assert.deepEqual(listsOf(r.wall_multi),
      [{ offset: 231, list: "genre:International" }, { offset: 232, list: "genre:International" }]);
  });
  await t.test("a label's albums open in the whole library with the genre filter still on", () => {
    assert.match(String(r.filter_still_on), /International/, "precondition: the genre filter was no longer on");
    assert.equal(r.label_tiles, 2, "precondition: the label page did not draw its albums");
    assert.equal(r.label_open.offset, "1801");
    assert.equal(r.label_open.filter_type || "", "");
  });
  await t.test("an album opened naming no list is opened in the whole library (Now playing's album link)", () => {
    assert.equal(r.unnamed_open.offset, "2527");
    assert.equal(r.unnamed_open.filter_type || "", "",
      "an open that named no list took the active genre filter's");
  });
  await t.test("a decade wall's tiles open in the whole library, where decade offsets are positions", () => {
    assert.equal(r.decade_tiles, 2, "precondition: the decade wall did not draw");
    assert.equal(r.decade_open.offset, "231");
    assert.equal(r.decade_open.filter_type || "", "");
  });
  await t.test("a multi-select of a label's albums sends whole-library offsets", () => {
    assert.ok(r.label_multi, "precondition: nothing was sent to Roon");
    assert.deepEqual(listsOf(r.label_multi),
      [{ offset: 1801, list: "library" }, { offset: 1802, list: "library" }]);
  });
});
