"use strict";
// ---------------------------------------------------------------------------
// A Smart Pick's card on the Smart Picks screen, on a phone (public/picks.css, 2.0.8-t11). The owner, 2026-11-27, with
// screenshots: The Chameleons' "Script Of The Bridge - 25th Anniversary Edition" and Kenny Wayne Shepherd's "Ledbetter
// Heights (30th Anniversary Sessions)" showed their text under the cover, the others beside it. The text asked for its
// whole width on one line ("flex: 1 1 auto") and, wrapping allowed on a phone, took a line of its own.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const PICK = (artist, album) => ({ kind: "adjacent", artist, album, album_id: "", service: "qobuz", image: "",
  reason: "Because you play Killing Joke", genre: "", added: null, offset: null, services: [] });
const PICKS = [PICK("Yazoo", "Upstairs at Eric's"), PICK("The Chameleons", "Script Of The Bridge - 25th Anniversary Edition"),
  PICK("Kenny Wayne Shepherd", "Ledbetter Heights (30th Anniversary Sessions)")];

const STUB = `
window.__installFetch(function (url) {
  if (url.indexOf("/api/smart-picks") > -1) return window.__json({ day: "2026-11-27", service_ready: true, picks: ${JSON.stringify(PICKS)} });
  if (url.indexOf("/api/zones") > -1) return window.__json({ zones: [] });
  if (url.indexOf("/api/library/add") > -1) return window.__json({ state: "none" });
  if (url.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});`;

test("THE one for the owner: on a phone every pick's text sits beside its cover, a long title's too", () => {
  if (!harness.available) return;
  const r = harness.renderPage({ name: "smart-picks-card", windowSize: "390x844", budgetMs: 15000, stub: STUB, driver: `
    await window.__sleep(500);
    window.__showSmartPicks();
    for (var i = 0; i < 80 && document.querySelectorAll("#album-grid .pick-card-full").length < 3; i++) await window.__sleep(25);
    // The owner's phone: a list about 380px wide. The headless window is never under 500px (its phone rules, under 520,
    // apply there already), so the list is narrowed to a phone's width.
    document.getElementById("album-grid").style.width = "380px";
    await window.__sleep(50);
    T("cards", [].map.call(document.querySelectorAll("#album-grid .pick-card-full"), function (c) {
      var art = c.querySelector(".pick-art").getBoundingClientRect(), meta = c.querySelector(".pick-meta").getBoundingClientRect();
      return { album: c.querySelector(".pick-album").textContent, beside: meta.left >= art.right - 0.5 && meta.top < art.bottom,
        inside: meta.right <= c.getBoundingClientRect().right + 0.5 };
    }));
  ` });
  harness.assertNoPageError(assert, r);
  assert.equal(r.cards.length, 3, "the screen showed " + r.cards.length + " cards");
  for (const c of r.cards) {
    assert.ok(c.beside, `THE one: "${c.album}" — its text under its cover, not beside it`);
    assert.ok(c.inside, `"${c.album}" — its text runs past the card`);
  }
});
