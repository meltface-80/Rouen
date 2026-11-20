// @ts-check
"use strict";
/*
 * drive-reads.js — the iBroadcast drive's read rule (2.0.6-t2, dev/design/ibroadcast.md §4.2): the owner, 2026-11-20,
 * "Users cannot be told to turn off audio analysis for this to function". So a read is answered by where it falls and
 * whether its track is wanted:
 *   - from the file's start to where its audio begins (a FLAC's metadata blocks, read from the file itself; an MP3's
 *     ID3v2 tag; another type's first megabyte), or in its last 256 KB: always — that is what Roon's import reads;
 *   - in its audio, for a track playing or queued in a zone (wanted()): always, and the file stays open to reads for
 *     half an hour after;
 *   - in the audio of any other track (Roon's background analysis): held up to eight seconds, in case Roon's news that
 *     it is playing comes after its first read, then refused. Nothing of it is downloaded.
 * What is answered comes from iBroadcast in 256 KB blocks, kept in memory (up to 256 MB) so a block read twice is
 * downloaded once. Every read is counted for the probe's report (§4.3).
 */

const BLOCK = 256 * 1024;
const TAIL = 256 * 1024;
/** Another type's start: its first megabyte. */
const OTHER_START = 1024 * 1024;
const KEEP_BYTES = 256 * 1024 * 1024;
const OPEN_MS = 30 * 60 * 1000;
const EVENTS = 300;
/** A read starting before the audio is answered to where the audio begins, or this much, whichever is further. */
const START_CAP = 128 * 1024;

/**
 * @typedef {import("./drive-tree").DriveFile} DriveFile
 * @typedef {"start" | "tail" | "audio"} Region
 * @typedef {{ path: string, size: number, start: number, tail: number, audio: number, refused: number, heldMs: number,
 *             downloaded: number, audioStart: number | null }} FileReport
 */

/** Where a FLAC's or an MP3's audio begins, from its first bytes; null where they don't say. @param {(off: number, len: number) => Promise<Buffer>} at */
async function audioStartOf(at) {
  const head = await at(0, 10);
  if (head.length >= 4 && head.toString("latin1", 0, 4) === "fLaC") {
    // The metadata blocks, each a 4-byte header (last-block flag, type, 24-bit length) and its body, to the last.
    let off = 4;
    for (let i = 0; i < 1000; i++) {
      const h = await at(off, 4);
      if (h.length < 4) return null;
      off += 4 + ((h[1] << 16) | (h[2] << 8) | h[3]);
      if (h[0] & 0x80) return off;
    }
    return null;
  }
  if (head.length >= 10 && head.toString("latin1", 0, 3) === "ID3") {
    // ID3v2: its size in four 7-bit bytes, after a 10-byte header, and a 10-byte footer when its flags say so.
    const size = (head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9];
    return 10 + size + (head[5] & 0x10 ? 10 : 0);
  }
  return null;
}

/**
 * @param {{ fetchRange: (f: DriveFile, start: number, end: number) => Promise<Buffer>, wanted: (f: DriveFile) => Promise<boolean> | boolean,
 *           now?: () => number, sleep?: (ms: number) => Promise<void>, holdMs?: number, pollMs?: number, log?: (line: string) => void }} o
 *   fetchRange: bytes start..end (inclusive) of the file's original, from iBroadcast
 *   wanted: whether the file's track is playing or queued in a zone now
 */
function createDriveReads(o) {
  const now = o.now || Date.now;
  const sleep = o.sleep || ((ms) => new Promise((r) => { setTimeout(r, ms); }));
  const holdMs = o.holdMs ?? 8000;
  const pollMs = o.pollMs ?? 500;
  const log = o.log || (() => {});
  /** Blocks kept, oldest first. @type {Map<string, Buffer>} */
  const blocks = new Map();
  let kept = 0;
  /** Blocks being downloaded: a second asker waits for the one. @type {Map<string, Promise<Buffer>>} */
  const fetching = new Map();
  /** Where each file's audio begins. @type {Map<string, Promise<number>>} */
  const audioStarts = new Map();
  /** Files open to reads of their audio, until when. @type {Map<string, number>} */
  const openUntil = new Map();
  /** @type {Map<string, FileReport>} */
  const files = new Map();
  /** @type {Array<{ at: number, path: string, start: number, length: number, region: Region, answer: string }>} */
  const events = [];
  let downloaded = 0;

  /** @param {DriveFile} f @returns {FileReport} */
  const reportOf = (f) => {
    let r = files.get(f.path);
    if (!r) {
      r = { path: f.path, size: f.track.size, start: 0, tail: 0, audio: 0, refused: 0, heldMs: 0, downloaded: 0, audioStart: null };
      files.set(f.path, r);
    }
    return r;
  };

  /** Block i of a file, downloaded once and kept. @param {DriveFile} f @param {number} i @returns {Promise<Buffer>} */
  function block(f, i) {
    const key = f.track.id + ":" + i;
    const have = blocks.get(key);
    if (have) { blocks.delete(key); blocks.set(key, have); return Promise.resolve(have); }
    let p = fetching.get(key);
    if (!p) {
      const start = i * BLOCK, end = Math.min(f.track.size, start + BLOCK) - 1;
      p = o.fetchRange(f, start, end).then((b) => {
        downloaded += b.length;
        reportOf(f).downloaded += b.length;
        blocks.set(key, b);
        kept += b.length;
        for (const [k, v] of blocks) { if (kept <= KEEP_BYTES) break; blocks.delete(k); kept -= v.length; }
        return b;
      }).finally(() => { fetching.delete(key); });
      fetching.set(key, p);
    }
    return p;
  }

  /** Bytes off..off+len-1 of a file (fewer at its end). @param {DriveFile} f @param {number} off @param {number} len */
  async function bytes(f, off, len) {
    const end = Math.min(f.track.size, off + len);
    /** @type {Buffer[]} */
    const parts = [];
    for (let at = off; at < end;) {
      const i = Math.floor(at / BLOCK);
      const b = await block(f, i);
      const from = at - i * BLOCK;
      const to = Math.min(b.length, end - i * BLOCK);
      if (to <= from) break;
      parts.push(b.subarray(from, to));
      at = i * BLOCK + to;
    }
    return Buffer.concat(parts);
  }

  /** Where a file's audio begins: its metadata's end, or its first megabyte; never past its end. @param {DriveFile} f */
  function audioStart(f) {
    let p = audioStarts.get(f.path);
    if (!p) {
      p = audioStartOf((off, len) => bytes(f, off, len))
        .then((n) => Math.min(f.track.size, n === null ? OTHER_START : n))
        .then((n) => { reportOf(f).audioStart = n; return n; });
      // A failure is the next read's to try again: not kept.
      p.catch(() => { audioStarts.delete(f.path); });
      audioStarts.set(f.path, p);
    }
    return p;
  }

  /** @param {DriveFile} f @param {number} start @param {number} length @param {Region} region @param {string} answer */
  function note(f, start, length, region, answer) {
    events.push({ at: now(), path: f.path, start, length, region, answer });
    if (events.length > EVENTS) events.shift();
  }

  /** Whether a track's audio may be read now: open already, or wanted, held a while for Roon's news. @param {DriveFile} f */
  async function mayRead(f) {
    const until = openUntil.get(f.path);
    if (until && until > now()) { openUntil.set(f.path, now() + OPEN_MS); return { ok: true, held: 0 }; }
    const t0 = now();
    for (;;) {
      if (await o.wanted(f)) { openUntil.set(f.path, now() + OPEN_MS); return { ok: true, held: now() - t0 }; }
      if (now() - t0 >= holdMs) return { ok: false, held: now() - t0 };
      await sleep(pollMs);
    }
  }

  return {
    /**
     * A read of bytes start..end (inclusive): its bytes, or refused.
     * @param {DriveFile} f @param {number} start @param {number} end
     * @returns {Promise<{ ok: true, body: Buffer, region: Region } | { ok: false, region: Region }>}
     */
    async read(f, start, end) {
      const size = f.track.size;
      end = Math.min(end, size - 1);
      const r = reportOf(f);
      /** @type {Region} */
      let region;
      const begins = await audioStart(f);
      if (start >= Math.max(0, size - TAIL)) region = "tail";
      else if (start < begins) region = "start";
      else region = "audio";
      // A long read from the start is answered to where the audio begins (or START_CAP), not through the audio: the rest
      // is the reader's to ask again, under the rule (rclone asks in 64 KB chunks, so this never shortens one of its).
      if (region === "start") end = Math.min(end, Math.max(begins - 1, start + START_CAP - 1));
      if (region === "audio") {
        const may = await mayRead(f);
        r.heldMs += may.held;
        if (!may.ok) {
          r.refused++;
          note(f, start, end - start + 1, region, "refused after " + Math.round(may.held / 100) / 10 + " s");
          log(`drive: refused ${f.path} at ${start} (not playing or queued)`);
          return { ok: false, region };
        }
      }
      const length = Math.max(0, end - start + 1);
      const body = await bytes(f, start, length);
      r[region] += body.length;
      note(f, start, length, region, "served");
      return { ok: true, body, region };
    },

    /** The probe's report: each file, the last reads, the totals. */
    report() {
      const list = [...files.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
      const sum = (/** @type {keyof FileReport} */ k) => list.reduce((n, x) => n + Number(x[k] || 0), 0);
      return {
        totals: { files: list.length, start: sum("start"), tail: sum("tail"), audio: sum("audio"), refused: sum("refused"),
          downloaded, kept },
        files: list,
        reads: events.slice().reverse(),
      };
    },
  };
}

module.exports = { createDriveReads, audioStartOf, BLOCK, TAIL, OTHER_START, OPEN_MS, START_CAP };
