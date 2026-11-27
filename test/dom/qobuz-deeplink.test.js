"use strict";
// ---------------------------------------------------------------------------
// v1.8.36: the Qobuz links, upgraded after the row is drawn.
//
// lib/qobuz-deeplink.js decides WHICH id (unit-tested). This is about the two
// properties that only exist in the browser:
//
//   1. the upgrade happens AFTER the rows are on screen and never before —
//      it costs a page read on the server, and a suggestion must not wait on
//      it;
//   2. a failure leaves the search link that was already there, which is not
//      nothing.
//
// Plus the rule that stops it being wasted work: only when Qobuz is the
// default, because that is the only link the rows actually point at.
//
// 2.0.6-t12: the suggestions are no links any more (they open Roon's search
// inside Rouen); the card's own Qobuz chip is still upgraded.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const QOBUZ_SEARCH = "https://www.qobuz.com/gb-en/search/?q=Iggy%20Pop%20The%20Idiot";
const TIDAL_SEARCH = "https://tidal.com/search?q=Iggy%20Pop%20The%20Idiot";
const DEEP = "https://open.qobuz.com/album/abc123";

const ACTS = [
  { name: "Iggy Pop", album: "The Idiot", year: 1977, in_library: false, offset: null,
    services: [{ id: "qobuz", name: "Qobuz", url: QOBUZ_SEARCH },
               { id: "tidal", name: "TIDAL", url: TIDAL_SEARCH }] },
];

const EXTRAS = { year: 1977, album: null, artist: null,
                 links: { services: [{ id: "qobuz", name: "Qobuz", url: "https://www.qobuz.com/gb-en/search/?q=card" },
                                     { id: "tidal", name: "TIDAL", url: "https://tidal.com/search?q=card" }],
                          reviews: [] } };

// answer: "deep" resolves, "none" returns null, "slow" holds the answer back.
function stubFor(answer, pref) {
  return `
window.__linkCalls = [];
try {
  localStorage.setItem("rra-zone", "z1");
  ${pref ? `localStorage.setItem("musicd-share-service", ${JSON.stringify(pref)});` : ""}
} catch (e) {}
window.__installFetch(function (u) {
  if (u.indexOf("/api/qobuz-link") > -1) {
    window.__linkCalls.push(u);
    var answer = ${JSON.stringify(answer)};
    if (answer === "none") return window.__json({ url: null });
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(window.__json({ url: ${JSON.stringify(DEEP)} })); },
                 answer === "slow" ? 900 : 0);
    });
  }
  if (u.indexOf("/api/similar") > -1)      return window.__json({ acts: ${JSON.stringify(ACTS)} });
  if (u.indexOf("/api/album/extras") > -1) return window.__json(${JSON.stringify(EXTRAS)});
  if (u.indexOf("/api/zones") > -1)        return window.__json({ zones: [{ zone_id: "z1", display_name: "Room", state: "stopped", outputs: [] }] });
  if (u.indexOf("/api/zone-state") > -1)   return window.__json({ zone: null });
  if (u.indexOf("/api/home/") > -1)        return window.__json({ albums: [], label: null });
  if (u.indexOf("/api/status") > -1)       return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1)             return window.__json({});
  return undefined;
});
`;
}

const DRIVER = `
  await window.__sleep(700);
  if (document.fonts) document.fonts.load = function () { return Promise.resolve([]); };
  window.FileReader = function () {
    this.readAsDataURL = function () {
      this.result = "data:image/png;base64,AA==";
      var self = this;
      setTimeout(function () { if (self.onload) self.onload(); }, 0);
    };
  };
  ShareCard.render = function () {
    return Promise.resolve(new Blob([new Uint8Array([1])], { type: "image/png" }));
  };
  async function until(what, fn) {
    for (var i = 0; i < 600; i++) { if (fn()) return true; await window.__sleep(25); }
    T("TIMED_OUT_WAITING_FOR", what);
    return false;
  }
  var rowSel = "#share-similar-list .share-similar-act";   // a button since 2.0.6-t12, a link before
  var rowHref = function () {
    var a = document.querySelector(rowSel);
    return a ? a.getAttribute("href") : null;
  };

  window.__openShareCard({ title: "Low", artist: "David Bowie", image_key: "k0" });
  await until("the suggestion row", function () { return !!document.querySelector(rowSel); });

  // The row is ON SCREEN — this is the moment the upgrade must not have been
  // waited for. Its href is whatever the server first sent.
  T("href_when_drawn", rowHref());
  T("calls_when_drawn", window.__linkCalls.length);

  await window.__sleep(1500);   // room for the upgrade, slow answer included
  T("href_after", rowHref());
  T("calls_after", window.__linkCalls.slice());
  var chip = document.querySelector('#share-links a[data-service="qobuz"]');
  T("chip_after", chip ? chip.getAttribute("href") : null);
`;

// Starts with TIDAL as the default — so the rows were drawn pointing at a
// service that needs no lookup — and then holds the Qobuz chip.
const SWITCH_DRIVER = DRIVER + `
  var chipFor = function (id) {
    return document.querySelector('#share-links a[data-service="' + id + '"]');
  };
  T("href_before_switch", rowHref());
  chipFor("qobuz").dispatchEvent(new Event("contextmenu", { bubbles: true, cancelable: true }));
  await window.__sleep(1500);
  T("href_after_switch", rowHref());
`;

function render(answer, pref, driver) {
  const r = harness.renderPage({ stub: stubFor(answer, pref), driver: driver || DRIVER,
                                 name: "qobuz-deeplink-" + answer, windowSize: "390x900",
                                 budgetMs: 60000 });
  harness.assertNoPageError(assert, r);
  assert.equal(r.TIMED_OUT_WAITING_FOR, undefined,
    "the driver gave up waiting for " + r.TIMED_OUT_WAITING_FOR);
  return r;
}

// 2.0.6-t12: the suggestions open Roon's own search inside Rouen (public/streaming.js find), not a link (the owner,
// 2026-11-24: "The share card suggestions are still opening Qobuz download site and not via search within Rouen
// Lite"). They are looked up no more; the card's own Qobuz chip, still a link to the record on the card, is.
test("the card's Qobuz chip is upgraded to one that opens the app; the suggestions are not links", { concurrency: 1 }, async (t) => {
  await t.test("the chip's search link is replaced by an album link", () => {
    const r = render("deep");
    assert.equal(r.chip_after, DEEP, "the card's Qobuz chip was left on the store");
  });

  await t.test("THE one: a suggestion is no link, and no page read is spent on one", () => {
    for (const pref of [undefined, "tidal"]) {
      const r = render("deep", pref);
      assert.equal(r.href_after, null, "a suggestion is a link again: " + r.href_after);
      const forRows = r.calls_after.filter(u => u.indexOf("The+Idiot") > -1 || u.indexOf("The%20Idiot") > -1);
      assert.deepEqual(forRows, [], "a page read was spent on a suggestion: " + forRows.join(", "));
    }
  });

  await t.test("switching the default to Qobuz looks nothing up for the suggestions either", () => {
    const r = render("deep", "tidal", SWITCH_DRIVER);
    assert.equal(r.href_after_switch, null);
  });
});
