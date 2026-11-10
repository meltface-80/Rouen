"use strict";
// ---------------------------------------------------------------------------
// v2.0.3-t9: a playlist's page has one way back and its name on that line (public/playlist-head.js).
//
// The owner, 2026-11-09, of a Roon playlist's page on a phone: "Too much wasted space at the top of the playlist
// screens. The double back button is not correct. The brass < chevron is the correct and only button. It should take
// you back to the previous screen which is the overview playlist screen I came from to view this playlist. Put the
// name of the playlist on the same line as the brass < chevron and if two lines place the second row under the first
// without the top line moving position."
//
// What was there: the bar's ‹ (which went Home, two screens back), under it the page's own "← Playlists" pill, under
// that the name as a heading with a rule, and only then the count and Play. The four pages that drew that header (a
// Roon playlist, one stored by Rouen, a Dynamic Playlist, one of Roon's smart playlists) are all held here.
//
// Every position compared below is read in one pass of the page (getBoundingClientRect and a Range's rects, the
// same layout), never a rect against a screenshot (dev/lessons.md). Not shown here: a phone's safe areas.
// The fake server and the driver's first lines are playlist-head-kit.js; where the name sits when the bar changes
// under it (a selection, a banner, a larger title, a narrow window) is playlist-head-layout.test.js.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const { TOUCH, LONG, STUB, HELPERS, TILES, WALL, mid } = require("./playlist-head-kit");

// The four pages, each read as it stands when opened.
const PAGES_DRIVER = HELPERS + `
  await menu("playlists");
  await open("Late Night");   T("roon", read());   await back();
  await open(${JSON.stringify(LONG)}); T("long", read()); await back();
  await open("Rouen Mix");    T("mine", read());   await back();
  T("overview", read());
  await menu("smart-playlists");
  await open("Nineties");     T("dynamic", read()); await back();
  await open("r&b random");   T("smart", read());   await back();
  T("wall", read());
`;

for (const [size, what] of [["390x844", "a phone"], ["350x700", "a small phone (the 33px buttons)"], ["820x1180", "a tablet"]]) {
  test(`touch, ${what}: the playlist's name on the ‹'s line, on one line (cut with … when long), the count beside it, no pill and no heading of its own`, { skip: !harness.available }, async () => {
    const r = harness.renderPage({ name: "playlist-head-" + size, windowSize: size, budgetMs: 30000, chromeArgs: TOUCH, stub: STUB, driver: PAGES_DRIVER });
    harness.assertNoPageError(assert, r);
    const names = { roon: "Late Night", long: LONG, mine: "Rouen Mix", dynamic: "Nineties", smart: "r&b random" };
    for (const k of Object.keys(names)) {
      const g = r[k];
      assert.ok(g, k + ": the page was never read");
      assert.equal(g.title, names[k], k + ": the screen's title is not the playlist's name");
      assert.equal(g.titleIn, "tnav-heading", k + ": the name is not the page's heading");
      assert.equal(g.pills, 0, k + ": the page still draws its own back button");
      assert.equal(g.headings, 0, k + ": the page still prints the name a second time");
      assert.equal(g.backShown, true, k + ": no ‹");
      assert.equal(g.pl, true, k + ": the page is not marked a playlist's page");
      assert.equal(g.scrolled, 0, k + ": read while scrolled");
      assert.equal(g.role, "heading", k + ": the name is not announced as the page's heading (the page's own h2 is gone)");
      // 2.0.4-t10 (playlist-artists.md §9, the owner, 2026-11-10: the top "fixed but reduced in size"): one line.
      assert.equal(g.lines.length, 1, k + ": the name is not on one line: " + JSON.stringify(g.lines));
      assert.ok(Math.abs(mid(g.lines[0]) - mid(g.back)) <= 1.5,
        `${k}: the name's first line is centred at ${mid(g.lines[0])}, the ‹ at ${mid(g.back)}`);
      assert.ok(g.lines[0].left >= g.back.right && g.lines[0].left <= g.back.right + 24,
        `${k}: the name starts at ${g.lines[0].left}, the ‹ ends at ${g.back.right}`);
      const last = g.lines[0];
      // A count of tracks goes beside the name; a longer line stays a line of its own under it.
      if (g.count) {
        assert.equal(g.sub, null, k + ": the count is beside the name and under it too");
        assert.ok(Math.abs(mid(g.count) - mid(g.lines[0])) <= 3, `${k}: the count (${mid(g.count)}) is not on the name's line (${mid(g.lines[0])})`);
        assert.ok(g.count.left >= g.lines[0].right - 0.5, `${k}: the count starts at ${g.count.left}, over the name ending at ${g.lines[0].right}`);
      } else {
        assert.ok(g.sub, k + ": no line under the name");
        assert.ok(Math.abs(g.sub.left - g.lines[0].left) <= 1, `${k}: the line under the name starts at ${g.sub.left}, the name at ${g.lines[0].left}`);
        assert.ok(g.sub.top >= last.bottom - 3, `${k}: the line under the name (${g.sub.top}) is over the name (${last.bottom})`);
      }
      assert.ok(g.actions, k + ": no buttons");
      const foot = Math.max(g.back.bottom, last.bottom);
      assert.ok(g.actions.top >= (g.sub ? g.sub.bottom : foot) && g.actions.top - foot <= 60,
        `${k}: the buttons start ${g.actions.top - foot}px under the name's line (the wasted space)`);
      // The owner, 2026-11-09: "On wide screens keep the play and queue buttons a reasonable size ... Too long".
      for (const b of g.btns) assert.ok(b.right - b.left <= 200.5, `${k}: a button ${b.right - b.left}px wide`);
    }
    assert.ok(r.roon.btns.length >= 2, "a Roon playlist's page has no Play now and Queue");
    const gapAfter = r.roon.actions.right - r.roon.rowEnd.right;
    if (r.roon.width < 500) assert.ok(gapAfter <= 1, `a phone's buttons no longer fill their row: ${gapAfter}px left over`);
    else assert.ok(r.roon.btns[0].right - r.roon.btns[0].left >= 149.5 && r.roon.btns[0].right - r.roon.btns[0].left <= 150.5,
      `a tablet's buttons are 150px (the Sort beside them, 2.0.4-t10): ${JSON.stringify(r.roon.btns)}`);
    assert.equal(r.roon.label, "Back to Playlists");
    assert.equal(r.mine.label, "Back to Playlists");
    assert.equal(r.dynamic.label, "Back to Dynamic Playlists");
    assert.equal(r.smart.label, "Back to Dynamic Playlists");
    assert.equal(r.roon.subText, "49 Tracks");
    assert.equal(r.mine.subText, "2 tracks");
    assert.deepEqual([r.roon.countText, r.mine.countText, r.dynamic.countText, r.smart.countText], ["49 Tracks", "2 tracks", "", ""],
      "only a count goes beside the name");
    assert.match(r.dynamic.subText, /^Albums · album order/);
    assert.match(r.smart.subText, /Smart playlist in Roon$/);
    // One line of name: the buttons begin within two of the ‹'s heights of the top (they began near 250px).
    assert.equal(r.roon.lines.length, 1, "a short name on more than one line");
    assert.ok(r.roon.actions.top <= 130, `the buttons of a short-named playlist start ${r.roon.actions.top}px down`);
    // A long name: one line, cut with …, where a short name's is; the count still beside it (2.0.4-t10, until then it
    // went on to a second line, 2.0.3-t9).
    assert.equal(r.long.clipped, true, "the long name is not cut: the test shows nothing");
    assert.ok(Math.abs(r.long.lines[0].top - r.roon.lines[0].top) <= 0.5,
      `the long name sits at ${r.long.lines[0].top}, a short one at ${r.roon.lines[0].top}`);
    assert.ok(r.long.count && r.long.count.right <= r.long.width, "the long name pushed its count off the screen");
    // The ‹ went back to the screen each was opened from, and that screen is not a playlist's page.
    assert.equal(r.overview.detail, false);
    assert.deepEqual(r.overview.tiles, TILES);
    assert.equal(r.overview.title, "Playlists");
    assert.equal(r.overview.pl, false);
    assert.deepEqual([r.overview.role, r.wall.role], ["", ""], "the bar's title left a heading on a screen that is not a playlist's page");
    assert.equal(r.overview.label, "Back to Home");
    assert.equal(r.wall.detail, false);
    assert.deepEqual(r.wall.tiles, WALL);
    assert.equal(r.wall.pl, false);
    assert.equal(r.wall.label, "Back to Home");
  });
}

test("the ‹ goes back to the screen the playlist was opened from, and only while the playlist's page is up", { skip: !harness.available }, async () => {
  const driver = HELPERS + `
  await menu("playlists");
  T("overview0", read());
  await open("Late Night");
  T("page", read());
  // An artist's page over the playlist's: its own ‹ comes back to the playlist, which still knows its way back.
  window.__showArtistAlbums("Sonic Youth");
  await window.__sleep(800);
  T("artist", read());
  await back();
  T("fromArtist", read());
  await back();
  T("overview1", read());
  // A playlist that didn't open: the name, the reason, and the same way back.
  await open("Broken");
  T("broken", read());
  await back();
  T("overview2", read());
  // And an artist's page over the page that didn't open: back to it, and it still knows its way back.
  await open("Broken");
  window.__showArtistAlbums("Sonic Youth");
  await window.__sleep(800);
  await back();
  T("brokenBack", read());
  await back();
  T("overview2b", read());
  // One of Rouen's own that could not be read: the same.
  await open("Lost Mix");
  T("lost", read());
  await back();
  T("overview2c", read());
  // Renamed since the list was read: the page's name is the one its own read gives.
  await open("Sundays");  T("renamed", read());     await back();
  await open("Drive");    T("mineRenamed", read()); await back();
  // Left by another road, the page is over: the next ‹ is the next screen's.
  await open("Late Night");
  document.getElementById("tnav-home").click();
  await window.__sleep(800);
  T("home", read());
  // Home hides the grid and leaves it as it was; a search from Home shows it for a moment before filling it. The
  // page that was left does not come back with it.
  var g0 = document.getElementById("album-grid");
  g0.classList.remove("hidden");
  await window.__sleep(100);
  T("revived", [window.RouenPlaylistHead.showing(), root.classList.contains("pl-page"), document.getElementById("topbar-back").getAttribute("aria-label")]);
  g0.classList.add("hidden");
  await window.__sleep(100);
  await menu("playlists");
  T("overview3", read());
  await back();
  T("homeAgain", read());
  // The page that didn't open, left by the menu: the Dynamic Playlists' ‹ goes Home, not to Playlists.
  await menu("playlists");
  await open("Broken");
  await menu("smart-playlists");
  T("wall", read());
  await back();
  T("homeFromWall", read());
  // An artist's page over a playlist's, left by the menu: the playlist's "Back to Playlists" is not left on the ‹.
  await menu("playlists");
  await open("Late Night");
  window.__showArtistAlbums("Sonic Youth");
  await window.__sleep(800);
  await menu("smart-playlists");
  T("wall2", read());
  await open("r&b random");
  T("smart", read());
  await back();
  T("wall3", read());
  // The module itself. A page is up from the moment it takes the grid, while it loads and if it could not be read
  // (the grid emptied down to its place); and over once the grid holds neither its place nor its wrap.
  var g = document.getElementById("album-grid"), w = document.createElement("div");
  g.appendChild(document.createElement("p"));
  var mount = window.RouenPlaylistHead.enter({ to: "Playlists", back: function () {} });
  T("apiLoading", window.RouenPlaylistHead.showing());
  mount();
  T("apiFailed", [window.RouenPlaylistHead.showing(), g.children.length, g.firstChild.hidden]);
  g.innerHTML = ""; g.appendChild(w); mount(w, "one line");
  T("apiUp", [window.RouenPlaylistHead.showing(), w.firstChild.className, w.textContent]);
  g.innerHTML = "";
  T("apiGone", window.RouenPlaylistHead.showing());
`;
  const r = harness.renderPage({ name: "playlist-head-back", windowSize: "390x844", budgetMs: 45000, chromeArgs: TOUCH, stub: STUB, driver });
  harness.assertNoPageError(assert, r);
  const tiles = TILES;
  assert.deepEqual([r.overview0.title, r.overview0.label, r.overview0.pl], ["Playlists", "Back to Home", false]);
  assert.deepEqual([r.page.title, r.page.label, r.page.tip, r.page.pl, r.page.detail], ["Late Night", "Back to Playlists", "Playlists", true, true]);
  assert.deepEqual([r.artist.label, r.artist.pl, r.artist.detail], ["Back", false, false], "an artist's page laid out as a playlist's");
  assert.deepEqual([r.fromArtist.title, r.fromArtist.label, r.fromArtist.pl, r.fromArtist.detail], ["Late Night", "Back to Playlists", true, true],
    "the playlist's page didn't come back from the artist's as it was");
  assert.deepEqual([r.overview1.detail, r.overview1.home, r.overview1.title, r.overview1.label, r.overview1.pl], [false, false, "Playlists", "Back to Home", false],
    "the ‹ of a playlist come back from an artist's page didn't go to Playlists");
  assert.deepEqual(r.overview1.tiles, tiles);
  assert.deepEqual([r.broken.title, r.broken.detail, r.broken.label, r.broken.pl], ["Broken", false, "Back to Playlists", true]);
  assert.match(r.broken.banner, /Roon didn't answer for that playlist/);
  assert.deepEqual([r.overview2.home, r.overview2.title], [false, "Playlists"], "the ‹ of a playlist that didn't open went Home");
  assert.deepEqual(r.overview2.tiles, tiles);
  assert.deepEqual([r.brokenBack.label, r.brokenBack.pl, r.brokenBack.detail], ["Back to Playlists", true, false],
    "a playlist that didn't open lost its way back under an artist's page");
  assert.deepEqual([r.overview2b.home, r.overview2b.title, r.overview2b.pl], [false, "Playlists", false],
    "the ‹ of a playlist that didn't open, come back from an artist's page, went Home");
  assert.deepEqual([r.lost.title, r.lost.detail, r.lost.label, r.lost.pl], ["Lost Mix", false, "Back to Playlists", true]);
  assert.match(r.lost.banner, /no longer stored/);
  assert.deepEqual([r.overview2c.home, r.overview2c.title], [false, "Playlists"], "the ‹ of one of Rouen's playlists that didn't open went Home");
  assert.deepEqual(r.overview2c.tiles, tiles);
  assert.deepEqual([r.renamed.title, r.mineRenamed.title], ["Sunday Mornings", "Drive Home"], "the page is named by its tile, not by what was read");
  assert.deepEqual(r.revived, [false, false, "Back to Home"], "a playlist's page that was left for Home came back with the grid");
  assert.deepEqual([r.home.home, r.home.pl, r.home.label], [true, false, "Back to Home"]);
  assert.deepEqual([r.overview3.title, r.overview3.pl, r.overview3.label], ["Playlists", false, "Back to Home"]);
  assert.equal(r.homeAgain.home, true, "the Playlists screen's ‹ didn't go Home");
  assert.deepEqual([r.wall.title, r.wall.pl, r.wall.label, r.wall.banner], ["Dynamic Playlists", false, "Back to Home", ""]);
  assert.equal(r.homeFromWall.home, true, "the ‹ of Dynamic Playlists went back to a playlist's page that was left");
  assert.deepEqual([r.wall2.title, r.wall2.pl, r.wall2.label], ["Dynamic Playlists", false, "Back to Home"],
    "a playlist's label left on the ‹ after its page was left from an artist's");
  assert.deepEqual([r.smart.title, r.smart.label, r.smart.pl], ["r&b random", "Back to Dynamic Playlists", true]);
  assert.deepEqual(r.wall3.tiles, WALL);
  assert.equal(r.wall3.home, false);
  assert.equal(r.apiLoading, true, "a page that has taken the grid and is still loading is not up");
  assert.deepEqual(r.apiFailed, [true, 1, true], "a page that could not be read: the grid is not emptied down to its hidden place, or the page is over");
  assert.deepEqual(r.apiUp, [true, "playlist-head", "one line"]);
  assert.equal(r.apiGone, false, "a page that was up and is gone still counts as up");
});

test("a mouse: the name in the bar beside the ‹, whole while there is room; the same single way back", { skip: !harness.available }, async () => {
  const driver = HELPERS + `
  await menu("playlists");
  await open("Late Night");
  T("page", read());
  await back();
  T("overview", read());
  await open(${JSON.stringify(LONG)});
  T("long", read());
  await menu("smart-playlists");
  await open("Nineties");
  T("dynamic", read());
  await back();
  T("wall", read());
`;
  // 800px wide: the long name is wider than half the window (the title's limit elsewhere) and narrower than the bar.
  const r = harness.renderPage({ name: "playlist-head-mouse", windowSize: "800x600", budgetMs: 30000, chromeArgs: harness.MOUSE, stub: STUB, driver });
  harness.assertNoPageError(assert, r);
  assert.equal(r.long.title, LONG);
  assert.equal(r.long.lines.length, 1, "the bar's title wrapped");
  assert.ok(r.long.lines[0].right - r.long.lines[0].left > r.long.width / 2, "the long name is not wider than half this window: the test shows nothing");
  assert.equal(r.long.clipped, false, "a name the bar has room for is cut short");
  for (const [k, name, to] of [["page", "Late Night", "Playlists"], ["dynamic", "Nineties", "Dynamic Playlists"]]) {
    const g = r[k];
    assert.equal(g.title, name);
    assert.equal(g.role, "heading");
    assert.notEqual(g.titleIn, "tnav-heading", k + ": the bar's title moved out of the bar for a mouse");
    assert.deepEqual([g.pills, g.headings], [0, 0], k + ": the page's own back button or heading is still drawn");
    assert.equal(g.label, "Back to " + to);
    assert.equal(g.lines.length, 1);
    assert.ok(g.lines[0].left >= g.back.right, k + ": the name is not after the ‹");
    assert.ok(Math.abs(mid(g.lines[0]) - mid(g.back)) <= 2, `${k}: the name (${mid(g.lines[0])}) is not on the ‹'s line (${mid(g.back)})`);
    assert.ok(g.sub && g.actions && g.actions.top >= g.sub.bottom, k + ": no line of what it is over the buttons");
  }
  assert.deepEqual([r.overview.detail, r.overview.title, r.overview.label], [false, "Playlists", "Back to Home"]);
  assert.deepEqual(r.overview.tiles, TILES);
  assert.ok(r.page.btns.length >= 2 && r.page.btns.every((b) => b.right - b.left <= 200.5 && b.right - b.left >= 120),
    "Play now and Queue across a wide window: " + JSON.stringify(r.page.btns));
  assert.deepEqual([r.wall.detail, r.wall.title], [false, "Dynamic Playlists"]);
});
