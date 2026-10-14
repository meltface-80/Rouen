"use strict";
// ---------------------------------------------------------------------------
// v1.9.25: the album view's ⋯ menu opened DOWN, under the mini transport bar.
//
// Reported from a phone screenshot: Play Next, Radio and Listen later were
// drawn behind the now-playing pill and could not be tapped. The menu chooses
// its side by measuring the room to the foot of the box that clips it — the
// album view's scroller, which runs to the bottom of the window. But the mini
// transport is fixed OVER that box (z-index 70 against the modal's 50), so
// the last ~90px of "room" were never room at all: a menu that fitted on
// paper was drawn under the bar.
//
// Both rects (the menu and the bar) come from the driver, in the same frame
// (dev/lessons.md: two positions in one test come from one source).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const ZONE = {
  zone_id: "z1", display_name: "Living Room", state: "playing",
  is_previous_allowed: true, is_next_allowed: true, is_seek_allowed: true,
  settings: { shuffle: false, loop: "disabled", auto_radio: false },
  outputs: [{ output_id: "o1", display_name: "Living Room", is_muted: false,
              volume: { type: "number", min: 0, max: 100, value: 40, step: 1 } }],
  now_playing: { line1: "Sunday", line2: "David Bowie", line3: "Heathen",
                 image_key: "k", length: 285, seek_position: 34 },
};
const ALBUMS = [{ offset: 0, title: "Heathen", subtitle: "David Bowie", image_key: "k" }];
// Five actions: two on the row, three behind the ⋯, and Listen later after them.
const DETAIL = {
  title: "Heathen", subtitle: "David Bowie", image_key: "k", year: 2002,
  actions: [{ kind: "play_now", title: "Play Now" }, { kind: "queue", title: "Queue" },
            { kind: "play_next", title: "Play Next" }, { kind: "shuffle", title: "Shuffle" },
            { kind: "radio", title: "Start Radio" }],
  tracks: Array.from({ length: 14 }, (_, i) => ({ title: "Track " + (i + 1), subtitle: "David Bowie" })),
};

const STUB = `
window.__zone = ${JSON.stringify(ZONE)};
try { localStorage.setItem("rra-zone", "z1"); }
catch (e) { /* storage optional: the zone falls back to the first */ }
window.__installFetch(function (u) {
  if (u.indexOf("/api/user-playlists") > -1) return window.__json({ playlists: [] });
  if (u.indexOf("/api/album/extras") > -1)   return window.__json({});
  if (u.indexOf("/api/album") > -1)          return window.__json(${JSON.stringify(DETAIL)});
  if (u.indexOf("/api/random-albums") > -1)
    return window.__json({ albums: ${JSON.stringify(ALBUMS)}, total: 1, filtered: false });
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

// scrollTo: where the action row is put before the menu opens — "rest" leaves
// the page as it opens (the screenshot: the row is as low as it goes), "top"
// scrolls it near the top of the screen.
const DRIVER_FOR = (scrollTo) => `
  function box(el) { var b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; }
  await window.__sleep(700);
  document.getElementById("menu-toggle").click();
  await window.__sleep(250);
  document.getElementById("menu-overlay").classList.add("hidden"); window.__applyFilter(null);
  await window.__sleep(900);
  document.querySelectorAll("#album-grid .album")[0].click();
  await window.__sleep(1100);

  var bar = document.getElementById("mini-transport");
  T("bar_shown", !!bar && !bar.classList.contains("hidden") && bar.getBoundingClientRect().height > 0);
  var acts = document.getElementById("modal-actions");
  var body = document.querySelector("#album-modal .modal-body");
  if (${JSON.stringify(scrollTo)} === "top") body.scrollTop += acts.getBoundingClientRect().top - 90;
  await window.__sleep(150);

  var more = acts.querySelector(".overflow-btn");
  more.click();
  await window.__sleep(200);
  var menu = acts.querySelector(".overflow-menu");
  T("menu_open", !!menu && !menu.classList.contains("hidden"));
  T("menu", box(menu));
  T("btn", box(more));
  T("bar", box(bar));
  T("win_h", window.innerHeight);
  T("up", menu.classList.contains("opens-up") ||
          menu.getBoundingClientRect().bottom <= more.getBoundingClientRect().top + 1);
`;

const overlaps = (a, b) => a.top < b.bottom && b.top < a.bottom && a.left < b.right && b.left < a.right;

for (const size of ["390x844", "360x780"]) {
  test("album view at " + size + ": the ⋯ menu opens upward, clear of the mini bar", async (t) => {
    if (!harness.available) { t.skip("no chromium binary available"); return; }
    const r = harness.renderPage({ name: "overflow-mini-" + size.split("x")[0],
                                   windowSize: size, stub: STUB, driver: DRIVER_FOR("rest") });
    harness.assertNoPageError(assert, r);
    assert.equal(r.bar_shown, true, "the mini transport is not on screen — the fixture tests nothing");
    assert.equal(r.menu_open, true, "the ⋯ did not open its menu");
    assert.ok(r.menu.bottom > r.menu.top + 40, "the menu has no height — nothing was measured");
    assert.equal(overlaps(r.menu, r.bar), false,
      "the menu (" + r.menu.top.toFixed(0) + "–" + r.menu.bottom.toFixed(0) + ") is drawn under the mini bar (" +
      r.bar.top.toFixed(0) + "–" + r.bar.bottom.toFixed(0) + ") — the reported bug");
    assert.equal(r.up, true, "the menu opened down, toward the bar");
    assert.ok(r.menu.top >= 0, "turned upward, the menu runs off the top of the screen");
  });
}

// The other side of the rule: with room below the row and above the bar, the
// menu still opens down as it always has — the bar is counted, not a reason to
// open every menu upward.
test("album view at 390x844, row near the top: the ⋯ menu still opens down", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const r = harness.renderPage({ name: "overflow-mini-390-top", windowSize: "390x844",
                                 stub: STUB, driver: DRIVER_FOR("top") });
  harness.assertNoPageError(assert, r);
  assert.equal(r.bar_shown, true, "the mini transport is not on screen — the fixture tests nothing");
  assert.equal(r.menu_open, true, "the ⋯ did not open its menu");
  assert.ok(r.btn.top < 200, "the row was not scrolled near the top (" + r.btn.top + ") — the case is not tested");
  assert.equal(r.up, false, "the menu opened up with the whole screen free below it");
  assert.equal(overlaps(r.menu, r.bar), false, "the menu is drawn under the mini bar");
});
