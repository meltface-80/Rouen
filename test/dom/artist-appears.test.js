"use strict";
// ---------------------------------------------------------------------------
// v2.0.3-t3: the artist page's "Appears on" (dev/design/plays-on.md §2).
//
// The owner's two choices: one section, every record the server credits the artist on (apart from their own albums),
// each tile labelled with their roles; and with native mode on it REPLACES "Also appears on", while with native mode
// off (any answer but "ok") the page is exactly as before. A long list shows its first 24 with More / Less, and a read
// the server is still making ("pending") is asked again while the page is up. The shipping page, the server a stand-in.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const OWN = { offset: 1, title: "Luke", subtitle: "Steve Lukather", image_key: "k1" };
const DUETS = { offset: 4, title: "Duets", subtitle: "Someone & Steve Lukather", image_key: "k4" };
const ROLES = [["Played"], ["Played", "Produced"], ["Wrote"]];
const APPEARS = Array.from({ length: 25 }, (_, i) => ({ offset: 10 + i, title: "Record " + i, subtitle: "Band " + i, image_key: "a" + i, roles: ROLES[i % 3] }))
  .concat([Object.assign({ roles: ["Featured"] }, DUETS)]);

const STUB = `
var OWN = ${JSON.stringify(OWN)}, DUETS = ${JSON.stringify(DUETS)}, APPEARS = ${JSON.stringify(APPEARS)};
window.__mode = "ok";
window.__appearsCalls = 0;
window.__asked = {};
window.__installFetch(function (url) {
  if (url.indexOf("/api/artist/appears-on") > -1) {
    window.__appearsCalls++;
    var who = decodeURIComponent(/artist=([^&]*)/.exec(url)[1]);
    window.__asked[who] = (window.__asked[who] || 0) + 1;
    if (window.__mode === "off") return window.__json({ status: "off", albums: [], why: "Native mode is off." });
    // "slow": the server never done while the page is up; "ok": "pending" once per artist, then the list.
    if (window.__mode === "slow" || window.__asked[who] === 1) return window.__json({ status: "pending", albums: [] });
    return window.__json({ status: "ok", albums: APPEARS });
  }
  if (url.indexOf("/api/artist-albums") > -1)
    return window.__json({ artist: "x", primary: [OWN], featured: [DUETS] });
  if (url.indexOf("/api/artist-bio") > -1)  return window.__json({ bio: { text: "A session guitarist.", source: "Test" } });
  if (url.indexOf("/api/random-albums") > -1)
    return window.__json({ albums: [OWN], total: 1, filtered: false });
  if (url.indexOf("/api/library/albums") > -1)
    return window.__json({ albums: [OWN], offset: 0, total: 1 });
  if (url.indexOf("/api/zones") > -1)
    return window.__json({ zones: [{ zone_id: "z1", display_name: "Zone", state: "stopped", outputs: [] }] });
  if (url.indexOf("/api/zone-state") > -1) return window.__json({ zone: null });
  if (url.indexOf("/api/queue") > -1)      return window.__json({ items: [] });
  if (url.indexOf("/api/filters") > -1)    return window.__json({ genres: [] });
  if (url.indexOf("/api/home/") > -1)      return window.__json({ albums: [], label: null });
  if (url.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  if (url.indexOf("/api/settings") > -1)   return window.__json({});
  return undefined;
});
`;

const DRIVER = `
  await window.__sleep(400);
  var grid = document.getElementById("album-grid");
  var count = document.getElementById("album-count");
  function heads() { return Array.prototype.map.call(grid.querySelectorAll(".artist-section-header"), function (h) { return h.textContent; }); }
  function roles() { return Array.prototype.map.call(grid.querySelectorAll(".album-roles"), function (e) { return e.textContent; }); }

  await window.__showArtistAlbums("Steve Lukather");
  await window.__sleep(150);
  T("before_heads", heads());
  await window.__sleep(2500);
  T("ok_calls", window.__appearsCalls);
  T("ok_heads", heads());
  T("ok_tiles", grid.querySelectorAll(".album").length);
  T("ok_roles", roles().slice(0, 3));
  var tiles = grid.querySelectorAll(".album");
  T("ok_aria", tiles[2] && tiles[2].getAttribute("aria-label"));
  T("ok_title", count.textContent);
  T("ok_bio_first", !!grid.firstElementChild && grid.firstElementChild.classList.contains("artist-bio-head"));
  var more = grid.querySelector(".artist-appears-more");
  T("more_text", more && more.textContent);
  T("more_last", grid.lastElementChild === more);
  more.focus();
  more.click();
  await window.__sleep(200);
  T("more_focus", document.activeElement && document.activeElement.className);
  T("more_expanded", grid.querySelector(".artist-appears-more").getAttribute("aria-expanded"));
  T("all_tiles", grid.querySelectorAll(".album").length);
  T("all_last_roles", roles().slice(-1));
  var less = grid.querySelector(".artist-appears-more");
  T("less_text", less && less.textContent);
  less.click();
  await window.__sleep(200);
  T("less_tiles", grid.querySelectorAll(".album").length);

  // Back while the server is still reading: the screen put back is left alone.
  window.__exitArtistView({ reopen: false });
  await window.__sleep(200);
  window.__mode = "slow";
  await window.__showArtistAlbums("Slow One");
  await window.__sleep(100);
  window.__exitArtistView({ reopen: false });
  window.__mode = "ok";
  await window.__sleep(3000);
  T("back_heads", heads());
  T("back_roles", roles().length);

  // Artist A, then B before A's answer: A's late "ok" never paints into B's page.
  window.__asked = {};
  await window.__showArtistAlbums("Artist A");
  await window.__sleep(50);
  window.__mode = "off";
  await window.__showArtistAlbums("Artist B");
  window.__mode = "ok";
  await window.__sleep(2500);
  T("ab_heads", heads());
  T("ab_roles", roles().length);

  window.__mode = "off";
  var before = window.__appearsCalls;
  await window.__showArtistAlbums("Steve Lukather");
  await window.__sleep(600);
  T("off_asked", window.__appearsCalls - before);
  T("off_heads", heads());
  T("off_tiles", grid.querySelectorAll(".album").length);
  T("off_roles", roles().length);
  T("off_title", count.textContent);
`;

test("the artist page's Appears on (v2.0.3-t3)", { skip: !harness.available && "no chromium" }, async (t) => {
  const R = harness.renderPage({ stub: STUB, driver: DRIVER, name: "artist-appears" });
  harness.assertNoPageError(assert, R);
  await t.test("until the server answers, the page is as before", () => {
    assert.deepEqual(R.before_heads, ["Albums", "Also appears on"]);
  });
  await t.test("THE one: native mode's answer replaces \"Also appears on\", each record labelled with its roles", () => {
    assert.equal(R.ok_calls, 2, "a \"pending\" answer is asked again");
    assert.deepEqual(R.ok_heads, ["Albums", "Appears on"], "one section, in place of \"Also appears on\"");
    assert.equal(R.ok_tiles, 1 + 24, "their own album, then the first 24");
    assert.deepEqual(R.ok_roles, ["Played", "Played · Produced", "Wrote"]);
    assert.match(R.ok_aria, /Record 1 by Band 1 \(Played, Produced\)$/, "the roles are read out with the tile");
    assert.equal(R.ok_title, "27 albums · Steve Lukather");
    assert.equal(R.ok_bio_first, true, "the bio stays at the head of the page through the repaint");
  });
  await t.test("a long list shows 24, More shows the rest, Less the 24 again", () => {
    assert.equal(R.more_text, "More (2)");
    assert.match(String(R.more_focus), /artist-appears-more/, "focus stays on the button, not sent to the top");
    assert.equal(R.more_expanded, "true");
    assert.equal(R.more_last, true);
    assert.equal(R.all_tiles, 1 + 26);
    assert.deepEqual(R.all_last_roles, ["Featured"], "an album whose artist line names them is kept, as Featured");
    assert.equal(R.less_text, "Less");
    assert.equal(R.less_tiles, 1 + 24);
  });
  await t.test("Back while the server reads, and a late answer for another artist, paint nothing", () => {
    assert.deepEqual(R.back_heads, [], "the screen put back is left alone");
    assert.equal(R.back_roles, 0);
    assert.deepEqual(R.ab_heads, ["Albums", "Also appears on"], "artist A's late answer did not reach artist B's page");
    assert.equal(R.ab_roles, 0);
  });
  await t.test("native mode off: \"Also appears on\" exactly as before, no roles", () => {
    assert.equal(R.off_asked, 1, "the page asked, and kept what it had on \"off\"");
    assert.deepEqual(R.off_heads, ["Albums", "Also appears on"]);
    assert.equal(R.off_tiles, 2);
    assert.equal(R.off_roles, 0);
    assert.equal(R.off_title, "2 albums · Steve Lukather");
  });
});
