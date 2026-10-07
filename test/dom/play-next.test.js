"use strict";
// ---------------------------------------------------------------------------
// v1.8.80: Play next everywhere (Mandarin v0.6.22).
//
// Roon has an "Add Next" action and the server already classified it; what was
// missing was the page. Pinned here:
//   1. A track's buttons are Play now, Play next, Queue — and Play next sends
//      kind play_next for that one track, toasting "Playing next: …".
//   2. The selection menu offers Play next under Play now.
//   3. Several TRACKS: every one is sent as play_next, LAST FIRST (each lands
//      in front of the one before, so they arrive in album order). Sending the
//      first as play_next and queueing the rest put them at the far end.
//   4. Several ALBUMS: one play-multi call with kind play_next, in pick order
//      (the server decides the send order — test/unit/play-multi-next.test.js).
//   5. The album ⋯ menu says "Play Next", not "Next".
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
const ALBUMS = [
  { offset: 0, title: "Album A", subtitle: "Artist A", image_key: null },
  { offset: 1, title: "Album B", subtitle: "Artist B", image_key: null },
  { offset: 2, title: "Album C", subtitle: "Artist C", image_key: null },
];
const DETAIL = {
  title: "Album A", subtitle: "Artist A", image_key: null,
  actions: [{ kind: "play_now", title: "Play Now" }, { kind: "queue", title: "Queue" },
            { kind: "play_next", title: "Add Next" }, { kind: "shuffle", title: "Shuffle" }],
  tracks: [{ title: "One", subtitle: "Artist A" }, { title: "Two", subtitle: "Artist A" },
           { title: "Three", subtitle: "Artist A" }],
};

const STUB = `
window.__posts = [];
try { localStorage.setItem("rra-zone", "z1"); } catch (e) {}
window.__installFetch(function (url, opts) {
  if (url.indexOf("/api/play-track") > -1) {
    window.__posts.push(Object.assign({ url: "track" }, JSON.parse((opts && opts.body) || "{}")));
    return window.__json({ ok: true, action: "Add Next", track: "x" });
  }
  if (url.indexOf("/api/play-multi") > -1) {
    window.__posts.push(Object.assign({ url: "multi" }, JSON.parse((opts && opts.body) || "{}")));
    return window.__json({ ok: true, queued: 2, failed: 0, total: 2 });
  }
  if (url.indexOf("/api/user-playlists") > -1) return window.__json({ playlists: [] });
  if (url.indexOf("/api/album") > -1)      return window.__json(${JSON.stringify(DETAIL)});
  if (url.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (url.indexOf("/api/zones") > -1)      return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (url.indexOf("/api/queue") > -1)      return window.__json({ items: [] });
  if (url.indexOf("/api/filters") > -1)    return window.__json({ genres: [] });
  if (url.indexOf("/api/home/") > -1)      return window.__json({ albums: [], label: null });
  if (url.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  if (url.indexOf("/api/settings") > -1)   return window.__json({});
  if (url.indexOf("/api/random-albums") > -1)
    return window.__json({ albums: ${JSON.stringify(ALBUMS)}, total: 3, filtered: false });
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
  function toastText() { return (document.getElementById("toast") || {}).textContent || ""; }
  function items() { return Array.prototype.filter.call(document.querySelectorAll("#select-menu .sel-menu-item"),
      function (b) { return !b.classList.contains("hidden"); }).map(function (b) { return b.dataset.selAct; }); }
  await window.__sleep(600);
  window.__openAlbum(${JSON.stringify(ALBUMS[0])}, { source: "search" });
  await window.__sleep(800);
  function rows() { return document.querySelectorAll("#modal-tracks .t-row"); }

  // 5. The ⋯ menu's label.
  var more = document.querySelector("#modal-actions .overflow-btn, #modal-actions [aria-label='More actions']");
  if (more) { more.click(); await window.__sleep(150); }
  T("overflow_items", Array.prototype.map.call(document.querySelectorAll(".overflow-menu button, .overflow-menu [role=menuitem]"),
      function (b) { return b.textContent.trim(); }));
  document.body.click(); await window.__sleep(100);

  // 1. One track.
  rows()[1].click();
  await window.__sleep(150);
  T("track_buttons", Array.prototype.map.call(rows()[1].querySelectorAll(".t-actions button"), function (b) { return b.textContent; }));
  var pn = Array.prototype.filter.call(rows()[1].querySelectorAll(".t-actions button"), function (b) { return b.textContent === "Play next"; })[0];
  if (pn) pn.click();
  await window.__sleep(400);
  T("one_post", window.__posts.slice());
  T("one_toast", toastText());
  window.__posts.length = 0;

  // 3. Several tracks: long press Three, then tap One.
  await window.__longPress(rows()[2]);
  rows()[0].querySelector(".t-mark").click();
  await window.__sleep(80);
  document.getElementById("select-menu-btn").click();
  await window.__sleep(120);
  T("track_menu", items());
  document.querySelector('[data-sel-act="play_next"]').click();
  await window.__sleep(800);
  T("multi_posts", window.__posts.slice());
  T("multi_toast", toastText());
  window.__posts.length = 0;

  // 4. Several albums.
  document.querySelector("#album-modal .modal-close").click();
  await window.__sleep(500);
  var grid = document.getElementById("album-grid");
  grid.innerHTML = "";
  ${JSON.stringify(ALBUMS)}.forEach(function (a) { grid.appendChild(window.__buildAlbumTile(a)); });
  await window.__sleep(60);
  var tiles = document.querySelectorAll("#album-grid .album");
  await window.__longPress(tiles[2]);
  tiles[0].click();
  await window.__sleep(80);
  document.getElementById("select-menu-btn").click();
  await window.__sleep(120);
  T("album_menu", items());
  document.querySelector('[data-sel-act="play_next"]').click();
  await window.__sleep(500);
  T("album_posts", window.__posts.slice());
  T("album_toast", toastText());
`;

test("Play next everywhere (v1.8.80)", { concurrency: 1 }, async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const r = harness.renderPage({ stub: STUB, driver: DRIVER, name: "play-next", windowSize: "390x844" });
  harness.assertNoPageError(assert, r);

  await t.test("the album ⋯ menu says Play Next", () => {
    assert.ok(r.overflow_items.includes("Play Next"), "menu was " + JSON.stringify(r.overflow_items));
    assert.ok(!r.overflow_items.includes("Next"));
  });

  await t.test("a track's buttons are Play now, Play next, Queue", () => {
    assert.deepEqual(r.track_buttons, ["Play now", "Play next", "Queue"]);
    assert.equal(r.one_post.length, 1);
    assert.equal(r.one_post[0].kind, "play_next");
    assert.equal(r.one_post[0].track, 1);
    assert.match(r.one_toast, /^Playing next: Two/);
  });

  await t.test("several tracks: every one play_next, last first", () => {
    assert.deepEqual(r.track_menu.slice(0, 3), ["play_now", "play_next", "queue"],
      "Play next belongs under Play now");
    assert.deepEqual(r.multi_posts.map((p) => p.kind), ["play_next", "play_next"],
      "a pick after the first was queued at the end instead of played next");
    assert.deepEqual(r.multi_posts.map((p) => p.track), [2, 0],
      "Add Next stacks: the picks must go out last first to arrive in album order");
    assert.match(r.multi_toast, /^Playing next: 2 tracks/);
  });

  await t.test("several albums: one play-multi call, kind play_next, in pick order", () => {
    assert.deepEqual(r.album_menu.slice(0, 3), ["play_now", "play_next", "queue"]);
    assert.equal(r.album_posts.length, 1);
    assert.equal(r.album_posts[0].url, "multi");
    assert.equal(r.album_posts[0].kind, "play_next");
    assert.deepEqual(r.album_posts[0].items.map((i) => i.title), ["Album C", "Album A"]);
    assert.match(r.album_toast, /^Playing next: 2 albums/);
  });
});

test("a track's three buttons stay inside the row on a 360px phone (v1.8.80)", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  // At 18px a side the third button ran 11px past the row's edge.
  const r = harness.renderPage({ stub: STUB, name: "play-next-360", windowSize: "360x740", driver: `
    await window.__sleep(600);
    window.__openAlbum(${JSON.stringify(ALBUMS[0])}, { source: "search" });
    await window.__sleep(800);
    var row = document.querySelectorAll("#modal-tracks .t-row")[1];
    row.click();
    await window.__sleep(200);
    T("row_right", Math.round(row.getBoundingClientRect().right));
    T("btn_rights", Array.prototype.map.call(row.querySelectorAll(".t-actions button"),
        function (b) { return Math.round(b.getBoundingClientRect().right); }));
  ` });
  harness.assertNoPageError(assert, r);
  assert.equal(r.btn_rights.length, 3);
  for (const x of r.btn_rights) assert.ok(x <= r.row_right, `a button ends at ${x}, past the row's edge at ${r.row_right}`);
});
