// @ts-check
"use strict";
/*
 * player.js — the silent catch-up player (dev/design/android-app.md §4.22, v1.9.72-t56): one Squeezebox player,
 * "Rouen catch-up", which Rouen keeps joined to your Roon Core while catch-up is on, so that This phone's plays can be
 * replayed to Roon and counted. It plays nothing anyone hears: Roon's audio is read as fast as Roon sends it and
 * thrown away, and the player reports a track as played [speed] times faster than real time (the counts probe proved
 * Roon counts a play off the elapsed a player reports, +1 a track at 80, 99 and 120 times: §4.20).
 *
 * It answers Roon as the probe did (lib/squeeze/probe-player.js), which is what was counted on the owner's Core:
 *   - HELO with Squeezelite's capabilities and ModelName "Rouen catch-up" — Roon names a Squeezebox after its ModelName
 *     (the probe, §4.1) — and its own MAC, so Roon knows it again after a restart;
 *   - strm s: STMc, the request sent verbatim, RESP with the headers; STMs once the threshold is in (or STMl, held,
 *     when Roon asks it not to start), then STMd when the stream's audio is all in; STMn for a stream with no audio;
 *     every stream's end said with DSCO;
 *   - STMt every second, with the elapsed so far ([speed] times the clock), and as the answer to strm t;
 *   - strm p / u / q / f: pause (STMp), unpause (STMr), stop and flush (STMf); setd: its name; audg: taken, not used.
 * What it plays, and when it stops, is Roon's: Rouen's catch-up (driver.js) asks Roon to play a track on this zone and
 * to stop it once the elapsed reaches how far the phone played it.
 *
 * Kept joined while it runs: a connection that closes is made again (port 3483 refuses until Squeezebox support is on
 * in Roon), and a server silent for SILENT_MS is taken as gone, as Squeezelite does.
 */
const net = require("net");
const P = require("../squeeze/slimproto");
const { openStream } = require("../squeeze/stream");

const PORT = 3483;
/** Locally administered, "Rouec" — not the probe's ("Rouen"), so Roon keeps the two players apart. */
const MAC = Buffer.from([0x02, 0x52, 0x6f, 0x75, 0x65, 0x63]);
const NAME = "Rouen catch-up";
/** Download-bound past ~40 times anyway (the probe, §4.20); as fast as Roon will send. */
const SPEED = 120;
const RECONNECT_MS = 3000, BEAT_MS = 1000, SILENT_MS = 35000, MAX_LOG = 200;
const BUFFER = 2 * 1024 * 1024, OUTPUT = 3528000;
const CAPS = "Model=squeezelite,AccuratePlayPoints=1,HasDigitalOut=1,HasPolarityInversion=1," +
  "Firmware=v1.9.72-rouen,ModelName=" + NAME + ",MaxSampleRate=192000,flc,pcm";

/**
 * @param {{ connect?: typeof net.connect, now?: () => number, speed?: number, reconnectMs?: number,
 *   timers?: { setInterval: typeof setInterval, clearInterval: typeof clearInterval, setTimeout: typeof setTimeout,
 *     clearTimeout: typeof clearTimeout } }} [deps]
 */
function createCatchupPlayer(deps = {}) {
  const now = deps.now || Date.now;
  const T = deps.timers || { setInterval, clearInterval, setTimeout, clearTimeout };
  const connect = deps.connect || net.connect;
  const speed = deps.speed || SPEED;
  const reconnectMs = deps.reconnectMs || RECONNECT_MS;
  /** @type {any} */
  let s = null;

  /** @param {string} what */
  function note(what) {
    s.log.push({ at: new Date(now()).toISOString(), what });
    if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
  }
  /** @param {Buffer} b */
  function send(b) {
    if (!s || !s.connected || !s.sock || s.sock.destroyed) return false;
    s.sock.write(b);
    return true;
  }
  /**
   * How far into what plays, in ms: [speed] times the clock since it started, less its pauses — held at the cap when
   * one is set (setCap), so Roon is told exactly how far the phone played, never past it.
   */
  function elapsed() {
    const t = s && s.playing;
    if (!t || t.playAt == null) return 0;
    const ran = (now() - t.playAt - t.pausedMs - (t.pausedAt != null ? now() - t.pausedAt : 0)) * speed;
    return s.capMs == null ? ran : Math.min(ran, s.capMs);
  }
  /** @param {string} event @param {number} [serverTimestamp] */
  function status(event, serverTimestamp) {
    send(P.stat(event, { bufferSize: BUFFER, bufferFull: 0, bytesReceived: s.lastBytes, jiffies: (now() - s.boot) >>> 0,
      outputSize: OUTPUT, outputFull: 0, elapsedMs: elapsed(), serverTimestamp: serverTimestamp || 0 }));
  }

  /** @param {any} t */
  function play(t) {
    s.playing = t;
    t.playAt = now();
    status("STMs");
    note("plays stream " + t.n);
  }

  /** @param {any} st  the parsed strm s */
  function start(st) {
    for (const old of s.receiving) { old.stopped = true; old.stream.close(); }
    s.receiving = [];
    s.lastBytes = 0;
    s.playing = null;
    s.streams++;
    /** @type {any} */
    const t = { n: s.streams, playAt: null, pausedMs: 0, pausedAt: null, headers: "", bytes: 0, ready: false, stopped: false,
      held: st.autostart === "0" || st.autostart === "2" };
    const run = s;
    status("STMc");
    const host = st.serverIp === "0.0.0.0" ? s.host : st.serverIp;
    t.stream = openStream({ connect }, { host, port: st.serverPort, request: st.request, file: null, cap: 0,
      onHeaders(h) {
        if (s !== run) return;
        t.headers = h.split("\r\n")[0] || "";
        send(P.resp(h));
      },
      onData(bytes) {
        if (s !== run) return;
        t.bytes = bytes;
        s.lastBytes = bytes;
        if (!t.ready && bytes >= st.threshold * 1024) {
          t.ready = true;
          if (t.held) status("STMl"); else play(t);
        }
      },
      onEnd(e) {
        if (s !== run) return;
        s.receiving = s.receiving.filter((/** @type {any} */ x) => x !== t);
        send(P.dsco(e.reason));
        if (t.stopped) return;
        if (!e.bytes || (t.headers && !/^HTTP\/\d\.\d 2/.test(t.headers))) {
          note("stream " + t.n + " brought no audio: " + (e.error || t.headers || "empty"));
          if (s.playing === t) s.playing = null;
          status("STMn");
          return;
        }
        if (!t.ready) { t.ready = true; if (t.held) status("STMl"); else play(t); }
        status("STMd");
      } });
    s.receiving.push(t);
  }

  /** Stop what plays and what arrives: Roon's stop and flush. */
  function flush() {
    for (const t of s.receiving) { t.stopped = true; t.stream.close(); }
    s.receiving = [];
    s.playing = null;
    s.lastBytes = 0;
  }

  /** @param {string} op @param {Buffer} data */
  function onMessage(op, data) {
    if (op === "strm") {
      const st = P.parseStrm(data);
      const t = s.playing;
      if (st.command === "status") status("STMt", st.replayGain);
      else if (st.command === "start") start(st);
      else if (st.command === "pause") { if (t && t.pausedAt == null) t.pausedAt = now(); status("STMp"); }
      else if (st.command === "unpause") {
        if (t && t.pausedAt != null) { t.pausedMs += now() - t.pausedAt; t.pausedAt = null; }
        const held = s.receiving.find((/** @type {any} */ x) => x.held && x.ready);
        if (held && !s.playing) { held.held = false; play(held); }
        status("STMr");
      } else if (st.command === "stop" || st.command === "flush") { flush(); status("STMf"); }
      return;
    }
    if (op === "setd") {
      // id 0 alone asks the name; with text after it, Roon names the player, which is kept and said back.
      if (data[0] === 0 && data.length > 1) s.name = data.toString("utf8", 1).replace(/\0+$/, "") || s.name;
      if (data[0] === 0) send(P.setdName(s.name));
    }
    // audg (volume), vers and anything else: nothing to do for a player no one hears.
  }

  function open() {
    const sock = connect({ host: s.host, port: PORT });
    s.sock = sock;
    const reader = P.createReader();
    sock.on("connect", () => {
      s.connected = true;
      s.lastHeard = now();
      const again = s.everConnected;
      s.everConnected = true;
      send(P.helo({ mac: MAC, caps: CAPS, reconnect: again }));
      note(again ? "joined Roon again" : "joined Roon");
    });
    sock.on("data", (/** @type {Buffer} */ chunk) => {
      if (!s || s.sock !== sock) return;
      s.lastHeard = now();
      for (const m of reader.push(chunk)) {
        try { onMessage(m.op, m.data); } catch (e) { note("couldn't take " + m.op + ": " + /** @type {Error} */ (e).message); }
      }
    });
    sock.on("error", (/** @type {Error} */ e) => { if (s && s.sock === sock) s.lastError = e.message; });
    sock.on("close", () => {
      if (!s || s.sock !== sock) return;
      if (s.connected) note("left Roon: " + (s.lastError || "the connection closed"));
      s.connected = false;
      flush();
      if (s.stopped) return;
      s.retry = T.setTimeout(() => { if (s && !s.stopped && s.sock === sock) open(); }, reconnectMs);
    });
  }

  return {
    /** Join the Core at [host] and stay joined until stop(); a player already running is left as it is. @param {string} host */
    start(host) {
      if (s && !s.stopped && s.host === host) return;
      if (s) this.stop();
      s = { host, name: NAME, boot: now(), connected: false, everConnected: false, stopped: false, sock: null, retry: null,
        receiving: [], playing: null, streams: 0, lastBytes: 0, lastHeard: 0, lastError: null, log: [], capMs: null };
      s.beat = T.setInterval(() => {
        if (!s.connected) return;
        if (now() - s.lastHeard > SILENT_MS) { note("Roon said nothing for " + SILENT_MS / 1000 + " s: joining again"); s.sock.destroy(); return; }
        status("STMt");
      }, BEAT_MS);
      open();
    },
    /** Leave the Core. */
    stop() {
      if (!s || s.stopped) return;
      s.stopped = true;
      T.clearInterval(s.beat);
      if (s.retry) T.clearTimeout(s.retry);
      flush();
      if (s.sock) s.sock.destroy();
      s.connected = false;
    },
    /** Hold the elapsed reported at [ms] at most, from now on; null lets it run. @param {number | null} ms */
    setCap(ms) { if (s) s.capMs = ms; },
    /** Tell Roon the elapsed now (an STMt between the beats): the driver's, once the cap is reached. */
    report() { if (s && s.connected) status("STMt"); },
    /** The player now: joined, playing, how far (ms), and its last notes. */
    state() {
      if (!s) return { running: false, connected: false, playing: false, elapsedMs: 0, log: [] };
      return { running: !s.stopped, connected: s.connected, playing: !!(s.playing && s.playing.pausedAt == null),
        elapsedMs: Math.round(elapsed()), streams: s.streams, lastError: s.lastError, log: s.log.slice(-20) };
    },
  };
}

/**
 * Is Roon's zone [z] the catch-up player's? Its name, or one of its outputs'. Roon names it "Rouen catch-up" from the
 * player's ModelName; renamed in Roon, it is no longer recognised and shows in Rouen like any zone.
 * @param {any} z
 */
const isCatchupZone = (z) => !!(z && (z.display_name === NAME ||
  (z.outputs || []).some((/** @type {any} */ o) => o && o.display_name === NAME)));

module.exports = { createCatchupPlayer, isCatchupZone, NAME, MAC, PORT, CAPS };
