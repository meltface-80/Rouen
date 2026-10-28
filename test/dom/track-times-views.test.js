"use strict";
// ---------------------------------------------------------------------------
// v1.9.71-t1 (public/track-times.js; dev/design/native-remote.md §17.7). The owner, 2026-10-28: "Check and verify the
// track times show for landscape album screens … Use the official API mixed with the native mode reverse engineered
// code. I want reliability".
//   - The Shelf's album view — the full-screen album screen on a tablet or a TV — had no lengths: v1.9.70-t14 gave
//     them to the remote's album view alone. Now both views take them from the one module.
//   - The rows are the official API's and the lengths your server's: joined by title, then, when both lists have as
//     many tracks, by place — so a title written differently in the two lists (a remaster note) still gets its length,
//     and a count that disagrees never borrows another track's.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");
const { buildShelf, shelfSignature } = require("../../lib/shelf");
const { KINDS } = require("../../lib/release-facts");

const TOUCH = ["--blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=1,availableHoverTypes=1"];
const REMOTE = ["--blink-settings=primaryPointerType=1,availablePointerTypes=1,primaryHoverType=1,availableHoverTypes=1"];

// The official list's rows: the second written with a remaster note your server's list doesn't have.
const ROWS = ["Untitled", "Archangel (2007 Remaster)", "Near Dark", "Ghost Hardware"];
// Your server's, in its order.
const TIMES = [{ disc: 1, number: 1, title: "Untitled", seconds: 59 }, { disc: 1, number: 2, title: "Archangel", seconds: 238 },
  { disc: 1, number: 3, title: "Near Dark", seconds: 236 }, { disc: 1, number: 4, title: "Ghost Hardware", seconds: 293 }];

// ---- the Shelf's album view ------------------------------------------------------------------------------------
const SHELF = buildShelf(
  [["Burial", "Untrue"], ["Burial", "Archangel"], ["Bonobo", "Black Sands"]].map(([artist, title], i) =>
    ({ offset: 100 + i, title, subtitle: artist, image_key: "k" + i, g: ["Electronic"], f: artist.toLowerCase(), l: null, c: null, ty: "album", y: 2007 })),
  { genresOf: (al) => al.g, firstOf: (al) => al.f, yearOf: (al) => al.y, labelOf: (al) => al.l, catOf: (al) => al.c, typeOf: (al) => al.ty });
const ANSWER = Object.assign({ total: SHELF.albums.length, rev: "1.0", sig: shelfSignature(SHELF), kinds: KINDS }, SHELF);
const ZONE = { zone_id: "z1", display_name: "Living Room", state: "paused" };

const shelfStub = (times) => `
window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(performance.now()); }, 16); };
window.cancelAnimationFrame = function (id) { clearTimeout(id); };
navigation.addEventListener("navigate", function (e) { if (e.cancelable) e.preventDefault(); });
window.__asked = [];
try { localStorage.clear(); localStorage.setItem("rra-zone", "z1"); localStorage.setItem("rra-shelf-look", "spines");
      localStorage.setItem("rra-shelf-help", JSON.stringify({ seen: "1.9.71", never: true })); } catch (e) { /* always there here */ }
window.__installFetch(function (u) {
  if (u.indexOf("/api/album/track-times") > -1) {
    window.__asked.push(decodeURIComponent((u.match(/title=([^&]*)/) || [])[1] || "").replace(/\\+/g, " "));
    return window.__json({ tracks: ${JSON.stringify(times)}, status: "ok" });
  }
  if (u.indexOf("/api/shelf/albums") > -1) return window.__json(${JSON.stringify(ANSWER)});
  if (u.indexOf("/api/live") > -1) return window.__json({ rev: { library: "1.0", settings: "1" } });
  if (u.indexOf("/api/settings/display") > -1) return window.__json({ enabled: false, seconds: 10 });
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (u.indexOf("/api/album?") > -1) return window.__json({ tracks: ${JSON.stringify(ROWS.map((title) => ({ title })))}, discs: null });
  if (u.indexOf("/api/update/status") > -1) return window.__json({ current: "1.9.71-t1" });
  return undefined;
});`;
const SHELF_DRIVER = `
  var S = function () { return window.__shelfState(); };
  for (var i = 0; i < 80 && !(S() && S().N); i++) await window.__sleep(100);
  await window.__sleep(400);
  var stage = document.getElementById("stage");
  var front = document.querySelector('.it[data-v="' + Math.round(S().p) + '"]'), b = front.getBoundingClientRect();
  stage.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 9, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, bubbles: true, pointerType: "touch", isPrimary: true }));
  stage.dispatchEvent(new PointerEvent("pointerup", { pointerId: 9, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, bubbles: true, pointerType: "touch", isPrimary: true }));
  await window.__sleep(1500);
  T("rows", Array.prototype.map.call(document.querySelectorAll("#open .bk-tracks li.bk-t"), function (li) {
    var len = li.querySelector(".bk-len"), title = li.querySelector("span");
    var a = len && len.getBoundingClientRect(), t = title.getBoundingClientRect(), r = li.getBoundingClientRect();
    return { title: title.textContent, len: len ? len.textContent : null,
             right: len ? a.left >= t.right - 1 && r.right - a.right < 16 : null, line: len ? Math.abs(a.top - t.top) <= 6 : null };
  }));
  T("album", document.querySelector("#open .ov-title").textContent);
  T("asked", window.__asked);
`;

for (const [name, size, args] of [["iPad landscape", "1180x820", TOUCH], ["TV", "1920x1080", REMOTE]]) {
  test(`v1.9.71-t1 (${name}): the Shelf's album view shows each track's length, joined by title, then by place`, { skip: !harness.available }, async (t) => {
    const r = harness.renderPage({ name: "times-shelf-" + size, page: "shelf", windowSize: size, chromeArgs: args, budgetMs: 40000, stub: shelfStub(TIMES), driver: SHELF_DRIVER });
    harness.assertNoPageError(assert, r);
    await t.test("THE one: every row its length, at its right on its title's line — the remaster note's row by its place", () => {
      assert.deepEqual(r.rows.map((x) => [x.title, x.len]), [["Untitled", "0:59"], ["Archangel (2007 Remaster)", "3:58"], ["Near Dark", "3:56"], ["Ghost Hardware", "4:53"]]);
      for (const x of r.rows) assert.deepEqual([x.right, x.line], [true, true], JSON.stringify(x));
    });
    await t.test("asked once, for the album open, by its title", () => {
      assert.deepEqual(r.asked, [r.album]);
    });
  });
}

test("v1.9.71-t1: a count that disagrees borrows nothing: the row whose title differs has no length", { skip: !harness.available }, async (t) => {
  // your server's list one short: the titles still join, the place does not
  const r = harness.renderPage({ name: "times-shelf-short", page: "shelf", windowSize: "1180x820", chromeArgs: TOUCH, budgetMs: 40000, stub: shelfStub(TIMES.slice(0, 3)), driver: SHELF_DRIVER });
  harness.assertNoPageError(assert, r);
  await t.test("by title only", () => {
    assert.deepEqual(r.rows.map((x) => x.len), ["0:59", null, "3:56", null]);
  });
});

// ---- the remote's album view: the same join -------------------------------------------------------------------
const ALBUM = { offset: 0, title: "Untrue", subtitle: "Burial", image_key: "k" };
const albumStub = `
window.__installFetch(function (url) {
  if (url.indexOf("/api/album/track-times") > -1) return window.__json({ tracks: ${JSON.stringify(TIMES)}, status: "ok" });
  if (url.indexOf("/api/user-playlists") > -1) return window.__json({ playlists: [] });
  if (url.indexOf("/api/album/extras") > -1)  return window.__json({});
  if (url.indexOf("/api/album/credits") > -1) return window.__json({ credits: [], status: "ok" });
  if (url.indexOf("/api/album/more") > -1)    return window.__json({ artist: "Burial", by: [], appears: [] });
  if (url.indexOf("/api/lastfm/") > -1)       return window.__json({ enabled: false });
  if (url.indexOf("/api/album") > -1)
    return window.__json(${JSON.stringify({ title: "Untrue", subtitle: "Burial", image_key: "k", actions: [{ kind: "play_now", title: "Play Now" }], tracks: ROWS.map((title) => ({ title, subtitle: "Burial" })) })});
  if (url.indexOf("/api/zones") > -1)      return window.__json({ zones: [] });
  if (url.indexOf("/api/filters") > -1)    return window.__json({ genres: [] });
  if (url.indexOf("/api/home/") > -1)      return window.__json({ albums: [], label: null });
  if (url.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  if (url.indexOf("/api/settings") > -1)   return window.__json({});
  if (url.indexOf("/api/random-albums") > -1) return window.__json({ albums: [${JSON.stringify(ALBUM)}], total: 1, filtered: false });
  return undefined;
});`;

test("v1.9.71-t1 (iPad landscape): the remote's album view joins them the same way", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "times-album-ipad", windowSize: "1180x820", chromeArgs: TOUCH, budgetMs: 20000, stub: albumStub, driver: `
    await window.__sleep(700);
    window.__openAlbum(${JSON.stringify(ALBUM)}, { source: "search" });
    await window.__sleep(1500);
    T("lens", Array.prototype.map.call(document.querySelectorAll("#modal-tracks li.t-row"), function (li) { var l = li.querySelector(".t-len"); return l ? l.textContent : null; }));
  ` });
  harness.assertNoPageError(assert, r);
  await t.test("the remaster note's row by its place", () => {
    assert.deepEqual(r.lens, ["0:59", "3:58", "3:56", "4:53"]);
  });
});

test("v1.9.71-t1 (the review): \"pending\" is asked again while the album is shown, not after it is closed", { skip: !harness.available }, async (t) => {
  const pending = albumStub.replace(`return window.__json({ tracks: ${JSON.stringify(TIMES)}, status: "ok" });`,
    `{ window.__asks = (window.__asks || 0) + 1; return window.__json({ tracks: [], status: "pending", why: "connecting" }); }`);
  assert.notEqual(pending, albumStub, "the stub's answer was replaced");
  const run = (close) => harness.renderPage({ name: "times-pending-" + close, windowSize: "1180x820", chromeArgs: TOUCH, budgetMs: 30000, stub: pending, driver: `
    await window.__sleep(700);
    window.__openAlbum(${JSON.stringify(ALBUM)}, { source: "search" });
    await window.__sleep(1500);
    ${close ? 'document.getElementById("modal-close-btn").click();' : ""}
    await window.__sleep(9500);
    T("asks", window.__asks || 0);
  ` });
  const open = run(false), closed = run(true);
  harness.assertNoPageError(assert, open);
  harness.assertNoPageError(assert, closed);
  await t.test("shown: asked three times; closed: once", () => {
    assert.equal(open.asks, 3);
    assert.equal(closed.asks, 1);
  });
});

// ---- a TIDAL or Qobuz album's page (streaming.js) ---------------------------------------------------------------
const STREAM_PAGE = { title: "Untrue", count: 4, offset: 0, items: [], page: {
  kind: "album", menu: "Play Album", library_offset: 7, library_title: "Untrue", library_subtitle: "Burial", shown: 5,
  self: { title: "Untrue", subtitle: "Burial", hint: "list", image_key: "k1", pos: 0 },
  actions: [{ kind: "play_now", title: "Play Now" }], tracks: ROWS.map((title, i) => ({ title, subtitle: "Burial", pos: i + 1 })) } };
const STREAM_LEVELS = {
  "[]": { title: "TIDAL", count: 1, offset: 0, page: null, items: [{ title: "Albums", subtitle: null, hint: "list", image_key: null, pos: 0 }] },
  '[["Albums",0]]': { title: "Albums", count: 1, offset: 0, page: null, items: [{ title: "Untrue", subtitle: "Burial", hint: "list", image_key: "k1", pos: 0 }] },
  '[["Albums",0],["Untrue",0]]': STREAM_PAGE,
};
const streamStub = `
window.__timesAsked = [];
window.__installFetch(function (url) {
  if (url.indexOf("/api/album/track-times") > -1) { window.__timesAsked.push(new URL(url, location.href).searchParams.get("title")); return window.__json({ tracks: ${JSON.stringify(TIMES)}, status: "ok" }); }
  if (url.indexOf("/api/streaming/level") > -1) {
    var lv = ${JSON.stringify(STREAM_LEVELS)}[new URL(url, location.href).searchParams.get("path")];
    return lv ? window.__json(lv) : window.__json({ error: "gone" }, 404);
  }
  if (url.indexOf("/api/settings/tidal") > -1) return window.__json({ connected: true });
  if (url.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (url.indexOf("/api/random-albums") > -1) return window.__json({ albums: [], total: 0, filtered: false });
  if (url.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});`;

for (const [name, size, args] of [["iPad landscape", "1180x820", TOUCH], ["phone", "390x844", TOUCH]]) {
  test(`v1.9.71 (${name}): a TIDAL album's page shows each track's length, joined as the album views join them`, { skip: !harness.available }, async (t) => {
    const r = harness.renderPage({ name: "times-stream-" + size, windowSize: size, chromeArgs: args, budgetMs: 20000, stub: streamStub, driver: `
      await window.__sleep(700);
      var view = function () { return document.querySelector(".streaming-view"); };
      document.getElementById("menu-toggle").click(); await window.__sleep(200);
      document.getElementById("menu-item-tidal").click(); await window.__sleep(400);
      view().querySelector(".track-row").click(); await window.__sleep(400);
      view().querySelector(".album").click(); await window.__sleep(800);
      T("rows", Array.prototype.map.call(view().querySelectorAll(".playlist-tracks .track-row"), function (li) {
        var len = li.querySelector(".t-len"), title = li.querySelector(".track-title");
        var a = len && len.getBoundingClientRect(), b = title.getBoundingClientRect();
        return { title: title.textContent, len: len ? len.textContent : null, right: len ? a.left >= b.right - 1 : null, line: len ? Math.abs(a.top - b.top) <= 6 : null };
      }));
      T("asked", window.__timesAsked);
    ` });
    harness.assertNoPageError(assert, r);
    await t.test("every row its length, at its right on its title's line, asked by Roon's own strings for it", () => {
      assert.deepEqual(r.rows.map((x) => x.len), ["0:59", "3:58", "3:56", "4:53"]);
      for (const x of r.rows) assert.deepEqual([x.right, x.line], [true, true], JSON.stringify(x));
      assert.deepEqual(r.asked, ["Untrue"]);
    });
  });
}
