"use strict";
// ---------------------------------------------------------------------------
// v1.9.3: Shelf, after a first look at it on an iPad.
//
//   1. It does not zoom: a pinch is the shelf's, not the page's.
//   2. The foot of the shelf is the remote's mini transport, fixed and flat:
//      play/pause, the position, what is playing and where, zone and volume;
//      a tap on the record brings it to the front of the shelf.
//   3. The gesture legend is gone from the foot — and so is its habit of
//      lighting up in brass as each gesture is used.
//   4. Instead the gestures are a popup: the first time Shelf is opened, and
//      again after each update until "Don't show again" is ticked.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");
const { buildShelf, shelfSignature } = require("../../lib/shelf");

const RECORDS = [
  ["Air", "Moon Safari"], ["Burial", "Untrue"], ["Daft Punk", "Discovery"], ["Kraftwerk", "Trans-Europe Express"],
  ["Massive Attack", "Blue Lines"], ["Massive Attack", "Mezzanine"], ["Portishead", "Dummy"], ["Radiohead", "Kid A"],
  ["Sade", "Diamond Life"], ["Talking Heads", "Remain in Light"],
];
const SHELF = buildShelf(
  RECORDS.map(([artist, title], i) => ({ offset: 100 + i, title, subtitle: artist, image_key: "k" + i })),
  { genresOf: () => ["Electronic"], firstOf: (al) => al.subtitle.toLowerCase() });
const ANSWER = Object.assign({ total: SHELF.albums.length, rev: "1.0", sig: shelfSignature(SHELF) }, SHELF);
const ZONES = [{ zone_id: "z1", display_name: "Living Room", state: "playing" }];
const zone = (volume) => ({ zone_id: "z1", display_name: "Living Room", state: "playing",
  outputs: [{ output_id: "o1", display_name: "Living Room", volume }],
  now_playing: { line1: "Teardrop", line2: "Massive Attack", line3: "Mezzanine", image_key: "k5", length: 300, seek_position: 60 } });

const stub = (opts) => `
window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(performance.now()); }, 16); };
window.cancelAnimationFrame = function (id) { clearTimeout(id); };
window.__posts = [];
try {
  localStorage.clear();
  var __st = ${JSON.stringify(opts.storage || { "rra-zone": "z1" })};
  for (var k in __st) localStorage.setItem(k, __st[k]);
} catch (e) { /* storage is always there in this harness */ }
window.__installFetch(function (u, o) {
  if (o && o.method === "POST") window.__posts.push({ url: u, body: JSON.parse(o.body) });
  if (u.indexOf("/api/shelf/albums") > -1) return window.__json(${JSON.stringify(ANSWER)});
  if (u.indexOf("/api/update/status") > -1) return window.__json({ current: ${JSON.stringify(opts.version || "1.9.3")} });
  if (u.indexOf("/api/live") > -1) return window.__json({ rev: { library: "1.0", settings: "1" } });
  if (u.indexOf("/api/settings/display") > -1) return window.__json({ enabled: false });
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: ${JSON.stringify(ZONES)} });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(Object.assign(zone(opts.volume === undefined ? { type: "number", min: 0, max: 100, value: 40, step: 1 } : opts.volume), opts.np === undefined ? {} : { now_playing: opts.np }))} });
  if (u.indexOf("/api/control") > -1) return window.__json(${opts.controlFails ? '{ error: "Not paired with Roon Core" }, 503' : "{ ok: true }"});
  if (u.indexOf("/api/volume") > -1 || u.indexOf("/api/play") > -1) return window.__json({ ok: true });
  return undefined;
});
`;

const WAIT = `
  var S = function () { return window.__shelfState(); };
  for (var i = 0; i < 80 && !(S() && S().N); i++) await window.__sleep(100);
  await window.__sleep(700);
  var shown = function (sel) { var el = document.querySelector(sel); return !!el && !el.classList.contains("hidden"); };
`;

function render(name, opts, driver) {
  return harness.renderPage({ name, page: "shelf", windowSize: "1366x1024", budgetMs: 30000, stub: stub(opts), driver: WAIT + driver });
}

test("Shelf does not zoom (v1.9.3)", { skip: !harness.available }, async (t) => {
  const r = render("shelf193-zoom", {}, `
    var vp = document.querySelector('meta[name="viewport"]').getAttribute("content");
    T("viewport", vp);
    var g = new Event("gesturestart", { cancelable: true, bubbles: true });
    document.body.dispatchEvent(g);
    T("gesture_stopped", g.defaultPrevented);
    var mk = function (id, x) { return new Touch({ identifier: id, target: document.body, clientX: x, clientY: 300 }); };
    var two = new TouchEvent("touchmove", { cancelable: true, bubbles: true, touches: [mk(1, 300), mk(2, 500)] });
    document.body.dispatchEvent(two);
    T("pinch_stopped", two.defaultPrevented);
    var one = new TouchEvent("touchmove", { cancelable: true, bubbles: true, touches: [mk(1, 300)] });
    document.body.dispatchEvent(one);
    T("one_finger_free", !one.defaultPrevented);
    var w = new WheelEvent("wheel", { cancelable: true, bubbles: true, ctrlKey: true, deltaY: -10 });
    document.body.dispatchEvent(w);
    T("trackpad_pinch_stopped", w.defaultPrevented);
    T("double_tap", getComputedStyle(document.body).touchAction);
  `);
  harness.assertNoPageError(assert, r);
  await t.test("THE one: a pinch is stopped (iOS ignores the viewport's say-so)", () => {
    assert.equal(r.gesture_stopped, true);
    assert.equal(r.pinch_stopped, true);
    assert.equal(r.trackpad_pinch_stopped, true);
  });
  await t.test("…and a one-finger move is left alone: the shelf and the lists still scroll", () => {
    assert.equal(r.one_finger_free, true);
  });
  await t.test("the viewport says no zoom too, and keeps viewport-fit=cover", () => {
    assert.match(r.viewport, /user-scalable=no/);
    assert.match(r.viewport, /viewport-fit=cover/);
    // test/static/viewport-scale.test.js: maximum-scale=1 is tied to iOS keeping
    // the wrong scale after a rotation, and adds nothing user-scalable=no does not.
    assert.doesNotMatch(r.viewport, /maximum-scale/);
  });
  await t.test("no double-tap zoom", () => assert.equal(r.double_tap, "manipulation"));
});

test("the foot of Shelf is a fixed, flat mini transport (v1.9.3)", { skip: !harness.available }, async (t) => {
  const r = render("shelf193-transport", {}, `
    var help = document.getElementById("help-ok"); if (shown("#help")) help.click();
    T("legend", !!document.getElementById("legend") || !!document.querySelector(".legend"));
    T("np", !!document.getElementById("np"));
    T("lines", { zone: document.getElementById("mt-zone").textContent, title: document.getElementById("mt-title").textContent,
                 artist: document.getElementById("mt-artist").textContent });
    T("pp", { label: document.getElementById("mt-pp").getAttribute("aria-label"), pause: shown("#mt-pause"), play: shown("#mt-play") });
    var w = parseFloat(document.getElementById("mt-fill").style.width);
    T("progress", w);
    var cs = getComputedStyle(document.getElementById("mt"));
    T("flat", { radius: cs.borderTopLeftRadius, position: cs.position, shadow: cs.boxShadow });
    var mt = document.getElementById("mt").getBoundingClientRect(), sh = document.getElementById("shelf").getBoundingClientRect();
    T("fixed_at_foot", { bottom: Math.round(sh.bottom - mt.bottom), full: Math.round(sh.width - mt.width) });
    document.getElementById("mt-pp").click();
    await window.__sleep(200);
    T("control", window.__posts.filter(function (p) { return p.url.indexOf("/api/control") > -1; }).map(function (p) { return p.body; }));
    document.getElementById("mt-vol-btn").click();
    await window.__sleep(100);
    T("vol", { open: shown("#vol"), value: document.getElementById("vol-slider").value, readout: document.getElementById("vol-value").textContent });
    document.getElementById("vol-plus").click();
    await window.__sleep(100);
    T("vol_plus", window.__posts.filter(function (p) { return p.url.indexOf("/api/volume") > -1; }).map(function (p) { return p.body; }));
    // a drag to 60, then + before any poll: from 60, not from the poll's 40
    var sl = document.getElementById("vol-slider");
    sl.value = "60"; sl.dispatchEvent(new Event("input", { bubbles: true }));
    await window.__sleep(50);
    document.getElementById("vol-plus").click();
    await window.__sleep(100);
    var vols = window.__posts.filter(function (p) { return p.url.indexOf("/api/volume") > -1; }).map(function (p) { return p.body.value; });
    T("vol_after_drag", { shown: document.getElementById("vol-value").textContent, last: vols[vols.length - 1] });
    // a press on the shelf closes the sheet
    var st = document.getElementById("stage").getBoundingClientRect();
    document.getElementById("stage").dispatchEvent(new PointerEvent("pointerdown", { pointerId: 3, clientX: st.left + 30, clientY: st.top + 30, bubbles: true, pointerType: "touch", isPrimary: true }));
    document.getElementById("stage").dispatchEvent(new PointerEvent("pointerup", { pointerId: 3, clientX: st.left + 30, clientY: st.top + 30, bubbles: true, pointerType: "touch", isPrimary: true }));
    T("vol_closed", !shown("#vol"));
    // somewhere else on the shelf, then a tap on the playing record
    var before = S().title;
    document.getElementById("stage").focus();
    for (var k = 0; k < 3; k++) { document.getElementById("stage").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); await window.__sleep(500); }
    T("moved_away", S().title !== "Mezzanine");
    document.getElementById("mt-info").click();
    for (var j = 0; j < 60 && S().mode !== "idle"; j++) await window.__sleep(50);
    await window.__sleep(200);
    T("front_after_tap", S().title);
  `);
  harness.assertNoPageError(assert, r);
  await t.test("THE one: the legend and the old now-playing line are gone", () => {
    assert.equal(r.legend, false, "the gesture legend is still on the shelf");
    assert.equal(r.np, false);
  });
  await t.test("what is playing, and where, as the remote's bar shows it", () => {
    assert.deepEqual(r.lines, { zone: "Living Room", title: "Teardrop", artist: "Massive Attack" });
    assert.deepEqual(r.pp, { label: "Pause", pause: true, play: false });
    assert.ok(r.progress >= 19 && r.progress < 25, "position line at " + r.progress + "%, wanted 60 s of 300");
  });
  await t.test("fixed and flat: square, in the page's flow, the shelf's full width, at its foot", () => {
    assert.equal(r.flat.radius, "0px");
    assert.equal(r.flat.shadow, "none");
    assert.notEqual(r.flat.position, "fixed", "a floating pill, not the shelf's foot");
    assert.equal(r.fixed_at_foot.bottom, 0);
    assert.equal(r.fixed_at_foot.full, 0);
  });
  await t.test("play/pause sends playpause to the zone", () => {
    assert.deepEqual(r.control, [{ zone_or_output_id: "z1", command: "playpause" }]);
  });
  await t.test("volume: the zone's level, and + steps it", () => {
    assert.deepEqual(r.vol, { open: true, value: "40", readout: "40" });
    assert.deepEqual(r.vol_plus, [{ zone_or_output_id: "z1", value: 41 }]);
  });
  await t.test("+ steps from what the sheet shows, not from the last poll", () => {
    assert.deepEqual(r.vol_after_drag, { shown: "61", last: 61 });
  });
  await t.test("a press on the shelf closes the volume sheet", () => assert.equal(r.vol_closed, true));
  await t.test("a tap on the playing record brings it to the front of the shelf", () => {
    assert.equal(r.moved_away, true, "precondition: the shelf never left the playing record");
    assert.equal(r.front_after_tap, "Mezzanine");
  });
});

test("the volume sheet stops at an output's soft limit, and an incremental volume only steps", { skip: !harness.available }, async (t) => {
  const soft = render("shelf193-softlimit", { volume: { type: "number", min: 0, max: 100, soft_limit: 70, value: 69, step: 1 } }, `
    document.getElementById("mt-vol-btn").click(); await window.__sleep(100);
    T("max", document.getElementById("vol-slider").max);
    document.getElementById("vol-plus").click(); await window.__sleep(50);
    document.getElementById("vol-plus").click(); await window.__sleep(100);
    T("shown", document.getElementById("vol-value").textContent);
  `);
  harness.assertNoPageError(assert, soft);
  await t.test("THE one: the slider's top is the soft limit, and + stops there", () => {
    assert.equal(soft.max, "70");
    assert.equal(soft.shown, "70");
  });
  const inc = render("shelf193-incremental", { volume: { type: "incremental", step: 1 } }, `
    document.getElementById("mt-vol-btn").click(); await window.__sleep(100);
    T("slider", shown("#vol-slider"));
    document.getElementById("vol-plus").click(); await window.__sleep(100);
    T("sent", window.__posts.filter(function (p) { return p.url.indexOf("/api/volume") > -1; }).map(function (p) { return p.body; }));
  `);
  await t.test("incremental: no slider, and + is a relative step", () => {
    assert.equal(inc.slider, false);
    assert.deepEqual(inc.sent, [{ zone_or_output_id: "z1", relative: 1 }]);
  });
});

test("play/pause that Roon refuses goes back, and says why", { skip: !harness.available }, async (t) => {
  const r = render("shelf193-ppfail", { controlFails: true }, `
    if (shown("#help")) document.getElementById("help-ok").click();
    document.getElementById("mt-pp").click();
    await window.__sleep(300);
    T("label", document.getElementById("mt-pp").getAttribute("aria-label"));
    T("toast", document.getElementById("toast").textContent);
  `);
  harness.assertNoPageError(assert, r);
  await t.test("the button shows the zone as it is, and the toast the reason", () => {
    assert.equal(r.label, "Pause", "the button stayed flipped to a state the zone is not in");
    assert.equal(r.toast, "Roon isn’t connected right now");
  });
});

test("a track with no album (radio, a stream) says so on a tap", { skip: !harness.available }, async (t) => {
  const r = render("shelf193-radio", { np: { line1: "Live from the BBC", line2: "Radio 6", line3: "", length: 0, seek_position: 0 } }, `
    if (shown("#help")) document.getElementById("help-ok").click();
    document.getElementById("mt-info").click();
    await window.__sleep(100);
    T("toast", document.getElementById("toast").textContent);
  `);
  harness.assertNoPageError(assert, r);
  await t.test("not 'Nothing is playing'", () => assert.equal(r.toast, "What’s playing isn’t an album on this shelf"));
});

test("a zone with fixed volume has no volume button to press", { skip: !harness.available }, async (t) => {
  const r = render("shelf193-fixedvol", { volume: null }, `T("disabled", document.getElementById("mt-vol-btn").disabled);`);
  harness.assertNoPageError(assert, r);
  await t.test("disabled", () => assert.equal(r.disabled, true));
});

const HELP = `
  T("help", shown("#help"));
  T("help_text", shown("#help") ? document.getElementById("help").textContent.replace(/\\s+/g, " ") : "");
  if (window.__tick) document.getElementById("help-never").checked = true;
  if (shown("#help")) document.getElementById("help-ok").click();
  T("after", shown("#help"));
  T("saved", localStorage.getItem("rra-shelf-help"));
`;
function helpRun(name, storage, version, tick) {
  return render(name, { storage: Object.assign({ "rra-zone": "z1" }, storage || {}), version }, (tick ? "window.__tick = true;" : "") + HELP);
}

test("the gestures are a popup: first use, then after each update, until 'Don't show again' (v1.9.3)", { skip: !harness.available }, async (t) => {
  const first = helpRun("shelf193-help-first", {}, "1.9.3");
  harness.assertNoPageError(assert, first);
  await t.test("THE one: shown the first time, with all four gestures, and dismissed", () => {
    assert.equal(first.help, true);
    assert.match(first.help_text, /Swipe.*one album/);
    assert.match(first.help_text, /Swipe & hold.*keeps it turning/);
    assert.match(first.help_text, /Flick.*three seconds/);
    assert.match(first.help_text, /Tap/);
    assert.match(first.help_text, /Don’t show again/);
    assert.equal(first.after, false);
    assert.deepEqual(JSON.parse(first.saved), { seen: "1.9.3", never: false });
  });
  const same = helpRun("shelf193-help-same", { "rra-shelf-help": JSON.stringify({ seen: "1.9.3", never: false }) }, "1.9.3");
  await t.test("not again on the same version", () => assert.equal(same.help, false));
  const updated = helpRun("shelf193-help-updated", { "rra-shelf-help": JSON.stringify({ seen: "1.9.3", never: false }) }, "1.9.4");
  await t.test("again after an update, when 'Don't show again' was not ticked", () => {
    assert.equal(updated.help, true);
    assert.deepEqual(JSON.parse(updated.saved), { seen: "1.9.4", never: false });
  });
  const ticked = helpRun("shelf193-help-tick", {}, "1.9.3", true);
  await t.test("ticking 'Don't show again' is remembered…", () => {
    assert.deepEqual(JSON.parse(ticked.saved), { seen: "1.9.3", never: true });
  });
  const never = helpRun("shelf193-help-never", { "rra-shelf-help": JSON.stringify({ seen: "1.9.3", never: true }) }, "2.0.0");
  await t.test("…and then it never shows, update or not", () => assert.equal(never.help, false));
});
