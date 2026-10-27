"use strict";
// ---------------------------------------------------------------------------
// v1.9.67 (a user's request: "what I miss in Roon is an easy way to browse on
// catalogue number … add the cat nr in the spine of the shelf and the
// possibility to sort by label / cat nr … and by album type"): the Shelf's
// Labels and Types tiles, its Order tab (artist, label and catalogue number,
// year, random — Random grown into it), the catalogue number at the foot of
// every spine, divider cards where each label begins when filed by label, and
// the label · catalogue № · kind line on the back of a case. The list is made
// by the REAL lib/shelf.js, so its shape is the server's; the renders the
// owner sanctioned on 2026-10-26 came from these same scenes.
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
  ["Miles Davis", "Kind of Blue", ["Jazz"], "Columbia", "CL 1355", ["album", "live"], 1959],   // two kinds at once (t4)
  ["Radiohead", "Kid A", ["Pop/Rock", "Electronic"], null, null, "album", 2000],
  ["Sade", "Diamond Life", ["R&B"], null, null, null, 1984],
  ["Various", "Trainspotting", ["Pop/Rock"], "EMI", null, "soundtrack", 1996],
];
const canon = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/^the /, "");
const SHELF = buildShelf(
  RECORDS.map(([artist, title, g, l, c, ty, y], i) => ({ offset: 100 + i, title, subtitle: artist, image_key: "k" + i, g, f: canon(artist), l, c, ty, y })),
  { genresOf: (al) => al.g, firstOf: (al) => al.f, yearOf: (al) => al.y, labelOf: (al) => al.l, catOf: (al) => al.c, typeOf: (al) => al.ty });
const ANSWER = Object.assign({ total: SHELF.albums.length, rev: "1.0", sig: shelfSignature(SHELF), kinds: KINDS }, SHELF);
const LABEL = (name) => SHELF.labels.findIndex((l) => l.name === name);
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
  function front() { return document.querySelector('.it[data-v="' + Math.round(S().p) + '"]'); }
`;

test("Shelf v1.9.67: Labels and Types tiles narrow the shelf; every spine carries its catalogue number; the back says label · № · kind", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "shelf-v1967-labels", page: "shelf", windowSize: "1440x900", budgetMs: 30000, stub: STUB, driver: HELPERS + `
    T("tabs", texts(".tab").map(function (s) { return s.trim(); }));
    tabTo("label");
    T("labelTiles", tiles("label"));
    tile("label", ${LABEL("Warp")}).click();
    tile("label", ${LABEL("Hyperdub")}).click();
    await idle();
    T("two", { N: S().N, chips: texts("#chips .chip > span"), note: document.getElementById("sec-note").textContent, badge: document.querySelector('.tab[data-tab="label"] .badge').textContent,
      counts: tiles("label"), order: window.__shelfOrder() });
    T("spines", Array.prototype.map.call(document.querySelectorAll(".it .side.l .sp"), function (sp) {
      return (sp.querySelector(".sp-ar") || {}).textContent + "|" + ((sp.querySelector(".sp-cat") || {}).textContent || "-"); }));
    document.getElementById("sec-clear").click();
    await idle();
    tabTo("type");
    T("typeTiles", tiles("type"));
    tile("type", "live").click(); await idle();
    T("live", { N: S().N, chips: texts("#chips .chip > span") });
    tile("type", "live").click(); await idle();
    tile("type", "ep").click();
    await idle();
    T("ep", { N: S().N, chips: texts("#chips .chip > span"), reset: !document.getElementById("reset-all").classList.contains("hidden") });
  ` });
  // The back of a case: read once the case in front is turned over (the carousel, where every back was drawn, went
  // in v1.9.68), with the album view it opens, which says the same line under its title.
  const back = harness.renderPage({ name: "shelf-v1967-back", page: "shelf", windowSize: "1440x900", budgetMs: 30000, stub: STUB, driver: HELPERS + `
    tabTo("label"); tile("label", ${LABEL("Hyperdub")}).click();
    await idle(); await window.__sleep(200);
    // narrowed to three, the cases put away say no place (v1.9.68: a stale [data-v] was what front() found, and the
    // tap went to a case not drawn)
    var stale = Array.prototype.filter.call(document.querySelectorAll(".it[data-v]"), function (el) { return el.style.display === "none"; }).length;
    var c = mid(front()); tap(c.x, c.y);
    for (var w = 0; w < 80 && !(front() && front().querySelector(".bk-ti") && document.querySelector("#open .ov-line")); w++) await window.__sleep(100);
    T("back", { line: (front().querySelector(".bk-lab") || {}).textContent, title: (front().querySelector(".bk-ti") || {}).textContent,
                view: (document.querySelector("#open .ov-line") || {}).textContent, look: S().look, stale: stale });
  ` });
  harness.assertNoPageError(assert, back);
  harness.assertNoPageError(assert, r);
  await t.test("six tabs, Order where Random was", () => {
    assert.deepEqual(r.tabs, ["Genres", "Artists", "Years", "Labels", "Types", "Order"]);
  });
  await t.test("labels commonest first with their counts; two chosen narrow the shelf and are chips", () => {
    assert.deepEqual(r.labelTiles.slice(0, 3), ["Warp:4", "Hyperdub:3", "Ninja Tune:2"]);
    assert.equal(r.labelTiles.length, SHELF.labels.length);
    assert.equal(r.two.N, 7);
    assert.deepEqual(r.two.chips, ["Warp", "Hyperdub"]);
    assert.equal(r.two.badge, "2");
    assert.match(r.two.note, /2 labels chosen/);
    // The other labels keep their own counts: choosing one too ADDS its albums (any of the labels chosen), as genres do.
    assert.ok(r.two.counts.includes("Ninja Tune:2"), JSON.stringify(r.two.counts));
    assert.deepEqual(r.two.order, SHELF.albums.filter((a) => [LABEL("Warp"), LABEL("Hyperdub")].includes(a.l)).map((a) => a.t), "not in the artist order, or not these");
  });
  await t.test("every spine drawn carries its catalogue number at its foot; one without has none", () => {
    assert.ok(r.spines.length >= 5, "no spines drawn");
    for (const s of r.spines) {
      const [artist, cat] = s.split("|");
      const rec = RECORDS.find(([a, , , , c]) => a === artist && (c || "-") === cat);
      assert.ok(rec, `a spine of ${artist} says ${cat}`);
    }
  });
  await t.test("types as the tags say them, in TYPES' order, with counts; an unknown kind is a tile too", () => {
    const kinds = RECORDS.flatMap((rec) => (rec[5] ? [].concat(rec[5]) : ["none"]));
    assert.deepEqual(r.typeTiles, [["Albums", "album"], ["EPs", "ep"], ["Singles", "single"], ["Live", "live"], ["Soundtracks", "soundtrack"], ["Unknown", "none"]]
      .map(([name, id]) => name + ":" + kinds.filter((k) => k === id).length), "an album of two kinds counts under both (t4)");
    assert.deepEqual([r.live.N, r.live.chips], [1, ["Live"]], "Kind of Blue is live as well as an album");
    assert.equal(r.ep.N, 1);
    assert.deepEqual(r.ep.chips, ["EPs"]);
    assert.equal(r.ep.reset, false, "Reset shelf with one section chosen");
  });
  await t.test("the opened album: label · catalogue № · kind · year under the title (the year since t5)", () => {
    assert.equal(back.back.look, "spines");
    assert.equal(back.back.stale, 0, "a case put away still says where it stood");
    assert.ok(back.back.title, "no back drawn: " + JSON.stringify(back.back));
    assert.equal(back.back.view, back.back.line, "the album view says otherwise");
    const rec = RECORDS.find(([, title]) => title === back.back.title);
    // each kind by the server's own name (KINDS): the album in front is random, so every kind the fixture has must be
    // named here — a hand-written table without "EP" failed whenever Windowlicker came to the front (v1.9.67-t8)
    const kindOne = Object.fromEntries(KINDS.map((k) => [k.id, k.one]));
    assert.equal(back.back.line, [rec[3], rec[4], ...(rec[5] ? [].concat(rec[5]).map((k) => kindOne[k]) : []), rec[6]].filter(Boolean).join(" · "));
  });
});

test("Shelf v1.9.67: the Order tab — by label and catalogue №, divider cards tiered; by year; Random still reshuffles; an order is not undone", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "shelf-v1967-order", page: "shelf", windowSize: "1440x900", budgetMs: 30000, stub: STUB, driver: HELPERS + `
    tabTo("order");
    T("tiles", tiles("order").map(function (s) { return s.split(":")[0]; }));
    T("start", { pressed: tile("order", "artist").getAttribute("aria-pressed"), chips: texts("#chips .chip > span"), order: document.getElementById("shelf-order").textContent, note: document.getElementById("sec-note").textContent });
    tile("order", "label").click();
    await idle(); await window.__sleep(400);   // a frame, so the spines are drawn again with their new tabs
    T("label", { order: document.getElementById("shelf-order").textContent, chips: texts("#chips .chip > span"), badge: document.querySelector('.tab[data-tab="order"] .badge').textContent,
      list: window.__shelfOrder(), pressed: [tile("order", "artist").getAttribute("aria-pressed"), tile("order", "label").getAttribute("aria-pressed")],
      cards: Array.prototype.map.call(document.querySelectorAll(".it .side.l .sp-tab"), function (e) { return e.textContent + (e.classList.contains("w") ? "" : "!") + (e.classList.contains("up") ? "^" : ""); }) });
    tile("order", "year").click();
    await idle(); await window.__sleep(400);
    T("year", { order: document.getElementById("shelf-order").textContent, list: window.__shelfOrder(), cards: Array.prototype.map.call(document.querySelectorAll(".it .side.l .sp-tab"), function (e) { return e.textContent; }) });
    tile("order", "random").click();
    await idle();
    var one = window.__shelfOrder();
    document.getElementById("reshuffle").click();
    await idle();
    T("random", { order: document.getElementById("shelf-order").textContent, reshuffle: !document.getElementById("reshuffle").disabled, moved: one.join("|") !== window.__shelfOrder().join("|"), N: S().N });
    tile("order", "artist").click(); await idle();
    // Undo takes back the last choice that narrowed the shelf, never an order — even one chosen after it
    tabTo("type"); tile("type", "soundtrack").click(); await idle();
    tabTo("genre"); tile("genre", ${SHELF.genres.findIndex((g) => g.name === "Jazz")}).click(); await idle();
    tabTo("order"); tile("order", "random").click(); await idle();
    T("empty", { N: S().N, chips: texts("#chips .chip > span") });
    document.getElementById("undo").click(); await idle();
    T("undone", { N: S().N, chips: texts("#chips .chip > span"), order: document.getElementById("shelf-order").textContent });
    // the chip's × puts the artist order back
    document.querySelector('#chips .x[data-cat="order"]').click(); await idle();
    tabTo("order");
    T("chipOff", { order: document.getElementById("shelf-order").textContent, pressed: tile("order", "artist").getAttribute("aria-pressed") });
  ` });
  harness.assertNoPageError(assert, r);
  const byLabel = SHELF.albums.slice().sort((x, y) => {
    if ((x.l === null) !== (y.l === null)) return x.l === null ? 1 : -1;
    const n = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    return n.compare(x.l === null ? "" : SHELF.labels[x.l].name, y.l === null ? "" : SHELF.labels[y.l].name) || n.compare(x.c || "\uffff", y.c || "\uffff") || n.compare(x.t, y.t);
  });
  await t.test("the artist order is the default and no chip; the five orders are tiles (By catalogue № since t5)", () => {
    assert.deepEqual(r.tiles, ["A → Z by artist", "By label and catalogue №", "By catalogue №", "By year", "Random order"]);
    assert.deepEqual([r.start.pressed, r.start.chips, r.start.order], ["true", [], "A → Z by artist"]);
    assert.match(r.start.note, /One order at a time/);
  });
  await t.test("by label: each label together in catalogue order, the unlabelled last; a chip; divider cards where a label begins, tiered when side by side", () => {
    assert.deepEqual(r.label.list, byLabel.map((a) => a.t));
    assert.deepEqual([r.label.order, r.label.chips, r.label.badge, r.label.pressed], ["By label and catalogue №", ["By label and catalogue №"], "1", ["false", "true"]]);
    const names = r.label.cards.map((c) => c.replace(/[!^]+$/, ""));
    assert.ok(names.length >= 3 && names.every((n) => SHELF.labels.some((l) => l.name === n)), "cards that aren't labels: " + JSON.stringify(r.label.cards));
    assert.ok(r.label.cards.every((c) => !c.includes("!")), "a label's card drawn as a letter's tab");
    assert.ok(r.label.cards.some((c) => c.endsWith("^")), "two cards side by side, neither raised: " + JSON.stringify(r.label.cards));
  });
  await t.test("by year: oldest first, undated last, a card at each decade", () => {
    const byYear = SHELF.albums.slice().sort((x, y) => (!x.y !== !y.y ? (x.y ? -1 : 1) : (x.y || 0) - (y.y || 0)));
    assert.deepEqual(r.year.list, byYear.map((a) => a.t));
    assert.equal(r.year.order, "By year");
    assert.ok(r.year.cards.every((c) => /^\d{4}s$/.test(c)), JSON.stringify(r.year.cards));
  });
  await t.test("Random: the same shelf reshuffled on Shuffle again", () => {
    assert.deepEqual([r.random.order, r.random.reshuffle, r.random.moved, r.random.N], ["Random order", true, true, SHELF.albums.length]);
  });
  await t.test("Undo takes back the genre that emptied the shelf, never the order; the order's chip × restores the artist order", () => {
    assert.equal(r.empty.N, 0);
    assert.deepEqual(r.empty.chips, ["Soundtracks", "Jazz", "Random order"]);
    assert.deepEqual([r.undone.N, r.undone.chips, r.undone.order], [1, ["Soundtracks", "Random order"], "Random order"]);
    assert.deepEqual([r.chipOff.order, r.chipOff.pressed], ["A → Z by artist", "true"]);
  });
});

test("Shelf v1.9.67: a library with no labels and no kinds says where they come from", { skip: !harness.available }, async () => {
  const bare = buildShelf(RECORDS.slice(0, 3).map(([artist, title, g], i) => ({ offset: i, title, subtitle: artist, image_key: null, g, f: canon(artist) })),
    { genresOf: (al) => al.g, firstOf: (al) => al.f });
  const stub = STUB.replace(JSON.stringify(ANSWER), JSON.stringify(Object.assign({ total: 3, rev: "1.0", sig: shelfSignature(bare), kinds: KINDS }, bare)));
  const r = harness.renderPage({ name: "shelf-v1967-bare", page: "shelf", windowSize: "1440x900", budgetMs: 20000, stub, driver: HELPERS + `
    tabTo("label");
    T("labels", { msg: (document.querySelector("#tiles .tiles-msg") || {}).textContent, tiles: document.querySelectorAll('.tile[data-cat="label"]').length });
    tabTo("type");
    T("types", tiles("type"));
    T("spines", document.querySelectorAll(".it .side.l .sp-cat").length);
  ` });
  harness.assertNoPageError(assert, r);
  assert.match(r.labels.msg, /switch Labels on in Settings/);
  assert.equal(r.labels.tiles, 0);
  assert.deepEqual(r.types, ["Unknown:3"]);
  assert.equal(r.spines, 0, "a spine with a catalogue number nobody gave");
});
