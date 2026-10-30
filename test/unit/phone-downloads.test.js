"use strict";
// ---------------------------------------------------------------------------
// v1.9.72-t27: Rouen's side of the Android app's downloads (lib/phone/downloads.js; dev/design/android-app.md §4.6,
// §4.19). An album's files from its folder in /music (the label scan's, as the credits find it), in the album's order;
// each track as stored, with Range so a download resumes, or Opus 256 made by ffmpeg as it is sent; an album not in
// /music refused with why (local files only, the owner).
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const express = require("express");
const { createDownloads, mountDownloads, NOT_HERE } = require("../../lib/phone/downloads");

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-dl-"));
// Named out of order, and tagged: disc 2's first track sorts after disc 1's, whatever the names say.
const FILES = {
  "b.flac": { disc: 1, track: 2, title: "Second", duration: 200.4 },
  "a.flac": { disc: 1, track: 1, title: "First", duration: 100 },
  "0.flac": { disc: 2, track: 1, title: "Third", duration: 300 },
  "cover.jpg": null, "notes.txt": null,
};
for (const [name, tags] of Object.entries(FILES)) fs.writeFileSync(path.join(DIR, name), tags ? "FLAC-" + name + "-0123456789" : "x");

/** spawned: the ffmpeg runs asked for; o.opus: what the fake ffmpeg writes ("" for nothing), o.code its exit. */
function rig(o = {}) {
  const spawned = [];
  const spawn = (bin, args) => {
    const p = new EventEmitter();
    p.stdout = new PassThrough(); p.exitCode = null;
    p.kill = () => { p.killed = true; };
    spawned.push({ bin, args, p });
    setImmediate(() => {
      if (o.noFfmpeg) { p.emit("error", new Error("ENOENT")); p.stdout.end(); p.exitCode = -2; p.emit("close", -2); return; }
      if (o.opus) p.stdout.write(o.opus);
      p.stdout.end(); p.exitCode = o.code || 0; p.emit("close", o.code || 0);
    });
    return p;
  };
  const dl = createDownloads({
    dirOf: (title, artist) => (title === "Album" && artist === "Artist" ? DIR : null),
    readdir: (d) => fs.readdirSync(d),
    parseFile: async (f) => { const t = FILES[path.basename(f)]; return { common: { title: t.title, disk: { no: t.disc }, track: { no: t.track } }, format: { duration: t.duration } }; },
    size: (f) => fs.statSync(f).size,
  });
  const app = express();
  mountDownloads(app, dl, { ffmpeg: () => "/usr/bin/ffmpeg", spawn });
  const server = http.createServer(app);
  const ready = new Promise((r) => { server.listen(0, "127.0.0.1", r); });
  /** @returns {Promise<{ status: number, headers: any, body: Buffer }>} */
  const get = async (p, headers = {}) => {
    await ready;
    return new Promise((resolve, reject) => {
      http.get({ host: "127.0.0.1", port: server.address().port, path: p, headers }, (res) => {
        const parts = []; res.on("data", (b) => parts.push(b)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }));
      }).on("error", reject);
    });
  };
  return { get, spawned, close: () => server.close() };
}
const json = (r) => JSON.parse(r.body.toString("utf8"));
const Q = "title=Album&artist=Artist";

test("THE one: the album's tracks from its folder, in the album's order, audio files only", async () => {
  const w = rig();
  try {
    const r = await w.get("/api/phone/album?" + Q);
    assert.equal(r.status, 200);
    const a = json(r);
    assert.equal(a.title, "Album"); assert.equal(a.artist, "Artist");
    assert.deepEqual(a.tracks.map((t) => [t.n, t.title, t.disc, t.track, t.length, t.ext]),
      [[1, "First", 1, 1, 100, "flac"], [2, "Second", 1, 2, 200, "flac"], [3, "Third", 2, 1, 300, "flac"]]);
    assert.equal(a.tracks[0].bytes, fs.statSync(path.join(DIR, "a.flac")).size);
    assert.ok(!JSON.stringify(a).includes(DIR), "the server's own paths are not handed out");
  } finally { w.close(); }
});

test("an album not in /music (TIDAL, Qobuz, a folder the scan did not keep) is refused, saying why", async () => {
  const w = rig();
  try {
    const r = await w.get("/api/phone/album?title=Streamed&artist=Someone");
    assert.equal(r.status, 404);
    assert.equal(json(r).error, NOT_HERE);
    assert.equal((await w.get("/api/phone/album/file?title=Streamed&artist=Someone&n=1&quality=original")).status, 404);
    assert.equal((await w.get("/api/phone/album?artist=Artist")).status, 400);
  } finally { w.close(); }
});

test("THE one for a track: the file as stored, its type, and a Range answered so a download resumes", async () => {
  const w = rig();
  try {
    const whole = await w.get("/api/phone/album/file?" + Q + "&n=2&quality=original");
    assert.equal(whole.status, 200);
    assert.equal(whole.headers["content-type"], "audio/flac");
    assert.equal(whole.body.toString(), fs.readFileSync(path.join(DIR, "b.flac"), "utf8"));
    const rest = await w.get("/api/phone/album/file?" + Q + "&n=2&quality=original", { Range: "bytes=5-" });
    assert.equal(rest.status, 206);
    assert.equal(rest.body.toString(), fs.readFileSync(path.join(DIR, "b.flac"), "utf8").slice(5));
    assert.equal(w.spawned.length, 0, "no ffmpeg for the original");
  } finally { w.close(); }
});

test("Opus 256: made by ffmpeg from the track's file, at 48 kHz, as it is sent", async () => {
  const w = rig({ opus: "OggS-made" });
  try {
    const r = await w.get("/api/phone/album/file?" + Q + "&n=3&quality=opus");
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-type"], "audio/ogg");
    assert.equal(r.body.toString(), "OggS-made");
    const args = w.spawned[0].args;
    assert.equal(args[args.indexOf("-i") + 1], path.join(DIR, "0.flac"));
    for (const [k, v] of [["-c:a", "libopus"], ["-b:a", "256k"], ["-ar", "48000"], ["-f", "ogg"]]) assert.equal(args[args.indexOf(k) + 1], v, k);
  } finally { w.close(); }
});

test("no ffmpeg, or ffmpeg making nothing: an error saying so, not an empty track", async () => {
  const none = rig({ noFfmpeg: true });
  try {
    const r = await none.get("/api/phone/album/file?" + Q + "&n=1&quality=opus");
    assert.equal(r.status, 500);
    assert.match(json(r).error, /no ffmpeg/);
  } finally { none.close(); }
  const failed = rig({ opus: "", code: 1 });
  try {
    const r = await failed.get("/api/phone/album/file?" + Q + "&n=1&quality=opus");
    assert.equal(r.status, 500);
    assert.match(json(r).error, /ffmpeg 1/);
  } finally { failed.close(); }
});

test("a bad ask: n beyond the album, n not a number, a quality it doesn't make", async () => {
  const w = rig();
  try {
    const beyond = await w.get("/api/phone/album/file?" + Q + "&n=9&quality=original");
    assert.equal(beyond.status, 404);
    assert.match(json(beyond).error, /3 tracks/);
    assert.equal((await w.get("/api/phone/album/file?" + Q + "&n=0&quality=original")).status, 400);
    assert.equal((await w.get("/api/phone/album/file?" + Q + "&n=..%2F..%2Fetc&quality=original")).status, 400);
    assert.equal((await w.get("/api/phone/album/file?" + Q + "&n=1&quality=mp3")).status, 400);
  } finally { w.close(); }
});
