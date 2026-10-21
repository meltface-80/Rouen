"use strict";
// ---------------------------------------------------------------------------
// N2d's page side (public/playlists-native.js, v1.9.42, native-remote.md §11.1):
// with native mode able to change Roon's playlists, the Add to playlist sheet
// offers Roon's own (and a new one, made there); an add Roon didn't take keeps
// the tracks in Rouen's own playlist of that name; Rouen's own say "In Rouen
// only"; a Roon playlist's ⋯ gains Rename and Delete. Native mode not able:
// the sheet as before. The server is stubbed as lib/playlists-native.js
// answers (playlists-native.test.js holds it).
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

const stubFor = (native) => `
try { localStorage.setItem("rra-zone", "z1"); } catch (e) { /* storage optional */ }
window.__native = []; window.__mine = [];
window.__installFetch(function (url, init) {
  var post = init && init.method === "POST" ? JSON.parse(init.body || "{}") : null;
  if (url.indexOf("/api/roon-playlists") > -1) {
    if (!post) return window.__json(${native ? `{ available: true, playlists: [{ id: "aa", name: "Morning", tracks: 3 }] }` : `{ available: false, why: "Your server didn't send its playlists to Rouen." }`});
    window.__native.push([url.replace(/^.*\\/api/, "/api"), post]);
    // The first add taken and shown; the second not shown: the page keeps it in Rouen; the third partly taken.
    var nth = window.__native.length;
    if (url.indexOf("/add") > -1) return window.__json(nth === 1
      ? { ok: true, via: "roon", id: "aa", name: "Morning", added: 1, missing: [], kept: [] }
      : nth === 2 ? { ok: false, fallback: true, why: "Roon didn't show what was added to \\"Morning\\".", name: "Morning" }
      : { ok: true, via: "roon", id: "aa", name: "Morning", added: 1, missing: [], kept: ["My Old Man"], why: "Your server refused the tracks." });
    return window.__json({ ok: true });
  }
  if (url.indexOf("/api/user-playlists/add") > -1) { window.__mine.push(post); return window.__json({ ok: true, id: "u1", name: post.name || "Mix", added: 1, track_total: 1 }); }
  if (url.indexOf("/api/user-playlists") > -1) return window.__json({ playlists: [{ id: "u1", name: "Rouen Mix", track_total: 2, art_keys: [] },
    { id: "u2", name: "Morning", track_total: 1, art_keys: [] }] });
  if (url.indexOf("/api/playlists") > -1) return window.__json({ playlists: [{ offset: 0, title: "Morning", subtitle: "3 Tracks", image_key: null }], total: 1 });
  if (url.indexOf("/api/playlist/art") > -1) return window.__json({ art_keys: [] });
  if (url.indexOf("/api/playlist") > -1) return window.__json({ title: "Morning", subtitle: "3 Tracks", tracks: [{ index: 0, title: "Blue", subtitle: "Joni Mitchell" }],
    total: 1, truncated: false, can_play: true });
  if (url.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (url.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (url.indexOf("/api/zones") > -1) return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (url.indexOf("/api/queue") > -1) return window.__json({ items: [], history: [] });
  if (url.indexOf("/api/random-albums") > -1) return window.__json({ albums: [], total: 0, filtered: false });
  if (url.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});`;

const ENTRY = { title: "All I Want", album_title: "Blue", album_subtitle: "Joni Mitchell", album_offset: 3, subtitle: "Joni Mitchell" };
const ENTRY2 = Object.assign({}, ENTRY, { title: "My Old Man" });

const DRIVER = `
  await window.__sleep(600);
  var rows = function () { return Array.prototype.map.call(document.querySelectorAll(".sheet-row"), function (b) { return b.textContent; }); };
  var pick = function (re) { var b = Array.prototype.find.call(document.querySelectorAll(".sheet-row"), function (x) { return re.test(x.textContent); }); if (b) b.click(); return !!b; };
  window.RouenPlaylists.openAddSheet([${JSON.stringify(ENTRY)}], null);
  await window.__sleep(400);
  T("rows", rows());
  pick(/^Morning/);
  await window.__sleep(400);
  window.RouenPlaylists.openAddSheet([${JSON.stringify(ENTRY)}], null);
  await window.__sleep(400);
  pick(/^Morning/);
  await window.__sleep(400);
  window.RouenPlaylists.openAddSheet([${JSON.stringify(ENTRY)}, ${JSON.stringify(ENTRY2)}], null);
  await window.__sleep(400);
  pick(/^Morning/);
  await window.__sleep(400);
  T("native", window.__native.slice(0, 2));
  T("mine", window.__mine.slice());
  // The Playlists screen, and a Roon playlist's page.
  document.getElementById("menu-toggle").click();
  await window.__sleep(200);
  document.querySelector('[data-action="playlists"]').click();
  await window.__sleep(600);
  T("subtitles", Array.prototype.map.call(document.querySelectorAll("#album-grid .album .album-artist"), function (e) { return e.textContent; }));
  var tiles = document.querySelectorAll("#album-grid .album");
  tiles[tiles.length - 1].click();
  await window.__sleep(600);
  T("menu", Array.prototype.map.call(document.querySelectorAll(".playlist-actions .overflow-menu .sel-menu-item"), function (b) { return b.textContent; }));
  window.prompt = function () { return "Evening"; };
  var ren = Array.prototype.find.call(document.querySelectorAll(".playlist-actions .overflow-menu .sel-menu-item"), function (b) { return b.textContent === "Rename"; });
  if (ren) ren.click();
  await window.__sleep(300);
  T("after", window.__native.slice(3));
`;

test("native mode able: Roon's playlists in the sheet, a fallback kept in Rouen, Rouen's own marked, Rename on Roon's page", async () => {
  if (!harness.available) return;
  const r = harness.renderPage({ name: "playlists-native", windowSize: "390x844", budgetMs: 20000, stub: stubFor(true), driver: DRIVER });
  harness.assertNoPageError(assert, r);
  assert.deepEqual(r.rows, ["＋ New playlist…", "Morning · 3 tracks"]);
  const add = ["/api/roon-playlists/add", { id: "aa", tracks: [{ title: "All I Want", album_title: "Blue", album_subtitle: "Joni Mitchell" }] }];
  assert.deepEqual(r.native, [add, add]);
  // The second, not shown by Roon: kept in Rouen's own playlist of that name — the one there is, not a new one.
  // The third, partly taken: only the track Roon didn't take kept there.
  assert.deepEqual(r.mine.map((m) => [m.id, m.name, m.tracks.map((t) => t.title)]),
    [["u2", undefined, ["All I Want"]], ["u2", undefined, ["My Old Man"]]], "an add Roon didn't show was dropped, or made a second Rouen playlist");
  assert.deepEqual(r.subtitles, ["2 tracks · In Rouen only", "1 track · In Rouen only", "3 Tracks"]);
  assert.deepEqual(r.menu, ["Share", "Rename", "Delete"]);
  assert.deepEqual(r.after, [["/api/roon-playlists/rename", { id: "aa", name: "Evening" }]]);
});

test("native mode not able: the sheet as before, Rouen's own; nothing marked; no Rename on Roon's page", async () => {
  if (!harness.available) return;
  const r = harness.renderPage({ name: "playlists-native-off", windowSize: "390x844", budgetMs: 20000, stub: stubFor(false), driver: DRIVER });
  harness.assertNoPageError(assert, r);
  assert.deepEqual(r.rows, ["＋ New playlist…", "Rouen Mix · 2 tracks", "Morning · 1 track"]);
  assert.deepEqual(r.native, []);
  assert.deepEqual(r.subtitles, ["2 tracks", "1 track", "3 Tracks"]);
  assert.deepEqual(r.menu, ["Share"]);
});
