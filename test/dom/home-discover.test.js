"use strict";
// ---------------------------------------------------------------------------
// Home's Discover row (public/home-discover.js, 2.0.8-t8). The owner, 2026-11-26: "Discover and smart picks just aren't
// showing on home screen and they are set to". Home had no Discover row at all: Discover was a screen of the side menu.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const harness = require("./harness");

const REL = (i, lib) => ({ artist: "Artist " + i, album: "Record " + i, cover: "https://e.invalid/" + i + ".jpg", year: 2026, in_library: !!lib,
  library_title: lib ? "Record " + i : null, library_subtitle: lib ? "Artist " + i : null, image_key: lib ? "k" + i : null, offset: lib ? i : null, services: [] });

const stub = (discover, rows) => `
try { localStorage.setItem("rra-zone", "z1"); } catch (e) { /* storage optional: the zone falls back to the first */ }
window.__installFetch(function (u) {
  if (u.indexOf("/api/settings/home-rows") > -1) return window.__json({ rows: ${JSON.stringify(rows)} });
  if (u.indexOf("/api/discover") > -1) return window.__json(${JSON.stringify(discover)});
  if (u.indexOf("/api/zones") > -1) return window.__json({ zones: [{ zone_id: "z1", display_name: "Zone", state: "stopped", outputs: [] }] });
  if (u.indexOf("/api/zone-state") > -1) return window.__json({ zone: null });
  if (u.indexOf("/api/queue") > -1) return window.__json({ items: [] });
  if (u.indexOf("/api/home/") > -1) return window.__json({ albums: [], label: null });
  if (u.indexOf("/api/status") > -1) return window.__json({ paired: true });
  if (u.indexOf("/api/") > -1) return window.__json({});
  return undefined;
});`;

const DRIVER = `
  await window.__sleep(900);
  var sec = document.querySelector('#home-sections [data-row="discover"]');
  var shown = !!sec && !sec.classList.contains("hidden") && getComputedStyle(sec).display !== "none";
  T("row", sec ? { shown: shown, title: sec.querySelector(".home-section-title").textContent,
    records: sec.querySelectorAll("#home-discover > *").length, note: sec.querySelector(".home-carousel-empty").textContent,
    after: sec.previousElementSibling ? sec.previousElementSibling.dataset.row : null,
    wide: sec.getBoundingClientRect().right <= window.innerWidth + 0.5 } : null);
  var opened = 0;
  window.__showDiscover = function () { opened++; };
  if (sec) sec.querySelector(".home-section-title").click();
  T("opened", opened);
`;

const ON = ["unplayed", "history", "later", "picks", "discover", "random", "library", "lotw", "genres"].map((id) => ({ id, on: true }));

test("THE one for the owner: Discover is a row on Home, after Smart Picks — its newest records, six at most; its title opens the screen", () => {
  if (!harness.available) return;
  const r = harness.renderPage({ name: "home-discover", windowSize: "390x844", budgetMs: 15000,
    stub: stub({ enabled: true, releases: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => REL(i, i % 2)) }, ON), driver: DRIVER });
  harness.assertNoPageError(assert, r);
  assert.ok(r.row, "THE one: no Discover row on Home");
  assert.deepEqual([r.row.shown, r.row.title, r.row.records, r.row.note, r.row.after, r.row.wide], [true, "Discover", 6, "", "picks", true]);
  assert.equal(r.opened, 1, "its title didn't open the Discover screen");
});

test("the review: each record says when it came out as the Discover screen does; a first ask that failed is asked again soon", () => {
  if (!harness.available) return;
  const d = new Date(Date.now() - 3 * 86400000);
  const iso = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const failFirst = stub({ enabled: true, releases: [Object.assign(REL(1, true), { release_date: iso })] }, ON)
    .replace('if (u.indexOf("/api/discover") > -1) return', 'if (u.indexOf("/api/discover") > -1 && ++window.__asks === 1) return window.__json({ error: "Not paired with Roon Core yet" }, 503); if (u.indexOf("/api/discover") > -1) return');
  const r = harness.renderPage({ name: "home-discover-when", windowSize: "390x844", budgetMs: 20000,
    stub: "window.__asks = 0; window.__rouenDiscoverSoonMs = 1200;" + failFirst, driver: `
    await window.__sleep(700);
    var sec = document.querySelector('#home-sections [data-row="discover"]');
    T("first", sec.querySelectorAll("#home-discover > *").length);
    await window.__sleep(1500);
    T("after", { n: sec.querySelectorAll("#home-discover > *").length, text: sec.querySelector("#home-discover").textContent, asks: window.__asks });
  ` });
  harness.assertNoPageError(assert, r);
  assert.equal(r.first, 0, "the stub's first ask didn't fail");
  assert.equal(r.after.n, 1, "THE one: a first ask that failed left the row empty till the next half hour");
  assert.match(r.after.text, /Artist 1 · 3 days ago/, "the record's year, not when it came out");
});

test("Discover's row: nothing new says so rather than hide; Discover switched off, or the row switched off, not shown", () => {
  if (!harness.available) return;
  const none = harness.renderPage({ name: "home-discover-none", windowSize: "390x844", budgetMs: 15000, stub: stub({ enabled: true, releases: [] }, ON), driver: DRIVER });
  harness.assertNoPageError(assert, none);
  assert.deepEqual([none.row.shown, none.row.records], [true, 0]);
  assert.match(none.row.note, /^Nothing new from the artists you play/);
  const off = harness.renderPage({ name: "home-discover-off", windowSize: "390x844", budgetMs: 15000,
    stub: stub({ enabled: false, releases: [REL(1, true)] }, ON), driver: DRIVER });
  assert.equal(off.row.shown, false, "shown with Discover switched off");
  const rowOff = harness.renderPage({ name: "home-discover-row-off", windowSize: "390x844", budgetMs: 15000,
    stub: stub({ enabled: true, releases: [REL(1, true)] }, ON.map((x) => (x.id === "discover" ? { id: x.id, on: false } : x))), driver: DRIVER });
  assert.equal(rowOff.row.shown, false, "shown with its row switched off in Settings → Home Screen");
});
