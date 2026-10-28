"use strict";
// ---------------------------------------------------------------------------
// v1.9.70-t11: the album view on Safari before 14 (an iPad on iOS 13 or older). Its MediaQueryList has addListener
// and no addEventListener. v1.9.70-t10's album-view.js called addEventListener on one as it loaded: the TypeError
// stopped the rest of the file, RouenAlbumView was never defined, and app.js, which calls it on every album opened,
// threw — the album view did not open. Simulated here by taking addEventListener off MediaQueryList before any script
// of the page runs, and any script of the page that throws for want of it fails the test.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const ALBUM = { offset: 0, title: "Kid A", subtitle: "Radiohead", image_key: "k" };
const DETAIL = { title: "Kid A", subtitle: "Radiohead", image_key: "k",
  actions: [{ kind: "play_now", title: "Play Now" }], tracks: [{ title: "Idioteque", subtitle: "Radiohead" }] };

const STUB = `
// Safari before 14: the old listener calls only.
// (inherited from EventTarget, so shadowed rather than deleted)
Object.defineProperty(MediaQueryList.prototype, "addEventListener", { value: undefined, configurable: true });
Object.defineProperty(MediaQueryList.prototype, "removeEventListener", { value: undefined, configurable: true });
window.__installFetch(function (url) {
  if (url.indexOf("/api/user-playlists") > -1) return window.__json({ playlists: [] });
  if (url.indexOf("/api/album/extras") > -1)  return window.__json({ album: { description: "A review.", source: "wikipedia", url: "https://en.wikipedia.org/wiki/Kid_A" } });
  if (url.indexOf("/api/album/credits") > -1) return window.__json({ credits: [], status: "ok" });
  if (url.indexOf("/api/album/more") > -1)    return window.__json({ artist: "Radiohead", by: [], appears: [] });
  if (url.indexOf("/api/lastfm/") > -1)       return window.__json({ enabled: false });
  if (url.indexOf("/api/album") > -1)      return window.__json(${JSON.stringify(DETAIL)});
  if (url.indexOf("/api/zones") > -1)      return window.__json({ zones: [] });
  if (url.indexOf("/api/filters") > -1)    return window.__json({ genres: [] });
  if (url.indexOf("/api/home/") > -1)      return window.__json({ albums: [], label: null });
  if (url.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  if (url.indexOf("/api/settings") > -1)   return window.__json({});
  if (url.indexOf("/api/random-albums") > -1)
    return window.__json({ albums: [${JSON.stringify(ALBUM)}], total: 1, filtered: false });
  return undefined;
});`;

const DRIVER = `
  await window.__sleep(800);
  T("noAddEventListener", typeof window.matchMedia("(min-width: 1px)").addEventListener);
  T("albumView", typeof window.RouenAlbumView);
  var err = null;
  try { window.__openAlbum(${JSON.stringify(ALBUM)}, { source: "search" }); } catch (e) { err = String(e && e.message || e); }
  await window.__sleep(1200);
  T("openError", err);
  var modal = document.getElementById("album-modal");
  T("open", !modal.classList.contains("hidden"));
  T("tracks", document.querySelectorAll("#modal-tracks li").length);
`;

test("v1.9.70-t11: on Safari before 14 (no MediaQueryList.addEventListener) the album view still opens", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "album-old-safari", windowSize: "1180x820", stub: STUB, driver: DRIVER, budgetMs: 20000 });
  // The gate for the class of error: no script of the page throws for want of the newer call.
  harness.assertNoPageError(assert, r);
  await t.test("the simulation holds: no addEventListener on a MediaQueryList", () => {
    assert.equal(r.noAddEventListener, "undefined");
  });
  await t.test("album-view.js ran to its end, and an album opens with its tracks", () => {
    assert.equal(r.albumView, "object", "RouenAlbumView was never defined");
    assert.equal(r.openError, null, "opening an album threw: " + r.openError);
    assert.equal(r.open, true, "the album view did not open");
    assert.ok(r.tracks >= 1, "no tracks drawn");
  });
});
