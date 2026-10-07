"use strict";
// ---------------------------------------------------------------------------
// v1.8.83: navigation, as Mandarin v0.6.5 – v0.7.1 has it.
//
//   1. The menu button is Home's alone: on every other screen the brass ‹
//      stands where it was (and goes Home, where the menu is).
//   2. Import a playlist is the Playlists screen's Import button, and it goes
//      with the screen — Mandarin's own cleanup tests a flag it has just
//      cleared, so its button stayed on every screen after Playlists.
//   3. ‹ from a label's albums opened from an album's page brings that album
//      back.
//   4. The Random Album disc turns twice and rests.
//   5. A side-menu item is only as wide as its icon and words.
//   6. The Library's Sort sheet keeps keyboard focus on the row pressed.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const ALBUMS = [0, 1, 2].map((i) => ({ offset: i, title: "Album " + i, subtitle: "Artist " + i, image_key: null }));
const DETAIL = { title: "Album 0", subtitle: "Artist 0", image_key: null,
  actions: [{ kind: "play_now", title: "Play Now" }, { kind: "queue", title: "Queue" }],
  tracks: [{ title: "One", subtitle: "Artist 0" }] };

const STUB = `
try { localStorage.setItem("rra-zone", "z1"); } catch (e) {}
window.__installFetch(function (u) {
  if (u.indexOf("/api/user-playlists") > -1) return window.__json({ playlists: [] });
  if (u.indexOf("/api/playlists") > -1)      return window.__json({ playlists: [] });
  if (u.indexOf("/api/album/extras") > -1)   return window.__json({ album: { label: "Island" } });
  if (u.indexOf("/api/album") > -1)          return window.__json(${JSON.stringify(DETAIL)});
  if (u.indexOf("/api/label-albums") > -1)   return window.__json({ albums: ${JSON.stringify(ALBUMS)} });
  if (u.indexOf("/api/random-albums") > -1)  return window.__json({ albums: ${JSON.stringify(ALBUMS)}, total: 3, filtered: false });
  if (u.indexOf("/api/library/albums") > -1) return window.__json({ albums: ${JSON.stringify(ALBUMS)}, total: 3 });
  if (u.indexOf("/api/zones") > -1)          return window.__json({ zones: [] });
  if (u.indexOf("/api/status") > -1)         return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1)               return window.__json({});
  return undefined;
});
`;

const DRIVER = `
  await window.__sleep(800);
  var menuBtn = document.getElementById("menu-toggle"), back = document.getElementById("topbar-back");
  function shown(el) { return !!el && !el.classList.contains("hidden"); }
  T("home", { menu: shown(menuBtn), back: shown(back) });

  // 1 + 2: Playlists, then Home, then another screen.
  menuBtn.click(); await window.__sleep(200);
  var drawer = document.querySelector(".menu-drawer").getBoundingClientRect();
  var pl = document.querySelector('.menu-item[data-action="playlists"]');
  T("item_w", Math.round(pl.getBoundingClientRect().width)); T("drawer_w", Math.round(drawer.width));
  pl.click(); await window.__sleep(700);
  var imp = document.querySelector("#content-count .playlists-import");
  T("playlists", { menu: shown(menuBtn), back: shown(back), import: !!imp && shown(document.getElementById("content-count")) });
  back.click(); await window.__sleep(500);
  T("home_again", { menu: shown(menuBtn), back: shown(back), import_left: !!document.querySelector("#content-count .playlists-import") });
  menuBtn.click(); await window.__sleep(200);
  pl = document.querySelector('.menu-item[data-action="playlists"]'); pl.click(); await window.__sleep(600);
  menuBtn = document.getElementById("menu-toggle");
  // Straight from Playlists to another screen (Listen later, via the ‹ then the menu).
  window.__showListenLater(); await window.__sleep(600);
  var cc = document.getElementById("content-count");
  T("later", { menu: shown(menuBtn), back: shown(back),
               import_left: !!document.querySelector("#content-count .playlists-import") && shown(cc) });
  back.click(); await window.__sleep(500);

  // 3: an album, its label link, then ‹.
  window.__openAlbum(${JSON.stringify(ALBUMS[0])}, { source: "search" });
  await window.__sleep(1200);
  var link = Array.prototype.filter.call(document.querySelectorAll("#modal-subtitle .modal-artist-link"),
    function (b) { return b.textContent === "Island"; })[0];
  T("label_link", !!link);
  if (link) link.click();
  await window.__sleep(800);
  T("label_page", { modal_hidden: document.getElementById("album-modal").classList.contains("hidden"), back: shown(back) });
  back.click();
  await window.__sleep(1200);
  var modal = document.getElementById("album-modal");
  T("after_back", { modal_open: !modal.classList.contains("hidden"),
                    title: (document.getElementById("modal-title") || {}).textContent });

  // 4: the disc.
  var disc = document.querySelector("#home-unheard-tile .unheard-disc");
  T("disc", disc ? { count: getComputedStyle(disc).animationIterationCount, fill: getComputedStyle(disc).animationFillMode } : null);
`;

test("navigation: the menu is Home's, Import on Playlists, back to the album from a label (v1.8.83)", { concurrency: 1 }, async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const r = harness.renderPage({ stub: STUB, driver: DRIVER, name: "nav-1883", windowSize: "390x844", budgetMs: 40000 });
  harness.assertNoPageError(assert, r);

  await t.test("the menu button is Home's alone; elsewhere the ‹ stands there", () => {
    assert.deepEqual(r.home, { menu: true, back: false });
    assert.equal(r.playlists.menu, false, "the menu button is still beside the ‹ on Playlists");
    assert.equal(r.playlists.back, true);
    assert.deepEqual([r.home_again.menu, r.home_again.back], [true, false], "back on Home, the menu button did not return");
    assert.equal(r.later.menu, false);
    assert.equal(r.later.back, true);
  });

  await t.test("Import is on the Playlists screen, and goes with it", () => {
    assert.equal(r.playlists.import, true, "no Import button on the Playlists screen");
    assert.equal(r.home_again.import_left, false, "the Import button stayed after going Home");
    assert.equal(r.later.import_left, false, "the Import button stayed on the next screen (Mandarin's bug)");
  });

  await t.test("‹ from a label's albums opened from an album brings the album back", () => {
    assert.equal(r.label_link, true, "the fixture's album page has no label link");
    assert.equal(r.label_page.modal_hidden, true, "the label link did not leave the album page");
    assert.equal(r.after_back.modal_open, true, "‹ went Home and left the album page closed");
    assert.equal(r.after_back.title, "Album 0");
  });

  await t.test("the Random Album disc turns twice and rests", () => {
    assert.ok(r.disc, "no disc on the Random Album tile");
    assert.equal(r.disc.count, "2");
    assert.equal(r.disc.fill, "forwards");
  });

  await t.test("a side-menu item is its icon and words, not the drawer's width", () => {
    assert.ok(r.item_w < r.drawer_w - 60, `Playlists is ${r.item_w}px in a ${r.drawer_w}px drawer`);
  });
});

// Found in review (v1.8.83).
test("the way back to the album survives an artist view opened from the label page (v1.8.83)", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const stub = STUB.replace('if (u.indexOf("/api/label-albums") > -1)',
    'if (u.indexOf("/api/artist-albums") > -1) return window.__json({ primary: ' + JSON.stringify(ALBUMS) + ', featured: [] });\n  if (u.indexOf("/api/label-albums") > -1)');
  const r = harness.renderPage({ stub, name: "nav-label-artist", windowSize: "390x844", budgetMs: 40000, driver: `
    await window.__sleep(800);
    var back = document.getElementById("topbar-back"), modal = document.getElementById("album-modal");
    function st() { return { modal: !modal.classList.contains("hidden"), back: !back.classList.contains("hidden"),
                             artist: window.__artistViewActive() }; }
    window.__openAlbum(${JSON.stringify(ALBUMS[0])}, { source: "search" });
    await window.__sleep(1200);
    Array.prototype.filter.call(document.querySelectorAll("#modal-subtitle .modal-artist-link"),
      function (b) { return b.textContent === "Island"; })[0].click();
    await window.__sleep(900);
    document.querySelector("#album-grid .album").click(); await window.__sleep(1200);
    Array.prototype.filter.call(document.querySelectorAll(".modal-artist-link"),
      function (b) { return /^Artist/.test(b.textContent); })[0].click();
    await window.__sleep(1000);
    T("artist", st());
    back.click(); await window.__sleep(1200);         // artist view → the label page (album B over it)
    document.getElementById("modal-close-btn").click(); await window.__sleep(800);
    T("label_again", st());
    back.click(); await window.__sleep(1200);         // the label page → album A
    T("final", st());
  ` });
  harness.assertNoPageError(assert, r);
  assert.equal(r.artist.artist, true, "the fixture never reached the artist view");
  assert.equal(r.label_again.modal, false);
  assert.equal(r.final.modal, true, "‹ from the label page went Home after an artist view — the way back to the album was lost");
});

test("a screen whose Home row is switched off is listed in the side menu (v1.8.83)", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const rows = [{ id: "random", on: false }, { id: "picks", on: true }, { id: "library", on: true }];
  const stub = STUB.replace('if (u.indexOf("/api/zones") > -1)',
    'if (u.indexOf("/api/settings/home-rows") > -1) return window.__json({ rows: ' + JSON.stringify(rows) + ' });\n  if (u.indexOf("/api/zones") > -1)');
  const r = harness.renderPage({ stub, name: "nav-row-off", windowSize: "390x844", driver: `
    await window.__sleep(900);
    function hidden(id) { var e = document.getElementById(id); return !e || e.classList.contains("hidden"); }
    T("random_hidden", hidden("menu-item-random"));
    T("picks_hidden", hidden("menu-item-picks"));
    T("row_hidden", document.getElementById("home-random").closest(".home-section").classList.contains("hidden"));
    document.getElementById("menu-toggle").click(); await window.__sleep(200);
    document.getElementById("menu-item-random").click(); await window.__sleep(800);
    T("wall", { title: (document.getElementById("album-count") || {}).textContent || "",
                tiles: document.querySelectorAll("#album-grid .album").length });
  ` });
  harness.assertNoPageError(assert, r);
  assert.equal(r.row_hidden, true, "precondition: the Random albums row is not switched off");
  assert.equal(r.random_hidden, false, "Random albums is unreachable: its Home row is off and it has no menu entry");
  assert.equal(r.picks_hidden, true, "Smart Picks is listed while its Home row is on");
  assert.ok(r.wall.tiles > 0, "the menu entry did not open the Random albums wall");
});
