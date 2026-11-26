"use strict";
// ---------------------------------------------------------------------------
// Why these picks (2.0.6-t22, dev/design/smart-picks.md §6; public/smart-picks-why.js): on the Smart Picks screen a
// button before the picks; tapped, a sheet lists the day's seeds by genre with what each scored on, the next in line
// and the numbers. In the real page, against a stubbed /api/smart-picks and /api/smart-picks/why.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const PICKS = [{ kind: "adjacent", artist: "Labradford", album: "Mi Media Naranja", album_id: "q1", service: "qobuz", image: "",
  reason: "Because you play Keith Jarrett", genre: "" }];
const WHY = { day: "2026-11-26", at: Date.UTC(2026, 10, 26, 4), slots: [["Jazz", 1], ["Classical", 1]],
  seeds: [
    { name: "Keith Jarrett", genre: "Jazz", decade: "1970s", via: "listening", score: 2.1, albumPlays: 5, recentPlays: 2, tracks: 1, hub: false,
      albums: [{ title: "The Köln Concert", plays: 3 }], used: true },
    { name: "Johann Sebastian Bach", genre: "Classical", decade: "1980s", via: "listening", score: 0.4, albumPlays: 3, recentPlays: 0, tracks: 0, hub: true,
      albums: [{ title: "Goldberg Variations", plays: 3 }], used: false },
  ],
  left: [{ name: "Jan Garbarek", score: 0.3, hub: false }],
  tuned: ["Adventure: Far", "Pop/Rock: Never"],
  numbers: { halfLifeDays: 90, track: 0.1, hub: 0.25, minShare: 0.05 } };

const STUB = `
window.__installFetch(function (url) {
  if (url.indexOf("/api/smart-picks/why") > -1) return window.__json({ why: ${JSON.stringify(WHY)} });
  if (url.indexOf("/api/smart-picks") > -1) return window.__json({ day: "2026-11-26", service_ready: true, picks: ${JSON.stringify(PICKS)} });
  if (url.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (url.indexOf("/api/library/facets") > -1) return window.__json({ total: 0, facets: [], coverage: {}, hasPlays: false });
  if (url.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});`;

const DRIVER = `
  await window.__sleep(500);
  T("before", !!document.getElementById("why-picks-open"));
  document.getElementById("home-picks-title").click();
  await window.__sleep(700);
  var btn = document.getElementById("why-picks-open");
  var list = document.querySelector("#album-grid .pick-list");
  var row = document.getElementById("picks-tools");
  T("button", { there: !!btn, text: btn && btn.textContent, before_list: !!row && row.contains(btn) && row.nextElementSibling === list,
                tune: !!row && !!row.querySelector("#tune-picks-open"),
                width: btn ? Math.round(btn.getBoundingClientRect().width) : 0 });
  btn.click();
  await window.__sleep(500);
  var sheet = document.getElementById("why-picks");
  var body = document.getElementById("why-picks-body");
  T("sheet", { open: !!sheet && !sheet.classList.contains("hidden"),
               headings: Array.prototype.map.call(body.querySelectorAll("h3"), function (h) { return h.textContent; }),
               text: body.textContent.replace(/\\s+/g, " ") });
  document.getElementById("why-picks-close").click();
  T("closed", sheet.classList.contains("hidden"));
`;

test("Why these picks: a button before the picks; the seeds by genre, what each came from, the next in line", () => {
  if (!harness.available) return;
  const r = harness.renderPage({ name: "smart-picks-why", windowSize: "390x844", budgetMs: 15000, stub: STUB, driver: DRIVER });
  harness.assertNoPageError(assert, r);
  assert.equal(r.before, false, "a Why button on Home");
  assert.equal(r.button.there, true, "THE one: no way to see why these picks");
  assert.equal(r.button.text, "Why these picks");
  assert.equal(r.button.before_list, true);
  assert.equal(r.button.tune, true, "Tune's button beside it (2.0.7-t1)");
  assert.ok(r.button.width > 0 && r.button.width < 390, "the button off the screen at phone width");
  assert.equal(r.sheet.open, true);
  assert.deepEqual(r.sheet.headings, ["Jazz · 1 seed", "Classical · 1 seed", "Next in line, not chosen today"]);
  assert.match(r.sheet.text, /Keith Jarrett · 1970s · score 2\.1/);
  assert.match(r.sheet.text, /5 whole-album plays \(2 in the last 90 days\); 1 day of its tracks played on their own/);
  assert.match(r.sheet.text, /The Köln Concert/);
  assert.match(r.sheet.text, /Johann Sebastian Bach .*reduced: widely played; not found on MusicBrainz, so not used/);
  assert.match(r.sheet.text, /Jan Garbarek \(0\.3\)/);
  assert.match(r.sheet.text, /half-life 90 days/);
  assert.match(r.sheet.text, /Tuned: Adventure: Far; Pop\/Rock: Never\./, "the Tune it was built with, not said");
  assert.equal(r.closed, true);
});
