"use strict";
// ---------------------------------------------------------------------------
// v2.0.3-t8: the side menu, now reached from every screen (dev/design/artists.md §2), leaves each of them properly.
//
// From v1.9.70-t6 the touch layout's menu was on Home only, so each entry's handler had only ever run from Home.
// The bar's Menu runs them from every screen, and the review of v2.0.3-t8 found what that had been hiding:
//   - "Labels" is a switch, not a destination (app.js: on the Labels list or a label's page it turns Labels OFF and
//     draws the random wall), and it never left an artist's page or the "Not played" wall, whose Back and whose live
//     re-read then acted on the Labels list;
//   - "Wall display" goes to another page and promises "the remote comes back as it was left": closing an album's
//     page first broke that promise;
//   - a second tap on Menu landed on whatever menu entry had slid in under the finger;
//   - Escape closed the menu AND the album's page under it, in one press (every Escape handler heard it).
// What cannot be shown here: a real finger's double tap. The second tap is a click made with the Menu button's own
// coordinates, which is what the browser sends.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const TOUCH = ["--blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=1,availableHoverTypes=1"];
const ALBUMS = [];
for (let i = 0; i < 30; i++) ALBUMS.push({ offset: i, title: "Album " + i, subtitle: "Artist " + i, image_key: null });
const LABELS = ["4AD", "Blue Note", "ECM"];
const ZONE = {
  zone_id: "z1", display_name: "Living Room", state: "playing",
  is_previous_allowed: true, is_next_allowed: true, is_seek_allowed: true,
  settings: { shuffle: false, loop: "disabled", auto_radio: false },
  outputs: [{ output_id: "o1", display_name: "Living Room", is_muted: false,
              volume: { type: "number", min: 0, max: 100, value: 40, step: 1 } }],
  now_playing: { line1: "Our First Trip", line2: "The Odyssey Cult", line3: "Vol. 3",
                 image_key: "", length: 212, seek_position: 40 },
};
const DETAIL = { title: "Album 0", subtitle: "Artist 0", image_key: null,
  actions: [{ kind: "play_now", title: "Play Now" }, { kind: "queue", title: "Queue" }],
  tracks: Array.from({ length: 8 }, (_, i) => ({ title: "Track " + (i + 1), subtitle: "Artist 0" })) };

const STUB = `
window.__zone = ${JSON.stringify(ZONE)};
window.__rev = { snapshot: "1", library: "1.0", dates: "0", plays: "0", settings: "0",
                 labels: "0.0.0", picks: "0", discover: "0", day: "2026-11-09" };
window.__unplayedAsks = 0;
try {
  localStorage.setItem("rra-zone", "z1");
  localStorage.removeItem("rra-library-view");
  localStorage.removeItem("rra-album-view");
} catch (e) { /* storage optional */ }
var ALBUMS = ${JSON.stringify(ALBUMS)};
window.__installFetch(function (u) {
  if (u.indexOf("/api/live") > -1)           return window.__json({ rev: window.__rev });
  if (u.indexOf("/api/filters/labels") > -1)
    return window.__json({ labels: ${JSON.stringify(LABELS)}.map(function (t, i) {
      return { title: t, key: "k" + i, subtitle: "3 albums", albumCount: 3 }; }), scanning: false });
  if (u.indexOf("/api/label-albums") > -1)   return window.__json({ albums: ALBUMS.slice(0, 3), total: 3 });
  if (u.indexOf("/api/settings/labels") > -1) return window.__json({ enabled: true });
  if (u.indexOf("/api/artist-albums") > -1)  return window.__json({ primary: ALBUMS.slice(0, 4), featured: [] });
  if (u.indexOf("/api/library/facets") > -1)
    return window.__json({ total: 30, dated: 0, decades: [], sources: [], hasPlays: false });
  if (u.indexOf("/api/library/albums") > -1) return window.__json({ albums: ALBUMS, offset: 0, total: 30 });
  if (u.indexOf("/api/random-albums") > -1)  return window.__json({ albums: ALBUMS, total: 30, filtered: false });
  if (u.indexOf("/api/album/extras") > -1)   return window.__json({ album: null });
  if (u.indexOf("/api/album") > -1)          return window.__json(${JSON.stringify(DETAIL)});
  if (u.indexOf("/api/zone-state") > -1)     return window.__json({ zone: window.__zone });
  if (u.indexOf("/api/zones") > -1)          return window.__json({ zones: [window.__zone] });
  if (u.indexOf("/api/queue") > -1)          return window.__json({ items: [], history: [] });
  if (u.indexOf("/api/filters") > -1)        return window.__json({ genres: [] });
  if (u.indexOf("/api/home/unplayed") > -1) { window.__unplayedAsks++; return window.__json({ albums: ALBUMS.slice(0, 10) }); }
  if (u.indexOf("/api/home/") > -1)          return window.__json({ albums: ALBUMS.slice(0, 10), label: null });
  if (u.indexOf("/api/status") > -1)         return window.__json({ paired: true });
  if (u.indexOf("/api/user-playlists") > -1) return window.__json({ playlists: [] });
  if (u.indexOf("/api/update/status") > -1)  return window.__json({ is_docker: true });
  if (u.indexOf("/api/") > -1)               return window.__json({});
  return undefined;
});
`;

const DRIVER = `
  var html = document.documentElement;
  function $(id) { return document.getElementById(id); }
  function q(sel) { return document.querySelector(sel); }
  function n(sel) { return document.querySelectorAll(sel).length; }
  function shown(el) { return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden"; }
  async function until(f, what) {
    for (var i = 0; i < 80; i++) { var v = f(); if (v) return v; await window.__sleep(50); }
    throw new Error("not in time: " + what);
  }
  async function soon(f) { for (var i = 0; i < 30; i++) { if (f()) return true; await window.__sleep(50); } return false; }
  function albumOpen() { return !$("album-modal").classList.contains("hidden"); }
  function menuOpen() { var m = $("menu-overlay"); return !m.classList.contains("hidden") && shown(m); }
  function settingsOpen() { var s = $("settings-overlay"); return !!s && !s.classList.contains("hidden"); }
  function title() { return $("album-count").textContent.trim(); }
  // The bar's Menu; where the bar has none, the page's own, so what an entry does is still seen.
  async function openMenu() {
    var b = $("tnav-menu");
    if (b) b.click(); else $("menu-toggle").click();
    return await soon(menuOpen);
  }
  async function closeMenu() { q("#menu-overlay .menu-backdrop").click(); await window.__sleep(80); }
  async function openAlbum(i) {
    window.__openAlbum(ALBUMS[i], { source: "search" });
    await until(function () { return albumOpen() && $("modal-tracks").querySelectorAll("li").length; }, "the album's page");
    await window.__sleep(150);
  }
  async function goHome() {
    window.__showHome();
    await until(function () { return html.classList.contains("tn-home"); }, "Home");
    await window.__sleep(100);
  }
  async function labelsList() {
    await until(function () { return html.classList.contains("tn-labels") && n("#album-grid .label-tile") === 3; }, "the Labels list");
  }
  // What the grid holds: [the Labels list's tools showing, label tiles, album tiles that are not labels, the title].
  function screen() { return [html.classList.contains("tn-labels"), n("#album-grid .label-tile"), n("#album-grid .album:not(.label-tile)"), title()]; }
  async function chooseLabels() {
    await openMenu();
    $("menu-item-labels").click();
    await window.__sleep(600);
  }
  function escape() { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); }
  // Other pages: going there would end this one.
  var left = [];
  window.__openShelf = function () { left.push("shelf"); };
  window.__openWallDisplay = function () { left.push("wall"); };

  await window.__sleep(800);
  await until(function () { return !$("mini-transport").classList.contains("hidden"); }, "the mini player");

  // ---- Labels, chosen from the Labels list itself: it stays the Labels list. -------------------------------------
  await chooseLabels();
  await labelsList();
  await chooseLabels();
  T("labelsFromLabels", screen());

  // ---- From one label's page: the Labels list. ---------------------------------------------------------------------
  if (!html.classList.contains("tn-labels")) { await goHome(); await chooseLabels(); }
  await labelsList();
  q("#album-grid .label-tile").click();
  await until(function () { return !html.classList.contains("tn-labels") && n("#album-grid .album:not(.label-tile)") === 3; }, "a label's page");
  await window.__sleep(100);
  await chooseLabels();
  T("labelsFromLabelPage", screen());

  // ---- From an artist's page: the artist's page is left, so the top bar's Back goes Home from the Labels list. ---
  await goHome();
  window.__showArtistAlbums("Artist 0");
  await until(function () { return window.__artistViewActive() && n("#album-grid .album") >= 4; }, "an artist's page");
  await window.__sleep(100);
  await chooseLabels();
  T("labelsFromArtist", screen().concat([window.__artistViewActive()]));
  $("topbar-back").click();
  await window.__sleep(300);
  T("backFromLabelsAfterArtist", [html.classList.contains("tn-home"), html.classList.contains("tn-labels"), window.__artistViewActive(), albumOpen()]);

  // ---- From the "Not played" wall: that wall is left, so a play counted afterwards does not redraw it over Labels. --
  await goHome();
  $("home-unplayed-title").click();
  await until(function () { return title() === "Not played in 6 months" && n("#album-grid .album") === 10; }, "the Not played wall");
  await window.__sleep(100);
  await chooseLabels();
  var asksBefore = window.__unplayedAsks;
  window.__rev = Object.assign({}, window.__rev, { plays: "1" });
  await window.__sleep(7000);
  T("labelsFromUnplayed", screen().concat([window.__unplayedAsks - asksBefore]));

  // ---- From the Artists screen. --------------------------------------------------------------------------------
  await goHome();
  $("tnav-artists").click();
  await soon(function () { return html.classList.contains("tn-artists"); });
  T("artistsUp", html.classList.contains("tn-artists"));
  await chooseLabels();
  T("labelsFromArtists", screen().concat([html.classList.contains("tn-artists")]));

  // ---- Wall display, another page that comes back to this one "as it was left": the album's page stays. -----------
  await goHome();
  await openAlbum(0);
  await openMenu();
  q('#menu-overlay .menu-item[data-action="wall-display"]').click();
  await window.__sleep(200);
  T("wallDisplay", [albumOpen(), left.slice()]);
  left.length = 0;
  if (menuOpen()) await closeMenu();

  // ---- Now playing's Queue tab: opening the menu and closing it leaves the Queue tab as it was. -------------------
  q(".mt-info").click();
  await until(function () { return $("album-modal").classList.contains("np-mode"); }, "Now playing");
  q('.modal-tab[data-tab="queue"]').click();
  await until(function () { return $("album-modal").classList.contains("tab-queue"); }, "the Queue tab");
  await window.__sleep(150);
  var upFromQueue = await openMenu();
  await closeMenu();
  var m = $("album-modal");
  T("queueAfterMenu", [upFromQueue, menuOpen(), albumOpen(), m.classList.contains("np-mode"), m.classList.contains("tab-queue")]);
  for (var k = 0; k < 3 && albumOpen(); k++) { $("modal-close-btn").click(); await window.__sleep(120); }

  // ---- Escape closes what is on top, one thing a press. -----------------------------------------------------------
  await goHome();
  await openAlbum(0);
  await openMenu();
  escape();
  await window.__sleep(120);
  T("escapeMenuOverAlbum", [menuOpen(), albumOpen()]);
  escape();
  await window.__sleep(120);
  T("escapeAlbum", [menuOpen(), albumOpen()]);
  if (!albumOpen()) await openAlbum(0);
  await openMenu();
  q('#menu-overlay .menu-item[data-target="settings-toggle"]').click();
  T("settingsUp", await soon(settingsOpen));
  escape();
  await window.__sleep(150);
  T("escapeSettingsOverAlbum", [settingsOpen(), albumOpen()]);
  if (settingsOpen()) { q("#settings-overlay [data-settings-close]").click(); await window.__sleep(120); }
  if (albumOpen()) { $("modal-close-btn").click(); await window.__sleep(150); }

  // ---- A second tap on Menu: it lands on the menu that has just opened, where Menu was. ---------------------------
  await goHome();
  var b = $("tnav-menu"), r = b ? b.getBoundingClientRect() : { left: 10, top: innerHeight - 58, width: 60, height: 58 };
  var at = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
  function tap(el, where) { el.dispatchEvent(new MouseEvent("click", where)); }
  // on an entry: not followed, the menu stays
  await openMenu();
  tap($("menu-item-shelf"), at);
  T("secondTapOnEntry", [left.slice(), menuOpen()]);
  // on the dimmed page beside the drawer: the menu stays
  if (!menuOpen()) await openMenu();
  tap(q("#menu-overlay .menu-backdrop"), at);
  T("secondTapOnBackdrop", menuOpen());
  // a tap anywhere else is a choice, straight away
  left.length = 0;
  if (!menuOpen()) await openMenu();
  tap($("menu-item-shelf"), { bubbles: true, cancelable: true, clientX: 200, clientY: 200 });
  T("tapElsewhere", [left.slice(), menuOpen()]);
  // and so is one where Menu was, once the menu has been up a moment
  left.length = 0;
  await openMenu();
  await window.__sleep(700);
  tap($("menu-item-shelf"), at);
  T("laterTapWhereMenuWas", [left.slice(), menuOpen()]);
  // the keyboard's (a click with no place) is never held back
  left.length = 0;
  await openMenu();
  $("menu-item-shelf").click();
  T("keyboardChoice", [left.slice(), menuOpen()]);
`;

test("the side menu from every screen (v2.0.3-t8)", { skip: !harness.available && "no chromium" }, async (t) => {
  const R = harness.renderPage({ stub: STUB, driver: DRIVER, name: "touch-nav-menu-screens", windowSize: "390x844",
                                 chromeArgs: TOUCH, budgetMs: 90000 });
  harness.assertNoPageError(assert, R);
  const LIST = [true, 3, 0, "Labels"];

  await t.test("Labels is a destination: chosen on the Labels list or on a label's page, the Labels list shows", () => {
    assert.deepEqual(R.labelsFromLabels, LIST, "chosen on the Labels list: [the list's tools, label tiles, album tiles, the title]");
    assert.deepEqual(R.labelsFromLabelPage, LIST, "chosen on a label's page: [the list's tools, label tiles, album tiles, the title]");
  });

  await t.test("Labels leaves an artist's page: Back from the Labels list goes Home", () => {
    assert.deepEqual(R.labelsFromArtist, [...LIST, false], "[…the Labels list, the artist's page still standing]");
    assert.deepEqual(R.backFromLabelsAfterArtist, [true, false, false, false], "Back: [Home, the Labels list still up, the artist's page still standing, an album's page opened]");
  });

  await t.test("Labels leaves the Not played wall: a play counted later does not draw that wall over the list", () => {
    assert.deepEqual(R.labelsFromUnplayed, [...LIST, 0], "[…the Labels list, times the wall was read again]");
  });

  await t.test("Labels leaves the Artists screen", () => {
    assert.equal(R.artistsUp, true, "the Artists screen did not open, so nothing is shown here");
    assert.deepEqual(R.labelsFromArtists, [...LIST, false], "[…the Labels list, the Artists screen still lit]");
  });

  await t.test("Wall display leaves an album's page open: the remote comes back as it was left", () => {
    assert.deepEqual(R.wallDisplay, [true, ["wall"]], "[the album's page open, where it went]");
  });

  await t.test("the menu opened and closed over Now playing's Queue tab leaves the Queue tab", () => {
    assert.deepEqual(R.queueAfterMenu, [true, false, true, true, true], "[the menu opened, the menu still open, the page open, Now playing, its Queue tab]");
  });

  await t.test("Escape closes the top thing only: the menu, then the album's page; Settings, not the page under it", () => {
    assert.deepEqual(R.escapeMenuOverAlbum, [false, true], "first press: [the menu open, the album's page open]");
    assert.deepEqual(R.escapeAlbum, [false, false], "second press: [the menu open, the album's page open]");
    assert.equal(R.settingsUp, true, "Settings did not open, so nothing is shown here");
    assert.deepEqual(R.escapeSettingsOverAlbum, [false, true], "over Settings: [Settings open, the album's page open]");
  });

  await t.test("a second tap on Menu does not choose the entry that slid in under it", () => {
    assert.deepEqual(R.secondTapOnEntry, [[], true], "[where it went, the menu open]");
    assert.equal(R.secondTapOnBackdrop, true, "the second tap closed the menu it had just opened");
  });

  await t.test("any other tap is a choice: elsewhere at once, where Menu was after a moment, and the keyboard's always", () => {
    assert.deepEqual(R.tapElsewhere, [["shelf"], false], "elsewhere: [where it went, the menu open]");
    assert.deepEqual(R.laterTapWhereMenuWas, [["shelf"], false], "700 ms on: [where it went, the menu open]");
    assert.deepEqual(R.keyboardChoice, [["shelf"], false], "no place: [where it went, the menu open]");
  });
});
