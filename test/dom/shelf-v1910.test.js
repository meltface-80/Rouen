"use strict";
// ---------------------------------------------------------------------------
// v1.9.10: Shelf as Mandarin has it (Mandarin v0.8.27, v0.8.28, v0.8.34).
//
// Asked: "make the changes to shelf that Mandarin has in terms of new features
// and layout". Mandarin's Shelf is this one (v1.9.3–v1.9.7) plus:
//   1. a Years tab: decades, newest first, then Undated; they OR among
//      themselves and narrow the genres and letters as those narrow them;
//   2. previous and next either side of play/pause, off where the zone says
//      it can't;
//   3. the album's Play now and Queue in the bar, by the zone button (no Play
//      next for the whole album), stepping aside while tracks are chosen; the
//      bar's parts twice the size, and on a phone the album's buttons on a row
//      of their own (since v1.9.68 under the cover in the album view, and the
//      bar slimmer, with the shelf's count, order and Spin: the phone's row is
//      theirs);
//   4. the back's track list as big as the back holds it (gone with v1.9.67-t5's album view);
//   5. a calmer swipe: a finger goes 1.4 times as far for one album;
//   6. the volume slider filled to the level.
// The list is made by the REAL lib/shelf.js, years included.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");
const { buildShelf, shelfSignature } = require("../../lib/shelf");

// artist, title, genre, year (null: undated)
const RECORDS = [
  ["Abba", "Arrival", "Pop", 1976], ["Air", "Moon Safari", "Electronic", 1998], ["Bill Evans", "Waltz for Debby", "Jazz", 1962],
  ["Burial", "Untrue", "Electronic", 2007], ["Coltrane", "Blue Train", "Jazz", 1958], ["Daft Punk", "Discovery", "Electronic", 2001],
  ["Fleetwood Mac", "Rumours", "Pop", 1977], ["Kraftwerk", "Trans-Europe Express", "Electronic", 1977], ["Massive Attack", "Mezzanine", "Electronic", 1998],
  ["Miles Davis", "Kind of Blue", "Jazz", 1959], ["Pink Floyd", "The Wall", "Pop", 1979], ["Portishead", "Dummy", "Electronic", 1994],
  ["Sade", "Diamond Life", "Pop", 1984], ["Tape Box", "Untitled Demos", "Electronic", null], ["Zeta", "Bootleg", "Jazz", null],
];
const YEAR = new Map(RECORDS.map((r, i) => [100 + i, r[3]]));
const SHELF = buildShelf(
  RECORDS.map(([artist, title, g], i) => ({ offset: 100 + i, title, subtitle: artist, image_key: "k" + i, g })),
  { genresOf: (al) => [al.g], firstOf: (al) => al.subtitle.toLowerCase(), yearOf: (al) => YEAR.get(al.offset) });
const UNDATED = buildShelf(
  RECORDS.map(([artist, title, g], i) => ({ offset: 100 + i, title, subtitle: artist, image_key: "k" + i, g })),
  { genresOf: (al) => [al.g], firstOf: (al) => al.subtitle.toLowerCase() });
const ANSWER = (shelf) => Object.assign({ total: shelf.albums.length, rev: "1.0", sig: shelfSignature(shelf) }, shelf);
const ZONES = [{ zone_id: "z1", display_name: "Lounge", state: "playing" }];
// Playing The Wall, so the shelf opens on it.
const ZONE = { zone_id: "z1", display_name: "Lounge", state: "playing", queue_items_remaining: 4,
  is_previous_allowed: true, is_next_allowed: false,
  outputs: [{ output_id: "o1", display_name: "Lounge", volume: { type: "number", min: 0, max: 80, value: 20, step: 1 } }],
  now_playing: { line1: "Hey You", line2: "Pink Floyd", line3: "The Wall", image_key: "k10", length: 280, seek_position: 30 } };
const SHORT = { tracks: [{ title: "Hey You" }, { title: "Mother" }, { title: "Comfortably Numb" }], discs: null };

const stub = (opts) => `
window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(performance.now()); }, 16); };
window.cancelAnimationFrame = function (id) { clearTimeout(id); };
window.__posts = [];
window.__zone = ${JSON.stringify((opts && opts.zone) || ZONE)};
window.__ans = ${JSON.stringify(ANSWER((opts && opts.shelf) || SHELF))};
window.__rev = "1.0";
try { localStorage.clear(); localStorage.setItem("rra-zone", "z1");
      localStorage.setItem("rra-shelf-help", JSON.stringify({ seen: "1.9.10", never: true }));
      ${(opts && opts.store) || ""} } catch (e) { /* always there here */ }
window.__installFetch(function (u, o) {
  if (o && o.method === "POST") window.__posts.push({ url: u, body: JSON.parse(o.body) });
  if (u.indexOf("/api/shelf/albums") > -1) {
    var sig = decodeURIComponent((u.split("sig=")[1] || "").split("&")[0]);
    return window.__json(sig && sig === window.__ans.sig ? { same: true, rev: window.__rev, sig: sig } : Object.assign({}, window.__ans, { rev: window.__rev }));
  }
  if (u.indexOf("/api/update/status") > -1) return window.__json({ current: "1.9.10" });
  if (u.indexOf("/api/live") > -1) return window.__json({ rev: { library: window.__rev, settings: "1" } });
  if (u.indexOf("/api/settings/display") > -1) return window.__json({ enabled: true });
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: ${JSON.stringify(ZONES)} });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: window.__zone });
  if (u.indexOf("/api/queue?") > -1) return window.__json({ items: [], history: [] });
  if (u.indexOf("/api/album?") > -1) return window.__json(${JSON.stringify((opts && opts.album) || SHORT)});
  if (u.indexOf("/api/control") > -1) return window.__json({ ok: true });
  if (u.indexOf("/api/volume") > -1) return window.__json({ ok: true });
  if (u.indexOf("/api/play") > -1) return window.__json({ ok: true });
  return undefined;
});
`;

const DRIVE = `
  var S = function () { return window.__shelfState(); };
  for (var i = 0; i < 80 && !(S() && S().N); i++) await window.__sleep(100);
  await window.__sleep(900);
  var stage = document.getElementById("stage"), pid = 40;
  function $(s) { return document.querySelector(s); }
  function rect(el) { if (typeof el === "string") el = $(el); var b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height, cx: b.left + b.width / 2, cy: b.top + b.height / 2 }; }
  function noTransitions() { var st = document.createElement("style"); st.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}"; document.head.appendChild(st); }
  function hit(el) { if (typeof el === "string") el = $(el); var c = rect(el); var top = document.elementFromPoint(c.cx, c.cy); return !!top && (top === el || el.contains(top)); }
  function tile(cat, id) { return $('.tile[data-cat="' + cat + '"][data-id="' + id + '"]'); }
  function tabTo(t) { $('.tab[data-tab="' + t + '"]').click(); }
  function pe(type, x, y, id) { stage.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: "touch", isPrimary: true })); }
  function tap(x, y) { var id = ++pid; pe("pointerdown", x, y, id); pe("pointerup", x, y, id); }
  async function hold(x, y) { var id = ++pid; pe("pointerdown", x, y, id); await window.__sleep(650); pe("pointerup", x, y, id); await window.__sleep(60); }
  function front() { return $('.it[data-v="' + Math.round(S().p) + '"]'); }
  async function turnOver() { var c = rect(front()); tap(c.cx, c.cy); await window.__sleep(1300); }
  async function idle() { for (var k = 0; k < 200 && S().mode !== "idle"; k++) await window.__sleep(50); }
  function posts(path) { return window.__posts.filter(function (x) { return x.url.indexOf(path) > -1; }).map(function (x) { return x.body; }); }
  var rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
`;

function render(name, driver, opts) {
  return harness.renderPage({ name, page: "shelf", windowSize: (opts && opts.size) || "1366x1024", budgetMs: 40000,
    stub: stub(opts), driver: DRIVE + driver });
}

test("1. the Years tab: decades newest first, then Undated, narrowing as the others do (v1.9.10)", { skip: !harness.available }, async (t) => {
  const r = render("shelf1910-years", `
    noTransitions();
    T("tabs", Array.prototype.map.call(document.querySelectorAll(".tab"), function (b) { return b.dataset.tab; }));
    tabTo("year");
    function tiles() { return Array.prototype.map.call(document.querySelectorAll('.tile[data-cat="year"]'), function (el) {
      return el.querySelector(".ch").textContent + ":" + el.querySelector(".t-count").textContent; }); }
    T("tiles", tiles());
    T("note", $("#sec-note").textContent);
    tile("year", "1970").click();
    T("seventies", { N: S().N, badge: $('.tab[data-tab="year"] .badge').textContent, note: $("#sec-note").textContent,
      chips: Array.prototype.map.call(document.querySelectorAll("#chips .chip > span"), function (c) { return c.textContent; }) });
    tile("year", "1990").click();
    T("two", { N: S().N, note: $("#sec-note").textContent, clear: !$("#sec-clear").classList.contains("hidden") });
    // a genre narrows the decades' counts, and the decades narrow the genre
    tabTo("genre");
    var pop = Array.prototype.find.call(document.querySelectorAll('.tile[data-cat="genre"]'), function (el) { return el.querySelector(".t-name").textContent === "Pop"; });
    T("popCount", pop.querySelector(".t-count").textContent);
    pop.click();
    T("popSeventies", { N: S().N, sum: $("#pick-sum").textContent });
    tabTo("year");
    T("narrowed", tiles());
    // nothing matches: the note says which decade
    $("#sec-clear").click();
    tile("year", "1960").click();
    T("empty", { N: S().N, why: $("#note-why").textContent, pos: $("#shelf-pos").textContent });
    $("#undo").click();
    T("undone", $("#shelf-pos").textContent);
    tile("year", "none").click();
    T("undated", { N: S().N, title: S().title, chip: Array.prototype.map.call(document.querySelectorAll("#chips .chip > span"), function (c) { return c.textContent; }) });
  `);
  harness.assertNoPageError(assert, r);
  // Six since v1.9.67: Labels and Types after Years, and Random grown into Order (shelf-v1967.test.js).
  await t.test("a fourth tab, Years, after Artists", () => assert.deepEqual(r.tabs, ["genre", "artist", "year", "label", "type", "order"]));
  await t.test("THE one: every decade the library has, newest first, Undated last, each with its count", () => {
    assert.deepEqual(r.tiles, ["2000s:2", "1990s:3", "1980s:1", "1970s:4", "1960s:1", "1950s:2", "Undated:2"]);
    assert.equal(r.note, "Tap decades. Choose as many as you like.");
  });
  await t.test("a decade narrows the shelf, is counted on the tab and named on its chip", () => {
    assert.equal(r.seventies.N, 4);
    assert.equal(r.seventies.badge, "1");
    assert.equal(r.seventies.note, "1 decade chosen");
    assert.deepEqual(r.seventies.chips, ["1970s"]);
  });
  await t.test("two decades widen it, and get Clear all ×", () => {
    assert.equal(r.two.N, 7);
    assert.equal(r.two.note, "2 decades chosen");
    assert.equal(r.two.clear, true);
  });
  await t.test("decades and genres narrow each other, and the counts follow", () => {
    assert.equal(r.popCount, "3", "Pop within the 1970s or 1990s: Arrival, Rumours, The Wall");
    assert.equal(r.popSeventies.N, 3);
    assert.match(r.popSeventies.sum, /3 of 15 albums on the shelf/);
    assert.deepEqual(r.narrowed.filter((x) => !x.endsWith(":0")), ["1980s:1", "1970s:3"]);
  });
  await t.test("nothing matching says which decade", () => {
    assert.equal(r.empty.N, 0);
    assert.match(r.empty.why, /No albums match Pop and the 1960s\./);
  });
  await t.test("with no album the bar's count says so, and counts again with one (v1.9.68: the count is in the bar)", () => {
    assert.equal(r.empty.pos, "0 albums");
    assert.match(r.undone, /^\d+ of \d+$/);
  });
  await t.test("Undated is the albums with no year", () => {
    assert.equal(r.undated.N, 0, "Pop has no undated album");
    assert.deepEqual(r.undated.chip, ["Pop", "Undated"]);
  });
});

test("1. the Years tab with no years known says so (v1.9.10)", { skip: !harness.available }, async (t) => {
  const r = render("shelf1910-noyears", `
    tabTo("year");
    T("msg", { tiles: document.querySelectorAll('.tile[data-cat="year"]').length, text: ($(".tiles-msg") || {}).textContent || "" });
  `, { shelf: UNDATED });
  harness.assertNoPageError(assert, r);
  await t.test("no tiles, and a sentence saying why", () => {
    assert.equal(r.msg.tiles, 0);
    assert.match(r.msg.text, /release years/);
  });
});

test("2–3. the bar: previous, play/pause, next; the record; the shelf's count, order and Spin; slimmer (v1.9.10, v1.9.68)", { skip: !harness.available }, async (t) => {
  const r = render("shelf1910-bar", `
    noTransitions();
    await window.__sleep(300);
    var parts = Array.prototype.map.call($("#mt").children, function (el) { return el.id || el.className; });
    T("order", { parts: parts, transport: Array.prototype.map.call($(".mt-transport").children, function (b) { return b.id; }) });
    T("state", { prev: $("#mt-prev").disabled, next: $("#mt-next").disabled, labels: [$("#mt-prev").getAttribute("aria-label"), $("#mt-next").getAttribute("aria-label")] });
    var row = [rect("#mt-prev"), rect("#mt-pp"), rect("#mt-next")];
    T("row", { level: Math.abs(row[0].cy - row[1].cy) < 1 && Math.abs(row[2].cy - row[1].cy) < 1, inOrder: row[0].r <= row[1].l && row[1].r <= row[2].l });
    T("shelf", { acts: !!$("#mt [data-act]"), pos: $("#mt #shelf-pos").textContent, order: $("#mt #shelf-order").textContent, spin: hit("#spin-btn") });
    T("sizes", { btn: rect("#mt-zone-btn").w / rem, pp: rect("#mt-pp").w / rem, prev: rect("#mt-prev").w / rem, bar: rect("#mt").h / rem });
    $("#mt-prev").click();
    await window.__sleep(100);
    // the album's own buttons: under its cover in the album view (v1.9.68)
    await turnOver();
    T("acts", { underCover: !!$("#open .ov-side #actions"), kinds: Array.prototype.map.call(document.querySelectorAll("#actions [data-act]"), function (b) { return b.dataset.act; }),
                below: rect("#actions").t >= rect("#open .ov-art").b - 0.5, reach: [hit('#actions [data-act="play_now"]'), hit('#actions [data-act="queue"]')] });
    $("#actions [data-act=queue]").click();
    await window.__sleep(100);
    $("#actions [data-act=play_now]").click();
    await window.__sleep(100);
    T("posts", { control: posts("/api/control"), play: posts("/api/play").map(function (b) { return [b.kind, b.title, b.zone_or_output_id]; }) });
    // the zone moves on: now next is possible and previous is not
    window.__zone = Object.assign({}, window.__zone, { is_previous_allowed: false, is_next_allowed: true });
    await window.__sleep(4300);
    T("moved", { prev: $("#mt-prev").disabled, next: $("#mt-next").disabled });
    $("#mt-next").click();
    await window.__sleep(100);
    T("next", posts("/api/control").map(function (b) { return b.command; }));
  `, { size: "1920x1080" });
  harness.assertNoPageError(assert, r);
  await t.test("previous, play/pause and next together at the bar's start, then the record, the shelf's own, the zone and volume", () => {
    assert.deepEqual(r.order.transport, ["mt-prev", "mt-pp", "mt-next"]);
    assert.deepEqual(r.order.parts.filter((p) => p !== "mt-progress"), ["mt-transport", "mt-info", "mt-shelf", "mt-controls"]);
    assert.deepEqual(r.row, { level: true, inOrder: true });
    assert.deepEqual(r.state.labels, ["Previous track", "Next track"]);
  });
  await t.test("THE one: each is on only where the zone says it can be", () => {
    assert.deepEqual([r.state.prev, r.state.next], [false, true]);
    assert.deepEqual([r.moved.prev, r.moved.next], [true, false]);
  });
  await t.test("each sends Roon's own command to the zone in the bar", () => {
    assert.deepEqual(r.posts.control, [{ zone_or_output_id: "z1", command: "previous" }]);
    assert.deepEqual(r.next, ["previous", "next"]);
  });
  await t.test("the shelf's count, its order and Spin are in the bar (v1.9.68), and no album's buttons", () => {
    assert.deepEqual(r.shelf, { acts: false, pos: "11 of 15", order: "A → Z by artist", spin: true });
  });
  await t.test("the album's Play now and Queue are under the cover in the album view, reachable, with no Play next (v1.9.68)", () => {
    assert.deepEqual(r.acts, { underCover: true, kinds: ["play_now", "queue"], below: true, reach: [true, true] });
  });
  await t.test("they play the album in front, in the zone in the bar", () => {
    assert.deepEqual(r.posts.play, [["queue", "The Wall", "z1"], ["play_now", "The Wall", "z1"]]);
  });
  await t.test("slimmer (v1.9.68, the owner): 2.9rem buttons, a 3.3rem play/pause, the bar under 5rem tall (6 before)", () => {
    assert.ok(Math.abs(r.sizes.btn - 2.9) < 0.05 && Math.abs(r.sizes.prev - 2.9) < 0.05, JSON.stringify(r.sizes));
    assert.ok(Math.abs(r.sizes.pp - 3.3) < 0.05, JSON.stringify(r.sizes));
    assert.ok(r.sizes.bar < 5, JSON.stringify(r.sizes));
  });
});

test("3. choosing tracks: the album's buttons step aside, and come back (v1.9.10; under the cover since v1.9.68)", { skip: !harness.available }, async (t) => {
  const r = render("shelf1910-choosing", `
    noTransitions();
    await turnOver();
    var li = document.querySelector('#open li[data-i="1"]'), c = rect(li);
    // the view's own presses (v1.9.67-t5): the hold on the row itself, not the stage
    li.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 77, clientX: c.cx, clientY: c.cy, bubbles: true, pointerType: "touch", isPrimary: true }));
    await window.__sleep(650);
    li.dispatchEvent(new PointerEvent("pointerup", { pointerId: 77, clientX: c.cx, clientY: c.cy, bubbles: true, pointerType: "touch", isPrimary: true }));
    await window.__sleep(60);
    // v1.9.66: the album's buttons give their place to the tracks' (display: none, not just unseen); since v1.9.68
    // both under the cover in the album view
    function seen(s) { var cs = getComputedStyle($(s)); return cs.display === "none" ? "hidden" : cs.visibility; }
    T("on", { picks: S().picks, acts: seen(".mt-acts"), popup: !$("#tsel").classList.contains("hidden"),
              underCover: !!$("#open .ov-side #tsel") && rect("#tsel").t >= rect("#open .ov-art").b - 0.5, reach: hit('#tsel [data-tact="play_now"]'),
              transport: getComputedStyle($(".mt-transport")).visibility });
    $("#tsel-clear").click();
    await window.__sleep(100);
    T("off", { picks: S().picks, acts: seen(".mt-acts") });
  `);
  harness.assertNoPageError(assert, r);
  await t.test("a track chosen: its buttons are up, under the cover (v1.9.68; in the bar since v1.9.66), to be tapped", () => {
    assert.deepEqual(r.on.picks, [1]);
    assert.equal(r.on.popup, true);
    assert.equal(r.on.underCover, true);
    assert.equal(r.on.reach, true);
  });
  await t.test("THE one: the album's Play now and Queue are hidden meanwhile, the transport is not", () => {
    assert.equal(r.on.acts, "hidden");
    assert.equal(r.on.transport, "visible");
  });
  await t.test("the choosing ended, they are back", () => assert.deepEqual(r.off, { picks: [], acts: "visible" }));
});

// The bar is sized by the room its COLUMN has (a container query on the
// shelf), not the screen's: with the side panes open the shelf may have half
// the screen. Every part must be inside the column, reachable, and leave what
// is playing some room.
const BAR_ROOMS = [
  // A phone on its side with the choices folded: with them open the shelf has
  // no height at all (a stage 0px tall in v1.9.7 too) — not this version's.
  ["390x844", "a phone", ""], ["844x390", "a phone on its side, the choices folded", 'localStorage.setItem("rra-shelf-pick", "off");'],
  ["744x1133", "an iPad mini upright", ""], ["1366x1024", "a tablet, the choices open", ""],
  ["1180x820", "an iPad on its side, both panes open", 'localStorage.setItem("rra-shelf-queue", "on");'],
  ["1920x1080", "a TV, both panes open", 'localStorage.setItem("rra-shelf-queue", "on");'],
];
test("3. the bar fits the shelf's column at every size, panes open or not (v1.9.10)", { skip: !harness.available }, async (t) => {
  for (const [size, what, store] of BAR_ROOMS) {
    const r = render("shelf1910-bar-" + size, `
      noTransitions();
      await window.__sleep(300);
      var ids = ["#mt-prev", "#mt-pp", "#mt-next", "#mt-info", "#shelf-pos", "#spin-btn", "#mt-zone-btn", "#mt-vol-btn"];
      var col = rect("#shelf");
      T("p", { above: rect(".mt-shelf").b <= rect("#mt-pp").t + 0.5, missed: ids.filter(function (s) { return !hit(s); }),
               off: ids.filter(function (s) { var b = rect(s); return b.l < col.l - 0.5 || b.r > col.r + 0.5 || b.b > window.innerHeight + 0.5; }),
               scrolls: document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth + 1, pp: rect("#mt-pp").w / rem,
               info: rect("#mt-info").w / rem, col: col.w, queue: S().queue, bar: rect("#mt"), shelf: col, vh: window.innerHeight });
    `, { size, store });
    harness.assertNoPageError(assert, r);
    if (size === "390x844") {
      await t.test(size + ": the shelf's count, order and Spin sit on a slim row above the transport (v1.9.68)", () => assert.equal(r.p.above, true, JSON.stringify(r.p)));
    }
    // a phone either way up: hand-sized, the short screen's height left to the covers
    if (size === "390x844" || size === "844x390") {
      await t.test(size + ": sized for a hand (v1.9.68: a 2.9rem play/pause)", () => assert.ok(Math.abs(r.p.pp - 2.9) < 0.05, JSON.stringify(r.p)));
    }
    if (/queue/.test(store)) await t.test(size + ": the queue is open", () => assert.equal(r.p.queue, true));
    await t.test(size + " (" + what + "): THE one: every part of the bar is in the shelf's column, on screen, and what a tap on it reaches", () => {
      assert.deepEqual(r.p.missed, [], JSON.stringify(r.p));
      assert.deepEqual(r.p.off, [], JSON.stringify(r.p));
      assert.equal(r.p.scrolls, false);
    });
    await t.test(size + ": what is playing keeps room to be read", () => assert.ok(r.p.info >= 5, JSON.stringify(r.p)));
  }
});

// 4. "the back's track list as big as the back holds it": the list is on the
// album view since v1.9.67-t5 (dev/design/album-view.md), in the remote's rows
// at one size, and the measuring went with the list it measured.

test("5. a calmer swipe: a finger goes 1.4 times as far for one album (v1.9.10)", { skip: !harness.available }, async (t) => {
  const r = render("shelf1910-swipe", `
    noTransitions();
    await idle();
    // One album's distance worked out from the case's size (the spines, the one look since v1.9.68: a step is 0.24
    // of it, at least 52px), not read back from the page, so a page whose finger distance is wrong cannot set the
    // yardstick it is measured with.
    var Sv = parseFloat(getComputedStyle(stage).getPropertyValue("--S"));
    var st = S(), step = Math.max(52, Sv * 0.24) * 1.4, p0 = Math.round(st.p);
    var b = rect(stage), y = b.t + b.h * 0.4, x0 = b.cx + step / 2, id = ++pid;
    // one cover's old step: no longer a whole album
    pe("pointerdown", x0, y, id);
    for (var k = 1; k <= 12; k++) { await window.__sleep(40); pe("pointermove", x0 - (step / 1.4) * k / 12, y, id); }
    var mid = S().p - p0;
    // the rest of the way to one album, slowly, then let go
    for (var k = 1; k <= 12; k++) { await window.__sleep(40); pe("pointermove", x0 - (step / 1.4) - (step - step / 1.4) * k / 12, y, id); }
    var full = S().p - p0;
    // still long enough that the lift carries no speed (80 ms), not so long
    // that a held-out finger starts turning the shelf (200 ms)
    await window.__sleep(120);
    pe("pointerup", x0 - step, y, id);
    await idle();
    T("s", { mid: mid, full: full, landed: Math.round(S().p) - p0, mode: S().mode, look: S().look });
  `);
  harness.assertNoPageError(assert, r);
  await t.test("THE one: the old one-album distance moves the shelf about 0.71 of an album", () => {
    assert.equal(r.s.look, "spines");
    assert.ok(Math.abs(r.s.mid - 1 / 1.4) < 0.05, JSON.stringify(r.s));
  });
  await t.test("1.4 of the old distance moves it one album, and it lands there", () => {
    assert.ok(Math.abs(r.s.full - 1) < 0.05, JSON.stringify(r.s));
    assert.equal(r.s.landed, 1);
  });
});

test("6. the volume slider is filled to the level (v1.9.10)", { skip: !harness.available }, async (t) => {
  const r = render("shelf1910-vol", `
    noTransitions();
    await window.__sleep(300);
    $("#mt-vol-btn").click();
    await window.__sleep(100);
    var s = $("#vol-slider");
    T("open", { fill: s.style.getPropertyValue("--fill"), max: s.max, shown: !$("#vol").classList.contains("hidden"),
                aboveBar: rect("#vol").b <= rect("#mt").t + 0.5 });
    $("#vol-plus").click();
    await window.__sleep(100);
    T("up", { fill: s.style.getPropertyValue("--fill"), sent: posts("/api/volume").map(function (b) { return b.value; }) });
  `);
  harness.assertNoPageError(assert, r);
  await t.test("20 of a 0–80 range is a quarter full, and the sheet sits above the bar", () => {
    assert.deepEqual(r.open, { fill: "25.0%", max: "80", shown: true, aboveBar: true });
  });
  await t.test("a step moves the fill with it, and the step is sent", () => {
    assert.deepEqual(r.up, { fill: "26.3%", sent: [21] });
  });
});

test("6. a dB volume (-80 to 0) is filled by its own range, not as though 0 were missing (v1.9.10)", { skip: !harness.available }, async (t) => {
  const dB = Object.assign({}, ZONE, { outputs: [{ output_id: "o1", display_name: "Lounge", volume: { type: "db", min: -80, max: 0, value: -20, step: 1 } }] });
  const r = render("shelf1910-vol-db", `
    noTransitions();
    await window.__sleep(300);
    $("#mt-vol-btn").click();
    await window.__sleep(100);
    T("db", { fill: $("#vol-slider").style.getPropertyValue("--fill"), min: $("#vol-slider").min, max: $("#vol-slider").max });
  `, { zone: dB });
  harness.assertNoPageError(assert, r);
  await t.test("THE one: -20 of -80 to 0 is three quarters full", () => assert.deepEqual(r.db, { fill: "75.0%", min: "-80", max: "0" }));
});

test("1. a chosen decade the library no longer has is let go when it is read again (v1.9.10)", { skip: !harness.available }, async (t) => {
  // Both undated albums are given years by a sync: "Undated" has no tile any
  // more, so it must not go on filtering the shelf to nothing.
  const DATED = buildShelf(
    RECORDS.map(([artist, title, g], i) => ({ offset: 100 + i, title, subtitle: artist, image_key: "k" + i, g })),
    { genresOf: (al) => [al.g], firstOf: (al) => al.subtitle.toLowerCase(), yearOf: (al) => YEAR.get(al.offset) || 2003 });
  const r = render("shelf1910-decade-gone", `
    noTransitions();
    tabTo("year");
    tile("year", "none").click();
    T("before", { N: S().N, badge: $('.tab[data-tab="year"] .badge').textContent });
    window.__ans = ${JSON.stringify(ANSWER(DATED))};
    window.__rev = "1.1";
    document.dispatchEvent(new Event("visibilitychange"));
    for (var k = 0; k < 40 && $('.tile[data-cat="year"][data-id="none"]'); k++) await window.__sleep(100);
    await window.__sleep(200);
    T("after", { N: S().N, badge: $('.tab[data-tab="year"] .badge').textContent, undatedTile: !!tile("year", "none"),
                 chips: document.querySelectorAll("#chips .chip").length, twoThousands: tile("year", "2000").querySelector(".t-count").textContent });
  `);
  harness.assertNoPageError(assert, r);
  await t.test("before: Undated is chosen, two albums", () => assert.deepEqual(r.before, { N: 2, badge: "1" }));
  await t.test("THE one: after, it is no longer chosen, and the whole library is back", () => {
    assert.deepEqual(r.after, { N: 15, badge: "", undatedTile: false, chips: 0, twoThousands: "4" });
  });
});
