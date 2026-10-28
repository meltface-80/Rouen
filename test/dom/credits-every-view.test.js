"use strict";
// ---------------------------------------------------------------------------
// v1.9.71-t1 (the owner, 2026-10-28: "Also verify credits (artists for that album) show on all album screens for all
// screen types and orientations"). Two album screens: the remote's album view (public/album-credits.js since
// v1.9.70-t1) and the Shelf's (shelf-back.js), which had none. Each is drawn on a phone upright and on its side, a
// tablet upright and on its side, a desktop and a TV, and its credits must be there, scrolled to, on screen and the
// topmost thing where they are — not under the mini player, the bar or anything else.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");
const { buildShelf, shelfSignature } = require("../../lib/shelf");
const { KINDS } = require("../../lib/release-facts");

const TOUCH = ["--blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=1,availableHoverTypes=1"];
const REMOTE = ["--blink-settings=primaryPointerType=1,availablePointerTypes=1,primaryHoverType=1,availableHoverTypes=1"];
const SCREENS = [["phone upright", "390x844", TOUCH], ["phone on its side", "844x390", TOUCH], ["tablet upright", "820x1180", TOUCH],
  ["tablet on its side", "1180x820", TOUCH], ["desktop", "1440x900", harness.MOUSE], ["TV", "1920x1080", REMOTE]];

const CREDITS = ["Donald Fagen|Vocals, Keyboards", "Wayne Krantz|Guitar", "Keith Carlock|Drums", "Freddie Washington|Bass",
  "Walt Weiskopf|Tenor saxophone", "Ken Wessel|Guitar", "Elliott Scheiner|Engineer", "Hugh Padgham|Mixing", "Ted Baker|Piano", "Marvin Stamm|Trumpet"]
  .map((x) => { const [name, role] = x.split("|"); return { name, key: name.toLowerCase(), roles: [role], tracks: [] }; });
const TITLES = ["Morph the Cat", "H Gang", "What I Do", "Brite Nitegown", "The Great Pagoda of Funn", "Security Joan"];

// What is on screen at the first credit, once scrolled to: [shown, count, first name, on screen, topmost there].
const PROBE = `
  async function creditsIn(sel) {
    var sec = document.querySelector(sel);
    if (!sec) return { there: false };
    var first = sec.querySelector(".credit");
    var out = { there: true, hidden: sec.classList.contains("hidden") || getComputedStyle(sec).display === "none",
                rows: sec.querySelectorAll(".credit").length, shown: Array.prototype.filter.call(sec.querySelectorAll(".credit"), function (c) { return c.getClientRects().length > 0; }).length,
                first: first ? first.querySelector(".credit-name").textContent : null };
    if (!first) return out;
    first.scrollIntoView({ block: "center" });
    await window.__sleep(200);
    var b = first.getBoundingClientRect(), hit = document.elementFromPoint(b.left + Math.min(16, b.width / 2), b.top + b.height / 2);
    out.onScreen = b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth;
    out.topmost = !!hit && first.contains(hit);
    return out;
  }
`;

// ---- the remote's album view ------------------------------------------------------------------------------------
const ALBUM = { offset: 0, title: "Morph the Cat", subtitle: "Donald Fagen", image_key: "k" };
const remoteStub = `
window.__installFetch(function (url) {
  if (url.indexOf("/api/album/track-times") > -1) return window.__json({ tracks: [], status: "none" });
  if (url.indexOf("/api/user-playlists") > -1) return window.__json({ playlists: [] });
  if (url.indexOf("/api/album/extras") > -1)  return window.__json({ album: { description: "A review. ".repeat(30), source: "wikipedia", url: "https://en.wikipedia.org/wiki/x" } });
  if (url.indexOf("/api/album/credits") > -1) return window.__json({ credits: ${JSON.stringify(CREDITS)}, status: "ok" });
  if (url.indexOf("/api/album/more") > -1)    return window.__json({ artist: "Donald Fagen", by: [], appears: [] });
  if (url.indexOf("/api/lastfm/") > -1)       return window.__json({ enabled: false });
  if (url.indexOf("/api/album") > -1)
    return window.__json(${JSON.stringify({ title: "Morph the Cat", subtitle: "Donald Fagen", image_key: "k", actions: [{ kind: "play_now", title: "Play Now" }], tracks: TITLES.map((title) => ({ title, subtitle: "Donald Fagen" })) })});
  if (url.indexOf("/api/zones") > -1)      return window.__json({ zones: [] });
  if (url.indexOf("/api/filters") > -1)    return window.__json({ genres: [] });
  if (url.indexOf("/api/home/") > -1)      return window.__json({ albums: [], label: null });
  if (url.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  if (url.indexOf("/api/settings") > -1)   return window.__json({});
  if (url.indexOf("/api/random-albums") > -1) return window.__json({ albums: [${JSON.stringify(ALBUM)}], total: 1, filtered: false });
  return undefined;
});`;

for (const [name, size, args] of SCREENS) {
  test(`v1.9.71-t1 (${name}, ${size}): the remote's album view shows the album's credits`, { skip: !harness.available }, async (t) => {
    const r = harness.renderPage({ name: "credits-remote-" + size, windowSize: size, chromeArgs: args, budgetMs: 20000, stub: remoteStub, driver: PROBE + `
      await window.__sleep(700);
      window.__openAlbum(${JSON.stringify(ALBUM)}, { source: "search" });
      await window.__sleep(1800);
      T("c", await creditsIn("#album-credits"));
    ` });
    harness.assertNoPageError(assert, r);
    await t.test("there, eight shown of ten, the first on screen and nothing over it", () => {
      assert.deepEqual(r.c, { there: true, hidden: false, rows: 10, shown: 8, first: "Donald Fagen", onScreen: true, topmost: true });
    });
  });
}

// ---- the Shelf's album view -------------------------------------------------------------------------------------
const SHELF = buildShelf(
  [["Donald Fagen", "Morph the Cat"], ["Donald Fagen", "Kamakiriad"], ["Steely Dan", "Aja"]].map(([artist, title], i) =>
    ({ offset: 100 + i, title, subtitle: artist, image_key: "k" + i, g: ["Rock"], f: artist.toLowerCase(), l: null, c: null, ty: "album", y: 2006 })),
  { genresOf: (al) => al.g, firstOf: (al) => al.f, yearOf: (al) => al.y, labelOf: (al) => al.l, catOf: (al) => al.c, typeOf: (al) => al.ty });
const ANSWER = Object.assign({ total: SHELF.albums.length, rev: "1.0", sig: shelfSignature(SHELF), kinds: KINDS }, SHELF);
const ZONE = { zone_id: "z1", display_name: "Living Room", state: "paused" };
const shelfStub = `
window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(performance.now()); }, 16); };
window.cancelAnimationFrame = function (id) { clearTimeout(id); };
navigation.addEventListener("navigate", function (e) { if (e.cancelable) e.preventDefault(); });
window.__creditsAsked = [];
try { localStorage.clear(); localStorage.setItem("rra-zone", "z1"); localStorage.setItem("rra-shelf-look", "spines");
      localStorage.setItem("rra-shelf-help", JSON.stringify({ seen: "1.9.71", never: true })); } catch (e) { /* always there here */ }
window.__installFetch(function (u) {
  if (u.indexOf("/api/album/credits") > -1) { window.__creditsAsked.push(u); return window.__json({ credits: ${JSON.stringify(CREDITS)}, status: "ok" }); }
  if (u.indexOf("/api/album/track-times") > -1) return window.__json({ tracks: [], status: "none" });
  if (u.indexOf("/api/album/extras") > -1) return window.__json({ album: { description: "A review. ".repeat(30), source: "wikipedia", url: "https://en.wikipedia.org/wiki/x" } });
  if (u.indexOf("/api/album/more") > -1) return window.__json({ artist: "Donald Fagen", by: [], appears: [] });
  if (u.indexOf("/api/shelf/albums") > -1) return window.__json(${JSON.stringify(ANSWER)});
  if (u.indexOf("/api/live") > -1) return window.__json({ rev: { library: "1.0", settings: "1" } });
  if (u.indexOf("/api/settings/display") > -1) return window.__json({ enabled: false, seconds: 10 });
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (u.indexOf("/api/album?") > -1) return window.__json({ tracks: ${JSON.stringify(TITLES.map((title) => ({ title })))}, discs: null });
  if (u.indexOf("/api/update/status") > -1) return window.__json({ current: "1.9.71-t1" });
  return undefined;
});`;
const SHELF_DRIVER = PROBE + `
  var S = function () { return window.__shelfState(); };
  for (var i = 0; i < 80 && !(S() && S().N); i++) await window.__sleep(100);
  await window.__sleep(400);
  var stage = document.getElementById("stage");
  var front = document.querySelector('.it[data-v="' + Math.round(S().p) + '"]'), b = front.getBoundingClientRect();
  var at = { pointerId: 9, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, bubbles: true, pointerType: "touch", isPrimary: true };
  stage.dispatchEvent(new PointerEvent("pointerdown", at)); stage.dispatchEvent(new PointerEvent("pointerup", at));
  await window.__sleep(1800);
  T("c", await creditsIn("#open .ov-credits"));
  // More shows the rest; the view drawn again (the review coming, a track chosen) keeps them
  var more = document.querySelector("#open .ov-credits .more-toggle");
  if (more) more.click();
  await window.__sleep(100);
  T("more", { label: more ? more.textContent : null, expanded: more ? more.getAttribute("aria-expanded") : null, shown: Array.prototype.filter.call(document.querySelectorAll("#open .ov-credits .credit"), function (c) { return c.getClientRects().length > 0; }).length,
              open: !document.getElementById("open").classList.contains("hidden") });
  T("asked", window.__creditsAsked.length);
`;

for (const [name, size, args] of SCREENS) {
  test(`v1.9.71-t1 (${name}, ${size}): the Shelf's album view shows the album's credits`, { skip: !harness.available }, async (t) => {
    const r = harness.renderPage({ name: "credits-shelf-" + size, page: "shelf", windowSize: size, chromeArgs: args, budgetMs: 40000, stub: shelfStub, driver: SHELF_DRIVER });
    harness.assertNoPageError(assert, r);
    await t.test("THE one: there, eight shown of ten, the first on screen and nothing over it", () => {
      assert.deepEqual(r.c, { there: true, hidden: false, rows: 10, shown: 8, first: "Donald Fagen", onScreen: true, topmost: true });
    });
    await t.test("More shows all ten, the view still open; asked once", () => {
      assert.deepEqual(r.more, { label: "Less", expanded: "true", shown: 10, open: true });
      assert.equal(r.asked, 1);
    });
  });
}

test("v1.9.71-t1 (the review): the Shelf asks for an album's credits again when the last ask failed", { skip: !harness.available }, async (t) => {
  // the first ask fails (the server busy); the album closed and opened again: asked again, and shown
  const failing = shelfStub.replace(`if (u.indexOf("/api/album/credits") > -1) { window.__creditsAsked.push(u); return`,
    `if (u.indexOf("/api/album/credits") > -1 && !window.__creditsAsked.length) { window.__creditsAsked.push(u); return window.__json({ error: "busy" }, 500); }
  if (u.indexOf("/api/album/credits") > -1) { window.__creditsAsked.push(u); return`);
  assert.notEqual(failing, shelfStub, "the stub's answer was replaced");
  const r = harness.renderPage({ name: "credits-shelf-again", page: "shelf", windowSize: "1180x820", chromeArgs: TOUCH, budgetMs: 40000, stub: failing, driver: PROBE + `
    var S = function () { return window.__shelfState(); };
    for (var i = 0; i < 80 && !(S() && S().N); i++) await window.__sleep(100);
    await window.__sleep(400);
    var stage = document.getElementById("stage");
    async function turn() {
      var front = document.querySelector('.it[data-v="' + Math.round(S().p) + '"]'), b = front.getBoundingClientRect();
      var at = { pointerId: 9, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, bubbles: true, pointerType: "touch", isPrimary: true };
      stage.dispatchEvent(new PointerEvent("pointerdown", at)); stage.dispatchEvent(new PointerEvent("pointerup", at));
      await window.__sleep(1500);
    }
    await turn();
    T("first", { asked: window.__creditsAsked.length, there: !!document.querySelector("#open .ov-credits") });
    document.getElementById("open-close").click();
    await window.__sleep(900);
    await turn();
    T("again", { asked: window.__creditsAsked.length, c: await creditsIn("#open .ov-credits") });
  ` });
  harness.assertNoPageError(assert, r);
  await t.test("none after the failed ask; asked again on the next opening, and shown", () => {
    assert.deepEqual(r.first, { asked: 1, there: false });
    assert.equal(r.again.asked, 2);
    assert.equal(r.again.c.rows, 10);
  });
});
