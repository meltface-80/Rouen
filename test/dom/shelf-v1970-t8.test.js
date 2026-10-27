"use strict";
// ---------------------------------------------------------------------------
// v1.9.70-t8 (dev/design/shelf-focus.md §1, the owner on an iPad, with photos: "Tile titles not centred"): the Years,
// Types and Formats tiles, and the letters, had their titles at the top, though v1.9.70-t5's and t7's tests measured
// them in the middle. Those tests run in Chromium, where a <button> that is a grid with its height from aspect-ratio
// stretches its one row to that height and centres its title in it. Safari lays a button's content out in a box of
// its own, as a block, so the title stayed at the top (in the middle across, as the photos show). The title now has a
// box of its own over the whole tile that centres it, whatever the button does with its content; this test lays each
// button out as a block, as Safari does, and measures the title. And the owner's photos show "Multichanne|l" and
// "Compilation|s": a word is never broken across lines; a long one is set smaller to fit.
// The list is made by the REAL lib/shelf.js, given the server facts lib/shelf-routes.js sends.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");
const { buildShelf, shelfSignature } = require("../../lib/shelf");
const { KINDS } = require("../../lib/release-facts");

// [artist, title, kind, fx: [file, rate, bits, channels, mqa, lossy, streaming, mixed], year]
const RECORDS = [
  ["Black Sabbath", "Paranoid", "album", [1, 44100, 16, 6, null, null, 0, 0], 1970],
  ["Iron Maiden", "Live After Death", "live", [1, 44100, 16, 2, null, null, 0, 0], 1985],
  ["Various", "Now 1", "compilation", [13, 5644800, 1, 6, null, null, 0, 0], 1983],
  ["Vangelis", "Blade Runner", "soundtrack", [1, 96000, 24, 2, null, null, 0, 0], 1994],
  ["Sade", "Smooth Operator", "single", [4, 44100, 16, 2, null, 320000, 0, 0], null],
  ["Unknown", "Demo", "ep", null, 2021],
];
const canon = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const shelf = buildShelf(RECORDS.map(([artist, title, , fx], i) => ({ offset: i, title, subtitle: artist, image_key: "k" + i, g: ["Rock"], f: canon(artist), fav: i < 2, fx })),
  { genresOf: (al) => al.g, firstOf: (al) => al.f, factsOf: (al) => al.fx, favOf: (al) => al.fav,
    yearOf: (al) => RECORDS[al.offset][4], typeOf: (al) => [RECORDS[al.offset][2]] });
const ANSWER = Object.assign({ total: shelf.albums.length, rev: "1.0", sig: shelfSignature(shelf), kinds: KINDS,
  facts: { native: true, albums: RECORDS.length, withFormat: 5, withGenres: 6, favourites: 2 } }, shelf);
const ZONE = { zone_id: "z1", display_name: "Living Room", state: "playing" };

const STUB = `
window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(performance.now()); }, 16); };
window.cancelAnimationFrame = function (id) { clearTimeout(id); };
navigation.addEventListener("navigate", function (e) { if (e.cancelable) e.preventDefault(); });
try { localStorage.clear(); localStorage.setItem("rra-zone", "z1"); localStorage.setItem("rra-shelf-look", "spines"); } catch (e) { /* always there here */ }
window.__installFetch(function (u) {
  if (u.indexOf("/api/shelf/albums") > -1) return window.__json(${JSON.stringify(ANSWER)});
  if (u.indexOf("/api/live") > -1) return window.__json({ rev: { library: "1.0", settings: "1" } });
  if (u.indexOf("/api/settings/display") > -1) return window.__json({ enabled: false, seconds: 10 });
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (u.indexOf("/api/update/status") > -1) return window.__json({ current: "1.9.70-t8" });
  return undefined;
});
`;

// Each size: the picker opened, each button laid out as a block (as Safari lays out a button's content), then every
// tile of the four tabs measured: its title's middle against the tile's, and each word of it on one line.
for (const size of ["390x844", "844x390", "1024x768", "1180x820", "1440x900"]) {
  test(`Shelf v1.9.70-t8: at ${size}, a button laid out as Safari does, every title in its tile's middle, no word broken`, { skip: !harness.available }, async (t) => {
    const r = harness.renderPage({ name: "shelf-v1970-t8-" + size, page: "shelf", windowSize: size, budgetMs: 30000, stub: STUB, driver: `
      var st = document.createElement("style");
      st.textContent = "*, *::before { transition: none !important; } .tile { align-content: start !important; }";
      document.head.appendChild(st);
      var S = function () { return window.__shelfState(); };
      for (var i = 0; i < 80 && !(S() && S().N); i++) await window.__sleep(100);
      await window.__sleep(400);
      var help = document.getElementById("help"); if (help) help.classList.add("hidden");
      var screenEl = document.getElementById("screen");
      if (screenEl.classList.contains("pick-off")) { document.getElementById("pick-tab").click(); await window.__sleep(300); }
      var out = [];
      for (var tb of ["artist", "year", "type", "format"]) {
        document.querySelector('.tab[data-tab="' + tb + '"]').click(); await window.__sleep(150);
        Array.prototype.forEach.call(document.querySelectorAll('.tile[data-cat="' + tb + '"]'), function (b) {
          var ch = b.querySelector(".ch"), r = b.getBoundingClientRect();
          // the title's text, not its box: where the words are drawn
          var rg = document.createRange(); rg.selectNodeContents(ch); var c = rg.getBoundingClientRect();
          var broken = [], node = ch.firstChild, at = 0;
          ch.textContent.split(" ").forEach(function (w) {
            if (w) { var wr = document.createRange(); wr.setStart(node, at); wr.setEnd(node, at + w.length);
              var lines = new Set(Array.prototype.map.call(wr.getClientRects(), function (q) { return Math.round(q.top); }));
              if (lines.size > 1) broken.push(w); }
            at += w.length + 1;
          });
          out.push({ tab: tb, text: ch.textContent, dx: Math.round((c.left + c.width / 2) - (r.left + r.width / 2)),
            dy: Math.round((c.top + c.height / 2) - (r.top + r.height / 2)), inside: c.left >= r.left && c.right <= r.right && c.top >= r.top && c.bottom <= r.bottom,
            broken: broken });
        });
      }
      T("tiles", out);
    ` });
    harness.assertNoPageError(assert, r);
    await t.test("every tab drew its tiles, the long names among them", () => {
      assert.deepEqual([...new Set(r.tiles.map((x) => x.tab))], ["artist", "year", "type", "format"]);
      const names = r.tiles.map((x) => x.text);
      for (const n of ["Compilations", "Soundtracks", "16/44.1 Multichannel", "DSD128 Multichannel", "1980s", "A"]) assert.ok(names.includes(n), n + " in " + names);
    });
    await t.test("THE one: each title in the middle of its tile, up and down as well as across, inside it", () => {
      assert.deepEqual(r.tiles.filter((x) => !(Math.abs(x.dx) <= 1 && Math.abs(x.dy) <= 1 && x.inside)), []);
    });
    await t.test("no word broken across two lines", () => {
      assert.deepEqual(r.tiles.filter((x) => x.broken.length), []);
    });
  });
}
