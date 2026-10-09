"use strict";
// ---------------------------------------------------------------------------
// v1.9.4: choosing tracks on the back of the case.
//
// Asked: "select tracks from the rear cover". A single tap on the back turns
// the case over again, so choosing is a LONG press on a track: its number
// becomes a tick, a tap adds more (or takes one away), and a popup under the
// cover offers Play now, Play next and Queue. And: "verify that multi-disc
// albums have each disc individually listed" — they were not; each disc now
// has its own heading, numbered from 1.
//
// Also, because choosing needs every track within reach: a list too long for
// the back used to lose its tail off the bottom of the case. Now the rest
// unfolds below the case as a booklet (the user's design), with more pages for
// a box set. And for a mouse: Ctrl/⌘-click and Shift-click.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");
const { buildShelf, shelfSignature } = require("../../lib/shelf");

const RECORDS = [
  ["Air", "Moon Safari"], ["Burial", "Untrue"], ["Daft Punk", "Discovery"], ["Kraftwerk", "Trans-Europe Express"],
  ["Massive Attack", "Mezzanine"], ["Pink Floyd", "The Wall"], ["Portishead", "Dummy"], ["Radiohead", "Kid A"],
];
const SHELF = buildShelf(
  RECORDS.map(([artist, title], i) => ({ offset: 100 + i, title, subtitle: artist, image_key: "k" + i })),
  { genresOf: () => ["Rock"], firstOf: (al) => al.subtitle.toLowerCase() });
const ANSWER = Object.assign({ total: SHELF.albums.length, rev: "1.0", sig: shelfSignature(SHELF) }, SHELF);
const ZONES = [{ zone_id: "z1", display_name: "Living Room", state: "paused" }];
// Opens on the record playing: The Wall.
const ZONE = { zone_id: "z1", display_name: "Living Room", state: "paused",
  outputs: [{ output_id: "o1", display_name: "Living Room", volume: { type: "number", min: 0, max: 100, value: 40, step: 1 } }],
  now_playing: { line1: "Hey You", line2: "Pink Floyd", line3: "The Wall", image_key: "k5", length: 280, seek_position: 0 } };

// A double album: two discs, as the server now says (lib/discs.js).
const WALL = {
  tracks: [
    { title: "In the Flesh?", disc: 1 }, { title: "The Thin Ice", disc: 1 }, { title: "Another Brick in the Wall, Part 1", disc: 1 },
    { title: "Hey You", disc: 2 }, { title: "Is There Anybody Out There?", disc: 2 },
  ],
  discs: ["Disc 1", "Disc 2"],
};
// A box set: four discs of thirty, too long even for one booklet page.
const BOX = {
  tracks: Array.from({ length: 120 }, (_, i) => ({ title: "Box track " + (i + 1), disc: 1 + Math.floor(i / 30) })),
  discs: ["Disc 1", "Disc 2", "Disc 3", "Disc 4"],
};
// A double album too long for the back: two discs of twenty.
const LONG = {
  tracks: Array.from({ length: 40 }, (_, i) => ({ title: "Track " + (i + 1) + " of the set", disc: i < 20 ? 1 : 2 })),
  discs: ["Disc 1", "Disc 2"],
};

const stub = (album, opts) => `
window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(performance.now()); }, 16); };
window.cancelAnimationFrame = function (id) { clearTimeout(id); };
window.__posts = [];
try { localStorage.clear(); localStorage.setItem("rra-zone", "z1");
      localStorage.setItem("rra-shelf-help", JSON.stringify({ seen: "1.9.4", never: true })); } catch (e) { /* always there here */ }
window.__installFetch(function (u, o) {
  if (o && o.method === "POST") window.__posts.push({ url: u, body: JSON.parse(o.body) });
  if (u.indexOf("/api/shelf/albums") > -1) return window.__json(${JSON.stringify(ANSWER)});
  if (u.indexOf("/api/update/status") > -1) return window.__json({ current: "1.9.4" });
  if (u.indexOf("/api/live") > -1) return window.__json({ rev: { library: "1.0", settings: "1" } });
  if (u.indexOf("/api/settings/display") > -1) return window.__json({ enabled: false });
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: ${opts && opts.zonesLater ? "window.__zonesReady ? " + JSON.stringify(ZONES) + " : []" : JSON.stringify(ZONES)} });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (u.indexOf("/api/album?") > -1) ${opts && opts.slowAlbum ? "return new Promise(function (res) { setTimeout(function () { res(window.__json(" + JSON.stringify(album) + ")); }, " + opts.slowAlbum + "); });" : "return window.__json(" + JSON.stringify(album) + ");"}
  if (u.indexOf("/api/play-track") > -1) {
    ${opts && opts.stale ? 'return window.__json({ error: "track list changed" }, 409);' : ""}
    ${opts && opts.slowPlay ? "return new Promise(function (res) { setTimeout(function () { res(window.__json({ ok: true })); }, " + opts.slowPlay + "); });" : "return window.__json({ ok: true });"}
  }
  if (u.indexOf("/api/play") > -1) return window.__json({ ok: true });
  return undefined;
});
`;

// Pointer events on the stage, as a finger sends them.
const DRIVE = `
  var S = function () { return window.__shelfState(); };
  for (var i = 0; i < 80 && !(S() && S().N); i++) await window.__sleep(100);
  await window.__sleep(900);
  var stage = document.getElementById("stage");
  var pid = 20;
  function pe(type, x, y, id) { stage.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: "touch", isPrimary: true })); }
  function tap(x, y) { var id = ++pid; pe("pointerdown", x, y, id); pe("pointerup", x, y, id); }
  async function hold(x, y) { var id = ++pid; pe("pointerdown", x, y, id); await window.__sleep(650); pe("pointerup", x, y, id); await window.__sleep(60); }
  async function slide(x, y, dx, dy) { var id = ++pid; pe("pointerdown", x, y, id); for (var k = 1; k <= 6; k++) { pe("pointermove", x + dx * k / 6, y + dy * k / 6, id); await window.__sleep(16); } pe("pointerup", x + dx, y + dy, id); await window.__sleep(80); }
  function mid(el) { var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  function front() { return document.querySelector('.it[data-v="' + Math.round(S().p) + '"]'); }
  async function turnOver() { var c = mid(front()); tap(c.x, c.y); await window.__sleep(1300); }
  function row(i) { return document.querySelector('.it.flipped li[data-i="' + i + '"]'); }
  async function tapRow(i) { var c = mid(row(i)); tap(c.x, c.y); await window.__sleep(60); }
  async function holdRow(i) { var c = mid(row(i)); await hold(c.x, c.y); }
  function rows() { return Array.prototype.map.call(document.querySelectorAll(".it.flipped .bk-tracks li"), function (li) {
    return li.classList.contains("bk-disc") ? "# " + li.textContent : (li.classList.contains("sel") ? "✓" : li.querySelector("i").textContent) + " " + li.querySelector("span").textContent; }); }
  var shown = function (sel) { var el = document.querySelector(sel); return !!el && !el.classList.contains("hidden"); };
  function picks() { return S().picks; }
  function flipped() { return !!document.querySelector(".it.flipped"); }
  function trackPosts() { return window.__posts.filter(function (x) { return x.url.indexOf("/api/play-track") > -1; }).map(function (x) { return x.body; }); }
  // the booklet: its case, its page label, the tracks on the back and on the page shown
  function booklet() { var el = document.querySelector(".it.flipped.booklet"); return el; }
  function idsIn(sel) { return Array.prototype.map.call(document.querySelectorAll(".it.flipped " + sel + " li[data-i]"), function (li) { return +li.dataset.i; }); }
  function pageLabel() { var b = document.querySelector(".it.flipped .bkl-page"); return b ? b.textContent : null; }
  function fits(ol) { return !!ol && ol.scrollHeight <= ol.clientHeight + 1 && ol.scrollWidth <= ol.clientWidth + 1; }
  function noTransitions() { var st = document.createElement("style"); st.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}"; document.head.appendChild(st); }
  // a mouse: left button, with Ctrl/⌘/Shift if asked
  function click(i, mods) { var c = mid(row(i)), id = ++pid; mods = mods || {};
    var o = { pointerId: id, clientX: c.x, clientY: c.y, bubbles: true, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1,
              ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, shiftKey: !!mods.shift };
    stage.dispatchEvent(new PointerEvent("pointerdown", o)); o.buttons = 0; stage.dispatchEvent(new PointerEvent("pointerup", o)); }
`;

function render(name, album, driver, opts) {
  return harness.renderPage({ name, page: "shelf", windowSize: "1366x1024", budgetMs: 40000, stub: stub(album, opts), driver: DRIVE + driver });
}

test("a double album lists each disc under its own heading (v1.9.4)", { skip: !harness.available }, async (t) => {
  const r = render("shelf194-discs", WALL, `
    T("front", S().title);
    await turnOver();
    T("rows", rows());
  `);
  harness.assertNoPageError(assert, r);
  await t.test("it opened on the record playing", () => assert.equal(r.front, "The Wall"));
  await t.test("THE one: Disc 1 and Disc 2, each numbered from 1", () => {
    assert.deepEqual(r.rows, ["# Disc 1", "1 In the Flesh?", "2 The Thin Ice", "3 Another Brick in the Wall, Part 1",
                              "# Disc 2", "1 Hey You", "2 Is There Anybody Out There?"]);
  });
});

test("an album on one disc is drawn as it always was (v1.9.4)", { skip: !harness.available }, async (t) => {
  const r = render("shelf194-onedisc", { tracks: [{ title: "Angel" }, { title: "Risingson" }], discs: null }, `
    await turnOver();
    T("rows", rows());
  `);
  harness.assertNoPageError(assert, r);
  await t.test("no heading, numbered 1…N", () => assert.deepEqual(r.rows, ["1 Angel", "2 Risingson"]));
});

test("choosing tracks on the back of the case (v1.9.4)", { skip: !harness.available }, async (t) => {
  const r = render("shelf194-choose", WALL, `
    await turnOver();
    // a tap on a track while nothing is chosen still turns the case back
    await tapRow(1);
    await window.__sleep(900);
    T("tap_turns_back", { flipped: flipped(), picks: picks() });
    await turnOver();
    var box0 = { info: document.getElementById("info").getBoundingClientRect().height, stage: stage.getBoundingClientRect().height };
    await holdRow(1);
    T("held", { flipped: flipped(), picks: picks(), rows: rows(), popup: shown("#tsel"),
                count: document.getElementById("tsel-count").textContent,
                tick: !!(row(1) && row(1).querySelector("i svg")),
                albumButtons: getComputedStyle(document.getElementById("actions")).visibility,
                sameInfo: document.getElementById("info").getBoundingClientRect().height === box0.info,
                sameStage: stage.getBoundingClientRect().height === box0.stage });
    await tapRow(3);
    T("added", { picks: picks(), count: document.getElementById("tsel-count").textContent, flipped: flipped() });
    await tapRow(1);
    T("removed", { picks: picks(), rows: rows() });
    await tapRow(3);
    T("last_gone", { picks: picks(), popup: shown("#tsel"), flipped: flipped(), rows: rows() });
  `);
  harness.assertNoPageError(assert, r);
  await t.test("a single tap on the back still turns the case over again — nothing chosen", () => {
    assert.deepEqual(r.tap_turns_back, { flipped: false, picks: [] });
  });
  await t.test("THE one: a long press chooses the track — its number is a tick, and the case stays turned over", () => {
    assert.equal(r.held.flipped, true);
    assert.deepEqual(r.held.picks, [1]);
    assert.equal(r.held.tick, true);
    assert.equal(r.held.rows[2], "✓ The Thin Ice");
    assert.equal(r.held.rows[1], "1 In the Flesh?");
  });
  await t.test("the popup under the cover says what is chosen", () => {
    assert.equal(r.held.popup, true);
    assert.equal(r.held.count, "1 track chosen");
  });
  await t.test("the album's own buttons step aside — hidden, keeping their room, so the shelf does not move", () => {
    assert.equal(r.held.albumButtons, "hidden");
    assert.equal(r.held.sameInfo, true, "the info area changed height");
    assert.equal(r.held.sameStage, true, "the shelf changed height");
  });
  await t.test("a tap then adds another", () => {
    assert.deepEqual(r.added.picks, [1, 3]);
    assert.equal(r.added.count, "2 tracks chosen");
    assert.equal(r.added.flipped, true);
  });
  await t.test("a tap on a chosen one takes it away, and its number comes back", () => {
    assert.deepEqual(r.removed.picks, [3]);
    assert.equal(r.removed.rows[2], "2 The Thin Ice");
  });
  await t.test("taking the last away ends the choosing; the case stays turned over", () => {
    assert.deepEqual(r.last_gone.picks, []);
    assert.equal(r.last_gone.popup, false);
    assert.equal(r.last_gone.flipped, true);
    assert.equal(r.last_gone.rows[5], "1 Hey You");
  });
});

test("Play now, Play next and Queue send the chosen tracks as the remote does (v1.9.4)", { skip: !harness.available }, async (t) => {
  const r = render("shelf194-play", WALL, `
    await turnOver();
    await holdRow(0); await tapRow(2); await tapRow(3);
    document.querySelector('#tsel [data-tact="play_next"]').click();
    await window.__sleep(400);
    T("next", { posts: trackPosts(), picks: picks(), popup: shown("#tsel"), ticks: document.querySelectorAll(".it.flipped li.sel").length,
                toast: document.getElementById("toast").textContent });
    window.__posts.length = 0;
    await holdRow(1); await tapRow(4);
    document.querySelector('#tsel [data-tact="play_now"]').click();
    await window.__sleep(400);
    T("now", trackPosts());
    window.__posts.length = 0;
    await holdRow(4); await tapRow(0);
    document.querySelector('#tsel [data-tact="queue"]').click();
    await window.__sleep(400);
    T("queue", { posts: trackPosts(), toast: document.getElementById("toast").textContent });
  `);
  harness.assertNoPageError(assert, r);
  const brief = (posts) => posts.map((b) => b.track + ":" + b.kind + ":" + b.title);
  await t.test("THE one: Play next sends them last to first, so they land in album order", () => {
    assert.deepEqual(brief(r.next.posts), ["3:play_next:Hey You", "2:play_next:Another Brick in the Wall, Part 1", "0:play_next:In the Flesh?"]);
  });
  await t.test("each names the album, the zone and the place on the back /api/album gave it", () => {
    for (const b of r.next.posts) {
      assert.equal(b.offset, 105);
      assert.equal(b.album_title, "The Wall");
      assert.equal(b.album_subtitle, "Pink Floyd");
      assert.equal(b.zone_or_output_id, "z1");
    }
  });
  await t.test("then the choice is done: no ticks, no popup", () => {
    assert.deepEqual(r.next.picks, []);
    assert.equal(r.next.popup, false);
    assert.equal(r.next.ticks, 0);
    assert.match(r.next.toast, /3 tracks play next in Living Room/);
  });
  await t.test("Play now plays the first and queues the rest behind it, in album order", () => {
    assert.deepEqual(brief(r.now), ["1:play_now:The Thin Ice", "4:queue:Is There Anybody Out There?"]);
  });
  await t.test("Queue adds them in album order, whatever order they were chosen in", () => {
    assert.deepEqual(brief(r.queue.posts), ["0:queue:In the Flesh?", "4:queue:Is There Anybody Out There?"]);
    assert.match(r.queue.toast, /2 tracks added to the queue/);
  });
});

test("the choosing ends when the case is turned back or the shelf moves (v1.9.4)", { skip: !harness.available }, async (t) => {
  const r = render("shelf194-end", WALL, `
    await turnOver();
    await holdRow(0);
    var ti = mid(document.querySelector(".it.flipped .bk-ti"));
    tap(ti.x, ti.y);
    await window.__sleep(900);
    T("turned_back", { flipped: flipped(), picks: picks(), popup: shown("#tsel") });
    await turnOver();
    await holdRow(2);
    var p0 = S().p;
    var c = mid(stage);
    // fast enough to be a flick: it spins, and lands three seconds later
    await slide(c.x, c.y, -300, 0);
    await window.__sleep(3800);
    T("moved", { picks: picks(), popup: shown("#tsel"), moved: S().p !== p0 });
    await turnOver();
    await holdRow(0);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await window.__sleep(60);
    T("escape", { picks: picks(), flipped: flipped() });
    await holdRow(0);
    document.getElementById("tsel-clear").click();
    T("cleared", { picks: picks(), popup: shown("#tsel") });
  `);
  harness.assertNoPageError(assert, r);
  await t.test("a tap on the back away from the tracks turns it back, and ends the choosing", () => {
    assert.deepEqual(r.turned_back, { flipped: false, picks: [], popup: false });
  });
  await t.test("swiping to another album ends it: what is chosen is always the album at the front", () => {
    assert.equal(r.moved.moved, true);
    assert.deepEqual(r.moved.picks, []);
    assert.equal(r.moved.popup, false);
  });
  await t.test("Escape clears it and leaves the case turned over", () => {
    assert.deepEqual(r.escape, { picks: [], flipped: true });
  });
  await t.test("so does the popup's ×", () => assert.deepEqual(r.cleared, { picks: [], popup: false }));
});

test("a finger that slides after its long press does not turn the case away (v1.9.4)", { skip: !harness.available }, async (t) => {
  const r = render("shelf194-pressslide", WALL, `
    await turnOver();
    var c = mid(row(1)), id = ++pid, p0 = S().p;
    pe("pointerdown", c.x, c.y, id);
    await window.__sleep(650);
    for (var k = 1; k <= 10; k++) { pe("pointermove", c.x - 30 * k, c.y, id); await window.__sleep(40); }
    pe("pointerup", c.x - 300, c.y, id);
    await window.__sleep(900);
    T("after", { flipped: flipped(), picks: picks(), still: S().p === p0 });
  `);
  harness.assertNoPageError(assert, r);
  await t.test("the track stays chosen, the case turned over, the shelf where it was", () => {
    assert.deepEqual(r.after, { flipped: true, picks: [1], still: true });
  });
});

test("a press that slides up or down does not turn the case back (v1.9.4)", { skip: !harness.available }, async (t) => {
  const r = render("shelf194-slide", WALL, `
    await turnOver();
    var c = mid(row(1));
    await slide(c.x, c.y, 0, 60);
    await window.__sleep(900);
    T("after", { flipped: flipped(), picks: picks() });
  `);
  harness.assertNoPageError(assert, r);
  await t.test("still turned over, nothing chosen", () => assert.deepEqual(r.after, { flipped: true, picks: [] }));
});

test("a list too long for the back unfolds into a booklet below the case (v1.9.4)", { skip: !harness.available }, async (t) => {
  const r = render("shelf194-booklet", LONG, `
    noTransitions();
    await turnOver();
    await window.__sleep(200);
    var el = booklet(), backOl = document.querySelector(".it.flipped .bk .bk-tracks"), bookOl = document.querySelector(".it.flipped .bkl .bk-tracks");
    var sb = stage.getBoundingClientRect(), cb = document.querySelector(".it.flipped .back").getBoundingClientRect(), bb = el ? el.querySelector(".bkl").getBoundingClientRect() : null;
    T("open", { booklet: !!el, back: idsIn(".bk"), book: idsIn(".bkl"), fitsBack: fits(backOl), fitsBook: fits(bookOl),
                lead: bookOl && bookOl.firstElementChild ? bookOl.firstElementChild.textContent : null,
                nav: el ? getComputedStyle(el.querySelector(".bkl-nav")).visibility : null,
                lifted: document.getElementById("scene").style.transform !== "",
                inside: !!bb && cb.top >= sb.top - 1 && bb.bottom <= sb.bottom + 1, below: !!bb && bb.top >= cb.bottom - 2 });
    await holdRow(37);
    T("chose_in_booklet", { picks: picks(), tick: !!(row(37) && row(37).classList.contains("sel")) });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    var ti = mid(document.querySelector(".it.flipped .bk-ti")); tap(ti.x, ti.y);
    await window.__sleep(300);
    T("closed", { flipped: flipped(), booklet: !!document.querySelector(".it.booklet"), lifted: document.getElementById("scene").style.transform !== "" });
  `);
  harness.assertNoPageError(assert, r);
  const all = Array.from({ length: 40 }, (_, i) => i);
  await t.test("THE one: turned over, the booklet opens by itself, and the back and the booklet hold every track once, in order", () => {
    assert.equal(r.open.booklet, true);
    assert.ok(r.open.back.length > 5 && r.open.book.length > 0, JSON.stringify(r.open));
    assert.deepEqual(r.open.back.concat(r.open.book), all);
  });
  await t.test("nothing spills off the back or the page", () => {
    assert.equal(r.open.fitsBack, true);
    assert.equal(r.open.fitsBook, true);
  });
  await t.test("it hangs below the case, and the shelf lifts so both fit the stage", () => {
    assert.equal(r.open.below, true);
    assert.equal(r.open.lifted, true);
    assert.equal(r.open.inside, true);
  });
  await t.test("a page that starts part-way through a disc says which disc", () => {
    assert.match(r.open.lead, /^Disc \d · continued$/);
  });
  await t.test("one page: no arrows", () => assert.equal(r.open.nav, "hidden"));
  await t.test("a track in the booklet is chosen like one on the back", () => {
    assert.deepEqual(r.chose_in_booklet.picks, [37]);
    assert.equal(r.chose_in_booklet.tick, true);
  });
  await t.test("turning the case back folds the booklet away and lowers the shelf", () => {
    assert.deepEqual(r.closed, { flipped: false, booklet: false, lifted: false });
  });
});

test("a box set's booklet has pages, turned with ‹ › (v1.9.4)", { skip: !harness.available }, async (t) => {
  const r = render("shelf194-pages", BOX, `
    noTransitions();
    await turnOver();
    await window.__sleep(200);
    var p1 = idsIn(".bkl"), back = idsIn(".bk"), label1 = pageLabel();
    var prev = mid(document.querySelector(".it.flipped .bkl-prev")); tap(prev.x, prev.y); await window.__sleep(60);
    T("first", { label: label1, afterPrev: pageLabel(), back: back.length, p1: [p1[0], p1[p1.length - 1]], contiguous: p1[0] === back[back.length - 1] + 1 });
    await holdRow(p1[0]);
    var next = mid(document.querySelector(".it.flipped .bkl-next")); tap(next.x, next.y); await window.__sleep(60);
    var p2 = idsIn(".bkl");
    T("second", { label: pageLabel(), contiguous: p2[0] === p1[p1.length - 1] + 1, fits: fits(document.querySelector(".it.flipped .bkl .bk-tracks")) });
    await holdRow(p2[1]);
    stage.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", bubbles: true })); await window.__sleep(60);
    T("back_to_one", { label: pageLabel(), tickKept: !!(row(p1[0]) && row(p1[0]).classList.contains("sel")), picks: picks() });
    var seen = back.slice(); var guard = 0;
    function lastIsHeading(sel) { var li = document.querySelector(".it.flipped " + sel + " .bk-tracks").lastElementChild; return !!li && li.classList.contains("bk-disc"); }
    var headingEnds = lastIsHeading(".bk") ? 1 : 0;
    stage.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", bubbles: true }));
    while (guard++ < 10) { seen = seen.concat(idsIn(".bkl")); if (lastIsHeading(".bkl")) headingEnds++; var lab = pageLabel().split(" / "); if (lab[0] === lab[1]) break;
      stage.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true })); await window.__sleep(30); }
    T("every", seen);
    T("headingEnds", headingEnds);
    document.querySelector('#tsel [data-tact="queue"]').click();
    await window.__sleep(300);
    T("queued", trackPosts().map(function (b) { return b.track; }));
  `);
  harness.assertNoPageError(assert, r);
  await t.test("THE one: more than one page — '1 / N', the next page carrying on where the last stopped", () => {
    assert.match(r.first.label, /^1 \/ [2-9]$/);
    assert.equal(r.first.contiguous, true);
    assert.equal(r.second.contiguous, true);
    assert.match(r.second.label, /^2 \//);
    assert.equal(r.second.fits, true);
  });
  await t.test("‹ on the first page goes nowhere", () => assert.equal(r.first.afterPrev, r.first.label));
  await t.test("every track of the set is on the back or a page, once, in order", () => {
    assert.deepEqual(r.every, Array.from({ length: 120 }, (_, i) => i));
  });
  await t.test("no page ends on a disc's heading: it goes over with its tracks", () => assert.equal(r.headingEnds, 0));
  await t.test("a choice made on one page is still ticked after turning away and back (PageUp turns back too)", () => {
    assert.match(r.back_to_one.label, /^1 \//);
    assert.equal(r.back_to_one.tickKept, true);
    assert.equal(r.back_to_one.picks.length, 2);
  });
  await t.test("tracks chosen on two pages are queued together, in album order", () => {
    assert.deepEqual(r.queued, r.back_to_one.picks);
  });
});

// Found in review: the booklet opened from the frame loop, which stops once
// the shelf is still. A track list that came back after that — Roon taking a
// second or two over a box set — was cut into pages that nothing then showed,
// until the next touch.
test("a track list that arrives after the shelf has stopped still opens the booklet (v1.9.4)", { skip: !harness.available }, async (t) => {
  const r = render("shelf194-slowbooklet", LONG, `
    noTransitions();
    await turnOver();
    T("before", { mode: S().mode, booklet: !!booklet(), reading: !!document.querySelector(".it.flipped .bk-msg") });
    await window.__sleep(2200);
    T("after", { booklet: !!booklet(), lifted: document.getElementById("scene").style.transform !== "",
                 all: idsIn(".bk").concat(idsIn(".bkl")).length });
  `, { slowAlbum: 2000 });
  harness.assertNoPageError(assert, r);
  await t.test("the shelf had stopped, still reading", () => assert.deepEqual(r.before, { mode: "idle", booklet: false, reading: true }));
  await t.test("THE one: the booklet opened by itself when the tracks came", () => {
    assert.deepEqual(r.after, { booklet: true, lifted: true, all: 40 });
  });
});

test("an album whose tracks fit has no booklet (v1.9.4)", { skip: !harness.available }, async (t) => {
  const r = render("shelf194-nobooklet", WALL, `
    noTransitions();
    await turnOver();
    T("state", { booklet: !!booklet(), lifted: document.getElementById("scene").style.transform !== "" });
  `);
  harness.assertNoPageError(assert, r);
  await t.test("no booklet, and the shelf where it was", () => assert.deepEqual(r.state, { booklet: false, lifted: false }));
});

test("with a mouse: Ctrl/⌘-click and Shift-click choose tracks (v1.9.4)", { skip: !harness.available }, async (t) => {
  const r = render("shelf194-mouse", WALL, `
    await turnOver();
    click(1, { ctrl: true }); await window.__sleep(60);
    T("ctrl", { picks: picks(), flipped: flipped() });
    click(3, { meta: true }); await window.__sleep(60);
    T("meta", picks());
    click(0, { shift: true }); await window.__sleep(60);
    T("shift", picks());
    click(3, { ctrl: true }); await window.__sleep(60);
    T("ctrl_off", picks());
    click(4); await window.__sleep(60);
    T("plain_while_choosing", { picks: picks(), flipped: flipped() });
  `);
  harness.assertNoPageError(assert, r);
  await t.test("THE one: Ctrl-click chooses at once — no hold — and the case stays turned over", () => {
    assert.deepEqual(r.ctrl, { picks: [1], flipped: true });
  });
  await t.test("⌘-click adds another", () => assert.deepEqual(r.meta, [1, 3]));
  await t.test("Shift-click chooses the run from the last one chosen", () => assert.deepEqual(r.shift, [0, 1, 2, 3]));
  await t.test("Ctrl-click on a chosen one takes it away", () => assert.deepEqual(r.ctrl_off, [0, 1, 2]));
  await t.test("a plain click while choosing adds, as a tap does", () => assert.deepEqual(r.plain_while_choosing, { picks: [0, 1, 2, 4], flipped: true }));
});

test("review fixes: drift, wobble, in-flight choices and a double tap (v1.9.4)", { skip: !harness.available }, async (t) => {
  const r = render("shelf194-fixes", WALL, `
    // a tap on the FRONT cover that drifts down still turns the case over
    var f = mid(front()), id = ++pid;
    pe("pointerdown", f.x, f.y, id); pe("pointermove", f.x, f.y + 20, id); pe("pointerup", f.x, f.y + 20, id);
    await window.__sleep(1300);
    T("front_drift", flipped());
    // a long press with a little sideways drift chooses, and the shelf comes back square
    var c = mid(row(1)); id = ++pid;
    pe("pointerdown", c.x, c.y, id); pe("pointermove", c.x + 6, c.y, id);
    await window.__sleep(650); pe("pointerup", c.x + 6, c.y, id); await window.__sleep(900);
    T("square", { picks: picks(), p: S().p, whole: Number.isInteger(S().p) });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    // a hold that wobbles 11px: neither chosen nor a tap that turns the case back
    c = mid(row(2)); id = ++pid;
    pe("pointerdown", c.x, c.y, id); pe("pointermove", c.x, c.y + 11, id);
    await window.__sleep(650); pe("pointerup", c.x, c.y + 11, id); await window.__sleep(200);
    T("wobble", { picks: picks(), flipped: flipped() });
    // tracks chosen while a send is on its way are kept
    await holdRow(0); await tapRow(1);
    document.querySelector('#tsel [data-tact="play_next"]').click();
    await window.__sleep(100);
    await tapRow(3);
    await window.__sleep(1200);
    T("inflight", { picks: picks(), sent: trackPosts().map(function (b) { return b.track; }) });
  `, { slowPlay: 300 });
  harness.assertNoPageError(assert, r);
  await t.test("a slide on the front cover is still a tap (the not-a-tap rule is the back's alone)", () => assert.equal(r.front_drift, true));
  await t.test("a long press that drifted a little leaves the shelf square on its album", () => {
    assert.deepEqual(r.square.picks, [1]);
    assert.equal(r.square.whole, true, "p = " + r.square.p);
  });
  await t.test("a hold that wobbles past the limit neither chooses nor turns the case back", () => {
    assert.deepEqual(r.wobble, { picks: [], flipped: true });
  });
  await t.test("a track chosen while the others were on their way stays chosen", () => {
    assert.deepEqual(r.inflight.sent, [1, 0]);
    assert.deepEqual(r.inflight.picks, [3]);
  });

  const d = render("shelf194-double", WALL, `
    await turnOver();
    await holdRow(0); await tapRow(2);
    window.__zonesReady = true;
    var b = document.querySelector('#tsel [data-tact="queue"]');
    b.click(); b.click();
    await window.__sleep(800);
    T("double", { posts: trackPosts().map(function (x) { return x.track; }), toast: document.getElementById("toast").textContent });
  `, { zonesLater: true });
  harness.assertNoPageError(assert, d);
  await t.test("two quick taps while the zone is still being found send each track once", () => {
    assert.deepEqual(d.double.posts, [0, 2]);
  });
  await t.test("…and the second tap is ignored, not run to a false 'That didn't work'", () => {
    assert.match(d.double.toast, /^2 tracks added to the queue/);
  });
});

test("a track list Roon no longer matches says so (v1.9.4)", { skip: !harness.available }, async (t) => {
  const r = render("shelf194-stale", WALL, `
    await turnOver();
    await holdRow(0); await tapRow(1);
    document.querySelector('#tsel [data-tact="play_now"]').click();
    await window.__sleep(400);
    T("stale", { posts: trackPosts().length, toast: document.getElementById("toast").textContent, picks: picks(), popup: shown("#tsel") });
  `, { stale: true });
  harness.assertNoPageError(assert, r);
  await t.test("it stops at the first refusal and says the tracks have changed", () => {
    assert.equal(r.stale.posts, 1);
    assert.match(r.stale.toast, /tracks have changed/);
  });
  await t.test("and the choosing ends — no popup left whose buttons can do nothing", () => {
    assert.deepEqual(r.stale.picks, []);
    assert.equal(r.stale.popup, false);
  });
});
