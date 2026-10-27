"use strict";
// ---------------------------------------------------------------------------
// v1.9.66: the Spines look, as the owner asked on 2026-10-22.
//
//   1. "When swiping you see the spines of the other albums through the ones
//      part way through the transition stage. I want that to not happen."
//      Every case stood in one 3D scene, so a case half turned — its cover
//      swung back past the plane the spines stand in — was cut by its
//      neighbours' spines where they stood in front of it. Now the cases are
//      drawn one over another, the nearer the front the higher, so a case
//      turning is whole over the spines beside it.
//   2. "The album details under the shelf, above the transport bar, let's
//      remove them … and enlarge the shelf to take up more room": no title,
//      artist or genres under the shelf; the stage reaches the bar. The tracks
//      chosen on the back of a case, whose popup stood over the album's name,
//      have their buttons in the bar instead (the owner's choice), in the
//      place of the album's own: the bar and the shelf keep their size, and
//      play/pause, next, the zone and volume stay reachable.
// The paint order is seen only in a screenshot (harness.js, opts.screenshot):
// the fronts painted green, the spines red, and one row across the cases —
// found in the image itself — read out of it: every position from the one
// source (dev/lessons.md).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");
const { buildShelf, shelfSignature } = require("../../lib/shelf");
const { decodePng, pixel } = require("../../lib/png");

const RECORDS = [
  ["Abba", "Arrival", "Pop"], ["Air", "Moon Safari", "Electronic"], ["Bill Evans", "Waltz for Debby", "Jazz"],
  ["Burial", "Untrue", "Electronic"], ["Coltrane", "Blue Train", "Jazz"], ["Daft Punk", "Discovery", "Electronic"],
  ["Fleetwood Mac", "Rumours", "Pop"], ["Kraftwerk", "Trans-Europe Express", "Electronic"], ["Massive Attack", "Mezzanine", "Electronic"],
  ["Miles Davis", "Kind of Blue", "Jazz"], ["Pink Floyd", "The Wall", "Pop"], ["Portishead", "Dummy", "Electronic"],
  ["Sade", "Diamond Life", "Pop"], ["Tape Box", "Untitled Demos", "Electronic"], ["Zeta", "Bootleg", "Jazz"],
];
const SHELF = buildShelf(RECORDS.map(([artist, title, g], i) => ({ offset: 100 + i, title, subtitle: artist, image_key: "k" + i, g })),
  { genresOf: (al) => [al.g], firstOf: (al) => al.subtitle.toLowerCase() });
const ANSWER = Object.assign({ total: SHELF.albums.length, rev: "1.0", sig: shelfSignature(SHELF) }, SHELF);
const ZONE = { zone_id: "z1", display_name: "Lounge", state: "paused", queue_items_remaining: 0,
  outputs: [{ output_id: "o1", display_name: "Lounge", volume: { type: "number", min: 0, max: 80, value: 20, step: 1 } }],
  // a long title: what is playing must give way to the chosen tracks' buttons in a one-row bar, not squeeze them
  now_playing: { line1: "Hey You (Live at Earls Court, London, 1980 — the full uncut performance, remastered)", line2: "Pink Floyd with the Surrogate Band",
    line3: "The Wall", image_key: "k10", length: 280, seek_position: 30 } };

const stub = (look, pickOff) => `
window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(performance.now()); }, 16); };
window.cancelAnimationFrame = function (id) { clearTimeout(id); };
try { localStorage.clear(); localStorage.setItem("rra-zone", "z1"); localStorage.setItem("rra-shelf-look", "${look}");
      localStorage.setItem("rra-shelf-help", JSON.stringify({ seen: "1.9.66-t2", never: true }));
      ${pickOff ? 'localStorage.setItem("rra-shelf-pick", "off");' : ""} } catch (e) { /* always there here */ }
window.__installFetch(function (u) {
  if (u.indexOf("/api/shelf/albums") > -1) return window.__json(${JSON.stringify(ANSWER)});
  if (u.indexOf("/api/update/status") > -1) return window.__json({ current: "1.9.66-t2" });
  if (u.indexOf("/api/live") > -1) return window.__json({ rev: { library: "1.0", settings: "1" } });
  if (u.indexOf("/api/settings/display") > -1) return window.__json({ enabled: false });
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [{ zone_id: "z1", display_name: "Lounge", state: "paused" }] });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (u.indexOf("/api/queue?") > -1) return window.__json({ items: [], history: [] });
  if (u.indexOf("/api/album?") > -1) return window.__json({ tracks: [{ title: "Hey You" }], discs: null });
  return undefined;
});
`;

const DRIVE = `
  var S = function () { return window.__shelfState(); };
  for (var i = 0; i < 80 && !(S() && S().N); i++) await window.__sleep(100);
  await window.__sleep(900);
  var stage = document.getElementById("stage");
  function $(s) { return document.querySelector(s); }
  function rect(el) { var b = $(el).getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; }
  function pe(type, x, y) { stage.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x, clientY: y, bubbles: true, pointerType: "touch", isPrimary: true })); }
`;

const SIZES = [["tablet", "1366x1024"], ["phone", "390x844"]];

for (const [size, windowSize] of SIZES) {
  test(`1. ${size}: a case half turned is whole over the spines beside it (v1.9.66)`, { skip: !harness.available }, async (t) => {
    const r = harness.renderPage({ name: "shelf1966-turn-" + size, page: "shelf", windowSize, budgetMs: 30000, screenshot: true, stub: stub("spines"),
      driver: DRIVE + `
      var st = document.createElement("style");
      st.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}"
        + ".front,.front *{background:#00ff00!important;color:transparent!important;box-shadow:none!important;border-color:transparent!important}.front img{display:none!important}"
        + ".side,.side *{background:#ff0000!important;color:transparent!important;box-shadow:none!important;border-color:transparent!important}"
        + ".ledge,.floor,.shuttle{display:none!important}";
      document.head.appendChild(st);
      // A finger down on the shelf and half an album along, held there: the
      // shelf stands still between two albums, each case half turned.
      var b = rect("#stage"), x = b.l + b.w / 2, y = b.t + b.h / 2, p0 = S().p;
      pe("pointerdown", x, y);
      for (var k = 1; k <= 6; k++) { pe("pointermove", x - (S().swipe / 2) * k / 6, y); await window.__sleep(30); }
      await window.__sleep(800);
      T("held", { p: S().p - p0, mode: S().mode, look: S().look });
    ` });
    harness.assertNoPageError(assert, r);
    const h = r.held;
    await t.test("precondition: the Spines look, held half way between two albums", () => {
      assert.equal(h.look, "spines");
      assert.equal(h.mode, "drag");
      assert.ok(Math.abs(h.p - 0.5) < 0.02, "held at " + h.p);
    });
    await t.test("THE one: across the cases, no spine shows between the two half-turned covers", () => {
      const img = decodePng(r.__png);
      const green = (q) => q[1] > 180 && q[0] < 90 && q[2] < 90;
      const red = (q) => q[0] > 180 && q[1] < 90 && q[2] < 90;
      const xs = Array.from({ length: img.width }, (_, x) => x);
      // the row with the most cover on it: through the middle of the cases
      let y = 0, most = 0;
      for (let row = 0; row < img.height; row++) {
        const n = xs.filter((x) => green(pixel(img, x, row))).length;
        if (n > most) { most = n; y = row; }
      }
      const greens = xs.filter((x) => green(pixel(img, x, y)));
      assert.ok(greens.length > img.width * 0.2, `only ${greens.length}px of cover on the row: the covers did not draw`);
      assert.ok(xs.some((x) => red(pixel(img, x, y))), "no spine on the row: the spines did not draw");
      const from = greens[0], to = greens[greens.length - 1];
      const through = xs.filter((x) => x > from && x < to && red(pixel(img, x, y)));
      assert.ok(through.length <= 2, `${through.length}px of spine show through the turning covers, between x ${from} and ${to}`);
    });
  });
}

// Three ways: a tablet with the choices folded, with them open, and a phone. The chosen tracks' buttons were in the
// bar from v1.9.66; since v1.9.68 they are under the cover in the album view, with the album's own (the owner).
const BARS = [["one row", "1366x1024", true], ["two rows", "1366x1024", false], ["phone", "390x844", true]];

for (const [size, windowSize, pickOff] of BARS) {
  test(`2. ${size}: no album details under the shelf, and chosen tracks played from under the cover (v1.9.66, v1.9.68)`, { skip: !harness.available }, async (t) => {
    const r = harness.renderPage({ name: "shelf1966-bar-" + size.replace(" ", "-"), page: "shelf", windowSize, budgetMs: 30000, stub: stub("spines", pickOff),
      driver: DRIVE + `
      var st = document.createElement("style");
      st.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}";
      document.head.appendChild(st);
      function on(s) { var b = $(s).getBoundingClientRect(), top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!top && $(s).contains(top); }
      T("room", { details: document.querySelectorAll("#info, #info-title, #info-artist, #info-meta, .info-tbox").length,
        stage: rect("#stage"), bar: rect("#mt") });
      // a track chosen on the album view (v1.9.67-t5; the back of the case before): a tap turns the case over, a long press chooses
      var c = $('.it[data-v="' + Math.round(S().p) + '"]').getBoundingClientRect();
      pe("pointerdown", c.left + c.width / 2, c.top + c.height / 2); pe("pointerup", c.left + c.width / 2, c.top + c.height / 2);
      await window.__sleep(1300);
      var rowEl = $("#open .bk-t"), row = rowEl.getBoundingClientRect(), x = row.left + 20, y = row.top + row.height / 2;
      function pr(type) { rowEl.dispatchEvent(new PointerEvent(type, { pointerId: 9, clientX: x, clientY: y, bubbles: true, pointerType: "touch", isPrimary: true })); }
      pr("pointerdown"); await window.__sleep(700); pr("pointerup"); await window.__sleep(200);
      T("chosen", { picks: S().picks, shown: !$("#tsel").classList.contains("hidden"), count: $("#tsel-count").textContent,
        tsel: rect("#tsel"), bar: rect("#mt"), stage: rect("#stage"), acts: getComputedStyle($(".mt-acts")).display,
        // the cover's column; on a phone the view is one column (the side is display: contents, no box of its own)
        side: rect("#open .ov-side").w ? rect("#open .ov-side") : rect("#open-body"), art: rect("#open .ov-art"),
        buttons: Array.prototype.map.call(document.querySelectorAll("#tsel button"), function (b) { var q = b.getBoundingClientRect(); return { l: q.left, r: q.right, t: q.top, b: q.bottom }; }),
        others: ["#mt-prev", "#mt-pp", "#mt-next", "#mt-zone-btn", "#mt-vol-btn"].map(rect),
        reach: { pp: on("#mt-pp"), next: on("#mt-next"), zone: on("#mt-zone-btn"), vol: on("#mt-vol-btn"),
          now: on('#tsel [data-tact="play_now"]'), nxt: on('#tsel [data-tact="play_next"]'), queue: on('#tsel [data-tact="queue"]'), x: on("#tsel-clear") } });
    ` });
    harness.assertNoPageError(assert, r);
    const { room, chosen } = r;
    await t.test("no title, artist or genres", () => assert.equal(room.details, 0));
    await t.test("THE one: the stage reaches the bar, with nothing between", () => {
      assert.ok(Math.abs(room.bar.t - room.stage.b) <= 1, `the stage ends at ${room.stage.b}, the bar starts at ${room.bar.t}`);
    });
    await t.test("a track chosen: its buttons are under the cover, in the album's buttons' place (v1.9.68)", () => {
      assert.deepEqual([chosen.picks, chosen.shown, chosen.count, chosen.acts], [[0], true, "1 track chosen", "none"]);
      const { tsel, side, art } = chosen;
      assert.ok(tsel.l >= side.l - 0.5 && tsel.r <= side.r + 0.5 && tsel.t >= art.b - 0.5, `the buttons ${JSON.stringify(tsel)} are not under the cover ${JSON.stringify(art)}`);
      for (const b of chosen.buttons) assert.ok(b.l >= side.l - 0.5 && b.r <= side.r + 0.5, `a button runs out of the cover's column: ${JSON.stringify(b)}`);
      const over = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
      chosen.buttons.forEach((b, i) => chosen.buttons.slice(i + 1).forEach((o) => assert.ok(!over(b, o), `two buttons overlap: ${JSON.stringify([b, o])}`)));
      for (const b of chosen.buttons) for (const o of chosen.others) assert.ok(!over(b, o), `a button ${JSON.stringify(b)} runs over the bar's own ${JSON.stringify(o)}`);
    });
    await t.test("THE one: the bar and the shelf keep their size, and every control is still there to tap", () => {
      assert.ok(Math.abs(chosen.bar.h - room.bar.h) <= 0.5, `the bar went from ${room.bar.h} to ${chosen.bar.h}`);
      assert.ok(Math.abs(chosen.stage.h - room.stage.h) <= 0.5, `the shelf went from ${room.stage.h} to ${chosen.stage.h}`);
      assert.deepEqual(chosen.reach, { pp: true, next: true, zone: true, vol: true, now: true, nxt: true, queue: true, x: true });
    });
  });
}
