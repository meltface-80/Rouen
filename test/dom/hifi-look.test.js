"use strict";
// ---------------------------------------------------------------------------
// v1.8.79: the rest of Mandarin's Late-Night Hi-Fi look.
//
// Mandarin's data-palette="hifi" has been graphite and brass since its
// v0.5.42 — the same tokens as Graphite here, which v1.8.74 ported with most of
// its rules. This pins the ones that port left out:
//
//   1. Label of the week's name on a line of its own under the heading, with
//      the heading's text still reading "Label of the week: <label>" — the
//      flex row the heading is would otherwise sit the name beside it, which is
//      what Mandarin itself does.
//   2. Settings' ‹ and × are brass discs at the top bar's size.
//   3. Now playing's seek bar without a waveform is the level meter: its
//      unplayed part comes from --seek-rest, which paintSeek reads.
//      The segments are cut by a layer of ground over the fill, not by a mask:
//      a mask on the track masked the THUMB too (it lives inside the track in
//      WebKit/Chromium), and the handle vanished. Pixel-checked below.
//   5. The sample-rate badge sits on the cover's corner, not the art box's
//      (the cover is a square inside a box that is not).
//   4. The theme picker and the sample-rate switch live in UI Settings, and
//      Appearance is gone — no tile without a pane, no pane without a tile.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const ZONE = {
  zone_id: "z1", display_name: "Living Room", state: "paused",
  is_previous_allowed: true, is_next_allowed: true, is_seek_allowed: true,
  settings: { shuffle: false, loop: "disabled", auto_radio: false },
  outputs: [{ output_id: "o1", display_name: "Living Room", is_muted: false,
              volume: { type: "number", min: 0, max: 100, value: 40, step: 1 } }],
  now_playing: { line1: "Sunday", line2: "David Bowie", line3: "Heathen",
                 image_key: "k", length: 285, seek_position: 34 },
};
const ALBUMS = [0, 1, 2].map((i) => ({ offset: i, title: "Album " + i, subtitle: "Artist " + i, image_key: null }));

const STUB = `
window.__zone = ${JSON.stringify(ZONE)};
try { localStorage.setItem("rra-zone", "z1"); } catch (e) {}
window.__installFetch(function (u) {
  if (u.indexOf("/api/user-playlists") > -1) return window.__json({ playlists: [] });
  if (u.indexOf("/api/home/label-of-the-week") > -1)
    return window.__json({ label: "Island Records", albums: ${JSON.stringify(ALBUMS)} });
  if (u.indexOf("/api/album") > -1) return window.__json({ title: "Heathen", subtitle: "David Bowie", image_key: "k", tracks: [] });
  if (u.indexOf("/api/random-albums") > -1)
    return window.__json({ albums: ${JSON.stringify(ALBUMS)}, total: 3, filtered: false });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: window.__zone });
  if (u.indexOf("/api/zones") > -1)      return window.__json({ zones: [window.__zone] });
  if (u.indexOf("/api/filters") > -1)    return window.__json({ genres: [] });
  if (u.indexOf("/api/home/") > -1)      return window.__json({ albums: [], label: null });
  if (u.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  if (u.indexOf("/api/settings") > -1)   return window.__json({});
  if (u.indexOf("/api/queue") > -1)      return window.__json({ items: [], history: [] });
  return undefined;
});
`;

const DRIVER = `
  function boxOf(el) { var b = el.getBoundingClientRect();
    return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top),
             bottom: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; }
  await window.__sleep(1500);

  // 1. Label of the week.
  var head = document.getElementById("home-lotw-title");
  var name = head && head.querySelector(".home-lotw-name");
  T("lotw_text", head ? head.textContent : null);
  T("lotw_name", name ? name.textContent : null);
  if (head) head.scrollIntoView();
  await window.__sleep(100);
  // The heading's own words: the first text node.
  var r = document.createRange(); r.selectNodeContents(head.firstChild);
  var words = r.getBoundingClientRect();
  T("lotw_words", { top: Math.round(words.top), bottom: Math.round(words.bottom) });
  T("lotw_name_box", name ? boxOf(name) : null);

  // 2. Settings' ‹ and ×.
  document.getElementById("settings-toggle").click();
  await window.__sleep(300);
  var x = document.querySelector(".settings-app-close");
  T("x_bg", getComputedStyle(x).backgroundColor);
  T("x_box", boxOf(x));
  T("tiles", Array.prototype.map.call(document.querySelectorAll(".settings-nav-item"), function (b) { return b.dataset.pane; }));
  T("panes", Array.prototype.map.call(document.querySelectorAll('.settings-pane[data-view="pane"]'), function (p) { return p.dataset.pane; }));
  document.querySelector('.settings-nav-item[data-pane="ui"]').click();
  await window.__sleep(300);
  var back = document.querySelector('.settings-pane[data-pane="ui"] .settings-back');
  T("back_bg", getComputedStyle(back).backgroundColor);
  T("back_box", boxOf(back));
  T("accent", getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
  T("theme_in_ui", !!document.getElementById("theme-list").closest('[data-pane="ui"]'));
  T("theme_rows", document.querySelectorAll("#theme-list [role=radio], #theme-list .theme-row, #theme-list button").length);
  T("quality_in_ui", !!document.getElementById("quality-toggle").closest('[data-pane="ui"]'));
  document.querySelector(".settings-app-close").click();
  await window.__sleep(300);

  // 3. The seek bar on Now playing.
  var bar = document.getElementById("mini-transport");
  for (var i = 0; i < 40 && bar.classList.contains("hidden"); i++) await window.__sleep(100);
  document.querySelector(".mt-info").click();
  await window.__sleep(1200);
  var seek = document.getElementById("np-seek");
  T("has_wave", document.querySelector(".np-progress").classList.contains("has-wave"));
  T("seek_fill", seek.style.getPropertyValue("--seek-fill"));
  T("seek_rest", getComputedStyle(seek).getPropertyValue("--seek-rest").trim());
  T("seek_box", boxOf(seek));
  T("text_rgb", getComputedStyle(seek).color);
  // 5. The badge, forced on: both rects at driver time.
  document.body.classList.add("show-quality");
  var mq = document.getElementById("modal-quality");
  mq.className = "album-quality"; mq.textContent = "24/96";
  await window.__sleep(100);
  T("badge", boxOf(mq));
  T("cover", boxOf(document.getElementById("modal-img")));
  T("dpr", window.devicePixelRatio || 1);
`;

test("the rest of Mandarin's look (v1.8.79)", { concurrency: 1 }, async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const r = harness.renderPage({ name: "hifi-look", windowSize: "390x844", stub: STUB, driver: DRIVER, screenshot: true });
  harness.assertNoPageError(assert, r);

  await t.test("Label of the week: the name on its own line, the heading text unchanged", () => {
    assert.equal(r.lotw_text, "Label of the week: Island Records",
      "the heading must still read as one phrase to a screen reader");
    assert.equal(r.lotw_name, ": Island Records");
    assert.ok(r.lotw_name_box.top >= r.lotw_words.bottom - 1,
      `the name starts at y=${r.lotw_name_box.top}, above the heading's foot at ${r.lotw_words.bottom} — ` +
      `it is sitting beside the heading, not under it`);
  });

  await t.test("Settings' ‹ and × are brass discs at the top bar's size", () => {
    const accent = r.accent.toLowerCase();
    assert.equal(accent, "#c9a45c", "the default look is not Graphite and Brass");
    for (const [k, bg, box] of [["×", r.x_bg, r.x_box], ["‹", r.back_bg, r.back_box]]) {
      assert.equal(bg, "rgb(201, 164, 92)", `Settings' ${k} is not on the brass (${bg})`);
      assert.equal(box.w, 40, `Settings' ${k} is ${box.w}px wide, not the top bar's 40`);
      assert.equal(box.h, 40);
    }
  });

  await t.test("the theme picker and the sample-rate switch are in UI Settings; Appearance is gone", () => {
    assert.equal(r.theme_in_ui, true);
    assert.ok(r.theme_rows >= 2, "both themes must still be offered");
    assert.equal(r.quality_in_ui, true);
    assert.ok(!r.tiles.includes("appearance"), "the Appearance tile is still listed");
    assert.ok(!r.panes.includes("appearance"), "the Appearance pane is still in the page");
    for (const p of r.tiles) assert.ok(r.panes.includes(p), `the ${p} tile has no pane`);
  });

  await t.test("the seek bar without a waveform rests on the meter's faint segments", () => {
    assert.equal(r.has_wave, false);
    assert.ok(r.seek_rest, "--seek-rest is not set, so the meter has no faint segments");
    assert.match(r.seek_fill, /var\(--seek-rest/,
      "paintSeek must draw the unplayed part from --seek-rest");
  });

  await t.test("the seek handle is still there (a mask on the track hid it)", () => {
    // From the screenshot alone: a column of the thumb's colour TALLER than the
    // 4px track can only be the 14px thumb. Columns, not a position, because the
    // playhead moves between the driver's clock and the screenshot's.
    const { decodePng, pixel } = require("../../lib/png");
    const img = decodePng(r.__png);
    const dpr = r.dpr;
    const near = (p) => p[0] > 200 && p[1] > 200 && p[2] > 190;   // the thumb is --text (#ecebe6)
    let tall = 0;
    for (let x = r.seek_box.left; x < r.seek_box.right; x++) {
      let run = 0, best = 0;
      for (let y = r.seek_box.top - 4; y < r.seek_box.bottom + 4; y++) {
        if (near(pixel(img, Math.round(x * dpr), Math.round(y * dpr)))) { run++; best = Math.max(best, run); } else run = 0;
      }
      if (best >= 9) tall++;
    }
    assert.ok(tall >= 6, `only ${tall} columns of the seek bar are taller than its track — no handle to grab`);
  });

  await t.test("the sample-rate badge sits on the cover", () => {
    const b = r.badge, c = r.cover;
    assert.ok(c.w > 100, "the cover did not lay out");
    assert.ok(b.left >= c.left && b.right <= c.right && b.top >= c.top && b.bottom <= c.bottom,
      `the badge ${JSON.stringify(b)} is not on the cover ${JSON.stringify(c)}`);
    assert.ok(b.left - c.left <= 12 && c.bottom - b.bottom <= 12, "the badge is not at the cover's corner");
  });
});

test("the sample-rate badge follows the cover in landscape (v1.8.79)", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  // Landscape fills the art column and pushes the cover to its inner edge, so
  // the column's corner and the cover's corner are hundreds of px apart.
  const r = harness.renderPage({ name: "hifi-look-land", windowSize: "844x390", stub: STUB, driver: DRIVER });
  harness.assertNoPageError(assert, r);
  const b = r.badge, c = r.cover;
  assert.ok(c.w > 200, "the cover did not lay out");
  assert.ok(b.left >= c.left && b.right <= c.right && b.top >= c.top && b.bottom <= c.bottom,
    `the badge ${JSON.stringify(b)} is not on the cover ${JSON.stringify(c)}`);
  assert.ok(b.left - c.left <= 12 && c.bottom - b.bottom <= 12, "the badge is not at the cover's corner");
});
