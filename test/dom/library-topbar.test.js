"use strict";
// ---------------------------------------------------------------------------
// v1.8.78: the Library wall's Focus, Sort and search, in the top bar.
//
// First asked for: "move the search magnifying glass and focus and sort by
// tools to the top bar and use the brass theme … The x will clear text and x
// will also close the search bar." Then, as Mandarin v0.6.24 did it: Focus and
// Sort in a smaller row of their own under the bar's (Focus left, Sort right),
// the magnifier staying in the bar's row; open, the field takes that row over
// the title, and Focus and Sort stay in theirs.
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
  var topbar = document.querySelector(".topbar");
  var filt = document.getElementById("library-filter");
  var glassEl = filt.querySelector(".lib-filter-btn");
  T("glass_round", Math.abs(glassEl.getBoundingClientRect().width - glassEl.getBoundingClientRect().height) <= 1);
  var ft = bar.querySelector(".lib-ctl-focus .lib-ctl-text");
  T("focus_word_whole", ft.scrollWidth <= ft.clientWidth + 1);
  T("bar_h_wall", Math.round(topbar.getBoundingClientRect().height));
  T("title_w", Math.round(title.getBoundingClientRect().width));
  T("title_text", title.textContent);
  T("glass_brass", getComputedStyle(glassEl).backgroundColor);
  T("pills_under", Math.round(bar.querySelector(".lib-ctl-focus").getBoundingClientRect().top -
                              document.getElementById("topbar-back").getBoundingClientRect().bottom));
  var firstTile = document.getElementById("album-grid").firstElementChild;
  T("grid_clear", firstTile ? Math.round(firstTile.getBoundingClientRect().top - topbar.getBoundingClientRect().bottom) : null);
  T("focus_brass", getComputedStyle(bar.querySelector(".lib-ctl-focus")).backgroundColor);

  var tb0 = title.getBoundingClientRect();
  glassEl.click();
  await window.__sleep(150);
  var field = filt.querySelector(".lib-filter-box");
  T("field_open", shown(field));
  T("focus_kept", shown(bar.querySelector(".lib-ctl-focus")));
  T("sort_kept", shown(bar.querySelector(".lib-ctl-sort")));
  T("title_hidden_open", !shown(title));
  var r = field.getBoundingClientRect();
  T("field_in_bar_row", Math.abs((r.top + r.height / 2) - (document.getElementById("topbar-back").getBoundingClientRect().top +
    document.getElementById("topbar-back").getBoundingClientRect().height / 2)) <= 2);
  T("field_covers_where_title_was", r.left <= tb0.left + 1);
  T("field_right", Math.round(document.querySelector(".topbar-row").getBoundingClientRect().right - r.right));
  T("focused", document.activeElement === filt.querySelector(".lib-filter-input"));
  T("bar_h_open", Math.round(topbar.getBoundingClientRect().height));

  var inp = filt.querySelector(".lib-filter-input");
  inp.value = "ab"; inp.dispatchEvent(new Event("input"));
  await window.__sleep(300);
  T("prefix_sent", q());
  filt.querySelector(".lib-filter-clear").click();
  await window.__sleep(300);
  T("x1_open", shown(filt.querySelector(".lib-filter-box")));
  T("x1_value", filt.querySelector(".lib-filter-input") ? filt.querySelector(".lib-filter-input").value : null);
  T("x1_prefix", q());
  filt.querySelector(".lib-filter-clear").click();
  await window.__sleep(200);
  T("x2_closed", !filt.querySelector(".lib-filter-box"));
  T("x2_focus_back", shown(bar.querySelector(".lib-ctl-focus")));
  T("x2_title_back", shown(title));

  // A tap on an album opens it: the bar stays with the wall underneath.
  // Home takes the controls away.
  window.__showHome();
  await window.__sleep(300);
  T("home_hidden", !shown(bar) && !shown(filt));
  T("bar_h_home", Math.round(topbar.getBoundingClientRect().height));
  document.getElementById("home-library-title").click();
  await window.__sleep(400);
  T("back_on_wall", shown(bar));

  // An artist page borrows the grid: the wall's controls go, and come back
  // with the wall on Back.
  // ...with the field OPEN and a filter typed, and no tap to close it first
  // (a programmatic way off the wall — the review's case).
  filt.querySelector(".lib-filter-btn").click();
  await window.__sleep(100);
  var inp2 = filt.querySelector(".lib-filter-input");
  inp2.value = "al"; inp2.dispatchEvent(new Event("input"));
  await window.__sleep(300);
  window.__showArtistAlbums("Artist One");
  await window.__sleep(500);
  T("artist_hidden", !shown(bar) && !shown(filt));
  T("artist_title_shown", shown(title) && title.textContent);
  var asked = window.__calls.length;
  document.getElementById("topbar-back").click();
  await window.__sleep(600);
  T("artist_back_shown", shown(bar));
  var reread = window.__calls.slice(asked).filter(function (u) { return u.indexOf("/api/library/albums") > -1; });
  T("reread_unfiltered", reread.length > 0 && reread.every(function (u) { return u.indexOf("prefix=") < 0; }));
  T("filter_closed_after", !filt.querySelector(".lib-filter-box"));

  // Field open, then Home without a tap: the next screen's title is not hidden.
  filt.querySelector(".lib-filter-btn").click();
  await window.__sleep(100);
  window.__showHome();
  await window.__sleep(300);
  T("home_no_filtering_class", !topbar.classList.contains("lib-filtering"));
`;

for (const size of ["390x844", "1280x900"]) {
  test("Library: Focus, Sort and search in the top bar (" + size + ", v1.8.78)", { skip: !harness.available && "no chromium" }, async (t) => {
    const R = harness.renderPage({ stub: STUB, driver: DRIVER, name: "library-topbar-" + size.split("x")[0], windowSize: size });
    harness.assertNoPageError(assert, R);
    await t.test("brass, a row of their own, and the title keeps its place", () => {
      assert.notEqual(R.glass_brass, "rgba(0, 0, 0, 0)", "the magnifier is not a brass disc");
      assert.equal(R.focus_brass, R.glass_brass, "Focus is not the same brass as the magnifier");
      assert.equal(R.glass_round, true, "the magnifier is an oval");
      assert.equal(R.focus_word_whole, true, "the word Focus is cut off in its pill");
      assert.ok(R.title_w >= 80, "the title is squeezed to " + R.title_w + "px: " + R.title_text);
      assert.ok(R.pills_under >= 0, "Focus and Sort are not in a row under the bar's (" + R.pills_under + "px)");
      assert.ok(R.bar_h_wall > R.bar_h_home, "the Library's bar has no second row: " + R.bar_h_wall + " vs " + R.bar_h_home);
      assert.ok(R.grid_clear !== null && R.grid_clear >= 0, "the grid starts under the taller bar (" + R.grid_clear + "px)");
      assert.equal(R.bar_h_open, R.bar_h_wall, "opening the field made the top bar " + R.bar_h_open + "px");
    });
    await t.test("the field opens in the bar's row over the title; Focus and Sort stay", () => {
      assert.equal(R.field_open, true);
      assert.equal(R.focus_kept, true, "Focus went when the field opened");
      assert.equal(R.sort_kept, true, "Sort went when the field opened");
      assert.equal(R.title_hidden_open, true, "the title is still showing beside the open field");
      assert.equal(R.field_in_bar_row, true, "the field is not in the bar's row");
      assert.equal(R.field_covers_where_title_was, true, "the field does not reach where the title was");
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
      assert.equal(R.x2_title_back, true, "closing the field did not bring the title back");
    });
    await t.test("the controls go with the wall", () => {
      assert.equal(R.home_hidden, true, "Focus/Sort stayed in the top bar on Home");
      assert.equal(R.back_on_wall, true);
      assert.equal(R.artist_hidden, true, "Focus/Sort stayed in the top bar over an artist page");
      assert.equal(R.artist_back_shown, true, "Back to the Library did not bring Focus/Sort back");
      assert.ok(R.artist_title_shown, "the artist page's title was left hidden by the Library's open field");
      assert.equal(R.reread_unfiltered, true, "Back left the wall showing a filter that is no longer applied");
      assert.equal(R.filter_closed_after, true);
      assert.equal(R.home_no_filtering_class, true, "the open field's class followed you Home");
    });
  });
}
