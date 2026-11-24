"use strict";
// ---------------------------------------------------------------------------
// Roon's own dates where Rouen keeps its dates (2.0.6-t15, dev/design/recently-added.md §4–5; the owner, 2026-11-24:
// "We are using the Roon reverse code here so the date on the album screen should be coming from there … use the
// official API and the reverse code to bridge missing gaps").
//
//   - Roon's release date is the first of Rouen's sources (index.js yearSourceRank "roon"): it replaces any other's
//     year, a file's tags included; a day another source knows of the same year is kept where Roon gives only the
//     year; Roon restates its own; nothing ranked below it replaces it.
//   - storeRoonDates writes each album's in one pass, one bump when anything changed and none when nothing did.
//   - albumAddedOf: Roon's date added, with its library in force, before Rouen's own evidence.
//   - The album screen's year (/api/album/extras): Roon's where it gave one, no outside site asked.
// The shipping functions, extracted from index.js (test/lib/extract.js), never copies of them.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadIndexFunctions } = require("../lib/extract");
const { storeReleased } = require("../../lib/roon-direct/album-dates");
const { mountAlbumExtras } = require("../../lib/routes/album-extras");

function harness(opts) {
  opts = opts || {};
  const state = {
    albumYearCache: new Map(), albumYearSource: new Map(), albumDateCache: new Map(), albumDateSource: new Map(),
    albumSeenCache: new Map(Object.entries(opts.seen || {})), albumIndex: { albums: opts.albums || [] },
    bumps: 0, transactions: 0, errors: [],
  };
  const labelsDb = opts.db ? { transaction: (fn) => () => { state.transactions++; fn(); } } : null;
  const F = loadIndexFunctions(["setAlbumYear", "yearSourceRank", "releaseDateOf", "yearOfDate", "dateRefines",
    "albumYearKey", "storeRoonDates", "albumAddedOf"], {
    albumYearCache: state.albumYearCache, albumYearSource: state.albumYearSource, albumDateCache: state.albumDateCache,
    albumDateSource: state.albumDateSource, albumSeenCache: state.albumSeenCache, albumIndex: state.albumIndex,
    storeReleased, labelsDb, stmtInsertYear: null,
    bumpLibraryMeta: () => { state.bumps++; },
    console: { log() {}, error: (...a) => state.errors.push(a.join(" ")) },
  });
  return { F, state };
}

/** An album of the library in force, as library.js nativeView makes one: Roon's own album beside it. */
function album(title, artist, roon) {
  const a = { title, subtitle: artist, nTitle: title.toLowerCase(), nArtist: artist.toLowerCase(), srcKeys: ["k:" + title] };
  Object.defineProperty(a, "roon", { value: roon, enumerable: false });
  return a;
}
const key = (a) => a.nTitle + "||" + a.nArtist;

test("THE one: Roon's release date is the album's, over a file's tags and every other source", () => {
  const killers = album("Day & Age (Bonus Tracks)", "The Killers", { released: "2008-11-18" });
  const remaster = album("Houses of the Holy", "Led Zeppelin", { released: "1973-03-28" });
  const { F, state } = harness({ albums: [killers, remaster] });
  F.setAlbumYear(key(remaster), "2014-10-27", { src: "file" });     // the remaster's own tags
  F.setAlbumYear(key(killers), "2008", { src: "release" });         // MusicBrainz's year alone
  const before = state.bumps;
  F.storeRoonDates();
  assert.equal(state.albumYearCache.get(key(remaster)), "1973", "a file's year stood over Roon's");
  assert.equal(state.albumDateCache.get(key(remaster)), "1973-03-28");
  assert.equal(state.albumYearSource.get(key(remaster)), "roon");
  assert.equal(state.albumDateCache.get(key(killers)), "2008-11-18");
  assert.equal(state.bumps - before, 1, "one bump for the pass, not one per album");
  // Nothing ranked below Roon moves it afterwards: a later tag walk, a favourites read.
  assert.equal(F.setAlbumYear(key(remaster), "2014-10-27", { src: "file" }), false);
  assert.equal(F.setAlbumYear(key(remaster), "2014", { src: "edition" }), false);
  assert.equal(state.albumYearCache.get(key(remaster)), "1973");
});

test("Roon's year alone keeps another source's day of that year; a day of another year goes", () => {
  const same = album("Same Year", "A", { released: "2008" });
  const other = album("Other Year", "B", { released: "1999" });
  const { F, state } = harness({ albums: [same, other] });
  F.setAlbumYear(key(same), "2008-11-18", { src: "file" });
  F.setAlbumYear(key(other), "2001-05-02", { src: "file" });
  F.storeRoonDates();
  assert.equal(state.albumYearCache.get(key(same)), "2008");
  assert.equal(state.albumDateCache.get(key(same)), "2008-11-18", "the gap Roon left, bridged");
  assert.equal(state.albumYearCache.get(key(other)), "1999");
  assert.equal(state.albumDateCache.has(key(other)), false, "a day of a year that no longer stands");
});

test("Roon restates its own: a date it changed replaces the one it gave; nothing changed, nothing bumped", () => {
  const a = album("Changed", "C", { released: "1999" });
  const { F, state } = harness({ albums: [a], db: true });
  F.storeRoonDates();
  assert.equal(state.albumYearCache.get(key(a)), "1999");
  assert.equal(state.transactions, 1, "the pass is one transaction");
  const bumps = state.bumps;
  F.storeRoonDates();
  assert.equal(state.bumps, bumps, "a pass that changed nothing bumped the library's views");
  a.roon.released = "2001-06-04";
  F.storeRoonDates();
  assert.equal(state.albumYearCache.get(key(a)), "2001");
  assert.equal(state.albumDateCache.get(key(a)), "2001-06-04");
});

test("an album Roon gave no date for, and one of the official list's, keep Rouen's own", () => {
  const none = album("No Date", "D", { released: null });
  const official = { title: "Official", subtitle: "E", nTitle: "official", nArtist: "e", srcKeys: [] };
  const { F, state } = harness({ albums: [none, official] });
  F.setAlbumYear(key(none), "1984", { src: "release" });
  F.setAlbumYear(key(official), "1990", { src: "edition" });
  const before = state.bumps;
  F.storeRoonDates();
  assert.equal(state.albumYearSource.get(key(none)), "release");
  assert.equal(state.albumYearSource.get(key(official)), "edition");
  assert.equal(state.bumps, before, "nothing of Roon's: nothing bumped");
});

test("date added: Roon's, with its library in force; Rouen's own evidence otherwise", () => {
  const roonAdded = Date.UTC(2026, 10, 24, 15, 46, 12);
  const { F } = harness({ seen: { "k:With": { ts: 1000, src: "file" }, "k:Without": { ts: 2000, src: "file" } } });
  assert.equal(F.albumAddedOf(album("With", "F", { added: roonAdded })), roonAdded, "THE one: Rouen's date stood over Roon's");
  assert.equal(F.albumAddedOf(album("Without", "G", { added: null })), 2000);
  const plain = { title: "Without", srcKeys: ["k:Without"] };
  assert.equal(F.albumAddedOf(plain), 2000, "an album of the official list");
});

test("the album screen's year: Roon's where it gave one, and no outside site asked", async () => {
  const routes = {};
  let asked = 0;
  mountAlbumExtras({ get: (p, fn) => { routes[p] = fn; }, post: () => {} }, {
    normalize: (s) => String(s).toLowerCase(), lookUpAlbumDay: async () => false,
    fetchAlbumYear: async () => { asked++; return "2014"; },
    fetchAlbumBios: async () => ({ album: { year: "2014" }, artist: null, urls: {} }),
    notePageYear: () => {}, storedReleaseDate: (k) => (k === "houses of the holy||led zeppelin" ? "1973-03-28" : null),
    roonYearOf: (k) => (k === "houses of the holy||led zeppelin" ? "1973" : null),
    albumReleaseOf: () => null, labelDiskCache: new Map(), TYPE_NAMES: {}, ALBUM_PAGE_DAY_WAIT_MS: 10,
    loadPersistedSettings: () => ({}), enabledServices: () => [], enabledReviews: () => [],
    shareLinks: { serviceLinks: () => [], reviewLinks: () => [], localeFromAcceptLanguage: () => "en" },
    trace: { run: async (_m, fn) => fn({}), step: (_n, fn) => fn(), serverTiming: () => "" },
  });
  const call = (q) => new Promise((resolve) => {
    const res = { set() { return this; }, status() { return this; }, json(b) { resolve(b); return this; } };
    routes["/api/album/extras"]({ query: q, headers: {} }, res);
  });
  const roon = await call({ title: "Houses of the Holy", artist: "Led Zeppelin" });
  assert.equal(roon.year, "1973");
  assert.equal(roon.album.year, "1973", "the review's edition year shown over Roon's");
  assert.equal(roon.release_date, "1973-03-28");
  assert.equal(asked, 0, "MusicBrainz was asked for a year Roon gave");
  const gap = await call({ title: "Unknown", artist: "Nobody" });
  assert.equal(gap.year, "2014", "no date from Roon: the outside year bridges the gap");
  assert.equal(asked, 1);
});

// The wiring, which no extracted function shows: each library published with Roon's in force stores Roon's dates, and
// the album screen's route is told which years are Roon's.
test("index.js stores Roon's dates with each library it publishes, and tells the album screen which years are Roon's", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "..", "index.js"), "utf8");
  const publish = src.slice(src.indexOf("function publishLibrary(walked) {"), src.indexOf("\n}\n", src.indexOf("function publishLibrary(walked) {")));
  assert.match(publish, /libraryViewCounts = showLibrary\([^\n]*\);\n\s+if \(libraryViewCounts\) storeRoonDates\(\);/);
  assert.match(src, /mountAlbumExtras\(app, \{[^}]*roonYearOf: \(k\) => \(albumYearSource\.get\(k\) === "roon" && albumYearCache\.get\(k\)\) \|\| null,/);
  assert.match(src, /\(k, d\) => setAlbumYear\(k, d, \{ src: "roon", restate: true, deferBump: true \}\)/);
});
