"use strict";
// ---------------------------------------------------------------------------
// v1.8.82: the share card's suggestions, end to end on the SHIPPING code —
// index.js's suggestActs, the taste graph build and the Deezer reads, sliced
// out and run against a canned Deezer, an in-memory cache and a plays table.
//
// Pinned (from Mandarin v0.7.6/v0.7.9, as Rouen does it):
//   - two of the three are acts you have not heard of, NEAR what you play;
//   - the third is an act you know (in the library, or played) — never one you
//     play heavily, and never an act near nothing you play while a near one is
//     left;
//   - each names a record and says why: "Near Steely Dan, which you play";
//   - what was shown is remembered, so a second share leans to the others;
//   - with no plays at all, Deezer's own order stands and nothing fails.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadIndexFunctions } = require("../lib/extract");
const similar = require("../../lib/similar");
const newRel = require("../../lib/newreleases");
const shareLinks = require("../../lib/share-links");

const DAY = 86400000;
const A = (id, name, fans) => ({ id, name, nb_fan: fans == null ? 50000 : fans });

// Deezer, by path.
const ARTISTS = {
  "Donald Fagen": A(1, "Donald Fagen"),
  "Steely Dan":   A(2, "Steely Dan"),
};
const RELATED = {
  1: [A(10, "Kids Choir"), A(2, "Steely Dan"), A(11, "Boz Scaggs"), A(12, "Michael McDonald"),
      A(13, "Toto"), A(14, "Walter Becker"), A(15, "Christopher Cross")],
  2: [A(11, "Boz Scaggs"), A(12, "Michael McDonald"), A(15, "Christopher Cross"), A(1, "Donald Fagen")],
};
function deezer(path) {
  let m;
  if ((m = /^search\/artist\?limit=\d+&q=(.+)$/.exec(path))) {
    const a = ARTISTS[decodeURIComponent(m[1])];
    return Promise.resolve({ data: a ? [a] : [] });
  }
  if ((m = /^artist\/(\d+)\/related/.exec(path))) return Promise.resolve({ data: RELATED[m[1]] || [] });
  if ((m = /^artist\/(\d+)\/top/.exec(path))) {
    return Promise.resolve({ data: [1, 2, 3].map(i => ({ album: { id: "a" + m[1], title: "Best of " + m[1], cover: null } })) });
  }
  if ((m = /^artist\/(\d+)\/albums/.exec(path))) {
    return Promise.resolve({ data: [{ id: "n" + m[1], title: "Newest " + m[1], record_type: "album", release_date: "2024-01-01" },
                                    { id: "a" + m[1], title: "Best of " + m[1], record_type: "album", release_date: "1990-01-01" }] });
  }
  return Promise.reject(new Error("unexpected Deezer path " + path));
}

function make(playRows, opts) {
  opts = opts || {};
  const cache = new Map();
  const albums = (opts.albums || [{ title: "Aja", subtitle: "Steely Dan" }])
    .map(a => Object.assign({ artistNames: [{ name: a.subtitle, n: a.subtitle.toLowerCase() }] }, a));
  const fns = loadIndexFunctions(
    ["relatedPool", "actRecords", "taste", "buildTaste", "libraryAlbumsBy", "ownedTitleKey", "suggestActs", "smartDayKey", "normalize"],
    {
      similar, newRel, shareLinks,
      DEBUG: false,
      DAY_MS: DAY,
      SIMILAR_POOL_TTL_MS: DAY, SIMILAR_REL_TTL_MS: 7 * DAY, SIMILAR_ACT_TTL_MS: 7 * DAY, SIMILAR_SHOWN_TTL_MS: 30 * DAY,
      TASTE_SEED_DAYS: 180, TASTE_SEEDS: 40,
      deezerJson: opts.deezer || deezer,
      smartCacheGet: (k) => (cache.has(k) ? JSON.parse(cache.get(k)) : null),
      smartCacheSet: (k, v) => cache.set(k, JSON.stringify(v)),
      labelsDb: { prepare: () => ({ all: () => playRows }) },
      albumIndex: { albums, builtAt: 1 },
      _albumsByArtistCache: { builtAt: -1, map: new Map() },
      tasteBuilt: null, tasteBuilding: null,
    });
  return { fns, cache };
}

const now = Date.now();
// Steely Dan on twelve different days: the seed whose neighbours are "near".
const PLAYS = Array.from({ length: 12 }, (_, i) => ({ artist: "Steely Dan", ts: now - i * DAY }));
// Toto once: an act you know by having played it.
PLAYS.push({ artist: "Toto", ts: now - 3 * DAY });

test("two near acts you haven't heard, one you know, each with a record and a reason (v1.8.82)", async () => {
  const { fns, cache } = make(PLAYS);
  await fns.buildTaste();
  const acts = await fns.suggestActs("Donald Fagen");
  assert.equal(acts.length, 3, JSON.stringify(acts));
  const names = acts.map(a => a.name);
  assert.ok(!names.includes("Kids Choir"), "an act near nothing you play took a slot a near one could fill");
  assert.ok(!names.includes("Donald Fagen"), "the playing act suggested itself");
  const unknown = acts.filter(a => !a.known);
  const familiar = acts.filter(a => a.known);
  assert.equal(unknown.length, 2, "two of three should be acts you have not heard of: " + names);
  assert.equal(familiar.length, 1, "one should be an act you know: " + names);
  for (const a of unknown) {
    assert.ok(["Boz Scaggs", "Michael McDonald", "Christopher Cross"].includes(a.name), a.name + " is not near what you play");
    assert.equal(a.reason, "Near Steely Dan, which you play");
    assert.equal(a.album, "Best of " + a.id, "an act you have not heard of is named by its best-known record");
  }
  assert.ok(["Steely Dan", "Toto"].includes(familiar[0].name));
  assert.match(familiar[0].reason, /a record you don't have/);
  if (familiar[0].name === "Steely Dan") assert.notEqual(familiar[0].album, "Aja", "suggested a record you own");
  // Remembered as shown.
  const shown = JSON.parse(cache.get("sim-shown:donald fagen"));
  assert.deepEqual(new Set(shown), new Set(acts.map(a => a.id)));
});

test("an act played on five or more days is never suggested — it needs no introduction (v1.8.82)", async () => {
  const rows = PLAYS.concat(Array.from({ length: 6 }, (_, i) => ({ artist: "Walter Becker", ts: now - i * DAY })));
  const { fns } = make(rows);
  await fns.buildTaste();
  for (let i = 0; i < 8; i++) {
    const acts = await fns.suggestActs("Donald Fagen");
    assert.ok(!acts.some(a => a.name === "Walter Becker"), "a heavily played act was suggested");
    assert.ok(!acts.some(a => a.name === "Steely Dan"), "a heavily played act was suggested");
  }
});

test("with no plays at all, suggestions still come, in Deezer's order of the acts (v1.8.82)", async () => {
  const { fns } = make([]);
  await fns.buildTaste();
  const acts = await fns.suggestActs("Donald Fagen");
  assert.equal(acts.length, 3);
  for (const a of acts) assert.equal(typeof a.reason, "string");
});

test("an act Deezer doesn't know gives no suggestions, and no error (v1.8.82)", async () => {
  const { fns } = make(PLAYS);
  await fns.buildTaste();
  assert.deepEqual(await fns.suggestActs("Nobody At All"), []);
});

// Found in review (v1.8.82), each pinned.
test("an act is known from the library by its exact name, never by a longer one (v1.8.82)", async () => {
  // Prince in the library must not make "Prince Buster" an act you know.
  const { fns } = make([], { albums: [{ title: "Purple Rain", subtitle: "Prince" }] });
  assert.equal(fns.libraryAlbumsBy("Prince").length, 1);
  assert.equal(fns.libraryAlbumsBy("prince").length, 1);
  assert.equal(fns.libraryAlbumsBy("Prince Buster").length, 0, "a longer name was taken for the act in the library");
  const { fns: f2 } = make([], { albums: [{ title: "Everything All the Time", subtitle: "Band of Horses" }] });
  assert.equal(f2.libraryAlbumsBy("The Band").length, 0);
  assert.equal(f2.libraryAlbumsBy("The Band of Horses").length, 1, "a leading The is discounted");
});

test("a failed Deezer answer is not kept as 'no related acts' (v1.8.82)", async () => {
  let calls = 0;
  const failing = (path) => { calls++; return Promise.resolve({ error: { type: "Exception", message: "Quota limit exceeded", code: 4 } }); };
  const { fns, cache } = make(PLAYS, { deezer: failing });
  assert.deepEqual(await fns.relatedPool("Steely Dan", "seed"), []);
  assert.ok(![...cache.keys()].some(k => k.startsWith("sim-seed:")), "a quota error was cached as an empty answer");
  const thrown = () => Promise.reject(new Error("timeout"));
  const t = make(PLAYS, { deezer: thrown });
  await t.fns.relatedPool("Steely Dan", "seed");
  assert.ok(![...t.cache.keys()].some(k => k.startsWith("sim-seed:")), "a timeout was cached as an empty answer");
  // A genuine "Deezer does not know them" IS kept.
  const n = make(PLAYS);
  await n.fns.relatedPool("Nobody At All", "pool");
  assert.ok(n.cache.has("sim-pool:nobody at all"));
});

test("an edition of a record you own is not offered as one you don't have (v1.8.82)", () => {
  const { fns } = make([]);
  assert.equal(fns.ownedTitleKey("Rumours (Super Deluxe)"), fns.ownedTitleKey("Rumours"));
  const rec = similar.recordFor({ known: "library" },
    { id: "t", title: "Rumours (Super Deluxe)" },
    [{ id: "t", title: "Rumours (Super Deluxe)", year: 2013 }],
    ["Rumours"], fns.ownedTitleKey);
  assert.equal(rec, null, "a deluxe Rumours was offered to someone who owns Rumours");
});

