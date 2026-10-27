"use strict";
// The format line on a Shelf spine (v1.9.68): what the files are, or the
// service the album streams from, and nothing when neither is known.
const test = require("node:test");
const assert = require("node:assert/strict");
const { albumFormatLabel } = require("../../lib/album-quality");

test("a spine's format says what the files are", () => {
  assert.equal(albumFormatLabel({ container: "FLAC", bits: 24, rate: 96000, lossless: true, src: "file" }, "local"), "FLAC 24/96");
  assert.equal(albumFormatLabel({ container: "FLAC", bits: 16, rate: 44100, lossless: true }, null), "FLAC 16/44.1");
  // A lossy file's label is its container already; "MP3 MP3" would be noise.
  assert.equal(albumFormatLabel({ container: "MP3", bits: 16, rate: 44100, lossless: false, src: "file" }, "local"), "MP3");
});

test("facts a service stated are named as the service's", () => {
  // Qobuz states numbers; TIDAL a tier (index.js qobuzQualityOf, tidalQualityOf)
  assert.equal(albumFormatLabel({ container: null, bits: 24, rate: 96000, lossless: true, src: "qobuz" }, "qobuz"), "Qobuz 24/96");
  assert.equal(albumFormatLabel({ container: "Hi-Res", bits: null, rate: null, lossless: true, src: "tidal" }, "tidal"), "TIDAL Hi-Res");
  assert.equal(albumFormatLabel({ container: "Lossless", bits: null, rate: null, lossless: true, src: "tidal" }, null), "TIDAL Lossless");
  // TIDAL's lossy tier is not mistaken for a local AAC rip
  assert.equal(albumFormatLabel({ container: "AAC", bits: null, rate: null, lossless: false, src: "tidal" }, "tidal"), "TIDAL AAC");
});

test("a local album says nothing a service said of its own copy", () => {
  assert.equal(albumFormatLabel({ container: null, bits: 24, rate: 96000, lossless: true, src: "qobuz" }, "local"), null);
});

test("a streamed album with no facts names its service", () => {
  assert.equal(albumFormatLabel(null, "qobuz"), "Qobuz");
  assert.equal(albumFormatLabel(null, "tidal"), "TIDAL");
});

test("nothing known, nothing said", () => {
  assert.equal(albumFormatLabel(null, null), null);
  assert.equal(albumFormatLabel(null, "local"), null);
  assert.equal(albumFormatLabel(undefined, "something"), null);
});
