// @ts-check
"use strict";
/*
 * player.js — a phone's Roon zone (dev/design/android-app.md §4.9, v1.9.72-t5): one Squeezebox player inside Rouen
 * for each phone, made from what the probe (lib/squeeze, 1.9.72-t1 to t4) found on the owner's Core.
 *
 *   Roon → this player:  strm s brings a stream (FLAC); it goes into the phone's session (session.js), and the phone
 *                        is told to open the session (devices.js sends the command). p, u, q and audg become the phone's
 *                        pause, play, stop and volume.
 *   the phone → Roon:    the phone reports where it is in its session; that place, mapped onto Roon's streams, is what
 *                        the player tells Roon: STMt's elapsed, STMs as the phone enters a stream, STMd 30 s and the
 *                        early STMu 10 s before a stream's sound runs out (so Roon's next stream comes in time and
 *                        joins the session with no gap), and STMu when the phone has played everything.
 *
 * Learnt from the probe: Roon names the zone from the ModelName; it sends a stream's sound far faster than it plays;
 * it starts its next stream only on STMu; the two stops it sends right after an early STMu are on its way to that
 * stream and are not obeyed; between the early STMu and the next STMs, elapsed is 0 (or Roon's seek bar reads the old
 * stream's time against the new track).
 */
const net = require("net");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const P = require("../squeeze/slimproto");
const { openStream } = require("../squeeze/stream");
const { createSession } = require("./session");

const PORT = 3483, RECONNECT_MS = 3000, BEAT_MS = 1000, TICK_MS = 250, SILENT_MS = 35000;
/** STMd and the early STMu, this long before a stream's sound runs out (§4.1). */
const LEAD_MS = 30000, EARLY_MS = 10000, EARLY_STOP_MS = 3000;
const BUFFER = 2 * 1024 * 1024, OUTPUT = 3528000;

/** The player's MAC: 02 (locally administered) and the first five bytes of the device id's SHA-256. @param {string} id */
const macOf = (id) => Buffer.concat([Buffer.from([0x02]), crypto.createHash("sha256").update(id).digest().subarray(0, 5)]);

/** The zone's name as Roon will show it: Roon takes the ModelName (§4.9). @param {string} name */
const zoneName = (name) => "Rouen " + (String(name || "phone").replace(/[,=\0\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40) || "phone");

/** @param {string} name @param {string} version */
const capsOf = (name, version) => "Model=squeezelite,AccuratePlayPoints=1,HasDigitalOut=1,HasPolarityInversion=1," +
  "Firmware=v" + version + "-rouen,ModelName=" + zoneName(name) + ",MaxSampleRate=192000,flc";

/**
 * @typedef {object} PlayerDeps
 * @property {string} dir  where the device's sessions are kept
 * @property {() => string} ffmpeg
 * @property {(cmd: Record<string, any>) => void} send  a command to the phone (devices.js)
 * @property {string} [version]
 * @property {Function} [spawn]
 * @property {typeof net.connect} [connect]
 * @property {() => number} [now]
 * @property {(line: string) => void} [log]
 * @property {{ setInterval: typeof setInterval, clearInterval: typeof clearInterval, setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout }} [timers]
 */

/**
 * @param {PlayerDeps} deps
 * @param {{ deviceId: string, name: string, quality: "opus" | "lossless", host: string }} o
 */
function createPhonePlayer(deps, o) {
  const now = deps.now || Date.now;
  const T = deps.timers || { setInterval, clearInterval, setTimeout, clearTimeout };
  const connect = deps.connect || net.connect;
  const log = deps.log || (() => { /* no log asked for */ });
  const dir = path.join(deps.dir, o.deviceId);
  let quality = o.quality;

  /** @type {any} */
  const s = { sock: null, connected: false, everConnected: false, stopped: true, lastHeard: 0, boot: now(), beat: null,
    tick: null, retry: null, n: 0, /** @type {any} */ current: null, /** @type {any} */ pending: null, kept: [],
    device: { session: 0, position: 0, state: "stopped", at: 0 }, earlyStopsUntil: 0, lastBytes: 0, streams: [],
    /** @type {Array<{ at: number, what: string }>} */ trail: [] };

  /**
   * The trail (v1.9.72-t10): what Roon asked, what Roon was told and what the phone said, the last 80, for the debug
   * answer — a phone that plays a few seconds and moves on is diagnosed from it, not guessed at.
   * @param {string} what
   */
  function note(what) {
    s.trail.push({ at: now(), what });
    if (s.trail.length > 80) s.trail.splice(0, s.trail.length - 80);
  }

  /** @param {Buffer} b */
  function send(b) { if (s.connected && s.sock && !s.sock.destroyed) s.sock.write(b); }

  /** The phone's place in its session now, from its last report (moved on by the time since, while it plays). */
  function position() {
    const d = s.device;
    return d.state === "playing" ? d.position + (now() - d.at) : d.position;
  }

  /** The current session's segment the phone is in, and its row in the timeline. */
  function where() {
    const sess = s.current;
    if (!sess || s.device.session !== sess.n) return null;
    const tl = sess.timeline(), p = position();
    let i = 0;
    while (i + 1 < tl.length && p >= tl[i + 1].start) i++;
    return tl.length ? { sess, tl, i, row: tl[i], p, meta: sess.meta[i] } : null;
  }

  /** @param {string} event @param {number} [serverTimestamp] */
  function status(event, serverTimestamp) {
    const w = where();
    const elapsed = !w ? 0 : w.meta && w.meta.earlyAt != null ? 0 : Math.max(0, w.p - w.row.start);
    const left = w && w.row.done ? Math.max(0, w.row.start + w.row.length - w.p) : 0;
    if (event !== "STMt") note("told Roon " + event + " (elapsed " + Math.round(elapsed) + " ms" + (w ? ", segment " + w.i : "") + ")");
    send(P.stat(event, { bufferSize: BUFFER, bufferFull: 0, bytesReceived: s.lastBytes, jiffies: (now() - s.boot) >>> 0,
      outputSize: OUTPUT, outputFull: Math.min(OUTPUT, Math.round(left / 1000 * 176400)), elapsedMs: elapsed,
      serverTimestamp: serverTimestamp || 0 }));
  }

  /** A new session, its file, and the old ones beyond the last two removed. @param {{ rate: number, bits: number }} fmt */
  function newSession(fmt) {
    fs.mkdirSync(dir, { recursive: true });
    const n = ++s.n;
    const file = path.join(dir, "s" + n + (quality === "lossless" ? ".flac" : ".ogg"));
    const sess = createSession({ ffmpeg: deps.ffmpeg(), spawn: deps.spawn }, { n, quality, file, rate: fmt.rate, bits: fmt.bits });
    /** @type {any} */ (sess).meta = [];
    /** @type {any} */ (sess).file = file;
    s.kept.push(sess);
    while (s.kept.length > 3) {
      const old = s.kept.shift();
      old.close();
      fs.rm(old.file, { force: true }, () => { /* gone already is as good */ });
    }
    return sess;
  }

  /** @param {any} sess @param {boolean} play */
  function open(sess, play) {
    s.current = sess;
    s.device = { session: sess.n, position: 0, state: play ? "buffering" : "paused", at: now() };
    note("phone told to open session " + sess.n + (play ? ", playing" : ", paused"));
    deps.send({ op: "open", session: sess.n, url: "/api/phone/audio?device_id=" + o.deviceId + "&session=" + sess.n, play });
  }

  /** Roon's strm s: a stream, given to a session once its first bytes say its format. @param {any} st */
  function start(st) {
    for (const old of s.streams) old.close();
    s.lastBytes = 0;
    status("STMc");
    const play = st.autostart === "1" || st.autostart === "3";
    /** @type {any} */
    let seg = null;
    let head = Buffer.alloc(0);
    const host = st.serverIp === "0.0.0.0" ? o.host : st.serverIp;
    const stream = openStream({ connect }, { host, port: st.serverPort, request: st.request, file: null, cap: 0,
      onHeaders(h) { send(P.resp(h)); },
      onData(bytes) { s.lastBytes = bytes; },
      onChunk(chunk) {
        if (seg) return seg.feed(chunk);
        head = Buffer.concat([head, chunk]);
        if (head.length < 42) return true;
        seg = attach(P.flacInfo(head), play, () => stream.resume());
        return seg.feed(head);
      },
      onEnd(e) {
        note("Roon's stream ended (" + (e.reason === 0 ? "all sent" : "reason " + e.reason) + ", " + s.lastBytes + " bytes)");
        s.streams = s.streams.filter((x) => x !== stream);
        send(P.dsco(e.reason));
        // A stream shorter than a FLAC header: what came is still its sound, if any; none is said as a decoder would.
        if (!seg && head.length && e.reason !== 1) { seg = attach(P.flacInfo(head), play, () => { /* it has ended */ }); seg.feed(head); }
        if (seg) seg.end();
        else if (e.reason !== 1) status("STMn");
      } });
    s.streams.push(stream);
  }

  /**
   * A stream's segment: in the current session, or a new one (the first, after a stop, or lossless at a new rate,
   * which waits for the phone to finish the old: §4.9).
   * @param {{ rate: number, bits: number } | null} info @param {boolean} play @param {() => void} onDrain
   */
  function attach(info, play, onDrain) {
    const fmt = { rate: info ? info.rate : 44100, bits: info ? info.bits : 16 };
    const cur = s.current;
    let sess;
    if (!cur || cur.closed) { sess = newSession(fmt); open(sess, play); }
    else if (quality === "lossless" && (cur.rate !== fmt.rate || cur.bits !== (fmt.bits > 16 ? 24 : 16))) {
      sess = newSession(fmt);
      cur.end();
      s.pending = sess;
      note("a new rate: session " + sess.n + " waits for the phone to finish session " + cur.n);
    } else sess = cur;
    note("Roon's stream " + fmt.rate + " Hz/" + fmt.bits + " bit → session " + sess.n + ", segment " + sess.meta.length + " (" + quality + ")");
    sess.meta.push({ started: false, decoderDone: false, earlyAt: null });
    return sess.add(onDrain);
  }

  /** Each quarter second: STMs, STMd and the early STMu, from where the phone is. */
  function tick() {
    const w = where();
    if (!w || !w.meta) return;
    if (s.device.state === "playing" && !w.meta.started) {
      w.meta.started = true;
      status("STMs");
    }
    if (!w.row.done) return;
    const left = w.row.start + w.row.length - w.p;
    if (left <= LEAD_MS && !w.meta.decoderDone) { w.meta.decoderDone = true; status("STMd"); }
    const last = w.i === w.tl.length - 1;
    if (last && !s.pending && left <= EARLY_MS && w.meta.earlyAt == null && s.device.state === "playing") {
      w.meta.earlyAt = now();
      s.earlyStopsUntil = now() + EARLY_STOP_MS;
      status("STMu");
    }
  }

  /** @param {string} op @param {Buffer} data */
  function onMessage(op, data) {
    if (op === "strm") {
      const st = P.parseStrm(data);
      if (st.command !== "status") note("Roon: strm " + st.command + (st.command === "start" ? " (autostart " + st.autostart + ")" : ""));
      if (st.command === "status") { status("STMt", st.replayGain); return; }
      if (st.command === "start") { start(st); return; }
      if (st.command === "pause") { deps.send({ op: "pause" }); status("STMp"); return; }
      if (st.command === "unpause") { deps.send({ op: "play" }); status("STMr"); return; }
      if (st.command === "stop" || st.command === "flush") {
        // Roon's stops just after an early STMu are its way to the next stream (§4.1): what plays goes on.
        if (now() < s.earlyStopsUntil) { note("its stop ignored: the early STMu's"); status("STMf"); return; }
        for (const st2 of s.streams) st2.close();
        if (s.current) s.current.close();
        if (s.pending) s.pending.close();
        s.current = s.pending = null;
        deps.send({ op: "stop" });
        status("STMf");
      }
      return;
    }
    if (op === "audg") {
      const g = P.parseAudg(data);
      if (g) deps.send({ op: "volume", gain: Math.max(0, Math.min(1, Math.max(g.left, g.right))) });
      return;
    }
    if (op === "setd" && data[0] === 0) send(P.setdName(zoneName(o.name)));
  }

  function link() {
    const sock = connect({ host: o.host, port: PORT });
    s.sock = sock;
    const reader = P.createReader();
    sock.on("connect", () => {
      s.connected = true;
      s.lastHeard = now();
      send(P.helo({ mac: macOf(o.deviceId), caps: capsOf(o.name, deps.version || "0"), reconnect: s.everConnected }));
      s.everConnected = true;
      log("joined Roon as " + zoneName(o.name));
    });
    sock.on("data", (/** @type {Buffer} */ chunk) => {
      if (s.sock !== sock) return;
      s.lastHeard = now();
      for (const m of reader.push(chunk)) {
        try { onMessage(m.op, m.data); } catch (e) { log("message " + m.op + ": " + /** @type {Error} */ (e).message); }
      }
    });
    sock.on("error", (/** @type {Error} */ e) => { if (s.sock === sock) log("Roon: " + e.message); });
    sock.on("close", () => {
      if (s.sock !== sock) return;
      s.connected = false;
      if (s.stopped) return;
      s.retry = T.setTimeout(() => { if (!s.stopped && s.sock === sock) link(); }, RECONNECT_MS);
    });
  }

  return {
    get zoneName() { return zoneName(o.name); },
    get running() { return !s.stopped; },
    /** Join Roon (again). */
    start() {
      if (!s.stopped) return;
      s.stopped = false;
      s.beat = T.setInterval(() => {
        if (!s.connected) return;
        if (now() - s.lastHeard > SILENT_MS) { s.sock.destroy(); return; }
        status("STMt");
      }, BEAT_MS);
      s.tick = T.setInterval(tick, TICK_MS);
      link();
    },
    /** Leave Roon: the zone goes (the phone offline, §7 point 2). */
    stop() {
      if (s.stopped) return;
      s.stopped = true;
      T.clearInterval(s.beat);
      T.clearInterval(s.tick);
      if (s.retry) T.clearTimeout(s.retry);
      for (const st of s.streams) st.close();
      for (const sess of s.kept) sess.close();
      if (s.sock) s.sock.destroy();
      s.connected = false;
      s.current = s.pending = null;
    },
    /** @param {"opus" | "lossless"} q  from the next session on */
    setQuality(q) { quality = q; },
    /** @param {string} name  from the next connection on (Roon names the zone at HELO) */
    rename(name) { o.name = name; if (s.sock) s.sock.destroy(); },
    /**
     * The phone's report (§4.10 state); `error`, the phone's player's own, kept in the trail (v1.9.72-t10).
     * @param {{ session: number, position: number, state: string, error?: string }} r
     */
    report(r) {
      const was = s.device;
      if (r.error || r.state !== was.state || r.session !== was.session) {
        note("phone: " + r.state + " in session " + r.session + " at " + Math.round(r.position) + " ms" + (r.error ? " — " + r.error : ""));
      }
      s.device = { session: r.session, position: r.position, state: r.state, at: now() };
      if (r.state === "ended" && s.current && r.session === s.current.n) {
        if (s.pending) { const next = s.pending; s.pending = null; open(next, true); return; }
        const w = s.current.meta[s.current.meta.length - 1];
        if (w && w.earlyAt == null) status("STMu");
      }
      tick();
    },
    /** A session to send, while it is kept. @param {number} n */
    session(n) { return s.kept.find((/** @type {any} */ x) => x.n === n) || null; },
    /** For the debug answer. */
    info() {
      return { zone: zoneName(o.name), connected: s.connected, quality, session: s.current ? s.current.n : null,
        pending: s.pending ? s.pending.n : null, device: s.device, timeline: s.current ? s.current.timeline() : [],
        // What the phone is hearing (v1.9.72-t12): the open session's quality, rate and bits; Now playing's badge.
        format: s.current ? { quality: s.current.quality, rate: s.current.rate, bits: s.current.bits } : null,
        trail: s.trail.map((x) => new Date(x.at).toISOString().slice(11, 23) + " " + x.what) };
    },
  };
}

module.exports = { createPhonePlayer, zoneName, macOf, capsOf };
