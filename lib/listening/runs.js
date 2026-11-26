// @ts-check
"use strict";
/*
 * runs.js — an album played: every track of it played in one run of it (dev/design/listening.md §3.2; the owner,
 * 2026-11-26: "if all tracks of an album have been played 95% or more than the album would be marked as a play count
 * increase. Someone who skips through tracks within an album should not count", and "one listening").
 *
 * A run is an album's tracks finishing on one zone with no track of another album between them. Pauses, a track
 * repeated and tracks out of order do not end it; a track of another album (played or skipped), a track that could
 * not be matched to an album, or RUN_GAP_MS with nothing finishing on the zone does. Once every track of the album
 * has been played in the run, the album is played: `onAlbumPlay`, and the run starts again, so twice through counts
 * two.
 *
 * Which tracks the album has: its track list as Rouen keeps it (album_tracks, written whenever an album is opened),
 * by position, each position known by its title's keys (index.js trackTitleKeys: a remaster suffix on one side does
 * not hide a match). A title heard marks one position with that title not yet marked, so two tracks of one title (a
 * reprise) need hearing twice. An album whose list Rouen has not kept is read once (`readTracks`) when its first
 * track is played in a run, never before: sampling below 95% costs nothing. One that still has none is never played.
 * Runs live in memory: a restart of Rouen ends every run.
 */

const { RUN_GAP_MS } = require("./rule");

/** A read that failed is tried again after this long, not on every track. */
const RETRY_READ_MS = 6 * 60 * 60 * 1000;

/**
 * @typedef {{ n: number, tkey: string }} TrackRow
 * @typedef {{ title?: string, subtitle?: string, offset?: number, image_key?: string | null }} Album
 * @typedef {{ key: string, al: Album, heard: string[], last: number }} Run
 */

/**
 * @param {{ tracksOf: (key: string) => TrackRow[], trackKeys: (title: string) => string[],
 *   readTracks?: (al: Album) => Promise<unknown>,
 *   onAlbumPlay: (p: { zone: string, key: string, al: Album, ts: number, tracks: number }) => void }} deps
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
    deps.onAlbumPlay({ zone, key: run.key, al: run.al, ts: run.last, tracks: new Set(list.map((r) => r.n)).size });
    return true;
  }

  /** No list kept for the album: read it once, then look again. @param {string} zone @param {Run} run */
  function askFor(zone, run) {
    if (!deps.readTracks) return;
    const at = asked.get(run.key);
    if (at !== undefined && Date.now() - at < RETRY_READ_MS) return;
    asked.set(run.key, Date.now());
    deps.readTracks(run.al).then(() => { if (runs.get(zone) === run) settle(zone, run); },
      // A read that fails (the Core busy, the album moved) leaves the run unplayed: never a guess. It is asked for
      // again after RETRY_READ_MS, so nothing here needs saying.
      () => {});
  }

  /** Forget a zone's run (the zone is gone). @param {string} zone */
  function end(zone) { runs.delete(zone); }

  return { noteTrack, end, _runs: runs };
}

/**
 * Has every position of the list been heard? Each title heard marks one unmarked position it names.
 * @param {TrackRow[]} list @param {string[]} heard @param {(title: string) => string[]} trackKeys
 */
function allHeard(list, heard, trackKeys) {
  /** @type {Map<string, number[]>} */
  const byKey = new Map();
  for (const r of list) {
    const ns = byKey.get(r.tkey);
    if (ns) { if (!ns.includes(r.n)) ns.push(r.n); } else byKey.set(r.tkey, [r.n]);
  }
  const need = new Set(list.map((r) => r.n));
  const got = new Set();
  for (const title of heard) {
    let free;
    for (const k of trackKeys(title)) {
      free = (byKey.get(k) || []).find((n) => !got.has(n));
      if (free !== undefined) break;
    }
    if (free !== undefined) got.add(free);
  }
  for (const n of need) if (!got.has(n)) return false;
  return true;
}

module.exports = { createRuns, allHeard, RETRY_READ_MS };
