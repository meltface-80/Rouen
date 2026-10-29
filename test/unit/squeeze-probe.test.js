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
      fs.writeFileSync(args[args.length - 1], "OggS fake");
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
  assert.deepEqual(started.pop(), { host: "192.168.1.20", minutes: 15, formats: "flc,pcm", maxRate: 192000 });
  await call({ start: "1", host: "10.0.0.5", minutes: "5", formats: "flc", rate: "96000" });
  assert.deepEqual(started.pop(), { host: "10.0.0.5", minutes: 5, formats: "flc", maxRate: 96000 });

  assert.deepEqual(await call({ listen: "1" }), { code: 200, file: "/data/track-1.opus", type: "audio/ogg" });
  assert.deepEqual(await call({ listen: "1", lossless: "1" }), { code: 200, file: "/data/track-1.flac", type: "audio/flac" });
  assert.equal((await call({ listen: "2" })).code, 404);
  assert.equal((await call({ listen: "../x" })).code, 400);
});
