"use strict";
// ---------------------------------------------------------------------------
// v2.0.3-t9: a playlist's page has one way back and its name on that line (public/playlist-head.js).
//
// The owner, 2026-11-09, of a Roon playlist's page on a phone: "Too much wasted space at the top of the playlist
// screens. The double back button is not correct. The brass < chevron is the correct and only button. It should take
// you back to the previous screen which is the overview playlist screen I came from to view this playlist. Put the
// name of the playlist on the same line as the brass < chevron and if two lines place the second row under the first
// without the top line moving position."
//
// What was there: the bar's ‹ (which went Home, two screens back), under it the page's own "← Playlists" pill, under
// that the name as a heading with a rule, and only then the count and Play. The four pages that drew that header (a
// Roon playlist, one stored by Rouen, a Dynamic Playlist, one of Roon's smart playlists) are all held here.
//
// Every position compared below is read in one pass of the page (getBoundingClientRect and a Range's rects, the
// same layout), never a rect against a screenshot (dev/lessons.md). Not shown here: a phone's safe areas.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
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
    return window.__json({ playlists: [{ id: "u1", name: "Rouen Mix", track_total: 2, art_keys: [] }] });
  if (u.indexOf("/api/user-playlist") > -1)
    return window.__json({ id: "u1", name: "Rouen Mix", track_total: 2,
      tracks: [{ title: "Teen Age Riot", artist: "Sonic Youth", album: "Daydream Nation" },
               { title: "Tomorrow", artist: "Built to Spill", album: "Keep It Like a Secret" }] });
  if (u.indexOf("/api/playlists") > -1)
    return window.__json({ playlists: [{ offset: 0, title: "Late Night", subtitle: "49 Tracks", image_key: null },
      { offset: 1, title: ${JSON.stringify(LONG)}, subtitle: "12 Tracks", image_key: null },
      { offset: 2, title: "Broken", subtitle: "3 Tracks", image_key: null }], total: 3 });
  if (u.indexOf("/api/playlist/art") > -1) return window.__json({ art_keys: [] });
  if (u.indexOf("/api/playlist/track-artists") > -1) return window.__json({ status: "off" });
  if (u.indexOf("/api/playlist?") > -1) {
    if (u.indexOf("title=Broken") > -1) return window.__json({ error: "Roon didn't answer for that playlist." }, 500);
    var long = u.indexOf("title=An Evening") > -1;
    return window.__json({ title: long ? ${JSON.stringify(LONG)} : "Late Night", subtitle: long ? "12 Tracks" : "49 Tracks",
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
  var read = function () {
    var b = document.getElementById("topbar-back"), t = document.getElementById("album-count");
    var bn = document.getElementById("status-banner");
    var lines = [], range = document.createRange();
    range.selectNodeContents(t);
    Array.prototype.forEach.call(range.getClientRects(), function (r) {
      if (!r.width) return;
      var last = lines[lines.length - 1];
      if (last && Math.abs(last.top - r.top) < 2) { last.left = Math.min(last.left, r.left); last.right = Math.max(last.right, r.right); return; }
      lines.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
    });
    return {
      back: box(b), backShown: !b.classList.contains("hidden"), label: b.getAttribute("aria-label"), tip: b.title,
      title: t.classList.contains("hidden") ? "" : t.textContent, titleIn: t.parentNode.id || t.parentNode.className,
      clipped: t.scrollWidth > t.clientWidth,
      lines: lines, sub: box(document.querySelector(".playlist-detail .playlist-sub")),
      subText: (document.querySelector(".playlist-detail .playlist-sub") || {}).textContent || "",
      actions: box(document.querySelector(".playlist-detail .playlist-actions")),
      pills: document.querySelectorAll(".playlist-detail .playlist-back").length,
      headings: document.querySelectorAll(".playlist-detail .playlist-title").length,
      pl: root.classList.contains("pl-page"), detail: !!document.querySelector("#album-grid .playlist-detail"),
      tiles: texts("#album-grid .album:not(#new-smart-tile) .album-title"), home: root.classList.contains("tn-home"),
      banner: bn && !bn.classList.contains("hidden") ? bn.textContent : "",
      scrolled: document.querySelector("main").scrollTop, width: window.innerWidth
    };
  };
`;

// The four pages, each read as it stands when opened.
const PAGES_DRIVER = HELPERS + `
  await menu("playlists");
  await open("Late Night");   T("roon", read());   await back();
  await open(${JSON.stringify(LONG)}); T("long", read()); await back();
  await open("Rouen Mix");    T("mine", read());   await back();
  T("overview", read());
  await menu("smart-playlists");
  await open("Nineties");     T("dynamic", read()); await back();
  await open("r&b random");   T("smart", read());   await back();
  T("wall", read());
`;

const mid = (r) => (r.top + r.bottom) / 2;

for (const [size, what] of [["390x844", "a phone"], ["350x700", "a small phone (the 33px buttons)"], ["820x1180", "a tablet"]]) {
  test(`touch, ${what}: the playlist's name on the ‹'s line, a second line under the first, no pill and no heading of its own`, async () => {
    if (!harness.available) return;
    const r = harness.renderPage({ name: "playlist-head-" + size, windowSize: size, budgetMs: 30000, chromeArgs: TOUCH, stub: STUB, driver: PAGES_DRIVER });
    harness.assertNoPageError(assert, r);
    const names = { roon: "Late Night", long: LONG, mine: "Rouen Mix", dynamic: "Nineties", smart: "r&b random" };
    for (const k of Object.keys(names)) {
      const g = r[k];
      assert.ok(g, k + ": the page was never read");
      assert.equal(g.title, names[k], k + ": the screen's title is not the playlist's name");
      assert.equal(g.titleIn, "tnav-heading", k + ": the name is not the page's heading");
      assert.equal(g.pills, 0, k + ": the page still draws its own back button");
      assert.equal(g.headings, 0, k + ": the page still prints the name a second time");
      assert.equal(g.backShown, true, k + ": no ‹");
      assert.equal(g.pl, true, k + ": the page is not marked a playlist's page");
      assert.equal(g.scrolled, 0, k + ": read while scrolled");
      assert.ok(g.lines.length >= 1, k + ": the name has no line");
      assert.ok(Math.abs(mid(g.lines[0]) - mid(g.back)) <= 1.5,
        `${k}: the name's first line is centred at ${mid(g.lines[0])}, the ‹ at ${mid(g.back)}`);
      assert.ok(g.lines[0].left >= g.back.right && g.lines[0].left <= g.back.right + 24,
        `${k}: the name starts at ${g.lines[0].left}, the ‹ ends at ${g.back.right}`);
      const last = g.lines[g.lines.length - 1];
      assert.ok(g.sub, k + ": no line under the name");
      assert.ok(Math.abs(g.sub.left - g.lines[0].left) <= 1, `${k}: the line under the name starts at ${g.sub.left}, the name at ${g.lines[0].left}`);
      assert.ok(g.sub.top >= last.bottom - 3, `${k}: the line under the name (${g.sub.top}) is over the name (${last.bottom})`);
      assert.ok(g.actions, k + ": no buttons");
      const foot = Math.max(g.back.bottom, last.bottom);
      assert.ok(g.actions.top >= g.sub.bottom && g.actions.top - foot <= 60,
        `${k}: the buttons start ${g.actions.top - foot}px under the name's line (the wasted space)`);
    }
    assert.equal(r.roon.label, "Back to Playlists");
    assert.equal(r.mine.label, "Back to Playlists");
    assert.equal(r.dynamic.label, "Back to Dynamic Playlists");
    assert.equal(r.smart.label, "Back to Dynamic Playlists");
    assert.equal(r.roon.subText, "49 Tracks");
    assert.equal(r.mine.subText, "2 tracks");
    assert.match(r.dynamic.subText, /^Albums · album order/);
    assert.match(r.smart.subText, /Smart playlist in Roon$/);
    // One line of name: the buttons begin within two of the ‹'s heights of the top (they began near 250px).
    assert.equal(r.roon.lines.length, 1, "a short name on more than one line");
    assert.ok(r.roon.actions.top <= 130, `the buttons of a short-named playlist start ${r.roon.actions.top}px down`);
    // Two lines or more: the second under the first, and the first where a short name's is.
    assert.ok(r.long.lines.length >= 2, "the long name is on one line: " + JSON.stringify(r.long.lines));
    assert.ok(Math.abs(r.long.lines[1].left - r.long.lines[0].left) <= 1, "the second line doesn't start under the first");
    assert.ok(Math.abs(r.long.lines[0].top - r.roon.lines[0].top) <= 0.5,
      `a second line moved the first: ${r.long.lines[0].top} against ${r.roon.lines[0].top}`);
    assert.ok(r.long.lines[1].top >= r.long.lines[0].bottom - 3, "the second line is over the first");
    // The ‹ went back to the screen each was opened from, and that screen is not a playlist's page.
    assert.equal(r.overview.detail, false);
    assert.deepEqual(r.overview.tiles, ["Rouen Mix", "Late Night", LONG, "Broken"]);
    assert.equal(r.overview.title, "Playlists");
    assert.equal(r.overview.pl, false);
    assert.equal(r.overview.label, "Back to Home");
    assert.equal(r.wall.detail, false);
    assert.deepEqual(r.wall.tiles, ["Nineties", "r&b random"]);
    assert.equal(r.wall.pl, false);
    assert.equal(r.wall.label, "Back to Home");
  });
}

test("the ‹ goes back to the screen the playlist was opened from, and only while the playlist's page is up", async () => {
  if (!harness.available) return;
  const driver = HELPERS + `
  await menu("playlists");
  T("overview0", read());
  await open("Late Night");
  T("page", read());
  // An artist's page over the playlist's: its own ‹ comes back to the playlist, which still knows its way back.
  window.__showArtistAlbums("Sonic Youth");
  await window.__sleep(800);
  T("artist", read());
  await back();
  T("fromArtist", read());
  await back();
  T("overview1", read());
  // A playlist that didn't open: the name, the reason, and the same way back.
  await open("Broken");
  T("broken", read());
  await back();
  T("overview2", read());
  // Left by another road, the page is over: the next ‹ is the next screen's.
  await open("Late Night");
  document.getElementById("tnav-home").click();
  await window.__sleep(800);
  T("home", read());
  await menu("playlists");
  T("overview3", read());
  await back();
  T("homeAgain", read());
  // The page that didn't open, left by the menu: the Dynamic Playlists' ‹ goes Home, not to Playlists.
  await menu("playlists");
  await open("Broken");
  await menu("smart-playlists");
  T("wall", read());
  await back();
  T("homeFromWall", read());
  // An artist's page over a playlist's, left by the menu: the playlist's "Back to Playlists" is not left on the ‹.
  await menu("playlists");
  await open("Late Night");
  window.__showArtistAlbums("Sonic Youth");
  await window.__sleep(800);
  await menu("smart-playlists");
  T("wall2", read());
  await open("r&b random");
  T("smart", read());
  await back();
  T("wall3", read());
  // The module itself: a page whose wrap has been in the grid is over once the wrap is gone, whatever it says of itself.
  var g = document.getElementById("album-grid"), w = document.createElement("div");
  var mount = window.RouenPlaylistHead.enter({ to: "Playlists", back: function () {}, live: function () { return true; } });
  T("apiLoading", window.RouenPlaylistHead.showing());
  g.innerHTML = ""; g.appendChild(w); mount(w, "one line");
  T("apiUp", window.RouenPlaylistHead.showing());
  g.innerHTML = "";
  T("apiGone", window.RouenPlaylistHead.showing());
`;
  const r = harness.renderPage({ name: "playlist-head-back", windowSize: "390x844", budgetMs: 45000, chromeArgs: TOUCH, stub: STUB, driver });
  harness.assertNoPageError(assert, r);
  const tiles = ["Rouen Mix", "Late Night", LONG, "Broken"];
  assert.deepEqual([r.overview0.title, r.overview0.label, r.overview0.pl], ["Playlists", "Back to Home", false]);
  assert.deepEqual([r.page.title, r.page.label, r.page.tip, r.page.pl, r.page.detail], ["Late Night", "Back to Playlists", "Playlists", true, true]);
  assert.deepEqual([r.artist.label, r.artist.pl, r.artist.detail], ["Back", false, false], "an artist's page laid out as a playlist's");
  assert.deepEqual([r.fromArtist.title, r.fromArtist.label, r.fromArtist.pl, r.fromArtist.detail], ["Late Night", "Back to Playlists", true, true],
    "the playlist's page didn't come back from the artist's as it was");
  assert.deepEqual([r.overview1.detail, r.overview1.home, r.overview1.title, r.overview1.label, r.overview1.pl], [false, false, "Playlists", "Back to Home", false],
    "the ‹ of a playlist come back from an artist's page didn't go to Playlists");
  assert.deepEqual(r.overview1.tiles, tiles);
  assert.deepEqual([r.broken.title, r.broken.detail, r.broken.label, r.broken.pl], ["Broken", false, "Back to Playlists", true]);
  assert.match(r.broken.banner, /Roon didn't answer for that playlist/);
  assert.deepEqual([r.overview2.home, r.overview2.title], [false, "Playlists"], "the ‹ of a playlist that didn't open went Home");
  assert.deepEqual(r.overview2.tiles, tiles);
  assert.deepEqual([r.home.home, r.home.pl, r.home.label], [true, false, "Back to Home"]);
  assert.deepEqual([r.overview3.title, r.overview3.pl, r.overview3.label], ["Playlists", false, "Back to Home"]);
  assert.equal(r.homeAgain.home, true, "the Playlists screen's ‹ didn't go Home");
  assert.deepEqual([r.wall.title, r.wall.pl, r.wall.label, r.wall.banner], ["Dynamic Playlists", false, "Back to Home", ""]);
  assert.equal(r.homeFromWall.home, true, "the ‹ of Dynamic Playlists went back to a playlist's page that was left");
  assert.deepEqual([r.wall2.title, r.wall2.pl, r.wall2.label], ["Dynamic Playlists", false, "Back to Home"],
    "a playlist's label left on the ‹ after its page was left from an artist's");
  assert.deepEqual([r.smart.title, r.smart.label, r.smart.pl], ["r&b random", "Back to Dynamic Playlists", true]);
  assert.deepEqual(r.wall3.tiles, ["Nineties", "r&b random"]);
  assert.equal(r.wall3.home, false);
  assert.deepEqual([r.apiLoading, r.apiUp, r.apiGone], [true, true, false], "a page that was up and is gone still counts as up");
});

test("a mouse: the name in the bar beside the ‹, whole while there is room; the same single way back", async () => {
  if (!harness.available) return;
  const driver = HELPERS + `
  await menu("playlists");
  await open("Late Night");
  T("page", read());
  await back();
  T("overview", read());
  await open(${JSON.stringify(LONG)});
  T("long", read());
  await menu("smart-playlists");
  await open("Nineties");
  T("dynamic", read());
  await back();
  T("wall", read());
`;
  // 800px wide: the long name is wider than half the window (the title's limit elsewhere) and narrower than the bar.
  const r = harness.renderPage({ name: "playlist-head-mouse", windowSize: "800x600", budgetMs: 30000, chromeArgs: harness.MOUSE, stub: STUB, driver });
  harness.assertNoPageError(assert, r);
  assert.equal(r.long.title, LONG);
  assert.equal(r.long.lines.length, 1, "the bar's title wrapped");
  assert.ok(r.long.lines[0].right - r.long.lines[0].left > r.long.width / 2, "the long name is not wider than half this window: the test shows nothing");
  assert.equal(r.long.clipped, false, "a name the bar has room for is cut short");
  for (const [k, name, to] of [["page", "Late Night", "Playlists"], ["dynamic", "Nineties", "Dynamic Playlists"]]) {
    const g = r[k];
    assert.equal(g.title, name);
    assert.notEqual(g.titleIn, "tnav-heading", k + ": the bar's title moved out of the bar for a mouse");
    assert.deepEqual([g.pills, g.headings], [0, 0], k + ": the page's own back button or heading is still drawn");
    assert.equal(g.label, "Back to " + to);
    assert.equal(g.lines.length, 1);
    assert.ok(g.lines[0].left >= g.back.right, k + ": the name is not after the ‹");
    assert.ok(Math.abs(mid(g.lines[0]) - mid(g.back)) <= 2, `${k}: the name (${mid(g.lines[0])}) is not on the ‹'s line (${mid(g.back)})`);
    assert.ok(g.sub && g.actions && g.actions.top >= g.sub.bottom, k + ": no line of what it is over the buttons");
  }
  assert.deepEqual([r.overview.detail, r.overview.title, r.overview.label], [false, "Playlists", "Back to Home"]);
  assert.deepEqual(r.overview.tiles, ["Rouen Mix", "Late Night", LONG, "Broken"]);
  assert.deepEqual([r.wall.detail, r.wall.title], [false, "Dynamic Playlists"]);
});
