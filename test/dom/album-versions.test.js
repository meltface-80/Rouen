"use strict";
// ---------------------------------------------------------------------------
// v2.0.3-t16: an album's versions on its page (public/album-versions.js and .css, album-phone.js's tab;
// dev/design/album-versions.md). The owner, 2026-11-09: "I also want versions"; 2026-11-10: streaming versions listed
// too, and a hidden copy's tap opens its tracks, playable.
//
// The shipping page at 390x844 (the VERSIONS tab) and 1280x800 (a section). The versions are the owner's read of The
// Dark Side of the Moon as /api/album/versions says it; the server's read is test/unit/roon-direct-versions.test.js's.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const ZONE = { zone_id: "z1", display_name: "Living Room", state: "stopped", settings: { shuffle: false, loop: "disabled", auto_radio: false },
  outputs: [{ output_id: "o1", display_name: "Living Room", is_muted: false, volume: null }], now_playing: null };
const ALBUM = { offset: 0, title: "The Dark Side of the Moon", subtitle: "Pink Floyd", image_key: "k" };
const NAMES = ["Speak to Me", "Breathe (In the Air)", "On the Run", "Time"];
const v = (id, group, name, format, where, hidden, current) => ({ id, group, name, version: null, format, tracks: 10, where, hidden, current });
const DSOTM = [v("o226343", "library", "50th Anniversary", "FLAC 192kHz 24-bit", "Library", false, true),
  v("l2270255", "library", "The Dark Side of the Moon (1973)", "FLAC 96kHz 24-bit", "Library", true, false),
  v("s201918", "streaming", "The Dark Side Of The Moon (50th Anniversary; 2023 Remaster)", "FLAC 192kHz 24-bit", "TIDAL", false, false)];
const LATE = v("s201662", "streaming", "Version 4", "FLAC 96kHz 24-bit", "TIDAL", false, false);

const STUB = `
window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(performance.now()); }, 16); };
try { localStorage.setItem("rra-zone", "z1"); } catch (e) {}
window.__versions = ${JSON.stringify(DSOTM)}; window.__complete = true; window.__asked = []; window.__played = []; window.__play = { ok: true }; window.__playDelay = 0;
window.__installFetch(function (url, opts) {
  if (url.indexOf("/api/album/versions") > -1) { window.__asked.push(url); return window.__json({ status: "ok", complete: window.__complete, versions: url.indexOf("Meddle") > -1 ? [] : window.__versions }); }
  if (url.indexOf("/api/album/version-tracks") > -1) return window.__json({ status: "ok", tracks: ${JSON.stringify(NAMES)}.map(function (t, i) { return { disc: 1, number: i + 1, title: t, seconds: 120 + i }; }) });
  if (url.indexOf("/api/album/version-play") > -1) {
    window.__played.push(JSON.parse(opts.body));
    var ans = window.__play;
    return window.__playDelay ? new Promise(function (r) { setTimeout(function () { r(window.__json(ans, ans.ok ? 200 : 409)); }, window.__playDelay); }) : window.__json(ans, ans.ok ? 200 : 409);
  }
  if (url.indexOf("/api/user-playlists") > -1) return window.__json({ playlists: [] });
  if (url.indexOf("/api/album/extras") > -1) return window.__json({ album: {} });
  if (url.indexOf("/api/album/credits") > -1) return window.__json({ credits: [], status: "ok" });
  if (url.indexOf("/api/album/track-times") > -1) return window.__json({ status: "none", tracks: [] });
  if (url.indexOf("/api/album/more") > -1) return window.__json({ artist: "Pink Floyd", by: [], appears: [] });
  if (url.indexOf("/api/lastfm/") > -1) return window.__json({ enabled: false });
  if (url.indexOf("/api/album") > -1) return window.__json(Object.assign(${JSON.stringify(ALBUM)}, { actions: [{ kind: "play_now", title: "Play Now" }],
    tracks: ${JSON.stringify(NAMES)}.map(function (t) { return { title: t, subtitle: "Pink Floyd" }; }) }));
  if (url.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (url.indexOf("/api/zones") > -1) return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (url.indexOf("/api/queue") > -1) return window.__json({ items: [] });
  if (url.indexOf("/api/filters") > -1) return window.__json({ genres: [] });
  if (url.indexOf("/api/home/") > -1) return window.__json({ albums: [], label: null });
  if (url.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (url.indexOf("/api/settings") > -1) return window.__json({});
  if (url.indexOf("/api/random-albums") > -1) return window.__json({ albums: [${JSON.stringify(ALBUM)}], total: 1, filtered: false });
  return undefined;
});`;

const LOOK = `
  var st = document.createElement("style"); st.textContent = "*, *::before, *::after { animation: none !important; transition: none !important; }";
  document.head.appendChild(st);
  function $(s) { return document.querySelector(s); }
  function seen(e) { if (!e) return false; var q = e.getBoundingClientRect(); return q.width > 0 && q.height > 0 && getComputedStyle(e).visibility !== "hidden"; }
  function words(e) { return e ? (e.textContent || "").replace(/\\s+/g, " ").trim() : null; }
  function bx(e) { if (!e) return null; var q = e.getBoundingClientRect(); return { l: Math.round(q.left), t: Math.round(q.top), r: Math.round(q.right), b: Math.round(q.bottom), w: Math.round(q.width) }; }
  function rows() { return Array.prototype.map.call(document.querySelectorAll("#album-versions .version-row"), function (r) {
    return [words(r.querySelector(".version-name")), words(r.querySelector(".version-line")), r.querySelector(".version-mark") ? words(r.querySelector(".version-mark")) : null, r.tagName, seen(r)]; }); }
  function vtab() { var b = $('#album-tabs [data-tab="versions"]'); return b ? { seen: seen(b), selected: b.getAttribute("aria-selected") } : null; }
  async function open(album) { window.__openAlbum(album, { source: "search" }); await window.__sleep(1800); }
  await window.__sleep(600);
`;

const PHONE = LOOK + `
  await open(${JSON.stringify(ALBUM)});
  T("opened", { tab: vtab(), section: seen($("#album-versions")), asked: window.__asked.slice(-1)[0] || null, tracks: seen($("#modal-tracks li")) });
  $('#album-tabs [data-tab="versions"]').click(); await window.__sleep(150);
  T("tab", { tab: vtab(), rows: rows(), tracks: seen($("#modal-tracks li")), heading: seen($("#album-versions > .section-label")) });

  // The hidden copy: its sheet, its tracks; Tab goes round its buttons; Play plays it on the zone chosen.
  document.querySelectorAll("#album-versions .version-row")[1].click(); await window.__sleep(300);
  var c = $(".vs-card");
  var tabbed = [];
  for (var i = 0; i < 4; i++) { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })); tabbed.push(document.activeElement.className); }
  T("sheet", { role: c && c.getAttribute("role"), modal: c && c.getAttribute("aria-modal"), title: words($("#vs-title")), line: words($(".vs-line")),
    tracks: Array.prototype.map.call(document.querySelectorAll(".vs-track"), function (li) { return Array.prototype.map.call(li.children, words).join(" "); }), box: bx(c), vw: innerWidth, vh: innerHeight, tabbed: tabbed });
  $(".vs-play").click(); await window.__sleep(300);
  T("played", { sent: window.__played.slice(), open: !!$(".vs-card") });

  // Shuffle, and the zone didn't start: said, and the sheet stays.
  window.__play = { notShown: "Your server took it, but the zone didn't start playing." };
  document.querySelectorAll("#album-versions .version-row")[2].click(); await window.__sleep(300);
  $(".vs-shuffle").click(); await window.__sleep(300);
  T("notShown", { sent: window.__played.slice(-1)[0], note: words($(".vs-note")), open: !!$(".vs-card") });
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await window.__sleep(100);
  T("escaped", { open: !!$(".vs-card"), focus: document.activeElement && document.activeElement.className });
  // The open copy is no button: a tap does nothing.
  document.querySelectorAll("#album-versions .version-row")[0].click(); await window.__sleep(150);
  T("current", !!$(".vs-card"));

  // About with nothing more known says so, the versions being Versions' own (the review).
  $('#album-tabs [data-tab="about"]').click(); await window.__sleep(150);
  T("about", seen($("#album-tab-empty")) ? words($("#album-tab-empty")) : null);
  $('#album-tabs [data-tab="versions"]').click(); await window.__sleep(150);
  // A play answered after its sheet was closed and another opened: the other stays open (the review).
  window.__play = { ok: true }; window.__playDelay = 2000;
  document.querySelectorAll("#album-versions .version-row")[1].click(); await window.__sleep(300);
  $(".vs-play").click(); await window.__sleep(100);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await window.__sleep(100);
  document.querySelectorAll("#album-versions .version-row")[2].click(); await window.__sleep(300);
  await window.__sleep(2500);
  T("latePlay", { open: !!$(".vs-card"), title: words($("#vs-title")) });
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await window.__sleep(100);
  window.__playDelay = 0;

  // An album with only itself: no tab, and on Tracks.
  await open(Object.assign({}, ${JSON.stringify(ALBUM)}, { offset: 7, title: "Meddle" }));
  T("none", { tab: vtab(), section: seen($("#album-versions")), tracks: seen($("#modal-tracks li")) });

  // Still loading: asked again after five seconds, and the late one shown.
  window.__complete = false; window.__versions = ${JSON.stringify(DSOTM)};
  await open(Object.assign({}, ${JSON.stringify(ALBUM)}, { offset: 8 }));
  var n0 = window.__asked.length;
  window.__complete = true; window.__versions = ${JSON.stringify(DSOTM.concat([LATE]))};
  await window.__sleep(5600);
  $('#album-tabs [data-tab="versions"]').click(); await window.__sleep(150);
  T("late", { askedAgain: window.__asked.length - n0, rows: rows().length });

  // Closed while still loading: nothing more asked, nothing left saying it has versions (the review).
  window.__complete = false;
  await open(Object.assign({}, ${JSON.stringify(ALBUM)}, { offset: 9 }));
  document.getElementById("modal-close-btn").click(); await window.__sleep(300);
  var n1 = window.__asked.length;
  await window.__sleep(11000);
  T("closed", { asked: window.__asked.length - n1, versions: $("#album-modal").dataset.versions || "" });
`;

const WIDE = LOOK + `
  await open(${JSON.stringify(ALBUM)});
  T("wide", { section: seen($("#album-versions")), heading: words($("#album-versions > .section-label")), rows: rows().length, tabs: seen($("#album-tabs")) });
  document.querySelectorAll("#album-versions .version-row")[1].click(); await window.__sleep(300);
  T("wideSheet", { box: bx($(".vs-card")), vw: innerWidth });
`;

test("versions: a phone's VERSIONS tab, a version's sheet, played on the zone", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const r = harness.renderPage({ stub: STUB, driver: PHONE, name: "album-versions", windowSize: "390x844", budgetMs: 90000 });
  harness.assertNoPageError(assert, r);

  await t.test("THE one: the tab there once the album has another version; its rows as Roon groups them, marked", () => {
    assert.deepEqual(r.opened.tab, { seen: true, selected: "false" }, "opened on Tracks, the Versions tab beside it");
    assert.equal(r.opened.tracks, true);
    assert.match(r.opened.asked, /\/api\/album\/versions\?title=The\+Dark\+Side\+of\+the\+Moon&artist=Pink\+Floyd$/);
    assert.deepEqual(r.tab.tab, { seen: true, selected: "true" });
    assert.deepEqual(r.tab.rows, [
      ["50th Anniversary", "FLAC 192kHz 24-bit · 10 tracks · Library", "This version", "DIV", true],
      ["The Dark Side of the Moon (1973)", "FLAC 96kHz 24-bit · 10 tracks · Library", "Hidden", "BUTTON", true],
      ["The Dark Side Of The Moon (50th Anniversary; 2023 Remaster)", "FLAC 192kHz 24-bit · 10 tracks · TIDAL", null, "BUTTON", true]]);
    assert.deepEqual([r.tab.tracks, r.tab.heading], [false, false], "the tab shows the versions alone, without a heading");
  });

  await t.test("a hidden copy's sheet: a modal, its line, its tracks; Tab goes round its buttons", () => {
    assert.deepEqual([r.sheet.role, r.sheet.modal, r.sheet.title, r.sheet.line], ["dialog", "true", "The Dark Side of the Moon (1973)", "FLAC 96kHz 24-bit · 10 tracks · Library · Hidden"]);
    assert.deepEqual(r.sheet.tracks, ["1 Speak to Me 2:00", "2 Breathe (In the Air) 2:01", "3 On the Run 2:02", "4 Time 2:03"]);
    assert.deepEqual([r.sheet.box.l, r.sheet.box.r, r.sheet.box.b], [0, r.sheet.vw, r.sheet.vh], "from the bottom, edge to edge");
    assert.deepEqual(r.sheet.tabbed.map((c) => c.split(" ")[0]), ["vs-play", "vs-shuffle", "vs-close", "vs-play"]);
  });

  await t.test("Play: that copy, on the zone chosen, not shuffled; the sheet closes once it plays", () => {
    assert.deepEqual(r.played.sent, [{ title: "The Dark Side of the Moon", artist: "Pink Floyd", id: "l2270255", zone_id: "z1", shuffle: false }]);
    assert.equal(r.played.open, false);
  });

  await t.test("Shuffle the zone didn't take: said under the buttons, the sheet stays; Escape closes it, focus back on its row", () => {
    assert.deepEqual([r.notShown.sent.id, r.notShown.sent.shuffle], ["s201918", true]);
    assert.deepEqual([r.notShown.note, r.notShown.open], ["Your server took it, but the zone didn't start playing.", true]);
    assert.equal(r.escaped.open, false);
    assert.match(r.escaped.focus, /version-row/);
    assert.equal(r.current, false, "the version open opens nothing");
  });

  await t.test("About with nothing more known says so; a play answered after its sheet closed closes no other", () => {
    assert.equal(r.about, "Nothing more is known about this album yet");
    assert.deepEqual(r.latePlay, { open: true, title: "The Dark Side Of The Moon (50th Anniversary; 2023 Remaster)" });
  });

  await t.test("closed while still loading: nothing more asked, and no versions said", () => {
    assert.deepEqual(r.closed, { asked: 0, versions: "" });
  });

  await t.test("an album with only itself: no Versions tab, no section, on Tracks", () => {
    assert.deepEqual(r.none, { tab: { seen: false, selected: "false" }, section: false, tracks: true });
  });

  await t.test("still loading: asked again after five seconds, the late streaming version shown", () => {
    assert.ok(r.late.askedAgain >= 1);
    assert.equal(r.late.rows, 4);
  });
});

test("versions: from 720px up a section of the side column, its sheet centred", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const r = harness.renderPage({ stub: STUB, driver: WIDE, name: "album-versions-wide", windowSize: "1280x800" });
  harness.assertNoPageError(assert, r);
  assert.deepEqual([r.wide.section, r.wide.heading, r.wide.rows, r.wide.tabs], [true, "Versions", 3, false]);
  assert.equal(r.wideSheet.box.w, 440);
  assert.ok(Math.abs((r.wideSheet.box.l + r.wideSheet.box.r) / 2 - r.wideSheet.vw / 2) <= 1, "centred");
});
