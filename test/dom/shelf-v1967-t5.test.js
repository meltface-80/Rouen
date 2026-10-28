"use strict";
// ---------------------------------------------------------------------------
// v1.9.67-t5 (the owner, 2026-10-26/27; dev/design/album-view.md): a tap on
// the case in front turns it over, and the turn unfolds into the album view —
// the whole screen above the bar, in the remote's album-screen style: the
// cover, the title, the artist, its label · catalogue № · kinds · year, and
// every track. In every look (one since v1.9.68: the spines). The tracks are chosen on it as they were on
// the back of the case. And the Order tab's By catalogue №. The list is made
// by the REAL lib/shelf.js, so its shape is the server's; the renders the
// owner was sent came from these same scenes.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");
const { buildShelf, shelfSignature } = require("../../lib/shelf");
const { KINDS } = require("../../lib/release-facts");

// [artist, title, genres, label, catalogue number, type, year]
const RECORDS = [
  ["Aphex Twin", "Richard D. James Album", ["Electronic"], "Warp", "WARP 43", "album", 1996],
  ["Aphex Twin", "Windowlicker", ["Electronic"], "Warp", "WAP 105", "ep", 1999],
  ["Autechre", "Tri Repetae", ["Electronic"], "Warp", "WARP 38", "album", 1995],
  ["Boards of Canada", "Music Has the Right to Children", ["Electronic"], "Warp", "WARP 55", "album", 1998],
  ["Burial", "Untrue", ["Electronic"], "Hyperdub", "HDBCD002", "album", 2007],
  ["Burial", "Archangel", ["Electronic"], "Hyperdub", "HDB008", "single", 2007],
  ["Kode9 & The Spaceape", "Memories of the Future", ["Electronic"], "Hyperdub", "HDBCD001", "album", 2006],
  ["Bonobo", "Black Sands", ["Electronic"], "Ninja Tune", "ZEN 148", "album", 2010],
  ["Amon Tobin", "Supermodified", ["Electronic"], "Ninja Tune", "ZEN 49", "album", 2000],
  ["Gas", "Pop", ["Electronic"], "Kompakt", "KOMPAKT 360", "album", 2000],
  ["Miles Davis", "Kind of Blue", ["Jazz"], "Columbia", "CL 1355", ["album", "live"], 1959],
  ["Radiohead", "Kid A", ["Pop/Rock", "Electronic"], null, null, "album", 2000],
  ["Sade", "Diamond Life", ["R&B"], null, null, null, 1984],
  ["Various", "Trainspotting", ["Pop/Rock"], "EMI", null, "soundtrack", 1996],
];
const canon = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/^the /, "");
const SHELF = buildShelf(
  RECORDS.map(([artist, title, g, l, c, ty, y], i) => ({ offset: 100 + i, title, subtitle: artist, image_key: "k" + i, g, f: canon(artist), l, c, ty, y })),
  { genresOf: (al) => al.g, firstOf: (al) => al.f, yearOf: (al) => al.y, labelOf: (al) => al.l, catOf: (al) => al.c, typeOf: (al) => al.ty });
const ANSWER = Object.assign({ total: SHELF.albums.length, rev: "1.0", sig: shelfSignature(SHELF), kinds: KINDS }, SHELF);
const ZONE = { zone_id: "z1", display_name: "Living Room", state: "paused" };
const TRACKS = { tracks: [{ title: "Untitled" }, { title: "Archangel" }, { title: "Near Dark" }, { title: "Ghost Hardware" }], discs: null };

const stub = (look) => `
window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(performance.now()); }, 16); };
window.cancelAnimationFrame = function (id) { clearTimeout(id); };
navigation.addEventListener("navigate", function (e) { if (e.cancelable) e.preventDefault(); });
window.__posts = [];
try { localStorage.clear(); localStorage.setItem("rra-zone", "z1"); localStorage.setItem("rra-shelf-look", ${JSON.stringify(look)});
      localStorage.setItem("rra-shelf-help", JSON.stringify({ seen: "1.9.67", never: true })); } catch (e) { /* always there here */ }
window.__installFetch(function (u, o) {
  if (o && o.method === "POST") window.__posts.push({ url: u, body: JSON.parse(o.body) });
  if (u.indexOf("/api/shelf/albums") > -1) return window.__json(${JSON.stringify(ANSWER)});
  if (u.indexOf("/api/live") > -1) return window.__json({ rev: { library: "1.0", settings: "1" } });
  if (u.indexOf("/api/settings/display") > -1) return window.__json({ enabled: false, seconds: 10 });
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (u.indexOf("/api/album?") > -1) return window.__json(${JSON.stringify(TRACKS)});
  if (u.indexOf("/api/update/status") > -1) return window.__json({ current: "1.9.67-t5" });
  if (u.indexOf("/api/play") > -1) return window.__json({ ok: true });
  return undefined;
});`;
const HELPERS = `
  var __st = document.createElement("style");
  __st.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; }";
  document.head.appendChild(__st);
  var S = function () { return window.__shelfState(); };
  for (var i = 0; i < 80 && !(S() && S().N); i++) await window.__sleep(100);
  await window.__sleep(400);
  var stage = document.getElementById("stage"), ov = document.getElementById("open");
  function $(s) { return document.querySelector(s); }
  function tile(cat, id) { return $('.tile[data-cat="' + cat + '"][data-id="' + id + '"]'); }
  function tabTo(t) { $('.tab[data-tab="' + t + '"]').click(); }
  function texts(sel) { return Array.prototype.map.call(document.querySelectorAll(sel), function (e) { return e.textContent; }); }
  async function idle() { for (var i = 0; i < 200 && S().mode !== "idle"; i++) await window.__sleep(50); return S(); }
  var pid = 20;
  function pe(type, x, y, id) { stage.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: "touch", isPrimary: true })); }
  function tap(x, y) { var id = ++pid; pe("pointerdown", x, y, id); pe("pointerup", x, y, id); }
  function pr(el, type, x, y, id) { el.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: "touch", isPrimary: true })); }
  async function tapOn(el) { var c = mid(el), id = ++pid; pr(el, "pointerdown", c.x, c.y, id); pr(el, "pointerup", c.x, c.y, id); await window.__sleep(80); }
  async function holdOn(el) { var c = mid(el), id = ++pid; pr(el, "pointerdown", c.x, c.y, id); await window.__sleep(650); pr(el, "pointerup", c.x, c.y, id); await window.__sleep(60); }
  async function slide(x, y, dx) { var id = ++pid; pe("pointerdown", x, y, id); for (var k = 1; k <= 6; k++) { pe("pointermove", x + dx * k / 6, y, id); await window.__sleep(16); } pe("pointerup", x + dx, y, id); await window.__sleep(80); }
  function mid(el) { var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  function front() { return $('.it[data-v="' + Math.round(S().p) + '"]'); }
  async function turnOver() { var c = mid(front()); tap(c.x, c.y); await window.__sleep(900); }
  function track(i) { return $('#open li[data-i="' + i + '"]'); }
  function viewOpen() { return !ov.classList.contains("hidden") && ov.classList.contains("on"); }
  function box(el) { var b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; }
  var shown = function (sel) { var el = $(sel); return !!el && !el.classList.contains("hidden"); };
  function disp(sel) { return getComputedStyle($(sel)).display; }
`;
const render = (name, look, driver, size) => harness.renderPage({ name, page: "shelf", windowSize: size || "1440x900", budgetMs: 40000, stub: stub(look), driver: HELPERS + driver });
const byCat = (x, y) => {
  if (!x.c !== !y.c) return x.c ? -1 : 1;
  const n = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  return n.compare(x.c || "", y.c || "") || n.compare(x.t, y.t);
};

test("the album view: the case in front turns over and the whole screen above the bar opens the album (v1.9.67-t5)", { skip: !harness.available }, async (t) => {
  // every look in t5; the spines alone since v1.9.68 (the owner)
  for (const look of ["spines"]) {
    const r = render("shelf-t5-open-" + look, look, `
      var before = { view: viewOpen(), hidden: ov.classList.contains("hidden") };
      await turnOver();
      var bar = box($("#mt")), o = box(ov);
      T("open", { look: S().look, flipped: S().flipped, before: before, view: viewOpen(), o: o, bar: bar, W: window.innerWidth,
                  flippedCase: !!$(".it.flipped"), cover: !!$("#open .ov-art img"), title: $("#open .ov-title").textContent, sub: $("#open .ov-sub").textContent,
                  line: $("#open .ov-line").textContent, tracks: texts("#open .bk-tracks li span"), label: $("#open .ov-label").textContent,
                  back: disp("#open-close .ico-back"), close: disp("#open-close .ico-close"), row: disp("#open-body"), dir: getComputedStyle($("#open-body")).flexDirection,
                  art: box($("#open .ov-art")), info: box($("#open .ov-tracks")), overLane: document.elementFromPoint(40, 300) === ov || ov.contains(document.elementFromPoint(40, 300)),
                  barReachable: $("#mt").contains(document.elementFromPoint(bar.l + bar.w / 2, bar.t + bar.h / 2)) });
      // a hold chooses, a tap adds; their buttons under the cover (v1.9.68; in the bar beneath the view before)
      await holdOn(track(2)); await tapOn(track(0));
      T("picked", { picks: S().picks, popup: shown("#tsel"), count: $("#tsel-count").textContent, ticks: document.querySelectorAll("#open li.sel").length });
      // the arrow key: the next album in the view, the view still open, its tracks read; Shift: ten on, its case not yet drawn
      var t0 = $("#open .ov-title").textContent;
      stage.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); await window.__sleep(100);
      var t1 = $("#open .ov-title").textContent, f1 = S().flipped, mid1 = viewOpen();
      await idle();
      var one = { changed: t1 !== t0, title: t1, flipped: f1, open: viewOpen(), mid: mid1, p: S().p, picks: S().picks, flippedCase: !!$(".it.flipped"),
                  asked: window.__callsMatching("/api/album?"), tracks: texts("#open .bk-tracks li span").length, back: !!$(".it.flipped .bk-ti"), top: $("#open-body").scrollTop };
      stage.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true })); await window.__sleep(100);
      var mid10 = { open: viewOpen(), hidden: ov.classList.contains("hidden") };
      await idle(); await window.__sleep(100);
      T("stepped", { one: one, ten: { mid: mid10, open: viewOpen(), p: S().p, flipped: S().flipped, title: $("#open .ov-title").textContent, tracks: texts("#open .bk-tracks li span").length } });
      // × closes: the case turns back, the keys the stage's again
      $("#open-close").click(); await window.__sleep(500); await idle();
      var closed = { flipped: S().flipped, view: viewOpen(), hidden: ov.classList.contains("hidden"), flippedCase: !!$(".it.flipped"), focus: document.activeElement === stage };
      // Escape closes too; so does a swipe on the shelf
      await turnOver(); document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await window.__sleep(500);
      var esc = { flipped: S().flipped, view: viewOpen() };
      await turnOver(); var c = mid(stage); await slide(c.x, c.y, -240); await window.__sleep(300); await idle();
      T("closed", { x: closed, esc: esc, swipe: { flipped: S().flipped, view: viewOpen() } });
    `);
    harness.assertNoPageError(assert, r);
    const rec = (title) => RECORDS.find((x) => x[1] === title);
    await t.test(look + ": THE one: turned over, the album view is open over the whole screen above the bar, the lane under it, the bar still to be tapped", () => {
      assert.equal(r.open.look, look);
      assert.deepEqual(r.open.before, { view: false, hidden: true });
      assert.notEqual(r.open.flipped, null);
      assert.equal(r.open.flippedCase, true, "the case did not turn");
      assert.equal(r.open.view, true);
      const { o, bar, W } = r.open;
      assert.ok(Math.abs(o.l) < 1 && Math.abs(o.w - W) < 1 && Math.abs(o.t) < 1 && Math.abs(o.b - bar.t) < 1.5, JSON.stringify({ o, bar, W }));
      assert.equal(r.open.overLane, true);
      assert.equal(r.open.barReachable, true);
    });
    await t.test(look + ": the remote's album screen — the cover beside the title, the artist, the facts with the year, Tracks over a hairline, every track; × to close", () => {
      assert.equal(r.open.cover, true);
      const x = rec(r.open.title);
      assert.ok(x, "no such album: " + r.open.title);
      assert.equal(r.open.sub, x[0]);
      assert.match(r.open.line, /(^| · )\d{4}$/, "the year ends the line: " + r.open.line);
      assert.deepEqual(r.open.tracks, ["Untitled", "Archangel", "Near Dark", "Ghost Hardware"]);
      assert.equal(r.open.label, "Tracks");
      assert.deepEqual([r.open.back, r.open.close, r.open.dir], ["none", "block", "row"]);
      // v1.9.71 (on purpose): on this landscape screen the three columns, the title under the cover and the tracks
      // beside it (album-view-landscape.md §7 step 4); the tracks beside the cover in either layout
      assert.ok(r.open.art.r <= r.open.info.l + 1, "the cover is not beside the tracks: " + JSON.stringify([r.open.art, r.open.info]));
    });
    await t.test(look + ": tracks are chosen on it as on the back of the case: a hold, a tap adds, their buttons up", () => {
      assert.deepEqual(r.picked, { picks: [0, 2], popup: true, count: "2 tracks chosen", ticks: 2 });
    });
    await t.test(look + ": the arrow key shows the next album in the view, which stays open, from the top, its tracks read; the choosing ends; Shift steps ten without closing", () => {
      const { one, ten } = r.stepped;
      assert.equal(one.changed, true, "the view did not change album");
      assert.deepEqual([one.mid, one.open], [true, true], "the view closed on the way");
      assert.equal(one.flipped, one.p, "the case in front is not the one shown");
      assert.deepEqual(one.picks, []);
      assert.deepEqual([one.flippedCase, one.back], [true, true], "the stepped case is not turned, or its back is blank");
      assert.deepEqual([one.asked, one.tracks, one.top], [2, 4, 0], JSON.stringify(one));
      assert.deepEqual(ten.mid, { open: true, hidden: false }, "the view closed while the shelf was on its way ten albums on");
      assert.equal(ten.open, true);
      assert.equal(ten.flipped, ten.p);
      assert.equal(ten.tracks, 4);
      assert.equal(ten.title, RECORDS[((one.p + 10) % RECORDS.length + RECORDS.length) % RECORDS.length][1]);
    });
    await t.test(look + ": × turns the case back and closes the view; so do Escape and a swipe", () => {
      assert.deepEqual(r.closed.x, { flipped: null, view: false, hidden: true, flippedCase: false, focus: true });
      assert.deepEqual(r.closed.esc, { flipped: null, view: false });
      assert.deepEqual(r.closed.swipe, { flipped: null, view: false });
    });
  }
});

test("a phone held upright: the cover edge to edge over the title, Back a chevron, the tracks beneath (v1.9.67-t5)", { skip: !harness.available }, async (t) => {
  const r = render("shelf-t5-phone", "spines", `
    await turnOver();
    var body = $("#open-body"), bar = box($("#mt")), o = box(ov), art = box($("#open .ov-art"));
    T("open", { view: viewOpen(), o: o, bar: bar, W: window.innerWidth, inner: body.clientWidth, dir: getComputedStyle(body).flexDirection, art: art,
                back: disp("#open-close .ico-back"), close: disp("#open-close .ico-close"), align: getComputedStyle($("#open .ov-title")).textAlign,
                tracks: texts("#open .bk-tracks li span").length, scrolls: body.scrollHeight > body.clientHeight + 1 });
    await holdOn(track(1));
    T("picked", { picks: S().picks, popup: shown("#tsel"), barReachable: $("#mt").contains(document.elementFromPoint(bar.l + bar.w / 2, bar.t + bar.h / 2)) });
    $("#open-close").click(); await window.__sleep(400);
    T("closed", { view: viewOpen(), flipped: S().flipped });
  `, "390x844");
  harness.assertNoPageError(assert, r);
  await t.test("THE one: the view is the screen above the bar; the cover full width over the title, centred; Back is a chevron", () => {
    assert.equal(r.open.view, true);
    const { o, bar, W, art } = r.open;
    assert.ok(Math.abs(o.w - W) < 1 && Math.abs(o.b - bar.t) < 1.5, JSON.stringify({ o, bar, W }));
    assert.equal(r.open.dir, "column");
    // edge to edge of the view's content: a desktop browser's scrollbar (this one's, now the view scrolls, v1.9.68)
    // takes its width; an iPhone's floats over
    assert.ok(Math.abs(art.w - r.open.inner) < 1 && W - r.open.inner < 20, "the cover is not edge to edge: " + JSON.stringify([art, r.open.inner]));
    assert.deepEqual([r.open.back, r.open.close, r.open.align], ["block", "none", "center"]);
    assert.equal(r.open.tracks, 4);
  });
  await t.test("a track chosen, the bar still to be tapped beneath; Back closes", () => {
    assert.deepEqual(r.picked, { picks: [1], popup: true, barReachable: true });
    assert.deepEqual(r.closed, { view: false, flipped: null });
  });
});

test("Order: By catalogue № — the numbers in order across every label, the unnumbered last by artist, no tabs, a chip (v1.9.67-t5)", { skip: !harness.available }, async (t) => {
  const r = render("shelf-t5-catno", "spines", `
    tabTo("order");
    T("tiles", texts('.tile[data-cat="order"] .t-name'));
    tile("order", "catno").click(); await idle(); await window.__sleep(200);
    T("byCat", { list: window.__shelfOrder(), tabs: document.querySelectorAll(".it .side.l .sp-tab").length, chips: texts("#chips .chip > span"), order: $("#shelf-order").textContent,
                 pressed: tile("order", "catno").getAttribute("aria-pressed") });
    tile("order", "artist").click(); await idle();
    T("back", { order: $("#shelf-order").textContent, chips: texts("#chips .chip > span") });
  `);
  harness.assertNoPageError(assert, r);
  await t.test("THE one: the order, between By label and By year", () => {
    assert.deepEqual(r.tiles, ["A → Z by artist", "By label and catalogue №", "By catalogue №", "By year", "Random order"]);
    assert.deepEqual(r.byCat.list, SHELF.albums.slice().sort(byCat).map((a) => a.t));
    assert.equal(r.byCat.tabs, 0);
    assert.deepEqual([r.byCat.chips, r.byCat.order, r.byCat.pressed], [["By catalogue №"], "By catalogue №", "true"]);
  });
  await t.test("the artist order again: no chip", () => assert.deepEqual(r.back, { order: "A → Z by artist", chips: [] }));
});
