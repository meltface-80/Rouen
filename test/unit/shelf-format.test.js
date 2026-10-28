"use strict";
// ---------------------------------------------------------------------------
// The Shelf's Formats tiles (public/shelf-format.js, v1.9.70-t7, dev/design/shelf-focus.md §3): Mandarin's names and
// order (ShelfFormats.cs), the owner: "This is how I want Rouen format focus on the shelf to be like". The page itself
// is test/dom/shelf-v1970-t5.test.js; this is every rule's edge, which the page's eight records cannot all reach.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const window = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../public/shelf-format.js"), "utf8"), { window });
// (its arrays are another realm's: spread into this one before they are compared)
const { keyOf, ordered } = window.ShelfFormat;

// fx: [file, rate, bits, channels, mqa, lossy, streaming, mixed]
const fx = (file, rate, bits, channels, lossy = null) => [file, rate, bits, channels, null, lossy, 0, 0];

test("PCM by bits and rate, Mandarin's short rates", () => {
  assert.equal(keyOf(fx(1, 44100, 16, 2)), "16/44.1");
  assert.equal(keyOf(fx(1, 88200, 24, 2)), "24/88.2");
  assert.equal(keyOf(fx(5, 352800, 32, 2)), "32/352.8");
  assert.equal(keyOf(fx(3, 96000, 24, 2)), "24/96");
});

test("PCM with only one of the two known", () => {
  assert.equal(keyOf(fx(1, 96000, null, 2)), "96 kHz");
  assert.equal(keyOf(fx(1, null, 24, 2)), "24-bit");
});

test("over two channels is Multichannel; two or not known is not", () => {
  assert.equal(keyOf(fx(1, 96000, 24, 6)), "24/96 Multichannel");
  assert.equal(keyOf(fx(1, 96000, 24, null)), "24/96");
});

test("DSD by its file or its rate, named by the rate's multiple of 44.1 kHz and its channels", () => {
  assert.equal(keyOf(fx(13, 2822400, 1, 2)), "DSD64 2CH");
  assert.equal(keyOf(fx(14, 5644800, 1, 6)), "DSD128 Multichannel");
  // a DSD rate in a file Roon names otherwise (DoP in a FLAC) is DSD, as Mandarin has it
  assert.equal(keyOf(fx(1, 11289600, 1, 2)), "DSD256 2CH");
  // a DSF with no rate known
  assert.equal(keyOf(fx(13, null, null, 2)), "DSD 2CH");
});

test("the review: DSD of the 48 kHz family by 48 kHz; a rate below DSD64 or channels not known not said", () => {
  assert.equal(keyOf(fx(1, 3072000, 1, 2)), "DSD64 2CH");
  assert.equal(keyOf(fx(13, 6144000, 1, 2)), "DSD128 2CH");
  assert.equal(keyOf(fx(13, 176400, 1, 2)), "DSD 2CH");
  assert.equal(keyOf(fx(13, 2822400, 1, null)), "DSD64");
});

test("lossy by its kind, whatever its rate and bits; the average bit rate of a lossless file does not make it lossy", () => {
  assert.equal(keyOf(fx(4, 44100, 16, 2, 320000)), "MP3");
  assert.equal(keyOf(fx(2, 44100, 16, 2, 256000)), "AAC");
  assert.equal(keyOf(fx(1, 44100, 16, 2, 959)), "16/44.1");
});

test("nothing known but the format or the service: that; nothing known at all: no tile", () => {
  assert.equal(keyOf(fx(1, null, null, 2)), "FLAC");
  assert.equal(keyOf(fx(12, null, null, null)), "TIDAL");
  assert.equal(keyOf(fx(99, null, null, 2)), null);
  assert.equal(keyOf(fx(null, null, null, null)), null);
  assert.equal(keyOf(null), null);
});

test("the order: PCM by bits then rate, stereo first; DSD by rate; then the rest by name; each once", () => {
  assert.deepEqual([...ordered([
    fx(4, 44100, 16, 2), fx(14, 5644800, 1, 2), fx(1, 192000, 24, 2), fx(1, 96000, 24, 6), fx(1, 96000, 24, 2),
    fx(13, 2822400, 1, 2), fx(1, 44100, 16, 2), fx(3, 44100, 16, 2), fx(2, 44100, 16, 2), fx(1, 96000, null, 2), null,
  ])], ["16/44.1", "24/96", "24/96 Multichannel", "24/192", "96 kHz", "DSD64 2CH", "DSD128 2CH", "AAC", "MP3"]);
});
