"use strict";
// ---------------------------------------------------------------------------
// v1.9.72-t12: Now playing's format badge (Mandarin's), for a phone's zone — the owner: "add to the now playing screen
// if the music playing is lossless or opus, just as Mandarin does. Use the opus logo like mandarin as well". The badge
// sits under the album name: the Opus logo (Xiph.Org's, drawn by album-view.css as a mask) beside "256kbps", or
// "Lossless" with its depth and rate; none for any other zone. It follows the zone as the poll does, and the title's
// "(…)" line (moved to album-view.js in the same build) is as it was.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const ZONE = {
  zone_id: "z1", display_name: "Rouen A142", state: "playing", outputs: [],
  now_playing: { line1: "Hangover Sex (with Viktoria Tolstoy)", line2: "Esbjörn Svensson Trio", line3: "Viaticum",
    artists: [{ name: "Esbjörn Svensson Trio", linkable: false }], length: 300, seek_position: 30,
    format: { kind: "opus", text: "256kbps" } },
};

const STUB = `
window.__zone = ${JSON.stringify(ZONE)};
window.__installFetch(function (url) {
  if (url.indexOf("/api/zone-state") > -1) return window.__json({ zone: window.__zone });
  if (url.indexOf("/api/zones") > -1)      return window.__json({ zones: [window.__zone] });
  if (url.indexOf("/api/queue") > -1)      return window.__json({ items: [] });
  if (url.indexOf("/api/filters") > -1)    return window.__json({ genres: [] });
  if (url.indexOf("/api/home/") > -1)      return window.__json({ albums: [], label: null });
  if (url.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  if (url.indexOf("/api/settings") > -1)   return window.__json({});
  if (url.indexOf("/api/random-albums") > -1) return window.__json({ albums: [], total: 0, filtered: false });
  return undefined;
});
`;

const DRIVER = `
  await window.__sleep(400);
  var bar = document.getElementById("mini-transport");
  for (var w = 0; w < 40 && bar.classList.contains("hidden"); w++) await window.__sleep(100);
  document.querySelector(".mt-info").click();
  await window.__sleep(500);
  var f = document.getElementById("np-format");
  function seen() {
    var logo = f.querySelector(".np-format-opus");
    return { hidden: f.classList.contains("hidden"), kind: f.className, logo: !!logo,
      logoMasked: !!logo && getComputedStyle(logo).maskImage.indexOf("svg") > -1, text: (f.querySelector(".np-format-text") || {}).textContent || "",
      label: f.getAttribute("aria-label"), under: f.previousElementSibling && f.previousElementSibling.id };
  }
  T("opus", seen());
  T("title", [document.getElementById("np-track").childNodes[0].textContent, (document.querySelector("#np-track .np-track-sub") || {}).textContent]);
  window.__zone.now_playing.format = { kind: "lossless", text: "Lossless · 24-bit/96 kHz" };
  await window.__sleep(2500);
  T("lossless", seen());
  window.__zone.now_playing.format = null;
  await window.__sleep(2500);
  T("none", seen());
`;

test("Now playing: a phone's zone wears the Opus logo and 256kbps, or Lossless with its depth and rate; any other zone nothing", () => {
  const r = harness.renderPage({ stub: STUB, driver: DRIVER, name: "np-format", budgetMs: 30000 });
  harness.assertNoPageError(assert, r);
  assert.deepEqual(r.opus, { hidden: false, kind: "np-format is-opus", logo: true, logoMasked: true, text: "256kbps", label: "Opus 256kbps", under: "np-album" });
  assert.deepEqual(r.title, ["Hangover Sex", "(with Viktoria Tolstoy)"], "the title's detail on its own line, as before");
  assert.deepEqual(r.lossless, { hidden: false, kind: "np-format is-lossless", logo: false, logoMasked: false, text: "Lossless · 24-bit/96 kHz",
    label: "Lossless · 24-bit/96 kHz", under: "np-album" });
  assert.deepEqual(r.none, { hidden: true, kind: "np-format hidden", logo: false, logoMasked: false, text: "", label: null, under: "np-album" });
});
