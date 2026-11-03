// @ts-check
"use strict";
/*
 * tidal.js — a TIDAL track's waveform: which album and which track it is, its stream, and the decode of the
 * download. Self-contained on purpose: the sign-in, the favourites' album ids and the TIDAL client are handed in.
 * Moved out of index.js unchanged in v1.9.72-t61 (dev/quality.md, step 4).
 */
const WF = require("../waveform");
const AK = require("../albumkeys");
// Picking the right track out of a service's album, by title AND duration. Pure
// — see lib/trackmatch.js, which is where the rule about refusing to guess is.
const TM = require("../trackmatch");

/**
 * @param {import("./index").WaveDeps & { store: import("./index").WaveStore }} d
 */
function createTidalWaveforms(d) {
  const { WFD, tidal, albumKeys, canonArtist, tidalReady, tidalWithToken } = d;
  const { wfGet, wfPut, inflight: _wfInflight } = d.store;

  /* ---------------------------------------------------------------------------
   * TIDAL waveforms.
   *
   * Simpler than Qobuz in the one way that matters: TIDAL signs nothing. Its API
   * takes a Bearer token from the device sign-in this app already does, and that
   * sign-in REFRESHES ITSELF — so unlike Qobuz there is no credential to go stale
   * and nothing for the user to reconnect.
   *
   * Harder in one way: it does not hand back a URL. The playback call answers with
   * a base64 manifest, and only the plain "BTS" kind carries audio this can read.
   * Higher tiers arrive in a protected container and are refused outright — see
   * lib/tidal-manifest.js. That refusal is the correct answer, not a gap.
   * ------------------------------------------------------------------------ */

  /** The TIDAL album id for what Roon is playing, or null. */
  function wfTidalAlbumId(album, artist) {
    for (const k of albumKeys(album || "", artist || "")) {
      if (d.tidalAlbumIds().has(k)) return d.tidalAlbumIds().get(k);
    }
    // The title-only rung, for albums Roon names without a usable artist. Only
    // when the title lands on exactly one album in exactly one place — the same
    // discipline the Qobuz side uses, and for the same reason.
    if (canonArtist(artist || "")) return null;
    const titles = albumKeys(album || "", "").map(AK.titleOf).filter(Boolean);
    const found = AK.locateByTitle(titles, {
      local: d.localAlbumKeys(), qobuz: d.qobuzAlbumKeys(), tidal: d.tidalAlbumKeys(),
    });
    if (!found.confident || found.source !== "tidal") return null;
    return d.tidalAlbumIds().get(found.tidal[0]) || null;
  }

  async function wfTidalCompute(albumId, track, seconds, signal) {
    // The reason is dropped, as it was before the move (v1.9.72-t61 moved this unchanged): the line below says the
    // album could not be read and the track keeps the plain bar. Saying why is a change of behaviour, for its own build.
    const alb = await tidalWithToken((t, cc) => tidal.getAlbumTracks(t, cc, albumId))
      .catch(() => null);
    if (!alb) { console.log("[waveform] tidal: album " + albumId + " could not be read"); return null; }

    const m = TM.matchTrack(alb.tracks, track, seconds);
    if (!m.track) { console.log("[waveform] tidal: " + m.reason); return null; }

    const got = await tidalWithToken((t, cc) => tidal.getTrackStream(t, cc, m.track.id))
      .catch((e) => ({ url: null, reason: (e && e.message) || "playback request failed" }));
    if (!got || !got.url) {
      console.log("[waveform] tidal: no audio for \"" + track + "\" — " +
                  ((got && got.reason) || "unknown reason"));
      return null;
    }

    const t0 = Date.now();
    let peaks = null;
    try {
      const ctl = new AbortController();
      const poll = setInterval(() => { if (signal && signal.aborted) ctl.abort(); }, 500);
      if (poll.unref) poll.unref();
      let r;
      try { r = await fetch(got.url, { signal: ctl.signal }); }
      finally { clearInterval(poll); }
      if (!r.ok || !r.body) { console.log("[waveform] tidal: stream HTTP " + r.status); return null; }
      const input = require("node:stream").Readable.fromWeb(r.body);
      // As with Qobuz: a truncated download is indistinguishable from a short
      // track unless the length is stated, and the wrong shape would be stored.
      peaks = await WFD.decodeWaveform(null, { input, signal, expectSeconds: seconds || 0 });
    } catch (e) {
      console.log("[waveform] tidal: stream failed for \"" + track + "\": " + e.message);
      return null;
    }
    if (!peaks) {
      const why = WFD.lastDecodeError();
      console.log("[waveform] tidal: could not decode \"" + track + "\"" +
                  (why ? " (" + why + ")" : ""));
      return null;
    }
    console.log("[waveform] tidal: " + track + " in " + (Date.now() - t0) + "ms");
    return peaks;
  }

  const _wfTidalSaid = new Set();
  async function wfTidalTrack(album, artist, track, seconds) {
    if (!d.waveformEnabled() || !d.labelsDb()) return null;
    if (!tidalReady()) {
      if (!_wfTidalSaid.has("no-tidal")) {
        _wfTidalSaid.add("no-tidal");
        console.log("[waveform] tidal: a TIDAL album is playing and TIDAL is not connected. " +
                    "Settings → Audio Devices → Waveform (TIDAL waveforms).");
      }
      return null;
    }
    const albumId = wfTidalAlbumId(album, artist);
    if (!albumId) {
      if (!_wfTidalSaid.has("noid:" + album)) {
        _wfTidalSaid.add("noid:" + album);
        console.log("[waveform] tidal: no TIDAL album id for \"" + album + "\" by \"" +
                    (artist || "(none)") + "\" — " + d.tidalAlbumIds().size + " ids known" +
                    (d.tidalAlbumIds().size ? " (is it in your TIDAL FAVOURITES? playing from search is not enough)"
                                        : " (favourites not read yet)"));
      }
      return null;
    }

    const tkey = WF.trackKey("tidal:" + albumId, track);
    if (!tkey) return null;
    const have = wfGet(tkey);
    if (have) return { peaks: have.peaks, n: have.n, cached: true, source: "tidal" };

    const already = _wfInflight.get(tkey);
    if (already) {
      const p = await already;
      return p ? { peaks: p.peaks, n: p.n, cached: false, source: "tidal" } : null;
    }
    const job = (async () => {
      const peaks = await wfTidalCompute(albumId, track, seconds, null);
      if (!peaks) return null;
      wfPut(tkey, peaks);
      return { peaks: WF.encode(peaks), n: peaks.length };
    })().finally(() => { _wfInflight.delete(tkey); });
    _wfInflight.set(tkey, job);

    const out = await job;
    return out ? { peaks: out.peaks, n: out.n, cached: false, source: "tidal" } : null;
  }

  return { wfTidalAlbumId, wfTidalCompute, wfTidalTrack };
}

module.exports = { createTidalWaveforms };
