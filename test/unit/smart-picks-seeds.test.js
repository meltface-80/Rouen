"use strict";
// ---------------------------------------------------------------------------
// Smart Picks' seeds (2.0.6-t22, dev/design/smart-picks.md §3; lib/smart-picks/seeds.js). A user's report
// (2026-11-26): "Smart Picks consistently concentrates on 1980s pop and 1960s/70s soul, despite these accounting for
// what I'd estimate is less than 10% of my listening … my longstanding listening includes substantial classical,
// jazz, fusion, ECM and ACT material." Each test was broken on purpose once and failed.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { scoreArtists, chooseSeeds, shareSlots, playWeight, whyOf } = require("../../lib/smart-picks/seeds");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 26);
const canon = (/** @type {string} */ s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** An album: its title, credit, genres and year. */
const al = (title, artist, genres, year) => ({ key: canon(title) + "||" + canon(artist), title,
  credits: artist.split(" & ").map((n) => ({ canon: canon(n), name: n })), genres, year });
/** `n` album plays of `a`, `ago` days back. */
const plays = (a, n, ago = 10) => Array.from({ length: n }, (_, i) => ({ key: a.key, ts: NOW - (ago + i) * DAY }));

test("a whole album played weighs 0.5 + 0.5 × 2^(−age/90 days): recent counts up to twice as much", () => {
  assert.equal(playWeight(0), 1);
  assert.equal(playWeight(90 * DAY), 0.75);
  assert.ok(Math.abs(playWeight(3650 * DAY) - 0.5) < 1e-6, "an old one still counts half");
});

test("THE user's case: mostly classical and jazz, a few pop compilations: the seeds are mostly classical and jazz", () => {
  const classical = ["Bach", "Pärt", "Reich", "Glass", "Satie", "Arvo", "Gorecki", "Hildegard", "Tallis", "Byrd"]
    .map((n, i) => al("Works " + i, n, ["Classical"], 1970 + i * 3));
  const jazz = ["Jarrett", "Garbarek", "Abercrombie", "Towner", "Stenson", "Wollny", "Esbjörn", "Brahem"]
    .map((n, i) => al("Session " + i, n, ["Jazz"], 1975 + i * 5));
  const pop = ["Michael Bolton", "Diana Ross", "The Association", "Barbra Streisand"].map((n) => al("Greatest Hits", n, ["Pop/Rock"], 1990));
  const albumPlays = [...classical.flatMap((a) => plays(a, 3)), ...jazz.flatMap((a) => plays(a, 3)), ...plays(pop[0], 1)];
  const scored = scoreArtists({ albums: [...classical, ...jazz, ...pop], albumPlays, trackPlays: [], hubs: new Set(), now: NOW });
  // Ten slots for nineteen artists listened to: the share decides. Classical 10 × √3, jazz 8 × √3, pop √1 of the listening.
  const { seeds, slots } = chooseSeeds(scored, 10);
  assert.deepEqual([...slots], [["Classical", 6], ["Jazz", 4], ["Pop/Rock", 0]], "THE one: the slots not shared as the listening is (54/43/3%)");
  assert.deepEqual(seeds.map((x) => x.genre).filter((g) => g === "Pop/Rock"), [], "a pop seed from one album play in thirty");
  assert.ok(!seeds.some((x) => ["Diana Ross", "The Association", "Barbra Streisand"].includes(x.name)), "an unplayed compilation's artist seeded");
});

test("nothing is divided by albums owned; an album's plays are square-rooted", () => {
  const big = Array.from({ length: 12 }, (_, i) => al("Box " + i, "Prolific", ["Jazz"], 1980));
  const small = al("Only", "Deliberate", ["Jazz"], 1980);
  const s = scoreArtists({ albums: [...big, small], albumPlays: [...big.slice(0, 4).flatMap((a) => plays(a, 1, 0)), ...plays(small, 4, 0)], trackPlays: [], hubs: new Set(), now: NOW });
  assert.ok(s.get("prolific").score > s.get("deliberate").score, "THE one: four albums played once lost to one played four times because of the twelve owned");
  assert.ok(Math.abs(s.get("deliberate").score - 2) < 0.01, "√(4 plays of weight ~1)");
});

test("a track played on its own counts a tenth, once a day an artist; a pick being tried counts nothing", () => {
  const a = al("Spirit", "Nubya Garcia", ["Jazz"], 2020);
  const pick = al("Tried", "Somebody New", ["Jazz"], 2021);
  const trackPlays = [
    { key: a.key, ts: NOW - DAY, artists: a.credits }, { key: a.key, ts: NOW - DAY + 1000, artists: a.credits },   // one day: once
    { key: a.key, ts: NOW - 2 * DAY, artists: a.credits },
    { key: pick.key, ts: NOW - DAY, artists: pick.credits },
    { key: null, ts: NOW, artists: [{ canon: "not in the library", name: "Stranger" }] },
  ];
  const s = scoreArtists({ albums: [a, pick], albumPlays: [], trackPlays, hubs: new Set(), now: NOW, pickKeys: new Set([pick.key]) });
  const two = 0.1 * Math.sqrt(playWeight(DAY) + playWeight(2 * DAY));
  assert.ok(Math.abs(s.get("nubya garcia").score - two) < 1e-9, "a burst of one day said more than once (two days: a tenth of √ of their weights)");
  assert.equal(s.get("nubya garcia").tracks, 2);
  assert.equal(s.get("somebody new").score, 0, "THE one: sampling a pick made it a preference");
  assert.equal(s.has("not in the library"), false, "only the library's artists seed");
});

test("a famous artist seeds at a quarter (the owner: \"Yes, I think\"), no longer never", () => {
  // Bach with fifty album plays (§9) beside an obscure composer with nine.
  const bach = al("Goldberg", "Bach", ["Classical"], 1981);
  const other = al("Tabula", "Obscure", ["Classical"], 1977);
  const s = scoreArtists({ albums: [bach, other], albumPlays: [...plays(bach, 50, 0), ...plays(other, 9, 0)], trackPlays: [], hubs: new Set(["bach"]), now: NOW });
  const r = s.get("bach");
  assert.ok(Math.abs(r.score - r.raw / 4) < 1e-9);
  assert.ok(r.hub);
  assert.ok(r.score < s.get("obscure").score, "√50 at a quarter is under √9");
  assert.deepEqual(chooseSeeds(s, 5).seeds.map((x) => x.name), ["Obscure", "Bach"], "THE one: the hub chart kept a classical listener's composers out");
});

test("a year of radio never outweighs albums listened to; a track from outside the library counts in its artist's own genres", () => {
  const albumOf = al("Köln", "Album Listener", ["Jazz"], 1975);
  const radio = al("Hits", "Radio Artist", ["Jazz"], 1990);
  const trackPlays = Array.from({ length: 365 }, (_, i) => ({ key: null, ts: NOW - i * DAY, artists: radio.credits }));
  const s = scoreArtists({ albums: [albumOf, radio], albumPlays: plays(albumOf, 25, 0), trackPlays, hubs: new Set(), now: NOW });
  assert.ok(s.get("radio artist").score < s.get("album listener").score, "THE one (the review): 365 radio days beat 25 albums played");
  assert.equal(s.get("radio artist").genres.get("Other"), undefined, "THE one (the review): radio filed under Other");
  assert.ok(s.get("radio artist").genres.get("Jazz") > 0);
});

test("an album crediting three artists counts once in the listening; one stray track doesn't take an artist to another genre", () => {
  // As much classical as pop: one symphony credited to three, ten plays (√10 ≈ 3.1); three pop albums once each (3 × 1).
  const sym = al("Ninth", "Karajan & Berliner & Beethoven", ["Classical"], 1963);
  const pops = ["P1", "P2", "P3"].map((n) => al("Single " + n, n, ["Pop/Rock"], 1990));
  const s = scoreArtists({ albums: [sym, ...pops], albumPlays: [...plays(sym, 10, 0), ...pops.flatMap((a) => plays(a, 1, 0))], trackPlays: [], hubs: new Set(), now: NOW });
  assert.deepEqual([...chooseSeeds(s, 4).slots], [["Classical", 2], ["Pop/Rock", 2]], "THE one (the review): even listening shared 3/1");
  const jazz = al("Blue", "Jazz Player", ["Jazz"], 1959);
  const comp = al("Now 12", "Jazz Player & Pop A & Pop B", ["Pop/Rock"], 1988);
  const many = ["Pop A", "Pop B", "Pop C"].map((n) => al("LP " + n, n, ["Pop/Rock"], 1985));
  const t = scoreArtists({ albums: [jazz, comp, ...many], hubs: new Set(), now: NOW,
    albumPlays: [...plays(jazz, 4, 0), ...many.flatMap((a) => plays(a, 6, 0))],
    trackPlays: [{ key: comp.key, ts: NOW, artists: [{ canon: "jazz player", name: "Jazz Player" }] }] });
  const seeds = chooseSeeds(t, 4).seeds;
  assert.equal(seeds.find((x) => x.name === "Jazz Player").genre, "Jazz", "taken by Pop/Rock through one compilation track");
});

test("the slots never pass the cap, however many genres are at 5%; ties break the same way every time", () => {
  const slots = shareSlots(new Map([["A", 50], ["B", 30], ["C", 20]]), new Map([["A", 9], ["B", 9], ["C", 9]]), 2);
  assert.equal([...slots.values()].reduce((x, y) => x + y, 0), 2, "THE one (the review): three slots for a cap of two");
  const tie = ["Alpha", "Beta", "Gamma"].map((n) => al("LP", n, ["Jazz"], 1970));
  const once = chooseSeeds(scoreArtists({ albums: tie, albumPlays: tie.flatMap((a) => plays(a, 2, 0)), trackPlays: [], hubs: new Set(), now: NOW }), 2);
  const twice = chooseSeeds(scoreArtists({ albums: tie, albumPlays: tie.flatMap((a) => plays(a, 2, 0)), trackPlays: [], hubs: new Set(), now: NOW }), 2);
  assert.deepEqual(once.seeds.map((x) => x.name), twice.seeds.map((x) => x.name));
  assert.deepEqual(once.seeds.map((x) => x.name), ["Alpha", "Beta"]);
});

test("a one-track release played whole is that album play, not a track play as well", () => {
  const single = al("Single", "One Tracker", ["Jazz"], 2020);
  const s = scoreArtists({ albums: [single], albumPlays: [{ key: single.key, ts: NOW }], hubs: new Set(), now: NOW,
    trackPlays: [{ key: single.key, ts: NOW - 60000, artists: single.credits }] });
  assert.equal(s.get("one tracker").tracks, 0, "THE one (the review): counted twice");
});

test("seed slots by genre share: 40/25/35 gives about 10/6/8; 5% one at least; 1% none", () => {
  const room = new Map([["C", 99], ["J", 99], ["P", 99]]);
  assert.deepEqual([...shareSlots(new Map([["C", 40], ["J", 25], ["P", 35]]), room, 24)], [["C", 10], ["P", 8], ["J", 6]]);
  // 5% or more: one at least, whatever the rounding; under it, only what its share rounds to (1% of 24: none).
  const small = shareSlots(new Map([["Big", 96], ["Six", 3], ["One", 1]]), new Map([["Big", 99], ["Six", 99], ["One", 99]]), 24);
  assert.equal(small.get("One"), 0, "1% of the listening took a seed");
  const six = shareSlots(new Map([["Big", 96], ["Five", 4]]), new Map([["Big", 99], ["Five", 99]]), 5);
  assert.equal(six.get("Five"), 0, "4% of 5 slots rounds to none");
  const five = shareSlots(new Map([["Big", 95], ["Five", 5]]), new Map([["Big", 99], ["Five", 99]]), 5);
  assert.equal(five.get("Five"), 1, "THE one: 5% of 5 slots is 0.25, and a genre at 5% has one at least");
  assert.equal([...small.values()].reduce((x, y) => x + y, 0), 24);
  assert.equal(shareSlots(new Map([["C", 1]]), new Map([["C", 3]]), 24).get("C"), 3, "never more than a genre has artists");
});

test("within a genre, round-robin across decades, highest first in each; an album in two genres counts half to each", () => {
  const albums = [al("A", "Sixties One", ["Jazz"], 1962), al("B", "Sixties Two", ["Jazz"], 1965), al("C", "Seventies", ["Jazz"], 1975),
    al("D", "Nineties", ["Jazz"], 1995)];
  const albumPlays = [...plays(albums[0], 9), ...plays(albums[1], 8), ...plays(albums[2], 2), ...plays(albums[3], 1)];
  const s = scoreArtists({ albums, albumPlays, trackPlays: [], hubs: new Set(), now: NOW });
  assert.deepEqual(chooseSeeds(s, 3).seeds.map((x) => x.name), ["Sixties One", "Seventies", "Nineties"],
    "THE one: the loudest decade took every slot");
  const both = al("Fusion", "Crossover", ["Jazz", "Pop/Rock"], 1977);
  const t = scoreArtists({ albums: [both], albumPlays: plays(both, 4, 0), trackPlays: [], hubs: new Set(), now: NOW }).get("crossover");
  assert.ok(Math.abs(t.genres.get("Jazz") - t.genres.get("Pop/Rock")) < 1e-9);
  assert.ok(Math.abs(t.genres.get("Jazz") + t.genres.get("Pop/Rock") - t.score) < 1e-9);
});

test("too little listening: topped up with the most-owned artists not widely played (§3.4); an empty library, none", () => {
  const albums = [al("X", "Heard", ["Jazz"], 2000), al("Y1", "Owned", ["Jazz"], 2000), al("Y2", "Owned", ["Jazz"], 2001),
    al("Z1", "Famous", ["Pop/Rock"], 2000), al("Z2", "Famous", ["Pop/Rock"], 2000), al("Z3", "Famous", ["Pop/Rock"], 2000)];
  const s = scoreArtists({ albums, albumPlays: plays(albums[0], 1), trackPlays: [], hubs: new Set(["famous"]), now: NOW });
  assert.deepEqual(chooseSeeds(s, 5).seeds.map((x) => [x.name, x.via]), [["Heard", "listening"], ["Owned", "owned"]]);
  assert.deepEqual(chooseSeeds(scoreArtists({ albums: [], albumPlays: [], trackPlays: [], hubs: new Set(), now: NOW }), 5).seeds, []);
});

test("Why these picks: the seeds with their scores and what they came from, the next in line, the numbers", () => {
  const a = al("Köln", "Keith Jarrett", ["Jazz"], 1975);
  const b = al("Belonging", "Jan Garbarek", ["Jazz"], 1974);
  const s = scoreArtists({ albums: [a, b], albumPlays: [...plays(a, 2, 5), ...plays(b, 1, 200)], trackPlays: [], hubs: new Set(), now: NOW });
  const w = whyOf("2026-11-26", chooseSeeds(s, 1), ["Keith Jarrett"], 5);
  assert.deepEqual(w.seeds.map((x) => [x.name, x.genre, x.decade, x.albumPlays, x.recentPlays, x.used]), [["Keith Jarrett", "Jazz", "1970s", 2, 2, false]]);
  assert.deepEqual(w.left.map((x) => x.name), ["Jan Garbarek"]);
  assert.deepEqual(w.slots, [["Jazz", 1]]);
  assert.deepEqual(w.numbers, { halfLifeDays: 90, track: 0.1, hub: 0.25, minShare: 0.05 });
  assert.doesNotThrow(() => JSON.stringify(w));
});
