"use strict";
// ---------------------------------------------------------------------------
// v1.9.72-t80: never Download to this phone for a TIDAL or Qobuz album (the owner, 2026-11-03: "I tapped on a Qobuz
// album and it showed the download this album option … it must not be allowed to download Tidal or Qobuz albums ever.
// It's forbidden"). Before, the only gate was Rouen's /music answer by title and artist, so a Qobuz album with a local
// namesake offered Download (and fetched the local files). album-actions.js now refuses by the album's own source:
//   - a TIDAL or Qobuz album browsed through Roon (streaming.js passes download: false): no Download;
//   - a library album whose source is TIDAL or Qobuz: no Download, even with a local namesake in /music;
//   - a local album: Download, as before.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const STUB = `
window.RouenPhone = {
  settings: function () { return JSON.stringify({ network: "home", places: [] }); },
  albums: function () { return "[]"; },
  album: function () { return '{"state":"none"}'; },
  albumState: function () { return '{"state":"none"}'; },
  albumDownload: function () { return "{}"; }, albumRemove: function () { return "{}"; },
  localState: function () { return JSON.stringify({ state: "stopped" }); },
  localQueue: function () { return "[]"; }
};
window.__installFetch(function (u) {
  // A local namesake: /music has an album of this title and artist.
  if (u.indexOf("/api/phone/album") > -1) return window.__json({ title: "Heathen", artist: "David Bowie", tracks: [{ n: 1 }] });
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [] });
  return undefined;
});`;

const DRIVER = `
  await window.__sleep(600);
  var answer = { actions: [{ kind: "play_now" }, { kind: "queue" }, { kind: "play_next" }],
    album: { title: "Heathen", subtitle: "David Bowie" }, tracks: [] };
  var menu = function (extra, album) {
    var labels = null;
    window.RouenAlbumActions.build(Object.assign({ row: document.createElement("div"), answer: answer, album: album,
      invoke: function () {}, setListenLater: async function () { return null; }, toast: function () {},
      buildOverflowMenu: function (items) { labels = items.map(function (i) { return i.label; }); return document.createElement("div"); },
      listenLater: false, heart: false }, extra));
    return labels || [];
  };
  T("roonPage", menu({ download: false }, { title: "Heathen", subtitle: "David Bowie" }));
  T("qobuz", menu({}, { title: "Heathen", subtitle: "David Bowie", source: "qobuz" }));
  T("tidal", menu({}, { title: "Heathen", subtitle: "David Bowie", source: "tidal" }));
  T("local", menu({}, { title: "Heathen", subtitle: "David Bowie", source: "local" }));
`;

test("v1.9.72-t80: no Download for a TIDAL or Qobuz album, ever; a local album keeps it", { skip: !harness.available }, async (t) => {
  const r = harness.renderPage({ name: "no-service-downloads", windowSize: "390x844", stub: STUB, driver: DRIVER });
  harness.assertNoPageError(assert, r);
  const has = (labels) => labels.some((l) => /Download/.test(l));
  await t.test("THE one: a Qobuz album with a local namesake offers no Download", () => {
    assert.equal(has(r.qobuz), false, "Download offered on a Qobuz album: " + r.qobuz.join(", "));
  });
  await t.test("a TIDAL album, and a service's album browsed through Roon, neither", () => {
    assert.equal(has(r.tidal), false);
    assert.equal(has(r.roonPage), false);
  });
  await t.test("a local album keeps Download", () => {
    assert.equal(has(r.local), true, "no Download on a local album: " + r.local.join(", "));
  });
});
