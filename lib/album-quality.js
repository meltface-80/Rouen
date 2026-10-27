// @ts-check
"use strict";
// What an album's files are, in the shorthand Roon uses: "24/96", "16/44.1",
// "MP3". Moved out of index.js in v1.9.68 with the Shelf's format line, which
// reads the same facts.

/**
 * @typedef {{ container?: (string|null), bits?: (number|null), rate?: (number|null),
 *   chan?: (number|null), lossless?: boolean }} FileFacts
 */

/**
 * A sample rate as people say it: 44.1, 48, 96, 192. Trailing ".0" is noise on
 * a badge two characters wide.
 * @param {number|null|undefined} hz
 * @returns {string|null}
 */
function rateShort(hz) {
  if (!hz) return null;
  const k = hz / 1000;
  return String(Number.isInteger(k) ? k : Math.round(k * 10) / 10);
}

/**
 * What an album IS, in Roon's own shorthand: "24/96", "16/44.1", or just the
 * container for a lossy file where bit depth means nothing.
 *
 * Returns null when there is no local file to inspect — a streamed album has
 * no format this extension can read, and inventing one would be worse than an
 * empty badge.
 * @param {FileFacts|null|undefined} f
 * @returns {string|null}
 */
function albumQualityLabel(f) {
  if (!f) return null;
  // Lossy first: MP3 and AAC report a bitsPerSample that describes the decoder,
  // not the recording, so "16/44.1" on an MP3 would claim CD quality.
  if (!f.lossless) return f.container || null;
  if (f.bits && f.rate) return f.bits + "/" + rateShort(f.rate);
  if (f.rate) return rateShort(f.rate) + " kHz";
  return f.container || null;
}

/**
 * Better than CD. Roon calls this hi-res and marks it; the badge tints rather
 * than saying so in words, which would not fit.
 *
 * TIDAL states a TIER rather than numbers, so its hi-res albums arrive with no
 * bit depth to compare — the tier's own label is the evidence.
 * @param {FileFacts|null|undefined} f
 * @returns {boolean}
 */
function albumIsHiRes(f) {
  if (!f || !f.lossless) return false;
  if (f.container === "Hi-Res") return true;
  return !!((f.bits && f.bits > 16) || (f.rate && f.rate > 48000));
}

/**
 * A sample rate as the Library's facet names it (moved out of index.js in v1.9.68-t3): the tidy audio values, and
 * anything else as it is rather than forced into a bucket that would misdescribe it.
 * @param {number|null|undefined} hz @returns {string|null}
 */
function rateLabel(hz) {
  if (!hz) return null;
  const k = hz / 1000;
  return (Number.isInteger(k) ? k : k.toFixed(1)) + " kHz";
}

/** The channels as the Library's facet names them. @param {number|null|undefined} n @returns {string|null} */
function channelLabel(n) {
  if (!n) return null;
  if (n === 1) return "Mono";
  if (n === 2) return "Stereo";
  return n + " channels";
}

/** @type {Record<string, string>} */
const SERVICES = { qobuz: "Qobuz", tidal: "TIDAL" };

/**
 * The format a Shelf spine shows (v1.9.68): the container and its numbers for
 * local files ("FLAC 24/96", "MP3"); the service and what it states for an
 * album whose facts a service gave ("Qobuz 24/96", "TIDAL Hi-Res", "TIDAL
 * AAC"), or its name alone when it stated nothing ("Qobuz"); and null when
 * nothing is known — a spine says nothing rather than guess. A local album
 * whose only facts are a service's says nothing: those describe the
 * service's copy, not the files that play.
 * @param {(FileFacts & { src?: string })|null|undefined} f  the album's file facts, and who gave them ("file", "qobuz", "tidal")
 * @param {string|null|undefined} source  where it comes from: "local", "qobuz", "tidal" or nothing
 * @returns {string|null}
 */
function albumFormatLabel(f, source) {
  const from = f && f.src && SERVICES[f.src] ? SERVICES[f.src] : null;
  if (from && source === "local") return null;
  const q = albumQualityLabel(f);
  if (from) return q ? from + " " + q : from;
  if (q) {
    // a lossy file's label already IS its container
    const box = f && f.container;
    return box && box !== q ? box + " " + q : q;
  }
  return (source && SERVICES[source]) || null;
}

module.exports = { rateShort, albumQualityLabel, albumIsHiRes, albumFormatLabel, rateLabel, channelLabel };
