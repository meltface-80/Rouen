"use strict";
// ---------------------------------------------------------------------------
// Smart Picks' Tune (2.0.7-t1, dev/design/smart-picks.md §5; lib/smart-picks/tune.js, its reach into seeds.js and
// rank.js). The owner (2026-11-26): "multiple sliders to set based on artists, years, tastes etc", and "Go with what
// you suggest": a Listening window, Adventure, Genres and Decades each Never / Less / As I listen / More, and More from
// or Never start from an artist. Each test was broken on purpose once and failed.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { scoreArtists, chooseSeeds, playWeight, whyOf } = require("../../lib/smart-picks/seeds");
const { rankSmartCandidates } = require("../../lib/smart-picks/rank");
const T = require("../../lib/smart-picks/tune");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 26);
const canon = (/** @type {string} */ s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const al = (title, artist, genres, year) => ({ key: canon(title) + "||" + canon(artist), title,
  credits: [{ canon: canon(artist), name: artist }], genres, year });
const plays = (a, n, ago = 10) => Array.from({ length: n }, (_, i) => ({ key: a.key, ts: NOW - (ago + i) * DAY }));

// A library: jazz 1970s (4 artists), jazz 1990s (2), classical 1980s (3), pop 1980s (2), every album played.
function library() {
  const albums = [
    ...["Jarrett", "Garbarek", "Abercrombie", "Towner"].map((n, i) => al("J7 " + i, n, ["Jazz"], 1972 + i)),
    ...["Wollny", "Brahem"].map((n, i) => al("J9 " + i, n, ["Jazz"], 1994 + i)),
    ...["Part", "Reich", "Glass"].map((n, i) => al("C8 " + i, n, ["Classical"], 1981 + i)),
    ...["Bolton", "Dayne"].map((n, i) => al("P8 " + i, n, ["Pop/Rock"], 1985 + i)),
  ];
  const albumPlays = albums.flatMap((a, i) => plays(a, 2 + (i % 3)));
  return { albums, albumPlays };
}
const scoredOf = (halfLifeDays) => { const l = library(); return scoreArtists({ ...l, trackPlays: [], hubs: new Set(), now: NOW, halfLifeDays }); };
const seedsWith = (tune, cap = 6) => chooseSeeds(scoredOf(T.halfLifeOf(tune)), cap, T.seedTune(tune)).seeds;
const tune = (over) => Object.assign(T.defaultTune(), over);

test("untuned (Reset) is exactly how the seeds were before Tune", () => {
  const l = library();
  const before = chooseSeeds(scoreArtists({ ...l, trackPlays: [], hubs: new Set(), now: NOW }), 6);
  assert.deepEqual(seedsWith(T.defaultTune()).map((s) => s.name), before.seeds.map((s) => s.name));
  assert.deepEqual(T.parseTune({}, canon), T.defaultTune(), "{} (Reset) is \"As I listen\"");
  assert.equal(T.defaultTune().adventure, 4, "THE one (the owner: \"Default Far\"): untouched, the ranking changed");
});

test("Listening window: its half-life is the album plays' (14 … 365 days); All time weighs every play 1", () => {
  assert.deepEqual(T.WINDOW_DAYS, [14, 45, 90, 365, Infinity]);
  assert.equal(playWeight(14 * DAY, 14), 0.75);
  assert.equal(playWeight(3650 * DAY, Infinity), 1, "THE one: All time still weighed old plays less");
  const recent = al("New", "Fresh", ["Jazz"], 2025);
  const old = al("Old", "Veteran", ["Jazz"], 1975);
  const ps = [...plays(recent, 3, 1), ...plays(old, 4, 400)];
  const s = (h) => scoreArtists({ albums: [recent, old], albumPlays: ps, trackPlays: [], hubs: new Set(), now: NOW, halfLifeDays: h });
  assert.ok(s(14).get("fresh").score > s(14).get("veteran").score, "Recent: three plays this week outweigh four a year ago");
  assert.ok(s(Infinity).get("fresh").score < s(Infinity).get("veteran").score, "All time: four plays outweigh three, whenever");
});

test("Genres: Never takes a genre's artists out altogether; More doubles its share, Less halves it", () => {
  const never = seedsWith(tune({ genres: { "Pop/Rock": "never" } }), 11);
  assert.ok(!never.some((s) => ["Bolton", "Dayne"].includes(s.name)), "THE one: a genre set to Never still seeded (even topped up)");
  const classical = (t) => seedsWith(t, 6).filter((s) => s.genre === "Classical").length;
  assert.equal(classical(T.defaultTune()), 2);
  assert.equal(classical(tune({ genres: { Classical: "more" } })), 3, "More gave Classical no more seeds");
  assert.equal(classical(tune({ genres: { Classical: "less" } })), 1, "Less gave Classical no fewer seeds");
});

test("Never reaches artists you own but haven't played (the top-up, §3.4), by their own albums' genre and decade", () => {
  const played = al("Köln", "Jarrett", ["Jazz"], 1975);
  const owned = [al("Hits", "Bolton", ["Pop/Rock"], 1987), al("Tell It", "Dayne", ["Pop/Rock"], 1988), al("Kind", "Davis", ["Jazz"], 1959),
    al("Blue", "Mitchell", ["Folk"], 1971)];
  const s = scoreArtists({ albums: [played, ...owned], albumPlays: plays(played, 2), trackPlays: [], hubs: new Set(), now: NOW });
  const seeds = (t) => chooseSeeds(s, 5, T.seedTune(tune(t))).seeds.map((x) => x.name + ":" + x.via).sort();
  assert.deepEqual(seeds({ genres: { "Pop/Rock": "never" }, decades: { "1950s": "never" } }), ["Jarrett:listening", "Mitchell:owned"],
    "THE one (the review): an owned artist of a genre or decade set to Never topped the seeds up");
  assert.equal(seeds({}).length, 5);
});

test("Decades: Never none; More dealt twice as often as As I listen; Less every other round", () => {
  const without = seedsWith(tune({ decades: { "1990s": "never" } }), 11);
  assert.ok(!without.some((s) => ["Wollny", "Brahem"].includes(s.name)), "THE one: a decade set to Never still seeded");
  // Jazz alone, four slots: untuned the decades alternate (1970s, 1990s, 1970s, 1990s); 1990s More: two a round.
  const jazzOnly = { genres: { Classical: "never", "Pop/Rock": "never" } };
  const nineties = (t) => seedsWith(tune(Object.assign({}, jazzOnly, t)), 3).filter((s) => s.decade === "1990s").length;
  assert.equal(nineties({}), 1);
  assert.equal(nineties({ decades: { "1990s": "more" } }), 2, "More wasn't dealt twice a round");
  assert.equal(nineties({ decades: { "1970s": "more", "1990s": "less" } }), 0, "Less was dealt on the first round");
});

test("Artists: More from X always a seed, whatever else is set; Never start from X never one", () => {
  const more = seedsWith(tune({ genres: { "Pop/Rock": "never" }, more: [{ canon: "dayne", name: "Dayne" }] }), 4);
  assert.ok(more.some((s) => s.name === "Dayne" && s.via === "more"), "THE one: More from an artist didn't make it a seed");
  assert.equal(more.length, 4, "More's seed counts against the cap");
  const never = seedsWith(tune({ never: [{ canon: "jarrett", name: "Jarrett" }] }), 11);
  assert.ok(!never.some((s) => s.name === "Jarrett"), "Never start from an artist still seeded it");
  const gone = seedsWith(tune({ more: [{ canon: "nobody", name: "Nobody" }] }), 4);
  assert.ok(!gone.some((s) => s.name === "Nobody"), "an artist no longer in the library seeded");
});

test("Adventure: Far is the order before Tune (fewest seeds first); Close the most connected; between, a blend", () => {
  const c = (canonName, seeds, score) => ({ mbid: canonName, name: canonName, canon: canonName, comment: "", score, seeds, seedNames: seeds });
  const cands = [c("a", ["s1"], 10), c("b", ["s1", "s2", "s3"], 50), c("d", ["s1", "s2"], 30), c("e", ["s2"], 40)];
  const order = (adv) => rankSmartCandidates(cands, adv).map((x) => x.canon).join("");
  assert.equal(order(undefined), "eadb", "untouched callers keep today's order");
  assert.equal(order(4), "eadb");
  assert.equal(order(0), "bdea", "THE one: Close wasn't by connection and similarity");
  const mid = order(2);
  assert.ok(mid !== order(0) && mid !== order(4), "the middle wasn't a blend: " + mid);
  assert.equal(new Set(mid).size, 4);
});

test("a saved Tune is checked whole: a bad field refuses it all; an artist can't be both More and Never", () => {
  assert.throws(() => T.parseTune({ window: 5 }, canon), /window must be 0-4/);
  assert.throws(() => T.parseTune({ adventure: "far" }, canon), /adventure/);
  assert.throws(() => T.parseTune({ genres: { Jazz: "lots" } }, canon), /never, less, as or more/);
  assert.throws(() => T.parseTune({ decades: { "1975": "more" } }, canon), /not a decade/);
  assert.throws(() => T.parseTune({ more: ["Jarrett"], never: ["jarrett"] }, canon), /both/);
  assert.throws(() => T.parseTune({ more: [{}] }, canon), /not an artist/, "THE one (the review): {} taken as an artist called \"undefined\"");
  assert.deepEqual(T.parseTune({ decades: { "990s": "less", "0s": "never" } }, canon).decades, { "990s": "less", "0s": "never" },
    "a decade seeds.js names (a year under 1000) refused, and with it every Save");
  const t = T.parseTune({ window: 0, genres: { Jazz: "more", Classical: "as" }, decades: { unknown: "never" }, more: ["Jarrett", "Jarrett"] }, canon);
  assert.deepEqual(t, { window: 0, adventure: 4, genres: { Jazz: "more" }, decades: { unknown: "never" },
    more: [{ canon: "jarrett", name: "Jarrett" }], never: [] }, "\"As I listen\" isn't stored; one artist once");
  assert.deepEqual(T.loadTune({ window: 9 }, canon), T.defaultTune(), "a bad saved Tune reads as untuned rather than stopping the build");
});

test("one artist moved: More, Never or neither, never both", () => {
  let t = T.withArtist(T.defaultTune(), "Jarrett", "more", canon);
  t = T.withArtist(t, "jarrett", "never", canon);
  assert.deepEqual(t.more, []);
  assert.deepEqual(t.never, [{ canon: "jarrett", name: "jarrett" }], "THE one: Never left the artist in More too");
  assert.deepEqual(T.withArtist(t, "Jarrett", "none", canon).never, []);
  assert.throws(() => T.withArtist(t, "Jarrett", "always", canon), /more, never or none/);
  assert.throws(() => T.withArtist(t, "  ", "more", canon), /not an artist/);
});

test("Why these picks says the Tune, each pick's starting artists, and All time as null", () => {
  const chosen = chooseSeeds(scoredOf(), 3);
  const w = whyOf("2026-11-26", chosen, [], NOW, { halfLifeDays: Infinity, tuned: T.describeTune(tune({ window: 4, genres: { Jazz: "more" } })),
    picks: [{ artist: "Labradford", seedNames: ["Jarrett", "Part"] }] });
  assert.equal(w.numbers.halfLifeDays, null);
  assert.deepEqual(w.tuned, ["Listening window: All time", "Jazz: More"]);
  assert.deepEqual(w.picks, [{ artist: "Labradford", seeds: ["Jarrett", "Part"] }]);
  assert.equal(JSON.parse(JSON.stringify(w)).numbers.halfLifeDays, null);
  assert.deepEqual(T.describeTune(T.defaultTune()), [], "untuned says nothing");
});
