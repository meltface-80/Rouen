"use strict";
// ---------------------------------------------------------------------------
// v1.9.67-t5 (the owner, 2026-10-26/27; dev/design/stacks.md): the Stack, a
// fourth look — every album a spine lying flat, as wide as the stage, with
// room for the catalogue number and the year, in a list that scrolls as a
// page does; and the opened view, in every look: a case turned over unfolds
// into it (the cover, the facts, every track), a Stack row opens it in place
// beneath itself, and the tracks are chosen on it as they were on the back
// of the case. The list is made by the REAL lib/shelf.js, so its shape is
// the server's; the renders the owner was sent came from these same scenes.
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
  var stage = document.getElementById("stage");
  function $(s) { return document.querySelector(s); }
  function tile(cat, id) { return $('.tile[data-cat="' + cat + '"][data-id="' + id + '"]'); }
  function tabTo(t) { $('.tab[data-tab="' + t + '"]').click(); }
  function texts(sel) { return Array.prototype.map.call(document.querySelectorAll(sel), function (e) { return e.textContent; }); }
  async function idle() { for (var i = 0; i < 200 && S().mode !== "idle"; i++) await window.__sleep(50); return S(); }
  var pid = 20;
  function pe(type, x, y, id) { stage.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: "touch", isPrimary: true })); }
  function tap(x, y) { var id = ++pid; pe("pointerdown", x, y, id); pe("pointerup", x, y, id); }
  async function hold(x, y) { var id = ++pid; pe("pointerdown", x, y, id); await window.__sleep(650); pe("pointerup", x, y, id); await window.__sleep(60); }
  function mid(el) { var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  function rowEl(i) { return $('.stack-row[data-i="' + i + '"]'); }
  function rows() { return Array.prototype.map.call(document.querySelectorAll(".stack-row"), function (r) { return +r.dataset.i; }).sort(function (a, b) { return a - b; }); }
  function rowText(i) { var r = rowEl(i); return r ? { tab: (r.querySelector(".st-tab") || {}).textContent || "", ar: r.querySelector(".st-ar").textContent, ti: r.querySelector(".st-ti").textContent,
    lab: (r.querySelector(".st-lab") || {}).textContent || "", yr: (r.querySelector(".st-yr") || {}).textContent || "", no: (r.querySelector(".st-no") || {}).textContent || "" } : null; }
  function yOf(el) { return parseFloat((el.style.transform.match(/translateY\\(([-\\d.]+)px\\)/) || [0, 0])[1]); }
  function front() { return $('.it[data-v="' + Math.round(S().p) + '"]'); }
  async function turnOver() { var c = mid(front()); tap(c.x, c.y); await window.__sleep(900); }
  function track(i) { return $('.flipped li[data-i="' + i + '"]'); }
  var shown = function (sel) { var el = $(sel); return !!el && !el.classList.contains("hidden"); };
`;
const render = (name, look, driver, size) => harness.renderPage({ name, page: "shelf", windowSize: size || "1440x900", budgetMs: 40000, stub: stub(look), driver: HELPERS + driver });
const byCat = (x, y) => {
  if (!x.c !== !y.c) return x.c ? -1 : 1;
  const n = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  return n.compare(x.c || "", y.c || "") || n.compare(x.t, y.t);
};

test("the Stack: a fourth look of spines lying flat, each with its catalogue number and year; a row opens in place (v1.9.67-t5)", { skip: !harness.available }, async (t) => {
  const r = render("shelf-t5-stack", "stack", `
    T("look", { look: S().look, cls: stage.className, pressed: $('#looks [data-look="stack"]').getAttribute("aria-pressed"),
                scene: getComputedStyle($("#scene")).display, stack: getComputedStyle($("#stack")).display, touch: getComputedStyle(stage).touchAction,
                rows: rows(), N: S().N, p: S().p, pos: $("#shelf-pos").textContent, order: $("#shelf-order").textContent });
    T("texts", [rowText(0), rowText(1), rowText(11)]);
    var p0 = Math.round(S().p);
    T("front", { cls: rowEl(Math.round(S().p)).className, h: rowEl(0).getBoundingClientRect().height, w: rowEl(0).getBoundingClientRect().width, stage: stage.getBoundingClientRect().width,
                 colours: Array.prototype.map.call(document.querySelectorAll(".stack-row"), function (el) { return el.style.getPropertyValue("--sc"); }).filter(Boolean).length });
    // the keyboard: down one, down ten with Shift, up one
    stage.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); await window.__sleep(100);
    var one = { p: S().p - p0, pos: $("#shelf-pos").textContent, front: rowEl(p0 + 1).classList.contains("front"), was: rowEl(p0).classList.contains("front") };
    stage.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, bubbles: true })); await window.__sleep(100);
    var ten = S().p - p0;
    stage.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })); await window.__sleep(100);
    T("keys", { one: one, ten: ten, back: S().p - p0, N: S().N });
    // a tap on the fifth row: it comes to the front and opens beneath itself; the rows below move down
    var c = mid(rowEl(4)); tap(c.x, c.y); await window.__sleep(500);
    var panel = $(".stack-open");
    T("open", { flipped: S().flipped, p: S().p, panel: !!panel, cls: rowEl(4).className, asked: window.__callsMatching("/api/album?"),
                tracks: texts(".stack-open .bk-tracks li span"), title: $(".stack-open .bk-ti").textContent, line: $(".stack-open .bk-lab").textContent,
                cover: !!$(".stack-open .bk-cover"), gap: yOf(rowEl(5)) - yOf(rowEl(4)), row: rowEl(0).getBoundingClientRect().height,
                panelY: yOf(panel), panelH: panel.getBoundingClientRect().height, bar: $("#mt").classList.contains("no-album") });
    // tracks chosen on it as on the back of a case: a hold, then a tap adds; their buttons in the bar
    var tr = mid(track(1)); await hold(tr.x, tr.y);
    var held = { picks: S().picks, tick: !!track(1).querySelector("i svg"), popup: shown("#tsel"), open: S().flipped };
    tr = mid(track(2)); tap(tr.x, tr.y); await window.__sleep(80);
    T("chosen", { held: held, added: S().picks, count: $("#tsel-count").textContent });
    $('#tsel [data-tact="queue"]').click(); await window.__sleep(300);
    T("queued", window.__posts.filter(function (x) { return x.url.indexOf("/api/play-track") > -1; }).map(function (x) { return x.body.track + ":" + x.body.album_title; }));
    // Play now in the bar: the open album, the row in front
    $('#actions [data-act="play_now"]').click(); await window.__sleep(300);
    T("play", (window.__posts.filter(function (x) { return x.url.indexOf("/api/play") > -1 && x.url.indexOf("play-track") < 0; }).pop() || {}).body);
    // a tap on the view's title folds it away; the row stays in front
    var ti = mid($(".stack-open .bk-ti")); tap(ti.x, ti.y); await window.__sleep(200);
    T("closed", { flipped: S().flipped, panel: !!$(".stack-open"), p: S().p, gap: yOf(rowEl(5)) - yOf(rowEl(4)) });
    // a tap on another row opens that one — a track chosen on it is let go when a third opens (what is chosen is
    // always the open album); a tap on the open row closes it
    c = mid(rowEl(7)); tap(c.x, c.y); await window.__sleep(200);
    var seven = S().flipped;
    tr = mid(track(0)); await hold(tr.x, tr.y);
    var onSeven = S().picks.slice();
    // a row above the open one: the rows below it have been pushed out of view
    c = mid(rowEl(2)); tap(c.x, c.y); await window.__sleep(200);
    var onTwo = { open: S().flipped, picks: S().picks, popup: shown("#tsel") };
    c = mid(rowEl(2)); tap(c.x, c.y); await window.__sleep(200);
    T("toggle", { seven: seven, onSeven: onSeven, onTwo: onTwo, then: S().flipped });
    // Spin: a row at random, said
    $("#spin-btn").click(); await window.__sleep(300);
    T("spin", { moved: S().p !== 7, toast: $("#toast").textContent, mode: S().mode });
    // by label: the brass tabs where each label begins, lying on the rows
    tabTo("order"); tile("order", "label").click(); await idle(); await window.__sleep(200);
    T("byLabel", { tabs: texts(".stack-row .st-tab").filter(Boolean), order: $("#shelf-order").textContent, flipped: S().flipped });
    // by catalogue number: the numbers in order across every label, none tabbed
    tile("order", "catno").click(); await idle(); await window.__sleep(200);
    T("byCat", { list: window.__shelfOrder(), tabs: document.querySelectorAll(".stack-row .st-tab").length, chips: texts("#chips .chip > span"), order: $("#shelf-order").textContent });
    // back to the covers: the shelf's own scene again
    $('#looks [data-look="covers"]').click(); await window.__sleep(300);
    T("covers", { look: S().look, stack: getComputedStyle($("#stack")).display, scene: getComputedStyle($("#scene")).display, kept: localStorage.getItem("rra-shelf-look") });
  `);
  harness.assertNoPageError(assert, r);
  await t.test("THE one: the look is the Stack — its button pressed, the scene gone, the list in its place, scrolling as a page does", () => {
    assert.equal(r.look.look, "stack");
    assert.match(r.look.cls, /look-stack/);
    assert.equal(r.look.pressed, "true");
    assert.deepEqual([r.look.scene, r.look.stack, r.look.touch], ["none", "block", "pan-y"]);
    assert.deepEqual(r.look.rows, SHELF.albums.map((_, i) => i), "every row of a short library is drawn");
    assert.equal(r.look.pos, `${r.look.p + 1} of 14`);   // the shelf opens on an album at random when nothing plays
    assert.equal(r.look.order, "A → Z by artist");
  });
  await t.test("a row: the letter's tab where a run begins, the artist, the title; the label, the year and the number at the right", () => {
    // the list comes in the server's artist order: here, the fixture's
    assert.deepEqual(r.texts[0], { tab: "A", ar: "Aphex Twin", ti: "Richard D. James Album", lab: "Warp", yr: "1996", no: "WARP 43" });
    assert.deepEqual(r.texts[1], { tab: "", ar: "Aphex Twin", ti: "Windowlicker", lab: "Warp", yr: "1999", no: "WAP 105" });
    assert.deepEqual(r.texts[2], { tab: "R", ar: "Radiohead", ti: "Kid A", lab: "", yr: "2000", no: "" }, "an album with no label and no number shows neither");
  });
  await t.test("as wide as the stage, two lines tall, the row in front marked, coloured from the stand-in until a cover is seen", () => {
    assert.match(r.front.cls, /front/);
    assert.ok(Math.abs(r.front.w - r.front.stage) < 2, `row ${r.front.w} wide on a stage ${r.front.stage} wide`);
    assert.ok(r.front.h >= 36 && r.front.h <= 64, "row height " + r.front.h);
    assert.equal(r.front.colours, SHELF.albums.length);
  });
  await t.test("the arrow keys move the row in front (Shift: ten), and n of N follows", () => {
    const p0 = Math.round(r.look.p), lim = (n) => Math.min(13, p0 + n) - p0;
    assert.deepEqual(r.keys.one, { p: lim(1), pos: `${p0 + lim(1) + 1} of 14`, front: lim(1) === 1, was: false });
    assert.equal(r.keys.ten, lim(11));
    assert.equal(r.keys.back, lim(11) - 1);
  });
  await t.test("THE one: a tap opens the row in place — the view beneath it with the cover, the facts and the tracks; the rows below pushed down", () => {
    assert.deepEqual([r.open.flipped, r.open.p, r.open.panel, r.open.asked], [4, 4, true, 1]);
    assert.match(r.open.cls, /open/);
    assert.deepEqual(r.open.tracks, ["Untitled", "Archangel", "Near Dark", "Ghost Hardware"]);
    assert.equal(r.open.title, "Untrue");
    assert.equal(r.open.line, "Hyperdub · HDBCD002 · Album · 2007");
    assert.equal(r.open.cover, true);
    assert.ok(r.open.panelH > r.open.row * 4, "the view is no taller than a few rows: " + r.open.panelH);
    assert.ok(Math.abs(r.open.gap - (r.open.row + r.open.panelH)) < 2, `the next row sits ${r.open.gap}px below, not a row and the view (${r.open.row} + ${r.open.panelH})`);
    assert.ok(Math.abs(r.open.panelY - 5 * r.open.row) < 2, "the view is not right under its row");
    assert.equal(r.open.bar, false, "the bar's Play now and Queue are not for this album");
  });
  await t.test("tracks are chosen on it as on the back of a case: a hold, a tap adds, the bar's buttons send them", () => {
    assert.deepEqual(r.chosen.held, { picks: [1], tick: true, popup: true, open: 4 });
    assert.deepEqual(r.chosen.added, [1, 2]);
    assert.equal(r.chosen.count, "2 tracks chosen");
    assert.deepEqual(r.queued, ["1:Untrue", "2:Untrue"]);
  });
  await t.test("the bar's Play now plays the open album, the row in front", () => {
    assert.equal(r.play.title, "Untrue");
    assert.equal(r.play.kind, "play_now");
  });
  await t.test("a tap on the view folds it away; the row stays in front; a tap on another row opens that one, on the open row closes it", () => {
    assert.deepEqual(r.closed, { flipped: null, panel: false, p: 4, gap: r.open.row });
    assert.deepEqual(r.toggle, { seven: 7, onSeven: [0], onTwo: { open: 2, picks: [], popup: false }, then: null });
  });
  await t.test("Spin lands on a row at random and says so", () => {
    assert.equal(r.spin.moved, true);
    assert.match(r.spin.toast, /^Landed on /);
    assert.equal(r.spin.mode, "idle");
  });
  await t.test("filed by label: the brass tabs lie on the rows where each label begins; the open row is folded away by the refiling", () => {
    assert.deepEqual(r.byLabel.tabs, ["Columbia", "EMI", "Hyperdub", "Kompakt", "Ninja Tune", "Warp"]);
    assert.equal(r.byLabel.order, "By label and catalogue №");
    assert.equal(r.byLabel.flipped, null);
  });
  await t.test("THE one for the order: by catalogue № — the numbers in order across every label, the unnumbered last by artist, no tabs, a chip", () => {
    assert.deepEqual(r.byCat.list, SHELF.albums.slice().sort(byCat).map((a) => a.t));
    assert.equal(r.byCat.tabs, 0);
    assert.deepEqual(r.byCat.chips, ["By catalogue №"]);
    assert.equal(r.byCat.order, "By catalogue №");
  });
  await t.test("back to the covers: the scene again, the look kept", () => {
    assert.deepEqual(r.covers, { look: "covers", stack: "none", scene: "block", kept: "covers" });
  });
});

test("the opened view in every look: a case turned over unfolds to the stage, square, with the cover, the facts and the tracks (v1.9.67-t5)", { skip: !harness.available }, async (t) => {
  for (const look of ["covers", "spines", "ring"]) {
    const r = render("shelf-t5-open-" + look, look, `
      var rigBefore = $("#rig").style.transform;
      await turnOver();
      var it = $(".it.flipped"), sb = stage.getBoundingClientRect(), b = it.getBoundingClientRect();
      T("open", { look: S().look, flipped: S().flipped, tf: it.style.transform, w: b.width, h: b.height, stage: { w: sb.width, h: sb.height },
                  inside: b.left >= sb.left - 1 && b.right <= sb.right + 1 && b.top >= sb.top - 1 && b.bottom <= sb.bottom + 1,
                  side: getComputedStyle(it.querySelector(".side.l")).display, rig: $("#rig").style.transform, rigBefore: rigBefore,
                  cover: !!$(".it.flipped .bk-cover"), line: $(".it.flipped .bk-lab").textContent, tracks: texts(".it.flipped .bk-tracks li span").length,
                  fitted: $(".it.flipped .bk-tracks").style.getPropertyValue("--fit") !== "" });
      // the wheel over the list is the list's, not the shelf's
      var p0 = S().p;
      track(1).dispatchEvent(new WheelEvent("wheel", { deltaY: 120, deltaMode: 0, bubbles: true, cancelable: true }));
      await window.__sleep(300); await idle();
      var wheelList = { p: S().p === p0, flipped: S().flipped };
      // a hold chooses here too
      var tr = mid(track(2)); await hold(tr.x, tr.y);
      T("picked", { picks: S().picks, flipped: S().flipped, wheel: wheelList });
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      var ti = mid($(".it.flipped .bk-ti")); tap(ti.x, ti.y); await window.__sleep(300); await idle();
      var it2 = $('.it[data-v="' + Math.round(S().p) + '"]'), b2 = it2.getBoundingClientRect();
      T("closed", { flipped: S().flipped, w: b2.width, rig: $("#rig").style.transform, side: getComputedStyle(it2.querySelector(".side.l")).display });
    `);
    harness.assertNoPageError(assert, r);
    await t.test(look + ": THE one: turned over, the case stands square and fills the stage, inside it, its spines not drawn", () => {
      assert.equal(r.open.look, look);
      assert.notEqual(r.open.flipped, null);
      assert.equal(r.open.tf, "none");
      assert.ok(r.open.w > r.open.stage.w * 0.8 && r.open.h > r.open.stage.h * 0.8, JSON.stringify(r.open));
      assert.equal(r.open.inside, true, JSON.stringify(r.open));
      assert.equal(r.open.side, "none");
    });
    await t.test(look + ": the cover, the facts with the year, every track, the list fitted to its room", () => {
      assert.equal(r.open.cover, true);
      assert.match(r.open.line, /(^| · )\d{4}$/, "the year ends the line: " + r.open.line);
      assert.equal(r.open.tracks, 4);
      assert.equal(r.open.fitted, true);
    });
    await t.test(look + ": the wheel over the list leaves the shelf where it is; a hold chooses a track", () => {
      assert.deepEqual(r.picked.wheel, { p: true, flipped: r.open.flipped });
      assert.deepEqual(r.picked.picks, [2]);
    });
    await t.test(look + ": turned back, a case again, its spines back", () => {
      assert.equal(r.closed.flipped, null);
      assert.ok(r.closed.w < r.open.w * 0.8, "still unfolded: " + r.closed.w);
      assert.equal(r.closed.side, look === "spines" ? "block" : "none");
    });
    if (look === "ring") {
      await t.test("ring: the carousel lies flat while the case is open, and tilts back", () => {
        assert.match(r.open.rigBefore, /rotateX\(-17deg\)/);
        assert.equal(r.open.rig, "none");
        assert.match(r.closed.rig, /rotateX\(-17deg\)/);
      });
    }
  }
});

test("a phone held upright: the Stack's rows stack the artist over the title, the year gone; the opened view beneath a row (v1.9.67-t5)", { skip: !harness.available }, async (t) => {
  const r = render("shelf-t5-phone", "stack", `
    var row = rowEl(0);
    T("row", { w: row.getBoundingClientRect().width, stage: stage.getBoundingClientRect().width, yr: getComputedStyle(row.querySelector(".st-yr")).display,
               lab: getComputedStyle(row.querySelector(".st-lab")).display, dir: getComputedStyle(row.querySelector(".st-txt")).flexDirection, no: row.querySelector(".st-no").textContent,
               scrolls: $("#stack").scrollHeight > $("#stack").clientHeight });
    var c = mid(rowEl(1)); tap(c.x, c.y); await window.__sleep(400);
    var panel = $(".stack-open"), pb = panel.getBoundingClientRect(), sb = stage.getBoundingClientRect();
    T("open", { flipped: S().flipped, inside: pb.left >= sb.left - 1 && pb.right <= sb.right + 1, h: pb.height, stageH: sb.height,
                tracks: texts(".stack-open .bk-tracks li span").length, cols: getComputedStyle($(".stack-open .bk-tracks")).columnCount });
  `, "390x844");
  harness.assertNoPageError(assert, r);
  await t.test("THE one: the rows fit the phone — the artist over the title, no year, the number kept", () => {
    assert.ok(r.row.stage - r.row.w < 20 && r.row.w <= r.row.stage, `row ${r.row.w} on a stage ${r.row.stage} (a scrollbar at most between them)`);
    assert.deepEqual([r.row.yr, r.row.lab, r.row.dir, r.row.no], ["none", "none", "column", "WARP 43"]);
  });
  await t.test("a row opens beneath itself, the view inside the stage, the tracks in one column", () => {
    assert.equal(r.open.flipped, 1);
    assert.equal(r.open.inside, true);
    assert.ok(r.open.h < r.open.stageH, "the view is taller than the stage: " + JSON.stringify(r.open));
    assert.equal(r.open.tracks, 4);
    assert.equal(r.open.cols, "1");
  });
});
