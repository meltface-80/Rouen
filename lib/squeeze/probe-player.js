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
 * Roon's seek bar and history follow those reports, so they follow the pretence too. A stream with no audio (refused,
 * an error status, empty) is said as a decoder would say it (STMn), never as a track played; every stream's end is
 * said with DSCO and its reason.
 */
const net = require("net");
const fs = require("fs");
const path = require("path");
const P = require("./slimproto");
const { openStream } = require("./stream");
const { toOpus, measure } = require("./transcode");

const PORT = 3483;
const MAC = Buffer.from([0x02, 0x52, 0x6f, 0x75, 0x65, 0x6e]);   // locally administered, "Rouen"
const NAME = "Rouen probe";
/** Tracks whose files are kept; older ones' files are deleted. */
const KEEP = 4;
/** A stream's file stops growing here (its bytes are still counted): five files at most (four kept, one arriving). */
const CAP = 150 * 1024 * 1024;
const MAX_LOG = 1500, RECONNECT_MS = 3000, BEAT_MS = 1000, TICK_MS = 250;
/** Squeezelite's: a server silent this long is gone, and the player connects again. */
const SILENT_MS = 35000;
/** A stream with no new bytes this long, still open, has stalled: what it has is measured once. */
const STALL_MS = 5000;
/** Bytes over time, a point a second while they move, at most this many a track. */
const MAX_FLOW = 900;
const BUFFER = 2 * 1024 * 1024, OUTPUT = 3528000;

/**
 * @param {string} formats  "flc,pcm", "flc" or "pcm" @param {number} maxRate
 */
const capsOf = (formats, maxRate) => "Model=squeezelite,AccuratePlayPoints=1,HasDigitalOut=1,HasPolarityInversion=1," +
  "Firmware=v1.9.72-rouen,ModelName=Rouen,MaxSampleRate=" + maxRate + "," + formats;

/** Raw PCM's shape, for ffmpeg; null when the stream says its own. @param {any} t */
const pcmOf = (t) => (t.format === "pcm" && t.sampleSize && t.sampleRate && t.channels
  ? { bits: t.sampleSize, rate: t.sampleRate, channels: t.channels, endian: t.endian } : null);

/** An HTTP status line's code, or null. @param {string | undefined} line */
const statusOf = (line) => { const m = /^HTTP\/\d(?:\.\d)? (\d{3})/.exec(line || ""); return m ? m[1] : null; };

/**
 * @typedef {object} ProbeDeps
 * @property {string} dir  where the received tracks are kept
 * @property {() => string} ffmpeg  the ffmpeg to run
 * @property {typeof net.connect} [connect]
 * @property {Function} [spawn]
 * @property {() => number} [now]
 * @property {number} [reconnectMs]  between tries to reach the Core (3 s)
 * @property {number} [stallMs]  an open stream with no new bytes this long has stalled (5 s)
 * @property {(name: string) => any} [nowPlaying]  what Roon's own zone for the player shows: title, length, seek
 *   (probe-route.js nowPlayingOf, over the official API's zones)
 * @property {{ setInterval: typeof setInterval, clearInterval: typeof clearInterval, setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout }} [timers]
 */

/** @param {ProbeDeps} deps */
function createProbePlayer(deps) {
  const now = deps.now || Date.now;
  const T = deps.timers || { setInterval, clearInterval, setTimeout, clearTimeout };
  const connect = deps.connect || net.connect;
  const reconnectMs = deps.reconnectMs || RECONNECT_MS;
  const stallMs = deps.stallMs || STALL_MS;
  /** @type {any} */
  let s = null;   // the current run

  const at = () => now() - s.startedAt;
  /** @param {string} dir @param {string} op @param {object} [more] */
  function log(dir, op, more) {
    s.log.push(Object.assign({ t: at(), dir, op }, more || {}));
    if (s.log.length > MAX_LOG) { s.log.splice(0, s.log.length - MAX_LOG); s.logCut = true; }
  }
  /** Sent when connected; false when it could not be. @param {Buffer} b */
  function send(b) {
    if (!s || !s.connected || !s.sock || s.sock.destroyed) return false;
    s.sock.write(b);
    return true;
  }
  /** @param {any} t */
  function elapsed(t) {
    if (!t || t.playAt == null) return 0;
    return now() - t.playAt - t.pausedMs - (t.pausedAt != null ? now() - t.pausedAt : 0);
  }
  /** @param {string} event @param {number} [serverTimestamp] */
  function status(event, serverTimestamp) {
    const t = s.playing;
    const left = t && t.seconds ? Math.max(0, t.seconds * 1000 - elapsed(t)) : 0;
    // Bytes received are the latest stream's, kept after it ends until the next starts or a stop (as Squeezelite's).
    const sent = send(P.stat(event, { bufferSize: BUFFER, bufferFull: 0, bytesReceived: s.lastBytes, jiffies: (now() - s.boot) >>> 0,
      outputSize: OUTPUT, outputFull: Math.min(OUTPUT, Math.round(left / 1000 * 176400)), elapsedMs: elapsed(t),
      serverTimestamp: serverTimestamp || 0 }));
    if (event === "STMt") { if (sent) s.counts.stmt++; return; }
    log(sent ? "out" : "unsent", event, t ? { track: t.n } : {});
  }

  /**
   * How long before the track playing when a command came was due to end: positive is ahead. Worked out when read, as
   * a stream that doesn't say its length is only measured after its audio is in, which is when Roon sends the next.
   * @param {any} t
   */
  function aheadOf(t) {
    const prev = t.whilePlaying != null && s.tracks.find((/** @type {any} */ x) => x.n === t.whilePlaying);
    if (!prev || prev.playAt == null || !prev.seconds) return null;
    return Math.round(prev.playAt + prev.seconds * 1000 + t.prevPausedMs - t.atAbs);
  }

  /** @param {any} t */
  function startPlaying(t) {
    s.playing = t;
    t.playAt = now();
    t.playStart = at();
    s.waiting = s.waiting.filter((/** @type {any} */ x) => x !== t);
    status("STMs");
    // What Roon shows for it, once Roon has had the STMs: its title says which track a stream begins with. Its length
    // is that track's alone: a stream may carry two (the t2 runs), so it is never taken as the stream's.
    const run = s;
    T.setTimeout(() => { if (s === run && s.playing === t) roonSaw(t, "atStart"); }, 1500);
  }

  /** @param {any} t @param {string} when */
  function roonSaw(t, when) {
    const np = deps.nowPlaying ? deps.nowPlaying(s.name) : null;
    t.roon = t.roon || {};
    t.roon[when] = np;
  }

  /** A stream's audio has reached its threshold: it plays, unless another is playing or it waits for "unpause". @param {any} t */
  function ready(t) {
    if (t.readyAt != null) return;
    t.readyAt = at();
    if (t.autostart === "0" || t.autostart === "2") { t.held = true; status("STMl"); return; }
    if (!s.playing) startPlaying(t);
  }

  /**
   * Decoder done (STMd), held back until the audio left to play is under the run's lead (v1.9.72-t3): a real player
   * reads Roon's stream a few seconds ahead and says it then; said as the stream closes (t1, t2), Roon took it for the
   * first of the stream's two tracks and sent the next stream only once the player ran dry.
   * @param {any} t
   */
  function decoderDone(t) {
    t.decoderPending = false;
    t.decoderDoneAt = at();
    t.decoderLeftMs = t.seconds ? Math.round(t.seconds * 1000 - elapsed(t)) : null;
    status("STMd");
  }

  /** Each quarter second: a track that has played its length ends, and the next starts, or the player runs dry. */
  function tick() {
    const t = s.playing;
    if (!t || t.pausedAt != null || !t.seconds) return;
    if (t.decoderPending && t.seconds * 1000 - elapsed(t) <= s.lead * 1000) decoderDone(t);
    if (elapsed(t) < t.seconds * 1000) return;
    if (t.decoderPending) decoderDone(t);
    t.playEnd = at();
    roonSaw(t, "atEnd");
    s.playing = null;
    const next = s.waiting.find((/** @type {any} */ x) => x.readyAt != null && !x.held);
    if (next) { next.gapMs = at() - t.playEnd; startPlaying(next); return; }
    status("STMu");
  }

  /** Each second: each open stream's bytes, while they move; a stream stalled with bytes is measured once. */
  function flowTick() {
    for (const t of s.receiving) {
      const last = t.flow[t.flow.length - 1];
      if ((!last || last[1] !== t.bytes) && t.flow.length < MAX_FLOW) t.flow.push([at(), t.bytes]);
      if (!t.stalled && t.bytes && t.lastByteAt != null && at() - t.lastByteAt >= stallMs) {
        t.stalled = { at: at(), bytes: t.bytes, sinceMs: at() - t.lastByteAt, playedMs: s.playing === t ? elapsed(t) : null };
        log("note", "stream stalled", { track: t.n, bytes: t.bytes });
        received(t, "stalled");
      }
    }
  }

  /**
   * How much audio a stream had brought, by decoding its file so far: beside how far the track had played, that is
   * how far ahead Roon sent it.
   * @param {any} t @param {string} why
   */
  async function received(t, why) {
    if (!t.file || !t.bytes) return;
    const run = s, playedMs = s.playing === t ? elapsed(t) : null;
    const m = await measure({ ffmpeg: deps.ffmpeg(), spawn: deps.spawn, now }, t.file, pcmOf(t));
    if (s !== run) return;
    t.audio = t.audio || {};
    t.audio[why] = { seconds: m.seconds, bytes: t.bytes, playedSeconds: playedMs == null ? null : playedMs / 1000,
      aheadSeconds: m.seconds != null && playedMs != null ? Math.round((m.seconds - playedMs / 1000) * 10) / 10 : null,
      error: m.error };
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
    // A new stream ends one still arriving (Squeezelite's too): what it had stays, and it is said to be cut off.
    for (const old of s.receiving) { old.stopped = "cut off by the next stream"; old.stream.close(); }
    s.receiving = [];
    s.lastBytes = 0;
    const p = s.playing;
    /** @type {any} */
    const t = { n, at: at(), atAbs: now(), request: st.request.split("\r\n")[0], format: st.format, sampleRate: st.sampleRate,
      sampleSize: st.sampleSize, channels: st.channels, endian: st.endian, autostart: st.autostart, threshold: st.threshold,
      transition: { type: st.transitionType, seconds: st.transitionPeriod }, flags: st.flags,
      whilePlaying: p ? p.n : null, prevPausedMs: p ? p.pausedMs + (p.pausedAt != null ? now() - p.pausedAt : 0) : 0,
      headers: null, bytes: 0, firstByte: null, end: null, error: null, failed: null, stopped: null, flac: null,
      seconds: null, secondsFrom: null, readyAt: null, held: false, playAt: null, playStart: null, playEnd: null,
      pausedMs: 0, pausedAt: null, gapMs: null, length: null, opus: null, flow: [], lastByteAt: null, stalled: null,
      audio: null, roon: null, decoderPending: false, decoderDoneAt: null, decoderLeftMs: null,
      file: path.join(deps.dir, s.id + "-track-" + n + "." + ext), opusFile: null };
    s.tracks.push(t);
    s.waiting.push(t);
    prune();
    status("STMc");
    const host = st.serverIp === "0.0.0.0" ? s.host : st.serverIp;
    t.stream = openStream({ connect }, { host, port: st.serverPort, request: st.request, file: t.file || "", cap: CAP,
      onHeaders(h) {
        if (s !== run) return;
        t.headers = h.split("\r\n").filter(Boolean).slice(0, 12);
        if (send(P.resp(h))) log("out", "RESP", { track: n, status: t.headers[0] || "" });
      },
      onData(bytes, first) {
        if (s !== run) return;
        if (t.firstByte == null) t.firstByte = at();
        t.bytes = bytes;
        t.lastByteAt = at();
        s.lastBytes = bytes;
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
        if (send(P.dsco(e.reason))) log("out", "DSCO", { track: n, reason: e.reason });
        t.flow.push([t.end, e.bytes]);
        // Stopped (a skip, a stop, the next stream): what had come is measured, and made into Opus to listen to.
        if (t.stopped) { if (e.bytes) { received(t, "atStop"); made(t, run); } return; }
        const code = statusOf((t.headers || [])[0]);
        if (!e.bytes || (code && !/^2/.test(code))) {
          t.failed = !e.bytes ? (e.error || "no audio") : "the response was " + t.headers[0];
          s.waiting = s.waiting.filter((/** @type {any} */ x) => x !== t);
          if (s.playing === t) { s.playing = null; t.playEnd = at(); }
          status("STMn");
          return;
        }
        if (!t.seconds && t.format === "pcm" && t.sampleRate && t.sampleSize && t.channels) {
          t.seconds = e.bytes / (t.sampleRate * t.channels * t.sampleSize / 8);
          t.secondsFrom = "PCM bytes";
        }
        ready(t);
        if (s.lead == null) status("STMd"); else t.decoderPending = true;
        received(t, "atEnd");
        made(t, run);
      } });
    s.receiving.push(t);
  }

  /**
   * A received track's length, when its stream didn't say it, then its Opus. A length no one can tell ends the track
   * now, said so, rather than playing it for ever.
   * @param {any} t @param {any} run
   */
  async function made(t, run) {
    if (!t.file) return;
    const pcm = pcmOf(t);
    const ff = { ffmpeg: deps.ffmpeg(), spawn: deps.spawn, now };
    if (!t.seconds && !t.stopped) {
      const m = await measure(ff, t.file, pcm);
      if (s !== run) return;
      t.length = m;
      if (m.seconds) { t.seconds = m.seconds; t.secondsFrom = "ffmpeg"; }
      else { t.seconds = Math.max(0.001, elapsed(t) / 1000); t.secondsFrom = "unknown: ended when its audio was all in"; }
    }
    if (!t.file) return;
    const out = t.file.replace(/\.[a-z]+$/, ".opus");
    const r = await toOpus(ff, t.file, out, pcm);
    if (s !== run || !t.file) { fs.rm(out, { force: true }, () => { /* an old run's or a pruned track's: gone is as good */ }); return; }
    t.opus = r;
    if (!r.error) t.opusFile = out;
  }

  /** Stop every stream and forget what was to play: Roon's "stop" and "flush". */
  function flush() {
    if (s.pauseTimer) { T.clearTimeout(s.pauseTimer); s.pauseTimer = null; }
    for (const t of s.tracks) if (t.end == null && !t.stopped) { t.stopped = "stopped"; t.stream.close(); }
    if (s.playing && s.playing.playEnd == null) { s.playing.playEnd = at(); roonSaw(s.playing, "atStop"); }
    s.playing = null;
    s.waiting = [];
    s.receiving = [];
    s.lastBytes = 0;
  }

  /** The clock goes on. */
  function resume() {
    const t = s.playing;
    if (t && t.pausedAt != null) { t.pausedMs += now() - t.pausedAt; t.pausedAt = null; }
  }

  /** @param {string} op @param {Buffer} data */
  function onMessage(op, data) {
    if (op === "strm") {
      let st;
      try { st = P.parseStrm(data); } catch (e) { log("in", op, { error: /** @type {Error} */ (e).message }); return; }
      if (st.command === "status") { s.counts.strmT++; status("STMt", st.replayGain); return; }
      log("in", "strm", Object.assign({}, st, { request: st.request.split("\r\n")[0] || "" }));
      const t = s.playing;
      if (st.command === "start") start(st);
      else if (st.command === "pause") {
        if (t && t.pausedAt == null) t.pausedAt = now();
        if (!st.replayGain) { status("STMp"); return; }
        // A pause with a time is a short hold, of which Squeezelite says nothing: the clock stops and goes on by itself.
        if (s.pauseTimer) T.clearTimeout(s.pauseTimer);
        const run = s;
        s.pauseTimer = T.setTimeout(() => {
          if (s !== run || s.stopped) return;
          s.pauseTimer = null;
          resume();
          log("note", "the pause's time is over", { ms: st.replayGain });
        }, st.replayGain);
      } else if (st.command === "unpause") {
        if (s.pauseTimer) { T.clearTimeout(s.pauseTimer); s.pauseTimer = null; }
        resume();
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
      // id 0 alone asks the name; with text after it, Roon names the player, which is kept and said back.
      const named = data[0] === 0 && data.length > 1 ? data.toString("utf8", 1).replace(/\0+$/, "") : null;
      log("in", op, named == null ? { id: data[0], bytes: data.length } : { id: 0, name: named });
      if (named) s.name = named;
      if (data[0] === 0 && send(P.setdName(s.name))) log("out", "SETD", { name: s.name });
      return;
    }
    if (op === "vers") { log("in", op, { version: data.toString("latin1") }); return; }
    s.counts.other[op] = (s.counts.other[op] || 0) + 1;
    if (s.counts.other[op] <= 3) log("in", op, { bytes: data.length, first: data.subarray(0, 16).toString("hex") });
  }

  function open() {
    const sock = connect({ host: s.host, port: PORT });
    s.sock = sock;
    const reader = P.createReader();
    sock.on("connect", () => {
      s.connected = true;
      s.lastHeard = now();
      // Reconnecting is said only after a connection that was made (Squeezelite's), not after tries that failed.
      const again = s.everConnected;
      s.everConnected = true;
      send(P.helo({ mac: MAC, caps: s.caps, reconnect: again }));
      log("out", "HELO", { caps: s.caps, reconnect: again });
    });
    sock.on("data", (/** @type {Buffer} */ chunk) => {
      if (!s || s.sock !== sock) return;
      s.lastHeard = now();
      for (const m of reader.push(chunk)) {
        try { onMessage(m.op, m.data); } catch (e) { log("error", m.op, { error: /** @type {Error} */ (e).message }); }
      }
    });
    sock.on("error", (/** @type {Error} */ e) => { if (s && s.sock === sock) s.lastError = e.message; });
    sock.on("close", () => {
      if (!s || s.sock !== sock) return;
      const was = s.connected;
      s.connected = false;
      // Said once for a connection that was made, and for the first try; tries that fail after are only counted.
      if (was || s.reconnects === 0) log("in", "closed", { error: s.lastError || null });
      // Tried again until the run's time is up: port 3483 refuses until Squeezebox support is on in Roon.
      if (s.stopped || now() >= s.until) return;
      s.reconnects++;
      s.retry = T.setTimeout(() => { if (s && !s.stopped && s.sock === sock) open(); }, reconnectMs);
    });
  }

  const api = {
    /**
     * Join the Core for `minutes`; any earlier run ends first and its report is gone.
     * @param {{ host: string, minutes: number, formats: string, maxRate: number, lead?: number | null }} o
     *   lead: seconds before a stream's audio runs out to say decoder done; null (or absent) says it as the stream closes
     */
    start(o) {
      api.stop("started again");
      fs.mkdirSync(deps.dir, { recursive: true });
      for (const f of fs.readdirSync(deps.dir)) {
        if (/^(run\d+-)?track-\d+\./.test(f)) fs.rmSync(path.join(deps.dir, f), { force: true });
      }
      // Each run's files carry its own name, so an old run's ffmpeg still at work never writes over a new run's.
      s = { id: "run" + now(), host: o.host, caps: capsOf(o.formats, o.maxRate), name: NAME, startedAt: now(), boot: now(),
        until: now() + o.minutes * 60000, log: [], logCut: false, tracks: [], waiting: [], receiving: [], playing: null,
        connected: false, everConnected: false, reconnects: 0, lastBytes: 0, lastHeard: 0, pauseTimer: null,
        counts: { stmt: 0, strmT: 0, other: {} }, lastAudg: "", stopped: false, endedBecause: null, lastError: null,
        lead: o.lead == null ? null : o.lead };
      s.beat = T.setInterval(() => {
        if (!s.connected) return;
        if (now() - s.lastHeard > SILENT_MS) {
          log("note", "Roon said nothing for " + SILENT_MS / 1000 + " s: connecting again");
          s.sock.destroy();
          return;
        }
        status("STMt");
        flowTick();
      }, BEAT_MS);
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
        for (const k of ["stream", "file", "opusFile", "pausedAt", "atAbs", "prevPausedMs", "lastByteAt"]) delete shown[k];
        return Object.assign(shown, {
          aheadOfEndMs: aheadOf(t),
          receiveSeconds: t.end != null && t.firstByte != null ? (t.end - t.firstByte) / 1000 : null,
          fasterThanPlayback: t.seconds && t.end != null && t.firstByte != null && t.end > t.firstByte
            ? Math.round(t.seconds * 1000 / (t.end - t.firstByte) * 10) / 10 : null,
          listen: opusFile ? "/api/debug/squeeze?listen=" + t.n : null,
          lossless: file && t.format === "flac" && t.end != null && !t.failed ? "/api/debug/squeeze?listen=" + t.n + "&lossless=1" : null,
        });
      });
      return { ran: true, running: !s.stopped, endedBecause: s.endedBecause, name: s.name, host: s.host, caps: s.caps, lead: s.lead,
        startedAt: new Date(s.startedAt).toISOString(), until: new Date(s.until).toISOString(), connected: s.connected,
        everConnected: s.everConnected, reconnects: s.reconnects, lastError: s.lastError,
        playing: s.playing ? { track: s.playing.n, elapsedMs: elapsed(s.playing) } : null,
        counts: s.counts, tracks, logCut: s.logCut, log: s.log };
    },
    /** A kept track's file, to listen to: its Opus, or what Roon sent when it is FLAC. @param {number} n @param {boolean} lossless */
    file(n, lossless) {
      const t = s && s.tracks.find((/** @type {any} */ x) => x.n === n);
      if (!t) return null;
      if (lossless) return t.format === "flac" && t.end != null && !t.failed ? t.file : null;
      return t.opusFile;
    },
  };
  return api;
}

module.exports = { createProbePlayer, capsOf, NAME, PORT };
