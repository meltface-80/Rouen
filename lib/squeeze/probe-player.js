// @ts-check
"use strict";
/*
 * probe-player.js — the Squeezebox probe (dev/design/android-app.md §4.1 A and §6 step 1, v1.9.72-t1): Rouen joins
 * your Roon Core as one Squeezebox player, "Rouen probe", for a few minutes, and writes down everything Roon does with
 * it. You enable it in Roon (Settings → Audio) and play to it; it answers as a player would, plays nothing, and keeps
 * the last tracks it received, each made into Opus 256 too, to listen to in a browser.
 *
 * What it answers, for the design's choice between a Squeezebox player and Roon Bridge:
 *   - whether Roon takes the player at all, and what it asks of it (every message, in order);
 *   - what Roon sends: format, rate, bits, channels, and the HTTP response;
 *   - how fast: each track's length beside how long it took to arrive;
 *   - how far ahead: when the next track's command came, against when the current one ends (positive is ahead, which
 *     is what gapless playback and a cache away from home both need);
 *   - pause, seek, skip and volume as Roon sends them;
 *   - how long the Opus takes.
 *
 * Playback is pretended on the clock: a track "plays" from its start for its length, which is what the player reports
 * back to Roon (STMt every second, STMs as a track starts, STMd once a track's audio is all in, STMu after the last).
 * Roon's seek bar and history follow those reports, so they follow the pretence too.
 */
const net = require("net");
const fs = require("fs");
const path = require("path");
const P = require("./slimproto");
const { openStream } = require("./stream");
const { toOpus } = require("./transcode");

const PORT = 3483;
const MAC = Buffer.from([0x02, 0x52, 0x6f, 0x75, 0x65, 0x6e]);   // locally administered, "Rouen"
const NAME = "Rouen probe";
/** Tracks whose files are kept; older ones' files are deleted. */
const KEEP = 4;
/** A stream's file stops growing here (its bytes are still counted). */
const CAP = 600 * 1024 * 1024;
const MAX_LOG = 1500, MAX_RECONNECTS = 20, RECONNECT_MS = 3000, BEAT_MS = 1000, TICK_MS = 250;
const BUFFER = 2 * 1024 * 1024, OUTPUT = 3528000;

/**
 * @param {string} formats  "flc,pcm", "flc" or "pcm" @param {number} maxRate
 */
const capsOf = (formats, maxRate) => "Model=squeezelite,AccuratePlayPoints=1,HasDigitalOut=1,HasPolarityInversion=1," +
  "Firmware=v1.9.72-rouen,ModelName=Rouen,MaxSampleRate=" + maxRate + "," + formats;

/**
 * @typedef {object} ProbeDeps
 * @property {string} dir  where the received tracks are kept
 * @property {() => string} ffmpeg  the ffmpeg to run
 * @property {typeof net.connect} [connect]
 * @property {Function} [spawn]
 * @property {() => number} [now]
 * @property {{ setInterval: typeof setInterval, clearInterval: typeof clearInterval, setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout }} [timers]
 */

/** @param {ProbeDeps} deps */
function createProbePlayer(deps) {
  const now = deps.now || Date.now;
  const T = deps.timers || { setInterval, clearInterval, setTimeout, clearTimeout };
  const connect = deps.connect || net.connect;
  /** @type {any} */
  let s = null;   // the current run

  const at = () => now() - s.startedAt;
  /** @param {string} dir @param {string} op @param {object} [more] */
  function log(dir, op, more) {
    s.log.push(Object.assign({ t: at(), dir, op }, more || {}));
    if (s.log.length > MAX_LOG) { s.log.splice(0, s.log.length - MAX_LOG); s.logCut = true; }
  }
  /** @param {Buffer} b */
  function send(b) { if (s && s.sock && !s.sock.destroyed) s.sock.write(b); }
  /** @param {any} t */
  function elapsed(t) {
    if (!t || t.playAt == null) return 0;
    return now() - t.playAt - t.pausedMs - (t.pausedAt != null ? now() - t.pausedAt : 0);
  }
  /** @param {string} event @param {number} [serverTimestamp] */
  function status(event, serverTimestamp) {
    const t = s.playing, r = s.receiving[s.receiving.length - 1];
    const left = t && t.seconds ? Math.max(0, t.seconds * 1000 - elapsed(t)) : 0;
    send(P.stat(event, { bufferSize: BUFFER, bufferFull: 0, bytesReceived: r ? r.bytes : 0, jiffies: (now() - s.boot) >>> 0,
      outputSize: OUTPUT, outputFull: Math.min(OUTPUT, Math.round(left / 1000 * 176400)), elapsedMs: elapsed(t),
      serverTimestamp: serverTimestamp || 0 }));
    if (event === "STMt") s.counts.stmt++; else log("out", event, t ? { track: t.n } : {});
  }

  /** The track Roon expects to hear now ends at; null while its length isn't known. @param {any} t */
  function endsAt(t) {
    if (!t || t.playAt == null || !t.seconds) return null;
    return now() + (t.seconds * 1000 - elapsed(t));
  }

  /** @param {any} t */
  function startPlaying(t) {
    s.playing = t;
    t.playAt = now();
    t.playStart = at();
    s.waiting = s.waiting.filter((/** @type {any} */ x) => x !== t);
    status("STMs");
  }

  /** A stream's audio has reached its threshold: it plays, unless another is playing or it waits for "unpause". @param {any} t */
  function ready(t) {
    if (t.readyAt != null) return;
    t.readyAt = at();
    if (t.autostart === "0" || t.autostart === "2") { t.held = true; status("STMl"); return; }
    if (!s.playing) startPlaying(t);
  }

  /** Each quarter second: a track that has played its length ends, and the next starts, or the player runs dry. */
  function tick() {
    const t = s.playing;
    if (!t || t.pausedAt != null || !t.seconds || elapsed(t) < t.seconds * 1000) return;
    t.playEnd = at();
    s.playing = null;
    const next = s.waiting.find((/** @type {any} */ x) => x.readyAt != null && !x.held);
    if (next) { next.gapMs = at() - t.playEnd; startPlaying(next); return; }
    status("STMu");
  }

  /** Delete the files of tracks older than the last KEEP. */
  function prune() {
    for (const t of s.tracks.slice(0, -KEEP)) {
      for (const f of [t.file, t.opusFile]) if (f) fs.rm(f, { force: true }, () => { /* gone already is as good */ });
      t.file = t.opusFile = null;
    }
  }

  /** @param {any} st  the parsed strm */
  function start(st) {
    const run = s;
    const n = s.tracks.length + 1;
    const ext = st.format === "flac" ? "flac" : st.format === "pcm" ? "pcm" : "bin";
    const ahead = s.playing ? endsAt(s.playing) : null;
    /** @type {any} */
    const t = { n, at: at(), request: st.request.split("\r\n")[0], format: st.format, sampleRate: st.sampleRate,
      sampleSize: st.sampleSize, channels: st.channels, endian: st.endian, autostart: st.autostart, threshold: st.threshold,
      transition: { type: st.transitionType, seconds: st.transitionPeriod }, flags: st.flags,
      whilePlaying: s.playing ? s.playing.n : null, aheadOfEndMs: ahead == null ? null : ahead - now(),
      headers: null, bytes: 0, firstByte: null, end: null, error: null, flac: null, seconds: null, secondsFrom: null,
      readyAt: null, held: false, playAt: null, playStart: null, playEnd: null, pausedMs: 0, pausedAt: null, gapMs: null,
      opus: null, file: path.join(deps.dir, "track-" + n + "." + ext), opusFile: null };
    s.tracks.push(t);
    s.waiting.push(t);
    prune();
    status("STMc");
    const host = st.serverIp === "0.0.0.0" ? s.host : st.serverIp;
    t.stream = openStream({ connect }, { host, port: st.serverPort, request: st.request, file: t.file, cap: CAP,
      onHeaders(h) {
        if (s !== run) return;
        t.headers = h.split("\r\n").filter(Boolean).slice(0, 12);
        send(P.resp(h));
        log("out", "RESP", { track: n, status: t.headers[0] || "" });
      },
      onData(bytes, first) {
        if (s !== run) return;
        if (t.firstByte == null) t.firstByte = at();
        t.bytes = bytes;
        if (!t.flac && t.format === "flac" && first.length >= 42) {
          t.flac = P.flacInfo(first);
          if (t.flac && t.flac.seconds) { t.seconds = t.flac.seconds; t.secondsFrom = "FLAC header"; }
        }
        if (bytes >= t.threshold * 1024) ready(t);
      },
      onEnd(e) {
        if (s !== run) return;
        t.end = at();
        t.bytes = e.bytes;
        t.error = e.error;
        s.receiving = s.receiving.filter((/** @type {any} */ x) => x !== t);
        if (!s.tracks.includes(t) || t.stopped) return;
        if (!t.seconds && t.format === "pcm" && t.sampleRate && t.sampleSize && t.channels) {
          t.seconds = e.bytes / (t.sampleRate * t.channels * t.sampleSize / 8);
          t.secondsFrom = "PCM bytes";
        }
        ready(t);
        status("STMd");
        opus(t);
      } });
    s.receiving.push(t);
  }

  /** @param {any} t */
  async function opus(t) {
    if (!t.bytes || !t.file) return;
    const out = t.file.replace(/\.[a-z]+$/, ".opus");
    const pcm = t.format === "pcm" && t.sampleSize && t.sampleRate && t.channels
      ? { bits: t.sampleSize, rate: t.sampleRate, channels: t.channels, endian: t.endian } : null;
    const r = await toOpus({ ffmpeg: deps.ffmpeg(), spawn: deps.spawn, now }, t.file, out, pcm);
    t.opus = r;
    if (!r.error && t.file) t.opusFile = out;
    if (!t.seconds && r.seconds) { t.seconds = r.seconds; t.secondsFrom = "ffmpeg"; }
  }

  /** Stop every stream and forget what was to play: Roon's "stop" and "flush". */
  function flush() {
    for (const t of s.tracks) if (t.end == null) { t.stopped = true; t.stream.close(); }
    if (s.playing && s.playing.playEnd == null) s.playing.playEnd = at();
    s.playing = null;
    s.waiting = [];
    s.receiving = [];
  }

  /** @param {string} op @param {Buffer} data */
  function onMessage(op, data) {
    if (op === "strm") {
      let st;
      try { st = P.parseStrm(data); } catch (e) { log("in", op, { error: /** @type {Error} */ (e).message }); return; }
      if (st.command === "status") { s.counts.strmT++; status("STMt", st.replayGain); return; }
      const shown = Object.assign({}, st, { request: st.request.split("\r\n")[0] || "" });
      log("in", "strm", shown);
      const t = s.playing;
      if (st.command === "start") start(st);
      else if (st.command === "pause") {
        if (t && t.pausedAt == null) t.pausedAt = now();
        status("STMp");
        const run = s;
        if (st.replayGain) T.setTimeout(() => { if (s === run && !s.stopped) onMessage("strm", resumeAfter(data)); }, st.replayGain);
      } else if (st.command === "unpause") {
        if (t && t.pausedAt != null) { t.pausedMs += now() - t.pausedAt; t.pausedAt = null; }
        status("STMr");
        const held = s.waiting.find((/** @type {any} */ x) => x.held);
        if (held && !s.playing) { held.held = false; startPlaying(held); }
      } else if (st.command === "stop" || st.command === "flush") { flush(); status("STMf"); }
      return;
    }
    if (op === "audg") {
      const g = P.parseAudg(data);
      const key = JSON.stringify(g);
      if (key !== s.lastAudg) { s.lastAudg = key; log("in", op, { gain: g }); }
      return;
    }
    if (op === "setd") {
      log("in", op, { id: data[0], bytes: data.length });
      if (data.length === 1 && data[0] === 0) { send(P.setdName(NAME)); log("out", "SETD", { name: NAME }); }
      return;
    }
    if (op === "vers") { log("in", op, { version: data.toString("latin1") }); return; }
    s.counts.other[op] = (s.counts.other[op] || 0) + 1;
    if (s.counts.other[op] <= 3) log("in", op, { bytes: data.length, first: data.subarray(0, 16).toString("hex") });
  }

  /** A pause with a time, once it is over: the same message as an unpause. @param {Buffer} data */
  function resumeAfter(data) {
    const d = Buffer.from(data);
    d[0] = "u".charCodeAt(0);
    d.writeUInt32BE(0, 14);
    return d;
  }

  function open() {
    const sock = connect({ host: s.host, port: PORT });
    s.sock = sock;
    const reader = P.createReader();
    sock.on("connect", () => {
      s.connected = true;
      send(P.helo({ mac: MAC, caps: s.caps, reconnect: s.reconnects > 0 }));
      log("out", "HELO", { caps: s.caps, reconnect: s.reconnects > 0 });
    });
    sock.on("data", (/** @type {Buffer} */ chunk) => { for (const m of reader.push(chunk)) onMessage(m.op, m.data); });
    sock.on("error", (/** @type {Error} */ e) => { if (s && s.sock === sock) s.lastError = e.message; });
    sock.on("close", () => {
      if (!s || s.sock !== sock) return;
      s.connected = false;
      log("in", "closed", { error: s.lastError || null });
      if (s.stopped || s.reconnects >= MAX_RECONNECTS) return;
      s.reconnects++;
      s.retry = T.setTimeout(() => { if (s && !s.stopped && s.sock === sock) open(); }, RECONNECT_MS);
    });
  }

  const api = {
    /**
     * Join the Core for `minutes`; any earlier run ends first and its report is gone.
     * @param {{ host: string, minutes: number, formats: string, maxRate: number }} o
     */
    start(o) {
      api.stop("started again");
      fs.mkdirSync(deps.dir, { recursive: true });
      for (const f of fs.readdirSync(deps.dir)) if (/^track-\d+\./.test(f)) fs.rmSync(path.join(deps.dir, f), { force: true });
      s = { host: o.host, caps: capsOf(o.formats, o.maxRate), startedAt: now(), boot: now(), until: now() + o.minutes * 60000,
        log: [], logCut: false, tracks: [], waiting: [], receiving: [], playing: null, connected: false, reconnects: 0,
        counts: { stmt: 0, strmT: 0, other: {} }, lastAudg: "", stopped: false, endedBecause: null, lastError: null };
      s.beat = T.setInterval(() => { if (s.connected) status("STMt"); }, BEAT_MS);
      s.tick = T.setInterval(tick, TICK_MS);
      s.end = T.setTimeout(() => api.stop("its time was up"), o.minutes * 60000);
      open();
      return { started: true, name: NAME, host: o.host, until: new Date(s.until).toISOString() };
    },
    /** @param {string} why */
    stop(why) {
      if (!s || s.stopped) return;
      s.stopped = true;
      s.endedBecause = why;
      T.clearInterval(s.beat);
      T.clearInterval(s.tick);
      T.clearTimeout(s.end);
      if (s.retry) T.clearTimeout(s.retry);
      flush();
      if (s.sock) s.sock.destroy();
      s.connected = false;
    },
    /** What the run saw, so far or in all. */
    read() {
      if (!s) return { ran: false };
      const tracks = s.tracks.map((/** @type {any} */ t) => {
        const { file, opusFile } = t;
        /** @type {any} */
        const shown = Object.assign({}, t);
        for (const k of ["stream", "file", "opusFile", "pausedAt"]) delete shown[k];
        return Object.assign(shown, {
          stopped: !!t.stopped,
          receiveSeconds: t.end != null && t.firstByte != null ? (t.end - t.firstByte) / 1000 : null,
          fasterThanPlayback: t.seconds && t.end != null && t.firstByte != null && t.end > t.firstByte
            ? Math.round(t.seconds * 1000 / (t.end - t.firstByte) * 10) / 10 : null,
          listen: opusFile ? "/api/debug/squeeze?listen=" + t.n : null,
          lossless: file && t.format === "flac" && t.end != null ? "/api/debug/squeeze?listen=" + t.n + "&lossless=1" : null,
        });
      });
      return { ran: true, running: !s.stopped, endedBecause: s.endedBecause, name: NAME, host: s.host, caps: s.caps,
        startedAt: new Date(s.startedAt).toISOString(), until: new Date(s.until).toISOString(), connected: s.connected,
        reconnects: s.reconnects, lastError: s.lastError, playing: s.playing ? { track: s.playing.n, elapsedMs: elapsed(s.playing) } : null,
        counts: s.counts, tracks, logCut: s.logCut, log: s.log };
    },
    /** A kept track's file, to listen to: its Opus, or what Roon sent when it is FLAC. @param {number} n @param {boolean} lossless */
    file(n, lossless) {
      const t = s && s.tracks.find((/** @type {any} */ x) => x.n === n);
      if (!t) return null;
      if (lossless) return t.format === "flac" && t.end != null ? t.file : null;
      return t.opusFile;
    },
  };
  return api;
}

module.exports = { createProbePlayer, capsOf, NAME, PORT };
