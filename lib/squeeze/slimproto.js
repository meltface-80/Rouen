// @ts-check
"use strict";
/*
 * slimproto.js — the Squeezebox player protocol (SlimProto) as Rouen speaks it to Roon: the messages a player sends,
 * and the server's messages read (dev/design/android-app.md §4.1 A, v1.9.72-t1). Bytes only: no socket, no timer.
 *
 * Player → server: a 4-byte opcode, a 4-byte big-endian length, the payload.
 * Server → player: a 2-byte big-endian length (of what follows), a 4-byte opcode, the payload.
 * The layouts are Squeezelite's (slimproto.h) and Lyrion's (Slim/Networking/Slimproto.pm), which agree:
 *   HELO   device id, revision, MAC (6), UUID (16), WLAN channel list (2), bytes received (8), language (2), then the
 *          capabilities as text ("Model=…,MaxSampleRate=…,flc,pcm").
 *   STAT   an event (4 letters: STMt the heartbeat, STMs track started, STMd decoder done, STMu underrun, …) and the
 *          player's counters, 53 bytes in all.
 *   strm   the server's stream command: 24 bytes of fields, then the HTTP request to send for the audio, verbatim.
 */

/** Squeezelite's device id: Roon treats the player as a software Squeezebox. */
const DEVICE_ID = 12;

/** strm's PCM sample rate, by its character's place after "0" (Squeezelite's sample_rates[]). */
const RATES = [11025, 22050, 32000, 44100, 48000, 8000, 12000, 16000, 24000, 96000, 88200, 176400, 192000, 352800,
  384000, 705600, 768000];
/** strm's PCM sample size, by its character's place after "0". */
const SIZES = [8, 16, 24, 32];
/** strm's format byte, as a word. */
const FORMATS = /** @type {Record<string, string>} */ ({ f: "flac", p: "pcm", m: "mp3", o: "ogg", a: "aac", w: "wma",
  l: "alac", d: "dsd", u: "opus" });
/** strm's command byte, as a word. */
const COMMANDS = /** @type {Record<string, string>} */ ({ s: "start", p: "pause", u: "unpause", q: "stop", t: "status",
  f: "flush", a: "skip" });

/**
 * One player → server message.
 * @param {string} op  4 ASCII letters
 * @param {Buffer} payload
 * @returns {Buffer}
 */
function frame(op, payload) {
  const head = Buffer.alloc(8);
  head.write(op, 0, 4, "latin1");
  head.writeUInt32BE(payload.length, 4);
  return Buffer.concat([head, payload]);
}

/** @param {number | undefined} n */
const u32 = (n) => (Math.max(0, Math.floor(n || 0)) >>> 0);

/**
 * HELO: the player says who it is.
 * @param {{ mac: Buffer, caps: string, reconnect?: boolean, bytesReceived?: number }} o
 * @returns {Buffer}
 */
function helo(o) {
  if (!Buffer.isBuffer(o.mac) || o.mac.length !== 6) throw new Error("a MAC is 6 bytes");
  const p = Buffer.alloc(36);
  p.writeUInt8(DEVICE_ID, 0);
  p.writeUInt8(0, 1);                                   // revision
  o.mac.copy(p, 2);
  // 8..23: the UUID, zeros (Squeezelite sends none either).
  p.writeUInt16BE(o.reconnect ? 0x4000 : 0, 24);        // WLAN channel list; 0x4000 says "reconnecting"
  writeU64(p, 26, o.bytesReceived || 0);
  p.write("en", 34, 2, "latin1");
  return frame("HELO", Buffer.concat([p, Buffer.from(o.caps, "latin1")]));
}

/**
 * @typedef {object} Counters  what a STAT carries beside its event
 * @property {number} [bufferSize]  the stream buffer's size, bytes
 * @property {number} [bufferFull]  how much of it is used
 * @property {number} [bytesReceived]  of the current stream
 * @property {number} [jiffies]  the player's clock, ms
 * @property {number} [outputSize]  the output buffer's size, bytes
 * @property {number} [outputFull]  how much of it is used
 * @property {number} [elapsedMs]  how far into the track the player is
 * @property {number} [serverTimestamp]  echoed from the strm "t" that asked
 * @property {number} [error]
 */

/**
 * STAT: an event and the player's counters.
 * @param {string} event  4 ASCII letters
 * @param {Counters} c
 * @returns {Buffer}
 */
function stat(event, c) {
  const p = Buffer.alloc(53);
  p.write(event, 0, 4, "latin1");
  // 4: num_crlf, 5: mas_initialized, 6: mas_mode — 0.
  p.writeUInt32BE(u32(c.bufferSize), 7);
  p.writeUInt32BE(u32(c.bufferFull), 11);
  writeU64(p, 15, c.bytesReceived || 0);
  p.writeUInt16BE(0xffff, 23);                          // signal strength: wired
  p.writeUInt32BE(u32(c.jiffies), 25);
  p.writeUInt32BE(u32(c.outputSize), 29);
  p.writeUInt32BE(u32(c.outputFull), 33);
  const ms = Math.max(0, Math.floor(c.elapsedMs || 0));
  p.writeUInt32BE(u32(Math.floor(ms / 1000)), 37);
  p.writeUInt16BE(0, 41);                               // voltage
  p.writeUInt32BE(u32(ms), 43);
  p.writeUInt32BE(u32(c.serverTimestamp), 47);
  p.writeUInt16BE(c.error || 0, 51);
  return frame("STAT", p);
}

/**
 * RESP: the audio's HTTP response headers, handed back to the server.
 * @param {string} headers
 */
const resp = (headers) => frame("RESP", Buffer.from(headers, "latin1"));

/**
 * SETD: the player's name, answering the server's ask (setd id 0).
 * @param {string} name
 */
const setdName = (name) => frame("SETD", Buffer.concat([Buffer.from([0]), Buffer.from(name + "\0", "utf8")]));

/** @param {Buffer} b @param {number} at @param {number} n */
function writeU64(b, at, n) {
  const v = Math.max(0, Math.floor(n));
  b.writeUInt32BE(Math.floor(v / 0x100000000) >>> 0, at);
  b.writeUInt32BE(v % 0x100000000, at + 4);
}

/**
 * Server → player messages, read from a byte stream that arrives in pieces.
 * @returns {{ push: (chunk: Buffer) => Array<{ op: string, data: Buffer }> }}
 */
function createReader() {
  /** @type {Buffer} */
  let held = Buffer.alloc(0);
  return {
    push(chunk) {
      held = held.length ? Buffer.concat([held, chunk]) : chunk;
      const out = [];
      while (held.length >= 2) {
        const len = held.readUInt16BE(0);
        if (held.length < 2 + len) break;
        if (len >= 4) out.push({ op: held.toString("latin1", 2, 6), data: held.subarray(6, 2 + len) });
        held = held.subarray(2 + len);
      }
      return out;
    },
  };
}

/**
 * @typedef {object} Strm
 * @property {string} command  start, pause, unpause, stop, status, flush, skip — or the byte itself
 * @property {string} autostart  "0" wait for unpause, "1" start, "2"/"3" the same for a direct stream
 * @property {string} format  flac, pcm, … — or the byte itself
 * @property {number | null} sampleSize  PCM only; null when the stream says it itself ("?")
 * @property {number | null} sampleRate
 * @property {number | null} channels
 * @property {string} endian  "0" big, "1" little, "?" in the stream
 * @property {number} threshold  KB to buffer before starting
 * @property {number} transitionPeriod  seconds
 * @property {string} transitionType  "0" none, "1" crossfade, …
 * @property {number} flags
 * @property {number} outputThreshold  tenths of a second
 * @property {number} replayGain  16.16; for "t" the server's timestamp, for "p"/"u" a time
 * @property {number} serverPort
 * @property {string} serverIp  dotted; "0.0.0.0" means the server's own address
 * @property {string} request  the HTTP request to send, verbatim
 */

/**
 * @param {Buffer} d  strm's payload
 * @returns {Strm}
 */
function parseStrm(d) {
  if (d.length < 24) throw new Error("strm is at least 24 bytes, this one " + d.length);
  const ch = (/** @type {number} */ i) => String.fromCharCode(d[i]);
  // "?" is the stream saying it itself, never a place in the table (its code would read as 705600 Hz).
  const pick = (/** @type {number[]} */ list, /** @type {string} */ c) => {
    if (c === "?") return null;
    const n = c.charCodeAt(0) - 48;
    return n >= 0 && n < list.length ? list[n] : null;
  };
  return {
    command: COMMANDS[ch(0)] || ch(0),
    autostart: ch(1),
    format: FORMATS[ch(2)] || ch(2),
    sampleSize: pick(SIZES, ch(3)),
    sampleRate: pick(RATES, ch(4)),
    channels: ch(5) === "1" ? 1 : ch(5) === "2" ? 2 : null,
    endian: ch(6),
    threshold: d[7],
    transitionPeriod: d[9],
    transitionType: ch(10),
    flags: d[11],
    outputThreshold: d[12],
    replayGain: d.readUInt32BE(14),
    serverPort: d.readUInt16BE(18),
    serverIp: [d[20], d[21], d[22], d[23]].join("."),
    request: d.toString("latin1", 24),
  };
}

/**
 * audg: the volume Roon sets on the player (16.16 fixed point; 0x10000 is unity).
 * @param {Buffer} d
 * @returns {{ left: number, right: number, adjust: boolean } | null}
 */
function parseAudg(d) {
  if (d.length < 18) return null;
  return { adjust: d[8] !== 0, left: d.readUInt32BE(10) / 65536, right: d.readUInt32BE(14) / 65536 };
}

/**
 * A FLAC stream's own length, from its STREAMINFO block: null until there is enough, or when it doesn't say
 * (a stream encoded on the fly may give 0 samples).
 * @param {Buffer} head  the stream's first bytes
 * @returns {{ rate: number, channels: number, bits: number, seconds: number | null } | null}
 */
function flacInfo(head) {
  if (head.length < 42 || head.toString("latin1", 0, 4) !== "fLaC" || (head[4] & 0x7f) !== 0) return null;
  const s = head.subarray(8, 42);
  const rate = (s[10] << 12) | (s[11] << 4) | (s[12] >> 4);
  const channels = ((s[12] >> 1) & 7) + 1;
  const bits = (((s[12] & 1) << 4) | (s[13] >> 4)) + 1;
  const samples = (s[13] & 0x0f) * 0x100000000 + s.readUInt32BE(14);
  return { rate, channels, bits, seconds: rate && samples ? samples / rate : null };
}

module.exports = { frame, helo, stat, resp, setdName, createReader, parseStrm, parseAudg, flacInfo, RATES, SIZES };
