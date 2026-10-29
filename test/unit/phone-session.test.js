"use strict";
// v1.9.72-t5: a phone's session (lib/phone/session.js; dev/design/android-app.md §4.9) — Roon's streams, in order,
// into one stream for the phone, each stream's place in it known from the sound it decoded.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSession } = require("../../lib/phone/session");
const { fakeSpawn } = require("../lib/fake-ffmpeg");

const tick = () => new Promise((r) => { setImmediate(r); });
async function until(test, ms = 2000) { const end = Date.now() + ms; while (!test()) { if (Date.now() > end) throw new Error("timed out"); await new Promise((r) => { setTimeout(r, 10); }); } }

function sink() {
  const chunks = [];
  const handlers = {};
  return { chunks, ended: false, write(b) { chunks.push(Buffer.from(b)); return true; }, end() { this.ended = true; },
    once() {}, on(ev, f) { handlers[ev] = f; }, close() { if (handlers.close) handlers.close(); },
    text() { return Buffer.concat(chunks).toString("latin1"); } };
}

test("Opus: two of Roon's streams become one, in order, the second held until the first is done; the encoder and decoders get Mandarin's arguments", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phone-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const seen = [];
  const s = createSession({ ffmpeg: "ffmpeg", spawn: fakeSpawn(seen) }, { n: 1, quality: "opus", file: path.join(dir, "s1.ogg") });
  const enc = seen[0].args.join(" ");
  assert.match(enc, /-f f32le -ar 48000 -ac 2 -i pipe:0 -c:a libopus -b:a 256k -vbr on -f ogg pipe:1/);
  const a = s.add(() => {}), b = s.add(() => {});
  assert.match(seen[1].args.join(" "), /-f flac -i pipe:0 -af aresample=resampler=soxr:precision=28:osr=48000 -ac 2 -f f32le pipe:1/);
  // The second arrives first and all at once; it must wait for the first.
  b.feed(Buffer.alloc(384 * 500, 0x62)); b.end();
  a.feed(Buffer.alloc(384 * 1000, 0x61));
  await tick();
  a.feed(Buffer.alloc(384 * 1000, 0x61)); a.end();
  s.end();
  await until(() => s.finished);
  const out = fs.readFileSync(path.join(dir, "s1.ogg"));
  assert.equal(out.length, 384 * 2500);
  assert.equal(out.indexOf(0x62), 384 * 2000, "the second stream's sound follows all of the first's");
  assert.deepEqual(s.timeline(), [{ index: 0, start: 0, length: 2000, done: true }, { index: 1, start: 2000, length: 500, done: true }]);
});

test("lossless keeps the source's rate: 16-bit sources stay 16-bit, 24-bit ones go as 24 in 32", () => {
  const seen = [];
  const s16 = createSession({ ffmpeg: "ffmpeg", spawn: fakeSpawn(seen) }, { n: 1, quality: "lossless", file: path.join(os.tmpdir(), "x16.flac"), rate: 44100, bits: 16 });
  assert.match(seen[0].args.join(" "), /-f s16le -ar 44100 -ac 2 -i pipe:0 -c:a flac -sample_fmt s16 -f flac pipe:1/);
  assert.equal(s16.bits, 16);
  s16.add(() => {});
  assert.match(seen[1].args.join(" "), /-f flac -i pipe:0 -ac 2 -f s16le pipe:1/);
  const s24 = createSession({ ffmpeg: "ffmpeg", spawn: fakeSpawn(seen) }, { n: 2, quality: "lossless", file: path.join(os.tmpdir(), "x24.flac"), rate: 96000, bits: 24 });
  assert.match(seen[2].args.join(" "), /-f s32le -ar 96000 -ac 2 -i pipe:0 -c:a flac -sample_fmt s32 -bits_per_raw_sample 24 -f flac pipe:1/);
  assert.equal(s24.rate, 96000);
  s16.close(); s24.close();
});

test("pipeTo sends the session as it is made, waits while it grows, and ends with it", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phone-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const s = createSession({ ffmpeg: "ffmpeg", spawn: fakeSpawn() }, { n: 3, quality: "opus", file: path.join(dir, "s3.ogg") });
  const a = s.add(() => {});
  const res = sink();
  s.pipeTo(res);
  a.feed(Buffer.from("first-"));
  await until(() => res.text() === "first-");
  assert.equal(res.ended, false, "still being made: the reader waits");
  a.feed(Buffer.from("second")); a.end(); s.end();
  await until(() => res.ended);
  assert.equal(res.text(), "first-second");
  // A reader that comes after it is all made gets all of it.
  const late = sink();
  s.pipeTo(late);
  await until(() => late.ended);
  assert.equal(late.text(), "first-second");
});

test("close stops it: decoders and encoder killed, readers ended, and what is fed after is dropped", async () => {
  const seen = [];
  const s = createSession({ ffmpeg: "ffmpeg", spawn: fakeSpawn(seen) }, { n: 4, quality: "opus", file: path.join(os.tmpdir(), "s4.ogg") });
  const a = s.add(() => {});
  const res = sink();
  s.pipeTo(res);
  s.close();
  assert.equal(s.closed, true);
  assert.equal(a.feed(Buffer.from("late")), true);
  await until(() => res.ended);
  assert.ok(seen.every((p) => p.child.killed));
});
