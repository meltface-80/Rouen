"use strict";
// ---------------------------------------------------------------------------
// v2.0.3-t8: the menu is the touch bar's first button (dev/design/artists.md §1, §2).
//
// The owner, 2026-11-09: "I also want the hamburger button to move to the bottom bar. Place it on the far left."
// From v1.9.70-t6 the menu was a ☰ at the top left of Home only, so from any other screen it was reached by going
// Home first. It is the bar's first button again: Menu · Home · Library · Artists · Shelf · Search.
//
// What is held here:
//   - six buttons in that order, each label whole inside its own button and clear of its neighbours', on a phone
//     320px wide as on one 390px wide;
//   - Menu at the far left, there to tap, never lit; Home has no ☰ of its own and its greeting is at the left edge;
//   - Menu opens the side menu from Home, from the Library and from over an album's page, and closing the menu
//     leaves that screen as it was;
//   - chosen over an album's page (or Now playing's Queue tab), an entry that goes to another screen closes that
//     page first: before this the screen chosen opened underneath it, out of sight. Settings, Pitchfork and
//     "Rescan library" close nothing; an entry added later closes the page.
// Positions compared within one assertion are read from the same page in the same pass (dev/lessons.md).
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
try {
  localStorage.setItem("rra-zone", "z1");
  localStorage.removeItem("rra-library-view");
  localStorage.removeItem("rra-album-view");
} catch (e) { /* storage optional */ }
var ALBUMS = ${JSON.stringify(ALBUMS)};
window.__installFetch(function (u) {
  if (u.indexOf("/api/filters/labels") > -1)
    return window.__json({ labels: ${JSON.stringify(LABELS)}.map(function (t, i) {
      return { title: t, key: "k" + i, subtitle: "3 albums", albumCount: 3 }; }), scanning: false });
  if (u.indexOf("/api/settings/labels") > -1) return window.__json({ enabled: true });
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
  if (u.indexOf("/api/home/") > -1)          return window.__json({ albums: ALBUMS.slice(0, 10), label: null });
  if (u.indexOf("/api/status") > -1)         return window.__json({ paired: true });
  if (u.indexOf("/api/user-playlists") > -1) return window.__json({ playlists: [] });
  // A Docker install, as every current one is: a native install's migration banner would stand above Home's greeting.
  if (u.indexOf("/api/update/status") > -1) return window.__json({ is_docker: true });
  if (u.indexOf("/api/") > -1)               return window.__json({});
  return undefined;
});
`;

const DRIVER = `
  var html = document.documentElement;
  function $(id) { return document.getElementById(id); }
  function q(sel) { return document.querySelector(sel); }
  function shown(el) { return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden"; }
  function colour(id) { var el = $(id); return el ? getComputedStyle(el).color : null; }
  // What a finger at the middle of el would touch: el itself (or inside it), or what lies over it.
  function tappable(el) { if (!el) return false; var b = el.getBoundingClientRect(); var hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!hit && el.contains(hit); }
  async function until(f, what) {
    for (var i = 0; i < 80; i++) { var v = f(); if (v) return v; await window.__sleep(50); }
    throw new Error("not in time: " + what);
  }
  async function soon(f) { for (var i = 0; i < 30; i++) { if (f()) return true; await window.__sleep(50); } return false; }
  function albumOpen() { return !$("album-modal").classList.contains("hidden"); }
  function menuOpen() { var m = $("menu-overlay"); return !m.classList.contains("hidden") && shown(m); }
  // The bar's Menu. Where the bar has none (the code before v2.0.3-t8), the menu is opened by its own control, so
  // what an entry does over an album's page is still seen, and fails for its own reason.
  async function openMenu() {
    var b = $("tnav-menu");
    if (b) b.click(); else $("menu-toggle").click();
    var opened = await soon(menuOpen);
    return !!b && opened;
  }
  async function closeMenu() { q("#menu-overlay .menu-backdrop").click(); await window.__sleep(80); }
  async function openAlbum(i) {
    window.__openAlbum(ALBUMS[i], { source: "search" });
    await until(function () { return albumOpen() && $("modal-tracks").querySelectorAll("li").length; }, "the album's page");
    await window.__sleep(150);
  }
  // The Shelf is another page: going there would end this one.
  var left = [];
  window.__openShelf = function () { left.push("shelf"); };

  await window.__sleep(800);
  await until(function () { return !$("mini-transport").classList.contains("hidden"); }, "the mini player");
  var nav = $("touch-nav");
  var btns = [].slice.call(nav.querySelectorAll(".tnav-btn"));
  T("vp", [innerWidth, innerHeight]);

  // Home: the row, its labels, Menu, the greeting. One pass.
  T("order", btns.map(function (b) { return b.textContent.trim(); }));
  T("fit", btns.map(function (b) {
    var r = document.createRange(); r.selectNodeContents(b.querySelector("span"));
    var t = r.getBoundingClientRect(), bb = b.getBoundingClientRect();
    return { label: b.textContent.trim(), l: bb.left, r: bb.right, tl: t.left, tr: t.right, tw: t.width };
  }));
  var menu = $("tnav-menu");
  T("menuFirst", !!menu && btns[0] === menu);
  T("menuLeft", menu ? Math.round(menu.getBoundingClientRect().left) : null);
  T("menuTappable", tappable(menu));
  T("menuName", menu ? menu.getAttribute("aria-label") : null);
  T("lit", { menu: colour("tnav-menu"), home: colour("tnav-home"), shelf: colour("tnav-shelf") });
  T("homeOwnMenu", !!$("tnav-home-menu"));
  T("greetingIn", Math.round($("home-greeting-text").getBoundingClientRect().left - $("home-greeting").getBoundingClientRect().left));
  T("barMenu", shown($("menu-toggle")));

  // Menu from Home: the side menu; closed, Home is as it was.
  T("fromHome", await openMenu());
  await closeMenu();
  T("homeAfter", [menuOpen(), html.classList.contains("tn-home")]);

  // Home's search open: the top bar is back (on Home it is otherwise hidden whole), and its own ☰ is not in it.
  $("tnav-search").click();
  await until(function () { return html.classList.contains("tn-search") && shown(q(".topbar-row")); }, "Home's search, the bar back");
  T("barMenuSearching", shown($("menu-toggle")));
  document.body.click();
  await until(function () { return !html.classList.contains("tn-search"); }, "the search closed");

  // Menu from the Library; closed, still the Library.
  $("tnav-library").click();
  await until(function () { return html.classList.contains("tn-lib"); }, "the Library wall");
  await window.__sleep(150);
  T("fromLibrary", await openMenu());
  await closeMenu();
  T("libraryAfter", [menuOpen(), html.classList.contains("tn-lib")]);

  // Over an album's page: Menu is there to tap, opens the menu over the page, and closing it gives the page back.
  await openAlbum(0);
  T("menuTappableOverAlbum", tappable($("tnav-menu")));
  T("fromAlbum", await openMenu());
  T("albumUnderMenu", albumOpen());
  await closeMenu();
  T("albumAfter", [menuOpen(), albumOpen()]);

  // Settings: over the page, which is still there when it closes.
  await openMenu();
  q('#menu-overlay .menu-item[data-target="settings-toggle"]').click();
  var settingsUp = await soon(function () { var s = $("settings-overlay"); return s && !s.classList.contains("hidden"); });
  T("settings", [settingsUp, albumOpen(), menuOpen()]);
  var sx = q("#settings-overlay [data-settings-close]"); if (sx) sx.click();
  await window.__sleep(150);
  T("settingsClosed", [!!$("settings-overlay") && !$("settings-overlay").classList.contains("hidden"), albumOpen()]);

  // Pitchfork: the same.
  await openMenu();
  q('#menu-overlay .menu-item[data-target="pitchfork-toggle"]').click();
  var pitchforkUp = await soon(function () { return !$("pitchfork-overlay").classList.contains("hidden"); });
  T("pitchfork", [pitchforkUp, albumOpen(), menuOpen()]);
  $("pitchfork-overlay-close").click();
  await window.__sleep(150);
  T("pitchforkClosed", [!$("pitchfork-overlay").classList.contains("hidden"), albumOpen()]);

  // Rescan library goes nowhere: the page stays.
  await openMenu();
  q('#menu-overlay .menu-item[data-action="rescan-library"]').click();
  await window.__sleep(300);
  T("rescan", [albumOpen(), menuOpen()]);

  // Labels, a screen of its own: the page closes and the Labels list is what shows.
  await openMenu();
  $("menu-item-labels").click();
  await soon(function () { return !albumOpen() && html.classList.contains("tn-labels"); });
  await window.__sleep(100);
  T("labels", [albumOpen(), html.classList.contains("tn-labels"), menuOpen()]);

  // The Shelf, another page: the album's page closes before it is left.
  await openAlbum(0);
  await openMenu();
  $("menu-item-shelf").click();
  await soon(function () { return !albumOpen(); });
  T("shelf", [albumOpen(), left.slice()]);
  if (albumOpen()) { $("modal-close-btn").click(); await window.__sleep(150); }

  // An entry added later (a plugin's, a new screen's) closes the page too: only the three named do not. And the
  // page is closed FIRST: when the entry's own handler runs (where it shows its screen), the page is already gone.
  var later = document.createElement("button"), openAtItsHandler = null;
  later.className = "menu-item"; later.type = "button"; later.dataset.action = "added-later";
  later.addEventListener("click", function () { openAtItsHandler = albumOpen(); });
  q("#menu-overlay .menu-list").appendChild(later);
  await openAlbum(0);
  await openMenu();
  later.click();
  await soon(function () { return !albumOpen(); });
  T("addedLater", [openAtItsHandler, albumOpen()]);
  later.remove();
  await closeMenu();
  if (albumOpen()) { $("modal-close-btn").click(); await window.__sleep(150); }

  // Now playing's Queue tab (the bar is on it): Listen later closes Now playing and the album under it.
  await openAlbum(1);
  q(".mt-info").click();
  await until(function () { return $("album-modal").classList.contains("np-mode"); }, "Now playing");
  q('.modal-tab[data-tab="queue"]').click();
  await until(function () { return $("album-modal").classList.contains("tab-queue"); }, "the Queue tab");
  await window.__sleep(150);
  T("fromQueue", await openMenu());
  $("menu-item-later").click();
  await soon(function () { return !albumOpen(); });
  await window.__sleep(100);
  T("laterFromQueue", [albumOpen(), menuOpen(), html.classList.contains("tn-home")]);

  // With nothing over the screen an entry does what it always did.
  window.__showHome();
  await until(function () { return html.classList.contains("tn-home"); }, "Home");
  await openMenu();
  $("menu-item-labels").click();
  T("labelsFromHome", await soon(function () { return html.classList.contains("tn-labels"); }));
`;

for (const size of ["320x568", "390x844"]) {
  test("the menu in the touch bar at " + size + " (v2.0.3-t8)", { skip: !harness.available && "no chromium" }, async (t) => {
    const R = harness.renderPage({ stub: STUB, driver: DRIVER, name: "touch-nav-menu-" + size, windowSize: size,
                                   chromeArgs: TOUCH, budgetMs: 40000 });
    harness.assertNoPageError(assert, R);
    const [w] = R.vp;

    await t.test("six buttons, Menu first; each label whole in its own button and clear of the next", () => {
      assert.deepEqual(R.order, ["Menu", "Home", "Library", "Artists", "Shelf", "Search"]);
      for (const [i, b] of R.fit.entries()) {
        assert.ok(b.tw > 10, `"${b.label}" has no label drawn: ${JSON.stringify(b)}`);
        assert.ok(b.tl >= b.l && b.tr <= b.r, `"${b.label}" runs out of its button at ${w}px: ${JSON.stringify(b)}`);
        const next = R.fit[i + 1];
        if (next) assert.ok(next.tl - b.tr >= 2, `"${b.label}" touches "${next.label}" at ${w}px (${b.tr} then ${next.tl})`);
      }
    });

    await t.test("Menu is at the far left, there to tap, and never lit", () => {
      assert.equal(R.menuFirst, true, "the bar's first button is not #tnav-menu");
      assert.equal(R.menuName, "Menu");
      assert.ok(R.menuLeft != null && R.menuLeft >= 0 && R.menuLeft <= 12, "Menu is not at the bar's left edge: " + R.menuLeft);
      assert.equal(R.menuTappable, true, "Menu is covered");
      assert.notEqual(R.lit.home, R.lit.shelf, "Home is not lit on Home, so nothing is told apart here");
      assert.equal(R.lit.menu, R.lit.shelf, "Menu is lit: it is not a screen");
      assert.equal(R.barMenu, false, "the top bar's own ☰ shows as well, on Home");
      assert.equal(R.barMenuSearching, false, "the top bar's own ☰ shows as well, once Home's search brings the bar back");
    });

    await t.test("Home has no ☰ of its own, and its greeting is back at the left edge", () => {
      assert.equal(R.homeOwnMenu, false, "#tnav-home-menu is still in the page");
      assert.equal(R.greetingIn, 0, `the greeting still keeps ${R.greetingIn}px clear of a ☰ that is gone`);
    });

    await t.test("Menu opens the side menu from Home, the Library and an album's page; closed, each is as it was", () => {
      assert.equal(R.fromHome, true, "no side menu from Home");
      assert.deepEqual(R.homeAfter, [false, true], "the menu closed, Home is not as it was");
      assert.equal(R.fromLibrary, true, "no side menu from the Library");
      assert.deepEqual(R.libraryAfter, [false, true], "the menu closed, the Library is not as it was");
      assert.equal(R.menuTappableOverAlbum, true, "Menu cannot be tapped over an album's page");
      assert.equal(R.fromAlbum, true, "no side menu from an album's page");
      assert.equal(R.albumUnderMenu, true, "opening the menu closed the album's page");
      assert.deepEqual(R.albumAfter, [false, true], "the menu closed, the album's page is not as it was");
      assert.equal(R.fromQueue, true, "no side menu from Now playing's Queue tab");
    });

    await t.test("over an album's page, Settings, Pitchfork and Rescan library leave the page open", () => {
      assert.deepEqual(R.settings, [true, true, false], "Settings: [it opened, the album's page stayed, the menu stayed]");
      assert.deepEqual(R.settingsClosed, [false, true], "Settings closed: [it is still up, the album's page is back]");
      assert.deepEqual(R.pitchfork, [true, true, false], "Pitchfork: [it opened, the album's page stayed, the menu stayed]");
      assert.deepEqual(R.pitchforkClosed, [false, true], "Pitchfork closed: [it is still up, the album's page is back]");
      assert.deepEqual(R.rescan, [true, false], "Rescan library: [the album's page stayed, the menu stayed]");
    });

    await t.test("THE one: over an album's page, an entry that goes to another screen closes the page first", () => {
      assert.deepEqual(R.labels, [false, true, false], "Labels: [the album's page still open, the Labels list, the menu still open]");
      assert.deepEqual(R.shelf, [false, ["shelf"]], "Shelf: [the album's page still open, where it went]");
      assert.deepEqual(R.addedLater, [false, false], "an entry added later: [the page still open when the entry's own handler ran, the page still open after]");
      assert.deepEqual(R.laterFromQueue, [false, false, false], "Listen later from the Queue tab: [the page still open, the menu still open, Home]");
    });

    await t.test("with nothing over the screen, an entry does what it did", () => {
      assert.equal(R.labelsFromHome, true, "Labels from Home did not show the Labels list");
    });
  });
}
