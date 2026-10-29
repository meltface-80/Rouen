"use strict";
// v1.9.72-t5: a phone's Roon zone (lib/phone/player.js; dev/design/android-app.md §4.9), against a fake Core
// (test/lib/fake-squeeze-core.js) with an ffmpeg that passes sound through (test/lib/fake-ffmpeg.js): what Roon sends
// becomes the phone's commands, and where the phone is becomes what Roon is told — the probe's findings (§4.1) kept.
const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createPhonePlayer, zoneName, macOf } = require("../../lib/phone/player");
const { strm, createFakeCore } = require("../lib/fake-squeeze-core");
const { fakeSpawn } = require("../lib/fake-ffmpeg");

const ID = "0123456789abcdef0123456789abcdef";
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** A FLAC header (STREAMINFO, no length) and then `ms` of "sound" at Opus's 384 bytes a ms. */
function flac(rate, bits, ms) {
  const h = Buffer.alloc(42);
  h.write("fLaC", 0, "latin1");
  h[4] = 0x80; h.writeUIntBE(34, 5, 3);
  const s = h.subarray(8);
  s[10] = rate >> 12; s[11] = (rate >> 4) & 0xff; s[12] = ((rate & 0x0f) << 4) | (1 << 1) | ((bits - 1) >> 4); s[13] = ((bits - 1) & 0x0f) << 4;
  return Buffer.concat([h, Buffer.alloc(384 * ms - 42, 1)]);
}

function setup(t, bodies, quality = "opus") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phone-"));
  const sent = [];
  return createFakeCore(bodies).then((core) => {
    const p = createPhonePlayer({ dir, ffmpeg: () => "ffmpeg", spawn: fakeSpawn(), send: (c) => sent.push(c), version: "1.9.72-t5",
      connect: (o) => net.connect({ host: "127.0.0.1", port: o.port === 3483 ? core.port : o.port }) },
    { deviceId: ID, name: "Pixel, 8", quality, host: "127.0.0.1" });
    t.after(() => { p.stop(); core.close(); fs.rmSync(dir, { recursive: true, force: true }); });
    return { core, p, sent, dir };
  });
}
const events = (core) => core.events();
const count = (core, e) => events(core).filter((x) => x === e).length;
const stmts = (core, e) => core.got.filter((m) => m.event === e);
const req = (p, port) => strm({ format: "f", threshold: 1, port, request: "GET " + p + " HTTP/1.0\r\n\r\n" });

test("the zone: Roon's name from the ModelName, the MAC from the device id, FLAC only", async (t) => {
  const { core, p } = await setup(t, {});
  p.start();
  await core.waitFor(() => core.got.some((m) => m.op === "HELO"));
  const helo = core.got.find((m) => m.op === "HELO").payload;
  assert.deepEqual(helo.subarray(2, 8), macOf(ID));
  assert.match(helo.toString("latin1", 36), /ModelName=Rouen Pixel 8,MaxSampleRate=192000,flc$/);
  assert.equal(zoneName("Pixel, 8"), "Rouen Pixel 8");
  assert.equal(p.zoneName, "Rouen Pixel 8");
});

test("a stream opens a session on the phone; the phone's place is Roon's: STMs, STMd, the early STMu with elapsed 0, Roon's stops ignored, the next stream joining the same session, and pause, play, volume and stop passed on", async (t) => {
  // The second stream is long enough (20 s) that, inside it, the phone is not yet near its own early STMu.
  const { core, p, sent } = await setup(t, { "/a": flac(44100, 16, 2000), "/b": flac(44100, 16, 20000) });
  p.start();
  await core.waitFor(() => core.got.some((m) => m.op === "HELO"));
  core.send("strm", req("/a", core.streamPort));
  await core.waitFor(() => core.got.some((m) => m.op === "DSCO"));
  assert.deepEqual(sent[0], { op: "open", session: 1, url: "/api/phone/audio?device_id=" + ID + "&session=1", play: true });
  assert.equal(count(core, "STMs"), 0, "not until the phone plays");
  p.report({ session: 1, position: 0, state: "playing" });
  await core.waitFor(() => count(core, "STMs") === 1, 2000, "STMs");
  // Wait for the first stream to be decoded (the timeline knows its 2000 ms).
  const start = Date.now();
  while (!(p.info().timeline[0] || {}).done) { if (Date.now() - start > 2000) throw new Error("not decoded"); await sleep(10); }
  assert.equal(Math.round(p.info().timeline[0].length), 2000);
  // 1500 ms in: 500 left, under the lead and the early mark at once.
  p.report({ session: 1, position: 1500, state: "playing" });
  await core.waitFor(() => count(core, "STMd") === 1 && count(core, "STMu") === 1, 2000, "STMd and the early STMu");
  core.send("strm", strm({ cmd: "t", gain: 7 }));
  await core.waitFor(() => stmts(core, "STMt").some((m) => m.payload.readUInt32BE(47) === 7));
  assert.equal(stmts(core, "STMt").find((m) => m.payload.readUInt32BE(47) === 7).payload.readUInt32BE(43), 0, "elapsed 0 after the early STMu");
  // Roon's way to its next stream: stop, stop, start. The stops are not obeyed; the stream joins session 1.
  core.send("strm", strm({ cmd: "q" }));
  core.send("strm", strm({ cmd: "q" }));
  core.send("strm", req("/b", core.streamPort));
  await core.waitFor(() => core.got.filter((m) => m.op === "DSCO").length === 2);
  assert.equal(sent.filter((c) => c.op === "stop").length, 0);
  assert.equal(sent.filter((c) => c.op === "open").length, 1, "no new session: the same one goes on");
  while (p.info().timeline.length < 2 || !p.info().timeline[1].done) await sleep(10);
  assert.deepEqual(p.info().timeline.map((r) => Math.round(r.length)), [2000, 20000]);
  // The phone crosses into the second stream: STMs, and elapsed counts from its start.
  p.report({ session: 1, position: 2300, state: "playing" });
  await core.waitFor(() => count(core, "STMs") === 2, 2000, "the second STMs");
  core.send("strm", strm({ cmd: "t", gain: 8 }));
  await core.waitFor(() => stmts(core, "STMt").some((m) => m.payload.readUInt32BE(47) === 8));
  const el = stmts(core, "STMt").find((m) => m.payload.readUInt32BE(47) === 8).payload.readUInt32BE(43);
  assert.ok(el >= 300 && el < 600, "elapsed in the second stream: " + el);
  // Pause, play and volume go to the phone.
  core.send("strm", strm({ cmd: "p" }));
  core.send("strm", strm({ cmd: "u" }));
  const g = Buffer.alloc(18); g.writeUInt32BE(0x8000, 10); g.writeUInt32BE(0x8000, 14);
  core.send("audg", g);
  await sleep(100);
  assert.deepEqual(sent.slice(1).map((c) => c.op), ["pause", "play", "volume"]);
  assert.equal(sent[3].gain, 0.5);
  // A stop past the early window is a stop.
  await sleep(3000);
  core.send("strm", strm({ cmd: "q" }));
  await core.waitFor(() => count(core, "STMf") === 3);
  assert.deepEqual(sent[sent.length - 1], { op: "stop" });
  assert.equal(p.info().session, null);
});

test("the phone ran out with no early STMu said: the real STMu; a session ended by Roon's stop is no longer kept for a new one", async (t) => {
  const { core, p, sent } = await setup(t, { "/a": flac(44100, 16, 50000) });
  p.start();
  await core.waitFor(() => core.got.some((m) => m.op === "HELO"));
  core.send("strm", req("/a", core.streamPort));
  await core.waitFor(() => core.got.some((m) => m.op === "DSCO"));
  p.report({ session: 1, position: 0, state: "playing" });
  p.report({ session: 1, position: 49990, state: "ended" });
  await core.waitFor(() => count(core, "STMu") === 1, 2000, "STMu");
  assert.equal(sent[0].op, "open");
});

test("lossless: a new rate waits for the phone to finish the old session, then opens the next", async (t) => {
  const { core, p, sent } = await setup(t, { "/cd": flac(44100, 16, 1000), "/hi": flac(96000, 24, 1000) }, "lossless");
  p.start();
  await core.waitFor(() => core.got.some((m) => m.op === "HELO"));
  core.send("strm", req("/cd", core.streamPort));
  await core.waitFor(() => core.got.some((m) => m.op === "DSCO"));
  p.report({ session: 1, position: 0, state: "playing" });
  core.send("strm", req("/hi", core.streamPort));
  await core.waitFor(() => core.got.filter((m) => m.op === "DSCO").length === 2);
  assert.equal(sent.filter((c) => c.op === "open").length, 1, "not yet: the phone still plays session 1");
  assert.equal(p.info().pending, 2);
  p.report({ session: 1, position: 1000, state: "ended" });
  assert.deepEqual(sent[sent.length - 1], { op: "open", session: 2, url: "/api/phone/audio?device_id=" + ID + "&session=2", play: true });
  assert.equal(p.session(2).quality, "lossless");
  assert.equal(p.session(2).rate, 96000);
});
