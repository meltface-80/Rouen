// @ts-check
/*
 * shelf-format.js — the Shelf's Formats tab (v1.9.70-t7, dev/design/shelf-focus.md §3): the tile each album is
 * under, by its format as Roon holds it, named and ordered as Mandarin's (ShelfFormats.cs, its item 208): the owner,
 * "This is how I want Rouen format focus on the shelf to be like". Each album under one tile:
 *   - PCM by bits and rate, "16/44.1", "24/96" (the rate alone, "96 kHz", where the bits aren't known; the bits
 *     alone, "24-bit", where the rate isn't);
 *   - DSD by its rate as DSD64, DSD128 … (of 44.1 kHz, or of 48 kHz for its family), and its channels as SACD says
 *     them, where known: "DSD64 2CH", "DSD64 Multichannel";
 *   - over two channels, Multichannel: "24/96 Multichannel";
 *   - a lossy album by its kind, "MP3", "AAC"; one nothing is known of but its format (or the service it streams
 *     from), by that: "FLAC", "TIDAL".
 * The tiles in their order: PCM, by bits then rate, stereo before multichannel; then DSD by rate; then the rest by
 * name. An album nothing is known of is under none. Pure: the album's facts in, its tile out.
 * Copyright (c) 2026 Lewis Menzies (Music Duck / MusicD)
 * Released under the MIT License. See the LICENSE file for details.
 *
 *   ShelfFormat.keyOf(fx)       the tile an album is under ("16/44.1"), or null
 *   ShelfFormat.ordered(facts)  the tiles the albums are under, each once, in their order
 *
 * fx is lib/shelf-routes.js's: [file format, sample rate, bits, channels, MQA rate, lossy bit rate, streaming, mixed].
 */
(() => {
  "use strict";

  /** The catalogue's FileFormat, as Roon names each. */
  const FILES = { 1: "FLAC", 2: "AAC", 3: "ALAC", 4: "MP3", 5: "WAV", 6: "OGG", 7: "AIFF", 8: "WMA",
    12: "TIDAL", 15: "Qobuz", 17: "KKBox" };   // DSF and DFF (13, 14): always DSD, named by tileOf
  /** By the file alone: Roon's LossyBitRate is any file's average bit rate, lossless too (v1.9.70-t5). */
  const LOSSY = new Set([2, 4, 6, 8]), DSD_FILES = new Set([13, 14]);
  /** DSD64 is 64 times 44.1 kHz (2.8224 MHz), as Mandarin counts it; one of the 48 kHz family by 48 kHz (the review). */
  const DSD_BASE = 44100, DSD_BASE_48 = 48000, DSD_MIN = 64 * DSD_BASE;

  /** 2822400 → 64, 3072000 → 64; a rate below DSD64 (a DSF's rate given as PCM's), or none, → 0. @param {number | null} rate */
  const dsdTimes = (rate) => (!rate || rate < DSD_MIN ? 0 : Math.round(rate / (rate % DSD_BASE && !(rate % DSD_BASE_48) ? DSD_BASE_48 : DSD_BASE)));

  /** 44100 → "44.1", 96000 → "96". @param {number} hz */
  const short = (hz) => { const k = hz / 1000; return Number.isInteger(k) ? String(k) : String(Math.round(k * 10) / 10); };

  /** @typedef {{ name: string, family: number, bits: number, rate: number, multi: boolean }} Tile */

  /**
   * The tile an album is under, with where it stands; null when nothing is known of its files.
   * @param {Array<number|null> | null | undefined} fx @returns {Tile | null}
   */
  function tileOf(fx) {
    if (!fx) return null;
    const [file, rate, bits, channels] = fx;
    const multi = !!channels && channels > 2;
    if ((file !== null && DSD_FILES.has(file)) || (!!rate && rate >= DSD_MIN)) {
      const times = dsdTimes(rate);
      // the channels as SACD says them; not known, not said (the review)
      return { name: (times ? "DSD" + times : "DSD") + (multi ? " Multichannel" : channels ? " 2CH" : ""), family: 1, bits: 0, rate: times, multi };
    }
    const lossy = file !== null && LOSSY.has(file);
    if (!lossy && (bits || rate)) {
      const q = !bits ? short(/** @type {number} */ (rate)) + " kHz" : rate ? bits + "/" + short(rate) : bits + "-bit";
      // the bits not known: after those that are
      return { name: q + (multi ? " Multichannel" : ""), family: 0, bits: bits || 99, rate: rate || 0, multi };
    }
    const name = file !== null ? /** @type {Record<number, string>} */ (FILES)[file] : undefined;
    return name ? { name: name + (multi ? " Multichannel" : ""), family: 2, bits: 0, rate: 0, multi } : null;
  }

  /** @param {Array<number|null> | null | undefined} fx @returns {string | null} */
  const keyOf = (fx) => { const t = tileOf(fx); return t ? t.name : null; };

  /**
   * The tiles the albums are under, each once, in their order.
   * @param {Iterable<Array<number|null> | null | undefined>} facts @returns {string[]}
   */
  function ordered(facts) {
    /** @type {Map<string, Tile>} */
    const by = new Map();
    for (const fx of facts) { const t = tileOf(fx); if (t && !by.has(t.name)) by.set(t.name, t); }
    return [...by.values()].sort((a, b) => a.family - b.family || a.bits - b.bits || a.rate - b.rate
      || Number(a.multi) - Number(b.multi) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" })).map((t) => t.name);
  }

  /** @type {any} */ (window).ShelfFormat = { keyOf, ordered };
})();
