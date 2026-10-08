"use strict";
// ---------------------------------------------------------------------------
// v1.8.87: the wall display's Remote button, always there and faint.
//
// Asked for: "When in the wall display screen, you have to tap it once to get
// the '< Remote' button to show … I want the button to be permanent but a
// faint always visible button. If on a black screen it'll be an off white. If
// on a light colour screen it'd be grey."
//
//   1. With nothing touched, it is on screen and takes a tap — and it is
//      faint: no brass fill, off-white at part strength.
//   2. Over a light artist photo it turns grey; over a dark one it stays
//      off-white. What is behind it is READ, from the photo itself.
//   3. Only the part of the photo under the button counts: a light portrait
//      photo letterboxed in the middle of a wide screen leaves the corner black,
//      and the button stays off-white.
//   4. (found in review) When the screen goes black — "Nothing playing", the
//      display switched off, an album with no art — the button goes back to
//      off-white: no grey left over black. And the mouse stays hidden over it
//      until the controls show.
//   5. A photo the server won't pass through (after a restart it has
//      forgotten the address) still shows, straight from its own address.
// The photos are data: URLs drawn by the stub, so the page may read them —
// in the app they come through /api/display/photo for the same reason.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const ZONE = {
  zone_id: "z1", display_name: "Living Room", state: "playing",
  settings: { shuffle: false, loop: "disabled", auto_radio: false }, queue_items_remaining: 1,
  outputs: [{ output_id: "o1", display_name: "Living Room", is_muted: false, volume: null }],
  now_playing: {
    three_line: { line1: "So What", line2: "Miles Davis", line3: "Kind of Blue" },
    line1: "So What", line2: "Miles Davis", line3: "Kind of Blue",
    image_key: "k", artists: [], length: 300, seek_position: 3,
  },
};

// `photo`: a picture the stub paints — w×h, one colour.
const stub = (photo) => `
function __pic(w, h, colour) {
  var c = document.createElement("canvas"); c.width = w; c.height = h;
  var x = c.getContext("2d"); x.fillStyle = colour; x.fillRect(0, 0, w, h);
  return c.toDataURL("image/png");
}
window.__photo = ${photo ? `__pic(${photo.w}, ${photo.h}, "${photo.colour}")` : "null"};
window.__installFetch(function (u) {
  if (u.indexOf("/api/settings/display") > -1) return window.__json({ enabled: true, seconds: 20 });
  if (u.indexOf("/api/settings/waveform") > -1) return window.__json({ enabled: false });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (u.indexOf("/api/zones") > -1)      return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (u.indexOf("/api/display/content") > -1)
    return window.__json({ artistPhotos: window.__photo ? [window.__photo] : [], review: { text: "A record.", attribution: "Somebody" } });
  return undefined;
});
`;

const DRIVER = `
  // This harness never runs a CSS transition to its end: read the colours
  // as they settle.
  var st = document.createElement("style");
  st.textContent = ".to-remote { transition: none !important; }";
  document.head.appendChild(st);
  var bar = document.getElementById("bottombar");
  for (var i = 0; i < 60 && bar.classList.contains("hidden"); i++) await window.__sleep(100);
  await window.__sleep(1200);
  var btn = document.getElementById("to-remote");
  function look() {
    var b = btn.getBoundingClientRect();
    var el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    var cs = getComputedStyle(btn);
    return { hit: !!el && (el === btn || btn.contains(el)), opacity: cs.opacity, color: cs.color,
             bg: cs.backgroundColor, light: btn.classList.contains("on-light"), w: Math.round(b.width) };
  }
  T("untouched", look());
  // Pin the Photos chip (a tap reveals the chips; the tap on the chip pins it).
  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  await window.__sleep(100);
  var chip = Array.prototype.find.call(document.querySelectorAll("#controls .ctl-btn"), function (c) { return c.textContent === "Photos"; });
  T("has_photos", !!chip);
  if (chip) chip.click();
  await window.__sleep(1500);
  T("photo_shown", !!document.querySelector(".slide.visible img.photo"));
  // Let the controls hide again: the resting look is the one asked about.
  document.body.classList.remove("show-ui");
  await window.__sleep(100);
  T("over_photo", look());
  T("cursor_resting", getComputedStyle(btn).cursor);
  // Every slide taken away, as the idle screen, the off switch and an
  // art-less album each do: the button must not stay grey over black.
  document.querySelectorAll(".slide").forEach(function (el) { el.classList.remove("visible"); });
  await window.__sleep(100);
  T("after_black", look());
`;

const rgba = (s) => s.match(/[\d.]+/g).map(Number);

test("the wall display's Remote button is always there, faint, and toned to what is behind it (v1.8.87)", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const white = harness.renderPage({ name: "remote-tone-white", windowSize: "1280x800", page: "display",
    stub: stub({ w: 1600, h: 900, colour: "#f4f4f2" }), driver: DRIVER, budgetMs: 30000 });
  harness.assertNoPageError(assert, white);
  const black = harness.renderPage({ name: "remote-tone-black", windowSize: "1280x800", page: "display",
    stub: stub({ w: 1600, h: 900, colour: "#101010" }), driver: DRIVER, budgetMs: 30000 });
  harness.assertNoPageError(assert, black);
  const tall = harness.renderPage({ name: "remote-tone-tall", windowSize: "1280x800", page: "display",
    stub: stub({ w: 400, h: 1200, colour: "#ffffff" }), driver: DRIVER, budgetMs: 30000 });
  harness.assertNoPageError(assert, tall);

  await t.test("1. untouched, it is on screen, takes a tap, and is faint off-white with no brass fill", () => {
    const u = white.untouched;
    assert.equal(u.hit, true, "the button can't be tapped before the screen is touched");
    assert.equal(u.opacity, "1");
    assert.equal(u.light, false);
    const [r, g, b, a] = rgba(u.color);
    assert.ok(r > 220 && g > 215 && b > 205, "not off-white: " + u.color);
    assert.ok(a !== undefined && a < 0.8 && a > 0.4, "not faint: " + u.color);
    const bg = rgba(u.bg);
    assert.ok(bg[3] === undefined || bg[3] < 0.3, "a solid fill: " + u.bg);
    assert.notDeepEqual(bg.slice(0, 3), [201, 164, 92], "still brass");
  });

  await t.test("2. over a light photo it turns grey; over a dark one it stays off-white", () => {
    assert.equal(white.photo_shown, true, "precondition: the photo slide is up");
    assert.equal(white.over_photo.light, true);
    const [r, g, b] = rgba(white.over_photo.color);
    assert.ok(r < 120 && g < 120 && b < 130, "not grey over the light photo: " + white.over_photo.color);
    assert.equal(white.over_photo.hit, true);
    assert.equal(black.photo_shown, true);
    assert.equal(black.over_photo.light, false);
    assert.ok(rgba(black.over_photo.color)[0] > 220, "not off-white over the dark photo");
  });

  await t.test("3. a light photo letterboxed in the middle leaves the corner black: off-white", () => {
    assert.equal(tall.photo_shown, true);
    assert.equal(tall.over_photo.light, false, "the black letterbox under the button was read as the photo");
  });

  await t.test("4. a black screen after a light photo puts it back to off-white; the mouse stays hidden", () => {
    assert.equal(white.over_photo.light, true, "precondition: grey over the light photo");
    assert.equal(white.after_black.light, false, "grey left over a black screen");
    assert.equal(white.cursor_resting, "none", "a hand cursor over the button that never hides");
  });
});

test("a photo the server won't pass through still shows, from its own address (v1.8.87)", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const direct = "https://assets.fanart.tv/fanart/music/x/artistbackground/miles.jpg";
  const r = harness.renderPage({ name: "remote-tone-direct", windowSize: "1280x800", page: "display",
    // Every address the page gives an image, in order — a failed file: load
    // leaves no resource entry to read afterwards.
    stub: `
var __d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
window.__srcs = [];
Object.defineProperty(HTMLImageElement.prototype, "src", { configurable: true, get: __d.get,
  set: function (v) { window.__srcs.push(String(v)); __d.set.call(this, v); } });
` + stub(null).replace("artistPhotos: window.__photo ? [window.__photo] : []", "artistPhotos: [" + JSON.stringify(direct) + "]"),
    driver: DRIVER.replace('T("cursor_resting"', 'var p1 = document.querySelector(".slide.visible img.photo"); T("src_now", p1 && p1.src); T("cursor_resting"') +
      // What the browser asked for, in order: the pass-through first.
      'T("asked", window.__srcs.filter(function (n) { return /photo|fanart/.test(n); }));',
    budgetMs: 30000 });
  harness.assertNoPageError(assert, r);
  assert.ok(r.asked.length >= 1, "nothing was asked for: " + JSON.stringify(r.asked));
  assert.match(r.asked[0], /\/api\/display\/photo\?u=https%3A%2F%2Fassets\.fanart\.tv%2F/, "not asked through the server first: " + JSON.stringify(r.asked));
  assert.equal(r.src_now, direct, "the failed pass-through did not fall back to the photo's own address");
});
