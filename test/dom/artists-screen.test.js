"use strict";
// ---------------------------------------------------------------------------
// v1.9.70-t6 (dev/design/artists.md §3): the Artists screen, from the touch bar's Artists button, at a phone's and a
// tablet's sizes. Every album artist A to Z under a heading per letter (# after Z), each a round picture (the kept
// photo, else a cover), the name and the album count; the names on screen with no photo are asked for, and a photo
// found shows; the letter strip jumps; a tap opens the artist's page, whose Back returns to the screen as it was;
// Artists tapped again goes back to the top; Home leaves it.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const TOUCH = ["--blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=1,availableHoverTypes=1"];
const NAMES = ["ABBA", "Adele", "Beck", "Björk", "Black Sabbath", "Blur", "Cream", "Deep Purple", "Elbow", "Free", "Genesis", "Heart",
  "Iron Maiden", "Japan", "Kiss", "Low", "Muse", "Nirvana", "Oasis", "Pulp", "Queen", "Rush", "Slade", "Toto", "U2", "Yes", "ZZ Top", "2Pac", "808 State"];
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const ARTISTS = NAMES.map((name, i) => ({ name, albums: (i % 4) + 1, cover: i % 3 ? "c" + i : null,
  // Adele's loads; Beck's is gone (it fails, and is dropped for the cover or the initial).
  photo: name === "Adele" ? PNG : name === "Beck" ? "/photo/gone.png" : null, letter: /^[A-Z]/.test(name) ? name[0] : "#" }));
const ALBUMS = Array.from({ length: 12 }, (_, i) => ({ offset: i, title: "Album " + i, subtitle: "Muse", image_key: null }));
const ZONE = { zone_id: "z1", display_name: "Living Room", state: "paused", outputs: [], now_playing: null };

const STUB = `
try { localStorage.setItem("rra-zone", "z1"); } catch (e) { /* storage optional */ }
window.__asked = [];
// The photos' answers wait for __release() (set by the driver), so one can come while the artist page is open.
window.__held = []; window.__release = function () { var h = window.__held; window.__held = []; h.forEach(function (f) { f(); }); };
var ALBUMS = ${JSON.stringify(ALBUMS)};
window.__installFetch(function (u) {
  if (u.indexOf("/api/artists/photos") > -1) {
    window.__asked.push(decodeURIComponent(u));
    var answer = { photos: u.indexOf("n=ABBA") > -1 ? { ABBA: ${JSON.stringify(PNG)} } : {} };
    return new Promise(function (r) { window.__held.push(function () { r(window.__json(answer)); }); });
  }
  if (u.indexOf("/api/artists") > -1)       return window.__json({ ready: true, artists: ${JSON.stringify(ARTISTS)} });
  if (u.indexOf("/api/artist-albums") > -1) return window.__json({ artist: "Muse", primary: ALBUMS, featured: [] });
  if (u.indexOf("/api/artist-bio") > -1)    return window.__json({ bio: null });
  if (u.indexOf("/api/artist/members") > -1) return window.__json({ members: [], status: "ok" });
  if (u.indexOf("/api/random-albums") > -1) return window.__json({ albums: ALBUMS, total: 12, filtered: false });
  if (u.indexOf("/api/home/") > -1)         return window.__json({ albums: ALBUMS.slice(0, 6), label: null });
  if (u.indexOf("/api/zone-state") > -1)    return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (u.indexOf("/api/zones") > -1)         return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (u.indexOf("/api/status") > -1)        return window.__json({ paired: true });
  if (u.indexOf("/api/update/status") > -1) return window.__json({ is_docker: true });
  if (u.indexOf("/photo/") > -1)            return undefined;
  if (u.indexOf("/api/") > -1)              return window.__json({});
  return undefined;
});
`;

const DRIVER = `
  var html = document.documentElement;
  function $(id) { return document.getElementById(id); }
  function shown(el) { return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden"; }
  async function until(f, what) {
    for (var i = 0; i < 100; i++) { var v = f(); if (v) return v; await window.__sleep(50); }
    throw new Error("not in time: " + what);
  }
  var main = document.querySelector("main");
  await window.__sleep(800);
  var lit0 = getComputedStyle($("tnav-artists")).color;
  $("tnav-artists").click();
  await until(function () { return document.querySelectorAll(".artist-tile").length; }, "the Artists screen");
  await window.__sleep(200);
  function tileOf(n) { return document.querySelector('.artist-tile[data-name="' + n + '"]'); }
  T("screen", {
    title: $("album-count").textContent.trim(), artistsOn: html.classList.contains("tn-artists"),
    lit: [lit0, getComputedStyle($("tnav-artists")).color],
    letters: [].map.call(document.querySelectorAll(".artists-letter"), function (h) { return h.textContent; }),
    strip: [].map.call(document.querySelectorAll(".artists-jump"), function (b) { return b.textContent; }),
    names: [].map.call(document.querySelectorAll(".artist-tile"), function (b) { return b.dataset.name; }),
    adele: [tileOf("Adele").querySelector(".artist-photo") && tileOf("Adele").querySelector(".artist-photo").getAttribute("src"), tileOf("Adele").querySelector(".artist-count").textContent],
    beck: [!!tileOf("Beck").querySelector("img"), tileOf("Beck").querySelector(".artist-count").textContent],
    cream: !!tileOf("Cream").querySelector("img"),
    round: getComputedStyle(tileOf("Beck").querySelector(".artist-pic")).borderRadius,
    noSideways: main.scrollWidth <= main.clientWidth + 1,
  });
  // The names on screen with no photo, asked for. The answer comes while an artist's page is open (the screen parked):
  // after its Back, the photo found is on its tile.
  await until(function () { return window.__asked.length && window.__held.length; }, "the photos asked for");
  var asked = window.__asked.join("|");
  tileOf("Cream").click();
  await until(function () { return window.__artistViewActive && window.__artistViewActive(); }, "Cream's page");
  window.__release(); await window.__sleep(300);
  $("topbar-back").click();
  await until(function () { return document.getElementById("artists-view") && document.getElementById("artists-view").isConnected; }, "back to Artists");
  await until(function () { return tileOf("ABBA").querySelector(".artist-photo"); }, "ABBA's photo, answered while parked");
  T("photos", { askedAbba: asked.indexOf("n=ABBA") > -1, askedAdele: asked.indexOf("n=Adele") > -1,
    abba: tileOf("ABBA").querySelector(".artist-photo").getAttribute("src"),
    beckGone: !tileOf("Beck").querySelector(".artist-photo") && !!tileOf("Beck").querySelector(".artist-initial") });
  // From here the answers are not held.
  window.__release(); var releaser = setInterval(window.__release, 50);
  // The strip jumps to a letter's heading.
  var jumpS = [].find.call(document.querySelectorAll(".artists-jump"), function (b) { return b.textContent === "S"; });
  jumpS.click(); await window.__sleep(300);
  var headS = $("artists-S");
  T("jump", { headTop: Math.round(headS.getBoundingClientRect().top), mainTop: Math.round(main.getBoundingClientRect().top), scrolled: main.scrollTop > 0, stripTappable: (function () { var b = jumpS.getBoundingClientRect(); var hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!hit && jumpS.contains(hit); })() });
  var before = main.scrollTop;
  // A tap: the artist's page; its Back: the screen as it was, where it was.
  tileOf("Slade").click();
  await until(function () { return window.__artistViewActive && window.__artistViewActive(); }, "the artist's page");
  await window.__sleep(300);
  T("artistPage", { artistsOn: html.classList.contains("tn-artists"), screenGone: !document.getElementById("artists-view") || !document.getElementById("artists-view").isConnected });
  $("topbar-back").click();
  await until(function () { return document.getElementById("artists-view") && document.getElementById("artists-view").isConnected; }, "back to Artists");
  await window.__sleep(300);
  T("back", { artistsOn: html.classList.contains("tn-artists"), tiles: document.querySelectorAll(".artist-tile").length, title: $("album-count").textContent.trim(),
    scroll: Math.abs(main.scrollTop - before) <= 2, abbaKept: !!tileOf("ABBA").querySelector(".artist-photo") });
  // Artists again: to the top. Home: leaves it.
  // (A smooth scroll does not run under this harness's virtual clock: the scroll asked for is read instead.)
  var tops = [], scrollTo = main.scrollTo.bind(main);
  main.scrollTo = function (o) { tops.push(o && o.top); return scrollTo(o); };
  $("tnav-artists").click(); await window.__sleep(300);
  main.scrollTo = scrollTo;
  T("again", { top: tops, stillThere: !!document.getElementById("artists-view") });
  $("tnav-home").click();
  await until(function () { return html.classList.contains("tn-home"); }, "Home");
  T("home", html.classList.contains("tn-artists"));
  // Shelf: the side menu's Shelf (its page, here stood in for, as a navigation would end the run).
  var shelfAsked = 0; window.__openShelf = function () { shelfAsked++; };
  $("tnav-shelf").click(); await window.__sleep(100);
  T("shelf", shelfAsked);
  clearInterval(releaser);
`;

const expectedNames = [...NAMES.filter((n) => /^[A-Z]/.test(n)), ...NAMES.filter((n) => !/^[A-Z]/.test(n))];

for (const size of ["390x844", "1180x820"]) {
  test("the Artists screen at " + size + " (v1.9.70-t6)", { skip: !harness.available && "no chromium" }, async (t) => {
    const R = harness.renderPage({ stub: STUB, driver: DRIVER, name: "artists-" + size, windowSize: size, chromeArgs: TOUCH, budgetMs: 40000 });
    harness.assertNoPageError(assert, R);
    await t.test("THE one: every artist, A to Z under a heading a letter (# last), round pictures, counts", () => {
      assert.equal(R.screen.title, "Artists");
      assert.equal(R.screen.artistsOn, true);
      assert.notEqual(R.screen.lit[0], R.screen.lit[1], "Artists is not lit on its screen");
      assert.deepEqual(R.screen.names, expectedNames);
      assert.deepEqual(R.screen.letters, ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "Y", "Z", "#"]);
      assert.deepEqual(R.screen.strip, R.screen.letters, "the strip is not the headings");
      assert.deepEqual(R.screen.adele, [PNG, "2 albums"]);
      assert.deepEqual(R.screen.beck, [true, "3 albums"], "a cover stands in for a photo");
      assert.equal(R.screen.cream, false, "no photo and no cover: the initial alone");
      assert.equal(R.screen.round, "50%");
      assert.equal(R.screen.noSideways, true, "the screen scrolls sideways");
    });
    await t.test("the names on screen with no photo are asked for; a photo found shows, even answered while the artist page was open", () => {
      assert.equal(R.photos.askedAbba, true);
      assert.equal(R.photos.askedAdele, false, "a name with its photo was asked for");
      assert.equal(R.photos.abba, PNG, "THE one: a photo answered while the artist page was open is not on its tile after Back");
      assert.equal(R.photos.beckGone, true, "a photo that fails to load is not dropped for what was under it");
    });
    await t.test("the letter strip jumps to the letter, and can be tapped", () => {
      assert.ok(R.jump.scrolled, "the strip did not scroll");
      assert.ok(Math.abs(R.jump.headTop - R.jump.mainTop) < 80, "S is not at the top: " + JSON.stringify(R.jump));
      assert.equal(R.jump.stripTappable, true);
    });
    await t.test("a tap opens the artist's page; its Back returns to Artists as it was", () => {
      assert.deepEqual(R.artistPage, { artistsOn: false, screenGone: true });
      assert.deepEqual(R.back, { artistsOn: true, tiles: NAMES.length, title: "Artists", scroll: true, abbaKept: true });
    });
    await t.test("Artists again goes back to the top; Home leaves the screen; Shelf opens the Shelf", () => {
      assert.deepEqual(R.again, { top: [0], stillThere: true }, "Artists again did not go to the top, or drew the screen afresh");
      assert.equal(R.home, false);
      assert.equal(R.shelf, 1, "Shelf in the bar did not open the Shelf");
    });
  });
}
