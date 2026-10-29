// @ts-check
"use strict";
/*
 * transcode.js — what Roon sent the probe player, made into what the phone gets away from home: Opus 256 kbps VBR,
 * 48 kHz, in Ogg, with Mandarin's arguments (Downloads.cs; dev/design/android-app.md §4.2, v1.9.72-t1).
 * Its time is measured, and ffmpeg's own count of the audio's length is read back, for a stream that doesn't say its
 * length itself.
 */
const fs = require("fs");

/** ffmpeg's raw PCM format for the stream's sample size and byte order. @param {number} bits @param {string} endian */
const pcmFormat = (bits, endian) => "s" + bits + (bits === 8 ? "" : endian === "0" ? "be" : "le");

/**
 * The arguments, Mandarin's: soxr resampling to 48 kHz, two channels, float, libopus at 256k VBR, Ogg.
 * @param {string} input  the received stream's file
 * @param {string} output  the .opus to write
 * @param {{ bits: number, rate: number, channels: number, endian: string } | null} pcm  raw PCM's shape; null when the
 *   stream says its own (FLAC, WAV)
 * @returns {string[]}
 */
function opusArgs(input, output, pcm) {
  const raw = pcm ? ["-f", pcmFormat(pcm.bits, pcm.endian), "-ar", String(pcm.rate), "-ac", String(pcm.channels)] : [];
  return ["-hide_banner", "-nostdin", "-loglevel", "info", "-stats", "-y", ...raw, "-i", input,
    "-map", "0:a:0", "-vn",
    "-af", "aresample=resampler=soxr:precision=33:internal_sample_fmt=dblp:osr=48000",
    "-ar", "48000", "-ac", "2", "-sample_fmt", "flt", "-map_metadata", "0",
    "-c:a", "libopus", "-b:a", "256k", "-vbr", "on", "-f", "ogg", output];
}

/** The last "time=HH:MM:SS.xx" ffmpeg printed, in seconds: the audio's length once it has read it all. @param {string} err */
function lastTime(err) {
  const all = [...err.matchAll(/time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/g)];
  const m = all[all.length - 1];
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/**
 * Make the Opus, timed.
 * @param {{ ffmpeg: string, spawn?: Function, now?: () => number }} deps
 * @param {string} input @param {string} output
 * @param {{ bits: number, rate: number, channels: number, endian: string } | null} pcm
 * @returns {Promise<{ ms: number, bytes: number | null, seconds: number | null, error: string | null }>}
 */
function toOpus(deps, input, output, pcm) {
  const spawn = deps.spawn || require("child_process").spawn;
  const now = deps.now || Date.now;
  const t0 = now();
  return new Promise((resolve) => {
    let err = "";
    let child;
    try {
      child = spawn(deps.ffmpeg, opusArgs(input, output, pcm), { stdio: ["ignore", "ignore", "pipe"] });
    } catch (e) {
      resolve({ ms: now() - t0, bytes: null, seconds: null, error: /** @type {Error} */ (e).message });
      return;
    }
    child.stderr.on("data", (/** @type {Buffer} */ d) => { err = (err + d.toString("latin1")).slice(-8192); });
    child.on("error", (/** @type {Error} */ e) => resolve({ ms: now() - t0, bytes: null, seconds: null, error: e.message }));
    child.on("close", (/** @type {number} */ code) => {
      let bytes = null;
      try { bytes = fs.statSync(output).size; } catch (e) { /* no file: the error below says why */ }
      const tail = err.trim().split(/[\r\n]+/).filter((l) => !/^size=|time=/.test(l)).slice(-3).join(" | ");
      resolve({ ms: now() - t0, bytes, seconds: lastTime(err), error: code === 0 ? null : "ffmpeg exited " + code + (tail ? ": " + tail : "") });
    });
  });
}

module.exports = { opusArgs, toOpus, lastTime, pcmFormat };
