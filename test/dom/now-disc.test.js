"use strict";
// ---------------------------------------------------------------------------
// v1.9.72-t16 (public/now-disc.js): the playing track's disc on the album view, Mandarin's — the owner: "When on an
// album view page and I press play now I want the same spinning disc indicator that Mandarin has to indicate which
// track is playing on the album". Roon gives a zone's track no id, so it is found by the mini player's title and its
// "artist · album" line against the album on the page. It turns while the zone plays, stops where it is when it
// pauses, goes when the zone moves on to another album, and the titles don't move for it.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const ALBUM = { offset: 0, title: "Welcome Home", subtitle: "'Til Tuesday", image_key: "k" };
const OTHER = { offset: 1, title: "Everything's Different Now", subtitle: "'Til Tuesday", image_key: "k2" };
const TRACKS = ["What About Love", "Coming Up Close", "On Sunday", "Will She Just Fall Down", "David Denies"];
const detail = (album, titles) => ({ title: album.title, subtitle: album.subtitle, image_key: album.image_key,
  actions: [{ kind: "play_now", title: "Play Now" }], tracks: titles.map((t) => ({ title: t, subtitle: "'Til Tuesday" })) });
const ZONE = { zone_id: "z1", display_name: "Rouen A142", state: "playing", outputs: [],
  is_play_allowed: true, is_pause_allowed: true, is_next_allowed: true, is_previous_allowed: true,
  // Roon's line1 with a curly apostrophe where the album's rows have none to fold: the title as Roon writes it
  now_playing: { line1: "On Sunday", line2: "’Til Tuesday", line3: "Welcome Home", length: 247, seek_position: 8 } };

const STUB = `
window.__zone = ${JSON.stringify(ZONE)};
window.__installFetch(function (url) {
  var title = decodeURIComponent((url.match(/title=([^&]*)/) || [])[1] || "").replace(/\\+/g, " ");
  if (url.indexOf("/api/zone-state") > -1) return window.__json({ zone: window.__zone });
  if (url.indexOf("/api/zones") > -1)      return window.__json({ zones: [window.__zone] });
  if (url.indexOf("/api/album/track-times") > -1) return window.__json({ tracks: [], status: "none" });
  if (url.indexOf("/api/user-playlists") > -1) return window.__json({ playlists: [] });
  if (url.indexOf("/api/album/extras") > -1)  return window.__json({});
  if (url.indexOf("/api/album/credits") > -1) return window.__json({ credits: [], status: "ok" });
  if (url.indexOf("/api/album/more") > -1)    return window.__json({ artist: "'Til Tuesday", by: [], appears: [] });
  if (url.indexOf("/api/lastfm/") > -1)       return window.__json({ enabled: false });
  if (url.indexOf("/api/album") > -1)
    return window.__json(title === ${JSON.stringify(OTHER.title)} ? ${JSON.stringify(detail(OTHER, ["Why Must I", "Rip in Heaven"]))}
      : ${JSON.stringify(detail(ALBUM, TRACKS))});
  if (url.indexOf("/api/queue") > -1)      return window.__json({ items: [] });
  if (url.indexOf("/api/filters") > -1)    return window.__json({ genres: [] });
  if (url.indexOf("/api/home/") > -1)      return window.__json({ albums: [], label: null });
  if (url.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  if (url.indexOf("/api/settings") > -1)   return window.__json({});
  if (url.indexOf("/api/random-albums") > -1) return window.__json({ albums: [${JSON.stringify(ALBUM)}], total: 1, filtered: false });
  return undefined;
});`;

const DRIVER = `
  function seen() {
    var rows = Array.prototype.slice.call(document.querySelectorAll("#modal-tracks li.t-row"));
    var lefts = rows.map(function (li) { return Math.round(li.querySelector(".t-title").getBoundingClientRect().left); });
    var on = rows.map(function (li) { return li.querySelector(":scope > .now-disc") ? li.querySelector(".t-title").textContent : null; }).filter(Boolean);
    var disc = document.querySelector("#modal-tracks .now-disc");
    var place = null;
    if (disc) {
      var li = disc.closest("li"), svg = disc.querySelector("svg").getBoundingClientRect(), title = li.querySelector(".t-title").getBoundingClientRect();
      var row = li.getBoundingClientRect();
      place = { beforeTitle: svg.right <= title.left, afterRowStart: svg.left >= row.left, onTitleLine: Math.abs((svg.top + svg.bottom) / 2 - (title.top + 10)) <= 3,
        turning: getComputedStyle(disc.querySelector("svg")).animationName === "now-disc-turn", paused: disc.classList.contains("is-paused"),
        playState: getComputedStyle(disc.querySelector("svg")).animationPlayState };
    }
    return { on: on, titlesStill: lefts.every(function (x) { return x === lefts[0]; }), place: place };
  }
  await window.__sleep(700);
  var bar = document.getElementById("mini-transport");
  for (var w = 0; w < 40 && bar.classList.contains("hidden"); w++) await window.__sleep(100);
  window.__openAlbum(${JSON.stringify(ALBUM)}, { source: "search" });
  await window.__sleep(1500);
  T("playing", seen());
  window.__zone.state = "paused";
  await window.__sleep(2500);
  T("paused", seen());
  window.__zone.state = "playing";
  window.__zone.now_playing = { line1: "Rip in Heaven", line2: "'Til Tuesday", line3: ${JSON.stringify(OTHER.title)}, length: 200, seek_position: 3 };
  await window.__sleep(2500);
  T("otherAlbumPlaying", seen());
  window.__openAlbum(${JSON.stringify(OTHER)}, { source: "search" });
  await window.__sleep(1500);
  T("thatAlbum", seen());
`;

for (const [size, args] of [["390x844", null], ["1920x1080", harness.MOUSE]]) {
  test(`v1.9.72-t16 (${size}): the playing track's disc, turning; paused, it stops; another album's track, it moves there`, { skip: !harness.available }, async (t) => {
    const r = harness.renderPage({ name: "now-disc-" + size, windowSize: size, stub: STUB, driver: DRIVER, chromeArgs: args || undefined, budgetMs: 25000 });
    harness.assertNoPageError(assert, r);
    await t.test("THE one: the disc on the playing track, and only there", () => {
      assert.deepEqual(r.playing.on, ["On Sunday"]);
    });
    await t.test("between the number and the name, on the name's line, turning; the titles don't move", () => {
      assert.deepEqual(r.playing.place, { beforeTitle: true, afterRowStart: true, onTitleLine: true, turning: true, paused: false, playState: "running" });
      assert.equal(r.playing.titlesStill, true);
    });
    await t.test("paused, it stops where it is", () => {
      assert.deepEqual(r.paused.on, ["On Sunday"]);
      assert.equal(r.paused.place.paused, true);
      assert.equal(r.paused.place.playState, "paused");
    });
    await t.test("the zone playing another album: none here; that album's page has it on its track", () => {
      assert.deepEqual(r.otherAlbumPlaying.on, []);
      assert.deepEqual(r.thatAlbum.on, ["Rip in Heaven"]);
    });
  });
}
