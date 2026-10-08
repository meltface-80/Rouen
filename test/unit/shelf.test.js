"use strict";
// ---------------------------------------------------------------------------
// v1.9.1: what the Shelf screen is given (lib/shelf.js), and the one rule it
// rests on — the letter an artist is filed under on the Artists grid comes
// from the SAME name the shelf is ordered by. If the two ever differed, a
// letter would select albums scattered through the shelf, and the brass
// divider tabs on the Spines look would stand in the wrong places.
//
// Checked against index.js's own creditIdentities / canonArtist and
// libraryView's "artist" order, extracted from the shipping source, never a
// copy of them.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { shelfBucket, buildShelf, shelfSignature } = require("../../lib/shelf");
const { loadIndexFunctions, REPO_ROOT } = require("../lib/extract");

test("shelfBucket — A–Z, 1–9, and # for everything else", () => {
  assert.equal(shelfBucket("beatles"), "B");
  assert.equal(shelfBucket("zz top"), "Z");
  assert.equal(shelfBucket("2pac"), "2");
  assert.equal(shelfBucket("10cc"), "1");
  assert.equal(shelfBucket("9th wonder"), "9");
  assert.equal(shelfBucket("0 5"), "#", "a 0 is filed under #, as the grid says");
  assert.equal(shelfBucket(""), "#", "a name with nothing alphanumeric in it");
  assert.equal(shelfBucket(undefined), "#");
});

test("buildShelf — the list the page reads", async (t) => {
  const albums = [
    { offset: 4, title: "Kind of Blue", subtitle: "Miles Davis", image_key: "k4", g: ["Jazz"], f: "miles davis" },
    { offset: 9, title: "Mezzanine", subtitle: "Massive Attack", image_key: null, g: ["Electronic", "Pop/Rock", "Electronic"], f: "massive attack" },
    { offset: 1, title: "Abbey Road", subtitle: "The Beatles", image_key: "k1", g: ["Pop/Rock"], f: "beatles" },
    { offset: 2, title: "Untagged", subtitle: "Nobody", image_key: "k2", g: [], f: "nobody" },
  ];
  const r = buildShelf(albums, { genresOf: (al) => al.g, firstOf: (al) => al.f });

  await t.test("genres commonest first, then by name, each counted once per album", () => {
    assert.deepEqual(r.genres, [
      { name: "Pop/Rock", count: 2 },
      { name: "Electronic", count: 1 },
      { name: "Jazz", count: 1 },
    ]);
  });
  await t.test("albums keep the order given, with indices into the genre list", () => {
    assert.deepEqual(r.albums.map((a) => a.o), [4, 9, 1, 2]);
    assert.deepEqual(r.albums[1], { o: 9, t: "Mezzanine", a: "Massive Attack", k: null, g: [0, 1], b: "M" });
    assert.deepEqual(r.albums[0].g, [2]);
    assert.deepEqual(r.albums[3].g, [], "an album in no genre is still on the shelf");
    assert.equal(r.albums[2].b, "B");
  });
});

// The real name rules, from index.js.
const F = loadIndexFunctions(
  ["normalize", "canonText", "canonArtist", "splitCreditIntoArtists", "creditIdentities"],
  { knownArtistSet: () => new Set() });

test("the letter is read the way the shop files it — from index.js's own credit names", () => {
  const letter = (credit) => shelfBucket(F.creditIdentities(credit).first);
  assert.equal(letter("The Beatles"), "B", "a leading The is not where it is filed");
  assert.equal(letter("Ólafur Arnalds"), "O", "an accent is folded");
  assert.equal(letter("!!!"), "#");
  assert.equal(letter("2Pac"), "2");
  assert.equal(letter("Miles Davis / John Coltrane"), "M", "the first credited act");
});

test("each letter is one unbroken run of the shelf, in libraryView's own artist order", () => {
  const credits = ["The Beatles", "Abba", "!!!", "2Pac", "Bob Dylan", "10cc", "ZZ Top", "Ólafur Arnalds",
    "The Who", "Air", "Beach House", "Miles Davis / John Coltrane", "Madonna", "...And You Will Know Us by the Trail of Dead",
    "Zero 7", "Björk", "Ennio Morricone", "The The"];
  const albums = credits.map((c, i) => {
    const id = F.creditIdentities(c);
    return { offset: i, title: "Album " + i, subtitle: c, nTitle: "album " + i, nArtist: F.normalize(c),
             sortTitle: "album " + i, cArtist: id.c, cFirst: id.first, cCredits: id.names, srcKeys: [] };
  });
  const L = loadIndexFunctions(
    ["libraryView", "artistSortName", "libraryPrefix", "libraryPrefixMax", "albumMatchesPrefix", "normalize", "albumPlayKey",
     "albumYearOf", "albumYearKey", "albumDateOf", "albumAddedOf", "seededRank", "libFacetDefs", "facetMatch",
     "albumGenresOf", "albumFileFactsOf", "albumFileFacts", "rateLabel", "channelLabel", "libAddedWindows"],
    {
      labelsEnabled: false, albumYearCache: new Map(), albumDateCache: new Map(), albumSeenCache: new Map(),
      albumGenreCache: new Map(), albumFileCache: new Map(),
      albumIndex: { albums, builtAt: 1, count: albums.length },
      libraryMetaVersion: 0, libraryDateVersion: 0, playsVersion: 0,
      libraryViewCache: new Map(), LIBRARY_VIEW_CACHE_MAX: 8,
      LIB_SORTS: new Set(["album", "artist", "year", "added", "plays", "lastplayed", "random"]),
      albumSource: () => null, resolveAlbumLabelName: () => null,
      getPlayedTitlesSince: () => new Set(), playedTitleSet: () => new Set(),
      playStats: () => ({ count: new Map(), last: new Map() }),
    });
  // The route's own lookups (see /api/shelf/albums).
  const shelf = buildShelf(L.libraryView({ sort: "artist" }), { genresOf: () => [], firstOf: L.artistSortName });
  const runs = [];
  for (const a of shelf.albums) if (!runs.length || runs[runs.length - 1] !== a.b) runs.push(a.b);
  assert.equal(new Set(runs).size, runs.length, "a letter's albums are split across the shelf: " + runs.join(" "));
  assert.equal(runs[0], "#", "the symbols come first, as Roon files them");
});

test("the route files every album by artistSortName, the name the artist order sorts by", () => {
  // The order and the letter share ONE function, so they cannot drift; this
  // pins that the route still uses it and still takes the artist order.
  const src = fs.readFileSync(path.join(REPO_ROOT, "index.js"), "utf8");
  const route = src.slice(src.indexOf('app.get("/api/shelf/albums"'), src.indexOf("// Home section: random albums NOT played"));
  assert.ok(route.length > 100, "the /api/shelf/albums route was not found");
  assert.match(route, /libraryView\(\{ sort: "artist" \}\)/, "the shelf is no longer in libraryView's artist order");
  assert.match(route, /firstOf: artistSortName/, "the letter is no longer read from artistSortName");
  const view = src.slice(src.indexOf("function libraryView("), src.indexOf("function libraryView(") + 6000);
  assert.match(view, /artist: \(a, b\) => artistSortName\(a\)\.localeCompare\(artistSortName\(b\)\)/, "the artist order no longer sorts by artistSortName");
});

test("shelfSignature — the same shelf, the same signature; any change, another", () => {
  const one = buildShelf([{ offset: 1, title: "Blue", subtitle: "Joni Mitchell", image_key: "k", g: ["Folk"], f: "joni mitchell" }],
    { genresOf: (al) => al.g, firstOf: (al) => al.f });
  const same = JSON.parse(JSON.stringify(one));
  const other = JSON.parse(JSON.stringify(one)); other.albums[0].g = [];
  assert.equal(shelfSignature(one), shelfSignature(same));
  assert.notEqual(shelfSignature(one), shelfSignature(other));
  assert.match(shelfSignature(one), /^[0-9a-f]{16}$/);
});
