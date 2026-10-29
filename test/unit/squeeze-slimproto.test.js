"use strict";
// v1.9.72-t1: the Squeezebox player protocol's bytes (lib/squeeze/slimproto.js; dev/design/android-app.md §4.1 A).
// The layouts are Squeezelite's slimproto.h; a field one byte off is a player Roon never answers, so each is pinned
// at its offset.
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../../lib/squeeze/slimproto");
const { strm } = require("../lib/fake-squeeze-core");

const MAC = Buffer.from([0x02, 0x52, 0x6f, 0x75, 0x65, 0x6e]);

test("HELO: opcode, length, device id 12, the MAC at 2, the reconnect flag, then the capabilities", () => {
  const b = P.helo({ mac: MAC, caps: "Model=squeezelite,flc" });
  assert.equal(b.toString("latin1", 0, 4), "HELO");
  assert.equal(b.readUInt32BE(4), b.length - 8);
  const p = b.subarray(8);
  assert.equal(p[0], 12);
  assert.deepEqual(p.subarray(2, 8), MAC);
  assert.equal(p.readUInt16BE(24), 0);
  assert.equal(p.toString("latin1", 34, 36), "en");
  assert.equal(p.toString("latin1", 36), "Model=squeezelite,flc");
  assert.equal(P.helo({ mac: MAC, caps: "", reconnect: true }).subarray(8).readUInt16BE(24), 0x4000);
  assert.throws(() => P.helo({ mac: Buffer.alloc(5), caps: "" }), /6 bytes/);
});

test("STAT: 53 bytes; the event first, elapsed in seconds at 37 and in ms at 43, the server's timestamp at 47", () => {
  const b = P.stat("STMt", { elapsedMs: 61234, serverTimestamp: 0xdeadbeef, bytesReceived: 2 ** 33 + 5, jiffies: 99,
    bufferSize: 2048, outputFull: 7 });
  assert.equal(b.toString("latin1", 0, 4), "STAT");
  assert.equal(b.readUInt32BE(4), 53);
  const p = b.subarray(8);
  assert.equal(p.length, 53);
  assert.equal(p.toString("latin1", 0, 4), "STMt");
  assert.equal(p.readUInt32BE(7), 2048);
  assert.equal(p.readUInt32BE(15), 2);          // bytes received, high word
  assert.equal(p.readUInt32BE(19), 5);          // and low
  assert.equal(p.readUInt16BE(23), 0xffff);
  assert.equal(p.readUInt32BE(25), 99);
  assert.equal(p.readUInt32BE(33), 7);
  assert.equal(p.readUInt32BE(37), 61);
  assert.equal(p.readUInt32BE(43), 61234);
  assert.equal(p.readUInt32BE(47), 0xdeadbeef);
});

test("strm: every field at its offset, PCM's codes decoded, the request verbatim", () => {
  const s = P.parseStrm(strm({ format: "p", size: "1", rate: "3", ch: "2", endian: "1", threshold: 10, port: 9100,
    ip: [192, 168, 1, 20], request: "GET /stream.pcm HTTP/1.0\r\n\r\n" }));
  assert.equal(s.command, "start");
  assert.equal(s.format, "pcm");
  assert.equal(s.sampleSize, 16);
  assert.equal(s.sampleRate, 44100);
  assert.equal(s.channels, 2);
  assert.equal(s.endian, "1");
  assert.equal(s.threshold, 10);
  assert.equal(s.transitionPeriod, 3);
  assert.equal(s.transitionType, "1");
  assert.equal(s.serverPort, 9100);
  assert.equal(s.serverIp, "192.168.1.20");
  assert.equal(s.request, "GET /stream.pcm HTTP/1.0\r\n\r\n");
  // The rates past "9" (Squeezelite's table): ":" 88200, "<" 192000.
  assert.equal(P.parseStrm(strm({ rate: ":" })).sampleRate, 88200);
  assert.equal(P.parseStrm(strm({ rate: "<" })).sampleRate, 192000);
  assert.equal(P.parseStrm(strm({ size: "2" })).sampleSize, 24);
  const f = P.parseStrm(strm({}));
  assert.equal(f.format, "flac");
  assert.equal(f.sampleRate, null);
  assert.equal(f.serverIp, "0.0.0.0");
  assert.equal(P.parseStrm(strm({ cmd: "t", gain: 1234 })).replayGain, 1234);
  assert.throws(() => P.parseStrm(Buffer.alloc(10)), /24 bytes/);
});

test("the reader takes server frames however the bytes arrive: split, and two in one piece", () => {
  const one = (op, data) => { const h = Buffer.alloc(2); h.writeUInt16BE(4 + data.length); return Buffer.concat([h, Buffer.from(op), data]); };
  const all = Buffer.concat([one("strm", Buffer.alloc(24, 0x30)), one("setd", Buffer.from([0])), one("vers", Buffer.from("7.999"))]);
  const r = P.createReader();
  const got = [];
  for (let i = 0; i < all.length; i += 5) got.push(...r.push(all.subarray(i, i + 5)));
  assert.deepEqual(got.map((m) => m.op), ["strm", "setd", "vers"]);
  assert.equal(got[0].data.length, 24);
  assert.deepEqual(got[1].data, Buffer.from([0]));
  assert.equal(got[2].data.toString(), "7.999");
});

test("audg: the new gains, 16.16, unity as 1", () => {
  const d = Buffer.alloc(18);
  d[8] = 1;
  d.writeUInt32BE(0x10000, 10);
  d.writeUInt32BE(0x8000, 14);
  assert.deepEqual(P.parseAudg(d), { adjust: true, left: 1, right: 0.5 });
  assert.equal(P.parseAudg(Buffer.alloc(4)), null);
});

test("SETD answers the server's name ask with id 0 and the name", () => {
  const b = P.setdName("Rouen probe");
  assert.equal(b.toString("latin1", 0, 4), "SETD");
  assert.equal(b[8], 0);
  assert.equal(b.toString("utf8", 9), "Rouen probe\0");
});

/** A FLAC STREAMINFO for rate, channels, bits and samples. */
function flacHead(rate, channels, bits, samples) {
  const b = Buffer.alloc(42);
  b.write("fLaC", 0, "latin1");
  b[4] = 0x80;                                  // last block, type 0 (STREAMINFO)
  b.writeUIntBE(34, 5, 3);
  const s = b.subarray(8);
  s[10] = rate >> 12; s[11] = (rate >> 4) & 0xff;
  s[12] = ((rate & 0x0f) << 4) | ((channels - 1) << 1) | ((bits - 1) >> 4);
  s[13] = (((bits - 1) & 0x0f) << 4) | Math.floor(samples / 0x100000000);
  s.writeUInt32BE(samples % 0x100000000, 14);
  return b;
}

test("flacInfo: rate, channels, bits and length from STREAMINFO; no length when the stream gives 0 samples", () => {
  assert.deepEqual(P.flacInfo(flacHead(44100, 2, 16, 44100 * 200)), { rate: 44100, channels: 2, bits: 16, seconds: 200 });
  assert.deepEqual(P.flacInfo(flacHead(192000, 2, 24, 192000 * 3)), { rate: 192000, channels: 2, bits: 24, seconds: 3 });
  assert.equal(P.flacInfo(flacHead(96000, 2, 24, 0)).seconds, null);
  assert.equal(P.flacInfo(Buffer.from("not flac at all, and long enough to be read as a header")), null);
  assert.equal(P.flacInfo(flacHead(44100, 2, 16, 1).subarray(0, 30)), null);
});
