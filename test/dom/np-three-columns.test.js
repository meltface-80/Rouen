"use strict";
// ---------------------------------------------------------------------------
// v1.9.70-t11 (dev/design/album-view-landscape.md §5; the owner: Now playing, which opens the same album view, "Yes,
// the same"): on a landscape screen at least 1000px wide and 600px tall, Now playing is the album view's three
// columns. At the left the cover and, under it, what Now playing shows (the track, the seek bar, the transport); in
// the middle what is known about the playing album; at the right the queue, in place of the tracks — so the Now
// playing / Queue tabs go, both being on screen at once. The middle and the queue follow the zone: a new album
// playing brings its review, the queue moving brings its rows. A phone on its side and a portrait screen keep the
// tabs, and the reduced card (a desktop's size button) keeps its two columns. And the review (v1.9.70-t11): Back from
// Now playing to the album it was opened over left the queue on the album view; a radio stream (no album) had its
// song's title asked for as an album's review.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const TOUCH = harness.TOUCH;
const zone = (title, album) => ({ zone_id: "z1", display_name: "Living Room", state: "playing",
  settings: { shuffle: false, loop: "disabled", auto_radio: false },
  outputs: [{ output_id: "o1", display_name: "Living Room", is_muted: false, volume: { type: "number", min: 0, max: 100, value: 40, step: 1 } }],
  is_previous_allowed: true, is_next_allowed: true, is_seek_allowed: true, queue_items_remaining: 30,
  now_playing: { line1: title, line2: "Radiohead", line3: album, image_key: "k-" + album, length: 309, seek_position: 40 } });
const ZONE_A = zone("Idioteque", "Kid A"), ZONE_B = zone("Pyramid Song", "Amnesiac"), RADIO = zone("Everything In Its Right Place", "");
// Long enough to need its own scroll on every screen here.
const queue = (album) => ({ items: Array.from({ length: 30 }, (_, i) => ({ queue_item_id: i + 1, title: album + " " + (i + 1), subtitle: "Radiohead", length: 200 })) });
const desc = (album) => (album + " is a studio album by the English rock band Radiohead. ").repeat(30);
const ALBUM = { offset: 0, title: "Kid A", subtitle: "Radiohead", image_key: "k" };

const STUB = `
try { localStorage.setItem("rra-zone", "z1"); localStorage.removeItem("rra-np-reduced"); } catch (e) { /* storage optional: the zone falls back to the first */ }
window.__zoneNow = ${JSON.stringify(ZONE_A)};
window.__zones = { A: ${JSON.stringify(ZONE_A)}, B: ${JSON.stringify(ZONE_B)}, R: ${JSON.stringify(RADIO)} };
window.__queues = { "Kid A": ${JSON.stringify(queue("Kid A"))}, "Amnesiac": ${JSON.stringify(queue("Amnesiac"))}, "": { items: [] } };
window.__asked = { extras: [], queue: 0 };
window.__installFetch(function (url) {
  var playing = window.__zoneNow.now_playing.line3;
  if (url.indexOf("/api/user-playlists") > -1) return window.__json({ playlists: [] });
  if (url.indexOf("/api/album/extras") > -1) {
    var t = decodeURIComponent((url.match(/title=([^&]*)/) || [])[1] || "").replace(/\\+/g, " ");
    window.__asked.extras.push(t);
    return window.__json({ album: { description: ${JSON.stringify(desc("@"))}.split("@").join(t), source: "wikipedia", url: "https://en.wikipedia.org/wiki/" + t } });
  }
  if (url.indexOf("/api/album/credits") > -1) return window.__json({ credits: [], status: "ok" });
  if (url.indexOf("/api/album/more") > -1)    return window.__json({ artist: "Radiohead", by: [], appears: [] });
  if (url.indexOf("/api/lastfm/") > -1)       return window.__json({ enabled: false });
  if (url.indexOf("/api/album") > -1)
    return window.__json({ title: "Kid A", subtitle: "Radiohead", image_key: "k", actions: [{ kind: "play_now", title: "Play Now" }], tracks: [{ title: "Idioteque" }] });
  if (url.indexOf("/api/zone-state") > -1) return window.__json({ zone: window.__zoneNow });
  if (url.indexOf("/api/zones") > -1)      return window.__json({ zones: [window.__zoneNow] });
  if (url.indexOf("/api/queue") > -1)      { window.__asked.queue++; return window.__json(window.__queues[playing]); }
  if (url.indexOf("/api/filters") > -1)    return window.__json({ genres: [] });
  if (url.indexOf("/api/home/") > -1)      return window.__json({ albums: [], label: null });
  if (url.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  if (url.indexOf("/api/settings") > -1)   return window.__json({});
  if (url.indexOf("/api/random-albums") > -1)
    return window.__json({ albums: [${JSON.stringify(ALBUM)}], total: 1, filtered: false });
  return undefined;
});`;

const DRIVER = `
  var st = document.createElement("style"); st.textContent = "*, *::before, *::after { animation: none !important; transition: none !important; }";
  document.head.appendChild(st);
  function bx(e) { if (!e) return null; var q = e.getBoundingClientRect();
    return { l: Math.round(q.left), t: Math.round(q.top), r: Math.round(q.right), b: Math.round(q.bottom), w: Math.round(q.width), h: Math.round(q.height) }; }
  function $(s) { return document.querySelector(s); }
  function shown(e) { return !!e && getComputedStyle(e).display !== "none" && e.getBoundingClientRect().height > 0; }
  // Over an album, so Back goes to it (the review). The mini player shows once the zone has been read.
  await window.__sleep(1500);
  window.__openAlbum(${JSON.stringify(ALBUM)}, { source: "search" });
  await window.__sleep(900);
  document.querySelector("#mini-transport .mt-info").click();
  await window.__sleep(1800);
  var modal = $("#album-modal"), q = $("#tab-queue"), bio = $("#album-bio-section");
  T("vw", innerWidth); T("vh", innerHeight);
  T("np", modal.classList.contains("np-mode"));
  T("panel", bx($("#album-modal .modal-panel")));
  T("art", bx($("#album-modal .modal-art")));
  T("img", bx($("#modal-img")));
  T("track", bx($("#np-track")));
  T("transport", bx($("#album-modal .np-transport")));
  T("secondary", bx($("#album-modal .np-secondary")));
  T("tabsShown", shown($("#modal-tabs")));
  T("bio", bx(bio)); T("bioShown", shown(bio));
  T("bioText", ($("#album-bio-text").textContent || "").slice(0, 40));
  T("queue", bx(q)); T("queueShown", shown(q));
  T("queueFirst", ($("#queue-list .is-now .q-title") || {}).textContent || null);
  T("tracksShown", shown($("#album-modal .track-list-wrap")));
  T("creditsShown", shown($("#album-modal .credits-section")));
  T("miniShown", shown($("#mini-transport")));
  // The queue scrolls on its own, the cover held; its last row clears the screen's foot.
  var artBefore = bx($("#album-modal .modal-art"));
  q.scrollTop = 1e6; await window.__sleep(150);
  var rows = q.querySelectorAll("#queue-list li");
  T("queueScroll", q.scrollHeight > q.clientHeight);
  T("lastRow", bx(rows[rows.length - 1]));
  T("artAfter", bx($("#album-modal .modal-art"))); T("artBefore", artBefore);
  T("bodyScroll", Math.round($("#album-modal .modal-body").scrollHeight - $("#album-modal .modal-body").clientHeight));
  // The zone moves on to another album: its review and its queue follow, with no tab touched.
  var askedQueue = window.__asked.queue;
  window.__zoneNow = window.__zones.B;
  await window.__sleep(4500);
  T("bioTextB", ($("#album-bio-text").textContent || "").slice(0, 40));
  T("queueFirstB", ($("#queue-list .is-now .q-title") || {}).textContent || null);
  T("queueAskedAgain", window.__asked.queue > askedQueue);
  T("extrasAsked", window.__asked.extras.slice());
  // A radio stream: no album, so no review, and no song's title asked for as an album's.
  window.__zoneNow = window.__zones.R;
  await window.__sleep(3500);
  T("bioShownRadio", shown(bio));
  T("extrasAskedRadio", window.__asked.extras.slice());
  // Back: the album it was opened over, as the album view — its tracks, no queue.
  window.__zoneNow = window.__zones.A;
  document.getElementById("modal-home-btn").click();
  await window.__sleep(1500);
  T("backAlbum", !modal.classList.contains("np-mode") && !modal.classList.contains("hidden"));
  T("albumQueueShown", shown($("#tab-queue")));
  T("albumTracksShown", shown($("#album-modal .track-list-wrap")));
`;

const run = (size, args, name) => harness.renderPage({ name: "np-3col-" + (name || size), windowSize: size, stub: STUB, driver: DRIVER, chromeArgs: args, budgetMs: 40000 });

for (const [size, args, what] of [["1920x1080", harness.MOUSE, "a TV"], ["1440x900", harness.MOUSE, "a desktop"],
  ["1366x1024", TOUCH, "an iPad Pro on its side"], ["1180x820", TOUCH, "an iPad on its side"], ["1024x768", TOUCH, "a small iPad on its side"]]) {
  test(`v1.9.70-t11: ${what} (${size}): Now playing in three columns, the queue at the right`, { skip: !harness.available }, async (t) => {
    const r = run(size, args);
    harness.assertNoPageError(assert, r);
    await t.test("the whole screen, Now playing", () => {
      assert.equal(r.np, true, "Now playing did not open");
      assert.deepEqual([r.panel.w, r.panel.h], [r.vw, r.vh], JSON.stringify(r.panel));
    });
    await t.test("THE one: the cover at the left, the album's review in the middle, the queue at the right, no tabs", () => {
      assert.equal(r.tabsShown, false, "the Now playing / Queue tabs are still shown");
      assert.ok(r.bioShown, "the playing album's review did not show");
      assert.ok(r.queueShown, "the queue is not on screen");
      assert.ok(r.art.r <= r.bio.l && r.bio.r <= r.queue.l, JSON.stringify({ art: r.art, bio: r.bio, queue: r.queue }));
      assert.ok(r.art.w >= 280 && r.art.w <= 420, "the cover's column: " + r.art.w);
      assert.ok(r.queue.w >= 340 && r.queue.w <= 560, "the queue's column: " + r.queue.w);
      assert.ok(Math.abs(r.bio.t - r.art.t) <= 40 && Math.abs(r.queue.t - r.art.t) <= 40, "the three columns start at the top together");
      assert.match(r.bioText, /^Kid A is/, "the review is not the playing album's");
      assert.equal(r.queueFirst, "Kid A 1", "the queue's first row is not the playing track");
    });
    await t.test("under the cover: the track, the transport and the device row, all on screen", () => {
      assert.ok(r.img.w > 200 && Math.abs(r.img.w - r.img.h) <= 2, "the cover is not drawn the column's square: " + JSON.stringify(r.img));
      for (const [k, b] of [["track", r.track], ["transport", r.transport], ["secondary", r.secondary]]) {
        assert.ok(b.t >= r.img.b - 1 && b.l >= r.art.l - 1 && b.r <= r.art.r + 1, `${k} ${JSON.stringify(b)} is not under the cover ${JSON.stringify(r.img)}`);
        assert.ok(b.b <= r.vh, `${k} ends at ${b.b}, off the screen (${r.vh})`);
      }
      assert.ok(r.bodyScroll <= 1, "Now playing scrolls: " + r.bodyScroll);
    });
    await t.test("the album's tracks, credits and other albums are not drawn; Now playing keeps its own transport", () => {
      assert.equal(r.tracksShown, false); assert.equal(r.creditsShown, false); assert.equal(r.miniShown, false);
    });
    await t.test("the queue scrolls on its own, the cover held, its last row on screen", () => {
      assert.ok(r.queueScroll, "30 queued tracks did not need their own scroll");
      assert.deepEqual(r.artAfter, r.artBefore, "scrolling the queue moved the cover");
      assert.ok(r.lastRow.b <= r.vh, `the last queued row ends at ${r.lastRow.b}, under the screen's foot ${r.vh}`);
    });
    await t.test("a new album playing: its review and its queue follow", () => {
      assert.match(r.bioTextB, /^Amnesiac is/, "the review stayed the last album's: " + r.bioTextB + " " + JSON.stringify(r.extrasAsked));
      assert.equal(r.queueFirstB, "Amnesiac 1", "the queue stayed the last album's");
      assert.ok(r.queueAskedAgain, "the queue was not asked for again");
    });
    await t.test("a radio stream: no review, and no song asked for as an album", () => {
      assert.equal(r.bioShownRadio, false, "the last album's review stayed for a stream");
      assert.deepEqual(r.extrasAskedRadio, r.extrasAsked, "a review was asked for with no album playing");
    });
    await t.test("THE review: Back goes to the album view as the album view: its tracks, no queue", () => {
      assert.equal(r.backAlbum, true, "Back did not put back the album");
      assert.equal(r.albumQueueShown, false, "the queue stayed on the album view");
      assert.equal(r.albumTracksShown, true, "the album view's tracks are not shown");
    });
  });
}

// Not touched (§2.6): a phone on its side and a portrait tablet keep the tabs and the queue behind them.
for (const [size, args, what] of [["844x390", TOUCH, "a phone on its side"], ["820x1180", TOUCH, "an iPad upright"]]) {
  test(`v1.9.70-t11: ${what} (${size}) keeps Now playing as it was: the tabs, the queue behind its tab`, { skip: !harness.available }, async (t) => {
    const r = run(size, args);
    harness.assertNoPageError(assert, r);
    await t.test("the tabs, no review, no queue on the Now playing tab", () => {
      assert.equal(r.np, true, "Now playing did not open");
      assert.equal(r.tabsShown, true, "the tabs went");
      assert.equal(r.queueShown, false, "the queue is shown on the Now playing tab");
      assert.equal(r.bioShown, false, "the review is shown on Now playing");
    });
  });
}

// The reduced card (a desktop's size button, v1.8.75): its own two columns and tabs, as before.
test("v1.9.70-t11: the reduced Now playing card (1920x1080) keeps its tabs and two columns", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "np-3col-reduced", windowSize: "1920x1080", chromeArgs: harness.MOUSE, budgetMs: 40000,
    stub: STUB.replace('localStorage.removeItem("rra-np-reduced");', 'localStorage.setItem("rra-np-reduced", "1");'),
    driver: DRIVER });
  harness.assertNoPageError(assert, r);
  await t.test("a card, with its tabs, the queue behind its tab", () => {
    assert.ok(r.panel.w < r.vw, "not a card: " + JSON.stringify(r.panel));
    assert.equal(r.tabsShown, true, "the tabs went");
    assert.equal(r.queueShown, false, "the queue is shown on the card's Now playing tab");
  });
});
