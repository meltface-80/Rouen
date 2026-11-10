"use strict";
// ---------------------------------------------------------------------------
// v2.0.3-t15: Roon's signal path on Now playing (public/signal-path.js and .css, dev/design/signal-path.md). The
// owner, 2026-11-09: "I also want Roons signal path to be visible from the now playing screen in a similar means to
// roon"; asked how, 2026-11-10: a dot and a card, as Roon; Now playing only.
//
// The shipping page at 390x844 and 1280x800, Now playing opened as a user does (the mini player). The path is the
// owner's read of 2026-11-10 (the Sonos Beam, DSP on) as /api/roon/signal-path says it; the server's read is
// test/unit/roon-direct-signal-path.test.js's.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const ZONE = { zone_id: "16aa", display_name: "TV Speaker", state: "playing", is_previous_allowed: true, is_next_allowed: true, is_seek_allowed: true,
  settings: { shuffle: false, loop: "disabled", auto_radio: false }, outputs: [{ output_id: "o1", display_name: "TV Speaker", is_muted: false, volume: null }],
  now_playing: { line1: "Delaunay's Dilemma", line2: "The Modern Jazz Quartet", line3: "Django", artists: [], length: 240, seek_position: 30 } };
const s = (kind, quality, name, text) => ({ kind, quality, name, text });
const BEAM = { quality: "enhanced", speed: 294.5, clipping: false, format: "FLAC 44.1kHz 16-bit", steps: [
  s("Source", "lossless", "Source", "FLAC 44.1kHz 16-bit · Stereo · Library"), s("UpgradeBitDepth", "lossless", "Bit depth", "16-bit → 64-bit"),
  s("VolumeNormalization", "enhanced", "Volume levelling", "−0.8 dB"), s("HeadroomGain", "enhanced", "Headroom", "−3.0 dB"),
  s("Crossfeed", "enhanced", "Crossfeed", "Bauer stereo-to-binaural"), s("ParametricEQ", "enhanced", "Parametric EQ", "5 filters"),
  s("Truncate", "lossless", "Truncation", "64-bit → 24-bit"), s("Output", "lossless", "Output", "BEAM · Sonos")] };
const PLAIN = { quality: "lossless", speed: 1345.4, clipping: true, format: "FLAC 96kHz 24-bit", steps: [
  s("Source", "lossless", "Source", "FLAC 96kHz 24-bit · Stereo"), s("Raat", "lossless", "RAAT", null), s("Output", "lossless", "Output", "RAAT")] };

const STUB = `
window.__zone = ${JSON.stringify(ZONE)};
window.__sp = { native: true, found: true, zone_id: "16aa", path: ${JSON.stringify(BEAM)} };
window.__spAsked = [];
try { localStorage.setItem("rra-zone", "16aa"); } catch (e) {}
window.__installFetch(function (url) {
  if (url.indexOf("/api/roon/signal-path") > -1) { window.__spAsked.push(url); return window.__json(window.__sp); }
  if (url.indexOf("/api/zone-state") > -1) return window.__json({ zone: window.__zone });
  if (url.indexOf("/api/zones") > -1) return window.__json({ zones: [window.__zone] });
  if (url.indexOf("/api/queue") > -1) return window.__json({ items: [] });
  if (url.indexOf("/api/filters") > -1) return window.__json({ genres: [] });
  if (url.indexOf("/api/home/") > -1) return window.__json({ albums: [], label: null });
  if (url.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (url.indexOf("/api/settings") > -1) return window.__json({});
  if (url.indexOf("/api/random-albums") > -1) return window.__json({ albums: [], total: 0, filtered: false });
  return undefined;
});`;

const LOOK = `
  var st = document.createElement("style"); st.textContent = "*, *::before, *::after { animation: none !important; transition: none !important; }";
  document.head.appendChild(st);
  function $(q) { return document.querySelector(q); }
  function bx(e) { if (!e) return null; var q = e.getBoundingClientRect(); return { l: Math.round(q.left), t: Math.round(q.top), r: Math.round(q.right), b: Math.round(q.bottom), w: Math.round(q.width), h: Math.round(q.height) }; }
  function seen(e) { if (!e) return false; var q = e.getBoundingClientRect(); return q.width > 0 && q.height > 0 && getComputedStyle(e).visibility !== "hidden"; }
  function words(e) { return e ? (e.textContent || "").replace(/\\s+/g, " ").trim() : null; }
  function button() { var b = $("#np-signal"); return { seen: seen(b), text: words(b), dot: b && b.querySelector(".sp-dot") ? b.querySelector(".sp-dot").className : null,
    label: b ? b.getAttribute("aria-label") : null, under: bx($("#np-album")) && bx(b) ? bx(b).t >= bx($("#np-album")).b : null }; }
  function card() { var c = $(".sp-card"); if (!c) return null;
    return { box: bx(c), quality: words($(".sp-quality")), speed: words($(".sp-speed")), clip: seen($(".sp-clip")), role: c.getAttribute("role"), modal: c.getAttribute("aria-modal"),
      steps: Array.prototype.map.call(document.querySelectorAll(".sp-step"), function (li) {
        return [li.querySelector(".sp-dot").className.replace("sp-dot", "").trim(), words(li.querySelector(".sp-name")), li.querySelector(".sp-text") ? words(li.querySelector(".sp-text")) : null]; }) }; }
  await window.__sleep(500);
  var bar = document.getElementById("mini-transport");
  for (var w = 0; w < 40 && bar.classList.contains("hidden"); w++) await window.__sleep(100);
  T("before", { exists: !!$("#np-signal"), seen: seen($("#np-signal")), asked: window.__spAsked.length });
  document.querySelector(".mt-info").click();
  await window.__sleep(700);
`;

const PHONE = LOOK + `
  T("np", { open: $("#album-modal").classList.contains("np-mode"), button: button(), asked: window.__spAsked.slice(-1)[0] || null });
  $("#np-signal").click();
  await window.__sleep(200);
  T("card", { card: card(), focus: document.activeElement && document.activeElement.className, vh: innerHeight, vw: innerWidth });
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await window.__sleep(100);
  T("escaped", { card: !!$(".sp-card"), np: $("#album-modal").classList.contains("np-mode") && !$("#album-modal").classList.contains("hidden"),
    focus: document.activeElement === $("#np-signal") });

  // The path changes while the card is open: both follow within the five seconds.
  $("#np-signal").click();
  await window.__sleep(150);
  window.__sp = { native: true, found: true, zone_id: "16aa", path: ${JSON.stringify(PLAIN)} };
  await window.__sleep(5600);
  T("changed", { button: button(), card: card() });

  // A tap outside closes it.
  $(".sp-card-wrap").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await window.__sleep(100);
  T("outside", !!$(".sp-card"));

  // Native mode off: no path, so no button, and a card open closes.
  $("#np-signal").click();
  await window.__sleep(150);
  window.__sp = { native: false, why: "Native mode is off." };
  await window.__sleep(5600);
  T("off", { button: button(), card: !!$(".sp-card") });

  // Back on, then Now playing closed: the card goes with it, and nothing more is asked while it is shut.
  window.__sp = { native: true, found: true, zone_id: "16aa", path: ${JSON.stringify(BEAM)} };
  await window.__sleep(5600);
  $("#np-signal").click();
  await window.__sleep(150);
  var openBefore = !!$(".sp-card");
  document.getElementById("modal-close-btn").click();
  await window.__sleep(300);
  var n = window.__spAsked.length;
  await window.__sleep(11000);
  T("closed", { openBefore: openBefore, card: !!$(".sp-card"), modalHidden: $("#album-modal").classList.contains("hidden"), askedAfter: window.__spAsked.length - n });

`;

const WIDE = LOOK + `
  $("#np-signal").click();
  await window.__sleep(200);
  T("wide", { card: card(), vw: innerWidth, vh: innerHeight });
`;

test("signal path: Now playing's dot and card, as Roon", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const r = harness.renderPage({ stub: STUB, driver: PHONE, name: "signal-path", windowSize: "390x844", budgetMs: 60000 });
  harness.assertNoPageError(assert, r);

  await t.test("THE one: under the album name, a dot in the path's colour and what the source plays; read for the selected zone", () => {
    assert.equal(r.before.exists, true, "the button is built with Now playing");
    assert.equal(r.before.seen, false, "not shown before Now playing opens");
    assert.equal(r.np.open, true);
    assert.deepEqual([r.np.button.seen, r.np.button.text, r.np.button.under], [true, "FLAC 44.1kHz 16-bit", true]);
    assert.match(r.np.button.dot, /is-enhanced/);
    assert.equal(r.np.button.label, "Signal path: Enhanced. FLAC 44.1kHz 16-bit");
    assert.match(r.np.asked, /\/api\/roon\/signal-path\?zone_id=16aa$/);
  });

  await t.test("a tap opens the card: the quality in words, the speed, each step with its own dot, name and line", () => {
    const c = r.card.card;
    assert.ok(c, "the card opened");
    assert.deepEqual([c.role, c.modal, c.quality, c.speed, c.clip], ["dialog", "true", "Enhanced", "Processing speed 294.5×", false]);
    assert.deepEqual(c.steps, [
      ["is-lossless", "Source", "FLAC 44.1kHz 16-bit · Stereo · Library"], ["is-lossless", "Bit depth", "16-bit → 64-bit"],
      ["is-enhanced", "Volume levelling", "−0.8 dB"], ["is-enhanced", "Headroom", "−3.0 dB"],
      ["is-enhanced", "Crossfeed", "Bauer stereo-to-binaural"], ["is-enhanced", "Parametric EQ", "5 filters"],
      ["is-lossless", "Truncation", "64-bit → 24-bit"], ["is-lossless", "Output", "BEAM · Sonos"]]);
    assert.match(r.card.focus, /sp-close/, "focus on its close button");
    assert.deepEqual([c.box.l, c.box.r, c.box.b], [0, r.card.vw, r.card.vh], "a sheet from the bottom on a phone, edge to edge");
  });

  await t.test("Escape closes it, Now playing stays, focus back on the button", () => {
    assert.deepEqual(r.escaped, { card: false, np: true, focus: true });
  });

  await t.test("the path changing reaches the button and the open card within five seconds; a step saying nothing shows its name alone", () => {
    assert.equal(r.changed.button.text, "FLAC 96kHz 24-bit");
    assert.match(r.changed.button.dot, /is-lossless/);
    assert.deepEqual(r.changed.card.steps, [["is-lossless", "Source", "FLAC 96kHz 24-bit · Stereo"], ["is-lossless", "RAAT", null], ["is-lossless", "Output", "RAAT"]]);
    assert.deepEqual([r.changed.card.quality, r.changed.card.speed, r.changed.card.clip], ["Lossless", "Processing speed 1345.4×", true]);
  });

  await t.test("a tap outside closes it", () => assert.equal(r.outside, false));

  await t.test("no path (native mode off): no button, and the open card closes", () => {
    assert.equal(r.off.button.seen, false);
    assert.equal(r.off.card, false);
  });

  await t.test("Now playing closed: the card goes with it, and nothing is asked while it is shut", () => {
    assert.deepEqual(r.closed, { openBefore: true, card: false, modalHidden: true, askedAfter: 0 });
  });
});

test("signal path: above 720px the card is centred", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const r = harness.renderPage({ stub: STUB, driver: WIDE, name: "signal-path-wide", windowSize: "1280x800" });
  harness.assertNoPageError(assert, r);
  const c = r.wide.card;
  assert.ok(c, "the card opened");
  assert.equal(c.box.w, 420);
  assert.ok(Math.abs((c.box.l + c.box.r) / 2 - r.wide.vw / 2) <= 1, "centred across");
  assert.ok(Math.abs((c.box.t + c.box.b) / 2 - r.wide.vh / 2) <= 1, "centred down");
});
