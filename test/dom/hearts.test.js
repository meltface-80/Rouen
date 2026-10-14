"use strict";
// ---------------------------------------------------------------------------
// Hearts on the page (public/album-actions.js, v1.9.27, native-remote.md §8):
// the album's heart on the left of the action row, before Play Now, the pills
// narrowed to make room and the heart their height; a tap sent, and put back
// when your server refuses it; no heart when your server cannot take one; and
// tracks hearted from the selection menu after a long-press. In the real
// page, against stubbed answers.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const ZONE = {
  zone_id: "z1", display_name: "Living Room", state: "stopped",
  settings: { shuffle: false, loop: "disabled", auto_radio: false },
  outputs: [{ output_id: "o1", display_name: "Living Room", is_muted: false, volume: null }],
  now_playing: null,
};
const ALBUM = { offset: 0, title: "Blue", subtitle: "Joni Mitchell", image_key: null };
const DETAIL = {
  album: { title: "Blue", subtitle: "Joni Mitchell" },
  actions: [{ kind: "play_now", title: "Play Now" }, { kind: "queue", title: "Queue" },
            { kind: "play_next", title: "Add Next" }, { kind: "shuffle", title: "Shuffle" }],
  tracks: [{ title: "All I Want", subtitle: "Joni Mitchell" }, { title: "My Old Man", subtitle: "Joni Mitchell" },
           { title: "Little Green", subtitle: "Joni Mitchell" }],
};

// hearts: what GET /api/hearts/album answers; refuse: the POSTs answer 409.
const STUB_FOR = (hearts, refuse) => `
window.__posts = [];
try { localStorage.setItem("rra-zone", "z1"); } catch (e) { /* storage optional: the zone falls back to the first */ }
window.__installFetch(function (url, opts) {
  if (url.indexOf("/api/hearts/") > -1 && opts && opts.method === "POST") {
    window.__posts.push([url, JSON.parse(opts.body)]);
    return ${refuse ? 'window.__json({ error: "Your server refused an album heart (\\"Refused\\")." }, 409)' : "window.__json({ ok: true })"};
  }
  if (url.indexOf("/api/hearts/album") > -1) return window.__json(${JSON.stringify(hearts)});
  if (url.indexOf("/api/user-playlists") > -1) return window.__json({ playlists: [] });
  if (url.indexOf("/api/album") > -1)      return window.__json(${JSON.stringify(DETAIL)});
  if (url.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (url.indexOf("/api/zones") > -1)      return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (url.indexOf("/api/queue") > -1)      return window.__json({ items: [] });
  if (url.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  if (url.indexOf("/api/") > -1)           return window.__json({});
  return undefined;
});
window.__longPress = async function (el) {
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  await window.__sleep(700);
  el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await window.__sleep(80);
};
`;

const DRIVER = `
  function box(el) { var b = el.getBoundingClientRect(); return { left: b.left, right: b.right, w: b.width, h: b.height }; }
  await window.__sleep(600);
  window.__openAlbum(${JSON.stringify(ALBUM)}, { source: "search" });
  await window.__sleep(900);
  var row = document.getElementById("modal-actions");
  var heart = row.querySelector(".heart-btn");
  var pills = row.querySelectorAll(".action-btn");
  T("has_heart", !!heart);
  T("order", Array.prototype.map.call(row.children, function (c) {
    return c.querySelector(".heart-btn") ? "heart" : c.classList.contains("action-btn") ? c.textContent : c.querySelector(".overflow-btn") ? "more" : c.className; }));
  T("pill_w", Array.prototype.map.call(pills, function (p) { return box(p).w; }));
  if (heart) {
    T("heart", box(heart)); T("pill_h", box(pills[0]).h);
    T("before_play", box(heart).right <= box(pills[0]).left + 0.5);
    T("pressed0", heart.getAttribute("aria-pressed"));
    heart.click();
    await window.__sleep(300);
    T("pressed1", heart.getAttribute("aria-pressed"));
    T("toast", (document.getElementById("toast") || {}).textContent || "");
  }
  // Tracks: long-press the third, tap the first, then the selection menu.
  var rows = document.querySelectorAll("#modal-tracks .t-row");
  await window.__longPress(rows[2]);
  rows[0].querySelector(".t-mark").click();
  await window.__sleep(80);
  document.getElementById("select-menu-btn").click();
  await window.__sleep(120);
  T("menu", Array.prototype.filter.call(document.querySelectorAll("#select-menu .sel-menu-item"),
    function (b) { return !b.classList.contains("hidden"); }).map(function (b) { return b.textContent; }));
  var add = document.querySelector('#select-menu [data-heart-act="on"]');
  if (add && !add.classList.contains("hidden")) { add.click(); await window.__sleep(400); }
  T("posts", window.__posts);
  T("selected_after", document.querySelectorAll('#modal-tracks .t-mark[aria-pressed="true"]').length);
`;

const run = (name, hearts, refuse, size) => harness.renderPage({ name, windowSize: size || "390x844",
  stub: STUB_FOR(hearts, refuse), driver: DRIVER });

test("THE one: the album's heart sits left of Play Now, its height, and a tap reaches your server", async () => {
  if (!harness.available) return;
  const r = run("hearts-on", { available: true, favorite: false, tracks: true });
  harness.assertNoPageError(assert, r);
  const none = run("hearts-none", { available: false, why: "Native mode isn't connected to your server right now." });
  harness.assertNoPageError(assert, none);
  assert.equal(r.has_heart, true, "no heart for an album your server can heart");
  assert.deepEqual(r.order, ["heart", "Play Now", "Queue", "more"]);
  assert.equal(r.before_play, true);
  assert.ok(Math.abs(r.heart.h - r.pill_h) < 0.5, "the heart is " + r.heart.h + "px against the pills' " + r.pill_h);
  assert.ok(Math.abs(r.heart.w - r.heart.h) < 0.5, "the heart is not round");
  assert.ok(r.pill_w[0] < none.pill_w[0] - 10, "Play Now did not narrow to make room (" + r.pill_w[0] + " vs " + none.pill_w[0] + ")");
  assert.deepEqual([r.pressed0, r.pressed1], ["false", "true"]);
  assert.deepEqual(r.posts[0], ["/api/hearts/album", { title: "Blue", artist: "Joni Mitchell", on: true }]);
  assert.equal(none.has_heart, false, "a heart offered that your server cannot take");
  assert.deepEqual(none.order, ["Play Now", "Queue", "more"]);
});

test("tracks: long-press, then 'Add to favourites' sends the picked tracks and clears the selection", async () => {
  if (!harness.available) return;
  const r = run("hearts-tracks", { available: true, favorite: true, tracks: true });
  harness.assertNoPageError(assert, r);
  assert.ok(r.menu.includes("Add to favourites") && r.menu.includes("Remove from favourites"), r.menu.join(", "));
  assert.deepEqual(r.posts.at(-1), ["/api/hearts/tracks", { title: "Blue", artist: "Joni Mitchell",
    titles: ["All I Want", "My Old Man", "Little Green"], picks: [0, 2], on: true }]);
  assert.equal(r.selected_after, 0);
});

test("your server can't heart this album's tracks: the menu does not offer it", async () => {
  if (!harness.available) return;
  const r = run("hearts-notracks", { available: true, favorite: false, tracks: false, tracksWhy: "x" });
  harness.assertNoPageError(assert, r);
  assert.ok(!r.menu.includes("Add to favourites"), r.menu.join(", "));
});

test("refused: the heart goes back, and the toast says why", async () => {
  if (!harness.available) return;
  const r = run("hearts-refused", { available: true, favorite: false, tracks: true }, true);
  harness.assertNoPageError(assert, r);
  assert.equal(r.pressed1, "false", "THE one: a heart your server refused stayed filled");
  assert.match(r.toast, /refused an album heart/);
});
