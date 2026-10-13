"use strict";
// ---------------------------------------------------------------------------
// v1.9.14: the touch layout (public/touchnav.js, public/touchnav.css; ported
// from Mandarin v0.9.6), at a phone's and a tablet's sizes, both ways round,
// and a desktop's:
//   - along the foot: Menu, Home, Library and Search, in that order, edge to
//     edge, the mini player above them; on Home no top bar, the greeting at
//     the top;
//   - Search opens the top bar again, the field across it and FOCUSED (the
//     row's tap must raise a phone's keyboard), and the results sit under it;
//   - Library opens the Library wall; Home, from an album's page, closes it
//     and shows Home; Menu opens the side menu; Now playing has no row;
//   - the grid screens have no strip: their buttons float where they were,
//     their title is the page's heading; on the Library, Focus and Sort are
//     up in ‹'s line on the right, its glass gone, and Search opens its
//     filter with the strip back under the field; the Labels list the same
//     (#–Z on the right, Search opens "Search labels");
//   - the scan's progress is a line along the top edge;
//   - a desktop (a mouse) keeps its top bar, its title in it, and never shows
//     the row.
// Positions compared within one assertion are read from the same page in the
// same pass (dev/lessons.md).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const TOUCH = ["--blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=1,availableHoverTypes=1"];
const ALBUMS = [];
for (let i = 0; i < 30; i++) ALBUMS.push({ offset: i, title: "Album " + i, subtitle: "Artist " + i, image_key: null });
const LABELS = ["4AD", "Blue Note", "ECM", "Warp"];
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
  if (u.indexOf("/api/search/external") > -1) return window.__json({ qobuz: null, tidal: null, pitchfork: null });
  if (u.indexOf("/api/search") > -1)        return window.__json({ results: ALBUMS.slice(0, 6), artists: [], labels: [] });
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
  // A Docker install, as every current one is: a native install's migration
  // banner would stand above Home's greeting.
  if (u.indexOf("/api/update/status") > -1) return window.__json({ is_docker: true });
  if (u.indexOf("/api/") > -1)               return window.__json({});
  return undefined;
});
`;

const DRIVER = `
  var html = document.documentElement;
  function $(id) { return document.getElementById(id); }
  function bx(el) { var b = el.getBoundingClientRect();
    return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; }
  function shown(el) { return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden"; }
  function bg(el) { return getComputedStyle(el).backgroundColor; }
  function colour(id) { return getComputedStyle($(id)).color; }
  async function until(f, what) {
    for (var i = 0; i < 80; i++) { var v = f(); if (v) return v; await window.__sleep(50); }
    throw new Error("not in time: " + what);
  }
  // main keeps the bar's room by --topbar-h, which app.js measures with a
  // ResizeObserver and again on every window resize. Under this harness's
  // virtual clock the observer's callback can lag a screen change, or not come
  // at all, so the page's own second path is used (a resize event) and the
  // positions are read once its measurement has caught up with the bar. On a
  // device the observer does this within the frame.
  async function settled() {
    var bar = document.querySelector(".topbar"), app = document.querySelector(".app");
    window.dispatchEvent(new Event("resize"));
    await until(function () {
      var h = bar.getBoundingClientRect().height;
      return h === 0 || Math.abs(parseFloat(getComputedStyle(app).getPropertyValue("--topbar-h")) - Math.ceil(h)) < 1;
    }, "--topbar-h measured");
  }
  await window.__sleep(800);
  await until(function () { return !$("mini-transport").classList.contains("hidden"); }, "the mini player");
  var nav = $("touch-nav");
  T("vp", [innerWidth, innerHeight]);
  T("nav", shown(nav));
  T("menuInBar", shown($("menu-toggle")));
  if (!shown(nav)) {
    // A desktop: the title stays in the bar.
    window.__applyFilter(null);
    await until(function () { return $("album-count").textContent; }, "Random albums");
    T("titleInBar", !!$("album-count").closest(".topbar"));
    return;
  }

  // Home: the row in order, the mini player above it, no top bar, Home lit.
  T("order", [].map.call(nav.querySelectorAll(".tnav-btn"), function (b) { return b.textContent.trim(); }));
  T("navBox", bx(nav));
  T("mini", bx($("mini-transport")));
  T("topbarRow", shown(document.querySelector(".topbar-row")));
  T("greeting", bx($("home-greeting")));
  T("homeLit", [colour("tnav-home"), colour("tnav-library")]);

  // The scan: a line along the top.
  $("scan-progress-bar").classList.remove("hidden");
  T("scan", bx($("scan-progress-bar")));
  $("scan-progress-bar").classList.add("hidden");

  // Search: the top bar back, the field across it and focused, the results under it.
  $("tnav-search").click();
  await until(function () { return html.classList.contains("tn-search"); }, "the search open");
  T("searchFocused", document.activeElement === $("search-input"));
  await window.__sleep(100);
  T("searchTopbar", bx(document.querySelector(".topbar")));
  T("searchField", bx($("search-row")));
  var input = $("search-input");
  input.value = "Album"; input.dispatchEvent(new Event("input", { bubbles: true }));
  var first = await until(function () {
    return [].find.call(document.querySelectorAll("main .album"), function (a) { return shown(a) && !a.closest("#home-view"); });
  }, "a result");
  T("result", bx(first));
  $("search-clear").click(); document.body.click();
  await until(function () { return !html.classList.contains("tn-search"); }, "the search closed");

  // Library: the wall, its button lit; no strip; the title the page's heading.
  $("tnav-library").click();
  await until(function () { return html.classList.contains("tn-lib"); }, "the Library wall");
  await until(function () { return document.querySelector("#album-grid .album"); }, "the Library's albums");
  await window.__sleep(150);
  await settled();
  T("libLit", [colour("tnav-library"), colour("tnav-home")]);
  T("libStrip", bg(document.querySelector(".topbar")));
  T("libHeading", !!document.querySelector("main #album-count") && $("album-count").textContent);
  T("libBack", bx($("topbar-back")));
  var focus = document.querySelector(".library-controls .lib-ctl-focus"), sort = document.querySelector(".library-controls .lib-ctl-sort");
  T("libFocus", focus && shown(focus) ? bx(focus) : null);
  T("libSort", sort && shown(sort) ? bx(sort) : null);
  T("libSortWords", sort ? getComputedStyle(sort, "::before").content : null);
  T("libGlass", shown(document.querySelector("#library-filter .lib-filter-btn")));
  T("libTitle", bx($("album-count")));
  // Search on the Library: its filter, focused, the strip back under its field.
  $("tnav-search").click();
  await until(function () { return html.classList.contains("tn-filter") && document.querySelector("#library-filter .lib-filter-input"); }, "the Library's filter");
  await window.__sleep(100);
  T("filterFocused", document.activeElement === document.querySelector("#library-filter .lib-filter-input"));
  T("filterStrip", bg(document.querySelector(".topbar")));
  T("filterField", bx(document.querySelector("#library-filter .lib-filter-input")));
  T("filterSearchLit", [colour("tnav-search"), colour("tnav-home")]);

  // Random albums: its Shuffle floats, its title the heading.
  window.__showHome();
  await until(function () { return html.classList.contains("tn-home"); }, "Home");
  $("home-random-title").click();
  await until(function () { return !html.classList.contains("tn-home") && shown($("topbar-refresh")) && $("album-count").textContent; }, "Random albums");
  await window.__sleep(150);
  await settled();
  T("randomStrip", bg(document.querySelector(".topbar")));
  T("randomShuffle", bx($("topbar-refresh")));
  T("randomTitle", [$("album-count").textContent, bx($("album-count"))]);

  // The Labels list: no strip, its glass gone, #–Z on the right in ‹'s line, Search finds a label.
  window.__showHome();
  await until(function () { return html.classList.contains("tn-home"); }, "Home");
  $("labels-toggle").click();
  await until(function () { return html.classList.contains("tn-labels"); }, "the Labels list");
  await window.__sleep(200);
  await settled();
  T("labelsStrip", bg(document.querySelector(".topbar")));
  T("labelsGlass", shown($("labels-search-open")));
  T("labelsOrder", bx($("labels-order")));
  T("labelsBack", bx($("topbar-back")));
  $("tnav-search").click();
  await until(function () { return html.classList.contains("tn-filter"); }, "Search labels");
  await window.__sleep(100);
  T("labelsFocused", document.activeElement === $("labels-search-input"));
  T("labelsSearchStrip", bg(document.querySelector(".topbar")));
  $("labels-search-input").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

  // Home from an album's page: the row over it, Home tappable there; the page closes, Home shows.
  window.__openAlbum(ALBUMS[0], { source: "search" });
  await until(function () { return !$("album-modal").classList.contains("hidden") && $("modal-tracks").querySelectorAll("li").length; }, "the album's page");
  await window.__sleep(200);
  var hb = bx($("tnav-home"));
  var hit = document.elementFromPoint(hb.l + hb.w / 2, hb.t + hb.h / 2);
  T("navOverAlbum", shown(nav) && !!hit && $("tnav-home").contains(hit));
  $("tnav-home").click();
  await until(function () { return $("album-modal").classList.contains("hidden") && html.classList.contains("tn-home"); }, "Home, the album's page closed");
  T("homeFromAlbum", true);

  // Menu: the side menu.
  $("tnav-menu").click();
  await until(function () { var m = $("menu-overlay"); return m && !m.classList.contains("hidden") && shown(m); }, "the side menu");
  T("menu", true);
  $("menu-overlay").classList.add("hidden");

  // Now playing: no row.
  var m = $("album-modal");
  m.classList.remove("hidden"); m.classList.add("np-mode", "tab-album");
  await window.__sleep(100);
  T("npNav", shown(nav));
  m.classList.add("hidden"); m.classList.remove("np-mode", "tab-album");
`;

const clear = (c) => c === "rgba(0, 0, 0, 0)" || c === "transparent";
const mid = (b) => (b.t + b.b) / 2;

for (const [size, touch] of [["390x844", true], ["844x390", true], ["820x1180", true], ["1180x820", true], ["1440x900", false]]) {
  test("the touch layout at " + size + (touch ? "" : " (a mouse)") + " (v1.9.14)", { skip: !harness.available && "no chromium" }, async (t) => {
    const R = harness.renderPage({ stub: STUB, driver: DRIVER, name: "touch-nav-" + size, windowSize: size,
                                   chromeArgs: touch ? TOUCH : harness.MOUSE, budgetMs: 40000 });
    harness.assertNoPageError(assert, R);
    const [w, h] = R.vp;

    if (!touch) {
      await t.test("a desktop has no row; its menu and its title stay in the top bar", () => {
        assert.equal(R.nav, false, "a desktop shows the row");
        assert.equal(R.menuInBar, true, "the menu left a desktop's top bar");
        assert.equal(R.titleInBar, true, "a desktop's screen title left the top bar");
      });
      return;
    }

    await t.test("Home: the row along the foot, the mini player above it, no top bar", () => {
      assert.equal(R.nav, true, "no row on a touch screen");
      assert.equal(R.menuInBar, false, "the menu is still in the top bar");
      assert.deepEqual(R.order, ["Menu", "Home", "Library", "Search"]);
      assert.ok(R.navBox.b === h && R.navBox.l === 0 && R.navBox.r === w, "not along the foot, edge to edge: " + JSON.stringify(R.navBox));
      assert.ok(R.mini.b <= R.navBox.t, `the mini player is not above the row (${R.mini.b} over ${R.navBox.t})`);
      assert.equal(R.topbarRow, false, "Home still has a top bar");
      assert.ok(R.greeting.t < 40, "the greeting is not at the top: " + R.greeting.t);
      assert.notEqual(R.homeLit[0], R.homeLit[1], "Home is not lit on Home");
      assert.ok(R.scan.t === 0 && R.scan.h <= 4 && R.scan.w === w, "the scan is not a line along the top: " + JSON.stringify(R.scan));
    });

    await t.test("Search: the bar back, the field across it, focused, the results under it", () => {
      assert.equal(R.searchFocused, true, "THE one: the field opened without focus — a phone raises no keyboard");
      assert.ok(R.searchTopbar.t === 0 && R.searchTopbar.h > 30, "the top bar did not come back: " + JSON.stringify(R.searchTopbar));
      assert.ok(R.searchField.w >= w - 60, `the field is not across the screen (${R.searchField.w} of ${w})`);
      assert.ok(R.result.t >= R.searchTopbar.b, `a result is behind the bar (${R.result.t} vs ${R.searchTopbar.b})`);
    });

    await t.test("the Library: no strip, the title the heading, Focus and Sort up in ‹'s line, no glass", () => {
      assert.notEqual(R.libLit[0], R.libLit[1], "Library is not lit on the Library wall");
      assert.ok(clear(R.libStrip), "the Library has a strip: " + R.libStrip);
      assert.match(String(R.libHeading), /^Library/, "the title is not the page's heading");
      assert.ok(R.libTitle.t >= R.libBack.b, `the heading is not under the buttons (${R.libTitle.t} vs ${R.libBack.b})`);
      assert.ok(R.libBack.l < 30 && R.libBack.t < 30, "‹ moved: " + JSON.stringify(R.libBack));
      assert.ok(R.libFocus && R.libSort, "Focus or Sort is not shown");
      assert.ok(Math.abs(mid(R.libFocus) - mid(R.libBack)) <= 2 && Math.abs(mid(R.libSort) - mid(R.libBack)) <= 2,
        "Focus and Sort are not in ‹'s line: " + JSON.stringify([R.libBack, R.libFocus, R.libSort]));
      assert.ok(R.libSort.r >= w - 24 && R.libFocus.r <= R.libSort.l, "not on the right, Focus then Sort");
      assert.equal(R.libSortWords, '"Sort"', "Sort's word is not \"Sort\"");
      assert.equal(R.libGlass, false, "the Library's glass is still there");
    });

    await t.test("Search on the Library opens its filter, focused, with the strip back", () => {
      assert.equal(R.filterFocused, true, "the filter opened without focus");
      assert.ok(!clear(R.filterStrip), "no strip under the open filter");
      assert.ok(R.filterField.w > w / 2, "the filter's field is not across the bar: " + R.filterField.w);
      assert.notEqual(R.filterSearchLit[0], R.filterSearchLit[1], "Search is not lit while the filter is open");
    });

    await t.test("Random albums: no strip, Shuffle floating top right, the title the heading", () => {
      assert.ok(clear(R.randomStrip), "Random albums has a strip: " + R.randomStrip);
      assert.ok(R.randomShuffle.r >= w - 24 && R.randomShuffle.t < 30, "Shuffle moved: " + JSON.stringify(R.randomShuffle));
      assert.equal(R.randomTitle[0], "Random albums");
      assert.ok(R.randomTitle[1].t >= R.randomShuffle.b, "the heading is not under the buttons");
    });

    await t.test("the Labels list: no strip, no glass, #–Z in ‹'s line, Search finds a label", () => {
      assert.ok(clear(R.labelsStrip), "the Labels list has a strip: " + R.labelsStrip);
      assert.equal(R.labelsGlass, false, "the Labels list's glass is still there");
      assert.ok(R.labelsOrder.r >= w - 24 && Math.abs(mid(R.labelsOrder) - mid(R.labelsBack)) <= 2,
        "#–Z is not on the right in ‹'s line: " + JSON.stringify([R.labelsBack, R.labelsOrder]));
      assert.equal(R.labelsFocused, true, "Search labels opened without focus");
      assert.ok(!clear(R.labelsSearchStrip), "no strip under the open label search");
    });

    await t.test("over an album's page, Home closes it; Menu opens the menu; Now playing has no row", () => {
      assert.equal(R.navOverAlbum, true, "the row is not over the album's page, or Home is not tappable there");
      assert.equal(R.homeFromAlbum, true);
      assert.equal(R.menu, true);
      assert.equal(R.npNav, false, "Now playing shows the row");
    });
  });
}
