"use strict";
// ---------------------------------------------------------------------------
// v1.9.72-t21: the Shelf's volume and zone sheets stand just above the bar as it is when they open. Both are placed
// by --foot-h, the bar's height, which layout() measured; and layout() ran again only from the stage's
// ResizeObserver, which reports at the next rendered frame. When the bar grew (the playing track's line coming in)
// and a sheet opened before that frame, it stood on the old height: 39 px down, over the bar. Seen as
// shelf-v1968's phone volume test failing now and then on CI (the harness's virtual time can outrun frames): looped,
// 14 in 1,200, every one with --foot-h at 85px under a 124px bar. Here the bar grows and the sheet opens in the
// same task, so no frame can come between them.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");
const { buildShelf, shelfSignature } = require("../../lib/shelf");

const SHELF = buildShelf([["Burial", "Untrue"], ["Four Tet", "Rounds"], ["Floating Points", "Crush"]]
  .map(([artist, title], i) => ({ offset: 100 + i, title, subtitle: artist, image_key: "k" + i })),
  { genresOf: () => ["Electronic"], firstOf: (al) => al.subtitle.toLowerCase() });
const ANSWER = Object.assign({ total: SHELF.albums.length, rev: "1.0", sig: shelfSignature(SHELF) }, SHELF);
const ZONE = { zone_id: "z1", display_name: "Living Room", state: "paused",
  outputs: [{ output_id: "o1", display_name: "Living Room", volume: { type: "number", min: 0, max: 100, value: 9, step: 1 } }] };

const STUB = `
window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(performance.now()); }, 16); };
window.cancelAnimationFrame = function (id) { clearTimeout(id); };
// the playing track's line held back, as before the zone's track is known: the bar as layout() first measures it
(function () { var st = document.createElement("style"); st.id = "no-track-line"; st.textContent = "#mt-info{display:none!important}"; document.head.appendChild(st); })();
try { localStorage.clear(); localStorage.setItem("rra-zone", "z1"); localStorage.setItem("rra-shelf-pick", "off");
      localStorage.setItem("rra-shelf-help", JSON.stringify({ seen: "1.9.72", never: true })); } catch (e) { /* always there here */ }
window.__installFetch(function (u) {
  if (u.indexOf("/api/shelf/albums") > -1) return window.__json(${JSON.stringify(ANSWER)});
  if (u.indexOf("/api/live") > -1) return window.__json({ rev: { library: "1.0", settings: "1" } });
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [${JSON.stringify(ZONE)}, { zone_id: "z2", display_name: "Kitchen", state: "stopped" }] });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (u.indexOf("/api/update/status") > -1) return window.__json({ current: "1.9.72" });
  return undefined;
});`;

// The playing track's line let in (the bar 39 px taller, as when the zone's track arrives) and the sheet opened in the
// same task.
const DRIVER = (open, sheet) => `
  var st = document.createElement("style");
  st.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}";
  document.head.appendChild(st);
  for (var i = 0; i < 80 && !(window.__shelfState() && window.__shelfState().N); i++) await window.__sleep(100);
  for (var k = 0; k < 40 && document.getElementById("mt-vol-btn").disabled; k++) await window.__sleep(100);
  await window.__sleep(500);
  function box(s) { var b = document.querySelector(s).getBoundingClientRect(); return { t: b.top, b: b.bottom }; }
  var before = box("#mt");
  document.getElementById("no-track-line").remove();
  ${open}
  var s = box("${sheet}"), bar = box("#mt");
  T("sheet", { grew: Math.round(before.t - bar.t), shown: !document.querySelector("${sheet}").classList.contains("hidden"),
    above: s.b <= bar.t + 0.5 && bar.t - s.b < 20, gap: Math.round(bar.t - s.b) });
`;

// A phone: its bar takes the track's line as a row of its own (on a wide screen it sits in the bar's one row, and the
// bar keeps its height). The zone sheet opens after a fetch, which a frame can come between, so only the volume sheet
// can be caught here; both now measure the bar as they open.
test("390x844: the volume sheet opened just as the bar grows stands just above the bar, not over it (v1.9.72-t21)", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "sheet-foot-vol", page: "shelf", windowSize: "390x844", budgetMs: 30000, stub: STUB,
    driver: DRIVER(`document.getElementById("mt-vol-btn").click();`, "#vol") });
  harness.assertNoPageError(assert, r);
  await t.test("precondition: the bar grew by the track's line, 39 px, and the sheet is open", () => {
    assert.equal(r.sheet.grew, 39);
    assert.equal(r.sheet.shown, true);
  });
  await t.test("THE one: its foot just above the bar's top", () => assert.equal(r.sheet.above, true, `${r.sheet.gap} px between them`));
});
