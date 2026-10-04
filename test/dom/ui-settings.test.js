"use strict";
// ---------------------------------------------------------------------------
// v1.8.77: the Labels screen's search and order, and Settings → UI Settings.
//
// Asked for:
//   * Labels: "a search magnifying glass … in the top right corner like home
//     screen. Search has same function by tapping x. Clears text and tap x
//     again closes search bar", and "means to invert selection # to z and z to
//     #" next to it.
//   * UI Settings: text size for album/artist names and for the grid screen's
//     title; 3 columns / 2 columns / list for album, playlist and label grids;
//     tile size −50% … +50% on all screens.
//
// Everything is measured from the real page, not read back from the settings.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const LABELS = ["Warp", "4AD", "ECM", "Àlpha", "!K7", "Blue Note"];

function stub() {
  return `
try { localStorage.setItem("rra-zone", "z1"); } catch (e) { /* storage optional */ }
var ALBUMS = [];
for (var i = 0; i < 30; i++) ALBUMS.push({ title: "Album " + i, subtitle: "Artist " + i, image_key: null, offset: i });
window.__installFetch(function (u) {
  if (u.indexOf("/api/filters/labels") > -1)
    return window.__json({ labels: ${JSON.stringify(LABELS)}.map(function (t, i) {
      return { title: t, key: "k" + i, subtitle: "3 albums", albumCount: 3 }; }), scanning: false });
  if (u.indexOf("/api/settings/labels") > -1) return window.__json({ enabled: true });
  if (u.indexOf("/api/zones") > -1)      return window.__json({ zones: [{ zone_id: "z1", display_name: "Zone", state: "stopped", outputs: [] }] });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: null });
  if (u.indexOf("/api/queue") > -1)      return window.__json({ items: [] });
  if (u.indexOf("/api/random") > -1)     return window.__json({ albums: ALBUMS });
  if (u.indexOf("/api/home/") > -1)      return window.__json({ albums: ALBUMS.slice(0, 10), label: null });
  if (u.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1)           return window.__json({});
  return undefined;
});
`;
}

const LABELS_DRIVER = `
  await window.__sleep(700);
  var tools = document.getElementById("labels-tools");
  T("tools_on_home", !tools.classList.contains("hidden"));
  document.getElementById("labels-toggle").click();
  await window.__sleep(600);
  function names() {
    return [].map.call(document.querySelectorAll("#album-grid .label-tile .album-title"), function (e) { return e.textContent; });
  }
  var bar = document.querySelector(".topbar").getBoundingClientRect();
  var glass = document.getElementById("labels-search-open").getBoundingClientRect();
  var order = document.getElementById("labels-order").getBoundingClientRect();
  T("tools_on_labels", !tools.classList.contains("hidden"));
  T("glass_right_gap", Math.round(bar.right - glass.right));
  T("order_left_of_glass", order.right <= glass.left + 1 && Math.abs((order.top + order.height / 2) - (glass.top + glass.height / 2)) <= 2);
  T("asc", names());
  T("order_txt_asc", document.getElementById("labels-order-txt").textContent);

  document.getElementById("labels-order").click();
  await window.__sleep(100);
  T("desc", names());
  T("order_txt_desc", document.getElementById("labels-order-txt").textContent);
  T("dir_stored", localStorage.getItem("rra-label-dir"));
  document.getElementById("labels-order").click();
  await window.__sleep(100);

  document.getElementById("labels-search-open").click();
  await window.__sleep(50);
  var row = document.getElementById("labels-search-row");
  T("open_after_glass", row.classList.contains("open"));
  T("title_hidden_while_open", getComputedStyle(document.getElementById("album-count")).display === "none");
  var inp = document.getElementById("labels-search-input");
  inp.value = "ec"; inp.dispatchEvent(new Event("input"));
  await window.__sleep(200);
  T("filtered", names());
  inp.value = "alpha"; inp.dispatchEvent(new Event("input"));   // accents fold
  await window.__sleep(200);
  T("filtered_accent", names());
  inp.value = "zzz"; inp.dispatchEvent(new Event("input"));
  await window.__sleep(200);
  T("none_msg", !!document.querySelector("#album-grid .labels-empty"));

  // A tap away leaves it alone: the filter is the screen's state.
  document.querySelector("main").click();
  await window.__sleep(50);
  T("open_after_tap_away", row.classList.contains("open"));

  document.getElementById("labels-search-clear").click();
  await window.__sleep(200);
  T("x1_open", row.classList.contains("open"));
  T("x1_value", inp.value);
  T("x1_names", names().length);
  document.getElementById("labels-search-clear").click();
  await window.__sleep(100);
  T("x2_open", row.classList.contains("open"));
  T("glass_back", !document.getElementById("labels-search-open").classList.contains("hidden"));

  // Leaving Labels takes the tools with it.
  document.getElementById("topbar-back").click();
  await window.__sleep(400);
  T("tools_after_back", !tools.classList.contains("hidden"));
`;

const GRID_DRIVER = `
  await window.__sleep(700);
  // The random wall: the shared grid every wall uses.
  document.getElementById("menu-toggle").click();
  await window.__sleep(150);
  document.querySelector('.menu-item[data-action="shuffle"]').click();
  await window.__sleep(700);
  var grid = document.getElementById("album-grid");
  function cols() {
    var arts = [].slice.call(grid.querySelectorAll(".album .album-art-wrap")).slice(0, 12);
    var tops = arts.map(function (a) { return Math.round(a.getBoundingClientRect().top); });
    var n = 0; for (var i = 0; i < tops.length; i++) if (tops[i] === tops[0]) n++;
    return { n: n, w: Math.round(arts[0].getBoundingClientRect().width) };
  }
  T("grid_default", cols());
  T("grid_w", Math.round(grid.getBoundingClientRect().width));

  // Settings → UI Settings drives everything below through its selects.
  document.getElementById("settings-toggle").click();
  await window.__sleep(200);
  document.querySelector('.settings-nav-item[data-pane="ui"]').click();
  await window.__sleep(200);
  function pick(id, v) { var s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event("change")); }

  pick("ui-layout-select", "2"); await window.__sleep(100);
  T("grid_2", cols());
  pick("ui-layout-select", "3"); await window.__sleep(100);
  T("grid_3", cols());
  pick("ui-layout-select", "list"); await window.__sleep(100);
  T("as_list", grid.classList.contains("as-list"));
  T("view_key", localStorage.getItem("rra-album-view"));
  pick("ui-layout-select", "auto"); await window.__sleep(100);
  T("as_list_after_auto", grid.classList.contains("as-list"));

  pick("ui-tile-select", "1.5"); await window.__sleep(100);
  T("grid_tile_150", cols());
  pick("ui-tile-select", "0.5"); await window.__sleep(100);
  T("grid_tile_50", cols());
  // A fixed column count is not moved by tile size.
  pick("ui-layout-select", "3"); await window.__sleep(100);
  T("grid_3_tile_50", cols());
  pick("ui-layout-select", "auto");
  pick("ui-tile-select", "1.25"); await window.__sleep(100);

  pick("ui-text-select", "1.5");
  pick("ui-title-select", "1.25");
  await window.__sleep(100);
  T("title_font", parseFloat(getComputedStyle(grid.querySelector(".album-title")).fontSize));
  T("artist_font", parseFloat(getComputedStyle(grid.querySelector(".album-artist")).fontSize));
  T("count_font", parseFloat(getComputedStyle(document.getElementById("album-count")).fontSize));

  // Reopening Settings shows what was chosen.
  document.querySelector('[data-settings-close]').click();
  await window.__sleep(100);
  document.getElementById("settings-toggle").click();
  await window.__sleep(200);
  T("reopen", ["ui-text-select", "ui-title-select", "ui-layout-select", "ui-tile-select"].map(function (id) { return document.getElementById(id).value; }));
  document.querySelector('[data-settings-close]').click();

  // Home carousels: the tile width follows Tile size.
  document.getElementById("topbar-back").click();
  await window.__sleep(700);
  var tile = document.querySelector("#home-sections .home-carousel .album");
  T("carousel_tile_w", tile ? Math.round(tile.getBoundingClientRect().width) : null);
`;

test("Labels: search and # ⇄ Z order (v1.8.77)", { skip: !harness.available && "no chromium" }, async (t) => {
  const R = harness.renderPage({ stub: stub(), driver: LABELS_DRIVER, name: "labels-tools", windowSize: "390x844" });
  harness.assertNoPageError(assert, R);

  await t.test("the tools show on Labels only, glass in the corner, order beside it", () => {
    assert.equal(R.tools_on_home, false, "the label tools show on Home");
    assert.equal(R.tools_on_labels, true);
    assert.ok(R.glass_right_gap >= 0 && R.glass_right_gap <= 24, "the glass is " + R.glass_right_gap + "px from the bar's right edge");
    assert.equal(R.order_left_of_glass, true, "the order button is not beside the glass, on its left");
    assert.equal(R.tools_after_back, false, "the label tools stayed after leaving Labels");
  });

  await t.test("# to Z, and the exact reverse", () => {
    assert.deepEqual(R.asc, ["!K7", "4AD", "Àlpha", "Blue Note", "ECM", "Warp"]);
    assert.equal(R.order_txt_asc, "#–Z");
    assert.deepEqual(R.desc, [...R.asc].reverse());
    assert.equal(R.order_txt_desc, "Z–#");
    assert.equal(R.dir_stored, "desc", "the order is not remembered");
  });

  await t.test("search filters, folds accents, and says when nothing matches", () => {
    assert.equal(R.open_after_glass, true);
    assert.equal(R.title_hidden_while_open, true, "the title is not out of the open field's way");
    assert.deepEqual(R.filtered, ["ECM"]);
    assert.deepEqual(R.filtered_accent, ["Àlpha"]);
    assert.equal(R.none_msg, true);
    assert.equal(R.open_after_tap_away, true, "a tap away closed the label search and lost the filter");
  });

  await t.test("× clears the text first, then closes", () => {
    assert.equal(R.x1_open, true, "the first × closed the bar");
    assert.equal(R.x1_value, "");
    assert.equal(R.x1_names, 6, "clearing did not bring every label back");
    assert.equal(R.x2_open, false, "the second × did not close the bar");
    assert.equal(R.glass_back, true);
  });
});

test("UI Settings: layout, tile size, text size (v1.8.77)", { skip: !harness.available && "no chromium" }, async (t) => {
  const R = harness.renderPage({ stub: stub(), driver: GRID_DRIVER, name: "ui-settings", windowSize: "390x844" });
  harness.assertNoPageError(assert, R);

  await t.test("3 columns is the phone default; 2 and 3 columns are fixed", () => {
    assert.equal(R.grid_default.n, 3);
    assert.equal(R.grid_2.n, 2);
    assert.ok(R.grid_2.w > R.grid_default.w * 1.4, "2 columns did not make wider tiles");
    assert.equal(R.grid_3.n, 3);
    assert.equal(R.grid_3_tile_50.n, 3, "tile size moved a fixed column count");
  });

  await t.test("List is the grid/list toggle's own choice", () => {
    assert.equal(R.as_list, true);
    assert.equal(R.view_key, "list");
    assert.equal(R.as_list_after_auto, false);
  });

  await t.test("in Auto, tile size sets how many columns fit", () => {
    assert.equal(R.grid_tile_150.n, 2, "+50% tiles on a phone should be 2 columns");
    assert.equal(R.grid_tile_50.n, 6, "−50% tiles on a phone should be 6 columns");
  });

  await t.test("text sizes scale from each screen's own size", () => {
    assert.equal(R.title_font, 18, "album name: 12px × 1.5");
    assert.equal(R.artist_font, 15.75, "artist name: 10.5px × 1.5");
    assert.equal(R.count_font, 16.25, "grid title: 13px × 1.25");
    assert.deepEqual(R.reopen, ["1.5", "1.25", "auto", "1.25"]);
  });

  await t.test("Home carousel tiles follow Tile size", () => {
    assert.ok(R.carousel_tile_w !== null, "no carousel tile on Home");
    assert.ok(Math.abs(R.carousel_tile_w - 188) <= 1, "carousel tile is " + R.carousel_tile_w + "px, not 150 × 1.25");
  });
});

const DESKTOP_DRIVER = `
  await window.__sleep(700);
  document.getElementById("menu-toggle").click();
  await window.__sleep(150);
  document.querySelector('.menu-item[data-action="shuffle"]').click();
  await window.__sleep(700);
  var grid = document.getElementById("album-grid");
  function cols() {
    var arts = [].slice.call(grid.querySelectorAll(".album .album-art-wrap")).slice(0, 24);
    var tops = arts.map(function (a) { return Math.round(a.getBoundingClientRect().top); });
    var n = 0; for (var i = 0; i < tops.length; i++) if (tops[i] === tops[0]) n++;
    return n;
  }
  T("d_default", cols());
  T("d_count_default", (window.__calls.filter(function (u) { return u.indexOf("random-albums") > -1; }).pop() || "").match(/count=(\\d+)/)[1]);
  try { localStorage.setItem("rra-ui-tile", "1.5"); } catch (e) {}
  window.__uiSettings.set("tile", "1.5"); await window.__sleep(100);
  T("d_tile_150", cols());
  window.__uiSettings.setLayout("3"); await window.__sleep(100);
  T("d_3", cols());
  window.__uiSettings.setLayout("auto");
  window.__uiSettings.set("tile", "1");
  document.getElementById("menu-toggle").click();
  await window.__sleep(150);
  window.__uiSettings.set("tile", "1.5");
  document.querySelector('.menu-item[data-action="shuffle"]').click();
  await window.__sleep(700);
  T("d_count_tile_150", (window.__calls.filter(function (u) { return u.indexOf("random-albums") > -1; }).pop() || "").match(/count=(\\d+)/)[1]);
`;

test("UI Settings on a desktop: 9 columns by default, and a wall still fills the screen (v1.8.77)", { skip: !harness.available && "no chromium" }, async (t) => {
  const R = harness.renderPage({ stub: stub(), driver: DESKTOP_DRIVER, name: "ui-settings-desk", windowSize: "1400x900" });
  harness.assertNoPageError(assert, R);
  await t.test("columns", () => {
    assert.equal(R.d_default, 9);
    assert.equal(R.d_tile_150, 6, "+50% tiles: 9 / 1.5 = 6 columns");
    assert.equal(R.d_3, 3);
  });
  await t.test("the random wall asks for a screenful at the columns it has", () => {
    assert.equal(R.d_count_default, "45");
    assert.equal(R.d_count_tile_150, "30", "6 columns × 5 rows");
  });
});
