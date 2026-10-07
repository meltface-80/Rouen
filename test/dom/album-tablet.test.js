"use strict";
// ---------------------------------------------------------------------------
// v1.8.81: the album view on a tablet and a desktop (Mandarin v0.7.8, v0.7.10).
//
//   1. From 720px up, "About this album" sits UNDER THE COVER in the left
//      column, the title, buttons and tracks down the right; on a phone it
//      follows the tracks.
//   2. Expanded (Show more), it grows downwards: it never rises over the cover.
//   3. On a touch screen from 720px up the album view is the whole screen; a
//      desktop (a mouse) keeps the card. The media query is a TOP-LEVEL comma
//      list — the parenthesised form is invalid and silently matches nothing,
//      so the parsed rule is checked as well as its effect.
//   4. A ⋯ menu with no room below opens upwards instead (placeOverflowMenu).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const TOUCH = ["--blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=1,availableHoverTypes=1"];
const ZONE = { zone_id: "z1", display_name: "Living Room", state: "stopped",
  settings: { shuffle: false, loop: "disabled", auto_radio: false },
  outputs: [{ output_id: "o1", display_name: "Living Room", is_muted: false, volume: null }], now_playing: null };
const ALBUM = { offset: 0, title: "Heathen", subtitle: "David Bowie", image_key: "k" };
const DETAIL = { title: "Heathen", subtitle: "David Bowie", image_key: "k",
  actions: [{ kind: "play_now", title: "Play Now" }, { kind: "queue", title: "Queue" },
            { kind: "play_next", title: "Add Next" }, { kind: "shuffle", title: "Shuffle" }, { kind: "radio", title: "Start Radio" }],
  tracks: Array.from({ length: 12 }, (_, i) => ({ title: "Track " + (i + 1), subtitle: "David Bowie" })) };
const DESC = "Heathen is the twenty-second studio album by English musician David Bowie. ".repeat(14);

const STUB = `
try { localStorage.setItem("rra-zone", "z1"); } catch (e) {}
window.__installFetch(function (url) {
  if (url.indexOf("/api/user-playlists") > -1) return window.__json({ playlists: [] });
  if (url.indexOf("/api/album/extras") > -1)
    return window.__json({ album: { description: ${JSON.stringify(DESC)}, source: "wikipedia", url: "https://en.wikipedia.org/wiki/Heathen" } });
  if (url.indexOf("/api/album") > -1)      return window.__json(${JSON.stringify(DETAIL)});
  if (url.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (url.indexOf("/api/zones") > -1)      return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (url.indexOf("/api/queue") > -1)      return window.__json({ items: [] });
  if (url.indexOf("/api/filters") > -1)    return window.__json({ genres: [] });
  if (url.indexOf("/api/home/") > -1)      return window.__json({ albums: [], label: null });
  if (url.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  if (url.indexOf("/api/settings") > -1)   return window.__json({});
  if (url.indexOf("/api/random-albums") > -1)
    return window.__json({ albums: [${JSON.stringify(ALBUM)}], total: 1, filtered: false });
  return undefined;
});`;

const DRIVER = `
  function bx(e) { var q = e.getBoundingClientRect();
    return { l: Math.round(q.left), t: Math.round(q.top), r: Math.round(q.right), b: Math.round(q.bottom) }; }
  await window.__sleep(600);
  window.__openAlbum(${JSON.stringify(ALBUM)}, { source: "search" });
  await window.__sleep(1300);
  T("bio_shown", !document.getElementById("album-bio-section").classList.contains("hidden"));
  T("art", bx(document.querySelector("#album-modal .modal-art")));
  T("info", bx(document.querySelector("#album-modal .modal-info")));
  T("tracks", bx(document.getElementById("modal-tracks")));
  T("aside", bx(document.getElementById("modal-aside")));
  T("panel", bx(document.querySelector("#album-modal .modal-panel")));
  T("vw", innerWidth); T("vh", innerHeight);
  // Expanded the way Show more expands it: the toggle flips data-clipped. The
  // toggle itself is not pressed — whether it has appeared yet depends on a
  // requestAnimationFrame that this harness's virtual clock runs late, on the
  // previous build as on this one.
  var txt = document.getElementById("album-bio-text");
  T("clipped_before", txt.scrollHeight > txt.clientHeight + 4);
  txt.dataset.clipped = "false";
  await window.__sleep(200);
  T("art_after", bx(document.querySelector("#album-modal .modal-art")));
  T("aside_after", bx(document.getElementById("modal-aside")));
  // The parsed media rule.
  var found = [];
  for (var i = 0; i < document.styleSheets.length; i++) {
    var rules; try { rules = document.styleSheets[i].cssRules; } catch (e) { continue; }
    for (var j = 0; j < rules.length; j++) {
      var r = rules[j];
      if (r.media && /modal-panel/.test(r.cssText) && /hover: none/.test(r.media.mediaText) && /720px/.test(r.media.mediaText)) found.push(r.media.mediaText);
    }
  }
  T("tablet_rules", found);
`;

const MENU_DRIVER = `
  await window.__sleep(600);
  window.__openAlbum(${JSON.stringify(ALBUM)}, { source: "search" });
  await window.__sleep(1300);
  var body = document.querySelector("#album-modal .modal-body");
  var acts = document.getElementById("modal-actions");
  // Shrink the scroller so the button row sits at its foot: no room below.
  var btn = acts.querySelector(".overflow-btn");
  body.scrollTop = 0;
  var top = acts.getBoundingClientRect().bottom - body.getBoundingClientRect().top;
  body.style.height = Math.round(top + 20) + "px"; body.style.flex = "none";
  await window.__sleep(100);
  btn.click();
  await window.__sleep(150);
  var menu = acts.querySelector(".overflow-menu");
  T("menu_up", menu.classList.contains("opens-up"));
  var m = menu.getBoundingClientRect(), b = btn.getBoundingClientRect();
  T("menu_above", m.bottom <= b.top + 1);
`;

test("the album view on a tablet, a desktop and a phone (v1.8.81)", { concurrency: 1 }, async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }

  await t.test("a touch tablet: the whole screen, the review under the cover", () => {
    const r = harness.renderPage({ name: "album-tablet", windowSize: "1024x768", stub: STUB, driver: DRIVER, chromeArgs: TOUCH });
    harness.assertNoPageError(assert, r);
    assert.equal(r.bio_shown, true, "the fixture's review did not show");
    // Its SIZE: the harness never advances the entrance animation, which
    // slides the panel 8px, so its position is caught mid-animation.
    assert.deepEqual([r.panel.r - r.panel.l, r.panel.b - r.panel.t], [r.vw, r.vh],
      "on a touch screen from 720px up the album view must fill the screen, not float as a card");
    assert.ok(r.aside.t >= r.art.b - 1 && r.aside.l === r.art.l && r.aside.r <= r.art.r + 1,
      `the review ${JSON.stringify(r.aside)} is not under the cover ${JSON.stringify(r.art)}`);
    assert.ok(r.info.l >= r.art.r, "the title and tracks are not in the right-hand column");
    assert.equal(r.clipped_before, true, "the fixture's review is not long enough to be clipped");
    assert.ok(r.aside_after.b > r.aside.b, "Show more did not lengthen the review: " + JSON.stringify([r.aside, r.aside_after]));
    assert.deepEqual(r.art_after, r.art, "expanding the review moved or shrank the cover");
    assert.ok(r.aside_after.t >= r.art_after.b - 1, "expanded, the review rose over the cover");
    assert.ok(r.tablet_rules.length >= 1, "the tablet rule did not parse: a parenthesised list matches nothing");
    for (const mt of r.tablet_rules) assert.doesNotMatch(mt, /not all/);
  });

  await t.test("a desktop with a mouse keeps the card", () => {
    const r = harness.renderPage({ name: "album-desktop", windowSize: "1280x800", stub: STUB, driver: DRIVER, chromeArgs: harness.MOUSE });
    harness.assertNoPageError(assert, r);
    assert.ok(r.panel.r - r.panel.l < r.vw - 40, "a desktop's album view must stay a card over the page: " + JSON.stringify(r.panel));
    assert.ok(r.aside.t >= r.art.b - 1 && r.aside.l === r.art.l, "the review is not under the cover");
  });

  await t.test("a phone: the review follows the tracks", () => {
    const r = harness.renderPage({ name: "album-phone", windowSize: "390x844", stub: STUB, driver: DRIVER, chromeArgs: TOUCH });
    harness.assertNoPageError(assert, r);
    assert.ok(r.aside.t >= r.tracks.b - 1, `the review starts at ${r.aside.t}, before the tracks end at ${r.tracks.b}`);
  });

  await t.test("a ⋯ menu with no room below opens upwards", () => {
    const r = harness.renderPage({ name: "album-menu-flip", windowSize: "1280x800", stub: STUB, driver: MENU_DRIVER, chromeArgs: harness.MOUSE });
    harness.assertNoPageError(assert, r);
    assert.equal(r.menu_up, true);
    assert.equal(r.menu_above, true, "the menu was turned round but still sits below its button");
  });
});

test("a short album on a desktop is a card its own size, with nothing to scroll (v1.8.81)", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  // The room for the mini player was carried twice — by the scroller and by
  // both columns — and the empty review column took it too: a 3-track album
  // was held at the card's full height with ~350px of nothing under it.
  const extras = 'if (url.indexOf("/api/album/extras") > -1)';
  const short = STUB
    .replace(STUB.slice(STUB.indexOf(extras), STUB.indexOf("\n", STUB.indexOf(extras) + extras.length + 1) + 1),
             extras + " return window.__json({});\n")
    .replace(JSON.stringify(DETAIL), JSON.stringify(Object.assign({}, DETAIL, { tracks: DETAIL.tracks.slice(0, 3) })));
  const r = harness.renderPage({ name: "album-short", windowSize: "1280x800", stub: short, chromeArgs: harness.MOUSE, driver: `
    await window.__sleep(600);
    window.__openAlbum(${JSON.stringify(ALBUM)}, { source: "search" });
    await window.__sleep(1300);
    var body = document.querySelector("#album-modal .modal-body");
    var p = document.querySelector("#album-modal .modal-panel").getBoundingClientRect();
    T("rows", document.querySelectorAll("#modal-tracks li").length);
    T("bio", !document.getElementById("album-bio-section").classList.contains("hidden"));
    T("scrolls", body.scrollHeight > body.clientHeight + 1);
    T("panel_h", Math.round(p.height)); T("vh", innerHeight);
  ` });
  harness.assertNoPageError(assert, r);
  assert.equal(r.rows, 3);
  assert.equal(r.bio, false, "the fixture should have no review");
  assert.equal(r.scrolls, false, "a 3-track album's card scrolls");
  assert.ok(r.panel_h < r.vh - 150, `the card is ${r.panel_h}px tall in an ${r.vh}px window — held at full height`);
});
