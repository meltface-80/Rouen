// @ts-check
"use strict";
/*
 * scrobble.js — what each zone is playing, recorded as plays (moved out of index.js's scrobbleUpdate in 2.0.6-t20,
 * and changed there: dev/design/listening.md).
 *
 * Every zone push comes here. A track that starts gets its row at once (Recently played reads it); while it plays,
 * the time actually listened is added up from the zone's position, in forward steps of under 30 seconds, so a seek is
 * never listening; when it ends (the next track, the same track starting again, a stop, the zone gone) its row is
 * finished: how long was heard, and whether that was a play (rule.js, 95%). The finished track goes to its album's
 * run (runs.js), which says when the whole album has been played.
 *
 * What changed in 2.0.6-t20 besides the rule: a pause no longer ends the track. Until then a pause finished the row
 * and the resume started another, so a track paused half way was two half plays; under the 95% rule it would never be
 * one. A pause (or Roon's loading between tracks) now keeps the track, and only what is heard counts.
 *
 * The queue history (lib/queue-history.js) is filled here as before: at a track change, the outgoing track, with its
 * own rule. Nothing here may throw into the zone handler: the database is optional, and a failure costs the count,
 * never playback.
 */

const { trackPlayed } = require("./rule");

/** The position must have gone back to within this many seconds of the start for a track to have started again. */
const RESTART_S = 5;

/**
 * @typedef {{ title?: string, subtitle?: string, image_key?: string | null }} Album
 * @typedef {{ track: string, artist: string, album: string, image_key: string, duration: number,
 *   playId: number | bigint | null, elapsed: number, lastSeekPos: number, key: string | null, al: Album | null }} Playing
 */

/**
 * @param {{
 *   state: Map<string, Playing>, history: Map<string, any>,
 *   historyEntry: (prev: any, now: number) => any, pushHistory: (list: any, entry: any) => any,
 *   store: () => ReturnType<typeof import("./store").createListeningStore> | null,
 *   match: (p: { album: string, artist: string, image_key: string }) => { key: string, al: Album } | null,
 *   libraryReady: () => boolean,
 *   runs: ReturnType<typeof import("./runs").createRuns>,
 *   changed: () => void,
 *   now?: () => number,
 *   log?: (msg: string) => void,
 * }} deps
 *   state, history: index.js's per-zone maps; store: the listening store while the database is open, else null;
 *   match: album-match.js; libraryReady: whether the library is there to match against (else the row's album is
 *   named later, store.fillKeys); changed: a play was recorded or finished (index.js playsVersion).
 */
function createScrobbler(deps) {
  const now = deps.now || Date.now;

  /** @param {any} z a zone as Roon sends it */
  function update(z) {
    const np = z && z.now_playing;
    const st = z && z.state;
    const zid = z && z.zone_id;
    if (!zid) return;
    // Roon nests now_playing text in three_line / one_line sub-objects.
    const tl = (np && np.three_line) || {};
    const ol = (np && np.one_line) || {};
    const track = tl.line1 || ol.line1 || "";
    const artist = tl.line2 || "";
    const album = tl.line3 || "";
    const prev = deps.state.get(zid);
    const pos = Number(np && np.seek_position) || 0;

    if (st === "playing" && np && track) {
      if (!prev || prev.track !== track || prev.album !== album) {
        if (prev) depart(zid, prev);
        begin(z, zid, { track, artist, album, pos });
        return;
      }
      const step = pos - prev.lastSeekPos;
      if (step > 0 && step < 30) prev.elapsed += step;
      else if (step < 0 && pos < RESTART_S && trackPlayed(prev.elapsed, prev.duration)) {
        // Played through, and back at its start: the same track again (repeat one), a play of its own.
        depart(zid, prev);
        begin(z, zid, { track, artist, album, pos });
        return;
      }
      prev.lastSeekPos = pos;
      return;
    }
    if (prev && np && track && prev.track === track && prev.album === album && (st === "paused" || st === "loading")) {
      // Paused, or Roon loading: the track is not over. The position is kept so a seek while paused is not counted
      // as listening on resume.
      prev.lastSeekPos = pos;
      return;
    }
    if (prev && (st === "paused" || st === "loading")) return;   // the next track loading: it ends when it plays
    if (prev) { finish(zid, prev); deps.state.delete(zid); }
  }

  /** The outgoing track at a change: into the queue history, then finished. @param {string} zid @param {Playing} prev */
  function depart(zid, prev) {
    const entry = deps.historyEntry(prev, now());
    if (entry) deps.history.set(zid, deps.pushHistory(deps.history.get(zid), entry));
    finish(zid, prev);
  }

  /**
   * A track starts: its row, and what is kept while it plays.
   * @param {any} z @param {string} zid @param {{ track: string, artist: string, album: string, pos: number }} t
   */
  function begin(z, zid, t) {
    const np = z.now_playing;
    const image = np.image_key || "";
    const duration = np.length || 0;
    const ready = deps.libraryReady();
    let hit = null;
    try { hit = ready ? deps.match({ album: t.album, artist: t.artist, image_key: image }) : null; }
    catch (e) { log("album match failed: " + /** @type {Error} */ (e).message); }
    let playId = null;
    const store = deps.store();
    if (store) {
      try {
        playId = store.startPlay({ ts: now(), zone: z.display_name || zid, track: t.track, artist: t.artist,
          album: t.album, image_key: image, duration, album_key: hit ? hit.key : (ready ? "" : null) });
        deps.changed();   // Recently played reads this row
      } catch (e) { log("could not record a play: " + /** @type {Error} */ (e).message); }
    }
    deps.state.set(zid, { track: t.track, artist: t.artist, album: t.album, image_key: image, duration, playId,
      elapsed: 0, lastSeekPos: t.pos, key: hit ? hit.key : null, al: hit ? hit.al : null });
  }

  /** A track is over: its row finished, and it goes to its album's run. @param {string} zid @param {Playing} p */
  function finish(zid, p) {
    const played = trackPlayed(p.elapsed, p.duration);
    const store = deps.store();
    if (store && p.playId !== null) {
      try { store.endPlay(p.playId, p.elapsed, played); if (played) deps.changed(); }
      catch (e) { log("could not finish a play: " + /** @type {Error} */ (e).message); }
    }
    try { deps.runs.noteTrack(zid, { key: p.key, al: p.al, title: p.track, played, ts: now() }); }
    catch (e) { log("album run failed: " + /** @type {Error} */ (e).message); }
  }

  /** A zone gone: what it was playing is over. @param {string} zid */
  function zoneGone(zid) {
    const p = deps.state.get(zid);
    if (p) finish(zid, p);
    deps.state.delete(zid);
    deps.runs.end(zid);
  }

  /** The Core gone: everything playing is over. */
  function reset() {
    for (const zid of [...deps.state.keys()]) zoneGone(zid);
  }

  /** @param {string} msg */
  function log(msg) { if (deps.log) deps.log("[plays] " + msg); }

  return { update, zoneGone, reset };
}

module.exports = { createScrobbler };
