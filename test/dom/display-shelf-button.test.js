"use strict";
// ---------------------------------------------------------------------------
// v1.9.1: the wall display's way on to Shelf.
//
// Asked for: Shelf "will live on the side menu but also have a button on the
// wall display screen, like the remote button, to allow navigation to Shelf
// without jumping through hoops".
//
//   1. It is there untouched, in the top-right corner, opposite Remote, in the
//      same faint off-white pill — and takes a tap.
//   2. Each pill is toned by what is behind IT: over a photo dark on the left
//      and light on the right, Remote stays off-white and Shelf turns grey.
//   3. It opens Shelf in place of the wall display (a replace, so flipping
//      between the two never grows the history), passing on a zone only when
//      the display was given one.
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

const STUB = `
window.__went = [];
navigation.addEventListener("navigate", function (e) {
  window.__went.push({ url: e.destination.url, type: e.navigationType });
  if (e.cancelable) e.preventDefault();
});
// A photo dark on its left half and light on its right.
(function () {
  var c = document.createElement("canvas"); c.width = 1600; c.height = 900;
  var x = c.getContext("2d");
  x.fillStyle = "#101010"; x.fillRect(0, 0, 800, 900);
  x.fillStyle = "#f4f4f2"; x.fillRect(800, 0, 800, 900);
  window.__photo = c.toDataURL("image/png");
})();
window.__installFetch(function (u) {
  if (u.indexOf("/api/settings/display") > -1) return window.__json({ enabled: true, seconds: 20 });
  if (u.indexOf("/api/settings/waveform") > -1) return window.__json({ enabled: false });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (u.indexOf("/api/zones") > -1)      return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (u.indexOf("/api/display/content") > -1)
    return window.__json({ artistPhotos: [window.__photo], review: { text: "A record.", attribution: "Somebody" } });
  return undefined;
});
`;

const DRIVER = `
  var st = document.createElement("style");
  st.textContent = ".to-remote { transition: none !important; }";
  document.head.appendChild(st);
  var bar = document.getElementById("bottombar");
  for (var i = 0; i < 60 && bar.classList.contains("hidden"); i++) await window.__sleep(100);
  await window.__sleep(1200);
  function look(id) {
    var btn = document.getElementById(id), b = btn.getBoundingClientRect();
    var el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return { hit: !!el && (el === btn || btn.contains(el)), color: getComputedStyle(btn).color,
             light: btn.classList.contains("on-light"), left: Math.round(b.left), right: Math.round(innerWidth - b.right),
             top: Math.round(b.top), text: btn.textContent.trim() };
  }
  T("untouched", { remote: look("to-remote"), shelf: look("to-shelf") });
  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  await window.__sleep(100);
  var chip = Array.prototype.find.call(document.querySelectorAll("#controls .ctl-btn"), function (c) { return c.textContent === "Photos"; });
  if (chip) chip.click();
  await window.__sleep(1500);
  document.body.classList.remove("show-ui");
  await window.__sleep(100);
  T("photo_shown", !!document.querySelector(".slide.visible img.photo"));
  T("over_photo", { remote: look("to-remote"), shelf: look("to-shelf") });
  document.getElementById("to-shelf").click();
  await window.__sleep(100);
  T("went", window.__went);
`;

const rgba = (s) => s.match(/[\d.]+/g).map(Number);

test("the wall display's Shelf pill (v1.9.1)", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const r = harness.renderPage({ name: "display-shelf-button", windowSize: "1280x800", page: "display",
    stub: STUB, driver: DRIVER, budgetMs: 30000 });
  harness.assertNoPageError(assert, r);

  await t.test("1. untouched, it is in the top-right corner, opposite Remote, faint, and takes a tap", () => {
    const s = r.untouched.shelf, m = r.untouched.remote;
    assert.equal(s.text, "Shelf");
    assert.equal(s.hit, true);
    assert.ok(s.right <= 20 && s.top <= 20, "not in the top-right corner: " + JSON.stringify(s));
    assert.equal(s.top, m.top, "not level with Remote");
    assert.equal(s.right, m.left, "not the mirror of Remote");
    const [rr, g, b, a] = rgba(s.color);
    assert.ok(rr > 220 && g > 215 && b > 205 && a < 0.8, "not the faint off-white: " + s.color);
  });
  await t.test("2. each pill is toned by what is behind it", () => {
    assert.equal(r.photo_shown, true, "precondition: the photo slide is up");
    assert.equal(r.over_photo.remote.light, false, "Remote went grey over the photo's dark half");
    assert.equal(r.over_photo.shelf.light, true, "Shelf stayed off-white over the photo's light half");
  });
  await t.test("3. it opens Shelf in place of the wall display — and a display given no zone passes none on", () => {
    // Found in review: passing the zone this display merely FOUND playing
    // brought it back pinned, and a pinned display stops following the music.
    assert.equal(r.went.length, 1);
    assert.match(r.went[0].url, /\/shelf$/);
    assert.equal(r.went[0].type, "replace");
  });
});
