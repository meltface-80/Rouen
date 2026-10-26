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
const { createReleaseFacts, compareCatalogue, TYPE_NAMES } = require("../../lib/release-facts");
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
  const years = new Map([[4, 1959], [9, 1998]]);
  const r = buildShelf(albums, { genresOf: (al) => al.g, firstOf: (al) => al.f, yearOf: (al) => years.get(al.offset) || null });

  await t.test("genres commonest first, then by name, each counted once per album", () => {
    assert.deepEqual(r.genres, [
      { name: "Pop/Rock", count: 2 },
      { name: "Electronic", count: 1 },
      { name: "Jazz", count: 1 },
    ]);
  });
  await t.test("albums keep the order given, with indices into the genre list", () => {
    assert.deepEqual(r.albums.map((a) => a.o), [4, 9, 1, 2]);
    assert.deepEqual(r.albums[1], { o: 9, t: "Mezzanine", a: "Massive Attack", k: null, g: [0, 1], b: "M", y: 1998, l: null, c: null, ty: null });
    assert.deepEqual(r.albums[0].g, [2]);
    assert.deepEqual(r.albums[3].g, [], "an album in no genre is still on the shelf");
    assert.equal(r.albums[2].b, "B");
  });
  await t.test("each album carries its label (an index into a list commonest first), catalogue number and kind, or null (v1.9.67)", () => {
    const labels = new Map([[4, "Columbia"], [9, "Virgin"], [1, "Apple"], [2, "Virgin"]]);
    const cats = new Map([[4, "CL 1355"], [9, "WBRLP4"]]);
    const types = new Map([[4, "album"], [2, "ep"]]);
    const w = buildShelf(albums, { genresOf: (al) => al.g, firstOf: (al) => al.f, labelOf: (al) => labels.get(al.offset) || null,
      catOf: (al) => cats.get(al.offset) || null, typeOf: (al) => types.get(al.offset) || null });
    assert.deepEqual(w.labels, [{ name: "Virgin", count: 2 }, { name: "Apple", count: 1 }, { name: "Columbia", count: 1 }]);
    assert.deepEqual(w.albums.map((a) => [a.l, a.c, a.ty]), [[2, "CL 1355", "album"], [0, "WBRLP4", null], [1, null, null], [0, null, "ep"]]);
    assert.deepEqual(r.labels, [], "no label lookup: no labels");
  });
  await t.test("each album carries its year, or null when none is known (the Years tab, v1.9.10)", () => {
    assert.deepEqual(r.albums.map((a) => a.y), [1959, 1998, null, null]);
    const none = buildShelf(albums, { genresOf: (al) => al.g, firstOf: (al) => al.f });
    assert.deepEqual(none.albums.map((a) => a.y), [null, null, null, null], "no year lookup: every album undated");
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
     "albumYearOf", "albumYearKey", "albumDateOf", "albumAddedOf", "seededRank", "libFacetDefs", "facetMatch", "albumReleaseOf",
     "albumGenresOf", "albumFileFactsOf", "albumFileFacts", "rateLabel", "channelLabel", "libAddedWindows"],
    {
      releaseFacts: createReleaseFacts(), compareCatalogue, TYPE_NAMES, albumKeys: () => [],
      labelsEnabled: false, albumYearCache: new Map(), albumDateCache: new Map(), albumSeenCache: new Map(),
      albumGenreCache: new Map(), albumFileCache: new Map(),
      albumIndex: { albums, builtAt: 1, count: albums.length },
      libraryMetaVersion: 0, libraryDateVersion: 0, playsVersion: 0,
      libraryViewCache: new Map(), LIBRARY_VIEW_CACHE_MAX: 8,
      LIB_SORTS: new Set(["album", "artist", "label", "year", "added", "plays", "lastplayed", "random"]),
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
  // pins that the route still uses it and still takes the artist order. The
  // route lives in lib/shelf-routes.js since v1.9.10; index.js hands it the
  // lookups.
  const routes = fs.readFileSync(path.join(REPO_ROOT, "lib", "shelf-routes.js"), "utf8");
  assert.match(routes, /deps\.libraryView\(\{ sort: "artist" \}\)/, "the shelf is no longer in libraryView's artist order");
  assert.match(routes, /firstOf: deps\.firstOf/, "the route no longer takes the letter from what index.js hands it");
  const src = fs.readFileSync(path.join(REPO_ROOT, "index.js"), "utf8");
  const mount = src.slice(src.indexOf("mountShelf(app, {"), src.indexOf("mountShelf(app, {") + 800);
  assert.ok(mount.length > 100, "index.js no longer mounts the Shelf routes");
  assert.match(mount, /firstOf: artistSortName/, "the letter is no longer read from artistSortName");
  assert.match(mount, /libraryView,/, "the route is no longer handed libraryView");
  assert.match(mount, /yearOf: albumYearOf/, "the year is no longer read from albumYearOf, the Decade focus's own");
  // Without the years in the key a Shelf would keep the years it first saw
  // until the next rescan; with libraryMetaVersion instead, every badge or
  // label would rebuild it.
  assert.match(mount, /stateKey: \(\) => [^\n]*shelfYearsStamp\(\)/, "the kept answer no longer moves when a year arrives");
  assert.doesNotMatch(mount, /stateKey: \(\) => [^\n]*libraryMetaVersion/, "the kept answer is rebuilt for things the shelf does not show");
  // The labels, catalogue numbers and kinds it shows since v1.9.67 have a stamp of their own (shelfLabelsStamp).
  assert.match(mount, /stateKey: \(\) => [^\n]*shelfLabelsStamp\(\)/, "the kept answer no longer moves when a label or a catalogue number arrives");
  const view = src.slice(src.indexOf("function libraryView("), src.indexOf("function libraryView(") + 6000);
  assert.match(view, /artist: \(a, b\) => artistSortName\(a\)\.localeCompare\(artistSortName\(b\)\)/, "the artist order no longer sorts by artistSortName");
});

test("shelfYearsStamp — moves when an album's year does, and only then", () => {
  const albums = [{ nTitle: "blue", nArtist: "joni mitchell" }, { nTitle: "hejira", nArtist: "joni mitchell" }];
  const years = new Map([["blue||joni mitchell", "1971"]]);
  const L = loadIndexFunctions(["shelfYearsStamp", "albumYearOf", "albumYearKey"],
    { albumIndex: { albums }, albumYearCache: years });
  const before = L.shelfYearsStamp();
  assert.equal(L.shelfYearsStamp(), before, "the same years, the same stamp");
  years.set("hejira||joni mitchell", "1976");
  const dated = L.shelfYearsStamp();
  assert.notEqual(dated, before, "a year arriving");
  years.set("blue||joni mitchell", "1976"); years.set("hejira||joni mitchell", "1971");
  assert.notEqual(L.shelfYearsStamp(), dated, "two albums trading years");
});

test("shelfSignature — the same shelf, the same signature; any change, another", () => {
  const one = buildShelf([{ offset: 1, title: "Blue", subtitle: "Joni Mitchell", image_key: "k", g: ["Folk"], f: "joni mitchell" }],
    { genresOf: (al) => al.g, firstOf: (al) => al.f });
  const same = JSON.parse(JSON.stringify(one));
  const other = JSON.parse(JSON.stringify(one)); other.albums[0].g = [];
  const dated = JSON.parse(JSON.stringify(one)); dated.albums[0].y = 1971;
  assert.equal(shelfSignature(one), shelfSignature(same));
  assert.notEqual(shelfSignature(one), shelfSignature(other));
  assert.notEqual(shelfSignature(one), shelfSignature(dated), "a year arriving is a change the Years tab shows");
  assert.match(shelfSignature(one), /^[0-9a-f]{16}$/);
});
