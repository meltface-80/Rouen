"use strict";
// ---------------------------------------------------------------------------
// v1.9.3: below the review in the album view — More by this artist, Appears
// on, and Last.fm's similar artists and albums. Three of each, More for the
// rest; what a tile does is visible before it is tapped ("Last.fm ↗" leaves
// the app, anything else opens in Rouen); no key means no Last.fm at all.
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
const DETAIL = {
  title: "Kid A", subtitle: "Radiohead", image_key: null,
  actions: [{ kind: "play_now", title: "Play Now" }], tracks: [{ title: "Idioteque", subtitle: "Radiohead" }],
};
const al = (offset, title, artist) => ({ offset, title, subtitle: artist || "Radiohead", image_key: null });
const MORE = {
  artist: "Radiohead",
  by: [al(1, "Amnesiac"), al(2, "Hail to the Thief"), al(3, "In Rainbows"), al(4, "OK Computer"), al(5, "The Bends")],
  appears: [al(9, "Help!", "Various / Radiohead")],
};
const ARTISTS = {
  enabled: true, artist: "Radiohead", url: "https://www.last.fm/music/Radiohead",
  artists: [
    { name: "Thom Yorke", url: "https://www.last.fm/music/Thom+Yorke", image: "", in_library: true, image_key: null },
    { name: "Muse", url: "https://www.last.fm/music/Muse", image: "", in_library: false, image_key: null },
    { name: "Atoms for Peace", url: "https://www.last.fm/music/Atoms+for+Peace", image: "", in_library: false, image_key: null },
    { name: "Portishead", url: "https://www.last.fm/music/Portishead", image: "", in_library: false, image_key: null },
  ],
};
const ALBUMS = {
  enabled: true,
  albums: [
    { title: "The Eraser", artist: "Thom Yorke", url: "https://www.last.fm/music/Thom+Yorke/The+Eraser", image: "",
      album: al(20, "The Eraser", "Thom Yorke") },
    { title: "Absolution", artist: "Muse", url: "https://www.last.fm/music/Muse/Absolution", image: "", album: null },
  ],
};

function stub(lastfm) {
  return `
window.__albumUrls = []; window.__opened = []; window.__asked = { albums: 0 };
try { localStorage.setItem("rra-zone", "z1"); } catch (e) { /* storage optional */ }
window.open = function (u) { window.__opened.push(u); return null; };
window.__installFetch(function (url) {
  if (url.indexOf("/api/album/more") > -1)   return window.__json(${JSON.stringify(MORE)});
  if (url.indexOf("/api/album/extras") > -1) return window.__json({});
  if (url.indexOf("/api/album?") > -1) { window.__albumUrls.push(url); return window.__json(${JSON.stringify(DETAIL)}); }
  if (url.indexOf("/api/lastfm/similar-artists") > -1) return window.__json(${JSON.stringify(lastfm.artists)});
  if (url.indexOf("/api/lastfm/similar-albums") > -1) { window.__asked.albums++; return window.__json(${JSON.stringify(lastfm.albums)}); }
  if (url.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (url.indexOf("/api/zones") > -1)      return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (url.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  return undefined;
});
`;
}

const DRIVER = `
  await window.__sleep(500);
  var sec = function (id) { return document.getElementById(id); };
  var shown = function (id) { var s = sec(id); return !!s && !s.classList.contains("hidden"); };
  var visible = function (id) {
    return Array.prototype.filter.call(sec(id).querySelectorAll(".more-grid > *"), function (el) { return !el.classList.contains("hidden"); }).length;
  };
  var toggle = function (id) { return sec(id).querySelector(".more-toggle"); };
  window.__openAlbum({ offset: 2, title: "Kid A", subtitle: "Radiohead", image_key: null });
  await window.__sleep(700);
  T("by_shown", shown("album-more-by"));
  T("by_title", sec("album-more-by").querySelector(".more-title").textContent);
  T("by_total", sec("album-more-by").querySelectorAll(".more-grid > *").length);
  T("by_visible", visible("album-more-by"));
  T("by_toggle", toggle("album-more-by").classList.contains("hidden") ? null : toggle("album-more-by").textContent);
  toggle("album-more-by").click();
  T("by_visible_more", visible("album-more-by"));
  T("by_toggle_after", toggle("album-more-by").textContent);
  T("appears_shown", shown("album-more-appears"));
  T("appears_title", sec("album-more-appears").querySelector(".more-title").textContent);
  T("appears_toggle_hidden", toggle("album-more-appears").classList.contains("hidden"));
  T("lf_artists_shown", shown("album-lastfm-artists"));
  T("lf_artists_visible", shown("album-lastfm-artists") ? visible("album-lastfm-artists") : 0);
  var site = sec("album-lastfm-artists").querySelector(".more-site");
  T("lf_site", site && !site.classList.contains("hidden") ? site.getAttribute("href") : null);
  var artistTiles = sec("album-lastfm-artists").querySelectorAll(".more-artist");
  T("lf_artist_marks", Array.prototype.map.call(artistTiles, function (b) { return !!b.querySelector(".more-ext"); }));
  T("lf_albums_shown", shown("album-lastfm-albums"));
  T("lf_albums_asked", window.__asked.albums);
  var albumTiles = shown("album-lastfm-albums") ? sec("album-lastfm-albums").querySelectorAll(".more-grid > .album") : [];
  T("lf_album_marks", Array.prototype.map.call(albumTiles, function (b) { return b.querySelector(".more-ext") ? b.querySelector(".more-ext").textContent : ""; }));
  T("note", sec("album-lastfm-artists").querySelector(".more-note") ? sec("album-lastfm-artists").querySelector(".more-note").textContent : null);
  if (albumTiles.length === 2) {
    albumTiles[1].click();                 // only on Last.fm: its page
    await window.__sleep(100);
    T("opened", window.__opened.slice());
    albumTiles[0].click();                 // in the library: the album view
    await window.__sleep(500);
    var last = new URL(window.__albumUrls[window.__albumUrls.length - 1], location.href).searchParams;
    T("lib_open", { offset: last.get("offset"), filter: last.get("filter_type") || "" });
    T("sections_reset_for_next", true);
  }
`;

function run(name, lastfm) {
  return harness.renderPage({ name, stub: stub(lastfm), driver: DRIVER, windowSize: "1280x900", budgetMs: 20000 });
}

test("below the review: the artist's other albums, and Last.fm's suggestions (v1.9.3)", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const r = run("album-more", { artists: ARTISTS, albums: ALBUMS });
  harness.assertNoPageError(assert, r);

  await t.test("THE one: More by the artist — three, then More shows the rest, and Less", () => {
    assert.equal(r.by_shown, true);
    assert.equal(r.by_title, "More by Radiohead");
    assert.equal(r.by_total, 5);
    assert.equal(r.by_visible, 3, "more than three shown before More");
    assert.equal(r.by_toggle, "More");
    assert.equal(r.by_visible_more, 5);
    assert.equal(r.by_toggle_after, "Less");
  });
  await t.test("Appears on, with no More when three or fewer", () => {
    assert.equal(r.appears_shown, true);
    assert.equal(r.appears_title, "Radiohead appears on");
    assert.equal(r.appears_toggle_hidden, true);
  });
  await t.test("similar artists from Last.fm: three, a link to the artist's Last.fm page", () => {
    assert.equal(r.lf_artists_shown, true);
    assert.equal(r.lf_artists_visible, 3);
    assert.equal(r.lf_site, "https://www.last.fm/music/Radiohead");
  });
  await t.test("what leaves the app says so before the tap", () => {
    assert.deepEqual(r.lf_artist_marks, [false, true, true, true]);
    assert.deepEqual(r.lf_album_marks, ["", "Last.fm ↗"]);
  });
  await t.test("a Last.fm-only album opens its Last.fm page; one in the library opens in Rouen, in the whole library", () => {
    assert.deepEqual(r.opened, ["https://www.last.fm/music/Muse/Absolution"]);
    assert.deepEqual(r.lib_open, { offset: "20", filter: "" });
  });
});

test("no Last.fm key: no Last.fm sections, and no second request", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const r = run("album-more-nokey", { artists: { enabled: false }, albums: { enabled: false } });
  harness.assertNoPageError(assert, r);
  await t.test("the library sections are still there", () => assert.equal(r.by_shown, true));
  await t.test("the Last.fm ones are not", () => {
    assert.equal(r.lf_artists_shown, false);
    assert.equal(r.lf_albums_shown, false);
    assert.equal(r.lf_albums_asked, 0, "similar albums were asked for with no key");
  });
});

test("a key Last.fm refuses is said so, where the suggestions would be", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const r = run("album-more-badkey", {
    artists: { enabled: true, error: "Last.fm refused the API key" }, albums: { enabled: true, error: "x" },
  });
  harness.assertNoPageError(assert, r);
  await t.test("the note names the fix", () => {
    assert.equal(r.lf_artists_shown, true);
    assert.match(String(r.note), /refused the API key.*Settings/);
    assert.equal(r.lf_albums_asked, 0);
  });
});
