// @ts-check
"use strict";
/*
 * runs.js — an album played: every track of it played in one run of it (dev/design/listening.md §3.2; the owner,
 * 2026-11-26: "if all tracks of an album have been played 95% or more than the album would be marked as a play count
 * increase. Someone who skips through tracks within an album should not count", and "one listening").
 *
 * A run is an album's tracks finishing on one zone with no other track between them. Pauses, a track repeated and
 * tracks out of order do not end it. It ends on: a track of another album (played or skipped), a track that could not
 * be matched to a library album, RUN_GAP_MS with nothing finishing on the zone, the zone or the Core gone (`end`), and
 * Rouen restarting (runs live in memory). Once every track of the album has been played in the run, the album is
 * played: `onAlbumPlay`, and the run starts again, so twice through counts two.
 *
 * Which tracks the album has: its track list by position, as Roon listed it (store.js album_track_list). A title heard
 * marks one position not yet marked: first one whose title is the same, else one it matches by its keys (index.js
 * trackTitleKeys: a remaster suffix on one side does not hide a match). So two tracks of one title (a reprise, a
 * classical work's "I. Allegro" twice) need hearing twice. An album whose list Rouen has not kept is read once
 * (`readTracks`) when a track of it is first played in a run, never before: sampling below 95% costs nothing. One
 * that still has no list is never played.
 */

const { RUN_GAP_MS } = require("./rule");

/** A read that failed is tried again after this long, not on every track. */
const RETRY_READ_MS = 6 * 60 * 60 * 1000;

/**
 * @typedef {{ n: number, title: string }} TrackRow
 * @typedef {{ title?: string, subtitle?: string, offset?: number, image_key?: string | null }} Album
 * @typedef {{ key: string, al: Album, heard: string[], last: number }} Run
 */

/**
 * @param {{ tracksOf: (key: string) => TrackRow[], trackKeys: (title: string) => string[],
 *   readTracks?: (al: Album, key: string) => Promise<unknown>,
 *   onAlbumPlay: (p: { zone: string, key: string, al: Album, ts: number, tracks: number }) => void,
 *   log?: (msg: string) => void }} deps
 */
function createRuns(deps) {
  /** @type {Map<string, Run>} */
  const runs = new Map();
  /** @type {Map<string, number>} when each album's list was last asked for */
  const asked = new Map();

  /**
   * A track that finished on a zone (the next track started, the zone stopped).
   * @param {string} zone
   * @param {{ key: string | null, al?: Album | null, title: string, played: boolean, ts: number }} t
   */
  function noteTrack(zone, t) {
    let run = runs.get(zone);
    if (run && (run.key !== t.key || t.ts - run.last > RUN_GAP_MS)) { runs.delete(zone); run = undefined; }
    if (!t.key || !t.al) return;
    if (!run) { run = { key: t.key, al: t.al, heard: [], last: t.ts }; runs.set(zone, run); }
    run.last = t.ts;
    if (!t.played) return;
    run.heard.push(t.title);
    if (!settle(zone, run)) askFor(zone, run);
  }

  /**
   * The run's album played, if it is: said, and the run started again. False when Rouen keeps no track list for the
   * album, so nothing can be said yet. @param {string} zone @param {Run} run
   */
  function settle(zone, run) {
    const list = deps.tracksOf(run.key);
    if (!list.length) return false;
    if (!allHeard(list, run.heard, deps.trackKeys)) return true;
    runs.set(zone, { key: run.key, al: run.al, heard: [], last: run.last });
    deps.onAlbumPlay({ zone, key: run.key, al: run.al, ts: run.last, tracks: list.length });
    return true;
  }

  /** No list kept for the album: read it once, then look again. @param {string} zone @param {Run} run */
  function askFor(zone, run) {
    if (!deps.readTracks) return;
    const at = asked.get(run.key);
    if (at !== undefined && Date.now() - at < RETRY_READ_MS) return;
    asked.set(run.key, Date.now());
    deps.readTracks(run.al, run.key).then(() => {
      try { if (runs.get(zone) === run) settle(zone, run); }
      catch (e) { if (deps.log) deps.log("album run failed: " + /** @type {Error} */ (e).message); }
    },
    // A read that fails (the Core busy, the album moved) leaves the run unplayed: never a guess. It is asked for again
    // after RETRY_READ_MS; index.js's readTracks says why it failed.
    () => {});
  }

  /** Forget a zone's run (the zone is gone). @param {string} zone */
  function end(zone) { runs.delete(zone); }

  return { noteTrack, end, _runs: runs };
}

/**
 * Has every position of the list been heard? Each title heard marks one unmarked position: the first with the same
 * title, else the first it matches by its keys.
 * @param {TrackRow[]} list @param {string[]} heard @param {(title: string) => string[]} trackKeys
 */
function allHeard(list, heard, trackKeys) {
  const keys = list.map((r) => trackKeys(r.title));
  const got = new Set();
  for (const title of heard) {
    const k = trackKeys(title);
    if (!k.length) continue;
    let i = list.findIndex((_, j) => !got.has(j) && keys[j][0] === k[0]);
    if (i < 0) i = list.findIndex((_, j) => !got.has(j) && keys[j].some((x) => k.includes(x)));
    if (i >= 0) got.add(i);
  }
  return got.size === list.length;
}

module.exports = { createRuns, allHeard, RETRY_READ_MS };
