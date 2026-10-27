"use strict";
// ---------------------------------------------------------------------------
// v1.9.70-t5 (dev/design/shelf-focus.md, the owner: "Additional focus filters for the shelf — Format, Favourites,
// Genres allow A to Z / Z to A and by #N; genres must come from Roon"): the Formats tab (Mandarin's tiles since
// v1.9.70-t7, the owner: "This is how I want Rouen format focus on the shelf to be like"), the Favourites tab, the
// genres' sort, and what the tabs say with native mode off. The list is made by the REAL lib/shelf.js, given the
// server facts lib/shelf-routes.js sends.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");
const { buildShelf, shelfSignature } = require("../../lib/shelf");
const { KINDS } = require("../../lib/release-facts");

// [artist, title, genres, favourite, fx: [file, rate, bits, channels, mqa, lossy, streaming, mixed]]
const RECORDS = [
  ["Black Sabbath", "Paranoid", ["Heavy Metal", "Rock"], true, [1, 96000, 24, 2, null, null, 0, 0]],
  // As the owner's server sends it (the reads probe, v1.9.70-t4): FLAC 44/16, its LossyBitRate 959 its average bit rate.
  ["Iron Maiden", "The Number of the Beast", ["Heavy Metal", "Rock"], true, [1, 44100, 16, 2, null, 959, 0, 0]],
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
    { genresOf: (al) => al.g, firstOf: (al) => al.f, factsOf: (al) => (native ? al.fx : null), favOf: (al) => (native ? al.fav : null),
      yearOf: (al) => [1970, 1982, 1971, 1959, 1975, 2000, 1984, null][al.offset],
      typeOf: (al) => [["album"], ["album"], ["album"], ["album"], ["album"], ["album"], ["album", "live"], ["ep"]][al.offset] });
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

test("Shelf v1.9.70-t7: Mandarin's Formats tiles, Favourites, the genres' sort", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "shelf-v1970-t5", page: "shelf", windowSize: "1440x900", budgetMs: 30000, stub: STUB, driver: HELPERS + `
    T("tabs", texts(".tab").map(function (s) { return s.trim(); }));
    tabTo("format");
    T("format", { heads: heads(), tiles: tiles("format") });
    tile("format", "16/44.1").click(); tile("format", "DSD64 2CH").click(); await idle();
    T("cd", { N: S().N, chips: texts("#chips .chip > span"), badge: document.querySelector('.tab[data-tab="format"] .badge').textContent });
    tile("format", "16/44.1").click(); tile("format", "DSD64 2CH").click(); await idle();
    tabTo("fav");
    T("favTiles", tiles("fav"));
    T("favFan", document.querySelectorAll('.tile[data-cat="fav"] .fan img').length);
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
  await t.test("eight tabs: Formats and Favourites before Order", () => {
    assert.deepEqual(r.tabs, ["Genres", "Artists", "Years", "Labels", "Types", "Formats", "Favourites", "Order"]);
  });
  await t.test("THE one: Mandarin's tiles, one an album, in Mandarin's order, each with how many albums it holds", () => {
    // No group headings; FLAC, ALAC and a Qobuz stream at 16/44.1 under one tile; PCM by bits then rate, then DSD,
    // then the rest by name; the album nothing is known of under none.
    assert.deepEqual(r.format.heads, []);
    assert.deepEqual(r.format.tiles, ["16/44.1:3", "24/96:1", "24/192 Multichannel:1", "DSD64 2CH:1", "MP3:1"]);
  });
  await t.test("tiles chosen narrow the shelf, named on their chips and counted on the tab", () => {
    assert.deepEqual(r.cd, { N: 4, chips: ["16/44.1", "DSD64 2CH"], badge: "2" });
  });
  await t.test("Favourites: your hearts in Roon, a fan of their covers", () => {
    assert.deepEqual(r.favTiles, ["Favourites:3"]);
    assert.equal(r.favFan, 3);
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
// wider than its tab. Since v1.9.70-t7 (the owner: "do Mandarin's two lines, evenly spaced focus selector panel"):
// two rows of four, every tab one width, the badge in its corner. Each size: the Favourites tab chosen from (its badge showing), every tab's
// label inside it, and the rows measured.
// The review: a short screen (a phone on its side, a small one, a short desktop window) keeps the two rows too, one row
// of eight having cut "Favourites" short there; and the badge clear of its label, which it sat on at every size.
for (const size of ["1920x1080", "1680x1050", "1440x900", "1024x768", "390x844", "844x390", "568x320", "1024x500", "320x568"]) {
  test(`Shelf v1.9.70-t7: at ${size} the tabs in even rows, every label and badge inside its tab`, { skip: !harness.available }, async (t) => {
    const r = harness.renderPage({ name: "shelf-v1970-t5-tabs-" + size, page: "shelf", windowSize: size, budgetMs: 30000, stub: STUB, driver: HELPERS + `
      var screenEl = document.getElementById("screen");
      if (screenEl.classList.contains("pick-off")) { document.getElementById("pick-tab").click(); await window.__sleep(300); }
      tabTo("fav"); tile("fav", "fav").click(); await idle();
      T("tabs", Array.prototype.map.call(document.querySelectorAll(".tab"), function (b) {
        var r = b.getBoundingClientRect(), over = 0;
        Array.prototype.forEach.call(b.children, function (c) { var q = c.getBoundingClientRect(); if (q.width) over = Math.max(over, r.left - q.left, q.right - r.right, r.top - q.top, q.bottom - r.bottom); });
        // the label's own box (its text alone), and the badge's: none of one inside the other
        var rg = document.createRange(), txt = Array.prototype.find.call(b.childNodes, function (n) { return n.nodeType === 3 && n.textContent.trim(); });
        rg.selectNodeContents(txt); var l = rg.getBoundingClientRect(), g = b.querySelector(".badge").getBoundingClientRect();
        var hit = !!g.width && g.left < l.right && g.right > l.left && g.top < l.bottom && g.bottom > l.top;
        return { tab: b.textContent.trim(), over: Math.round(over), cut: b.scrollWidth > b.clientWidth + 1 || l.width > r.width, hit: hit,
          x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) };
      }));
      var bar = document.querySelector(".tabs").getBoundingClientRect();
      T("bar", { left: Math.round(bar.left), right: Math.round(bar.right) });
    ` });
    harness.assertNoPageError(assert, r);
    await t.test("no label or badge runs past its tab, nor the badge over the label", () => {
      for (const x of r.tabs) assert.ok(x.over <= 0 && !x.cut && !x.hit, JSON.stringify(x));
      assert.ok(r.tabs.some((x) => /^Favourites\s*1$/.test(x.tab)), "the Favourites badge shows");
    });
    await t.test("THE one: Mandarin's rows, every tab one width, the rows across the whole bar", () => {
      const perRow = 4;
      const rows = [...new Set(r.tabs.map((x) => x.y))];
      assert.equal(rows.length, 8 / perRow, JSON.stringify(r.tabs));
      for (const y of rows) assert.equal(r.tabs.filter((x) => x.y === y).length, perRow, "row at " + y);
      const w = r.tabs[0].w;
      for (const x of r.tabs) assert.ok(Math.abs(x.w - w) <= 1, `${x.tab}: ${x.w}, not ${w}`);
      // the first and last of a row each as near the bar's edge: the row centred, its gaps even
      const row = r.tabs.slice(0, perRow);
      assert.ok(Math.abs((row[0].x - r.bar.left) - (r.bar.right - (row[perRow - 1].x + row[perRow - 1].w))) <= 1, JSON.stringify(r.bar));
    });
  });
}

// The owner (v1.9.70-t5): "make format, type and year all the same size buttons and centre the title on each" —
// Genres and Labels, with their covers, as they are; and (v1.9.70-t7) "All tiles on the shelfs focus/filter must have
// their titles in the centre. Except genre, labels and favourites as they should have small album art covers on
// them". Each size: every tile of the three tabs measured, one size; each title's middle the tile's middle, its lines
// centred; and the Order tiles' titles and notes centred in theirs.
for (const size of ["390x844", "844x390", "1440x900", "1920x1080"]) {
  test(`Shelf v1.9.70-t7: at ${size} Years, Types and Formats tiles are one size, every title but the covered ones centred`, { skip: !harness.available }, async (t) => {
    const r = harness.renderPage({ name: "shelf-v1970-t5-size-" + size, page: "shelf", windowSize: size, budgetMs: 30000, stub: STUB, driver: HELPERS + `
      var screenEl = document.getElementById("screen");
      if (screenEl.classList.contains("pick-off")) { document.getElementById("pick-tab").click(); await window.__sleep(300); }
      var out = [];
      for (var tb of ["year", "type", "format"]) {
        tabTo(tb); await window.__sleep(150);
        Array.prototype.forEach.call(document.querySelectorAll('.tile[data-cat="' + tb + '"]'), function (b) {
          var r = b.getBoundingClientRect(), c = b.querySelector(".ch").getBoundingClientRect();
          out.push({ tab: tb, id: b.dataset.id, w: Math.round(r.width), h: Math.round(r.height),
            dx: Math.round((c.left + c.width / 2) - (r.left + r.width / 2)), dy: Math.round((c.top + c.height / 2) - (r.top + r.height / 2)),
            align: getComputedStyle(b.querySelector(".ch")).textAlign, inside: c.left >= r.left && c.right <= r.right && c.top >= r.top && c.bottom <= r.bottom });
        });
      }
      T("tiles", out);
      tabTo("order"); await window.__sleep(150);
      T("order", Array.prototype.map.call(document.querySelectorAll('.tile[data-cat="order"]'), function (b) {
        var r = b.getBoundingClientRect(), mx = r.left + r.width / 2;
        return { id: b.dataset.id, parts: Array.prototype.map.call(b.querySelectorAll(".t-name, .t-note"), function (e) {
          var c = e.getBoundingClientRect(); return { dx: Math.round(c.left + c.width / 2 - mx), align: getComputedStyle(e).textAlign };
        }) };
      }));
    ` });
    harness.assertNoPageError(assert, r);
    await t.test("THE one: one size across the three tabs", () => {
      const tabs = new Set(r.tiles.map((x) => x.tab));
      assert.deepEqual([...tabs], ["year", "type", "format"], "every tab drew tiles");
      const [w, h] = [r.tiles[0].w, r.tiles[0].h];
      for (const x of r.tiles) assert.ok(Math.abs(x.w - w) <= 1 && Math.abs(x.h - h) <= 1, `${x.tab} ${x.id}: ${x.w}x${x.h}, not ${w}x${h}`);
    });
    await t.test("each title in the middle of its tile, its lines centred, none spilling out", () => {
      for (const x of r.tiles) assert.ok(Math.abs(x.dx) <= 1 && Math.abs(x.dy) <= 1 && x.align === "center" && x.inside, JSON.stringify(x));
    });
    await t.test("the Order tiles: each title and its note in the middle", () => {
      assert.ok(r.order.length >= 4, JSON.stringify(r.order));
      for (const o of r.order) for (const p of o.parts) assert.ok(Math.abs(p.dx) <= 1 && p.align === "center", JSON.stringify(o));
    });
  });
}
