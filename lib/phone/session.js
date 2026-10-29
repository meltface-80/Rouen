// @ts-check
"use strict";
/*
 * session.js — one continuous stream to a phone, a "session" (dev/design/android-app.md §4.9, v1.9.72-t5): Roon's
 * streams, one after another, made into one Ogg Opus stream (256 kbps VBR, 48 kHz, the default) or one FLAC stream at
 * the source's rate (lossless, Mandarin's option), from Roon's first stream to its next stop.
 *
 * Each of Roon's streams is a segment: its FLAC is decoded by its own ffmpeg as it arrives (Opus: resampled by soxr to
 * 48 kHz float; lossless: at its own rate, 16 or 32-bit) and its sound fed, in order, into one encoder, so the session
 * has no gap where Roon's streams meet. A segment's place in the session (its start and length, in ms) comes from the
 * sound it decoded, which is what maps the phone's position back onto Roon's streams (player.js).
 *
 * The encoder's output is kept in a file, sent to the phone as it grows (pipeTo). A segment decoded ahead of its turn
 * waits: its ffmpeg is held, so it stops reading, so Roon's stream is held too.
 */
const fs = require("fs");

/** Opus's input: 48 kHz, stereo, 32-bit float. */
const OPUS_FRAME = 8, OPUS_RATE = 48000;

/** Sound's length in ms. @param {number} bytes @param {number} rate @param {number} frame */
const msOf = (bytes, rate, frame) => (bytes / frame / rate) * 1000;

/**
 * @typedef {object} SessionDeps
 * @property {string} ffmpeg
 * @property {Function} [spawn]
 * @property {typeof fs} [fs]
 */

/**
 * @param {SessionDeps} deps
 * @param {{ n: number, quality: "opus" | "lossless", file: string, rate?: number, bits?: number }} o
 *   rate and bits: lossless only, the source's (from its STREAMINFO)
 */
function createSession(deps, o) {
  const spawn = deps.spawn || require("child_process").spawn;
  const fsx = deps.fs || fs;
  const lossless = o.quality === "lossless";
  const rate = lossless ? (o.rate || 44100) : OPUS_RATE;
  const wide = lossless && (o.bits || 16) > 16;
  const frame = lossless ? (wide ? 8 : 4) : OPUS_FRAME;
  const pcm = lossless ? (wide ? "s32le" : "s16le") : "f32le";

  /** @type {Array<any>} */
  const segments = [];
  let active = 0, ended = false, closed = false, finished = false, written = 0, opened = false;
  /** @type {Array<() => void>} */
  let growers = [];
  const out = fsx.createWriteStream(o.file);
  out.on("error", () => { /* a full disk ends what can be sent; the phone's stream ends where the file does */ });
  // The file is opened in the background: a reader that came first waits for it (read before, it is not there yet,
  // and the read's ENOENT ended the reader with nothing: v1.9.72-t9).
  out.once("open", () => { opened = true; grew(); });

  const encArgs = lossless
    ? ["-hide_banner", "-nostdin", "-loglevel", "error", "-f", pcm, "-ar", String(rate), "-ac", "2", "-i", "pipe:0",
      "-c:a", "flac", "-sample_fmt", wide ? "s32" : "s16", ...(wide ? ["-bits_per_raw_sample", "24"] : []), "-f", "flac", "pipe:1"]
    : ["-hide_banner", "-nostdin", "-loglevel", "error", "-f", pcm, "-ar", String(OPUS_RATE), "-ac", "2", "-i", "pipe:0",
      "-c:a", "libopus", "-b:a", "256k", "-vbr", "on", "-f", "ogg", "pipe:1"];
  const enc = spawn(deps.ffmpeg, encArgs, { stdio: ["pipe", "pipe", "ignore"] });
  enc.on("error", () => { /* no ffmpeg: nothing is made; close() and the phone's empty stream say the rest */ });
  enc.stdin.on("error", () => { /* the encoder gone (closed, or failed): what was made stays sent */ });
  enc.stdout.on("data", (/** @type {Buffer} */ b) => { written += b.length; out.write(b); grew(); });
  enc.on("close", () => { finished = true; out.end(() => grew()); });

  function grew() { const g = growers; growers = []; for (const f of g) f(); }

  /** The decoder's arguments: Roon's FLAC in, the encoder's sound out. */
  const decArgs = () => (lossless
    ? ["-hide_banner", "-loglevel", "error", "-f", "flac", "-i", "pipe:0", "-ac", "2", "-f", pcm, "pipe:1"]
    : ["-hide_banner", "-loglevel", "error", "-f", "flac", "-i", "pipe:0",
      "-af", "aresample=resampler=soxr:precision=28:osr=" + OPUS_RATE, "-ac", "2", "-f", pcm, "pipe:1"]);

  /** The next segment's turn: its held sound flows into the encoder. */
  function next() {
    while (active < segments.length && segments[active].decoded) active++;
    if (active < segments.length) segments[active].dec.stdout.resume();
    else if (ended && !closed) enc.stdin.end();
  }

  const api = {
    get n() { return o.n; },
    get quality() { return o.quality; },
    get rate() { return rate; },
    get bits() { return lossless ? (wide ? 24 : 16) : null; },
    get closed() { return closed; },
    get finished() { return finished; },
    get bytes() { return written; },
    /**
     * A new segment (one of Roon's streams). feed() gives it Roon's FLAC; false means "hold the stream": onDrain says
     * when to go on.
     * @param {() => void} onDrain
     */
    add(onDrain) {
      const seg = { index: segments.length, pcm: 0, input: false, decoded: false, dec: /** @type {any} */ (null) };
      const dec = spawn(deps.ffmpeg, decArgs(), { stdio: ["pipe", "pipe", "ignore"] });
      seg.dec = dec;
      dec.on("error", () => { /* no ffmpeg: the segment decodes nothing, and the session goes on to the next */ });
      dec.stdin.on("error", () => { /* the decoder gone: what Roon still sends for it is dropped */ });
      dec.stdin.on("drain", onDrain);
      dec.stdout.on("data", (/** @type {Buffer} */ b) => {
        seg.pcm += b.length;
        if (closed) return;
        if (!enc.stdin.write(b)) { dec.stdout.pause(); enc.stdin.once("drain", () => dec.stdout.resume()); }
      });
      dec.on("close", () => { seg.decoded = true; next(); });
      if (segments.length > active) dec.stdout.pause();   // not its turn yet
      segments.push(seg);
      return {
        index: seg.index,
        /** @param {Buffer} chunk */
        feed: (chunk) => (closed ? true : dec.stdin.write(chunk)),
        end: () => { seg.input = true; dec.stdin.end(); },
      };
    },
    /** No more segments: the session ends when the last is in. */
    end() { ended = true; next(); },
    /** Stop everything; the file is the caller's to remove. */
    close() {
      if (closed) return;
      closed = true;
      for (const s of segments) if (!s.decoded) s.dec.kill("SIGKILL");
      enc.stdin.end();
      enc.kill("SIGKILL");
      grew();
    },
    /** Where each segment sits in the session, in ms, and whether all of it is known. */
    timeline() {
      let at = 0;
      return segments.map((s) => {
        const len = msOf(s.pcm, rate, frame);
        const row = { index: s.index, start: at, length: len, done: s.decoded };
        at += len;
        return row;
      });
    },
    /**
     * Send the session to a reader as it is made, from its start, until it is finished or the reader goes.
     * @param {{ write: (b: Buffer) => boolean, end: () => void, once: Function, on: Function }} res
     */
    pipeTo(res) {
      let sent = 0, gone = false, reading = false;
      res.on("close", () => { gone = true; });
      const pump = () => {
        if (gone || reading) return;
        if (!opened && !closed) { growers.push(pump); return; }
        if (sent < written) {
          reading = true;
          let got = 0;
          const r = fsx.createReadStream(o.file, { start: sent, end: written - 1 });
          r.on("data", (/** @type {Buffer} */ b) => {
            sent += b.length; got += b.length;
            if (!res.write(b)) { r.pause(); res.once("drain", () => r.resume()); }
          });
          r.on("error", () => { gone = true; res.end(); });
          // Nothing read: the file has not caught up with what was written to it yet; look again shortly.
          r.on("end", () => { reading = false; if (got) pump(); else setTimeout(pump, 100); });
          return;
        }
        if (finished || closed) { res.end(); return; }
        growers.push(pump);
      };
      pump();
    },
  };
  return api;
}

module.exports = { createSession, OPUS_RATE };
