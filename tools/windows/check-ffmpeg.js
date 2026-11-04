#!/usr/bin/env node
// @ts-check
"use strict";
/*
 * check-ffmpeg.js — the ffmpeg a build carries makes the phone's sound (v2.0.1-t2).
 *
 *   node tools/windows/check-ffmpeg.js [path to ffmpeg]
 *
 * Run by .github/workflows/windows.yml on the Windows runner, after the payload's ffmpeg is in place and before the
 * payload is packed; with no path, the ffmpeg Rouen itself would use (lib/waveform-decode.js ffmpegPath). It fails the
 * build unless:
 *   1. ffmpeg was built with soxr and libopus (its -buildconf), which the phone's Opus needs (lib/phone/session.js:
 *      Roon's sound resampled by soxr to 48 kHz, then libopus);
 *   2. a phone session, made by lib/phone/session.js itself, turns three seconds of FLAC into sound, in Opus and in
 *      lossless.
 *
 * Why: the Windows build carried ffmpeg-static's Windows ffmpeg, gyan.dev's 6.1.1 "essentials", built without soxr.
 * Every Opus session on Windows made nothing, silently, and the phone sat buffering (a Windows user, 2026-11-04:
 * lossless played, Opus 256 did not). The Docker image's ffmpeg (johnvansickle.com) has soxr, so it worked there.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createSession } = require("../../lib/phone/session");

/** What the phone's sound needs from ffmpeg's build. */
const NEEDS = ["--enable-libsoxr", "--enable-libopus"];
const SECONDS = 3;

/** @param {string} ffmpeg @returns {string[]} what is missing from its build */
function missingFromBuild(ffmpeg) {
  const r = spawnSync(ffmpeg, ["-hide_banner", "-buildconf"], { encoding: "utf8" });
  if (r.error || r.status !== 0) return ["a working ffmpeg (" + (r.error ? r.error.message : "exit " + r.status) + ")"];
  return NEEDS.filter((n) => !String(r.stdout).includes(n));
}

/** Three seconds of a 44.1 kHz, 16-bit stereo tone, as FLAC, as Roon sends it. @param {string} ffmpeg */
function flacTone(ffmpeg) {
  const r = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
    "sine=frequency=440:sample_rate=44100:duration=" + SECONDS, "-ac", "2", "-sample_fmt", "s16", "-c:a", "flac",
    "-f", "flac", "pipe:1"], { maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0 || !r.stdout || !r.stdout.length) {
    throw new Error("ffmpeg could not make the test FLAC: " + (r.error ? r.error.message : String(r.stderr || "").trim()));
  }
  return r.stdout;
}

/**
 * One phone session through the given ffmpeg: its sound's length in ms and the bytes made.
 * @param {string} ffmpeg @param {"opus" | "lossless"} quality @param {Buffer} flac
 * @returns {Promise<{ ms: number, bytes: number }>}
 */
function session(ffmpeg, quality, flac) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-ffmpeg-check-"));
  const file = path.join(dir, quality === "lossless" ? "s1.flac" : "s1.ogg");
  const s = createSession({ ffmpeg }, { n: 1, quality, file, rate: 44100, bits: 16 });
  const seg = s.add(() => { /* the whole tone is fed at once: nothing to resume */ });
  seg.feed(flac);
  seg.end();
  s.end();
  return new Promise((resolve, reject) => {
    const until = Date.now() + 60000;
    const look = () => {
      if (s.finished) {
        const row = s.timeline()[0];
        const out = { ms: row ? row.length : 0, bytes: s.bytes };
        // The session's file may still be closing (Windows refuses to remove an open file): removed a moment later.
        setTimeout(() => {
          try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* a temp folder left on the runner is harmless; the check's answer is already in */ }
        }, 1000);
        resolve(out);
        return;
      }
      if (Date.now() > until) { s.close(); reject(new Error(quality + ": the session did not finish in 60 s")); return; }
      setTimeout(look, 100);
    };
    look();
  });
}

/** @param {string} [given] @returns {Promise<string[]>} the failures, none when the ffmpeg makes the phone's sound */
async function check(given) {
  const ffmpeg = given || require("../../lib/waveform-decode").ffmpegPath();
  console.log("[ffmpeg] " + ffmpeg);
  const failures = missingFromBuild(ffmpeg).map((m) => "ffmpeg is built without " + m);
  if (failures.length) return failures;
  const flac = flacTone(ffmpeg);
  for (const quality of /** @type {const} */ (["opus", "lossless"])) {
    const r = await session(ffmpeg, quality, flac);
    console.log("[ffmpeg] " + quality + ": " + Math.round(r.ms) + " ms of sound, " + r.bytes + " bytes made");
    if (Math.abs(r.ms - SECONDS * 1000) > 100 || r.bytes < 1000) {
      failures.push(quality + ": a phone session made " + Math.round(r.ms) + " ms of sound and " + r.bytes +
        " bytes from " + SECONDS + " s of FLAC");
    }
  }
  return failures;
}

if (require.main === module) {
  check(process.argv[2]).then((failures) => {
    for (const f of failures) console.error("[ffmpeg] FAIL: " + f);
    if (failures.length) process.exit(1);
    console.log("[ffmpeg] it makes the phone's sound, in Opus and in lossless");
  }, (e) => { console.error("[ffmpeg] FAIL: " + e.message); process.exit(1); });
}

module.exports = { check, missingFromBuild, NEEDS };
