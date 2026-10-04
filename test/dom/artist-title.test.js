"use strict";
// ---------------------------------------------------------------------------
// v1.8.77: the artist page names the ARTIST beside Back.
//
// Reported, desktop only: "genre grid, open album, tap on artist, goes to
// artist screen but next to the back button it shows the genre from which I
// started in." On a desktop the album is a popup over the genre wall, so when
// the artist link closed it the top bar still held the wall's title — "Rock"
// over one artist's albums. A phone's album view is full screen and the bar
// was out of sight, so it never showed there.
//
// The artist page titles itself now, on every device, with the line it used
// to draw above its grid ("2 albums · The BeauBowBelles") — moved into the bar
// at the user's word. Back restores the title of the screen it came from.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const ALBUMS = [
  { offset: 0, title: "Album A", subtitle: "Artist One", image_key: "k0" },
  { offset: 1, title: "Album B", subtitle: "Artist One", image_key: "k1" },
  { offset: 2, title: "Album C", subtitle: "Artist Two", image_key: "k2" },
];

const STUB = `
var ALBUMS = ${JSON.stringify(ALBUMS)};
window.__installFetch(function (url) {
  if (url.indexOf("/api/artist-albums") > -1)
    return window.__json({ primary: [ALBUMS[0]], featured: [] });
  if (url.indexOf("/api/artist-bio") > -1)
    return window.__json({ bio: null });
  if (url.indexOf("/api/album?") > -1)
    return window.__json({ album: ALBUMS[0], tracks: [], actions: [], offset: 0, artists: ["Artist One"] });
  if (url.indexOf("/api/random-albums") > -1)
    return window.__json({ albums: ALBUMS, total: ALBUMS.length, filtered: false });
  if (url.indexOf("/api/library/albums") > -1)
    return window.__json({ albums: ALBUMS, offset: 0, total: ALBUMS.length });
  if (url.indexOf("/api/zones") > -1)
    return window.__json({ zones: [{ zone_id: "z1", display_name: "Zone", state: "stopped", outputs: [] }] });
  if (url.indexOf("/api/zone-state") > -1) return window.__json({ zone: null });
  if (url.indexOf("/api/queue") > -1)      return window.__json({ items: [] });
  if (url.indexOf("/api/filters") > -1)    return window.__json({ genres: [] });
  if (url.indexOf("/api/home/") > -1)      return window.__json({ albums: [], label: null });
  if (url.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  if (url.indexOf("/api/settings") > -1)   return window.__json({});
  return undefined;
});
`;


const DRIVER = `
  await window.__sleep(500);
  var count = document.getElementById("album-count");
  function title() { return count.classList.contains("hidden") ? null : count.textContent; }
  window.__applyFilter({ type: "genre", value: "Rock", label: "Rock" });
  await window.__sleep(500);
  T("genre_title", title());
  var tile = document.querySelector("#album-grid .album");
  tile.click();
  await window.__sleep(400);
  var modal = document.getElementById("album-modal");
  T("popup_open", !modal.classList.contains("hidden"));
  var link = modal.querySelector(".modal-artist-link");
  link.click();
  await window.__sleep(400);
  T("artist_active", window.__artistViewActive());
  T("artist_title", title());
  var line = document.getElementById("content-count");
  T("line_hidden", !line || line.classList.contains("hidden"));
  document.getElementById("topbar-back").click();
  await window.__sleep(400);
  T("back_album_open", !modal.classList.contains("hidden"));
  T("back_title", title());
  var close = modal.querySelector("[data-close]");
  close.click();
  await window.__sleep(300);
  T("closed_title", title());
`;

for (const [name, size, args] of [["desktop", "1400x900", harness.MOUSE], ["phone", "390x844", undefined]]) {
  test("the artist page names the artist, not the genre behind it (" + name + ", v1.8.77)", { skip: !harness.available && "no chromium" }, async (t) => {
    const R = harness.renderPage({ stub: STUB, driver: DRIVER, name: "artist-title-" + name, windowSize: size, chromeArgs: args });
    harness.assertNoPageError(assert, R);
    await t.test("genre wall → album → artist", () => {
      assert.equal(R.genre_title, "Rock");
      assert.equal(R.popup_open, true);
      assert.equal(R.artist_active, true);
      assert.equal(R.artist_title, "1 album \u00b7 Artist One", "the artist page is titled " + JSON.stringify(R.artist_title));
      assert.equal(R.line_hidden, true, "the count line is still drawn above the grid as well");
    });
    await t.test("Back returns to the album, and the genre's title with it", () => {
      assert.equal(R.back_album_open, true);
      assert.equal(R.back_title, "Rock");
      assert.equal(R.closed_title, "Rock", "closing the album left the wall without its title");
    });
  });
}
