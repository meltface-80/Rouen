"use strict";
// ---------------------------------------------------------------------------
// v1.9.14: the touch layout (public/touchnav.js, public/touchnav.css; ported
// from Mandarin v0.9.6), at a phone's and a tablet's sizes, both ways round,
// and a desktop's:
//   - along the foot: Home, Library, Artists, Shelf and Search, in that order
//     (the owner's, v1.9.70-t6, dev/design/artists.md §1), edge to edge, their
//     icons evenly spaced, the mini player above them; on Home no top bar, the
//     greeting at the top, and the menu's ☰ at its top right (§2), there only;
//   - Search opens the top bar again, the field across it and FOCUSED (the
//     row's tap must raise a phone's keyboard), and the results sit under it;
//   - Library opens the Library wall; Home, from an album's page, closes it
//     and shows Home; Home's ☰ opens the side menu; Now playing has no row;
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
const LABELS = ["4AD", "Àlpha", "Blue Note", "ECM", "Warp"];
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
  // What a finger at the middle of el would touch: el itself (or inside it), or what lies over it.
  function tappable(el) { var b = el.getBoundingClientRect(); var hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!hit && el.contains(hit); }
  async function longPress(el) {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); await window.__sleep(700);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); el.dispatchEvent(new MouseEvent("click", { bubbles: true })); await window.__sleep(120);
  }
  async function until(f, what) {
    for (var i = 0; i < 80; i++) { var v = f(); if (v) return v; await window.__sleep(50); }
    throw new Error("not in time: " + what);
  }
  // main keeps the bar's room by --topbar-h, which app.js measures with a
  // ResizeObserver and again on every window resize. Under this harness's
  // virtual clock the observer's callback can come late (seconds, in one run
  // in a few), so the page's own second path is used (a resize event) and the
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
    T("homeMenuDesktop", shown($("tnav-home-menu")));
    return;
  }

  // Home: the row in order, the mini player above it, no top bar, Home lit.
  T("order", [].map.call(nav.querySelectorAll(".tnav-btn"), function (b) { return b.textContent.trim(); }));
  T("navBox", bx(nav));
  T("mini", bx($("mini-transport")));
  T("topbarRow", shown(document.querySelector(".topbar-row")));
  T("greeting", bx($("home-greeting")));
  T("homeLit", [colour("tnav-home"), colour("tnav-library")]);
  // The menu on Home: a ☰ at the top right, to tap; the icons along the foot evenly spaced (their middles).
  T("homeMenu", { box: bx($("tnav-home-menu")), shown: shown($("tnav-home-menu")), tappable: tappable($("tnav-home-menu")), greeting: bx($("home-greeting-text")) });
  T("iconMids", [].map.call(nav.querySelectorAll(".tnav-btn svg"), function (s) { var b = s.getBoundingClientRect(); return b.left + b.width / 2; }));

  // The scan: a line along the top.
  $("scan-progress-bar").classList.remove("hidden");
  T("scan", bx($("scan-progress-bar")));
  $("scan-progress-bar").classList.add("hidden");

  // Albums selected on Home: the bar comes back, and the selection's menu is there to tap.
  var homeTile = await until(function () { return [].find.call(document.querySelectorAll("#home-view .album[data-offset]"), shown); }, "a selectable Home tile");
  await longPress(homeTile);
  await window.__sleep(100);
  T("homeSelect", [shown($("select-menu-wrap")), tappable($("select-menu-btn"))]);
  window.__exitAlbumSelectMode(); await window.__sleep(100);
  T("homeSelectGone", [html.classList.contains("tn-select"), shown(document.querySelector(".topbar-row"))]);
  // A toast with nothing of its own placing it sits above the row.
  var toast = $("toast"); toast.style.bottom = ""; toast.classList.remove("hidden"); toast.classList.add("show"); await window.__sleep(50);
  T("toastGap", Math.round(innerHeight - toast.getBoundingClientRect().bottom));
  toast.classList.remove("show"); toast.classList.add("hidden");

  // Search: the top bar back, the field across it and focused, the results under it.
  $("tnav-search").click();
  await until(function () { return html.classList.contains("tn-search"); }, "the search open");
  T("searchFocused", document.activeElement === $("search-input"));
  T("searchHomeMenu", shown($("tnav-home-menu")));
  await window.__sleep(100);
  await settled();
  T("searchTopbar", bx(document.querySelector(".topbar")));
  T("searchField", bx($("search-row")));
  var input = $("search-input");
  input.value = "Album"; input.dispatchEvent(new Event("input", { bubbles: true }));
  var first = await until(function () {
    return [].find.call(document.querySelectorAll("main .album"), function (a) { return shown(a) && !a.closest("#home-view"); });
  }, "a result");
  T("result", bx(first));
  // What the page shows first under the bar, whatever it is.
  T("searchFirst", bx([].find.call(document.querySelector("main").children, function (c) { return shown(c) && c.getBoundingClientRect().height > 0; })));
  // Search tapped again with the field open: the field takes the keyboard again.
  input.blur(); $("tnav-search").click();
  T("searchRefocused", document.activeElement === input);
  // A tap away closes it and clears it.
  document.body.click();
  await until(function () { return !html.classList.contains("tn-search"); }, "the search closed");
  T("searchCleared", input.value);

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
  T("libHomeMenu", shown($("tnav-home-menu")));
  T("libTitle", bx($("album-count")));
  T("libTappable", [tappable($("topbar-back")), !!focus && tappable(focus), !!sort && tappable(sort)]);
  T("libOverflow", [document.documentElement.scrollWidth - innerWidth, document.querySelector("main").scrollWidth - document.querySelector("main").clientWidth]);
  // Albums selected on the Library: the selection's menu is not under Focus and Sort.
  await longPress(document.querySelector("#album-grid .album"));
  await window.__sleep(100);
  T("libSelect", [shown($("select-menu-wrap")), tappable($("select-menu-btn"))]);
  window.__exitAlbumSelectMode(); await window.__sleep(150);
  await settled();
  // Search on the Library: its filter, focused, the strip back under its field.
  $("tnav-search").click();
  await until(function () { return html.classList.contains("tn-filter") && document.querySelector("#library-filter .lib-filter-input"); }, "the Library's filter");
  await window.__sleep(100);
  T("filterFocused", document.activeElement === document.querySelector("#library-filter .lib-filter-input"));
  T("filterStrip", bg(document.querySelector(".topbar")));
  T("filterField", bx(document.querySelector("#library-filter .lib-filter-input")));
  T("filterSearchLit", [colour("tnav-search"), colour("tnav-home")]);
  // The filter works as before: a prefix asked for; × clears, then × closes.
  var fin = document.querySelector("#library-filter .lib-filter-input");
  fin.value = "ab"; fin.dispatchEvent(new Event("input")); await window.__sleep(300);
  var hits = window.__calls.filter(function (u) { return u.indexOf("/api/library/albums") > -1; });
  T("filterPrefix", new URLSearchParams((hits[hits.length - 1] || "").split("?")[1] || "").get("prefix"));
  document.querySelector("#library-filter .lib-filter-clear").click(); await window.__sleep(200);
  T("filterX1", [!!document.querySelector("#library-filter .lib-filter-input"), (document.querySelector("#library-filter .lib-filter-input") || {}).value]);
  document.querySelector("#library-filter .lib-filter-clear").click(); await window.__sleep(200);
  T("filterX2", [!!document.querySelector("#library-filter .lib-filter-input"), html.classList.contains("tn-filter")]);

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
  T("randomTappable", [tappable($("topbar-back")), tappable($("topbar-refresh"))]);

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
  T("labelsTappable", tappable($("labels-order")));
  $("tnav-search").click();
  await until(function () { return html.classList.contains("tn-filter"); }, "Search labels");
  await window.__sleep(100);
  T("labelsFocused", document.activeElement === $("labels-search-input"));
  T("labelsSearchStrip", bg(document.querySelector(".topbar")));
  // The label search works as before: filters, folds accents; × clears, then × closes.
  function labelNames() { return [].map.call(document.querySelectorAll("#album-grid .label-tile .album-title"), function (e) { return e.textContent; }); }
  var lin = $("labels-search-input");
  lin.value = "ecm"; lin.dispatchEvent(new Event("input")); await window.__sleep(300);
  T("labelsFiltered", labelNames());
  lin.value = "alpha"; lin.dispatchEvent(new Event("input")); await window.__sleep(300);
  T("labelsFolded", labelNames());
  $("labels-search-clear").click(); await window.__sleep(150);
  T("labelsX1", [html.classList.contains("tn-filter"), lin.value, labelNames().length]);
  $("labels-search-clear").click(); await window.__sleep(150);
  T("labelsX2", html.classList.contains("tn-filter"));

  // Home from an album's page: the row over it, Home tappable there; the page closes, Home shows.
  window.__openAlbum(ALBUMS[0], { source: "search" });
  await until(function () { return !$("album-modal").classList.contains("hidden") && $("modal-tracks").querySelectorAll("li").length; }, "the album's page");
  await window.__sleep(200);
  T("albumBodyPad", parseFloat(getComputedStyle(document.querySelector("#album-modal .modal-body")).paddingBottom));
  var hb = bx($("tnav-home"));
  var hit = document.elementFromPoint(hb.l + hb.w / 2, hb.t + hb.h / 2);
  T("navOverAlbum", shown(nav) && !!hit && $("tnav-home").contains(hit));
  $("tnav-home").click();
  await until(function () { return $("album-modal").classList.contains("hidden") && html.classList.contains("tn-home"); }, "Home, the album's page closed");
  T("homeFromAlbum", true);

  // Home's ☰: the side menu.
  $("tnav-home-menu").click();
  await until(function () { var m = $("menu-overlay"); return m && !m.classList.contains("hidden") && shown(m); }, "the side menu");
  T("menu", true);
  $("menu-overlay").classList.add("hidden");

  // The share card is a dialog: no row beside it.
  $("share-overlay").classList.remove("hidden"); await window.__sleep(100);
  T("shareNav", shown(nav));
  $("share-overlay").classList.add("hidden"); await window.__sleep(100);

  // Now playing, opened from the mini player: no row on its album tab. On its
  // Queue tab the row is there, the queue's end clears it and the mini player,
  // and Home goes Home (Back from Now playing would reopen the album it replaced).
  window.__openAlbum(ALBUMS[1], { source: "search" });
  await until(function () { return !$("album-modal").classList.contains("hidden"); }, "an album's page");
  document.querySelector(".mt-info").click();
  await until(function () { return $("album-modal").classList.contains("np-mode"); }, "Now playing");
  await window.__sleep(150);
  T("npNav", shown(nav));
  document.querySelector('.modal-tab[data-tab="queue"]').click();
  await until(function () { return $("album-modal").classList.contains("tab-queue"); }, "the Queue tab");
  await window.__sleep(150);
  T("npQueue", [shown(nav), parseFloat(getComputedStyle(document.querySelector("#album-modal .modal-body")).paddingBottom), Math.round(innerHeight - $("mini-transport").getBoundingClientRect().top)]);
  $("tnav-home").click();
  await window.__sleep(300);
  T("npQueueHome", [$("album-modal").classList.contains("hidden"), html.classList.contains("tn-home")]);
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
        assert.equal(R.homeMenuDesktop, false, "a desktop shows Home's ☰ as well as its top bar's");
      });
      return;
    }

    await t.test("Home: the row along the foot, the mini player above it, no top bar", () => {
      assert.equal(R.nav, true, "no row on a touch screen");
      assert.equal(R.menuInBar, false, "the menu is still in the top bar");
      assert.deepEqual(R.order, ["Home", "Library", "Artists", "Shelf", "Search"]);
      assert.ok(R.navBox.b === h && R.navBox.l === 0 && R.navBox.r === w, "not along the foot, edge to edge: " + JSON.stringify(R.navBox));
      assert.ok(R.mini.b <= R.navBox.t, `the mini player is not above the row (${R.mini.b} over ${R.navBox.t})`);
      assert.equal(R.topbarRow, false, "Home still has a top bar");
      assert.ok(R.greeting.t < 40, "the greeting is not at the top: " + R.greeting.t);
      assert.notEqual(R.homeLit[0], R.homeLit[1], "Home is not lit on Home");
      assert.ok(R.scan.t === 0 && R.scan.h <= 4 && R.scan.w === w, "the scan is not a line along the top: " + JSON.stringify(R.scan));
      assert.ok(R.toastGap >= R.navBox.h, `a toast sits over the row (${R.toastGap}px from the foot, the row ${R.navBox.h})`);
    });

    await t.test("THE one for v1.9.70-t6: the icons evenly spaced; the menu's ☰ at Home's top right, beside the greeting, and on Home only", () => {
      const gaps = R.iconMids.slice(1).map((x, i) => x - R.iconMids[i]);
      assert.ok(gaps.every((g) => Math.abs(g - gaps[0]) <= 1), "the icons are not evenly spaced: " + JSON.stringify(R.iconMids));
      assert.ok(Math.abs(R.iconMids[0] - R.navBox.l - (R.navBox.r - R.iconMids[4])) <= 1, "the row is not centred: " + JSON.stringify(R.iconMids));
      const m = R.homeMenu;
      assert.ok(m.shown && m.tappable, "Home's ☰ is not there to tap: " + JSON.stringify(m));
      assert.ok(m.box.r >= w - 30 && m.box.r <= w && m.box.t < 50, "Home's ☰ is not at the top right: " + JSON.stringify(m.box));
      assert.ok(m.greeting.r <= m.box.l + 1 || m.greeting.t >= m.box.b, "the greeting runs under the ☰: " + JSON.stringify(m));
      assert.equal(R.libHomeMenu, false, "the ☰ is on the Library wall");
      assert.equal(R.searchHomeMenu, false, "the ☰ stays over Home's open search");
    });

    await t.test("albums selected: the bar comes back with the selection's menu, on Home and on the Library", () => {
      assert.deepEqual(R.homeSelect, [true, true], "THE one: on Home the selection's menu is hidden or covered — a dead end ");
      assert.deepEqual(R.homeSelectGone, [false, false], "the bar stayed on Home after the selection ended");
      assert.deepEqual(R.libSelect, [true, true], "on the Library the selection's menu is under Focus and Sort");
    });

    await t.test("Search: the bar back, the field across it, focused, the results under it", () => {
      assert.equal(R.searchFocused, true, "THE one: the field opened without focus — a phone raises no keyboard");
      assert.ok(R.searchTopbar.t === 0 && R.searchTopbar.h > 30, "the top bar did not come back: " + JSON.stringify(R.searchTopbar));
      assert.ok(R.searchField.w >= w - 60, `the field is not across the screen (${R.searchField.w} of ${w})`);
      assert.ok(R.result.t >= R.searchTopbar.b, `a result is behind the bar (${R.result.t} vs ${R.searchTopbar.b})`);
      assert.ok(R.searchFirst.t >= R.searchTopbar.b - 1, `the page starts behind the bar (${R.searchFirst.t} vs ${R.searchTopbar.b})`);
      assert.equal(R.searchRefocused, true, "Search tapped again did not give the field the keyboard");
      assert.equal(R.searchCleared, "", "a tap away closed the search but kept its text");
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
      assert.deepEqual(R.libTappable, [true, true, true], "‹, Focus or Sort cannot be tapped (the strip's pointer-events)");
      assert.deepEqual(R.libOverflow, [0, 0], "the Library scrolls sideways");
    });

    await t.test("Search on the Library opens its filter, focused, with the strip back", () => {
      assert.equal(R.filterFocused, true, "the filter opened without focus");
      assert.ok(!clear(R.filterStrip), "no strip under the open filter");
      assert.ok(R.filterField.w > w / 2, "the filter's field is not across the bar: " + R.filterField.w);
      assert.notEqual(R.filterSearchLit[0], R.filterSearchLit[1], "Search is not lit while the filter is open");
      assert.equal(R.filterPrefix, "ab", "the filter did not ask for its prefix");
      assert.deepEqual(R.filterX1, [true, ""], "the first × did not clear and stay open");
      assert.deepEqual(R.filterX2, [false, false], "the second × did not close the filter and its strip");
    });

    await t.test("Random albums: no strip, Shuffle floating top right, the title the heading", () => {
      assert.ok(clear(R.randomStrip), "Random albums has a strip: " + R.randomStrip);
      assert.ok(R.randomShuffle.r >= w - 24 && R.randomShuffle.t < 30, "Shuffle moved: " + JSON.stringify(R.randomShuffle));
      assert.equal(R.randomTitle[0], "Random albums");
      assert.ok(R.randomTitle[1].t >= R.randomShuffle.b, "the heading is not under the buttons");
      assert.deepEqual(R.randomTappable, [true, true], "‹ or Shuffle cannot be tapped");
    });

    await t.test("the Labels list: no strip, no glass, #–Z in ‹'s line, Search finds a label", () => {
      assert.ok(clear(R.labelsStrip), "the Labels list has a strip: " + R.labelsStrip);
      assert.equal(R.labelsGlass, false, "the Labels list's glass is still there");
      assert.ok(R.labelsOrder.r >= w - 24 && Math.abs(mid(R.labelsOrder) - mid(R.labelsBack)) <= 2,
        "#–Z is not on the right in ‹'s line: " + JSON.stringify([R.labelsBack, R.labelsOrder]));
      assert.equal(R.labelsFocused, true, "Search labels opened without focus");
      assert.ok(!clear(R.labelsSearchStrip), "no strip under the open label search");
      assert.equal(R.labelsTappable, true, "#–Z cannot be tapped");
      assert.deepEqual(R.labelsFiltered, ["ECM"]);
      assert.deepEqual(R.labelsFolded, ["Àlpha"], "the label search no longer folds accents");
      assert.deepEqual(R.labelsX1, [true, "", 5], "the first × did not clear and stay open");
      assert.equal(R.labelsX2, false, "the second × did not close the label search");
    });

    await t.test("over an album's page, Home closes it; Home's ☰ opens the menu; Now playing has no row", () => {
      assert.equal(R.navOverAlbum, true, "the row is not over the album's page, or Home is not tappable there");
      assert.equal(R.homeFromAlbum, true);
      assert.equal(R.menu, true);
      assert.equal(R.npNav, false, "Now playing shows the row");
      assert.equal(R.npQueue[0], true, "the Queue tab has no row");
      assert.ok(R.npQueue[1] >= R.npQueue[2], `the queue's end is under the mini player (room ${R.npQueue[1]}, needed ${R.npQueue[2]})`);
      assert.deepEqual(R.npQueueHome, [true, true], "Home from Now playing's Queue tab left an album's page open");
      assert.equal(R.shareNav, false, "the row is live beside the share card");
      if (w >= 720) assert.equal(R.albumBodyPad, 0, "a tablet's album view keeps the room twice (the body and its columns)");
      else assert.ok(R.albumBodyPad > R.navBox.h, "a phone's album view does not keep the row's room");
    });
  });
}
