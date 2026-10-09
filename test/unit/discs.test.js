"use strict";
// ---------------------------------------------------------------------------
// v1.9.4: which disc each track of a set is on.
//
// Asked: "verify that multi-disc albums have each disc individually listed".
// They were not. Roon's browse API has no disc field; an album's level is a
// flat list, and Shelf numbered it 1…N straight through. Whatever Roon put
// between the discs was dropped by the track filter (isTrackItem drops header
// rows), and Roon's own per-disc numbers were stripped off the titles.
//
// No documentation says which of two things a Core sends to mark a disc — a
// row between the tracks that reads "Disc 2", or numbering that starts again
// at 1 — so lib/discs.js reads both, and these pin each, the two together,
// and the cases that must NOT be read as a disc. Then the real
// openAlbumByOffset, to show the answer reaches /api/album.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { discsOf, numberOf } = require("../../lib/discs");
const { loadIndexFunctions, indexSource } = require("../lib/extract");

const PLAY = { title: "Play Album", hint: "action_list", item_key: "p" };
const T = (title) => ({ title, subtitle: "Pink Floyd", hint: "action_list", item_key: "t:" + title });
const H = (title, hint) => ({ title, hint: hint === undefined ? "header" : hint });
// index.js's own rule — the real isTrackItem, as openAlbumByOffset hands it
// over — so these keep testing what the server does if that rule changes.
const { isTrackItem } = loadIndexFunctions(["isTrackItem"]);
const isTrack = (r) => isTrackItem(r, PLAY);

test("discs from Roon's numbering starting again at 1 (v1.9.4)", async (t) => {
  await t.test("THE one: 1 2 3 then 1 2 is two discs", () => {
    const d = discsOf([PLAY, T("1. In the Flesh?"), T("2. The Thin Ice"), T("3. Another Brick in the Wall"),
                       T("1. Hey You"), T("2. Is There Anybody Out There?")], isTrack);
    assert.equal(d.count, 2);
    assert.deepEqual(d.of, [1, 1, 1, 2, 2]);
    assert.deepEqual(d.labels, ["Disc 1", "Disc 2"]);
  });
  await t.test("three discs, the middle one a single track", () => {
    const d = discsOf([T("1. A"), T("2. B"), T("1. C"), T("1. D"), T("2. E")], isTrack);
    assert.deepEqual(d.of, [1, 1, 2, 3, 3]);
  });
  await t.test("an ordinary album is one disc", () => {
    const d = discsOf([PLAY, T("1. Speak to Me"), T("2. Breathe"), T("3. On the Run")], isTrack);
    assert.equal(d.count, 1);
    assert.deepEqual(d.of, [1, 1, 1]);
  });
  await t.test("only a return to 1 counts: a skip or a repeat is one disc with odd tags", () => {
    assert.equal(discsOf([T("1. A"), T("3. B"), T("2. C"), T("2. D"), T("5. E")], isTrack).count, 1);
  });
  await t.test("every track numbered 1 (singles under one name) is one album, not a disc per track", () => {
    const d = discsOf([PLAY, T("1. A"), T("1. B"), T("1. C")], isTrack);
    assert.equal(d.count, 1);
    assert.deepEqual(d.of, [1, 1, 1]);
  });
  await t.test("…but two real discs of one track each are still two", () => {
    assert.equal(discsOf([H("Disc 1"), T("1. Side one"), H("Disc 2"), T("1. Side two")], isTrack).count, 2);
  });
  await t.test("an unnumbered track (a hidden one) does not hide the next disc's 1", () => {
    const d = discsOf([T("1. A"), T("2. B"), T("Hidden track"), T("1. C"), T("2. D")], isTrack);
    assert.deepEqual(d.of, [1, 1, 1, 2, 2]);
  });
  await t.test("tracks with no numbers at all are one disc", () => {
    assert.equal(discsOf([T("A"), T("B"), T("C")], isTrack).count, 1);
  });
  await t.test("a title that merely starts with digits is not a track number", () => {
    assert.equal(numberOf("1999. The Party"), null);
    assert.equal(numberOf("1. Go"), 1);
    assert.equal(numberOf("Go"), null);
  });
});

test("discs from a row Roon puts between them (v1.9.4)", async (t) => {
  await t.test("THE one: a 'Disc 2' header row starts disc 2, and names it", () => {
    const d = discsOf([PLAY, H("Disc 1"), T("1. A"), T("2. B"), H("Disc 2: Live at Pompeii"), T("3. C"), T("4. D")], isTrack);
    assert.deepEqual(d.of, [1, 1, 2, 2], "numbering that carries on across discs must not hide the header");
    assert.deepEqual(d.labels, ["Disc 1", "Disc 2: Live at Pompeii"]);
  });
  await t.test("whatever hint the row carries — a label row with no item_key is not a track either", () => {
    const d = discsOf([T("1. A"), { title: "CD 2" }, T("2. B")], isTrack);
    assert.deepEqual(d.of, [1, 2]);
    assert.equal(d.labels[1], "CD 2");
  });
  await t.test("a header AND numbering back at 1 is still ONE new disc", () => {
    const d = discsOf([H("Disc 1"), T("1. A"), T("2. B"), H("Disc 2"), T("1. C"), T("2. D")], isTrack);
    assert.equal(d.count, 2);
    assert.deepEqual(d.of, [1, 1, 2, 2]);
  });
  await t.test("a header that is not a disc ('Bonus tracks') starts nothing", () => {
    assert.equal(discsOf([T("1. A"), H("Bonus tracks"), T("2. B")], isTrack).count, 1);
  });
  await t.test("a disc row with no tracks after it is not a disc", () => {
    const d = discsOf([T("1. A"), T("2. B"), H("Disc 2")], isTrack);
    assert.equal(d.count, 1);
    assert.deepEqual(d.labels, ["Disc 1"]);
  });
});

// The real openAlbumByOffset, with the album's rows handed straight to it.
function open(rows) {
  const F = loadIndexFunctions(["openAlbumByOffset", "isTrackItem", "stripTrackNumber"], {
    discsOf,
    withBrowseSession: (fn) => fn("sk"),
    loadAlbumSession: async () => ({
      hierarchy: "albums", albumItem: { title: "The Wall", subtitle: "Pink Floyd", image_key: "k" },
      items: rows, playMenu: rows[0] === PLAY ? PLAY : null, offset: 7,
      libraryMoved: false, shortRead: false, declared: rows.length,
    }),
    drillActionMenu: async () => [],
  });
  return F.openAlbumByOffset(7, null, null, null, null);
}

test("/api/album's album read carries the discs (v1.9.4)", async (t) => {
  await t.test("THE one: a set's tracks each say their disc, and the discs are named", async () => {
    const r = await open([PLAY, T("1. In the Flesh?"), T("2. The Thin Ice"), T("1. Hey You")]);
    assert.deepEqual(r.tracks.map((x) => x.title), ["In the Flesh?", "The Thin Ice", "Hey You"]);
    assert.deepEqual(r.tracks.map((x) => x.disc), [1, 1, 2]);
    assert.deepEqual(r.discs, ["Disc 1", "Disc 2"]);
  });
  await t.test("an ordinary album is exactly what it was: no disc on any track, discs null", async () => {
    const r = await open([PLAY, T("1. Speak to Me"), T("2. Breathe")]);
    assert.equal(r.discs, null);
    assert.deepEqual(r.tracks, [{ title: "Speak to Me", subtitle: "Pink Floyd" }, { title: "Breathe", subtitle: "Pink Floyd" }]);
  });
  await t.test("the disc rows are not tracks: the list is the tracks alone, in Roon's order, as the track filter makes it", async () => {
    const r = await open([PLAY, H("Disc 1"), T("1. A"), H("Disc 2"), T("1. B")]);
    assert.deepEqual(r.tracks.map((x) => x.title), ["A", "B"]);
    assert.deepEqual(r.tracks.map((x) => x.disc), [1, 2]);
  });
});

test("the /api/album route hands the disc names on (v1.9.4)", () => {
  const src = indexSource();
  const at = src.indexOf('app.get("/api/album",');
  assert.ok(at > -1, "the /api/album route moved");
  const route = src.slice(at, src.indexOf("\n});", at));
  assert.match(route, /discs:\s*r\.discs/, "/api/album no longer sends the discs Shelf lists");
});
