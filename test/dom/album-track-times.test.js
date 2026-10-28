"use strict";
// ---------------------------------------------------------------------------
// v1.9.70-t14 (public/album-view.js, dev/design/native-remote.md §16.6): each track's length beside it on the album
// view, from your server through native mode (/api/album/track-times). The owner, from the TV and the iPad: the album
// view's tracks had no times. The rows are the public API's and the lengths the server's own list, so they are matched
// by title, in order: a repeated title takes its lengths in turn, a row with no length to take gets none, and with
// native mode off ("none") the rows are as they were.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const ALBUM = { offset: 0, title: "Morph the Cat", subtitle: "Donald Fagen", image_key: "k" };
const OTHER = { offset: 1, title: "Kamakiriad", subtitle: "Donald Fagen", image_key: "k2" };
const detail = (titles) => ({ title: "x", subtitle: "Donald Fagen", image_key: "k",
  actions: [{ kind: "play_now", title: "Play Now" }], tracks: titles.map((t) => ({ title: t, subtitle: "Donald Fagen" })) });
const TIMES = {
  // the server's own list: a title in another case, the same title twice, and one row (Hidden Track) it doesn't have
  "Morph the Cat": [{ disc: 1, number: 1, title: "Morph The Cat", seconds: 409 }, { disc: 1, number: 2, title: "H Gang", seconds: 315 },
    { disc: 1, number: 3, title: "Interlude", seconds: 61 }, { disc: 1, number: 4, title: "Interlude", seconds: 125 },
    // a curly apostrophe and a composed é, where the rows have a straight one and a decomposed one
    { disc: 1, number: 5, title: "Don\u2019t Stop at Caf\u00e9", seconds: 200 }],
  // an en dash and curly double quotes, where the rows have a hyphen and straight ones
  "Kamakiriad": [{ disc: 1, number: 1, title: "Trans\u2013Island Skyway", seconds: 456 }, { disc: 1, number: 2, title: "\u201cHeroes\u201d", seconds: 61 }],
};
const ROWS = { "Morph the Cat": ["Morph the Cat", "H Gang", "Interlude", "Hidden Track", "Interlude", "Don't Stop at Cafe\u0301"], "Kamakiriad": ["Trans-Island Skyway", "\"Heroes\""] };

const stub = (status) => `
window.__asked = [];
window.__installFetch(function (url) {
  var title = decodeURIComponent((url.match(/title=([^&]*)/) || [])[1] || "").replace(/\\+/g, " ");
  if (url.indexOf("/api/album/track-times") > -1) {
    window.__asked.push(title);
    return window.__json(${JSON.stringify(status)} === "ok" ? { tracks: ${JSON.stringify(TIMES)}[title] || [], status: "ok" }
      : { tracks: [], status: ${JSON.stringify(status)}, why: "Native mode is off." });
  }
  if (url.indexOf("/api/user-playlists") > -1) return window.__json({ playlists: [] });
  if (url.indexOf("/api/album/extras") > -1)  return window.__json({});
  if (url.indexOf("/api/album/credits") > -1) return window.__json({ credits: [], status: "ok" });
  if (url.indexOf("/api/album/more") > -1)    return window.__json({ artist: "Donald Fagen", by: [], appears: [] });
  if (url.indexOf("/api/lastfm/") > -1)       return window.__json({ enabled: false });
  if (url.indexOf("/api/album") > -1)
    return window.__json(${JSON.stringify({ a: detail(ROWS["Morph the Cat"]), b: detail(ROWS.Kamakiriad) })}[title === "Kamakiriad" ? "b" : "a"]);
  if (url.indexOf("/api/zones") > -1)      return window.__json({ zones: [] });
  if (url.indexOf("/api/filters") > -1)    return window.__json({ genres: [] });
  if (url.indexOf("/api/home/") > -1)      return window.__json({ albums: [], label: null });
  if (url.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  if (url.indexOf("/api/settings") > -1)   return window.__json({});
  if (url.indexOf("/api/random-albums") > -1) return window.__json({ albums: [${JSON.stringify(ALBUM)}], total: 1, filtered: false });
  return undefined;
});`;

const DRIVER = `
  function rows() { return Array.prototype.map.call(document.querySelectorAll("#modal-tracks li.t-row"), function (li) {
    var len = li.querySelector(".t-len"), title = li.querySelector(".t-title");
    var a = len && len.getBoundingClientRect(), b = title.getBoundingClientRect();
    return { title: title.textContent, len: len ? len.textContent : null, right: len ? a.left >= b.right - 1 : null, line: len ? Math.abs(a.top - b.top) <= 4 : null };
  }); }
  await window.__sleep(700);
  window.__openAlbum(${JSON.stringify(ALBUM)}, { source: "search" });
  await window.__sleep(1500);
  T("first", rows());
  window.__openAlbum(${JSON.stringify(OTHER)}, { source: "search" });
  await window.__sleep(1500);
  T("second", rows());
  window.__openAlbum(${JSON.stringify(ALBUM)}, { source: "search" });
  await window.__sleep(1200);
  T("again", rows());
  T("asked", window.__asked);
`;

for (const [size, args] of [["1920x1080", harness.MOUSE], ["390x844", null]]) {
  test(`v1.9.70-t14 (${size}): each track's length beside it, matched by title; another album, its own`, { skip: !harness.available }, async (t) => {
    const r = harness.renderPage({ name: "album-times-" + size, windowSize: size, stub: stub("ok"), driver: DRIVER, chromeArgs: args || undefined, budgetMs: 20000 });
    harness.assertNoPageError(assert, r);
    await t.test("THE one: the lengths, as m:ss, at each row's right on its title's line", () => {
      assert.deepEqual(r.first.map((x) => [x.title, x.len]), [["Morph the Cat", "6:49"], ["H Gang", "5:15"], ["Interlude", "1:01"],
        ["Hidden Track", null], ["Interlude", "2:05"], ["Don't Stop at Cafe\u0301", "3:20"]],
        "a repeated title takes its lengths in turn; a row with none to take gets none; quotes and accents however written");
      for (const x of r.first.filter((x) => x.len)) assert.deepEqual([x.right, x.line], [true, true], JSON.stringify(x));
    });
    await t.test("another album: its own lengths, none of the last one's; back again: no second ask", () => {
      assert.deepEqual(r.second.map((x) => [x.title, x.len]), [["Trans-Island Skyway", "7:36"], ['"Heroes"', "1:01"]]);
      assert.deepEqual(r.again.map((x) => x.len), ["6:49", "5:15", "1:01", null, "2:05", "3:20"]);
      assert.deepEqual(r.asked, ["Morph the Cat", "Kamakiriad"], "the first album asked again");
    });
  });
}

test("v1.9.70-t14: native mode off — no lengths, the rows as they were", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "album-times-off", windowSize: "1440x900", stub: stub("none"), driver: DRIVER, chromeArgs: harness.MOUSE, budgetMs: 20000 });
  harness.assertNoPageError(assert, r);
  await t.test("no row has a length", () => {
    assert.ok(r.first.length === 6 && r.first.every((x) => x.len === null), JSON.stringify(r.first));
  });
  await t.test("THE review: an album with none is not asked again when opened again, nor at each redraw", () => {
    assert.deepEqual(r.asked, ["Morph the Cat", "Kamakiriad"]);
  });
});
