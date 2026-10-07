"use strict";
/*
 * The share card's three suggestions (v1.8.82, ported with these tests from
 * Mandarin v0.7.6/v0.7.9): weighted by what you play, two of the three not
 * heard of, a record each, and a reason. Pure decisions over canned Deezer
 * answers (lib/similar.js). Mandarin's end-to-end route test needs its own
 * server; Rouen's route is covered by test/unit/similar-route.test.js.
 */
const test = require("node:test");
const assert = require("node:assert");
const similar = require("../../lib/similar");

const act = (id, name, fans) => ({ id: String(id), name, nb_fan: fans });

test("the taste graph: acts near what you play, weighted by days played and recency, 0..1", () => {
  const now = Date.parse("2026-10-06T12:00:00Z");
  const seeds = [
    { name: "Steely Dan", days: 10, last: now - 2 * 86400000 },       // played a lot, lately
    { name: "Kraftwerk", days: 1, last: now - 150 * 86400000 }       // once, months ago
  ];
  const rel = {
    "Steely Dan": [{ id: "1", name: "Donald Fagen" }, { id: "2", name: "Prefab Sprout" }],
    "Kraftwerk": [{ id: "3", name: "Neu!" }, { id: "2", name: "Prefab Sprout" }]
  };
  const g = similar.tasteGraph(seeds, n => rel[n], now);
  assert.equal(g.get("donald fagen").score, 1, "the top act of the most-played seed is the ceiling");
  assert.ok(g.get("prefab sprout").score > g.get("neu").score, "near two seeds beats near one old one");
  assert.deepEqual(g.get("prefab sprout").via, ["Steely Dan", "Kraftwerk"]);
  assert.ok(g.get("neu").score < 0.05, "a seed played once months ago barely counts: " + g.get("neu").score);
});

test("ranking: Deezer's order, lifted by the taste graph, held back by obscurity and by having been shown", () => {
  const pool = similar.readDeezerPool({ data: [act(1, "Kids Choir", 50000), act(2, "Prefab Sprout", 40000), act(3, "Tribute Dan", 200), act(4, "Donald Fagen", 90000)] });
  assert.equal(pool.length, 4);
  assert.deepEqual(pool.map(a => a.rank), [0, 1, 2, 3]);
  const taste = new Map([["prefab sprout", { score: 1, via: ["Steely Dan"] }], ["donald fagen", { score: 0.8, via: ["Steely Dan", "Boz Scaggs"] }]]);
  const ranked = similar.rankActs(pool, { playing: "Steely Dan", taste, known: () => null, heavy: new Set(), shown: new Set() });
  assert.deepEqual(ranked.map(a => a.name), ["Prefab Sprout", "Donald Fagen", "Kids Choir", "Tribute Dan"], "near your listening first; Deezer's own first row, near nothing you play, falls behind it");
  assert.ok(ranked[3].score < ranked[2].score / 1.5, "two hundred followers: halved");
  const again = similar.rankActs(pool, { playing: "Steely Dan", taste, known: () => null, heavy: new Set(), shown: new Set(["2"]) });
  assert.equal(again[0].name, "Donald Fagen", "shown lately: Prefab Sprout gives way");
  const heavy = similar.rankActs(pool, { playing: "Steely Dan", taste, known: () => null, heavy: new Set(["donald fagen"]), shown: new Set() });
  assert.ok(!heavy.some(a => a.name === "Donald Fagen"), "an act you play heavily is never suggested");
  const self = similar.rankActs([{ id: "9", name: "Steely Dan", rank: 0 }], { playing: "Steely Dan" });
  assert.equal(self.length, 0, "never the playing act itself");
});

test("the draw: two acts not heard of and one you know, filled from the rest when a slot can't be met", () => {
  const ranked = [
    { id: "1", name: "A", score: 1, known: null }, { id: "2", name: "B", score: 0.9, known: "library" },
    { id: "3", name: "C", score: 0.8, known: null }, { id: "4", name: "D", score: 0.7, known: "played" },
    { id: "5", name: "E", score: 0.6, known: null }
  ];
  const rnd = () => 0;   // the first of the weighted candidates each time
  const picks = similar.choose(ranked, { rnd });
  assert.deepEqual(picks.map(p => p.name), ["A", "C", "B"], "two unknown, then the best-known act");
  const onlyNew = similar.choose(ranked.filter(a => !a.known), { rnd });
  assert.deepEqual(onlyNew.map(p => p.name), ["A", "C", "E"], "nobody known: three new");
  const onlyKnown = similar.choose(ranked.filter(a => a.known), { rnd });
  assert.deepEqual(onlyKnown.map(p => p.name), ["B", "D"], "no unknown acts at all: what there is");
  // A real draw is weighted, not fixed: over many draws the top act leads but is not alone.
  const first = new Set();
  for (let i = 0; i < 200; i++) first.add(similar.choose(ranked)[0].name);
  assert.ok(first.size > 1 && first.has("A"), "the draw varies: " + [...first].join(","));
});

test("the record for an act: best-known from the top tracks; for an act you know, the newest you don't own", () => {
  const top = similar.readDeezerTop({ data: [
    { album: { id: 10, title: "Steve McQueen", cover_medium: "c10" } }, { album: { id: 11, title: "Swoon" } },
    { album: { id: 10, title: "Steve McQueen" } }, { album: { id: 12, title: "Jordan: The Comeback" } }
  ] });
  assert.deepEqual(top, { id: "10", title: "Steve McQueen", cover: "c10", n: 2 });
  const albums = similar.readDeezerAlbumList({ data: [
    { id: 11, title: "Swoon", record_type: "album", release_date: "1984-03-01" },
    { id: 10, title: "Steve McQueen", record_type: "album", release_date: "1985-06-01" },
    { id: 13, title: "Crimson/Red", record_type: "album", release_date: "2013-10-07", cover_medium: "c13" },
    { id: 14, title: "A Single", record_type: "single", release_date: "2014-01-01" },
    { id: 15, title: "Undated", record_type: "album", release_date: "0000-00-00" }
  ] });
  assert.deepEqual(albums.map(a => a.title), ["Crimson/Red", "Steve McQueen", "Swoon", "Undated"], "full albums only, newest first");
  const unknown = similar.recordFor({ known: null }, top, albums, []);
  assert.deepEqual(unknown, { title: "Steve McQueen", year: 1985, cover: "c10" }, "not heard of: their best-known, with its year from the listing");
  const known = similar.recordFor({ known: "library" }, top, albums, ["Steve McQueen", "Swoon"]);
  assert.deepEqual(known, { title: "Crimson/Red", year: 2013, cover: "c13" }, "known: the newest full album you don't own");
  assert.equal(similar.recordFor({ known: "library" }, top, albums.slice(1), ["Steve McQueen", "Swoon"]), null, "own them all: nothing to name");
  assert.deepEqual(similar.recordFor({ known: null }, null, albums, []).title, "Crimson/Red", "no top tracks: the newest full album");
});

test("the reason under each act", () => {
  assert.equal(similar.reasonFor({ known: null, via: ["Steely Dan", "Boz Scaggs"] }, "Donald Fagen"), "Near Steely Dan and Boz Scaggs, which you play");
  assert.equal(similar.reasonFor({ known: null, via: ["Donald Fagen", "Boz Scaggs"] }, "Donald Fagen"), "Near Boz Scaggs, which you play");
  assert.equal(similar.reasonFor({ known: null, via: [] }, "Donald Fagen"), "Near Donald Fagen");
  assert.equal(similar.reasonFor({ known: "library", via: [] }, "X"), "In your library — a record you don't have");
  assert.equal(similar.reasonFor({ known: "played", via: [] }, "X"), "Something you've played — a record you don't have");
});
