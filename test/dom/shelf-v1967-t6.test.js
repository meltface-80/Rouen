"use strict";
// ---------------------------------------------------------------------------
// v1.9.67-t6 (the owner, 2026-10-27: "catalogue numbers, where are they?
// I want them on the spines and at the bottom; if the screen is smaller than a
// tablet don't show them; show them on the rear expanded cover"): the number
// pinned to the foot of the spine whatever the names' length, a long artist
// or title cut rather than pushing it off the case; not on a phone; on the
// album view a tapped case turns into.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");
const { buildShelf, shelfSignature } = require("../../lib/shelf");
const { KINDS } = require("../../lib/release-facts");

// [artist, title, label, catalogue number]: short names, long names, a very long title, none
const RECORDS = [
  ["Burial", "Untrue", "Hyperdub", "HDBCD002"],
  ["Godspeed You! Black Emperor", "Lift Your Skinny Fists Like Antennas to Heaven", "Kranky", "KRANK 043"],
  ["The Cinematic Orchestra", "Every Day", "Ninja Tune", "ZEN 61"],
  ["Sufjan Stevens", "Illinois, or Come On Feel the Illinoise, the Second State of the Fifty States Project", "Asthmatic Kitty", "AKR014"],
  ["Radiohead", "Kid A", null, null],
];
const canon = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/^the /, "");
const SHELF = buildShelf(
  RECORDS.map(([artist, title, l, c], i) => ({ offset: 100 + i, title, subtitle: artist, image_key: "k" + i, f: canon(artist), l, c })),
  { genresOf: () => ["Electronic"], firstOf: (al) => al.f, yearOf: () => 2000, labelOf: (al) => al.l, catOf: (al) => al.c, typeOf: () => "album" });
const ANSWER = Object.assign({ total: SHELF.albums.length, rev: "1.0", sig: shelfSignature(SHELF), kinds: KINDS }, SHELF);
const ZONE = { zone_id: "z1", display_name: "Living Room", state: "paused" };

const STUB = `
window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(performance.now()); }, 16); };
window.cancelAnimationFrame = function (id) { clearTimeout(id); };
navigation.addEventListener("navigate", function (e) { if (e.cancelable) e.preventDefault(); });
try { localStorage.clear(); localStorage.setItem("rra-zone", "z1"); localStorage.setItem("rra-shelf-look", "spines");
      localStorage.setItem("rra-shelf-help", JSON.stringify({ seen: "1.9.67", never: true })); } catch (e) { /* always there here */ }
window.__installFetch(function (u) {
  if (u.indexOf("/api/shelf/albums") > -1) return window.__json(${JSON.stringify(ANSWER)});
  if (u.indexOf("/api/live") > -1) return window.__json({ rev: { library: "1.0", settings: "1" } });
  if (u.indexOf("/api/settings/display") > -1) return window.__json({ enabled: false, seconds: 10 });
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (u.indexOf("/api/album?") > -1) return window.__json({ tracks: [{ title: "Archangel" }], discs: null });
  if (u.indexOf("/api/update/status") > -1) return window.__json({ current: "1.9.67-t6" });
  return undefined;
});`;
const HELPERS = `
  var __st = document.createElement("style");
  __st.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; }";
  document.head.appendChild(__st);
  var S = function () { return window.__shelfState(); };
  for (var i = 0; i < 80 && !(S() && S().N); i++) await window.__sleep(100);
  await window.__sleep(600);
  var stage = document.getElementById("stage");
  function $(s) { return document.querySelector(s); }
  function box(el) { var b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; }
  // every spine drawn: the artist, its number, and where the number sits against the spine (the mark under it went in
  // v1.9.68, its room given to the names)
  function spines() { return Array.prototype.map.call(document.querySelectorAll(".it .side.l"), function (side) {
    var sp = side.querySelector(".sp"), cat = sp.querySelector(".sp-cat"), txt = sp.querySelector(".sp-txt");
    var cb = cat ? box(cat) : null, tb = box(txt);
    return { ar: sp.querySelector(".sp-ar").textContent, cat: cat ? cat.textContent : null, shown: !!cat && getComputedStyle(cat).display !== "none" && cb.h > 0,
      inside: !!cb && cb.t >= tb.t - 1 && cb.b <= tb.b + 1, atFoot: !!cb && tb.b - cb.b < 4, v: +side.closest(".it").dataset.v }; }); }
  function mid(el) { var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  function pe(type, x, y, id) { stage.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: "touch", isPrimary: true })); }
  function front() { return $('.it[data-v="' + Math.round(S().p) + '"]'); }
`;
const render = (name, size, driver) => harness.renderPage({ name, page: "shelf", windowSize: size, budgetMs: 30000, stub: STUB, driver: HELPERS + driver });

test("the catalogue number sits at the foot of every spine that has one, long names cut rather than pushing it off (v1.9.67-t6)", { skip: !harness.available }, async (t) => {
  const r = render("shelf-t6-spines", "1440x900", `
    T("spines", spines());
    T("front", Math.round(S().p));
    T("cut", Array.prototype.map.call(document.querySelectorAll(".it .side.l .sp-ar"), function (e) { return getComputedStyle(e).textOverflow + "/" + getComputedStyle(e).overflow; }));
  `);
  harness.assertNoPageError(assert, r);
  await t.test("THE one: every album with a number shows it, at the foot of the spine, inside the spine's text", () => {
    const seen = new Map();
    // the case in front shows its cover: its spine faces sideways behind it, foreshortened (v1.9.68's wider spines
    // make that a few pixels), and is not what is read
    for (const s of r.spines) if (s.v !== r.front) seen.set(s.ar, s);
    for (const [artist, , , c] of RECORDS) {
      const s = seen.get(artist);
      if (!s && r.spines.some((x) => x.ar === artist && x.v === r.front)) continue;
      assert.ok(s, "no spine for " + artist);
      if (!c) { assert.equal(s.cat, null, artist + " has no number to show"); continue; }
      assert.equal(s.cat, c, artist);
      assert.equal(s.shown, true, artist + ": the number is not shown");
      assert.equal(s.inside, true, artist + ": the number is pushed off the spine");
      assert.equal(s.atFoot, true, artist + ": the number is not at the foot");
    }
  });
  await t.test("a long artist's name is cut with an ellipsis, not the number", () => {
    for (const c of r.cut) assert.equal(c, "ellipsis/hidden");
  });
});

test("narrower than a tablet the number is not on the spine; the album view carries it (v1.9.67-t6)", { skip: !harness.available }, async (t) => {
  const r = render("shelf-t6-phone", "390x844", `
    T("spines", spines());
    var c = mid(front()); var id = 5; pe("pointerdown", c.x, c.y, id); pe("pointerup", c.x, c.y, id);
    await window.__sleep(900);
    T("view", { open: $("#open").classList.contains("on"), line: ($("#open .ov-line") || {}).textContent || "", title: $("#open .ov-title").textContent });
  `);
  harness.assertNoPageError(assert, r);
  await t.test("THE one: the numbers are in the markup but not shown", () => {
    const withNumber = r.spines.filter((s) => s.cat);
    assert.ok(withNumber.length >= 3, "no spines with a number drawn");
    for (const s of withNumber) assert.equal(s.shown, false, s.ar + ": shown on a phone");
  });
  await t.test("the album view a tapped case turns into carries the number in its line of facts", () => {
    assert.equal(r.view.open, true);
    const rec = RECORDS.find((x) => x[1] === r.view.title);
    assert.ok(rec, "the view shows no album of the fixture: " + JSON.stringify(r.view));
    if (rec[3]) assert.ok(r.view.line.includes(rec[3]), `${r.view.line} lacks ${rec[3]}`);
    else assert.ok(!/HDB|KRANK|ZEN|AKR/.test(r.view.line));
  });
});
