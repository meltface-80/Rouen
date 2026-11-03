// @ts-check
"use strict";
/*
 * local.js — a local file's waveform, decoded on demand: one decode at a time, two askers sharing one, and the
 * next track warmed while this one plays; and the startup word on ffmpeg. Moved out of index.js unchanged in
 * v1.9.72-t61 (dev/quality.md, step 4). Which file a track is (wfAlbumKey, wfResolveFile) and the queue peek
 * stay in index.js and are handed in; a streamed next track is warmed through ./qobuz.js and ./tidal.js.
 */
const WF = require("../waveform");

/**
 * @param {import("./index").WaveDeps & { store: import("./index").WaveStore,
 *   wfQobuzTrack: import("./index").ServiceTrack, wfTidalTrack: import("./index").ServiceTrack }} d
 */
function createLocalWaveforms(d) {
  const { DEBUG, WFD, wfAlbumKey, wfResolveFile, peekQueueRaw, wfQobuzTrack, wfTidalTrack } = d;
  const { wfGet, wfPut, inflight: _wfInflight } = d.store;

  /*
   * Say once, at startup, whether ffmpeg is actually there.
   *
   * Every decode failure resolves to the same silent null, so an image built
   * without a working ffmpeg-static binary produced "the switch is on and
   * nothing is drawn" with not one line anywhere to explain it. One spawn of
   * `ffmpeg -version` at boot costs nothing and turns that into an answer in the
   * log — and names WHICH ffmpeg won, because "the npm one" and "whatever is on
   * PATH" fail in different ways.
   *
   * Unconditional, not gated on the setting: the setting can be switched on at
   * any time, and the line is worth having in the log from before that happens.
   */
  function announceFfmpeg() {
    WFD.ffmpegProbe().then(p => {
      if (p.ok) {
        console.log("[waveform] ffmpeg ready via " + p.source + (p.version ? " — " + p.version : ""));
      } else {
        console.error("[waveform] NO WORKING FFMPEG (" + p.source + "): " +
                      (p.error || "unknown") + " — no waveforms can be produced. " +
                      "GET /api/debug/waveform for the whole chain.");
      }
    }).catch(() => { /* the probe is diagnostics; it must never take startup down */ });
  }

  // One decode at a time, plus one queued prefetch. Decoding is the only CPU this
  // extension spends in bulk, and the box it runs on also has to serve the UI.
  let _wfBusy = null;          // tkey currently decoding
  let _wfPrefetch = null;      // { tkey, signal } the queued next-track decode
  // zoneId -> the track that was playing last time we looked. The zone push
  // arrives many times a second while a track plays (seek position alone), and
  // wfPeekNext costs a Core round trip, so nothing below it may run per-push.
  const _wfLastNp = new Map();

  function wfCompute(albumKey, track, signal, seconds) {
    const tkey = WF.trackKey(albumKey, track);
    if (!tkey) return Promise.resolve(null);
    const have = wfGet(tkey);
    if (have) return Promise.resolve(have);
    const already = _wfInflight.get(tkey);
    if (already) return already;
    const p = wfDecodeOnce(albumKey, track, tkey, signal, seconds)
      .finally(() => { _wfInflight.delete(tkey); });
    _wfInflight.set(tkey, p);
    return p;
  }

  async function wfDecodeOnce(albumKey, track, tkey, signal, seconds) {
    const file = await wfResolveFile(albumKey, track);
    if (!file) return null;
    const t0 = Date.now();
    // The track's length goes with the decode. A waveform is a map from time to a
    // picture, so a file that decodes two thirds of the way — a damaged rip, a
    // half-copied download — draws those two thirds across the WHOLE bar and puts
    // the playhead over the wrong moment. decodeWaveform refuses rather than
    // storing it; see MIN_COVERAGE.
    const peaks = await WFD.decodeWaveform(file, { signal, expectSeconds: seconds || 0 });
    if (!peaks) {
      const why = WFD.lastDecodeError();
      console.log("[waveform] no waveform for " + track + (why ? " (" + why + ")" : ""));
      return null;
    }
    wfPut(tkey, peaks);
    console.log("[waveform] " + track + " in " + (Date.now() - t0) + "ms");
    return { peaks: WF.encode(peaks), n: peaks.length };
  }

  /*
   * The next track, decoded while the current one plays.
   *
   * ONE ahead, never more. The queue reshuffles constantly — a skip, a new album,
   * Roon Radio picking something — so anything past the next item is CPU spent on
   * tracks that will not play. One ahead is the whole win anyway: it turns the
   * only visible wait (a cold track) into an instant one.
   *
   * The in-flight prefetch is cancelled rather than awaited when the queue moves,
   * because a 20-minute decode nobody wants any more is 20 minutes of a core the
   * playing track needs.
   */
  async function wfPeekNext(zoneId) {
    // [0] is what is playing; [1] is the one worth warming.
    const it = (await peekQueueRaw(zoneId, 2))[1];
    if (!it) return null;
    const t3 = it.three_line || {};
    return {
      track:  t3.line1 || (it.one_line && it.one_line.line1) || "",
      artist: t3.line2 || "",
      album:  t3.line3 || "",
      // The queue item carries its length, and the streaming path needs it: the
      // duration gate is the only thing separating this track from a remaster of
      // it with the same title.
      seconds: Number.isFinite(it.length) ? it.length : 0,
    };
  }

  async function wfPrefetchNext(zone) {
    if (!d.waveformEnabled() || !d.labelsDb()) return;
    const zid = zone && zone.zone_id;
    if (!zid) return;
    const nowTrack = (zone.now_playing && zone.now_playing.three_line &&
                      zone.now_playing.three_line.line1) ||
                     (zone.now_playing && zone.now_playing.line1) || "";
    if (!nowTrack || _wfLastNp.get(zid) === nowTrack) return;   // same track: nothing to do
    _wfLastNp.set(zid, nowTrack);
    const next = await wfPeekNext(zid);
    if (!next || !next.track) return;
    const akey = wfAlbumKey(next.album, next.artist);
    if (!akey) {
      // Not under /music. If it is a favourite on either service it can still be
      // warmed, and the wait it saves is larger here than for a local file: this
      // one has a download in front of the decode.
      wfQobuzTrack(next.album, next.artist, next.track, next.seconds || 0)
        .then((got) => got || wfTidalTrack(next.album, next.artist, next.track, next.seconds || 0))
        .catch(() => { /* best effort; the endpoint asks again on demand */ });
      return;
    }
    const tkey = WF.trackKey(akey, next.track);
    if (!tkey || tkey === _wfBusy) return;
    if (_wfPrefetch && _wfPrefetch.tkey === tkey) return;   // already queued
    if (wfGet(tkey)) return;                 // already known
    if (_wfPrefetch) _wfPrefetch.signal.aborted = true;
    const signal = { aborted: false };
    _wfPrefetch = { tkey, signal };
    wfCompute(akey, next.track, signal, next.seconds || 0)
      .catch(e => { if (DEBUG) console.error("[waveform] prefetch:", e.message); })
      .finally(() => { if (_wfPrefetch && _wfPrefetch.tkey === tkey) _wfPrefetch = null; });
  }

  // GET /api/waveform's "another track is decoding", and the switch turned off mid-decode (./routes.js).
  function wfBusy() { return _wfBusy; }
  /** @param {string | null} tkey */
  function setWfBusy(tkey) { _wfBusy = tkey; }
  function stopPrefetch() { if (_wfPrefetch) { _wfPrefetch.signal.aborted = true; _wfPrefetch = null; } }

  return { announceFfmpeg, wfCompute, wfPrefetchNext, wfBusy, setWfBusy, stopPrefetch };
}

module.exports = { createLocalWaveforms };
