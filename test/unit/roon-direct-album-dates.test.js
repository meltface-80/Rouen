"use strict";
// ---------------------------------------------------------------------------
// An album's dates as Roon's server sends them (lib/roon-direct/album-dates.js, 2.0.6-t14,
// dev/design/recently-added.md §3.3–§5). The expected dates are the owner's server's (the probe's third run,
// 2026-11-24): its raw ImportDates beside the times they were added, which the owner had just added that morning —
// not this module's arithmetic copied into the test.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { BinaryWriter } = require("../../lib/roon-direct/wire");
const { addedOf, nullDateText, releasedOf, storeReleased } = require("../../lib/roon-direct/album-dates");

const iso = (/** @type {number | null} */ ms) => (ms === null ? null : new Date(ms).toISOString());
/** A NullDate as the server sends it: its integer, the bytes a LengthPrefixed member holds. */
const nd = (/** @type {number} */ y, /** @type {number} */ m, /** @type {number} */ d) => new BinaryWriter().integer((y << 16) | (m << 8) | d).toBuffer();

test("ImportDate: the owner's server's own values read as the times they were added", () => {
  // Zero 7's "When It Falls" and Hermanos Gutiérrez's "Los Ojos Del Cóndor", as the probe reported them.
  assert.equal(iso(addedOf(5250997338147387904n)), "2026-11-24T15:46:12.000Z", "a bigint, as the connection reads it");
  assert.equal(iso(addedOf("5250997041277387904")), "2026-11-24T07:31:25.000Z", "its digits, as albums.js importOf keeps it");
  // The oldest of the library's: LCD Soundsystem's first album.
  assert.equal(iso(addedOf("5250936962177387904")), "2026-09-15T18:39:35.000Z");
});

test("ImportDate: a DateTime's kind is not its date; what is no date is null", () => {
  const ticks = 639311319720000000n;   // "When It Falls"'s ticks, without its kind
  assert.equal(iso(addedOf(ticks)), "2026-11-24T15:46:12.000Z", "Unspecified");
  assert.equal(iso(addedOf((2n << 62n) | ticks)), "2026-11-24T15:46:12.000Z", "Local: ToBinary stores its UTC ticks");
  assert.equal(addedOf(null), null);
  assert.equal(addedOf(undefined), null);
  assert.equal(addedOf("hex:0102"), null, "not digits");
  assert.equal(addedOf(1795535172000), null, "Unix milliseconds are not this form: they read as the year 1");
  assert.equal(addedOf(Number.MAX_VALUE), null);
});

test("a NullDate: as much of a date as it gives", () => {
  assert.equal(nullDateText(nd(2008, 11, 18)), "2008-11-18");
  assert.equal(nullDateText(nd(1970, 0, 0)), "1970", "a year alone (native-remote.md §12.12: 1970-00-00)");
  assert.equal(nullDateText(nd(1973, 3, 0)), "1973-03");
  assert.equal(nullDateText(Buffer.from("bdc88000", "hex")), "1970", "the owner's server's own MinDate bytes (§12.12)");
  assert.equal(nullDateText(Buffer.from("bdec981f", "hex")), "1979-12-31", "…and its MaxDate");
  assert.equal(nullDateText((2008 << 16) | (11 << 8) | 18), "2008-11-18", "its integer");
  assert.equal(nullDateText(nd(0, 0, 0)), null, "no date");
  assert.equal(nullDateText(nd(2008, 13, 1)), null, "no month 13");
  assert.equal(nullDateText(nd(2008, 0, 5)), null, "a day with no month");
  assert.equal(nullDateText(Buffer.concat([nd(2008, 11, 18), Buffer.from([0])])), null, "more than its integer: not a NullDate");
  assert.equal(nullDateText(Buffer.from([0x80])), null, "cut short");
  assert.equal(nullDateText(null), null);
});

test("the release date: Roon's original release; its ReleaseDate only where it says more of the same, or there's no original", () => {
  assert.equal(releasedOf(nd(1973, 3, 1), nd(2011, 9, 26)), "1973-03-01", "THE one: a reissue's date never stands for the album's");
  assert.equal(releasedOf(nd(2008, 0, 0), nd(2008, 11, 18)), "2008-11-18", "the same release, told to the day");
  assert.equal(releasedOf(nd(2008, 11, 0), nd(2008, 12, 1)), "2008-11", "a different month is not more of the same");
  assert.equal(releasedOf(null, nd(2008, 11, 18)), "2008-11-18", "no original: Roon's ReleaseDate");
  assert.equal(releasedOf(undefined, undefined), null);
});

test("Roon's release dates are written as Roon's, each album by its key; an album Roon gave none for, untouched", () => {
  const albums = [
    { k: "a", roon: { released: "2008-11-18" } },
    { k: "b", roon: { released: null } },
    { k: "c" },                                    // not one of Roon's: the official list's
    { k: "d", roon: { released: "1999" } },
  ];
  const wrote = [];
  const n = storeReleased(albums, (al) => al.k, (k, d) => { wrote.push([k, d]); return k !== "d"; });
  assert.deepEqual(wrote, [["a", "2008-11-18"], ["d", "1999"]]);
  assert.equal(n, 1, "only what changed is counted");
});
