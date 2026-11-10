"use strict";
// What the playlist-head tests share (playlist-head.test.js, playlist-head-layout.test.js): the fake server, and the
// driver's first lines (the menu, a tile opened by its name, the ‹, and the page read in one pass of its layout).
// The playlist-play tests take the driver's first lines, with a server of their own (playlist-play-kit.js).
// Not a test file: test/run.sh takes *.test.js only.

const harness = require("./harness");

const TOUCH = ["--blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=1,availableHoverTypes=1"];
const LONG = "An Evening Of Slow Records For The Long Road Home, And The Morning After It Too";
const ZONE = {
  zone_id: "z1", display_name: "Living Room", state: "stopped",
  settings: { shuffle: false, loop: "disabled", auto_radio: false },
  outputs: [{ output_id: "o1", display_name: "Living Room", is_muted: false, volume: null }],
  now_playing: null,
};
const TRACKS = [{ index: 0, title: "Teen Age Riot", subtitle: "Sonic Youth", image_key: null },
  { index: 1, title: "Tomorrow", subtitle: "Built to Spill", image_key: null }];

const STUB = `
try { localStorage.setItem("rra-zone", "z1"); } catch (e) { /* storage optional */ }
window.__installFetch(function (url) {
  var u = decodeURIComponent(url);
  if (u.indexOf("/api/roon-smart/items") > -1)
    return window.__json({ name: "r&b random", count: 1, page: 0, pages: 1, complete: true,
      items: [{ title: "Rumours 1", artist: "Fleetwood Mac", album: "Rumours" }] });
  if (u.indexOf("/api/roon-smart") > -1)
    return window.__json({ available: true, playlists: [{ id: "ab12", name: "r&b random", tracks: 5007, images: [] }] });
  if (u.indexOf("/api/roon-playlists") > -1) return window.__json({ available: false, why: "" });
  if (u.indexOf("/api/smart-playlists") > -1)
    return window.__json({ playlists: [{ id: "sp1", name: "Nineties", album_total: 3, art_keys: [], mode: "albums", view: {} }] });
  if (u.indexOf("/api/smart-playlist") > -1) return window.__json({ albums: [], tracks: [], total: 0 });
  if (u.indexOf("/api/user-playlists") > -1)
    return window.__json({ playlists: [{ id: "u1", name: "Rouen Mix", track_total: 2, art_keys: [] },
      { id: "u2", name: "Lost Mix", track_total: 4, art_keys: [] }, { id: "u3", name: "Drive", track_total: 2, art_keys: [] }] });
  if (u.indexOf("/api/user-playlist") > -1) {
    if (u.indexOf("id=u2") > -1) return window.__json({ error: "That playlist is no longer stored." }, 500);
    // u3 was renamed since the list was read: the page's name is the one the read gives, not the tile's.
    return window.__json({ id: "u1", name: u.indexOf("id=u3") > -1 ? "Drive Home" : "Rouen Mix", track_total: 2,
      tracks: [{ title: "Teen Age Riot", artist: "Sonic Youth", album: "Daydream Nation" },
               { title: "Tomorrow", artist: "Built to Spill", album: "Keep It Like a Secret" }] });
  }
  if (u.indexOf("/api/playlists") > -1)
    return window.__json({ playlists: [{ offset: 0, title: "Late Night", subtitle: "49 Tracks", image_key: null },
      { offset: 1, title: ${JSON.stringify(LONG)}, subtitle: "12 Tracks", image_key: null },
      { offset: 2, title: "Broken", subtitle: "3 Tracks", image_key: null },
      { offset: 3, title: "Sundays", subtitle: "2 Tracks", image_key: null }], total: 4 });
  if (u.indexOf("/api/playlist/art") > -1) return window.__json({ art_keys: [] });
  if (u.indexOf("/api/playlist/track-artists") > -1) return window.__json({ status: "off" });
  if (u.indexOf("/api/playlist?") > -1) {
    if (u.indexOf("title=Broken") > -1) return window.__json({ error: "Roon didn't answer for that playlist." }, 500);
    var long = u.indexOf("title=An Evening") > -1;
    return window.__json({ title: long ? ${JSON.stringify(LONG)} : u.indexOf("title=Sundays") > -1 ? "Sunday Mornings" : "Late Night", subtitle: long ? "12 Tracks" : "49 Tracks",
      image_key: null, tracks: ${JSON.stringify(TRACKS)}, total: 2, truncated: false, can_play: true });
  }
  if (u.indexOf("/api/artist-albums") > -1) return window.__json({ primary: [], featured: [] });
  if (u.indexOf("/api/update/status") > -1) return window.__json({ is_docker: true });   // no "Switch to Docker" banner
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (u.indexOf("/api/queue") > -1) return window.__json({ items: [], history: [] });
  if (u.indexOf("/api/random-albums") > -1) return window.__json({ albums: [], total: 0, filtered: false });
  if (u.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});`;

// What every driver below starts with: the menu, a tile opened by its name, the ‹, and the page read in one pass.
const HELPERS = `
  await window.__sleep(600);
  var root = document.documentElement;
  var texts = function (sel) { return Array.prototype.map.call(document.querySelectorAll(sel), function (e) { return e.textContent; }); };
  var menu = async function (action) {
    document.getElementById("menu-toggle").click();
    await window.__sleep(200);
    document.querySelector('[data-action="' + action + '"]').click();
    await window.__sleep(800);
  };
  var open = async function (title) {
    var t = Array.prototype.filter.call(document.querySelectorAll("#album-grid .album"), function (x) {
      return (x.querySelector(".album-title") || {}).textContent === title; })[0];
    if (!t) throw new Error("no tile named " + title + " among " + JSON.stringify(texts("#album-grid .album .album-title")));
    t.click();
    await window.__sleep(800);
  };
  var back = async function () { document.getElementById("topbar-back").click(); await window.__sleep(800); };
  var box = function (e) {
    if (!e) return null;
    var r = e.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  };
  // A box when it is on screen, else null (the page's line moved beside the name is not shown, 2.0.4-t10).
  var shown = function (e) { return e && e.getClientRects().length ? box(e) : null; };
  var read = function () {
    var b = document.getElementById("topbar-back"), t = document.getElementById("album-count");
    var bn = document.getElementById("status-banner"), sm = document.getElementById("select-menu-wrap");
    var cs = getComputedStyle(document.querySelector("main"));
    var lines = [], range = document.createRange();
    range.selectNodeContents(t);
    // What is seen of each line: a name cut with … (2.0.4-t10) has text past its box, which is not on screen.
    var tb = t.getBoundingClientRect();
    Array.prototype.forEach.call(range.getClientRects(), function (r0) {
      if (!r0.width) return;
      var r = { top: r0.top, bottom: r0.bottom, left: r0.left, right: Math.min(r0.right, tb.right) };
      var last = lines[lines.length - 1];
      if (last && Math.abs(last.top - r.top) < 2) { last.left = Math.min(last.left, r.left); last.right = Math.max(last.right, r.right); return; }
      lines.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
    });
    return {
      back: box(b), backShown: !b.classList.contains("hidden"), label: b.getAttribute("aria-label"), tip: b.title,
      title: t.classList.contains("hidden") ? "" : t.textContent, titleIn: t.parentNode.id || t.parentNode.className,
      clipped: t.scrollWidth > t.clientWidth, role: t.getAttribute("role") || "",
      lines: lines, sub: shown(document.querySelector(".playlist-detail .playlist-sub")),
      count: shown(document.querySelector("#tnav-heading .plt-count")),
      countText: (document.querySelector("#tnav-heading .plt-count") || {}).textContent || "",
      subText: (document.querySelector(".playlist-detail .playlist-sub") || {}).textContent || "",
      actions: box(document.querySelector(".playlist-detail .playlist-actions")),
      btns: Array.prototype.map.call(document.querySelectorAll(".playlist-detail .playlist-actions > .action-btn"), box),
      rowEnd: box(document.querySelector(".playlist-detail .playlist-actions > :last-child")),
      pills: document.querySelectorAll(".playlist-detail .playlist-back").length,
      headings: document.querySelectorAll(".playlist-detail .playlist-title").length,
      pl: root.classList.contains("pl-page"), detail: !!document.querySelector("#album-grid .playlist-detail"),
      tiles: texts("#album-grid .album:not(#new-smart-tile) .album-title"), home: root.classList.contains("tn-home"),
      banner: bn && !bn.classList.contains("hidden") ? bn.textContent : "",
      bannerBox: bn && !bn.classList.contains("hidden") ? box(bn) : null,
      sel: sm && !sm.classList.contains("hidden") ? box(sm) : null, selecting: root.classList.contains("tn-select"),
      bar: box(document.querySelector(".topbar")), contentLeft: box(document.querySelector("main")).left + parseFloat(cs.paddingLeft),
      scrolled: document.querySelector("main").scrollTop, width: window.innerWidth
    };
  };
`;

/** The Playlists screen's tiles, Rouen's own first, and the Dynamic Playlists'. */
const TILES = ["Rouen Mix", "Lost Mix", "Drive", "Late Night", LONG, "Broken", "Sundays"];
const WALL = ["Nineties", "r&b random"];
const mid = (/** @type {{ top: number, bottom: number }} */ r) => (r.top + r.bottom) / 2;

module.exports = { harness, TOUCH, LONG, STUB, HELPERS, TILES, WALL, mid };
