"use strict";
// ---------------------------------------------------------------------------
// v1.8.78: the Library wall's Focus, Sort and search, in the top bar.
//
// Asked for: "move the search magnifying glass and focus and sort by tools to
// the top bar and use the brass theme. The search bar is to open over the
// sort by and focus buttons. The x will clear text and x will also close the
// search bar."
//
// Measured from the real page: where the field opens, what it covers, what the
// × does each time, and that the controls leave with the wall — the top bar
// outlives every screen, so a control left in it is a control on the wrong one.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const ALBUMS = [
  { offset: 0, title: "Album A", subtitle: "Artist One", image_key: "k0" },
  { offset: 1, title: "Album B", subtitle: "Artist One", image_key: "k1" },
];

const STUB = `
var ALBUMS = ${JSON.stringify(ALBUMS)};
window.__installFetch(function (url) {
  if (url.indexOf("/api/artist-albums") > -1) return window.__json({ primary: [ALBUMS[0]], featured: [] });
  if (url.indexOf("/api/artist-bio") > -1)    return window.__json({ bio: null });
  if (url.indexOf("/api/library/facets") > -1)
    return window.__json({ total: 10, dated: 4, decades: [{ value: 1990, label: "1990s", count: 4 }],
                           sources: [], hasPlays: true });
  if (url.indexOf("/api/library/albums") > -1)
    return window.__json({ albums: ALBUMS, offset: 0, total: ALBUMS.length });
  if (url.indexOf("/api/random-albums") > -1)
    return window.__json({ albums: ALBUMS, total: ALBUMS.length, filtered: false });
  if (url.indexOf("/api/zones") > -1)
    return window.__json({ zones: [{ zone_id: "z1", display_name: "Zone", state: "stopped", outputs: [] }] });
  if (url.indexOf("/api/zone-state") > -1) return window.__json({ zone: null });
  if (url.indexOf("/api/queue") > -1)      return window.__json({ items: [] });
  if (url.indexOf("/api/filters") > -1)    return window.__json({ genres: [] });
  if (url.indexOf("/api/home/") > -1)      return window.__json({ albums: [], label: null });
  if (url.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  if (url.indexOf("/api/settings") > -1)   return window.__json({});
  return undefined;
});
// A clean slate: a persisted view from a previous run would decide the
// starting sort and make these assertions depend on test order.
try { localStorage.removeItem("rra-library-view"); } catch (e) {}
`;


const DRIVER = `
  await window.__sleep(400);
  document.getElementById("home-library-title").click();
  await window.__sleep(500);
  var bar = document.getElementById("library-controls");
  function shown(el) { return !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== "none"; }
  function q() {
    var hits = window.__calls.filter(function (u) { return u.indexOf("/api/library/albums") > -1; });
    return new URLSearchParams((hits[hits.length - 1] || "").split("?")[1] || "").get("prefix");
  }
  var title = document.getElementById("album-count");
  T("title_w", Math.round(title.getBoundingClientRect().width));
  T("title_text", title.textContent);
  T("glass_brass", getComputedStyle(bar.querySelector(".lib-filter-btn")).backgroundColor);
  T("focus_brass", getComputedStyle(bar.querySelector(".lib-ctl-focus")).backgroundColor);

  var fb = bar.querySelector(".lib-ctl-focus").getBoundingClientRect();
  bar.querySelector(".lib-filter-btn").click();
  await window.__sleep(150);
  var field = bar.querySelector(".lib-filter-box");
  T("field_open", shown(field));
  T("focus_hidden", !shown(bar.querySelector(".lib-ctl-focus")));
  T("sort_hidden", !shown(bar.querySelector(".lib-ctl-sort")));
  var r = field.getBoundingClientRect();
  T("field_covers_where_focus_was", r.left <= fb.left + 1);
  T("field_right", Math.round(document.querySelector(".topbar-row").getBoundingClientRect().right - r.right));
  T("focused", document.activeElement === bar.querySelector(".lib-filter-input"));

  var inp = bar.querySelector(".lib-filter-input");
  inp.value = "ab"; inp.dispatchEvent(new Event("input"));
  await window.__sleep(300);
  T("prefix_sent", q());
  bar.querySelector(".lib-filter-clear").click();
  await window.__sleep(300);
  T("x1_open", shown(bar.querySelector(".lib-filter-box")));
  T("x1_value", bar.querySelector(".lib-filter-input") ? bar.querySelector(".lib-filter-input").value : null);
  T("x1_prefix", q());
  bar.querySelector(".lib-filter-clear").click();
  await window.__sleep(200);
  T("x2_closed", !bar.querySelector(".lib-filter-box"));
  T("x2_focus_back", shown(bar.querySelector(".lib-ctl-focus")));
  T("x2_title_back", shown(title));

  // A tap on an album opens it: the bar stays with the wall underneath.
  // Home takes the controls away.
  window.__showHome();
  await window.__sleep(300);
  T("home_hidden", !shown(bar));
  document.getElementById("home-library-title").click();
  await window.__sleep(400);
  T("back_on_wall", shown(bar));

  // An artist page borrows the grid: the wall's controls go, and come back
  // with the wall on Back.
  window.__showArtistAlbums("Artist One");
  await window.__sleep(500);
  T("artist_hidden", !shown(bar));
  document.getElementById("topbar-back").click();
  await window.__sleep(500);
  T("artist_back_shown", shown(bar));
`;

for (const size of ["390x844", "1280x900"]) {
  test("Library: Focus, Sort and search in the top bar (" + size + ", v1.8.78)", { skip: !harness.available && "no chromium" }, async (t) => {
    const R = harness.renderPage({ stub: STUB, driver: DRIVER, name: "library-topbar-" + size.split("x")[0], windowSize: size });
    harness.assertNoPageError(assert, R);
    await t.test("brass, and the title still has room", () => {
      assert.notEqual(R.glass_brass, "rgba(0, 0, 0, 0)", "the magnifier is not a brass disc");
      assert.equal(R.focus_brass, R.glass_brass, "Focus is not the same brass as the magnifier");
      assert.ok(R.title_w >= 40, "the title is squeezed to " + R.title_w + "px: " + R.title_text);
    });
    await t.test("the field opens over Focus and Sort", () => {
      assert.equal(R.field_open, true);
      assert.equal(R.focus_hidden, true, "Focus is still showing beside the open field");
      assert.equal(R.sort_hidden, true, "Sort is still showing beside the open field");
      assert.equal(R.field_covers_where_focus_was, true, "the field does not reach where Focus was");
      assert.ok(R.field_right <= 8, "the field stops " + R.field_right + "px short of the corner");
      assert.equal(R.focused, true, "the field did not take the keyboard");
      assert.equal(R.prefix_sent, "ab");
    });
    await t.test("× clears the text, then × closes", () => {
      assert.equal(R.x1_open, true, "the first × closed the field");
      assert.equal(R.x1_value, "");
      assert.ok(!R.x1_prefix, "clearing did not clear the filter: " + R.x1_prefix);
      assert.equal(R.x2_closed, true, "the second × did not close the field");
      assert.equal(R.x2_focus_back, true);
      assert.equal(R.x2_title_back, true);
    });
    await t.test("the controls go with the wall", () => {
      assert.equal(R.home_hidden, true, "Focus/Sort stayed in the top bar on Home");
      assert.equal(R.back_on_wall, true);
      assert.equal(R.artist_hidden, true, "Focus/Sort stayed in the top bar over an artist page");
      assert.equal(R.artist_back_shown, true, "Back to the Library did not bring Focus/Sort back");
    });
  });
}
