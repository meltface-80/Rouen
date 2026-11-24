// @ts-check
"use strict";
/*
 * album-dates.js — an album's dates as Roon's own server sends them (dev/design/recently-added.md §4 and §5,
 * 2.0.6-t14): when it was added to the library (`ImportDate`), and when it was released (`OriginalReleaseDate`, then
 * `ReleaseDate`). Pure: no Core, no index.
 *
 * Their forms, as the owner's server showed them (recently-added.md §3.3, 2026-11-24, 13,067 albums, every one with an
 * ImportDate):
 *   - `ImportDate` is declared `System.DateTime?` (property type 18, a nullable long): a .NET DateTime's ToBinary, its
 *     two top bits its kind and the rest its ticks (100 ns since 0001-01-01). Its kind was UTC; a local one is stored
 *     as UTC ticks too (.NET's ToBinary), so the ticks are read the same either way.
 *   - the release dates are declared `Sooloos.NullDate` (property type 24, LengthPrefixed): the integer
 *     `(year << 16) | (month << 8) | day`, a month or a day of 0 not given (native-remote.md §12.12, proven on a
 *     smart playlist's MinDate and MaxDate in v1.9.57).
 */
const { BinaryReader } = require("./wire");

/** .NET's epoch (0001-01-01) in Unix milliseconds, and its ticks to a millisecond. */
const DOTNET_EPOCH_MS = -62135596800000;
const TICKS_PER_MS = 10000n;
/** The ticks of a DateTime's ToBinary: all but its two top bits (its kind). */
const TICKS_MASK = 0x3FFFFFFFFFFFFFFFn;

/**
 * When an album was added to Roon's library, in Unix milliseconds, from its ImportDate as the connection read it (a
 * bigint, objects.js readValue), or as albums.js importOf keeps it (its digits). Null when it didn't come, or reads as
 * no date between 1990 and 2100 (a form not this one must never pass for a date).
 * @param {bigint | number | string | null | undefined} raw
 * @returns {number | null}
 */
function addedOf(raw) {
  /** @type {bigint} */
  let n;
  if (typeof raw === "bigint") n = raw;
  else if (typeof raw === "number" && Number.isSafeInteger(raw)) n = BigInt(raw);
  else if (typeof raw === "string" && /^-?\d+$/.test(raw)) n = BigInt(raw);
  else return null;
  const ms = DOTNET_EPOCH_MS + Number((BigInt.asUintN(64, n) & TICKS_MASK) / TICKS_PER_MS);
  const y = new Date(ms).getUTCFullYear();
  return Number.isFinite(ms) && y >= 1990 && y <= 2100 ? ms : null;
}

/**
 * A NullDate (its LengthPrefixed bytes, or its integer) as much of a date as it gives: "YYYY-MM-DD", "YYYY-MM" or
 * "YYYY"; null when it gives no year, holds more than its integer, or isn't one (a month past 12, a day past 31, a
 * year before 1000 or after 2999 — what Rouen's dates hold, index.js releaseDateOf).
 * @param {Buffer | number | null | undefined} v
 * @returns {string | null}
 */
function nullDateText(v) {
  /** @type {number} */
  let n;
  if (typeof v === "number") n = v;
  else if (Buffer.isBuffer(v)) {
    try {
      const r = new BinaryReader(v);
      n = r.integer();
      if (r.remaining !== 0) return null;
    } catch (e) { return null; }   // not a NullDate's integer: said as no date, never guessed at
  } else return null;
  if (!Number.isInteger(n) || n <= 0) return null;
  const y = n >> 16, m = (n >> 8) & 0xff, d = n & 0xff;
  if (y < 1000 || y > 2999 || m > 12 || d > 31 || (m === 0 && d !== 0)) return null;
  const pad = (/** @type {number} */ x) => String(x).padStart(2, "0");
  return m === 0 ? String(y) : d === 0 ? `${y}-${pad(m)}` : `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * The album's release date as Roon has it: its original release, which is what Rouen's dates mean (index.js
 * yearSourceRank: the ORIGINAL release, never a reissue's); its ReleaseDate where Roon gives no original, or where it
 * says more of the same date ("2008" and "2008-11-18" are one release told to the day).
 * @param {Buffer | number | null | undefined} original @param {Buffer | number | null | undefined} release
 * @returns {string | null}
 */
function releasedOf(original, release) {
  const o = nullDateText(original), r = nullDateText(release);
  if (!o) return r;
  return r && r.length > o.length && r.startsWith(o) ? r : o;
}

/**
 * Roon's release dates written where Rouen keeps its dates (index.js setAlbumYear, source "roon"), for each album of
 * the library in force that Roon gave one for: Roon's word for the album's date, its whole statement each read (a
 * date Roon has changed replaces the one it gave before). Returns how many changed.
 * @param {Array<{ roon?: { released?: string | null } }>} albums  the library the screens read (albumIndex.albums)
 * @param {(al: any) => string} keyOf  index.js albumYearKey
 * @param {(key: string, date: string) => boolean} set  writes one, true when it changed anything
 */
function storeReleased(albums, keyOf, set) {
  let n = 0;
  for (const al of albums) {
    const d = al.roon && al.roon.released;
    if (d && set(keyOf(al), d)) n++;
  }
  return n;
}

module.exports = { addedOf, nullDateText, releasedOf, storeReleased, DOTNET_EPOCH_MS, TICKS_PER_MS, TICKS_MASK };
