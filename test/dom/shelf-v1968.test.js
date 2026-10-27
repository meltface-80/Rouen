"use strict";
// ---------------------------------------------------------------------------
// v1.9.68 (the owner, 2026-10-27; dev/design/album-view.md): the spines the
// only shelf, as tall as the screen allows, with the year and the format
// beside the catalogue number; the album view with Play now and Queue under
// the cover and, under those, the album's review and the artist's other
// albums ("only that for now"); a phone held upright shows the case in front
// as a tall card ("what best suits a smartphone"). The list is made by the
// REAL lib/shelf.js, the format by lib/album-quality.js.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");
const { buildShelf, shelfSignature } = require("../../lib/shelf");
const { albumFormatLabel } = require("../../lib/album-quality");
const { KINDS } = require("../../lib/release-facts");

// [artist, title, label, catalogue number, year, file facts or a service]
const RECORDS = [
  ["Burial", "Untrue", "Hyperdub", "HDBCD002", 2007, { container: "FLAC", bits: 16, rate: 44100, lossless: true }],
  ["Burial", "Rival Dealer", "Hyperdub", "HDB080", 2013, "qobuz"],
  ["Burial", "Archangel", "Hyperdub", "HDB008", 2007, { container: "MP3", bits: 16, rate: 44100, lossless: false }],
  ["Floating Points", "Crush", "Ninja Tune", "ZEN 254", 2019, { container: "FLAC", bits: 24, rate: 96000, lossless: true }],
  ["Four Tet", "Rounds", "Domino", "WIGCD124", 2003, "tidal"],
  ["Massive Attack", "Mezzanine (2018 Remaster)", "Virgin", "WBRLP4", 1998, null],
  // a reissue: the same title and artist as the first, a different record
  ["Burial", "Untrue", "Hyperdub", "HDBCD002X", 2017, null],
];
const canon = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const SHELF = buildShelf(
  RECORDS.map(([artist, title, l, c, y, f], i) => ({ offset: 100 + i, title, subtitle: artist, image_key: "k" + i, f: canon(artist), l, c, y, q: f })),
  { genresOf: () => ["Electronic"], firstOf: (al) => al.f, yearOf: (al) => al.y, labelOf: (al) => al.l, catOf: (al) => al.c, typeOf: () => "album",
    formatOf: (al) => albumFormatLabel(typeof al.q === "object" ? al.q : null, typeof al.q === "string" ? al.q : null) });
const ANSWER = Object.assign({ total: SHELF.albums.length, rev: "1.0", sig: shelfSignature(SHELF), kinds: KINDS }, SHELF);
const ZONE = { zone_id: "z1", display_name: "Living Room", state: "paused",
  outputs: [{ output_id: "o1", display_name: "Living Room", volume: { type: "number", min: 0, max: 100, value: 9, step: 1 } }] };
const EXTRAS = { album: { description: "Two-step slurred and half-remembered.", source: "AllMusic", url: "https://example.org/untrue" } };
const MORE = { artist: "Burial", by: [{ offset: 101, title: "Rival Dealer", subtitle: "Burial", image_key: "k1" },
  { offset: 900, title: "Street Halo", subtitle: "Burial", image_key: "k9" }] };

const stub = (opts) => `
window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(performance.now()); }, 16); };
window.cancelAnimationFrame = function (id) { clearTimeout(id); };
navigation.addEventListener("navigate", function (e) { if (e.cancelable) e.preventDefault(); });
window.__posts = [];
try { localStorage.clear(); localStorage.setItem("rra-zone", "z1"); ${(opts && opts.store) || ""}
      localStorage.setItem("rra-shelf-help", JSON.stringify({ seen: "1.9.68", never: true })); } catch (e) { /* always there here */ }
window.__installFetch(function (u, o) {
  if (o && o.method === "POST") window.__posts.push({ url: u, body: JSON.parse(o.body) });
  if (u.indexOf("/api/shelf/albums") > -1) return window.__json(${JSON.stringify(ANSWER)});
  if (u.indexOf("/api/live") > -1) return window.__json({ rev: { library: "1.0", settings: "1" } });
  if (u.indexOf("/api/settings/display") > -1) return window.__json({ enabled: false, seconds: 10 });
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (u.indexOf("/api/album/extras") > -1) return ${opts && opts.noExtras ? "window.__json({ error: 'down' }, 500)" : `window.__json(${JSON.stringify(EXTRAS)})`};
  if (u.indexOf("/api/album/more") > -1) return window.__json(${JSON.stringify((opts && opts.more) || MORE)});
  if (u.indexOf("/api/album?") > -1) return window.__json({ tracks: [{ title: "Archangel" }, { title: "Near Dark" }], discs: null });
  if (u.indexOf("/api/update/status") > -1) return window.__json({ current: "1.9.68" });
  if (u.indexOf("/api/play") > -1) return window.__json({ ok: true });
  return undefined;
});`;
const HELPERS = `
  var __st = document.createElement("style");
  __st.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; }";
  document.head.appendChild(__st);
  var S = function () { return window.__shelfState(); };
  for (var i = 0; i < 80 && !(S() && S().N); i++) await window.__sleep(100);
  await window.__sleep(500);
  var stage = document.getElementById("stage"), pid = 20;
  function $(s) { return document.querySelector(s); }
  function texts(sel) { return Array.prototype.map.call(document.querySelectorAll(sel), function (e) { return e.textContent; }); }
  function box(el) { if (typeof el === "string") el = $(el); var b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; }
  function pe(type, x, y, id) { stage.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: "touch", isPrimary: true })); }
  function front() { return $('.it[data-v="' + Math.round(S().p) + '"]'); }
  async function idle() { for (var k = 0; k < 200 && S().mode !== "idle"; k++) await window.__sleep(50); }
  async function turnOver() { var b = front().getBoundingClientRect(), id = ++pid; pe("pointerdown", b.left + b.width / 2, b.top + b.height / 2, id); pe("pointerup", b.left + b.width / 2, b.top + b.height / 2, id); await window.__sleep(900); }
  // the shelf wraps round: the album in front is p modulo the count, and a step right gets there in the end
  function here() { var n = S().N; return ((Math.round(S().p) % n) + n) % n; }
  async function goTo(title) {
    var at = window.__shelfOrder().indexOf(title);
    for (var k = 0; k < 20 && here() !== at; k++) { stage.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); await idle(); }
  }
  async function viewRead() { for (var k = 0; k < 40 && $("#open .ov-reading"); k++) await window.__sleep(100); }
`;
const render = (name, size, driver, opts) => harness.renderPage({ name, page: "shelf", windowSize: size, budgetMs: 30000, stub: stub(opts), driver: HELPERS + driver });
const fmtOf = (title) => SHELF.albums.find((a) => a.t === title).fm;

test("every spine is one line: artist, album, version down from the top; № , year, format up from the foot (v1.9.68)", { skip: !harness.available }, async (t) => {
  const r = render("shelf1968-spines", "1180x820", `
    function q(sp, c) { var el = sp.querySelector(c); return el ? el : null; }
    function bx(el) { var b = el.getBoundingClientRect(); return { t: b.top, b: b.bottom, cx: b.left + b.width / 2 }; }
    // the spines in front of the eye: the cases either side of the front one, edge on
    T("spines", Array.prototype.filter.call(document.querySelectorAll(".it.edge"), function (it) { return it.style.visibility !== "hidden"; }).map(function (it) {
      var sp = it.querySelector(".side.l .sp"), txt = q(sp, ".sp-txt"), foot = q(sp, ".sp-foot");
      var top = [".sp-ar", ".sp-ti", ".sp-vr"].map(function (c) { var el = q(sp, c); return el && bx(el); }).filter(Boolean);
      var feet = Array.prototype.map.call(foot.children, function (el) { return bx(el); });
      return { ti: q(sp, ".sp-ti").textContent, vr: (q(sp, ".sp-vr") || {}).textContent || "", foot: Array.prototype.map.call(foot.children, function (el) { return el.textContent; }),
        down: top.every(function (b, i) { return !i || b.t >= top[i - 1].b - 1; }), up: feet.every(function (b, i) { return !i || b.t >= feet[i - 1].b - 1; }),
        atFoot: Math.abs(bx(foot).b - bx(txt).b) < 2, oneLine: top.concat(feet).every(function (b) { return Math.abs(b.cx - top[0].cx) < 2; }) };
    }));
  `, { store: 'localStorage.setItem("rra-shelf-pick", "off");' });
  harness.assertNoPageError(assert, r);
  await t.test("the formats as lib/album-quality.js names them: the files' numbers, a service, or nothing known", () => {
    assert.deepEqual(SHELF.albums.map((a) => a.fm), ["FLAC 16/44.1", "Qobuz", "MP3", "FLAC 24/96", "TIDAL", null, null]);
  });
  await t.test("the version is taken off the title by the server", () => {
    assert.deepEqual(SHELF.albums.find((a) => a.c === "WBRLP4").v, ["Mezzanine", "2018 Remaster"]);
  });
  await t.test("THE one: one line; artist, album, version reading down; the format, the year and the number reading down to the foot", () => {
    assert.ok(r.spines.length >= 4, "no spines drawn");
    for (const s of r.spines) {
      // two albums are called Untrue (a reissue): the spine is one of them
      const says = SHELF.albums.filter((a) => (a.v ? a.v[0] : a.t) === s.ti).map((a) => ({ vr: a.v ? a.v[1] : "", foot: [a.fm, a.y && String(a.y), a.c].filter(Boolean) }));
      assert.ok(says.some((x) => x.vr === s.vr && JSON.stringify(x.foot) === JSON.stringify(s.foot)), s.ti + ": " + JSON.stringify(s) + " is none of " + JSON.stringify(says));
      assert.deepEqual([s.down, s.up, s.atFoot, s.oneLine], [true, true, true, true], JSON.stringify(s));
    }
  });
});

test("the album view: Play now and Queue under the cover, then the review and the artist's other albums (v1.9.68)", { skip: !harness.available }, async (t) => {
  const r = render("shelf1968-view", "1180x820", `
    await goTo("Untrue");
    await turnOver(); await viewRead();
    var side = box("#open .ov-side"), art = box("#open .ov-art"), acts = box("#ov-acts"), about = $("#open .ov-about");
    T("view", { title: $("#open .ov-title").textContent, order: Array.prototype.map.call($("#open .ov-side").children, function (e) { return e.className; }),
                actsUnder: acts.t >= art.b - 0.5 && acts.l >= side.l - 0.5 && acts.r <= side.r + 0.5,
                labels: texts("#open .ov-about .ov-label"), review: ($("#open .ov-review .ov-text") || {}).textContent,
                link: [($("#open .ov-src") || {}).textContent, ($("#open .ov-src") || {}).href], more: texts("#open .ov-tile-t"),
                asked: [window.__callsMatching("/api/album/extras"), window.__callsMatching("/api/album/more")] });
    // the same album opened again: read once, not again
    $("#open-close").click(); await window.__sleep(400); await idle();
    await turnOver(); await viewRead();
    T("again", [window.__callsMatching("/api/album/extras"), window.__callsMatching("/api/album/more")]);
    // a tile: the shelf turns to that album and opens it
    $('#open [data-more="0"]').click(); await window.__sleep(200); await idle(); await window.__sleep(900);
    T("moved", { title: S().title, flipped: S().flipped === Math.round(S().p), view: $("#open .ov-title").textContent });
    // one the shelf does not hold: it says so, and stays
    await viewRead();
    var tiles = texts("#open .ov-tile-t"), i = tiles.indexOf("Street Halo");
    $('#open [data-more="' + i + '"]').click(); await window.__sleep(200);
    T("missing", { title: S().title, toast: $("#toast").textContent, open: $("#open").classList.contains("on") });
  `);
  harness.assertNoPageError(assert, r);
  await t.test("THE one: under the cover, in this order, the buttons, then About this album, then More by the artist", () => {
    assert.equal(r.view.title, "Untrue");
    assert.deepEqual(r.view.order, ["ov-art", "ov-acts-slot", "ov-about"]);
    assert.equal(r.view.actsUnder, true);
    assert.deepEqual(r.view.labels, ["About this album", "More by Burial"]);
  });
  await t.test("the review in its source's words, with the link to read on", () => {
    assert.equal(r.view.review, EXTRAS.album.description);
    assert.deepEqual(r.view.link, ["View on AllMusic", EXTRAS.album.url]);
  });
  await t.test("the artist's other albums, as the server lists them", () => assert.deepEqual(r.view.more, ["Rival Dealer", "Street Halo"]));
  await t.test("read once per album, not each time it is opened", () => {
    assert.deepEqual(r.view.asked, [1, 1]);
    assert.deepEqual(r.again, [1, 1]);
  });
  await t.test("a tile on the shelf: the shelf turns to it, and the view opens it", () => {
    assert.deepEqual(r.moved, { title: "Rival Dealer", flipped: true, view: "Rival Dealer" });
  });
  await t.test("a tile the shelf does not hold says so, and nothing moves", () => {
    assert.equal(r.missing.title, "Rival Dealer");
    assert.match(r.missing.toast, /isn’t on this shelf/);
    assert.equal(r.missing.open, true);
  });
});

test("a review that cannot be read leaves the artist's other albums standing (v1.9.68)", { skip: !harness.available }, async (t) => {
  const r = render("shelf1968-noextras", "1180x820", `
    await goTo("Untrue");
    await turnOver(); await viewRead();
    T("view", { labels: texts("#open .ov-about .ov-label"), review: !!$("#open .ov-review"), more: texts("#open .ov-tile-t"), reading: !!$("#open .ov-reading") });
    // opened again a moment later: what could not be read is asked again (the network may be back)
    $("#open-close").click(); await window.__sleep(4300); await idle();
    await turnOver(); await viewRead();
    T("asked", window.__callsMatching("/api/album/extras"));
  `, { noExtras: true });
  harness.assertNoPageError(assert, r);
  await t.test("no review section, no error, the other albums still there", () => {
    assert.deepEqual(r.view, { labels: ["More by Burial"], review: false, more: ["Rival Dealer", "Street Halo"], reading: false });
  });
  await t.test("opened again later, the review is asked for again", () => assert.equal(r.asked, 2));
});

test("a reissue under More by opens that record, not the album of the same name already open (v1.9.68)", { skip: !harness.available }, async (t) => {
  const reissue = SHELF.albums.find((a) => a.t === "Untrue" && a.y === 2017);
  const r = render("shelf1968-reissue", "1180x820", `
    await goTo("Untrue");
    await turnOver(); await viewRead();
    var first = window.__shelfOrder().indexOf("Untrue");
    $('#open [data-more="0"]').click(); await window.__sleep(200); await idle(); await window.__sleep(900);
    T("moved", { from: first, at: here(), view: $("#open .ov-title").textContent, line: $("#open .ov-line").textContent });
  `, { more: { artist: "Burial", by: [{ offset: reissue.o, title: "Untrue", subtitle: "Burial", image_key: "k6" }] } });
  harness.assertNoPageError(assert, r);
  await t.test("THE one: the shelf turned to the reissue, by its offset, and the view shows it", () => {
    assert.notEqual(r.moved.at, r.moved.from, JSON.stringify(r.moved));
    assert.equal(r.moved.view, "Untrue");
    assert.match(r.moved.line, /HDBCD002X/);
  });
});

test("a phone held upright: the case in front is a tall card, its names in the spine's order (v1.9.68)", { skip: !harness.available }, async (t) => {
  const r = render("shelf1968-phone", "390x844", `
    await goTo("Crush");
    var f = front(), cv = box(f.querySelector(".cv")), card = f.querySelector(".card"), cs = getComputedStyle(stage), sb = box(stage);
    T("stage", { S: parseFloat(cs.getPropertyValue("--S")), SH: parseFloat(cs.getPropertyValue("--SH")), W: sb.w, H: sb.h });
    var foot = card.querySelector(".card-f");
    T("card", { tall: stage.classList.contains("tall"), shown: getComputedStyle(card).display, under: box(card).t >= cv.b - 1, square: Math.abs(cv.w - cv.h) < 1.5,
                a: card.querySelector(".card-a").textContent, t: card.querySelector(".card-t").textContent,
                foot: Array.prototype.map.call(foot.children, function (e) { return e.textContent; }), atFoot: box(card).b - box(foot).b < 20,
                order: card.querySelector(".card-a").getBoundingClientRect().top < card.querySelector(".card-t").getBoundingClientRect().top });
  `, { store: 'localStorage.setItem("rra-shelf-pick", "off");' });
  harness.assertNoPageError(assert, r);
  await t.test("the cover 52% of the width, the case over twice as tall (v1.9.7's square stage, grown a card)", () => {
    assert.ok(r.stage.H > r.stage.W, JSON.stringify(r.stage));
    assert.equal(r.stage.S, Math.round(r.stage.W * 0.52));
    assert.ok(r.stage.SH > r.stage.S * 2, JSON.stringify(r.stage));
  });
  await t.test("THE one: a square cover; under it the artist then the album; at its foot the format, the year, the number lowest", () => {
    assert.deepEqual(r.card, { tall: true, shown: "flex", under: true, square: true, a: "Floating Points", t: "Crush",
      foot: [fmtOf("Crush"), "2019", "ZEN 254"], atFoot: true, order: true });
  });
});

test("an iPad on its side keeps the case square, with no card (v1.9.68)", { skip: !harness.available }, async (t) => {
  const r = render("shelf1968-ipad", "1180x820", `
    var cs = getComputedStyle(stage);
    T("card", { tall: stage.classList.contains("tall"), shown: getComputedStyle(front().querySelector(".card")).display,
                square: parseFloat(cs.getPropertyValue("--SH")) === parseFloat(cs.getPropertyValue("--S")) });
  `, { store: 'localStorage.setItem("rra-shelf-pick", "off");' });
  harness.assertNoPageError(assert, r);
  await t.test("the cover fills the case, as tall as the spines", () => assert.deepEqual(r.card, { tall: false, shown: "none", square: true }));
});

for (const size of ["390x844", "1180x820"]) {
  test(`${size}: the volume sheet is the remote's, centred over the shelf, just above the bar (v1.9.68-t2)`, { skip: !harness.available }, async (t) => {
    const r = render("shelf1968-vol-" + size, size, `
      for (var k = 0; k < 40 && document.getElementById("mt-vol-btn").disabled; k++) await window.__sleep(100);
      document.getElementById("mt-vol-btn").click(); await window.__sleep(200);
      var v = box("#vol"), col = box("#shelf"), bar = box("#mt"), sl = box("#vol-slider");
      T("vol", { shown: !$("#vol").classList.contains("hidden"), centred: Math.abs((v.l + v.r) / 2 - (col.l + col.r) / 2) < 1.5, inside: v.l >= col.l && v.r <= col.r,
                 above: v.b <= bar.t + 0.5 && bar.t - v.b < 20, value: $("#vol-value").textContent, ends: [$("#vol-min").textContent, $("#vol-max").textContent],
                 under: box("#vol-scale").t >= sl.b - 6, order: ["vol-readout", "vol-slider-wrap", "vol-minus", "vol-plus"].every(function (c, i, a) {
                   var el = document.querySelector("#vol > ." + c + ", #vol > #" + c); var prev = i && document.querySelector("#vol > ." + a[i - 1] + ", #vol > #" + a[i - 1]);
                   return el && (!prev || box(el).l >= box(prev).r - 1); }) });
    `, { store: 'localStorage.setItem("rra-shelf-pick", "off");' });
    harness.assertNoPageError(assert, r);
    await t.test("THE one: the speaker and the level, the slider with 0 and 100 under it, − and +, centred and just above the bar", () => {
      assert.deepEqual(r.vol, { shown: true, centred: true, inside: true, above: true, value: "9", ends: ["0", "100"], under: true, order: true });
    });
  });
}
