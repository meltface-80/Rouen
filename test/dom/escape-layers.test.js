"use strict";
// ---------------------------------------------------------------------------
// v2.0.3-t12: Escape closes the topmost thing only — a share card, a confirmation or a sheet over an album's page
// closes, and the album stays.
//
// Escape is the album page's Back (album-view.js), except when the side menu, Settings or Pitchfork is open over it:
// a list of the layers to leave alone, which missed the share card (and the confirmation, the filter sheet, the
// random-pick sheet and the label sheet). One press shut the share card and the album under it together. The class
// of error: a guard that lists what to leave alone, where a new layer is not on the list. Now the album page closes
// on Escape only when no other dialog is up: each of those is marked aria-modal, which a new one is too.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const STUB = `
try { localStorage.setItem("rra-zone", "z1"); } catch (e) { /* storage optional */ }
window.__installFetch(function (u) {
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [{ zone_id: "z1", display_name: "Zone", state: "stopped", outputs: [] }] });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: null });
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});
`;

const DRIVER = `
  await window.__sleep(600);
  var up = function (id) { var e = document.getElementById(id); return !!e && !e.classList.contains("hidden"); };
  var esc = async function () { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await window.__sleep(150); };
  var album = document.getElementById("album-modal");
  var closes = 0;
  document.getElementById("modal-close-btn").addEventListener("click", function () { closes++; }, true);
  var results = {};
  for (var id of ["share-overlay", "confirm-overlay", "filter-overlay", "random-pick-overlay", "label-unmerge-sheet"]) {
    album.classList.remove("hidden");
    var layer = document.getElementById(id);
    if (!layer) { results[id] = "missing"; continue; }
    layer.classList.remove("hidden");
    var before = closes;
    await esc();
    results[id] = { albumClosed: closes > before };
    layer.classList.add("hidden");
  }
  T("over", results);
  // The control: the album alone, and Escape is its Back.
  album.classList.remove("hidden");
  var b = closes;
  await esc();
  T("alone", closes > b);
`;

test("Escape closes the topmost layer, not the album under it (v2.0.3-t12)", { skip: !harness.available && "no chromium" }, async (t) => {
  const R = harness.renderPage({ stub: STUB, driver: DRIVER, name: "escape-layers", budgetMs: 20000 });
  harness.assertNoPageError(assert, R);
  await t.test("the album alone: Escape is its Back", () => { assert.equal(R.alone, true); });
  await t.test("THE one: the share card over it, and the other sheets: the album stays", () => {
    for (const [id, r] of Object.entries(R.over)) assert.deepEqual([id, r], [id, { albumClosed: false }]);
  });
});

// ---- v2.0.3-t12: the top bar's side padding takes a phone's side insets ----------------------------------------
// The insets themselves are a phone's (CLAUDE.md: not testable here); what is tested is that the bar keeps its own
// padding where there are none, at both of style.css's widths, so the rule that adds them takes nothing away.
const PAD = `
  await window.__sleep(400);
  document.getElementById("menu-toggle").click();                 // off Home, whose bar has no padding of its own
  await window.__sleep(200);
  document.querySelector('[data-action="playlists"]').click();
  await window.__sleep(600);
  var cs = getComputedStyle(document.querySelector(".topbar"));
  T("pad", [cs.paddingLeft, cs.paddingRight]);
`;
for (const [size, want] of [["390x844", "14px"], ["1280x800", "22px"]]) {
  test(`the top bar's side padding at ${size}, no insets: as before (v2.0.3-t12)`, { skip: !harness.available && "no chromium" }, () => {
    const R = harness.renderPage({ stub: STUB, driver: PAD, name: "topbar-pad-" + size, windowSize: size,
      chromeArgs: size === "1280x800" ? harness.MOUSE : undefined });
    harness.assertNoPageError(assert, R);
    assert.deepEqual(R.pad, [want, want]);
  });
}
