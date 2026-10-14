"use strict";
// ---------------------------------------------------------------------------
// The library from the Core's own list (lib/roon-direct/library.js,
// dev/design/native-remote.md §3.2, N1a): each Core album a record with the
// Core's source, opened through the official list's row of the same title and
// artist, or — with none — past that list's end, where Roon's search takes it.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { nativeView, showLibrary, PAST_END } = require("../../lib/roon-direct/library");

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const makeRecord = (it, offset) => ({ offset, title: it.title, subtitle: it.subtitle, image_key: it.image_key,
  nTitle: norm(it.title), nArtist: norm(it.subtitle) });
const row = (offset, title, artist, image) => makeRecord({ title, subtitle: artist, image_key: image || "pub" + offset }, offset);
const roon = (title, artist, cs, img) => ({ oid: "1", title, artist, contentSource: cs, imageKey: img || null });

const PUB = { albums: [row(0, "Blue", "Joni Mitchell"), row(1, "Dummy", "Portishead"), row(2, "Dummy", "Portishead"),
  row(3, "Untrue", "Burial")], count: 4, declared: 4 };

test("each Core album: the Core's source, and the official row of the same title and artist", () => {
  const v = nativeView([roon("Untrue", "Burial", 256), roon("Blue", "Joni Mitchell", 1)], PUB, makeRecord);
  assert.deepEqual(v.albums.map((a) => [a.title, a.offset, a.roonSource, a.image_key]),
    [["Untrue", 3, "qobuz", "pub3"], ["Blue", 0, "local", "pub0"]]);
  assert.deepEqual([v.paired, v.unpaired], [2, 0]);
  assert.deepEqual(v.bySource, { local: 1, qobuz: 1, tidal: 0, none: 0 });
});

test("compared as an album open compares them: case and punctuation aside", () => {
  const v = nativeView([roon("BLUE!", "Joni  Mitchell", 1)], PUB, makeRecord);
  assert.equal(v.albums[0].offset, 0);
  assert.equal(v.albums[0].title, "BLUE!", "the Core's own title is the one shown");
});

test("the same title and artist twice: one row each, in order — never one row for both", () => {
  const v = nativeView([roon("Dummy", "Portishead", 1), roon("Dummy", "Portishead", 128)], PUB, makeRecord);
  assert.deepEqual(v.albums.map((a) => [a.offset, a.roonSource]), [[1, "local"], [2, "tidal"]]);
});

test("a Core album with no official row: past that list's end, each its own, its own cover key", () => {
  const v = nativeView([roon("Mezzanine", "Massive Attack", 128, "core1"), roon("Dummy", "Portishead", 1),
    roon("Dummy", "Portishead", 128), roon("Dummy", "Portishead", 256, "core2")], PUB, makeRecord);
  assert.deepEqual(v.albums.map((a) => a.offset), [PAST_END, 1, 2, PAST_END + 1],
    "THE one: an album with no row of its own was given another album's offset");
  assert.deepEqual([v.albums[0].image_key, v.albums[3].image_key], ["core1", "core2"]);
  assert.deepEqual([v.paired, v.unpaired], [2, 2]);
});

test("far past the end, so the official list's growing never reaches an offset a tile still holds", () => {
  const v = nativeView([roon("Mezzanine", "Massive Attack", 128)], PUB, makeRecord);
  assert.ok(v.albums[0].offset >= 1000000, "THE one: right past the end, where the next album imported lands");
  const huge = nativeView([roon("Mezzanine", "Massive Attack", 128)], Object.assign({}, PUB, { declared: 2000000 }), makeRecord);
  assert.equal(huge.albums[0].offset, 2000000, "and past what the official list declared, whatever its size");
});

test("titles that normalise to nothing pair only by their own strings (the owner's \"+\" and \"=\", v1.9.20)", () => {
  const pub = { albums: [row(0, "=", "Ed Sheeran"), row(1, "+", "Ed Sheeran"), row(2, "στίγμα", "Zalem")], count: 3, declared: 3 };
  const v = nativeView([roon("+", "Ed Sheeran", 256), roon("=", "Ed Sheeran", 256), roon("στίγμα", "Zalem", 256),
    roon("÷", "Ed Sheeran", 256)], pub, makeRecord);
  assert.deepEqual(v.albums.map((a) => a.offset), [1, 0, 2, PAST_END]);
  const alone = nativeView([roon("÷", "Ed Sheeran", 256)], pub, makeRecord);
  assert.equal(alone.albums[0].offset, PAST_END, "THE one: \"÷\" was given another album's row because both normalise to nothing");
});

test("an exact pair is never robbed by a loose one that came first", () => {
  const pub = { albums: [row(0, "Blue", "Joni Mitchell"), row(1, "Blue", "Joni Mitchell!")], count: 2, declared: 2 };
  const v = nativeView([roon("BLUE", "joni mitchell", 1), roon("Blue", "Joni Mitchell", 1)], pub, makeRecord);
  assert.deepEqual(v.albums.map((a) => a.offset), [1, 0]);
});

test("no source the Core names, or none: null; no list read: no view", () => {
  const v = nativeView([roon("Blue", "Joni Mitchell", 2), roon("Untrue", "Burial", null)], PUB, makeRecord);
  assert.deepEqual(v.albums.map((a) => a.roonSource), [null, null]);
  assert.equal(nativeView(null, PUB, makeRecord), null);
});

test("what the screens read: the official list while no Core list is in force, or none walked yet", () => {
  const view = { albums: [], count: 0 };
  assert.equal(showLibrary(view, PUB, null, makeRecord), null);
  assert.equal(view.albums, PUB.albums);
  const counts = showLibrary(view, PUB, [roon("Blue", "Joni Mitchell", 1)], makeRecord);
  assert.deepEqual([view.count, view.albums[0].roonSource, counts.paired], [1, "local", 1]);
  const empty = { albums: [], count: 0, declared: 0 };
  assert.equal(showLibrary(view, empty, [roon("Blue", "Joni Mitchell", 1)], makeRecord), null,
    "THE one: the Core's albums given offsets before the official list was walked — every one past an end that is not there");
  assert.equal(view.albums, empty.albums);
});
