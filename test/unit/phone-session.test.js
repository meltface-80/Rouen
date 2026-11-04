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
  // Read as the phone reads it (pipeTo), not straight from the file: "finished" is the encoder's close, and the file's
  // last writes can still be on their way to the disk then. Read at once, under load, it was short (786432 of 960000
  // bytes, 2.0.1's check); pipeTo reads on until every byte written is sent.
  const got = sink();
  const how = await new Promise((r) => { s.pipeTo(got, r); });
  assert.equal(how.why, "all sent");
  const out = Buffer.concat(got.chunks);
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

test("a reader that comes before the session's file is open waits for it, not ends at once (v1.9.72-t9)", async (t) => {
  // The file is opened in the background (fs.createWriteStream). Read before it exists, and the read fails with ENOENT:
  // the reader was ended with nothing, so a phone asking at once got an empty stream (found as a test timing out on a
  // busy machine). Here the file opens 150 ms late, as it can on a busy one.
  const { Writable } = require("node:stream");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phone-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lateFs = Object.assign({}, fs, {
    createWriteStream(file) {
      let real = null;
      const held = [];
      const w = new Writable({ write(chunk, enc, done) { if (real) real.write(chunk, done); else { held.push(chunk); done(); } },
        final(done) { const go = () => real.end(done); if (real) go(); else w.once("open", go); } });
      setTimeout(() => { real = fs.createWriteStream(file); real.once("open", () => { for (const c of held) real.write(c); w.emit("open"); }); }, 150);
      return w;
    },
  });
  const s = createSession({ ffmpeg: "ffmpeg", spawn: fakeSpawn(), fs: lateFs }, { n: 5, quality: "opus", file: path.join(dir, "s5.ogg") });
  const a = s.add(() => {});
  a.feed(Buffer.from("early"));
  const res = sink();
  await until(() => s.bytes === 5);
  s.pipeTo(res);
  await until(() => res.text() === "early" || res.ended);
  assert.equal(res.ended, false, "ended before the file was there");
  assert.equal(res.text(), "early");
  a.end(); s.end();
  await until(() => res.ended);
  assert.equal(res.text(), "early");
});

test("pipeTo says how each reader's sending ended: all sent, the session stopped, or the phone gone (v1.9.72-t17)", async (t) => {
  // For the trail: the owner's log of 2026-10-29 had a lossless session stall after 12 s at home, and nothing on Rouen's
  // side said whether the session stopped growing or the phone stopped taking it.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phone-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ends = [];
  const s = createSession({ ffmpeg: "ffmpeg", spawn: fakeSpawn() }, { n: 6, quality: "opus", file: path.join(dir, "s6.ogg") });
  const a = s.add(() => {});
  const all = sink(), gone = sink();
  s.pipeTo(all, (e) => ends.push(["all", e.sent, e.why]));
  s.pipeTo(gone, (e) => ends.push(["gone", e.sent, e.why]));
  a.feed(Buffer.from("abcd"));
  await until(() => all.text() === "abcd" && gone.text() === "abcd");
  gone.close();
  a.end(); s.end();
  await until(() => all.ended && ends.length === 2);
  assert.deepEqual(ends, [["gone", 4, "the phone left"], ["all", 4, "all sent"]]);
  const stopped = createSession({ ffmpeg: "ffmpeg", spawn: fakeSpawn() }, { n: 7, quality: "opus", file: path.join(dir, "s7.ogg") });
  const b = stopped.add(() => {});
  const cut = sink();
  stopped.pipeTo(cut, (e) => ends.push(["cut", e.sent, e.why]));
  b.feed(Buffer.from("xy"));
  await until(() => cut.text() === "xy");
  stopped.close();
  await until(() => ends.length === 3);
  assert.deepEqual(ends[2], ["cut", 2, "the session was stopped"]);
});

test("pace: the segment whose turn it is, timed from its turn — a held one is not; onDone gives each one's sound once it is all in (v2.0.1-t1)", async () => {
  // The owner's stutter log (2026-11-03): Roon's streams of 458 KB in 14 s, and of 23 KB, all sent. The trail is to say
  // how fast Roon's sound came, so a stream slower than it plays is told from the phone's network.
  let clock = 1000;
  const done = [];
  const s = createSession({ ffmpeg: "ffmpeg", spawn: fakeSpawn(), now: () => clock }, { n: 8, quality: "opus", file: path.join(os.tmpdir(), "s8.ogg") });
  const a = s.add(() => {}, (d) => done.push(d));
  const b = s.add(() => {}, (d) => done.push(d));
  a.feed(Buffer.alloc(384 * 2000, 1));
  b.feed(Buffer.alloc(384 * 300, 2)); b.end();
  await until(() => s.timeline()[0].length === 2000);
  clock += 12000;
  assert.deepEqual(s.pace(), { index: 0, soundMs: 2000, wallMs: 12000 }, "2 s of sound in 12 s: slower than it plays");
  clock += 1000;
  a.end();
  await until(() => done.length >= 1);
  assert.deepEqual(done[0], { index: 0, soundMs: 2000, turnMs: 13000 });
  await until(() => done.length === 2);
  assert.equal(done[1].index, 1);
  assert.ok(done[1].soundMs <= 300 && done[1].turnMs === 0, "the second was held until its turn, and timed from it");
  assert.equal(s.pace(), null, "every segment so far is decoded");
  s.close();
});

test("pace: a segment that comes faster than it plays, and a closed session's segments, say nothing slow (v2.0.1-t1)", async () => {
  let clock = 0;
  const done = [];
  const s = createSession({ ffmpeg: "ffmpeg", spawn: fakeSpawn(), now: () => clock }, { n: 9, quality: "opus", file: path.join(os.tmpdir(), "s9.ogg") });
  const a = s.add(() => {}, (d) => done.push(d));
  a.feed(Buffer.alloc(384 * 30000, 1));
  await until(() => s.timeline()[0].length === 30000);
  clock += 11000;
  const p = s.pace();
  assert.ok(p && p.soundMs > p.wallMs, "30 s of sound in 11 s");
  s.close();
  await tick(); await tick();
  assert.equal(s.pace(), null);
  assert.deepEqual(done, [], "a session closed first says nothing of its segments' sound");
});
