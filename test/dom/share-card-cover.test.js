"use strict";
// ---------------------------------------------------------------------------
// v1.8.82 (Mandarin v0.7.5, v0.7.6): what the share card is drawn from.
//
//   1. The cover is the one ALREADY ON SCREEN: the album view's and Now
//      playing's 800px address, with nothing appended. It was ?size=1000 plus a
//      timestamp — a size nothing else uses and an address that could never be
//      cached, so every share made the server resize the full cover and the
//      phone download it.
//   2. Rouen's own tile in the card's corner (Mandarin draws its duck there).
//   3. The card goes on screen as an object URL, not a base64 copy of the PNG.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const STUB = `
try { localStorage.setItem("rra-zone", "z1"); } catch (e) {}
window.__installFetch(function (u) {
  if (u.indexOf("/api/album/extras") > -1) return window.__json({ year: 2019 });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: null });
  if (u.indexOf("/api/status") > -1)     return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1)           return window.__json({});
  return undefined;
});
`;

test("the share card draws the cover already on screen, with Rouen's tile (v1.8.82)", async (t) => {
  if (!harness.available) { t.skip("no chromium binary available"); return; }
  const r = harness.renderPage({ name: "share-card-cover", windowSize: "390x844", stub: STUB, budgetMs: 30000, driver: `
    await window.__sleep(600);
    window.__renders = [];
    ShareCard.render = function (data) {
      window.__renders.push(data);
      return Promise.resolve(new Blob([new Uint8Array([1,2,3])], { type: "image/png" }));
    };
    window.__openShareCard({ title: "Western Stars", artist: "Bruce Springsteen", image_key: "k0" });
    for (var w = 0; w < 80 && !document.querySelector("#share-frame img"); w++) await window.__sleep(50);
    var d = window.__renders[0] || {};
    T("cover", d.coverUrl || null);
    T("logo", d.logoUrl || null);
    T("img_src", (document.querySelector("#share-frame img") || {}).src || null);
  ` });
  harness.assertNoPageError(assert, r);
  assert.equal(r.cover, "/api/image/k0?size=800",
    "the card must ask for the album view's / Now playing's address, so the browser already has it");
  assert.equal(r.logo, "/icons/rouen-tile.png");
  assert.match(String(r.img_src), /^blob:/, "the card should be shown from an object URL");
});
