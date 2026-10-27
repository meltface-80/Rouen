"use strict";
// ---------------------------------------------------------------------------
// v1.9.70-t5 (dev/design/shelf-focus.md, the owner: "Additional focus filters for the shelf — Format, Favourites,
// Genres allow A to Z / Z to A and by #N; genres must come from Roon"): the Format tab's three groups (file formats,
// quality, exact resolutions), the Favourites tab, the genres' sort, and what the tabs say with native mode off. The
// list is made by the REAL lib/shelf.js, given the server facts lib/shelf-routes.js sends.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");
const { buildShelf, shelfSignature } = require("../../lib/shelf");
const { KINDS } = require("../../lib/release-facts");

// [artist, title, genres, favourite, fx: [file, rate, bits, channels, mqa, lossy, streaming, mixed]]
const RECORDS = [
  ["Black Sabbath", "Paranoid", ["Heavy Metal", "Rock"], true, [1, 96000, 24, 2, null, null, 0, 0]],
  ["Iron Maiden", "The Number of the Beast", ["Heavy Metal", "Rock"], true, [1, 44100, 16, 2, null, null, 0, 0]],
  ["Joni Mitchell", "Blue", ["Folk"], false, [3, 44100, 16, 2, null, null, 0, 0]],
  ["Miles Davis", "Kind of Blue", ["Jazz"], false, [13, 2822400, 1, 2, null, null, 0, 0]],
  ["Pink Floyd", "Wish You Were Here", ["Rock", "Art Rock"], false, [1, 192000, 24, 6, null, null, 0, 0]],
  ["Radiohead", "Kid A", ["Rock", "Electronic"], true, [15, 44100, 16, 2, 352800, null, 1, 0]],
  ["Sade", "Diamond Life", ["Soul"], false, [4, 44100, 16, 2, null, 320000, 0, 0]],
  ["Unknown", "Demo", ["Rock"], false, null],
];
const canon = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/^the /, "");
const build = (native) => {
  const shelf = buildShelf(RECORDS.map(([artist, title, g, fav, fx], i) => ({ offset: i, title, subtitle: artist, image_key: "k" + i, g, f: canon(artist), fav, fx })),
    { genresOf: (al) => al.g, firstOf: (al) => al.f, factsOf: (al) => (native ? al.fx : null), favOf: (al) => (native ? al.fav : null) });
  return Object.assign({ total: shelf.albums.length, rev: "1.0", sig: shelfSignature(shelf), kinds: KINDS,
    facts: { native, albums: RECORDS.length, withFormat: native ? 7 : 0, withGenres: native ? 8 : 0, favourites: native ? 3 : 0 } }, shelf);
};
const ANSWER = build(true);
const ZONE = { zone_id: "z1", display_name: "Living Room", state: "playing" };

const STUB = `
window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(performance.now()); }, 16); };
window.cancelAnimationFrame = function (id) { clearTimeout(id); };
navigation.addEventListener("navigate", function (e) { if (e.cancelable) e.preventDefault(); });
window.__answer = ${JSON.stringify(ANSWER)};
try { localStorage.clear(); localStorage.setItem("rra-zone", "z1"); localStorage.setItem("rra-shelf-look", "spines"); } catch (e) { /* always there here */ }
window.__installFetch(function (u) {
  if (u.indexOf("/api/shelf/albums") > -1) return window.__json(window.__answer);
  if (u.indexOf("/api/live") > -1) return window.__json({ rev: { library: "1.0", settings: "1" } });
  if (u.indexOf("/api/settings/display") > -1) return window.__json({ enabled: false, seconds: 10 });
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (u.indexOf("/api/album") > -1) return window.__json({ tracks: [{ title: "Untitled" }, { title: "Archangel" }, { title: "Near Dark" }] });
  if (u.indexOf("/api/update/status") > -1) return window.__json({ current: "1.9.67-t1" });
  return undefined;
});
`;
const HELPERS = `
  var __st = document.createElement("style");
  __st.textContent = "*, *::before { transition: none !important; }";
  document.head.appendChild(__st);
  var S = function () { return window.__shelfState(); };
  for (var i = 0; i < 80 && !(S() && S().N); i++) await window.__sleep(100);
  await window.__sleep(400);
  var stage = document.getElementById("stage");
  function tile(cat, id) { return document.querySelector('.tile[data-cat="' + cat + '"][data-id="' + id + '"]'); }
  function tabTo(t) { document.querySelector('.tab[data-tab="' + t + '"]').click(); }
  function texts(sel) { return Array.prototype.map.call(document.querySelectorAll(sel), function (e) { return e.textContent; }); }
  function tiles(cat) { return Array.prototype.map.call(document.querySelectorAll('.tile[data-cat="' + cat + '"]'), function (t) { return t.querySelector(".t-name, .ch").textContent + ":" + (t.querySelector(".t-count") || {}).textContent; }); }
  async function idle() { for (var i = 0; i < 200 && S().mode !== "idle"; i++) await window.__sleep(50); return S(); }
  var help = document.getElementById("help"); if (help) help.classList.add("hidden");
  var pid = 20;
  function pe(type, x, y, id) { stage.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: "touch", isPrimary: true })); }
  function tap(x, y) { var id = ++pid; pe("pointerdown", x, y, id); pe("pointerup", x, y, id); }
  function mid(el) { var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  function heads() { return texts(".f-head"); }
  function front() { return document.querySelector('.it[data-v="' + Math.round(S().p) + '"]'); }
`;

test("Shelf v1.9.70-t5: Format's three groups, Favourites, the genres' sort", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "shelf-v1970-t5", page: "shelf", windowSize: "1440x900", budgetMs: 30000, stub: STUB, driver: HELPERS + `
    T("tabs", texts(".tab").map(function (s) { return s.trim(); }));
    tabTo("format");
    T("format", { heads: heads(), tiles: tiles("format") });
    tile("format", "q:hires").click(); await idle();
    T("hires", { N: S().N, chips: texts("#chips .chip > span"), badge: document.querySelector('.tab[data-tab="format"] .badge').textContent });
    tile("format", "q:hires").click(); await idle();
    tabTo("fav");
    T("favTiles", tiles("fav"));
    tile("fav", "fav").click(); await idle();
    T("fav", { N: S().N, chips: texts("#chips .chip > span") });
    tile("fav", "fav").click(); await idle();
    tabTo("genre");
    T("byCount", tiles("genre"));
    document.querySelector('.g-sort[data-sort="az"]').click(); await window.__sleep(100);
    T("az", { tiles: tiles("genre"), kept: localStorage.getItem("shelf-genre-sort") });
    document.querySelector('.g-sort[data-sort="za"]').click(); await window.__sleep(100);
    T("za", tiles("genre"));
    tile("genre", "0").click(); await idle();
    T("chosen", { N: S().N, chips: texts("#chips .chip > span") });
  ` });
  harness.assertNoPageError(assert, r);
  await t.test("eight tabs: Format and Favourites before Order", () => {
    assert.deepEqual(r.tabs, ["Genres", "Artists", "Years", "Labels", "Types", "Format", "Favourites", "Order"]);
  });
  await t.test("THE one: Format's three groups, each tile with how many albums it holds", () => {
    assert.deepEqual(r.format.heads, ["Formats", "Quality", "Resolution", "Not known"]);
    assert.deepEqual(r.format.tiles, ["ALAC:1", "DSD (DSF):1", "FLAC:3", "MP3:1", "Qobuz:1",
      "Hi-Res:2", "CD quality:3", "Lossy:1", "MQA:1", "DSD:1", "Multichannel:1", "Streaming:1",
      "44.1 kHz / 16-bit:4", "96 kHz / 24-bit:1", "192 kHz / 24-bit:1", "DSD64:1", "Unknown:1"]);
  });
  await t.test("a quality narrows the shelf, named on its chip and counted on the tab", () => {
    assert.deepEqual(r.hires, { N: 2, chips: ["Hi-Res"], badge: "1" });
  });
  await t.test("Favourites: your hearts in Roon", () => {
    assert.deepEqual(r.favTiles, ["Favourites:3"]);
    assert.deepEqual(r.fav, { N: 3, chips: ["Favourites"] });
  });
  await t.test("genres by how many, A to Z, Z to A — kept for next time; a choice stays the same genre whatever the order", () => {
    assert.deepEqual(r.byCount.slice(0, 2), ["Rock:5", "Heavy Metal:2"]);
    assert.deepEqual(r.az.tiles.map((x) => x.split(":")[0]), ["Art Rock", "Electronic", "Folk", "Heavy Metal", "Jazz", "Rock", "Soul"]);
    assert.equal(r.az.kept, "az");
    assert.deepEqual(r.za.map((x) => x.split(":")[0]), ["Soul", "Rock", "Jazz", "Heavy Metal", "Folk", "Electronic", "Art Rock"]);
    assert.deepEqual(r.chosen, { N: 5, chips: ["Rock"] });
  });
});

test("Shelf v1.9.70-t5: native mode off — Format and Favourites say where they come from", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "shelf-v1970-t5-off", page: "shelf", windowSize: "1440x900", budgetMs: 30000, stub: STUB + "\nwindow.__answer = " + JSON.stringify(build(false)) + ";", driver: HELPERS + `
    tabTo("format"); T("format", texts(".tiles-msg"));
    tabTo("fav"); T("fav", texts(".tiles-msg"));
  ` });
  harness.assertNoPageError(assert, r);
  await t.test("each says native mode reads it", () => {
    assert.match(r.format[0], /Formats come from Roon itself, read by native mode/);
    assert.match(r.fav[0], /Favourites are your hearts in Roon itself/);
  });
});

// The review: eight tabs in one row of a desktop's side pane (33vw, up to 660px) left "Favourites" and its badge
// wider than its tab. Each size: the Favourites tab chosen from (its badge showing), every tab's label inside it.
for (const size of ["1920x1080", "1680x1050", "1440x900", "1024x768"]) {
  test(`Shelf v1.9.70-t5: at ${size} every tab's label and badge fit inside it`, { skip: !harness.available }, async (t) => {
    const r = harness.renderPage({ name: "shelf-v1970-t5-tabs-" + size, page: "shelf", windowSize: size, budgetMs: 30000, stub: STUB, driver: HELPERS + `
      tabTo("fav"); tile("fav", "fav").click(); await idle();
      T("tabs", Array.prototype.map.call(document.querySelectorAll(".tab"), function (b) {
        var r = b.getBoundingClientRect(), over = 0;
        Array.prototype.forEach.call(b.children, function (c) { var q = c.getBoundingClientRect(); if (q.width) over = Math.max(over, r.left - q.left, q.right - r.right); });
        return { tab: b.textContent.trim(), over: Math.round(over), cut: b.scrollWidth > b.clientWidth + 1 };
      }));
    ` });
    harness.assertNoPageError(assert, r);
    await t.test("no label or badge runs past its tab", () => {
      for (const x of r.tabs) assert.ok(x.over <= 0 && !x.cut, JSON.stringify(x));
      assert.ok(r.tabs.some((x) => /^Favourites\s*1$/.test(x.tab)), "the Favourites badge shows");
    });
  });
}
