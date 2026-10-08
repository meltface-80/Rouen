"use strict";
// ---------------------------------------------------------------------------
// v1.9.1: Shelf — flicking through the library like a record shop's racks.
//
// Asked for: "On the left will be a multi selection centre of genres, artists
// … and random. On the right will be what resembles a shelf of album covers.
// Flicking left to right, right to left (revolving). A short swipe flicks
// through one at a time, a long swipe allows it to revolve round in the
// direction you're swiping until you stop. A fast single swipe spins it like
// mad and lands wherever after 3 seconds … Genres will be multi select. Tap
// one, two or three etc (not a long press) … show a brass outline … if more
// than one selected show a clear all x above them … Artists, just show a grid
// a to z, # & 1 to 9 … With nothing selected the shelf will basically be the
// whole library." Then: all three looks as options, no moods, Random as the
// Random albums screen does it, and "< Remote" top left, "Wall Display >" top
// right.
//
//   1. The whole library with nothing chosen; tap-to-choose with a brass
//      outline; genres widen, letters narrow, the counts follow; Clear all ×
//      over two or more; Reset shelf when choices span both; chips.
//   2. Random: the same albums, in another order.
//   3. Nothing matches: says what clashes, and Undo puts it back.
//   4. The shelf moves: a short swipe is one album, a hard flick spins and
//      lands on an album after three seconds, a tap turns the case over and
//      reads its track list.
//   5. Play now sends the album's identity and the zone.
//   6. The corners: Remote top left, Wall Display top right only while the
//      wall display is on, each going where it says; neither covers the page.
//   7. The looks are kept per device; the remote's theme is followed; a
//      library still building says so.
// The list is made by the REAL lib/shelf.js, so its shape is the server's.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");
const { buildShelf, shelfSignature } = require("../../lib/shelf");

const RECORDS = [
  ["!!!", "Myth Takes", ["Electronic"]], ["2Pac", "All Eyez on Me", ["Rap, Hip-Hop"]],
  ["Abba", "Arrival", ["Pop/Rock"]], ["Air", "Moon Safari", ["Electronic"]],
  ["The Beatles", "Abbey Road", ["Pop/Rock"]], ["The Beatles", "Revolver", ["Pop/Rock"]],
  ["Bill Evans", "Waltz for Debby", ["Jazz"]], ["Bob Dylan", "Blood on the Tracks", ["Folk", "Pop/Rock"]],
  ["Burial", "Untrue", ["Electronic"]], ["Coltrane", "Blue Train", ["Jazz"]],
  ["Daft Punk", "Discovery", ["Electronic"]], ["David Bowie", "The Rise and Fall of Ziggy Stardust and the Spiders from Mars", ["Pop/Rock"]],
  ["Dolly Parton", "Jolene", ["Country"]],
  ["Ella Fitzgerald", "Ella and Louis", ["Jazz"]], ["Fleetwood Mac", "Rumours", ["Pop/Rock"]],
  ["Joni Mitchell", "Blue", ["Folk"]], ["Kraftwerk", "Trans-Europe Express", ["Electronic"]],
  ["Massive Attack", "Mezzanine", ["Electronic"]], ["Massive Attack", "Blue Lines", ["Electronic", "R&B"]],
  ["Miles Davis", "Kind of Blue", ["Jazz"]], ["Miles Davis", "In a Silent Way", ["Jazz"]],
  ["Nick Drake", "Pink Moon", ["Folk"]], ["Portishead", "Dummy", ["Electronic"]],
  ["Radiohead", "OK Computer", ["Pop/Rock"]], ["Radiohead", "Kid A", ["Pop/Rock", "Electronic"]],
  ["Sade", "Diamond Life", ["R&B"]], ["Talking Heads", "Remain in Light", ["Pop/Rock"]],
  ["Willie Nelson", "Red Headed Stranger", ["Country"]], ["ZZ Top", "Eliminator", ["Pop/Rock"]],
];
const canon = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/^the /, "");
const SHELF = buildShelf(
  RECORDS.map(([artist, title, g], i) => ({ offset: 100 + i, title, subtitle: artist, image_key: "k" + i, g, f: canon(artist) })),
  { genresOf: (al) => al.g, firstOf: (al) => al.f });
const GENRE = (name) => SHELF.genres.findIndex((g) => g.name === name);
const ANSWER = (shelf, rev) => Object.assign({ total: shelf.albums.length, rev, sig: shelfSignature(shelf) }, shelf);

const ZONES = [{ zone_id: "z1", display_name: "Living Room", state: "playing" }, { zone_id: "z2", display_name: "Kitchen", state: "stopped" }];
const NOW = { zone_id: "z1", display_name: "Living Room", state: "playing", now_playing: { line1: "Teardrop", line2: "Massive Attack", line3: "Mezzanine", image_key: "k16", length: 330, seek_position: 60 } };

// opts.wall: the wall display's switch. opts.shelf: what /api/shelf/albums answers
// (a 503 string = that error). opts.storage: localStorage to start with. The
// driver can change window.__answer and window.__liveRev to make the library
// move; the stub answers ?sig= the way the server does.
const stub = (opts) => `
// This harness's headless Chromium never runs an animation frame (virtual
// time drives timers only), and Shelf moves frame by frame. Frames are
// supplied from a timer, as fetch is supplied from the routes below.
window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(performance.now()); }, 16); };
window.cancelAnimationFrame = function (id) { clearTimeout(id); };
window.__went = [];
navigation.addEventListener("navigate", function (e) {
  window.__went.push({ url: e.destination.url, type: e.navigationType });
  if (e.cancelable) e.preventDefault();
});
window.__posts = [];
window.__answer = ${typeof opts.shelf === "string" ? JSON.stringify(opts.shelf) : JSON.stringify(ANSWER(opts.shelf || SHELF, "1.0"))};
window.__liveRev = "1.0";
try {
  localStorage.clear();
  var __st = ${JSON.stringify(opts.storage || { "rra-zone": "z1" })};
  for (var k in __st) localStorage.setItem(k, __st[k]);
} catch (e) { /* storage is always there in this harness */ }
window.__installFetch(function (u, o) {
  if (o && o.method === "POST") window.__posts.push({ url: u, body: JSON.parse(o.body) });
  if (u.indexOf("/api/shelf/albums") > -1) {
    if (typeof window.__answer === "string") return window.__json({ error: window.__answer }, 503);
    var sig = (u.split("sig=")[1] || "");
    if (sig && decodeURIComponent(sig) === window.__answer.sig) return window.__json({ same: true, rev: window.__liveRev, sig: sig });
    return window.__json(window.__answer);
  }
  if (u.indexOf("/api/live") > -1) return window.__json({ rev: { library: window.__liveRev, settings: "1" } });
  if (u.indexOf("/api/settings/display") > -1) return window.__json({ enabled: ${!!opts.wall}, seconds: 10 });
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: ${JSON.stringify(ZONES)} });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(NOW)} });
  if (u.indexOf("/api/album") > -1) return window.__json({ tracks: [{ title: "Angel" }, { title: "Risingson" }, { title: "Teardrop" }] });
  if (u.indexOf("/api/play") > -1) return window.__json({ ok: true });
  return undefined;
});
`;

const HELPERS = `
  // Transitions never finish in this harness: read every colour at rest.
  var __st = document.createElement("style");
  __st.textContent = "*, *::before { transition: none !important; }";
  document.head.appendChild(__st);
  var S = function () { return window.__shelfState(); };
  for (var i = 0; i < 80 && !(S() && S().N); i++) await window.__sleep(100);
  await window.__sleep(400);
  var stage = document.getElementById("stage");
  function tile(cat, id) { return document.querySelector('.tile[data-cat="' + cat + '"][data-id="' + id + '"]'); }
  function tabTo(t) { document.querySelector('.tab[data-tab="' + t + '"]').click(); }
  function shown(sel) { var el = document.querySelector(sel); return !!el && !el.classList.contains("hidden") && el.getClientRects().length > 0; }
  async function idle() { for (var i = 0; i < 200 && S().mode !== "idle"; i++) await window.__sleep(50); return S(); }
  async function swipe(step, gap, n) {
    var r = stage.getBoundingClientRect(), x0 = r.left + r.width / 2 + 160, y = r.top + r.height * 0.4;
    function ev(type, x) { stage.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x, clientY: y, bubbles: true, pointerType: "touch", isPrimary: true })); }
    ev("pointerdown", x0);
    for (var i = 1; i <= n; i++) { await window.__sleep(gap); ev("pointermove", x0 - i * step); }
    await window.__sleep(8);
    ev("pointerup", x0 - n * step);
  }
`;

test("Shelf: choosing what is on the shelf (v1.9.1)", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "shelf-choose", page: "shelf", windowSize: "1440x900", budgetMs: 30000,
    stub: stub({ wall: true }), driver: HELPERS + `
    T("whole", { N: S().N, sum: document.getElementById("pick-sum").textContent });
    T("genre_tiles", Array.prototype.map.call(document.querySelectorAll('.tile[data-cat="genre"]'), function (el) {
      return el.querySelector(".t-name").textContent + ":" + el.querySelector(".t-count").textContent; }));
    // two genres: wider, outlined, Clear all × over them
    tile("genre", ${GENRE("Jazz")}).click();
    tile("genre", ${GENRE("Folk")}).click();
    var j = tile("genre", ${GENRE("Jazz")});
    T("two_genres", { N: S().N, pressed: j.getAttribute("aria-pressed"), outline: getComputedStyle(j).borderColor,
      clear: shown("#sec-clear"), reset: shown("#reset-all"), badge: document.querySelector('.tab[data-tab="genre"] .badge').textContent });
    // a letter: narrower, and its counts are counted inside the chosen genres
    tabTo("artist");
    T("letters", Array.prototype.map.call(document.querySelectorAll('.tile[data-cat="artist"]'), function (el) { return el.dataset.id; }).join(""));
    T("letter_counts", { M: tile("artist", "M").querySelector(".t-count").textContent, Z: tile("artist", "Z").querySelector(".t-count").textContent,
                         Z_dim: tile("artist", "Z").classList.contains("zero") });
    tile("artist", "M").click();
    T("with_letter", { N: S().N, title: S().title, reset: shown("#reset-all"), clear: shown("#sec-clear"),
      chips: Array.prototype.map.call(document.querySelectorAll("#chips .chip > span"), function (c) { return c.textContent; }) });
    // Random, on the whole library: the same albums, in another order
    var narrowed = S().N;
    document.getElementById("reset-all").click();
    var before = window.__shelfOrder();
    tabTo("random");
    tile("random", "order").click();
    var after = window.__shelfOrder();
    T("random", { N: S().N, order: document.getElementById("shelf-order").textContent, pressed: tile("random", "order").getAttribute("aria-pressed"),
      reshuffle: !document.getElementById("reshuffle").disabled, narrowed: narrowed,
      sameSet: before.slice().sort().join("|") === after.slice().sort().join("|"), moved: before.join("|") !== after.join("|") });
    // Reset shelf clears everything
    document.getElementById("reset-all").click();
    T("reset", { N: S().N, chips: document.querySelectorAll("#chips .chip").length, order: document.getElementById("shelf-order").textContent });
    // nothing matches: say what clashes, Undo puts it back
    tabTo("genre"); tile("genre", ${GENRE("Country")}).click();
    tabTo("artist"); tile("artist", "Z").click();
    tabTo("random"); tile("random", "order").click();
    T("empty", { N: S().N, note: shown("#note"), why: document.getElementById("note-why").textContent, info: shown("#info") });
    document.getElementById("undo").click();
    T("undone", { N: S().N, note: shown("#note"), random: tile("random", "order").getAttribute("aria-pressed") });
    tile("random", "order").click();
    // Clear all × clears only its own section
    document.getElementById("reset-all") && document.getElementById("reset-all").click();
    tabTo("artist"); tile("artist", "B").click(); tile("artist", "M").click();
    document.getElementById("sec-clear").click();
    T("cleared", { N: S().N, letters: document.querySelectorAll('.tile[data-cat="artist"][aria-pressed="true"]').length });
  ` });
  harness.assertNoPageError(assert, r);
  const total = SHELF.albums.length;

  await t.test("1. nothing chosen is the whole library, and every genre is a tile with its count", () => {
    assert.equal(r.whole.N, total);
    assert.match(r.whole.sum, new RegExp("The whole library · " + total + " albums"));
    assert.deepEqual(r.genre_tiles, SHELF.genres.map((g) => g.name + ":" + g.count));
  });
  await t.test("1. genres widen, are outlined in brass, and two get Clear all ×", () => {
    const jazzFolk = SHELF.albums.filter((a) => a.g.includes(GENRE("Jazz")) || a.g.includes(GENRE("Folk"))).length;
    assert.equal(r.two_genres.N, jazzFolk);
    assert.equal(r.two_genres.pressed, "true");
    assert.equal(r.two_genres.outline, "rgb(201, 164, 92)", "not a brass outline");
    assert.equal(r.two_genres.clear, true);
    assert.equal(r.two_genres.reset, false, "Reset shelf with only one section chosen");
    assert.equal(r.two_genres.badge, "2");
  });
  await t.test("1. letters A–Z, # and 1–9; a letter narrows the chosen genres; counts follow", () => {
    assert.equal(r.letters, "ABCDEFGHIJKLMNOPQRSTUVWXYZ#123456789");
    assert.equal(r.letter_counts.M, "2", "M within Jazz or Folk: Miles Davis twice");
    assert.equal(r.letter_counts.Z, "0");
    assert.equal(r.letter_counts.Z_dim, true);
    assert.equal(r.with_letter.N, 2);
    assert.match(r.with_letter.title, /Kind of Blue|In a Silent Way/);
    assert.equal(r.with_letter.reset, true, "no Reset shelf across two sections");
    assert.equal(r.with_letter.clear, false, "Clear all × over a single letter");
    assert.deepEqual(r.with_letter.chips, ["Jazz", "Folk", "M"]);
  });
  await t.test("2. Random is the same shelf in another order", () => {
    assert.equal(r.random.narrowed, 2);
    assert.equal(r.random.N, total);
    assert.equal(r.random.sameSet, true, "Random changed which albums are on the shelf");
    assert.equal(r.random.moved, true, "Random left the order as it was");
    assert.equal(r.random.order, "Random order");
    assert.equal(r.random.pressed, "true");
    assert.equal(r.random.reshuffle, true);
    assert.equal(r.reset.N, total);
    assert.equal(r.reset.chips, 0);
    assert.equal(r.reset.order, "A → Z by artist");
  });
  await t.test("3. nothing matches: it says what clashes, and Undo puts it back", () => {
    assert.equal(r.empty.N, 0);
    assert.equal(r.empty.note, true);
    assert.equal(r.empty.info, false);
    assert.equal(r.empty.why, "No albums match Country and artists under Z.");
    assert.equal(r.undone.N, SHELF.albums.filter((a) => a.g.includes(GENRE("Country"))).length);
    assert.equal(r.undone.note, false);
    assert.equal(r.undone.random, "true", "Undo took back Random, which only reorders, and left the shelf empty");
  });
  await t.test("1. Clear all × clears its own section", () => {
    assert.equal(r.cleared.letters, 0);
    assert.equal(r.cleared.N, total);
  });
});

test("Shelf: the shelf moves, turns over and plays (v1.9.1)", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "shelf-move", page: "shelf", windowSize: "1440x900", budgetMs: 40000,
    stub: stub({ wall: true }), driver: HELPERS + `
    // it opens on the record that is playing
    T("opened", { title: S().title, zone: S().zone });
    var p0 = S().p;
    await swipe(14, 12, 6);
    var a = await idle();
    T("short", a.p - p0);
    await swipe(55, 12, 6);
    await window.__sleep(150);
    var during = S().mode;
    var t0 = performance.now();
    var b = await idle();
    T("flick", { during: during, moved: b.p - a.p, whole: Number.isInteger(b.p), ms: Math.round(performance.now() - t0) });
    // a tap on the front cover turns it over and reads the tracks
    var front = document.querySelector('.it[data-v="' + b.p + '"] .front').getBoundingClientRect();
    function tap(x, y) { stage.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 8, clientX: x, clientY: y, bubbles: true, pointerType: "touch", isPrimary: true }));
                         stage.dispatchEvent(new PointerEvent("pointerup", { pointerId: 8, clientX: x, clientY: y, bubbles: true, pointerType: "touch", isPrimary: true })); }
    tap(front.left + front.width / 2, front.top + front.height / 2);
    await window.__sleep(400);
    var f = document.querySelector(".it.flipped");
    T("turned", { flipped: !!f, tracks: f ? Array.prototype.map.call(f.querySelectorAll(".bk-tracks li span"), function (s) { return s.textContent; }) : [],
                  asked: window.__callsMatching("/api/album?") });
    // Play now: the album in front, by identity, in the zone
    var want = S().title;
    document.querySelector('[data-act="play_now"]').click();
    await window.__sleep(300);
    T("play", { post: window.__posts.filter(function (x) { return x.url.indexOf("/api/play") > -1; }).pop(), want: want,
                toast: document.getElementById("toast").textContent });
  ` });
  harness.assertNoPageError(assert, r);

  await t.test("it opens on the record that is playing, in that zone", () => {
    assert.equal(r.opened.title, "Mezzanine");
    assert.equal(r.opened.zone, "z1");
  });
  await t.test("4. a short swipe moves exactly one album", () => {
    assert.equal(r.short, 1);
  });
  await t.test("4. a hard flick spins and lands on an album after about three seconds", () => {
    assert.equal(r.flick.during, "spin");
    assert.ok(r.flick.moved >= 26, "it barely spun: " + r.flick.moved);
    assert.equal(r.flick.whole, true, "it stopped between two albums");
    assert.ok(r.flick.ms > 2300 && r.flick.ms < 3600, "it did not land at about three seconds: " + r.flick.ms + " ms");
  });
  await t.test("4. a tap on the front turns the case over and lists its tracks", () => {
    assert.equal(r.turned.flipped, true);
    assert.deepEqual(r.turned.tracks, ["Angel", "Risingson", "Teardrop"]);
    assert.equal(r.turned.asked, 1);
  });
  await t.test("5. Play now sends the album in front, by identity, to the zone", () => {
    const rec = SHELF.albums.find((a) => a.t === r.play.want);
    assert.deepEqual(r.play.post.body, { offset: rec.o, title: rec.t, subtitle: rec.a, zone_or_output_id: "z1", kind: "play_now",
                                         filter_type: "", filter_value: "", filter_parent: "" });
    assert.match(r.play.toast, new RegExp("^Playing " + rec.t + " in Living Room$"));
  });
});

const CORNERS = HELPERS + `
  function box(sel) { var b = document.querySelector(sel).getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width }; }
  function hits(a, b) { return a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b; }
  var rem = box("#to-remote"), wall = shown("#to-wall") ? box("#to-wall") : null;
  var covered = [];
  ["#pick .pick-title", "#looks", "#spin-btn", ".tab", "#shelf-pos"].forEach(function (sel) {
    var el = document.querySelector(sel); if (!el || !el.getClientRects().length) return;
    var b = box(sel);
    if (hits(rem, b)) covered.push("Remote over " + sel);
    if (wall && hits(wall, b)) covered.push("Wall Display over " + sel);
  });
  T("corners", { rem: rem, wall: wall, W: innerWidth, covered: covered,
                 remText: document.getElementById("to-remote").textContent.trim(),
                 wallText: wall ? document.getElementById("to-wall").textContent.trim() : null,
                 overflow: document.documentElement.scrollWidth - innerWidth });
  document.getElementById("to-remote").click();
  if (wall) document.getElementById("to-wall").click();
  await window.__sleep(100);
  T("went", window.__went);
`;

test("Shelf: Remote top left, Wall Display top right (v1.9.1)", { skip: !harness.available }, async (t) => {
  for (const size of ["1920x1080", "1180x820", "820x1180"]) {
    const r = harness.renderPage({ name: "shelf-corners-" + size, page: "shelf", windowSize: size, budgetMs: 20000,
      stub: stub({ wall: true }), driver: CORNERS });
    harness.assertNoPageError(assert, r);
    await t.test(size + ": both pills in their corners, covering nothing", () => {
      assert.equal(r.corners.remText, "Remote");
      assert.equal(r.corners.wallText, "Wall Display");
      assert.ok(r.corners.rem.l <= 30 && r.corners.rem.t <= 30, "Remote is not in the top-left corner: " + JSON.stringify(r.corners.rem));
      assert.ok(r.corners.W - r.corners.wall.r <= 30 && r.corners.wall.t <= 30, "Wall Display is not in the top-right corner: " + JSON.stringify(r.corners.wall));
      assert.deepEqual(r.corners.covered, []);
      assert.equal(r.corners.overflow, 0);
    });
    await t.test(size + ": each goes where it says — the remote loaded, the wall display in place of Shelf, with no zone it wasn't given", () => {
      assert.equal(r.went.length, 2);
      assert.match(r.went[0].url, /^file:\/\/\/$/);
      assert.match(r.went[1].url, /\/display$/, "a zone this Shelf was not given went along to the wall display");
      assert.equal(r.went[1].type, "replace", "the wall display was pushed: flipping would grow the history");
    });
  }
  const off = harness.renderPage({ name: "shelf-corners-off", page: "shelf", windowSize: "1440x900", budgetMs: 20000,
    stub: stub({ wall: false }), driver: HELPERS + `T("wall", shown("#to-wall")); T("remote", shown("#to-remote"));` });
  harness.assertNoPageError(assert, off);
  await t.test("with the wall display switched off, only Remote is offered", () => {
    assert.equal(off.wall, false);
    assert.equal(off.remote, true);
  });
});

test("Shelf: looks, theme, and a library still building (v1.9.1)", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "shelf-looks", page: "shelf", windowSize: "1440x900", budgetMs: 20000,
    stub: stub({ wall: true, storage: { "rra-zone": "z1", "rra-shelf-look": "spines", "rra-theme-v2": "brass-light" } }), driver: HELPERS + `
    T("start", { look: S().look, cls: stage.className, theme: document.documentElement.dataset.theme,
                 spines: document.querySelectorAll(".it .side.l .sp").length,
                 bg: getComputedStyle(document.body).backgroundColor });
    document.querySelector('#looks [data-look="ring"]').click();
    T("ring", { look: S().look, kept: localStorage.getItem("rra-shelf-look"), cls: stage.className,
                pressed: document.querySelector('#looks [data-look="ring"]').getAttribute("aria-pressed") });
  ` });
  harness.assertNoPageError(assert, r);
  await t.test("7. the look chosen on this device is kept, and spines are drawn", () => {
    assert.equal(r.start.look, "spines");
    assert.match(r.start.cls, /look-spines/);
    assert.ok(r.start.spines > 5, "no spines drawn");
    assert.equal(r.ring.look, "ring");
    assert.equal(r.ring.kept, "ring");
    assert.match(r.ring.cls, /look-ring/);
    assert.equal(r.ring.pressed, "true");
  });
  await t.test("7. Brass light on the remote is Brass light here", () => {
    assert.equal(r.start.theme, "light");
    assert.equal(r.start.bg, "rgb(247, 244, 237)");
  });

  const waiting = harness.renderPage({ name: "shelf-waiting", page: "shelf", windowSize: "1440x900", budgetMs: 15000,
    stub: stub({ wall: true, shelf: "Not paired with Roon Core yet" }), driver: `
    await window.__sleep(1500);
    var n = document.getElementById("note");
    T("note", { shown: !n.classList.contains("hidden"), title: document.getElementById("note-title").textContent,
                sum: document.getElementById("pick-sum").textContent, asked: window.__callsMatching("/api/shelf/albums") });
    await window.__sleep(5500);
    T("again", window.__callsMatching("/api/shelf/albums"));
  ` });
  harness.assertNoPageError(assert, waiting);
  await t.test("7. unpaired, it says so, and asks again", () => {
    assert.equal(waiting.note.shown, true);
    assert.equal(waiting.note.title, "Waiting for Roon");
    assert.equal(waiting.note.sum, "Waiting for Roon…");
    assert.ok(waiting.again > waiting.note.asked, "it never asked again");
  });
  const building = harness.renderPage({ name: "shelf-building", page: "shelf", windowSize: "1440x900", budgetMs: 40000,
    stub: stub({ wall: true, shelf: "Library index is still building" }), driver: `
    await window.__sleep(1500);
    T("title", document.getElementById("note-title").textContent);
    var n0 = window.__callsMatching("/api/shelf/albums");
    await window.__sleep(30000);
    T("asks", window.__callsMatching("/api/shelf/albums") - n0);
  ` });
  harness.assertNoPageError(assert, building);
  await t.test("7. a library still being read (or empty) says that, and asks less often as it waits", () => {
    assert.equal(building.title, "Reading your library");
    // 5 s, 10 s, 20 s… — a steady 5 s would be six asks in 30 s
    assert.ok(building.asks >= 1 && building.asks <= 3, "asked " + building.asks + " times in 30 s");
  });
});

// Found in review: the library revision moves for things the shelf doesn't
// show (a year, a badge — every few seconds during a label scan), and each
// re-read used to reset the shelf under the user's finger and re-map genre
// choices by POSITION in a list ordered by count.
test("Shelf keeps up with the library without losing its place (v1.9.1)", { skip: !harness.available }, async (t) => {
  // Folk overtakes Jazz: the genre list reorders.
  const more = RECORDS.concat([["Nick Drake", "Bryter Layter", ["Folk"]], ["Nick Drake", "Five Leaves Left", ["Folk"]],
    ["Joni Mitchell", "Court and Spark", ["Folk"]], ["Bob Dylan", "Blonde on Blonde", ["Folk"]]]);
  const SHELF2 = buildShelf(more.map(([artist, title, g], i) => ({ offset: 300 + i, title, subtitle: artist, image_key: "k" + i, g, f: canon(artist) })),
    { genresOf: (al) => al.g, firstOf: (al) => al.f });
  const r = harness.renderPage({ name: "shelf-keepup", page: "shelf", windowSize: "1440x900", budgetMs: 160000,
    stub: stub({ wall: true }), driver: HELPERS + `
    tile("genre", ${GENRE("Folk")}).click();
    T("before", { N: S().N, idx: ${GENRE("Folk")} });
    window.__answer = ${JSON.stringify(ANSWER(SHELF2, "2.0"))};
    window.__liveRev = "2.0";
    await window.__sleep(31000);
    var pressed = Array.prototype.map.call(document.querySelectorAll('.tile[data-cat="genre"][aria-pressed="true"]'), function (el) { return el.querySelector(".t-name").textContent; });
    T("after", { N: S().N, pressed: pressed, chips: Array.prototype.map.call(document.querySelectorAll("#chips .chip > span"), function (c) { return c.textContent; }) });
    // A revision that moved for nothing the shelf shows: a short answer, and the shelf left alone.
    var p0 = S().p, asks = window.__calls.filter(function (u) { return u.indexOf("sig=") > -1; }).length;
    window.__liveRev = "3.0";
    await window.__sleep(31000);
    T("same", { p: S().p === p0, sigAsks: window.__calls.filter(function (u) { return u.indexOf("sig=") > -1; }).length - asks });
    // With a case turned over, a real change waits until it is turned back.
    var front = document.querySelector('.it[data-v="' + Math.round(S().p) + '"] .front').getBoundingClientRect();
    stage.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 3, clientX: front.left + front.width / 2, clientY: front.top + 40, bubbles: true, pointerType: "touch", isPrimary: true }));
    stage.dispatchEvent(new PointerEvent("pointerup", { pointerId: 3, clientX: front.left + front.width / 2, clientY: front.top + 40, bubbles: true, pointerType: "touch", isPrimary: true }));
    await window.__sleep(300);
    window.__answer = ${JSON.stringify(ANSWER(SHELF, "4.0"))};
    window.__liveRev = "4.0";
    await window.__sleep(31000);
    T("held", { flipped: !!document.querySelector(".it.flipped"), N: S().N });
  ` });
  harness.assertNoPageError(assert, r);
  const folk = (sh) => sh.albums.filter((a) => a.g.includes(sh.genres.findIndex((g) => g.name === "Folk"))).length;
  await t.test("a genre chosen before a re-read is the same genre after it, though its place in the list moved", () => {
    assert.notEqual(SHELF2.genres.findIndex((g) => g.name === "Folk"), r.before.idx, "precondition: Folk moved in the list");
    assert.deepEqual(r.after.pressed, ["Folk"]);
    assert.deepEqual(r.after.chips, ["Folk"]);
    assert.equal(r.after.N, folk(SHELF2));
  });
  await t.test("a revision that moved for nothing on the shelf is answered short, and nothing moves", () => {
    assert.equal(r.same.sigAsks, 1);
    assert.equal(r.same.p, true);
  });
  await t.test("a change that arrives with a case turned over waits for it", () => {
    assert.equal(r.held.flipped, true);
    assert.equal(r.held.N, folk(SHELF2), "the shelf was redrawn under a turned-over case");
  });
});

test("Shelf: small shelves, taps mid-motion, and a steady stage (v1.9.1)", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "shelf-robust", page: "shelf", windowSize: "1440x900", budgetMs: 40000,
    stub: stub({ wall: true }), driver: HELPERS + `
    // one album (ZZ Top): a hard flick must not wedge the shelf
    tabTo("artist"); tile("artist", "Z").click();
    await swipe(55, 12, 6);
    var one = await idle();
    T("one", { N: one.N, mode: one.mode, p: one.p });
    tile("artist", "Z").click();
    // a short swipe, then a tap on the front while it is still settling
    var p0 = S().p;
    await swipe(14, 12, 6);
    await window.__sleep(200);
    var r0 = stage.getBoundingClientRect();
    var x = r0.left + r0.width / 2, y = r0.top + r0.height * 0.4;
    stage.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 4, clientX: x, clientY: y, bubbles: true, pointerType: "touch", isPrimary: true }));
    stage.dispatchEvent(new PointerEvent("pointerup", { pointerId: 4, clientX: x, clientY: y, bubbles: true, pointerType: "touch", isPrimary: true }));
    var after = await idle();
    T("tap_settling", { p: after.p, whole: Number.isInteger(after.p), flipped: !!document.querySelector(".it.flipped") });
    // the info under the shelf is one height whatever the title: D holds a short one and a very long one
    tile("artist", "D").click();
    var heights = [], titles = [];
    for (var k = 0; k < S().N; k++) {
      heights.push(document.getElementById("info").getBoundingClientRect().height);
      titles.push(S().title);
      stage.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      await idle();
    }
    T("info", { heights: heights, titles: titles });
  ` });
  harness.assertNoPageError(assert, r);
  await t.test("a flick on a one-album shelf comes to rest on it", () => {
    assert.equal(r.one.N, 1);
    assert.equal(r.one.mode, "idle");
    assert.equal(r.one.p, 0);
  });
  await t.test("a tap on the front while it settles turns it over squarely", () => {
    assert.equal(r.tap_settling.whole, true, "left between two albums at " + r.tap_settling.p);
    assert.equal(r.tap_settling.flipped, true);
  });
  await t.test("the album details are one height for a short title and a long one", () => {
    assert.ok(r.info.titles.some((x) => x.length > 40), "precondition: a long title came to the front");
    assert.equal(new Set(r.info.heights.map(Math.round)).size, 1, "heights: " + r.info.heights.join(", "));
  });
});

test("Shelf goes back to the wall display when left alone, as the remote does (v1.9.1)", { skip: !harness.available }, async (t) => {
  const go = harness.renderPage({ name: "shelf-idle", page: "shelf", windowSize: "1440x900", budgetMs: 100000,
    stub: stub({ wall: true, storage: { "rra-zone": "z1", "rra-display-idle": "1" } }), driver: HELPERS + `
    await window.__sleep(45000);
    T("at45", window.__went.length);
    await window.__sleep(35000);
    T("went", window.__went);
  ` });
  harness.assertNoPageError(assert, go);
  const off = harness.renderPage({ name: "shelf-idle-off", page: "shelf", windowSize: "1440x900", budgetMs: 100000,
    stub: stub({ wall: false, storage: { "rra-zone": "z1", "rra-display-idle": "1" } }), driver: HELPERS + `
    await window.__sleep(80000);
    T("went", window.__went);
  ` });
  harness.assertNoPageError(assert, off);
  await t.test("after the remote's idle minutes it goes to the wall display, in place of Shelf", () => {
    assert.equal(go.at45, 0, "it left before the minute was up");
    assert.equal(go.went.length, 1);
    assert.match(go.went[0].url, /\/display$/);
    assert.equal(go.went[0].type, "replace");
  });
  await t.test("with the wall display switched off it stays", () => {
    assert.deepEqual(off.went, []);
  });
});
