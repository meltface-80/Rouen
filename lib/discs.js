"use strict";
// ---------------------------------------------------------------------------
// Which disc each track of an album is on (v1.9.4).
//
// Roon's browse API has no disc field. An album's level is a flat list of rows:
// the Play menu, the tracks, and whatever else Roon puts between them. Two
// things in that list can say where a disc starts, and both are read:
//
//   - a row between the tracks that reads like a disc ("Disc 2", "CD 2",
//     "Disc 2: Live") and that the track filter (isTrackItem) does not take
//     for a track — a header row, or a row with nothing to play. A row the
//     filter DOES count as a track stays a track here too, whatever its title:
//     the two lists must agree, or /api/play-track's indices would not;
//   - Roon's own "N. " number going back to 1, as it does when each disc is
//     numbered from 1. An album whose every track is "1." (singles gathered
//     under one name) is one album, not a disc per track.
//
// Neither is assumed to be the only one: no Roon documentation says which a
// Core sends, and a Core may send both (a header AND a restart, counted once).
// The server logs every row of an album it opens ("[album items]", with
// RRA_DEBUG on, the Docker default), which is how to see what a given Core
// sends for a given album.
//
// Pure: rows in, discs out. Nothing here reaches Roon.
// ---------------------------------------------------------------------------

const DISC_LABEL = /^\s*(?:disc|disk|cd)\s*\d+\b/i;

// Roon's "N. " prefix as a number, or null (no prefix, or a title that merely
// starts with digits: "1999. The Party" is not track 1999). index.js reads its
// track numbers through this one function, so the two cannot drift apart.
function numberOf(title) {
  const m = /^(\d+)\.\s+/.exec(title || "");
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 && n <= 999 ? n : null;
}

/**
 * @param {Array}    rows     the album level's rows, in Roon's order
 * @param {Function} isTrack  (row) → true for a track row (index.js passes
 *                            isTrackItem bound to the level's Play menu)
 * @returns {{ count: number, of: number[], labels: string[] }}
 *   of[i]      the disc (1-based) of the i-th TRACK row
 *   labels[d]  what to call disc d+1: the row Roon sent for it, or "Disc N"
 *   count      how many discs; 1 for an ordinary album
 */
function discsOf(rows, isTrack) {
  const of = [];
  const named = [];          // named[d] = the label Roon gave disc d+1, if any
  let disc = 1;
  let tracksOnDisc = 0;      // tracks seen since the current disc began
  let prevNo = null;         // the last numbered track's "N. " number
  let labelled = false;      // any disc row at all
  for (const row of rows || []) {
    if (!row) continue;
    if (!isTrack(row)) {
      const title = String(row.title || "");
      if (DISC_LABEL.test(title)) {
        labelled = true;
        // A label before any track names disc 1; one after tracks starts the
        // next disc. A "1." straight after it then starts nothing more: the
        // restart below needs a track already on the disc.
        if (tracksOnDisc > 0) { disc++; tracksOnDisc = 0; }
        named[disc - 1] = title.trim();
      }
      continue;
    }
    const n = numberOf(row.title);
    // Numbering back at 1 after a numbered track: a new disc. Only a return
    // to 1 counts — a list that skips or repeats any other number is one disc
    // with odd tags, not a set. An unnumbered track (a hidden one, say) keeps
    // the last number, so it does not hide the next disc's "1.".
    if (n === 1 && prevNo !== null && tracksOnDisc > 0) { disc++; tracksOnDisc = 0; }
    of.push(disc);
    tracksOnDisc++;
    if (n !== null) prevNo = n;
  }
  // A label row with no tracks after it is not a disc.
  let count = of.length ? of[of.length - 1] : 1;
  // Discs found by numbering alone, none of them more than one track long:
  // every track was "1." — one album with odd tags, not a set of singles.
  if (!labelled && count > 1 && count === of.length) {
    for (let k = 0; k < of.length; k++) of[k] = 1;
    count = 1;
  }
  const labels = [];
  for (let d = 0; d < count; d++) labels.push(named[d] || "Disc " + (d + 1));
  return { count, of, labels };
}

module.exports = { discsOf, numberOf, DISC_LABEL };
