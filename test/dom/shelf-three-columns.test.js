"use strict";
// ---------------------------------------------------------------------------
// v1.9.71 (the owner, 2026-10-28: "Albums view screens for the shelf and library albums should be the same for
// landscape screens. The 3 column view … Those last two renders are not showing a 3 column album view screen … There
// were no track times either"). On a landscape screen at least 1000x600 the Shelf's album view is the library's three
// columns: the cover, the title, the buttons, the credits and More by down the left; About this album in the middle;
// the tracks, each with its length, at the right — the columns where the library's view has them. A portrait screen and
// a phone keep the Shelf's own view. dev/design/album-view-landscape.md §7 step 4, album-view.md.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");
const { buildShelf, shelfSignature } = require("../../lib/shelf");
const { KINDS } = require("../../lib/release-facts");
const TOUCH = ["--blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=1,availableHoverTypes=1"];
const REMOTE = ["--blink-settings=primaryPointerType=1,availablePointerTypes=1,primaryHoverType=1,availableHoverTypes=1"];
const TITLES = ["Morph the Cat", "H Gang", "What I Do", "Brite Nitegown", "The Great Pagoda of Funn", "Security Joan", "The Night Belongs to Mona", "Mary Shut the Garden Door", "Morph the Cat (Reprise)"];
const TIMES = TITLES.map((t, i) => ({ disc: 1, number: i + 1, title: t, seconds: 200 + i * 23 }));
const CREDITS = ["Donald Fagen|Vocals, Keyboards", "Wayne Krantz|Guitar", "Keith Carlock|Drums", "Freddie Washington|Bass", "Walt Weiskopf|Tenor saxophone", "Ken Wessel|Guitar", "Elliott Scheiner|Engineer", "Hugh Padgham|Mixing", "Ted Baker|Piano"]
  .map((x) => { const [name, role] = x.split("|"); return { name, key: name.toLowerCase(), roles: [role], tracks: [] }; });
const REVIEW = "Morph the Cat is the third solo studio album by Donald Fagen, released in 2006. It completed a trilogy begun with The Nightfly. ".repeat(4);
const MORE = [{ title: "The Nightfly", subtitle: "Donald Fagen", image_key: "m1", offset: 101 }, { title: "Kamakiriad", subtitle: "Donald Fagen", image_key: "m2", offset: 102 }, { title: "Sunken Condos", subtitle: "Donald Fagen", image_key: "m3", offset: 103 }];
const SHELF = buildShelf([["Donald Fagen", "Morph the Cat"], ["Donald Fagen", "The Nightfly"], ["Donald Fagen", "Kamakiriad"]].map(([artist, title], i) =>
  ({ offset: 100 + i, title, subtitle: artist, image_key: "k" + i, g: ["Rock"], f: "donald fagen", l: "Reprise", c: null, ty: "album", y: 2006 })),
  { genresOf: (al) => al.g, firstOf: (al) => al.f, yearOf: (al) => al.y, labelOf: (al) => al.l, catOf: (al) => al.c, typeOf: (al) => al.ty });
const ANSWER = Object.assign({ total: SHELF.albums.length, rev: "1.0", sig: shelfSignature(SHELF), kinds: KINDS }, SHELF);
const ZONE = { zone_id: "z1", display_name: "Living Room", state: "paused" };
const common = `
  if (u.indexOf("/api/album/track-times") > -1) return window.__json({ tracks: ${JSON.stringify(TIMES)}, status: "ok" });
  if (u.indexOf("/api/album/credits") > -1) return window.__json({ credits: ${JSON.stringify(CREDITS)}, status: "ok" });
  if (u.indexOf("/api/album/extras") > -1) return window.__json({ album: { description: ${JSON.stringify(REVIEW)}, source: "wikipedia", url: "https://en.wikipedia.org/wiki/Morph_the_Cat" } });
  if (u.indexOf("/api/album/more") > -1) return window.__json({ artist: "Donald Fagen", by: ${JSON.stringify(MORE)}, appears: [] });
  if (u.indexOf("/api/lastfm/") > -1) return window.__json({ enabled: false });`;
const shelfStub = `
window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(performance.now()); }, 16); };
window.cancelAnimationFrame = function (id) { clearTimeout(id); };
navigation.addEventListener("navigate", function (e) { if (e.cancelable) e.preventDefault(); });
try { localStorage.clear(); localStorage.setItem("rra-zone", "z1"); localStorage.setItem("rra-shelf-look", "spines"); localStorage.setItem("rra-shelf-help", JSON.stringify({ seen: "1.9.71", never: true })); } catch (e) { /* here */ }
window.__installFetch(function (u) { ${common}
  if (u.indexOf("/api/shelf/albums") > -1) return window.__json(${JSON.stringify(ANSWER)});
  if (u.indexOf("/api/live") > -1) return window.__json({ rev: { library: "1.0", settings: "1" } });
  if (u.indexOf("/api/settings/display") > -1) return window.__json({ enabled: false, seconds: 10 });
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (u.indexOf("/api/album?") > -1) return window.__json({ tracks: ${JSON.stringify(TITLES.map((title) => ({ title })))}, discs: null });
  if (u.indexOf("/api/update/status") > -1) return window.__json({ current: "1.9.71" });
  return undefined; });`;
const ALBUM = { offset: 100, title: "Morph the Cat", subtitle: "Donald Fagen", image_key: "k" };
const remoteStub = `
window.__installFetch(function (u) { ${common}
  if (u.indexOf("/api/user-playlists") > -1) return window.__json({ playlists: [] });
  if (u.indexOf("/api/album") > -1) return window.__json(${JSON.stringify({ title: "Morph the Cat", subtitle: "Donald Fagen", image_key: "k", actions: [{ kind: "play_now", title: "Play Now" }], tracks: TITLES.map((title) => ({ title, subtitle: "Donald Fagen" })) })});
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [] });
  if (u.indexOf("/api/filters") > -1) return window.__json({ genres: [] });
  if (u.indexOf("/api/home/") > -1) return window.__json({ albums: [], label: null });
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (u.indexOf("/api/settings") > -1) return window.__json({});
  if (u.indexOf("/api/random-albums") > -1) return window.__json({ albums: [${JSON.stringify(ALBUM)}], total: 1, filtered: false });
  return undefined; });`;

const BOX = `function box(s) { var e = document.querySelector(s); if (!e) return null; var r = e.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), r: Math.round(r.right) }; }`;
const shelfDriver = `
  var __st = document.createElement("style"); __st.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; }"; document.head.appendChild(__st);
  var S = function () { return window.__shelfState(); };
  for (var i = 0; i < 80 && !(S() && S().N); i++) await window.__sleep(100);
  await window.__sleep(400);
  var stage = document.getElementById("stage"), front = document.querySelector('.it[data-v="' + Math.round(S().p) + '"]'), b = front.getBoundingClientRect();
  var at = { pointerId: 9, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, bubbles: true, pointerType: "touch", isPrimary: true };
  stage.dispatchEvent(new PointerEvent("pointerdown", at)); stage.dispatchEvent(new PointerEvent("pointerup", at));
  await window.__sleep(2200);
  ${BOX}
  T("v", { grid: getComputedStyle(document.querySelector("#open .ov-body")).display, art: box("#open .ov-art"), acts: box("#open .ov-acts-slot"), credits: box("#open .ov-credits"),
    more: box("#open .ov-more"), review: box("#open .ov-review"), tracks: box("#open .ov-tracks"),
    lens: Array.prototype.map.call(document.querySelectorAll("#open .bk-len"), function (e) { return e.textContent; }) });
`;
// Both views measured at rest: animations off on both pages, as the Shelf's driver has them. The library's album card
// opens with modal-in (8px up into place); the test's browser held it part-way, and the columns were compared with a card
// 8px short of where it stops — until a busy CI runner let the animation finish (dev, 2026-10-29: 72 against 80).
const remoteDriver = `
  var __st = document.createElement("style"); __st.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; }"; document.head.appendChild(__st);
  await window.__sleep(700);
  window.__openAlbum(${JSON.stringify(ALBUM)}, { source: "search" });
  await window.__sleep(2200);
  ${BOX}
  T("v", { art: box(".modal-art"), review: box("#album-bio-section"), tracks: box(".track-list-wrap"), lens: Array.prototype.map.call(document.querySelectorAll("#modal-tracks .t-len"), function (e) { return e.textContent; }) });
`;
const LENS = TIMES.map((t) => Math.floor(t.seconds / 60) + ":" + String(t.seconds % 60).padStart(2, "0"));
const near = (a, b, d) => Math.abs(a - b) <= d;

for (const [name, size, args] of [["TV", "1920x1080", REMOTE], ["iPad on its side", "1180x820", TOUCH], ["iPad Pro on its side", "1366x1024", TOUCH], ["desktop", "1440x900", harness.MOUSE]]) {
  test(`v1.9.71 (${name}, ${size}): the Shelf's album view is the library's three columns, every track with its length`, { skip: !harness.available }, async (t) => {
    const shelf = harness.renderPage({ name: "three-shelf-" + size, page: "shelf", windowSize: size, chromeArgs: args, budgetMs: 40000, stub: shelfStub, driver: shelfDriver });
    const lib = harness.renderPage({ name: "three-lib-" + size, windowSize: size, chromeArgs: args, budgetMs: 20000, stub: remoteStub, driver: remoteDriver });
    harness.assertNoPageError(assert, shelf);
    harness.assertNoPageError(assert, lib);
    const s = shelf.v, l = lib.v;
    await t.test("THE one: three columns side by side — the cover, About this album, the tracks — level at the top", () => {
      assert.equal(s.grid, "grid");
      assert.ok(s.art.r <= s.review.l && s.review.r <= s.tracks.l, JSON.stringify(s));
      assert.ok(near(s.art.t, s.review.t, 12) && near(s.review.t, s.tracks.t, 12), JSON.stringify(s));
    });
    await t.test("down the left: the buttons, the credits and More by, under the cover", () => {
      for (const k of ["acts", "credits", "more"]) assert.ok(near(s[k].l, s.art.l, 2) && s[k].t > s.art.t, k + " " + JSON.stringify(s[k]));
      assert.ok(s.acts.t < s.credits.t && s.credits.t < s.more.t);
    });
    await t.test("the columns where the library's view has them", () => {
      for (const k of ["art", "review", "tracks"]) assert.ok(near(s[k].l, l[k].l, 2) && near(s[k].t, l[k].t, 2) && near(s[k].w, l[k].w, 2), k + " " + JSON.stringify({ shelf: s[k], library: l[k] }));
    });
    await t.test("every track its length, on both views", () => {
      assert.deepEqual(s.lens, LENS);
      assert.deepEqual(l.lens, LENS);
    });
  });
}

for (const [name, size] of [["phone", "390x844"], ["iPad upright", "820x1180"], ["phone on its side", "844x390"]]) {
  test(`v1.9.71 (${name}, ${size}): not landscape enough — the Shelf's own view, with the lengths`, { skip: !harness.available }, async (t) => {
    const shelf = harness.renderPage({ name: "three-shelf-" + size, page: "shelf", windowSize: size, chromeArgs: TOUCH, budgetMs: 40000, stub: shelfStub, driver: shelfDriver });
    harness.assertNoPageError(assert, shelf);
    await t.test("no grid, and every length", () => {
      assert.notEqual(shelf.v.grid, "grid");
      assert.deepEqual(shelf.v.lens, LENS);
    });
  });
}
