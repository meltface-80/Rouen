"use strict";
// ---------------------------------------------------------------------------
// v2.0.3-t13: the album view on a phone held upright, as Mandarin's (public/album-phone.js and .css,
// dev/design/album-phone.md). The owner, 2026-11-09: "I also want the album screens to look like that on Mandarin. I
// want to replicate the credits, about screens"; and 2026-11-10: "Album layout changes not done yet?".
//
// The shipping page at 390x844: the cover centred, the facts line (date · quality · length), the serif title, the
// artists alone on their line, and TRACKS · CREDITS · ABOUT, each showing its part of the page; the tabs held at the top
// as the page scrolls, what passes under them clipped; each new album on Tracks. Wider screens and Now playing as they
// were. The data is a stand-in; the date, label and score come through the subtitle's extras, moved out of app.js.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const TOUCH = ["--blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=1,availableHoverTypes=1", "--hide-scrollbars"];
const ZONE = { zone_id: "z1", display_name: "Living Room", state: "playing", settings: { shuffle: false, loop: "disabled", auto_radio: false },
  outputs: [{ output_id: "o1", display_name: "Living Room", is_muted: false, volume: null }],
  now_playing: { one_line: { line1: "Time" }, two_line: { line1: "Time", line2: "Pink Floyd" }, three_line: { line1: "Time", line2: "Pink Floyd", line3: "The Dark Side of the Moon" },
    image_key: null, length: 409, seek_position: 40 } };
const ALBUM = { offset: 0, title: "The Dark Side of the Moon", subtitle: "Pink Floyd", image_key: "k", quality: "24/192", hires: true };
const NAMES = ["Speak to Me", "Breathe (In the Air)", "On the Run", "Time", "The Great Gig in the Sky", "Money", "Us and Them", "Any Colour You Like", "Brain Damage", "Eclipse"];
const SECS = [68, 163, 225, 413, 283, 382, 469, 206, 226, 123];
const credit = (name, roles) => ({ name, roles, tracks: null, photo: null, source: "roon" });
const CREDITS = [credit("David Gilmour", ["Guitar", "Vocals"]), credit("Roger Waters", ["Bass"]), credit("Richard Wright", ["Keyboards"]), credit("Nick Mason", ["Drums"])];
const DESC = "The Dark Side of the Moon is the eighth studio album by the English rock band Pink Floyd. ".repeat(4);
const MORE = { artist: "Pink Floyd", by: [{ offset: 1, title: "Animals", subtitle: "Pink Floyd", image_key: null }], appears: [] };

const STUB = `
// This harness's virtual clock draws no frame unless asked: a frame is a timer here (as credits-every-view's), and a
// scroll, whose event waits for a frame, is told of (below).
window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(performance.now()); }, 16); };
try { localStorage.setItem("rra-zone", "z1"); localStorage.setItem("rra-show-quality", "1"); } catch (e) {}
window.__long = 1; window.__noCredits = false; window.__allTimes = true; window.__labels = []; window.__creditsLate = 0; window.__partial = false; window.__manyCredits = false;
window.__installFetch(function (url) {
  if (url.indexOf("/api/user-playlists") > -1) return window.__json({ playlists: [] });
  if (url.indexOf("/api/album/extras") > -1)
    return window.__json({ release_date: "1973-03-01", album: { description: ${JSON.stringify(DESC)}, source: "wikipedia", url: "https://en.wikipedia.org/wiki/x",
      label: "Harvest", catno: "SHVL 804", score: 10, isBestNewMusic: true } });
  if (url.indexOf("/api/album/credits") > -1) {
    var many = []; for (var c = 0; c < 40; c++) many.push({ name: "Player " + c, roles: ["Strings"], tracks: null, photo: null, source: "roon" });
    var answer = { credits: window.__noCredits ? [] : window.__manyCredits ? many : ${JSON.stringify(CREDITS)}, status: "ok" };
    return window.__creditsLate ? new Promise(function (r) { setTimeout(function () { r(window.__json(answer)); }, window.__creditsLate); }) : window.__json(answer);
  }
  if (url.indexOf("/api/album/track-times") > -1) {
    var secs = ${JSON.stringify(SECS)}, names = ${JSON.stringify(NAMES)};
    return window.__json({ status: "ok", tracks: names.slice(0, window.__allTimes ? 10 : 9).map(function (t, i) { return { disc: 1, number: i + 1, title: t, seconds: secs[i] }; }) });
  }
  if (url.indexOf("/api/album/more") > -1) return window.__json(${JSON.stringify(MORE)});
  if (url.indexOf("/api/lastfm/") > -1) return window.__json({ enabled: false });
  if (url.indexOf("/api/album") > -1) {
    var rows = []; for (var k = 0; k < window.__long; k++) rows = rows.concat(${JSON.stringify(NAMES)});
    return window.__json(Object.assign(${JSON.stringify(ALBUM)}, { partial: window.__partial, declared_tracks: window.__partial ? 12 : undefined, actions: [{ kind: "play_now", title: "Play Now" }, { kind: "queue", title: "Queue" }],
      tracks: rows.map(function (t) { return { title: t, subtitle: "Pink Floyd" }; }) }));
  }
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
  function bx(e) { if (!e) return null; var q = e.getBoundingClientRect(); return { l: Math.round(q.left), t: Math.round(q.top), r: Math.round(q.right), b: Math.round(q.bottom), w: Math.round(q.width), h: Math.round(q.height) }; }
  function seen(e) { if (!e) return false; var q = e.getBoundingClientRect(); return q.width > 0 && q.height > 0 && getComputedStyle(e).visibility !== "hidden"; }
  function words(e) { return e ? (e.textContent || "").replace(/\\s+/g, " ").trim() : null; }
  function tabs() { return Array.prototype.map.call(document.querySelectorAll("#album-tabs .album-tab"), function (b) { return [words(b), b.getAttribute("aria-selected") === "true", seen(b)]; }); }
  function parts() { return { tracks: seen($("#modal-tracks li")), credits: seen($("#album-modal .credit")), review: seen($("#album-bio-section")), about: seen($("#album-about-head")),
    moreBy: seen($("#album-more-by")), empty: seen($("#album-tab-empty")) ? words($("#album-tab-empty")) : null }; }
  async function open(album) { window.__openAlbum(album, { source: "search" }); await window.__sleep(1800); await frames(); }
  function frames() { return window.__sleep(120); }
  async function scrollTo(y) { var b = $("#album-modal .modal-body"); b.scrollTop = y; b.dispatchEvent(new Event("scroll")); await frames(); }
  await window.__sleep(600);
`;

const PHONE = LOOK + `
  await open(${JSON.stringify(ALBUM)});
  var art = bx($("#album-modal .modal-art"));
  T("first", { tabs: tabs(), parts: parts(), art: art, vw: innerWidth, facts: words($("#album-facts")),
    title: getComputedStyle($("#modal-title")).fontFamily, titleAlign: getComputedStyle($("#modal-title")).textAlign,
    sub: Array.prototype.filter.call($("#modal-subtitle").children, seen).map(words).join(""),
    extrasThere: document.querySelectorAll("#modal-subtitle .modal-sub-extra").length, badge: seen($("#modal-quality")),
    gap: Math.round($("#album-tabs").getBoundingClientRect().top - $("#modal-actions").getBoundingClientRect().bottom),
    listLine: getComputedStyle($("#modal-tracks")).borderTopWidth });
  $('#album-tabs [data-tab="credits"]').click(); await frames();
  T("credits", { tabs: tabs(), parts: parts(), heading: seen($("#album-modal .credits-section > .section-label")) });
  $('#album-tabs [data-tab="about"]').click(); await frames();
  T("about", { tabs: tabs(), parts: parts(), head: words($("#album-about-head")),
    bits: Array.prototype.map.call(document.querySelectorAll("#album-about-head > .album-about-bit"), words) });
  // The label on About is the label's albums, as the subtitle's is.
  var was = window.__showLabelAlbums; window.__showLabelAlbums = function (name) { window.__labels.push(name); };
  $("#album-about-head .modal-artist-link").click(); await window.__sleep(400);
  T("label", { asked: window.__labels.slice(), closed: $("#album-modal").classList.contains("hidden") });
  window.__showLabelAlbums = was;

  // Another album: on Tracks again. No credits: Credits says so. A track without its length: no length at all.
  window.__noCredits = true; window.__allTimes = false; window.__long = 3;
  await open(Object.assign({}, ${JSON.stringify(ALBUM)}, { offset: 7, title: "Meddle" }));
  T("next", { tabs: tabs(), facts: words($("#album-facts")) });
  $('#album-tabs [data-tab="credits"]').click(); await frames();
  T("noCredits", parts());
  $('#album-tabs [data-tab="tracks"]').click(); await frames();

  // The review's: while the credits are still being asked, Credits says nothing yet; then "none known".
  window.__creditsLate = 2500;
  await open(Object.assign({}, ${JSON.stringify(ALBUM)}, { offset: 8, title: "Animals" }));
  $('#album-tabs [data-tab="credits"]').click(); await frames();
  T("asking", parts().empty);
  await window.__sleep(2000);
  T("answered", parts().empty);
  window.__creditsLate = 0;
  // The same album opened again: on Tracks. Now playing over it and Back: on the tab it was left on.
  $("#modal-close-btn").click(); await window.__sleep(600);
  await open(Object.assign({}, ${JSON.stringify(ALBUM)}, { offset: 8, title: "Animals" }));
  T("reopened", tabs().map(function (x) { return x[1]; }));
  $('#album-tabs [data-tab="about"]').click(); await frames();
  document.querySelector("#mini-transport .mt-info").click(); await window.__sleep(1200);
  document.getElementById("modal-home-btn").click(); await window.__sleep(1600);
  T("backFromNp", { tabs: tabs().map(function (x) { return x[1]; }), title: words($("#modal-title")) });
  $('#album-tabs [data-tab="tracks"]').click(); await frames();
  // Roon sent fewer rows than the album has: no length, though each row has one.
  window.__partial = true; window.__allTimes = true; window.__long = 1;
  await open(Object.assign({}, ${JSON.stringify(ALBUM)}, { offset: 9, title: "Ummagumma" }));
  T("partial", { facts: words($("#album-facts")), lengths: document.querySelectorAll("#modal-tracks .t-len").length });
  window.__partial = false; window.__long = 3; window.__allTimes = false; window.__noCredits = false; window.__manyCredits = true;
  await open(Object.assign({}, ${JSON.stringify(ALBUM)}, { offset: 7, title: "Meddle" }));
  // All forty credits shown, so Credits is a long page too.
  $('#album-tabs [data-tab="credits"]').click(); await frames();
  $("#album-credits .more-toggle").click(); await frames();
  $('#album-tabs [data-tab="tracks"]').click(); await frames();

  // Scrolled: the tabs held at the top, the rows passing under them clipped there, never drawn behind the words.
  var body = $("#album-modal .modal-body");
  await scrollTo(900);
  var line = $("#album-tabs").getBoundingClientRect().bottom;
  var under = Array.prototype.filter.call(document.querySelectorAll("#modal-tracks li"), function (li) { var q = li.getBoundingClientRect(); return q.top < line && q.bottom > line; })[0];
  var wrap = $("#album-modal .track-list-wrap");
  T("held", { tabs: bx($("#album-tabs")), line: Math.round(line), wrapTop: Math.round(wrap.getBoundingClientRect().top), clip: wrap.style.clipPath, under: !!under,
    title: $("#modal-title").style.clipPath, scrolled: body.scrollTop });
  // A tab tapped while held, far down Tracks: Credits from its start, under the tabs, not partway down (the review).
  $('#album-tabs [data-tab="credits"]').click(); await frames();
  var cr = $("#album-credits").getBoundingClientRect(), tb = $("#album-tabs").getBoundingClientRect();
  T("switched", { tabsTop: Math.round(tb.top), gap: Math.round(cr.top - tb.bottom) });
  // Scrolling Credits writes the clips, and nothing else: the facts line is not built again for each step (the review:
  // the clip on the credits' column was taken for a change to the page, once a frame).
  var from = $("#album-modal .modal-body").scrollTop;
  var writes = 0, watch = new MutationObserver(function (r) { writes += r.length; });
  watch.observe($("#album-facts"), { childList: true, subtree: true });
  for (var y = from + 30; y < from + 300; y += 30) await scrollTo(y);
  watch.disconnect();
  T("writes", { writes: writes, clipped: !!$("#modal-aside").style.clipPath });
  $('#album-tabs [data-tab="tracks"]').click(); await frames();
  await scrollTo(0);
  T("unheld", { clip: wrap.style.clipPath, title: $("#modal-title").style.clipPath });

  // Now playing: as it was, no tabs.
  document.querySelector("#mini-transport .mt-info").click(); await window.__sleep(1200);
  T("np", { np: $("#album-modal").classList.contains("np-mode"), tabs: seen($("#album-tabs")), facts: seen($("#album-facts")) });
`;

test("a phone: Mandarin's album screen, with Tracks, Credits and About (v2.0.3-t13)", { skip: !harness.available && "no chromium" }, async (t) => {
  const R = harness.renderPage({ name: "album-phone", windowSize: "390x844", stub: STUB, driver: PHONE, chromeArgs: TOUCH, budgetMs: 60000 });
  harness.assertNoPageError(assert, R);
  await t.test("the head: the cover centred, the facts line, the serif title, the artists alone", () => {
    const f = R.first;
    assert.ok(f.art.w >= 255 && f.art.w <= 262 && f.art.w === f.art.h, `min(67vw, 300px) square, not edge to edge: ${JSON.stringify(f.art)}`);
    assert.ok(Math.abs(f.art.l - (f.vw - f.art.r)) <= 1, "centred");
    assert.equal(f.facts, "March 1, 1973·24/192·42:38", "date · quality · the tracks' lengths summed (2,558 s)");
    assert.match(f.title, /Young Serif/);
    assert.equal(f.titleAlign, "center");
    assert.equal(f.sub, "Pink Floyd", "the artists alone on their line");
    assert.ok(f.extrasThere >= 4, "the date, label, number and score still in the subtitle, for wider screens");
    assert.equal(f.badge, false, "the cover's badge gives way to the facts line");
    assert.equal(f.gap, 18, "the tabs 18px under the buttons: their margins do not add up (the review: 40px)");
    assert.equal(f.listLine, "0px", "one line under the tabs, not the list's own as well (the review)");
  });
  await t.test("THE one: three tabs, Tracks first, each showing its part of the page", () => {
    assert.deepEqual(R.first.tabs, [["Tracks", true, true], ["Credits", false, true], ["About", false, true]]);
    assert.deepEqual(R.first.parts, { tracks: true, credits: false, review: false, about: false, moreBy: false, empty: null });
    assert.deepEqual(R.credits.parts, { tracks: false, credits: true, review: false, about: false, moreBy: false, empty: null });
    assert.equal(R.credits.heading, false, "no CREDITS heading under the tab");
    assert.deepEqual(R.about.parts, { tracks: false, credits: false, review: true, about: true, moreBy: true, empty: null });
    assert.deepEqual(R.about.tabs.map((x) => x[1]), [false, false, true]);
  });
  await t.test("About's line: the label, the catalogue number, the score and BNM; the label opens its albums", () => {
    assert.equal(R.about.head, "Harvest·SHVL 804·10.0BNM");
    assert.deepEqual(R.about.bits, ["Harvest", "·SHVL 804", "·10.0BNM"], "each · with the part after it, so a wrapped line never ends on one");
    assert.deepEqual(R.label.asked, ["Harvest"]);
    assert.equal(R.label.closed, true, "as the subtitle's label does: the album closes for the label's page");
  });
  await t.test("another album opens on Tracks; no credits said so; a track without its length, no length at all", () => {
    assert.deepEqual(R.next.tabs.map((x) => x[1]), [true, false, false]);
    assert.equal(R.next.facts, "March 1, 1973·24/192", "never a sum of only some of the tracks");
    assert.equal(R.noCredits.empty, "No credits known for this album yet");
  });
  await t.test("the review's: no note while the credits are asked; each opening on Tracks; Now playing and Back keep the tab; a short list, no length", () => {
    assert.equal(R.asking, null, "nothing said while they are still being asked");
    assert.equal(R.answered, "No credits known for this album yet");
    assert.deepEqual(R.reopened, [true, false, false], "the same album opened again: on Tracks");
    assert.deepEqual(R.backFromNp.tabs, [false, false, true], "back from Now playing: on About, as left");
    assert.equal(R.backFromNp.title, "Animals");
    assert.deepEqual(R.partial, { facts: "March 1, 1973·24/192", lengths: 10 }, "Roon sent 10 of 12 rows, each with its length: their sum is not the album's length");
  });
  await t.test("the review's: scrolling rewrites nothing but the clips; a tab tapped while held opens at its start", () => {
    assert.deepEqual(R.writes, { writes: 0, clipped: true }, "Credits scrolled under the tabs, clipped, and nothing else written");
    assert.equal(R.switched.tabsTop, 0, "the tabs still at the top");
    assert.ok(R.switched.gap >= 0 && R.switched.gap <= 30, `the credits start ${R.switched.gap}px under the tabs`);
  });
  await t.test("scrolled: the tabs held at the top, what passes under them clipped; scrolled back, nothing clipped", () => {
    assert.equal(R.held.tabs.t, 0, "held at the top of the screen");
    assert.equal(R.held.under, true, "a row is passing under the tabs");
    assert.equal(R.held.clip, `inset(${R.held.line - R.held.wrapTop}px 0px 0px)`, "the tracks clipped at the line under the tabs");
    assert.match(R.held.title, /^inset\(/, "the title, gone up past them, clipped too");
    assert.equal(R.unheld.clip, "");
    assert.equal(R.unheld.title, "");
  });
  await t.test("Now playing as it was: no tabs, no facts line", () => {
    assert.deepEqual(R.np, { np: true, tabs: false, facts: false });
  });
});

const WIDE = LOOK + `
  await open(${JSON.stringify(ALBUM)});
  T("wide", { tabs: seen($("#album-tabs")), facts: seen($("#album-facts")), about: seen($("#album-about-head")),
    sub: words($("#modal-subtitle")), tracks: seen($("#modal-tracks li")), credits: seen($("#album-modal .credit")), review: seen($("#album-bio-section")) });
`;

for (const [size, args] of [["820x1180", TOUCH], ["1280x800", []]]) {
  test(`${size}: the album view as it was — no tabs, the subtitle whole (v2.0.3-t13)`, { skip: !harness.available && "no chromium" }, () => {
    const R = harness.renderPage({ name: "album-phone-" + size, windowSize: size, stub: STUB, driver: WIDE, chromeArgs: args, budgetMs: 30000 });
    harness.assertNoPageError(assert, R);
    assert.deepEqual([R.wide.tabs, R.wide.facts, R.wide.about], [false, false, false]);
    assert.equal(R.wide.sub, "Pink Floyd · March 1, 1973 · Harvest · SHVL 804 · 10.0BNM");
    assert.deepEqual([R.wide.tracks, R.wide.credits, R.wide.review], [true, true, true], "tracks, credits and review side by side");
  });
}
