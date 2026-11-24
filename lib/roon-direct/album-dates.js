// @ts-check
"use strict";
/*
 * album-dates.js — an album's dates as Roon's own server sends them (dev/design/recently-added.md §4 and §5,
 * 2.0.6-t15): when it was added to the library (`ImportDate`), and when it was released (`OriginalReleaseDate`, then
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
 * The album's release date as Roon has it, from its two dates as text (nullDateText): its original release, which is
 * what Rouen's dates mean (index.js yearSourceRank: the ORIGINAL release, never a reissue's); its ReleaseDate where Roon
 * gives no original, or where it says more of the same date ("2008" and "2008-11-18" are one release told to the day).
 * @param {string | null | undefined} o  OriginalReleaseDate @param {string | null | undefined} r  ReleaseDate
 * @returns {string | null}
 */
function releasedOf(o, r) {
  if (!o) return r || null;
  return r && r.length > o.length && r.startsWith(o) ? r : o;
}

/** Whether two dates are one release, the first said to the day or less: "1969" and "1969-09-26". @param {string} a @param {string} b */
const sameRelease = (a, b) => a === b || (a.length < b.length ? b.startsWith(a) : a.startsWith(b));

/**
 * Roon's word for each key Rouen keeps its dates under (index.js albumYearKey), from the library in force: an album
 * Roon dated gives its key that date, told as finely as any of Roon's albums on that key tell it. Several albums share
 * a key (Weezer's five records called "Weezer"): where Roon dates them differently, it states no one date for the key,
 * as the other harvests refuse such a key (harvestAlbumYears' ambiguity rule), and the key is null. A key whose albums
 * Roon dated none of is null too. An album not of Roon's (no `roon`) says nothing.
 * @param {Array<{ roon?: { released?: string | null } }>} albums  the library the screens read (albumIndex.albums)
 * @param {(al: any) => string} keyOf
 * @returns {Map<string, string | null>}
 */
function roonDatesByKey(albums, keyOf) {
  /** @type {Map<string, string | null>} */
  const out = new Map();
  /** Keys Roon's albums disagree on. @type {Set<string>} */
  const split = new Set();
  for (const al of albums) {
    if (!al.roon) continue;
    const k = keyOf(al), d = al.roon.released || null;
    const had = out.get(k);
    if (split.has(k) || !d) { if (!out.has(k)) out.set(k, null); continue; }
    if (had && !sameRelease(had, d)) { split.add(k); out.set(k, null); continue; }
    out.set(k, had && had.length >= d.length ? had : d);
  }
  return out;
}

/**
 * Roon's release dates written where Rouen keeps its dates, its whole word each read (index.js storeRoonDates): a key
 * Roon dates takes that date (set: setAlbumYear, source "roon", restated); a key whose stored date is Roon's and that
 * Roon no longer dates, or dates two ways, is withdrawn (drop), for the other sources to fill again. Each change is
 * counted as it is made (`count.n`), so a store that throws part way still says what it changed.
 * @param {Array<{ roon?: { released?: string | null } }>} albums @param {(al: any) => string} keyOf
 * @param {{ set: (key: string, date: string) => boolean, sourceOf: (key: string) => string | null | undefined,
 *           drop: (key: string) => void, count: { n: number } }} o
 */
function storeReleased(albums, keyOf, o) {
  for (const [k, d] of roonDatesByKey(albums, keyOf)) {
    if (d) { if (o.set(k, d)) o.count.n++; }
    else if (o.sourceOf(k) === "roon") { o.drop(k); o.count.n++; }
  }
}

module.exports = { addedOf, nullDateText, releasedOf, roonDatesByKey, storeReleased, DOTNET_EPOCH_MS, TICKS_PER_MS, TICKS_MASK };
