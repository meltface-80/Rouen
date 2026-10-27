// @ts-check
/*
 * shelf-format.js — the Shelf's Format tab (v1.9.70-t5, dev/design/shelf-focus.md §3): what an album's format, as
 * Roon holds it, puts it under, and the tiles' names and order. Three groups, the owner's choice: the file formats,
 * the quality (Hi-Res, CD quality, Lossy, MQA, DSD, Multichannel, Streaming) and the exact resolutions. Pure: the
 * album's facts in, keys out; shelf-pick.js draws and counts them.
 * Copyright (c) 2026 Lewis Menzies (Music Duck / MusicD)
 * Released under the MIT License. See the LICENSE file for details.
 *
 *   ShelfFormat.keysOf(fx)  the tiles an album sits under: ["file:1", "q:hires", "res:96000/24"], or ["none"]
 *   ShelfFormat.groups(keys)  [[heading, keys in order], …] for the keys the library has
 *   ShelfFormat.nameOf(key)
 *
 * fx is lib/shelf-routes.js's: [file format, sample rate, bits, channels, MQA rate, lossy bit rate, streaming, mixed].
 */
(() => {
  "use strict";

  /** The catalogue's FileFormat, as Roon names each. */
  const FILES = { 0: "Unknown format", 1: "FLAC", 2: "AAC", 3: "ALAC", 4: "MP3", 5: "WAV", 6: "OGG", 7: "AIFF", 8: "WMA",
    12: "TIDAL", 13: "DSD (DSF)", 14: "DSD (DFF)", 15: "Qobuz", 17: "KKBox" };
  const LOSSY = new Set([2, 4, 6, 8]), DSD_FILES = new Set([13, 14]);
  const DSD_BASE = 2822400;
  const QUALITY = [["q:hires", "Hi-Res"], ["q:cd", "CD quality"], ["q:lossy", "Lossy"], ["q:mqa", "MQA"], ["q:dsd", "DSD"],
    ["q:multi", "Multichannel"], ["q:stream", "Streaming"], ["q:mixed", "Mixed formats"]];
  const QUALITY_NAME = Object.fromEntries(QUALITY);

  /** @param {number} hz */
  const khz = (hz) => (hz % 1000 === 0 ? String(hz / 1000) : (hz / 1000).toFixed(1)) + " kHz";
  /** DSD64 for 2.8224 MHz, DSD128 for twice that, and so on; a rate that is no such multiple, as it is. @param {number} hz */
  const dsdName = (hz) => { const m = hz / DSD_BASE; return Number.isInteger(m) && m >= 1 ? "DSD" + 64 * m : (hz / 1e6).toFixed(4) + " MHz DSD"; };

  /**
   * The tiles an album sits under. None of its facts sent: "none" alone (the Unknown tile).
   * @param {Array<number|null> | null | undefined} fx @returns {string[]}
   */
  function keysOf(fx) {
    if (!fx) return ["none"];
    const [file, rate, bits, channels, mqa, , streaming, mixed] = fx;
    const out = [];
    if (file !== null && file !== undefined) out.push("file:" + file);
    const dsd = (file !== null && DSD_FILES.has(file)) || (!!rate && rate >= DSD_BASE);
    // By the file alone: LossyBitRate is the average bit rate of any file, lossless too (the owner's FLAC 44/16
    // album carries 959, the reads probe of v1.9.70-t4), so it says nothing of loss.
    const lossy = file !== null && LOSSY.has(file);
    if (dsd) out.push("q:dsd");
    else if (lossy) out.push("q:lossy");
    else if (rate && (rate > 48000 || (bits || 0) > 16)) out.push("q:hires");
    else if ((rate === 44100 || rate === 48000) && bits && bits <= 16) out.push("q:cd");
    if (mqa) out.push("q:mqa");
    if (channels && channels > 2) out.push("q:multi");
    if (streaming) out.push("q:stream");
    if (mixed) out.push("q:mixed");
    if (rate) out.push(dsd ? "res:dsd:" + rate : "res:" + rate + "/" + (bits || 0));
    return out.length ? out : ["none"];
  }

  /** A tile's name. @param {string} key */
  function nameOf(key) {
    if (key === "none") return "Unknown";
    if (key.startsWith("file:")) return FILES[+key.slice(5)] || "Format " + key.slice(5);
    if (key.startsWith("q:")) return QUALITY_NAME[key] || key.slice(2);
    if (key.startsWith("res:dsd:")) return dsdName(+key.slice(8));
    const [rate, bits] = key.slice(4).split("/").map(Number);
    return khz(rate) + (bits ? " / " + bits + "-bit" : "");
  }

  /**
   * The groups the library's keys make, each in its order: the formats by name, the quality as listed, the
   * resolutions PCM by rate then bits and DSD after; Unknown last of all, a group of its own.
   * @param {Iterable<string>} have @returns {Array<[string, string[]]>}
   */
  function groups(have) {
    const keys = [...new Set(have)];
    const files = keys.filter((k) => k.startsWith("file:")).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    const quality = QUALITY.map(([k]) => k).filter((k) => keys.includes(k));
    const pcm = keys.filter((k) => k.startsWith("res:") && !k.startsWith("res:dsd:"))
      .sort((a, b) => { const [ra, ba] = a.slice(4).split("/").map(Number), [rb, bb] = b.slice(4).split("/").map(Number); return ra - rb || ba - bb; });
    const dsd = keys.filter((k) => k.startsWith("res:dsd:")).sort((a, b) => +a.slice(8) - +b.slice(8));
    /** @type {Array<[string, string[]]>} */
    const out = [["Formats", files], ["Quality", quality], ["Resolution", pcm.concat(dsd)]];
    if (keys.includes("none")) out.push(["Not known", ["none"]]);
    return out.filter(([, ks]) => ks.length);
  }

  /** @type {any} */ (window).ShelfFormat = { keysOf, nameOf, groups };
})();
