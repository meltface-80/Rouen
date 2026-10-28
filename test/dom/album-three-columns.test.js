"use strict";
// ---------------------------------------------------------------------------
// v1.9.70-t10 (dev/design/album-view-landscape.md §3, §4; the owner: "Three sections. Tracks on the right. Album and
// artist review in the middle. Album art in the left with the credits, albums by same artist, artists and albums
// similar"): on a landscape screen at least 1000px wide and 600px tall, a desktop, a TV or a tablet on its side, the
// album view is the whole screen in three columns. At the left the cover, under it the title, the buttons, the
// credits and the other albums; in the middle the review, whole; at the right the tracks. The review and the tracks
// are held in view and scroll on their own; nothing ends under the mini player (or, on a tablet, the bar). A phone on
// its side and a portrait screen keep the view as it was.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const TOUCH = ["--blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=1,availableHoverTypes=1"];
const PLAYING = { title: "Idioteque", artist: "Radiohead", album: "Kid A", image_key: null, length: 309, seek_position: 40 };
const ZONE = { zone_id: "z1", display_name: "Living Room", state: "playing",
  settings: { shuffle: false, loop: "disabled", auto_radio: false },
  outputs: [{ output_id: "o1", display_name: "Living Room", is_muted: false, volume: null }],
  now_playing: { one_line: { line1: "Idioteque" }, two_line: { line1: "Idioteque", line2: "Radiohead" },
    three_line: { line1: PLAYING.title, line2: PLAYING.artist, line3: PLAYING.album }, image_key: null, length: 309, seek_position: 40 } };
const ALBUM = { offset: 0, title: "Kid A", subtitle: "Radiohead", image_key: "k" };
const DETAIL = { title: "Kid A", subtitle: "Radiohead", image_key: "k",
  actions: [{ kind: "play_now", title: "Play Now" }, { kind: "queue", title: "Queue" }, { kind: "shuffle", title: "Shuffle" }],
  // Long enough to need its own scroll on every screen here.
  tracks: Array.from({ length: 40 }, (_, i) => ({ title: "Track " + (i + 1), subtitle: "Radiohead" })) };
const DESC = "Kid A is the fourth studio album by the English rock band Radiohead, released in 2000. ".repeat(30);
const credit = (name, roles) => ({ name, roles, tracks: null, photo: null, source: "roon" });
const CREDITS = [credit("Thom Yorke", ["Vocals"]), credit("Jonny Greenwood", ["Guitar"]), credit("Ed O'Brien", ["Guitar"]),
  credit("Colin Greenwood", ["Bass"]), credit("Philip Selway", ["Drums"]), credit("Nigel Godrich", ["Producer"])];
const al = (offset, title) => ({ offset, title, subtitle: "Radiohead", image_key: null });
const MORE = { artist: "Radiohead", by: [al(1, "Amnesiac"), al(2, "Hail to the Thief"), al(3, "In Rainbows")], appears: [] };

const STUB = `
try { localStorage.setItem("rra-zone", "z1"); } catch (e) {}
window.__installFetch(function (url) {
  if (url.indexOf("/api/user-playlists") > -1) return window.__json({ playlists: [] });
  if (url.indexOf("/api/album/extras") > -1)
    return window.__json({ album: { description: ${JSON.stringify(DESC)}, source: "wikipedia", url: "https://en.wikipedia.org/wiki/Kid_A" } });
  if (url.indexOf("/api/album/credits") > -1) return window.__json({ credits: ${JSON.stringify(CREDITS)}, status: "ok" });
  if (url.indexOf("/api/album/more") > -1)    return window.__json(${JSON.stringify(MORE)});
  if (url.indexOf("/api/lastfm/") > -1)       return window.__json({ enabled: false });
  if (url.indexOf("/api/album") > -1)      return window.__json(${JSON.stringify(DETAIL)});
  if (url.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (url.indexOf("/api/zones") > -1)      return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (url.indexOf("/api/queue") > -1)      return window.__json({ items: [] });
  if (url.indexOf("/api/filters") > -1)    return window.__json({ genres: [] });
  if (url.indexOf("/api/home/") > -1)      return window.__json({ albums: [], label: null });
  if (url.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  if (url.indexOf("/api/settings") > -1)   return window.__json({});
  if (url.indexOf("/api/random-albums") > -1)
    return window.__json({ albums: [${JSON.stringify(ALBUM)}], total: 1, filtered: false });
  return undefined;
});`;

const DRIVER = `
  var st = document.createElement("style"); st.textContent = "*, *::before, *::after { animation: none !important; transition: none !important; }";
  document.head.appendChild(st);
  function bx(e) { if (!e) return null; var q = e.getBoundingClientRect();
    return { l: Math.round(q.left), t: Math.round(q.top), r: Math.round(q.right), b: Math.round(q.bottom), w: Math.round(q.width), h: Math.round(q.height) }; }
  function $(s) { return document.querySelector(s); }
  await window.__sleep(600);
  window.__openAlbum(${JSON.stringify(ALBUM)}, { source: "search" });
  await window.__sleep(1800);
  var body = $("#album-modal .modal-body"), wrap = $("#album-modal .track-list-wrap"), bio = $("#album-bio-section");
  T("vw", innerWidth); T("vh", innerHeight);
  T("panel", bx($("#album-modal .modal-panel")));
  T("art", bx($("#album-modal .modal-art")));
  T("title", bx($("#modal-title")));
  T("actions", bx($("#modal-actions")));
  T("credits", bx($("#album-modal .credits-section:not(.hidden)")));
  T("moreBy", bx($("#album-more-by:not(.hidden)")));
  T("bio", bx(bio)); T("bioShown", !bio.classList.contains("hidden"));
  T("tracks", bx(wrap));
  var txt = $("#album-bio-text");
  T("bioWhole", txt.scrollHeight <= txt.clientHeight + 2);
  T("toggleShown", (function (b) { return !!b && !b.classList.contains("hidden") && getComputedStyle(b).display !== "none"; })($("#album-bio-toggle")));
  // What may cover the foot of the screen: the mini player (and, on a touch screen, the bar along the foot).
  var cover = [$("#mini-transport"), $("#touch-nav")].filter(function (e) { return e && getComputedStyle(e).display !== "none" && e.getBoundingClientRect().height > 0; })
    .map(function (e) { return Math.round(e.getBoundingClientRect().top); });
  T("footTop", cover.length ? Math.min.apply(null, cover) : innerHeight);
  // The tracks and the review scroll on their own: scrolled to their ends, the last track is above the foot, and the
  // cover has not moved.
  var artBefore = bx($("#album-modal .modal-art"));
  wrap.scrollTop = 1e6; bio.scrollTop = 1e6;
  await window.__sleep(150);
  var rows = wrap.querySelectorAll("#modal-tracks li");
  T("lastTrack", bx(rows[rows.length - 1]));
  T("artAfterScroll", bx($("#album-modal .modal-art")));
  T("artBeforeScroll", artBefore);
  T("tracksScroll", wrap.scrollHeight > wrap.clientHeight);
`;

const run = (size, args) => harness.renderPage({ name: "album-3col-" + size, windowSize: size, stub: STUB, driver: DRIVER, chromeArgs: args, budgetMs: 30000 });

for (const [size, args, what] of [["1920x1080", harness.MOUSE, "a TV"], ["1440x900", harness.MOUSE, "a desktop"],
  ["1366x1024", TOUCH, "an iPad Pro on its side"], ["1180x820", TOUCH, "an iPad on its side"], ["1024x768", TOUCH, "a small iPad on its side"]]) {
  test(`v1.9.70-t10: ${what} (${size}): the album view in three columns, the whole screen`, { skip: !harness.available }, async (t) => {
    const r = run(size, args);
    harness.assertNoPageError(assert, r);
    await t.test("the whole screen, not a card", () => {
      assert.deepEqual([r.panel.w, r.panel.h], [r.vw, r.vh], JSON.stringify(r.panel));
    });
    await t.test("THE one: the cover at the left, the review in the middle, the tracks at the right", () => {
      assert.ok(r.bioShown, "the fixture's review did not show");
      assert.ok(r.art.r <= r.bio.l && r.bio.r <= r.tracks.l, JSON.stringify({ art: r.art, bio: r.bio, tracks: r.tracks }));
      assert.ok(r.art.w >= 280 && r.art.w <= 420, "the cover's column: " + r.art.w);
      assert.ok(r.tracks.w >= 340 && r.tracks.w <= 560, "the tracks' column: " + r.tracks.w);
      assert.ok(Math.abs(r.bio.t - r.art.t) <= 40 && Math.abs(r.tracks.t - r.art.t) <= 40, "the three columns start at the top together");
    });
    await t.test("under the cover: the title, the buttons, the credits and the artist's other albums", () => {
      for (const [k, b] of [["title", r.title], ["actions", r.actions], ["credits", r.credits], ["moreBy", r.moreBy]]) {
        assert.ok(b, k + " not shown");
        assert.ok(b.t >= r.art.b - 1 && b.l >= r.art.l - 1 && b.r <= r.art.r + 1, `${k} ${JSON.stringify(b)} is not under the cover ${JSON.stringify(r.art)}`);
      }
      assert.ok(r.title.t < r.actions.t && r.actions.t < r.credits.t && r.credits.t < r.moreBy.t, "in that order");
    });
    await t.test("the review whole, with no Show more", () => {
      assert.equal(r.bioWhole, true, "the review is clipped in the middle column");
      assert.equal(r.toggleShown, false, "Show more is shown in the middle column");
    });
    await t.test("the tracks scroll on their own, the cover held, and none ends under the mini player or the bar", () => {
      assert.ok(r.tracksScroll, "40 tracks did not need their own scroll");
      assert.deepEqual(r.artAfterScroll, r.artBeforeScroll, "scrolling the tracks moved the cover");
      assert.ok(r.lastTrack.b <= r.footTop + 1, `the last track ends at ${r.lastTrack.b}, under the foot at ${r.footTop}`);
      assert.ok(r.tracks.b <= r.footTop + 1, `the tracks' column ends at ${r.tracks.b}, under the foot at ${r.footTop}`);
    });
  });
}

// Not touched (§2.1): a phone on its side, a portrait tablet, a desktop window too small.
for (const [size, args, what] of [["844x390", TOUCH, "a phone on its side"], ["820x1180", TOUCH, "an iPad upright"], ["960x700", harness.MOUSE, "a small desktop window"]]) {
  test(`v1.9.70-t10: ${what} (${size}) keeps the album view as it was: the review under the cover, no third column`, { skip: !harness.available }, async (t) => {
    const r = run(size, args);
    harness.assertNoPageError(assert, r);
    await t.test("the review in the cover's column, not a column of its own", () => {
      assert.ok(r.bio.l === r.art.l && r.bio.t >= r.art.b - 1, JSON.stringify({ art: r.art, bio: r.bio }));
    });
  });
}
