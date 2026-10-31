// @ts-check
"use strict";
/*
 * probe-report.js — the Squeezebox probe's answer to ?read=1, made from a run's state (out of probe-player.js in
 * v1.9.72-t4, behaviour unchanged; dev/design/android-app.md §6 step 1). Pure: it reads the run and changes nothing.
 */

/**
 * How long before the track playing when a command came was due to end: positive is ahead. Worked out when read, as
 * a stream that doesn't say its length is only measured after its audio is in, which is when Roon sends the next.
 * @param {any} s  the run @param {any} t
 */
function aheadOf(s, t) {
  const prev = t.whilePlaying != null && s.tracks.find((/** @type {any} */ x) => x.n === t.whilePlaying);
  if (!prev || prev.playAt == null || !prev.seconds) return null;
  return Math.round(prev.playAt + prev.seconds * 1000 + t.prevPausedMs - t.atAbs);
}

/**
 * The run as ?read=1 gives it: every track without its handles, with how fast and how far ahead it came and where to
 * listen to it.
 * @param {any} s  the run; null before the first
 * @param {(t: any) => number} elapsed  how far a track has played, in ms
 */
function report(s, elapsed) {
  if (!s) return { ran: false };
  const tracks = s.tracks.map((/** @type {any} */ t) => {
    const { file, opusFile } = t;
    /** @type {any} */
    const shown = Object.assign({}, t);
    for (const k of ["stream", "file", "opusFile", "pausedAt", "atAbs", "prevPausedMs", "lastByteAt"]) delete shown[k];
    return Object.assign(shown, {
      aheadOfEndMs: aheadOf(s, t),
      receiveSeconds: t.end != null && t.firstByte != null ? (t.end - t.firstByte) / 1000 : null,
      fasterThanPlayback: t.seconds && t.end != null && t.firstByte != null && t.end > t.firstByte
        ? Math.round(t.seconds * 1000 / (t.end - t.firstByte) * 10) / 10 : null,
      listen: opusFile ? "/api/debug/squeeze?listen=" + t.n : null,
      lossless: file && t.format === "flac" && t.end != null && !t.failed ? "/api/debug/squeeze?listen=" + t.n + "&lossless=1" : null,
    });
  });
  return { ran: true, running: !s.stopped, endedBecause: s.endedBecause, name: s.name, host: s.host, caps: s.caps, lead: s.lead,
    early: s.early, speed: s.speed, startedAt: new Date(s.startedAt).toISOString(), until: new Date(s.until).toISOString(), connected: s.connected,
    everConnected: s.everConnected, reconnects: s.reconnects, lastError: s.lastError,
    playing: s.playing ? { track: s.playing.n, elapsedMs: elapsed(s.playing) } : null,
    counts: s.counts, tracks, logCut: s.logCut, log: s.log };
}

module.exports = { report, aheadOf };
