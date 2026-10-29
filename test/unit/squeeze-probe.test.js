"use strict";
// v1.9.72-t1: the Squeezebox probe player (lib/squeeze/probe-player.js) and its route, against a fake Core
// (test/lib/fake-squeeze-core.js; dev/design/android-app.md §6 step 1). What Roon itself sends is what the probe is
// for: these pin what the player does with what a Squeezebox server sends, in the order a server sends it.
const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const { createProbePlayer } = require("../../lib/squeeze/probe-player");
const { mountSqueezeProbe } = require("../../lib/squeeze/probe-route");
const { strm, createFakeCore } = require("../lib/fake-squeeze-core");

const BPS = 44100 * 2 * 2;   // 16-bit stereo at 44.1 kHz, bytes a second
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** ffmpeg as the probe runs it: writes the output (its last argument) and says how long the audio was. */
function fakeSpawn(seconds) {
  return (bin, args) => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      if (args[args.length - 1] !== "-") fs.writeFileSync(args[args.length - 1], "OggS fake");   // "-": the length's decode
      child.stderr.emit("data", Buffer.from("size=1kB time=00:00:" + seconds.toFixed(2).padStart(5, "0") + " bitrate=256k\r"));
      child.emit("close", 0);
    });
    return child;
  };
}

/** @param {object} core */
function playerFor(core, dir, spawn) {
  return createProbePlayer({ dir, ffmpeg: () => "ffmpeg", spawn,
    connect: (o) => net.connect({ host: "127.0.0.1", port: o.port === 3483 ? core.port : o.port }) });
}

const pcm = (path_, port, threshold = 1) => strm({ format: "p", size: "1", rate: "3", ch: "2", endian: "1", threshold, port,
  request: "GET " + path_ + " HTTP/1.0\r\nHost: core\r\n\r\n" });
const count = (core, event) => core.events().filter((e) => e === event).length;
const stats = (core, event) => core.got.filter((m) => m.event === event);

test("the probe joins, names itself, receives two tracks, plays the second gaplessly after the first, runs dry, and answers pause, status and stop", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squeeze-"));
  const core = await createFakeCore({ "/t1": Buffer.alloc(Math.round(0.6 * BPS), 1), "/t2": Buffer.alloc(Math.round(0.4 * BPS), 2),
    "/t3": Buffer.alloc(BPS * 3, 3) });
  const player = playerFor(core, dir, fakeSpawn(0.6));
  t.after(() => { player.stop("test over"); core.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  player.start({ host: "127.0.0.1", minutes: 1, formats: "flc,pcm", maxRate: 192000 });
  await core.waitFor(() => core.got.some((m) => m.op === "HELO"), 4000, "HELO");
  const helo = core.got.find((m) => m.op === "HELO").payload;
  assert.equal(helo[0], 12);
  assert.match(helo.toString("latin1", 36), /^Model=squeezelite,.*MaxSampleRate=192000,flc,pcm$/);

  core.send("setd", Buffer.from([0]));
  await core.waitFor(() => core.got.some((m) => m.op === "SETD"), 4000, "SETD");
  assert.equal(core.got.find((m) => m.op === "SETD").payload.toString("utf8", 1), "Rouen probe\0");

  // Track 1: the request goes out verbatim, the headers come back as RESP, it starts, and its audio is all in.
  core.send("strm", pcm("/t1", core.streamPort));
  await core.waitFor(() => count(core, "STMd") === 1, 4000, "the first STMd");
  assert.deepEqual(core.requests, ["GET /t1 HTTP/1.0"]);
  assert.ok(core.got.some((m) => m.op === "RESP" && /^HTTP\/1\.0 200 OK/.test(m.payload.toString("latin1"))));
  assert.deepEqual(core.events(), ["STMc", "STMs", "STMd"]);

  // Track 2, sent the moment the first is in: ahead of the first's end, so it follows with no gap.
  core.send("strm", pcm("/t2", core.streamPort));
  await core.waitFor(() => count(core, "STMs") === 2, 4000, "the second track's start");
  await core.waitFor(() => count(core, "STMu") === 1, 4000, "running dry after the second");
  assert.deepEqual(core.events(), ["STMc", "STMs", "STMd", "STMc", "STMd", "STMs", "STMu"]);
  const firstStart = stats(core, "STMs")[0].at, secondStart = stats(core, "STMs")[1].at;
  assert.ok(secondStart - firstStart >= 550 && secondStart - firstStart <= 900, "track 2 started " + (secondStart - firstStart) + " ms after track 1");

  let r = player.read();
  assert.equal(r.tracks.length, 2);
  const [one, two] = r.tracks;
  assert.ok(Math.abs(one.seconds - 0.6) < 0.001);
  assert.equal(one.secondsFrom, "PCM bytes");
  assert.equal(one.format, "pcm");
  assert.equal(one.sampleRate, 44100);
  assert.equal(one.request, "GET /t1 HTTP/1.0");
  assert.equal(one.whilePlaying, null);
  assert.equal(two.whilePlaying, 1);
  assert.ok(two.aheadOfEndMs > 300, "track 2's command came " + two.aheadOfEndMs + " ms before track 1 ended");
  assert.ok(two.gapMs != null && two.gapMs <= 300);
  assert.ok(one.fasterThanPlayback > 1);
  await core.waitFor(() => player.read().tracks.every((x) => x.opus), 4000, "the Opus");
  r = player.read();
  assert.equal(r.tracks[0].listen, "/api/debug/squeeze?listen=1");
  assert.equal(r.tracks[0].lossless, null);   // PCM: no lossless link
  assert.ok(fs.existsSync(player.file(1, false)));

  // A status ask is echoed with its timestamp, and the heartbeat says how far the player is.
  core.send("strm", strm({ cmd: "t", gain: 4242 }));
  await core.waitFor(() => stats(core, "STMt").some((m) => m.payload.readUInt32BE(47) === 4242), 4000, "the STMt echo");

  // Pause holds the clock, unpause lets it go, stop ends the track.
  core.send("strm", pcm("/t3", core.streamPort));
  await core.waitFor(() => count(core, "STMs") === 3, 4000, "the third track's start");
  await sleep(200);
  core.send("strm", strm({ cmd: "p" }));
  await core.waitFor(() => count(core, "STMp") === 1, 4000, "STMp");
  const held = player.read().playing.elapsedMs;
  await sleep(400);
  assert.ok(Math.abs(player.read().playing.elapsedMs - held) < 30, "the clock moved while paused");
  core.send("strm", strm({ cmd: "u" }));
  await core.waitFor(() => count(core, "STMr") === 1, 4000, "STMr");
  await sleep(200);
  assert.ok(player.read().playing.elapsedMs - held >= 150, "the clock did not move again after unpause");
  core.send("strm", strm({ cmd: "q" }));
  await core.waitFor(() => count(core, "STMf") === 1, 4000, "STMf");
  r = player.read();
  assert.equal(r.playing, null);
  assert.ok(r.tracks[2].playEnd != null);
  assert.ok(r.log.some((e) => e.dir === "in" && e.op === "strm" && e.command === "pause"));

  player.stop("by hand");
  assert.equal(player.read().running, false);
  assert.equal(player.read().endedBecause, "by hand");
});

test("a track that waits for unpause (autostart 0) says it is loaded and starts only when told", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squeeze-"));
  const core = await createFakeCore({ "/w": Buffer.alloc(BPS, 1) });
  const player = playerFor(core, dir, fakeSpawn(1));
  t.after(() => { player.stop("test over"); core.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  player.start({ host: "127.0.0.1", minutes: 1, formats: "pcm", maxRate: 48000 });
  await core.waitFor(() => core.got.some((m) => m.op === "HELO"), 4000, "HELO");
  assert.match(core.got[0].payload.toString("latin1", 36), /MaxSampleRate=48000,pcm$/);
  core.send("strm", strm({ format: "p", size: "1", rate: "3", ch: "2", endian: "1", threshold: 1, autostart: "0",
    port: core.streamPort, request: "GET /w HTTP/1.0\r\n\r\n" }));
  await core.waitFor(() => count(core, "STMd") === 1, 4000, "STMd");
  assert.deepEqual(core.events(), ["STMc", "STMl", "STMd"]);
  core.send("strm", strm({ cmd: "u" }));
  await core.waitFor(() => count(core, "STMs") === 1, 4000, "STMs after unpause");
});

/** The route's handler, called as Express would. */
function routeOf(deps) {
  let handler = null;
  const app = { get: (p, h) => { assert.equal(p, "/api/debug/squeeze"); handler = h; } };
  mountSqueezeProbe(app, deps);
  return (query) => new Promise((resolve) => {
    const res = { code: 200, set() {}, type(t) { this.ctype = t; },
      status(c) { this.code = c; return this; },
      json(b) { resolve({ code: this.code, body: b }); },
      sendFile(f) { resolve({ code: this.code, file: f, type: this.ctype }); } };
    handler({ query }, res);
  });
}

test("the route: says how without a parameter, refuses what it doesn't take, needs an address, and serves a kept track", async () => {
  const started = [];
  const player = { start: (o) => { started.push(o); return { started: true }; }, stop() {}, read: () => ({ ran: false }),
    file: (n, lossless) => (n === 1 ? (lossless ? "/data/track-1.flac" : "/data/track-1.opus") : null) };
  let host = null;
  const call = routeOf({ host: () => host, dir: "/data", ffmpeg: () => "ffmpeg", player });

  const how = await call({});
  assert.equal(how.code, 200);
  assert.match(how.body.how, /\?start=1/);
  assert.equal(started.length, 0);

  assert.equal((await call({ start: "1" })).code, 503);   // not paired, no host given
  for (const bad of [{ minutes: "0" }, { minutes: "61" }, { minutes: "x" }, { formats: "mp3" }, { rate: "44100" },
    { host: "core.local" }, { host: "1.2.3.256" }]) {
    assert.equal((await call(Object.assign({ start: "1" }, bad))).code, 400, JSON.stringify(bad));
  }
  assert.equal(started.length, 0);

  host = "192.168.1.20";
  assert.equal((await call({ start: "1" })).code, 200);
  assert.deepEqual(started.pop(), { host: "192.168.1.20", minutes: 15, formats: "flc,pcm", maxRate: 192000, lead: 30, early: 10 });
  await call({ start: "1", host: "10.0.0.5", minutes: "5", formats: "flc", rate: "96000", lead: "close", early: "off" });
  assert.deepEqual(started.pop(), { host: "10.0.0.5", minutes: 5, formats: "flc", maxRate: 96000, lead: null, early: null });
  await call({ start: "1", early: "20" });
  assert.equal(started.pop().early, 20);
  for (const bad of ["0", "121", "x"]) assert.equal((await call({ start: "1", early: bad })).code, 400, bad);
  await call({ start: "1", lead: "0" });
  assert.equal(started.pop().lead, 0);
  for (const bad of ["601", "x", "-1"]) assert.equal((await call({ start: "1", lead: bad })).code, 400, bad);

  assert.deepEqual(await call({ listen: "1" }), { code: 200, file: "/data/track-1.opus", type: "audio/ogg" });
  assert.deepEqual(await call({ listen: "1", lossless: "1" }), { code: 200, file: "/data/track-1.flac", type: "audio/flac" });
  assert.equal((await call({ listen: "2" })).code, 404);
  assert.equal((await call({ listen: "../x" })).code, 400);
});

test("the review's findings (v1.9.72-t1): no audio is never a track played; a length found by decoding still gives how far ahead; a timed pause says nothing; a Core not yet listening is tried until it is", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squeeze-"));
  // A FLAC stream that doesn't say its length (no STREAMINFO): ffmpeg's decode says 0.5 s.
  const core = await createFakeCore({ "/flac": Buffer.alloc(4096, 7), "/next": Buffer.alloc(4096, 8) });
  // The first two tries reach nothing (Squeezebox support not yet on), the third reaches the Core.
  let tries = 0;
  const player = createProbePlayer({ dir, ffmpeg: () => "ffmpeg", spawn: fakeSpawn(0.5), reconnectMs: 50,
    connect: (o) => net.connect({ host: "127.0.0.1", port: o.port === 3483 ? (++tries <= 2 ? 1 : core.port) : o.port }) });
  t.after(() => { player.stop("test over"); core.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  player.start({ host: "127.0.0.1", minutes: 1, formats: "flc", maxRate: 192000 });
  await core.waitFor(() => core.got.some((m) => m.op === "HELO"), 4000, "HELO after the refusals");
  assert.equal(tries, 3);
  assert.equal(core.got.find((m) => m.op === "HELO").payload.readUInt16BE(24), 0, "not a reconnect: it was never connected");
  assert.equal(player.read().reconnects, 2);

  // Roon names the player: kept, and said back.
  core.send("setd", Buffer.concat([Buffer.from([0]), Buffer.from("Den\0")]));
  await core.waitFor(() => core.got.some((m) => m.op === "SETD"), 4000, "SETD");
  assert.equal(core.got.find((m) => m.op === "SETD").payload.toString("utf8", 1), "Den\0");
  assert.equal(player.read().name, "Den");

  // No audio: a path the Core has nothing for. STMn and DSCO, never STMs or STMd.
  core.send("strm", strm({ threshold: 1, port: core.streamPort, request: "GET /missing HTTP/1.0\r\n\r\n" }));
  await core.waitFor(() => count(core, "STMn") === 1, 4000, "STMn");
  assert.deepEqual(core.events(), ["STMc", "STMn"]);
  assert.ok(core.got.some((m) => m.op === "DSCO"));
  assert.equal(player.read().tracks[0].failed, "no audio");
  assert.equal(player.read().playing, null);

  // A FLAC without its length: measured after it is in, which is when the next command comes; its lead is still known.
  core.send("strm", strm({ threshold: 1, port: core.streamPort, request: "GET /flac HTTP/1.0\r\n\r\n" }));
  await core.waitFor(() => count(core, "STMd") === 1, 4000, "STMd");
  core.send("strm", strm({ threshold: 1, port: core.streamPort, request: "GET /next HTTP/1.0\r\n\r\n" }));
  await core.waitFor(() => count(core, "STMs") === 2, 4000, "the next track's start after the measured one");
  const [, flac, next] = player.read().tracks;
  assert.equal(flac.secondsFrom, "ffmpeg");
  assert.equal(flac.seconds, 0.5);
  assert.ok(next.aheadOfEndMs > 200, "the lead was " + next.aheadOfEndMs);
  assert.ok(flac.lossless);

  // A pause with a time: no STMp, the clock holds, then goes on by itself.
  core.send("strm", strm({ cmd: "p", gain: 300 }));
  await sleep(100);
  const held = player.read().playing.elapsedMs;
  await sleep(100);
  assert.ok(Math.abs(player.read().playing.elapsedMs - held) < 30, "the clock moved during the timed pause");
  await sleep(250);
  assert.ok(player.read().playing.elapsedMs - held >= 100, "the clock did not go on after the pause's time");
  assert.equal(count(core, "STMp"), 0);
  assert.ok(player.read().log.some((e) => e.dir === "note" && /pause's time is over/.test(e.op)));
});

test("Roon's zone names the track (its length is that track's, never the stream's: t3); a stream that stalls open is measured, and a stopped one too (t2: the t1 run's FLAC said no length, and Roon held its streams open)", async (t) => {
  const { nowPlayingOf } = require("../../lib/squeeze/probe-route");
  const zones = { z1: { display_name: "Kitchen", state: "playing", now_playing: { length: 9 } },
    z2: { display_name: "Den", state: "playing", outputs: [{ display_name: "Rouen probe" }],
      now_playing: { length: 120, seek_position: 1, three_line: { line1: "So What", line2: "Miles Davis", line3: "Kind of Blue" } } } };
  assert.deepEqual(nowPlayingOf(zones, "Rouen probe"), { state: "playing", title: "So What", artist: "Miles Davis",
    album: "Kind of Blue", length: 120, seek: 1 });
  assert.equal(nowPlayingOf(zones, "Kitchen").length, 9);
  assert.equal(nowPlayingOf(zones, "Nowhere"), null);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squeeze-"));
  const core = await createFakeCore({ "/held": { data: Buffer.alloc(8192, 5), hold: true } });
  const player = createProbePlayer({ dir, ffmpeg: () => "ffmpeg", spawn: fakeSpawn(0.5), stallMs: 1200,
    nowPlaying: (name) => nowPlayingOf(zones, name),
    connect: (o) => net.connect({ host: "127.0.0.1", port: o.port === 3483 ? core.port : o.port }) });
  t.after(() => { player.stop("test over"); core.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  player.start({ host: "127.0.0.1", minutes: 1, formats: "flc", maxRate: 192000 });
  await core.waitFor(() => core.got.some((m) => m.op === "HELO"), 4000, "HELO");
  core.send("strm", strm({ threshold: 1, port: core.streamPort, request: "GET /held HTTP/1.0\r\n\r\n" }));
  await core.waitFor(() => count(core, "STMs") === 1, 4000, "STMs");
  // The stall is seen within a beat or two of stallMs, and Roon's zone is read 1.5 s after the start.
  const until = Date.now() + 5000;
  while (Date.now() < until && !(player.read().tracks[0].audio && player.read().tracks[0].roon)) await sleep(100);
  let [one] = player.read().tracks;
  assert.equal(one.roon.atStart.title, "So What");
  assert.equal(one.roon.atStart.length, 120);
  assert.equal(one.seconds, null, "a stream may carry two tracks: Roon's length is the first one's alone");
  assert.ok(one.stalled && one.stalled.bytes === 8192, JSON.stringify(one.stalled));
  assert.equal(one.audio.stalled.seconds, 0.5);
  assert.ok(one.audio.stalled.aheadSeconds < 0.5 && one.audio.stalled.aheadSeconds > -3, "ahead " + one.audio.stalled.aheadSeconds);
  assert.ok(one.flow.length >= 1 && one.flow[0][1] === 8192);
  assert.equal(count(core, "STMd"), 0);   // still open: never "decoder done"

  // Stopped: what came is measured again and made into Opus to listen to.
  core.send("strm", strm({ cmd: "q" }));
  await core.waitFor(() => count(core, "STMf") === 1, 4000, "STMf");
  const until2 = Date.now() + 3000;
  while (Date.now() < until2 && !player.read().tracks[0].listen) await sleep(50);
  [one] = player.read().tracks;
  assert.equal(one.stopped, "stopped");
  assert.equal(one.audio.atStop.seconds, 0.5);
  assert.equal(one.listen, "/api/debug/squeeze?listen=1");
  assert.equal(one.roon.atStop.title, "So What");
});

test("t3: with a lead, decoder done waits until the stream's audio left to play is under it, so Roon can send the next stream before this one runs out", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squeeze-"));
  // 1.5 s of PCM (two tracks, as Roon sends them), then the next stream.
  const core = await createFakeCore({ "/pair": Buffer.alloc(Math.round(1.5 * BPS), 1), "/next": Buffer.alloc(Math.round(0.5 * BPS), 2) });
  const player = playerFor(core, dir, fakeSpawn(1.5));
  t.after(() => { player.stop("test over"); core.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  player.start({ host: "127.0.0.1", minutes: 1, formats: "pcm", maxRate: 48000, lead: 0.5 });
  await core.waitFor(() => core.got.some((m) => m.op === "HELO"), 4000, "HELO");
  core.send("strm", pcm("/pair", core.streamPort));
  await core.waitFor(() => count(core, "STMs") === 1, 4000, "STMs");
  const started = stats(core, "STMs")[0].at;
  // The stream is all in at once; decoder done comes only with 0.5 s of it left, about 1 s in.
  await core.waitFor(() => count(core, "STMd") === 1, 4000, "STMd");
  const done = stats(core, "STMd")[0].at - started;
  assert.ok(done >= 850 && done <= 1350, "decoder done " + done + " ms after the start");
  // Roon sends the next stream on it, while the pair still plays: it follows with no gap and no STMu.
  core.send("strm", pcm("/next", core.streamPort));
  await core.waitFor(() => count(core, "STMs") === 2, 4000, "the next stream's start");
  const r = player.read();
  assert.equal(r.lead, 0.5);
  assert.ok(r.tracks[0].decoderLeftMs <= 500 && r.tracks[0].decoderLeftMs > 0, "left " + r.tracks[0].decoderLeftMs);
  assert.equal(r.tracks[1].whilePlaying, 1);
  assert.ok(r.tracks[1].aheadOfEndMs > 100, "ahead " + r.tracks[1].aheadOfEndMs);
  assert.ok(r.tracks[1].gapMs <= 300);
  assert.equal(core.events().indexOf("STMu"), -1);
});

test("t4: an early underrun brings Roon's next stream while this one still plays; Roon's stops on the way are not obeyed, and the next starts with no gap, its STMs only then", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squeeze-"));
  const core = await createFakeCore({ "/pair": Buffer.alloc(Math.round(2 * BPS), 1), "/next": Buffer.alloc(Math.round(0.5 * BPS), 2) });
  const player = playerFor(core, dir, fakeSpawn(2));
  t.after(() => { player.stop("test over"); core.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  player.start({ host: "127.0.0.1", minutes: 1, formats: "pcm", maxRate: 48000, lead: 30, early: 1 });
  await core.waitFor(() => core.got.some((m) => m.op === "HELO"), 4000, "HELO");
  core.send("strm", pcm("/pair", core.streamPort));
  await core.waitFor(() => count(core, "STMs") === 1, 4000, "STMs");
  const started = stats(core, "STMs")[0].at;
  // Ran dry is said with about 1 s of the 2 s left; Roon answers as on the owner's Core: stop, stop, then the next.
  await core.waitFor(() => count(core, "STMu") === 1, 4000, "the early STMu");
  const early = stats(core, "STMu")[0].at - started;
  assert.ok(early >= 850 && early <= 1350, "STMu " + early + " ms in");
  core.send("strm", strm({ cmd: "q" }));
  core.send("strm", strm({ cmd: "q" }));
  core.send("strm", pcm("/next", core.streamPort));
  await core.waitFor(() => count(core, "STMs") === 2, 4000, "the next stream's start");
  const second = stats(core, "STMs")[1].at - started;
  assert.ok(second >= 1850 && second <= 2350, "the next started " + second + " ms in, not when it came");
  const r = player.read();
  assert.equal(r.early, 1);
  assert.equal(r.tracks[0].playEnd != null, true);
  assert.ok(r.tracks[0].earlyLeftMs <= 1000 && r.tracks[0].earlyLeftMs > 500, "left " + r.tracks[0].earlyLeftMs);
  assert.equal(r.tracks[1].whilePlaying, 1);
  assert.ok(r.tracks[1].aheadOfEndMs > 500, "ahead " + r.tracks[1].aheadOfEndMs);
  assert.ok(r.tracks[1].gapMs <= 300, "gap " + r.tracks[1].gapMs);
  assert.equal(count(core, "STMu"), 1, "ran dry said once");
  assert.equal(r.log.filter((e) => e.dir === "note" && /early underrun/.test(e.op)).length, 2);
  // Past the window, a stop is a stop.
  await sleep(3200);
  core.send("strm", strm({ cmd: "q" }));
  await core.waitFor(() => count(core, "STMf") === 3, 4000, "the third STMf");
  assert.equal(player.read().playing, null);
});
