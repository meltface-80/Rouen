"use strict";
// ---------------------------------------------------------------------------
// "Add to library" on a TIDAL album page (album-actions.js RouenLibraryAdd,
// streaming.js; v1.9.41, native-remote.md §9.2): the add sent once, "waiting
// for your server" while the server is asked, then the way to open the album
// once it is in the library; and an add not taken, offered again. The server
// is stubbed as lib/library-add.js answers (library-add.test.js holds it).
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
const PAGE = (title) => ({ title, count: 2, offset: 0, items: [], page: {
  kind: "album", menu: "Play Album", library_offset: null, shown: 2,
  self: { title, subtitle: "Green Eyes, Witch Hands", hint: "list", image_key: "k1", pos: 0 },
  actions: [{ kind: "play_now", title: "Play Now" }], tracks: [{ title: "1. Rughook", subtitle: "Green Eyes, Witch Hands", pos: 1 }] } });
const LEVELS = {
  "[]": { title: "TIDAL", count: 1, offset: 0, page: null, items: [{ title: "What's New", subtitle: null, hint: "list", image_key: null, pos: 0 }] },
  '[["What\'s New",0]]': { title: "What's New", count: 2, offset: 0, page: null, items: [
    { title: "Evil Twin", subtitle: "Green Eyes, Witch Hands", hint: "list", image_key: "k1", pos: 0 },
    { title: "Good Twin", subtitle: "Green Eyes, Witch Hands", hint: "list", image_key: "k2", pos: 1 }] },
  '[["What\'s New",0],["Evil Twin",0]]': PAGE("Evil Twin"),
  '[["What\'s New",0],["Good Twin",1]]': PAGE("Good Twin"),
};

const STUB = `
try { localStorage.setItem("rra-zone", "z1"); } catch (e) { /* storage optional */ }
window.__adds = []; window.__asks = []; window.__opened = [];
window.__installFetch(function (url, init) {
  if (url.indexOf("/api/streaming/level") > -1) {
    var lv = ${JSON.stringify(LEVELS)}[new URL(url, location.href).searchParams.get("path")];
    return lv ? window.__json(lv) : window.__json({ error: "gone" }, 404);
  }
  if (url.indexOf("/api/library/add") > -1) {
    if (init && init.method === "POST") {
      var b = JSON.parse(init.body);
      window.__adds.push(b);
      // Good Twin: Roon's search had it on Qobuz alone, so that copy was added (v1.9.44).
      return window.__json({ ok: true, via: "roon", state: "waiting", from: b.title === "Good Twin" ? "qobuz" : "tidal" });
    }
    var t = new URL(url, location.href).searchParams.get("title");
    window.__asks.push(t);
    // Evil Twin: waiting, then in the library at 77. Good Twin: never taken.
    if (t === "Good Twin") return window.__json({ state: "not-taken", via: "roon" });
    return window.__json(window.__asks.filter(function (x) { return x === t; }).length < 2 ? { state: "waiting", via: "roon" } : { state: "in-library", offset: 77, via: "roon", library_title: "Evil Twin (as Roon has it)", library_subtitle: "Green Eyes, Witch Hands" });
  }
  if (url.indexOf("/api/settings/qobuz") > -1) return window.__json({ connected: true });
  if (url.indexOf("/api/settings/tidal") > -1) return window.__json({ connected: true });
  if (url.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (url.indexOf("/api/zone-state") > -1) return window.__json({ zone: ${JSON.stringify(ZONE)} });
  if (url.indexOf("/api/zones") > -1) return window.__json({ zones: [${JSON.stringify(ZONE)}] });
  if (url.indexOf("/api/queue") > -1) return window.__json({ items: [], history: [] });
  if (url.indexOf("/api/random-albums") > -1) return window.__json({ albums: [], total: 0, filtered: false });
  if (url.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});`;

const DRIVER = `
  await window.__sleep(700);
  window.__openAlbum = function (a) { window.__opened.push(a); };
  var view = function () { return document.querySelector(".streaming-view"); };
  var find = function (re) { return Array.prototype.find.call(view().querySelectorAll("button"), function (b) { return re.test(b.textContent); }); };
  document.getElementById("menu-toggle").click();
  await window.__sleep(200);
  document.getElementById("menu-item-tidal").click();
  await window.__sleep(400);
  view().querySelector(".track-row").click();
  await window.__sleep(400);
  view().querySelector(".album").click();                  // Evil Twin
  await window.__sleep(400);
  var add = find(/Add to library/);
  T("offered", !!add);
  T("no_open_yet", !find(/In your library/));
  add.click(); add.click();                               // a second tap while it is sent: one add
  await window.__sleep(100);
  T("adds", window.__adds.slice());
  T("waiting", add.textContent);
  await window.__sleep(3200);                             // the first ask: still waiting
  T("still_waiting", add.isConnected ? add.textContent : null);
  await window.__sleep(3200);                             // the second: in the library
  var open = find(/In your library/);
  T("became_open", !!open && !add.isConnected);
  if (open) open.click();
  await window.__sleep(100);
  T("opened", window.__opened.slice());
  view().querySelector(".playlist-back").click();
  await window.__sleep(400);
  view().querySelectorAll(".album")[1].click();           // Good Twin: never taken
  await window.__sleep(400);
  var add2 = find(/Add to library/);
  add2.click();
  await window.__sleep(100);
  T("other_copy", add2.textContent);
  await window.__sleep(3300);
  T("not_taken", add2.textContent);
  T("not_taken_enabled", !add2.disabled);
`;

test("Add to library on a TIDAL album page: sent once, waits for your server, then opens the album in the library; one not taken is offered again", async () => {
  if (!harness.available) return;
  const r = harness.renderPage({ name: "library-add", windowSize: "390x844", budgetMs: 30000, stub: STUB, driver: DRIVER });
  harness.assertNoPageError(assert, r);
  assert.equal(r.offered, true, "no Add to library on an album not in the library");
  assert.equal(r.no_open_yet, true);
  assert.deepEqual(r.adds, [{ title: "Evil Twin", artist: "Green Eyes, Witch Hands", service: "tidal", album_id: null }]);
  assert.equal(r.waiting, "Added — waiting for your server");
  assert.equal(r.still_waiting, "Added — waiting for your server");
  assert.equal(r.became_open, true, "still waiting once the album was in the library");
  // Opened under Roon's own strings for it: the album view checks the album's identity by them.
  assert.deepEqual(r.opened, [{ offset: 77, title: "Evil Twin (as Roon has it)", subtitle: "Green Eyes, Witch Hands", image_key: "k1" }]);
  assert.equal(r.other_copy, "Added from Qobuz — waiting for your server", "the other service's copy added, and not said");
  assert.match(r.not_taken, /Not in your library yet/);
  assert.equal(r.not_taken_enabled, true, "an add not taken can't be sent again");
});
