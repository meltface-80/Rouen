// @ts-check
"use strict";
/*
 * store.js — the stored waveforms (the history database's `waveforms` table), the analysis stamp that wipes them
 * when the way they are measured changes, and the decodes in flight, which every path shares so that two askers
 * share one. Moved out of index.js unchanged in v1.9.72-t61 (dev/quality.md, step 4); ./index.js has the whole
 * picture.
 */
const WF = require("../waveform");

/**
 * @param {import("./index").WaveDeps} d
 */
function createWaveformStore(d) {
  const { DEBUG, WFD, persisted, savePersistedSettings } = d;

  function wfGet(tkey) {
    if (!d.labelsDb() || !tkey) return null;
    try {
      const row = d.labelsDb().prepare("SELECT peaks, n FROM waveforms WHERE tkey = ?").get(tkey);
      return row ? { peaks: row.peaks, n: row.n } : null;
    } catch (e) { return null; }   // a read failure is "no waveform", not an outage
  }
  /*
   * Throw away every stored waveform when the ANALYSIS changes.
   *
   * A waveform is only comparable with others taken the same way, and there are
   * three ways "the same way" can move:
   *
   *   the decode RATE — 16 kHz lowpasses at 8 kHz and loses the top of every
   *     cymbal; 44.1 kHz keeps it, and the two draw visibly different shapes for
   *     the same audio
   *   the CHANNEL COUNT — a mono downmix is an addition, so an out-of-phase
   *     passage reads as silence where both channels read as full scale
   *   the STATISTIC (WF.WAVE_GEN) — the loudest sample in a slice and the RMS of
   *     that slice are different numbers about the same audio, and the first one
   *     draws a brick
   *
   * None of those is visible on screen, and a stored row is never re-decoded, so
   * a library holding two generations would draw two kinds of picture with
   * nothing to say which is which — worse than either on its own, because the
   * inconsistency is invisible and unexplainable.
   *
   * So the whole stamp is recorded next to the data, and any change to it wipes
   * the table. That costs a re-analysis: local files are re-read from disk, and
   * streamed tracks are fetched again the next time they play. Both are the
   * ordinary first-play cost, paid once.
   */
  function wfAnalysisStamp() {
    return WF.WAVE_GEN + ":" + WFD.DECODE_RATE + ":" + WFD.DECODE_CHANNELS;
  }

  function wfCheckAnalysis() {
    if (!d.labelsDb()) return;
    const want = wfAnalysisStamp();
    // A missing key is a mismatch on purpose: it is either a fresh install (the
    // table is empty, so the wipe is free) or an upgrade from a version that
    // recorded only the rate — whose rows were measured with the old statistic
    // and have to go regardless of what that rate was.
    const had = String(persisted.waveformAnalysis || "");
    if (had === want) return;
    try {
      const n = d.labelsDb().prepare("SELECT COUNT(*) c FROM waveforms").get().c;
      if (n) {
        d.labelsDb().prepare("DELETE FROM waveforms").run();
        console.log("[waveform] analysis " + (had || "unset") + " → " + want +
                    " (gen:rate:channels): cleared " + n + " stored waveform" +
                    (n === 1 ? "" : "s") + ", they will be re-analysed on next play");
      }
      // waveformRate is the key this replaced. Set to undefined rather than
      // left behind: JSON.stringify omits an undefined value, so the old key
      // goes out of settings.json instead of sitting there meaning nothing.
      savePersistedSettings({ waveformAnalysis: want, waveformRate: undefined });
    } catch (e) {
      // A failure here means the table is unreadable, which the next wfGet will
      // report anyway. Not fatal: the feature degrades to the plain bar rather
      // than taking startup with it.
      console.error("[waveform] could not clear waveforms for the analysis change:", e.message);
    }
  }

  function wfPut(tkey, u8) {
    if (!d.labelsDb() || !tkey || !u8 || !u8.length) return;
    try {
      d.labelsDb().prepare(
        "INSERT OR REPLACE INTO waveforms (tkey, peaks, n, ts) VALUES (?, ?, ?, ?)"
      ).run(tkey, WF.encode(u8), u8.length, Date.now());
    } catch (e) {
      if (DEBUG) console.error("[waveform] store failed:", e.message);
    }
  }

  // tkey -> the in-flight wfCompute for it, so two askers share one decode. This
  // is the normal case here, not a corner: a phone and the wall display pointed
  // at the same zone both request the track that just started, within a second of
  // each other. Without this the second one either spawns a duplicate ffmpeg for
  // the same file or is told "busy" about a decode of the very thing it wants.
  const _wfInflight = new Map();

  return { wfGet, wfPut, wfAnalysisStamp, wfCheckAnalysis, inflight: _wfInflight };
}

module.exports = { createWaveformStore };
