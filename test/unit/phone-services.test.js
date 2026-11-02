"use strict";
// v1.9.72-t64: your TIDAL albums on This phone (lib/services/phone.js; dev/design/android-app.md §4.22, "TIDAL and
// Qobuz"). Everything on fakes: TIDAL's answers, ffmpeg, the network — no account, no service, no audio.

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { mountPhoneServices, ffmpegArgs } = require("../../lib/services/phone");

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const BTS = (url) => ({ manifestMimeType: "application/vnd.tidal.bt", manifest: b64(JSON.stringify({ urls: [url], mimeType: "audio/flac", codecs: "flac", encryptionType: "NONE" })) });
const DASH = (protect) => ({ manifestMimeType: "application/dash+xml", manifest: b64(`<MPD><Period><AdaptationSet mimeType="audio/mp4">${protect ? "<ContentProtection/>" : ""}<Representation id="r" codecs="flac" audioSamplingRate="96000"><SegmentTemplate initialization="https://t/0.mp4" media="https://t/$Number$.mp4" startNumber="1"><SegmentTimeline><S d="1" r="1"/></SegmentTimeline></SegmentTemplate></Representation></AdaptationSet></Period></MPD>`) });

/** A world: the routes mounted on fakes; [tiers] TIDAL's answer per tier. */
function world({ tiers = {}, albumId = "77646290", ffmpeg = "/usr/bin/ffmpeg", ffmpegFails = false, slowTidal = null } = {}) {
  const routes = {};
  const app = { get: (p, h) => { routes[p] = h; } };
  const asked = { tracks: 0, tiers: [], fetched: [], spawned: [] };
  const tidal = {
    getAlbumTracks: async (t, cc, id) => { asked.tracks++; return id === "77646290" ? { id, tracks: [{ id: 101, title: "Intro", duration: 61, number: 1 }, { id: 102, title: "Ligne", duration: 200, number: 2 }] } : { id, tracks: [] }; },
    getPlaybackInfo: async (t, cc, trackId, tier) => { asked.tiers.push([trackId, tier]); if (slowTidal) await slowTidal; return tiers[tier] || {}; },
  };
  const spawn = (exe, args) => {
    const p = new EventEmitter();
    p.stdin = new PassThrough(); p.stdout = new PassThrough();
    p.fed = [];
    p.stdin.on("data", (c) => p.fed.push(String(c)));
    p.stdin.on("end", () => {
      if (ffmpegFails) { p.stdout.end(); setImmediate(() => p.emit("close", 1)); return; }
      p.stdout.end("AUDIO"); setImmediate(() => p.emit("close", 0));
    });
    p.kill = () => { p.killed = true; };
    asked.spawned.push({ exe, args, p });
    return p;
  };
  const fetch = async (u) => { asked.fetched.push(u); return { ok: true, status: 200, body: [Buffer.from("<" + u + ">")] }; };
  mountPhoneServices(app, { tidalAlbumId: (title) => (title === "Instinct" ? albumId : null),
    tidalWithToken: (fn) => fn("tok", "GB"), tidal, ffmpeg: () => ffmpeg, spawn, fetch, log: () => {} });
  const call = (p, query) => new Promise((resolve) => {
    const res = new PassThrough();
    Object.assign(res, { code: 200, headers: {}, headersSent: false,
      set(h) { Object.assign(this.headers, h); return this; }, status(c) { this.code = c; return this; },
      json(b) { this.headersSent = true; resolve({ code: this.code, body: b }); } });
    const chunks = [];
    res.on("data", (c) => { res.headersSent = true; chunks.push(String(c)); });
    res.on("end", () => resolve({ code: res.code, headers: res.headers, text: chunks.join("") }));
    routes[p]({ query }, res);
    if (query.hangUp) setImmediate(() => res.emit("close"));
  });
  return { call, asked };
}

test("THE one: one of your TIDAL albums is answered as TIDAL's, with its tracks in order", async () => {
  const w = world();
  const r = await w.call("/api/phone/service/album", { title: "Instinct", artist: "Angèle" });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body, { service: "tidal", id: "77646290", title: "Instinct", artist: "Angèle", tracks: [
    { n: 1, title: "Intro", disc: 1, track: 1, length: 61 }, { n: 2, title: "Ligne", disc: 1, track: 2, length: 200 }] });
  const no = await w.call("/api/phone/service/album", { title: "Heathen", artist: "David Bowie" });
  assert.equal(no.code, 404, "an album that isn't one of your TIDAL albums is not answered as one");
  assert.equal((await w.call("/api/phone/service/album", {})).code, 400);
});

test("THE one for the audio: a track's unprotected DASH pieces go to ffmpeg in order, and the FLAC it makes is sent", async () => {
  const w = world({ tiers: { HI_RES_LOSSLESS: DASH(false) } });
  const r = await w.call("/api/phone/service/file", { service: "tidal", album: "77646290", n: "2", quality: "original" });
  assert.equal(r.text, "AUDIO");
  assert.equal(r.headers["Content-Type"], "audio/flac");
  assert.deepEqual(w.asked.tiers, [[102, "HI_RES_LOSSLESS"]], "track 2 is the album's second track, asked at hi-res");
  assert.deepEqual(w.asked.fetched, ["https://t/0.mp4", "https://t/1.mp4", "https://t/2.mp4"]);
  const { args, p } = w.asked.spawned[0];
  assert.deepEqual(p.fed, ["<https://t/0.mp4>", "<https://t/1.mp4>", "<https://t/2.mp4>"], "fed whole and in order");
  assert.deepEqual(args, ffmpegArgs("original"));
  assert.ok(args.includes("pipe:0") && args.includes("flac"));
});

test("hi-res refused as protected: lossless is asked instead; Opus asks lossless alone and makes Opus", async () => {
  const w = world({ tiers: { HI_RES_LOSSLESS: DASH(true), LOSSLESS: BTS("https://t/a.flac") } });
  const r = await w.call("/api/phone/service/file", { service: "tidal", album: "77646290", n: "1", quality: "original" });
  assert.equal(r.text, "AUDIO");
  assert.deepEqual(w.asked.tiers, [[101, "HI_RES_LOSSLESS"], [101, "LOSSLESS"]]);
  assert.deepEqual(w.asked.fetched, ["https://t/a.flac"]);
  const o = world({ tiers: { LOSSLESS: BTS("https://t/b.flac") } });
  const ro = await o.call("/api/phone/service/file", { service: "tidal", album: "77646290", n: "1", quality: "opus" });
  assert.equal(ro.headers["Content-Type"], "audio/ogg");
  assert.deepEqual(o.asked.tiers, [[101, "LOSSLESS"]]);
  assert.ok(o.asked.spawned[0].args.includes("libopus"));
});

test("nothing unprotected at any tier: refused with TIDAL's reason, and ffmpeg is never started", async () => {
  const w = world({ tiers: { HI_RES_LOSSLESS: DASH(true), LOSSLESS: DASH(true) } });
  const r = await w.call("/api/phone/service/file", { service: "tidal", album: "77646290", n: "1", quality: "original" });
  assert.equal(r.code, 502);
  assert.match(r.body.error, /protected/);
  assert.equal(w.asked.spawned.length, 0);
});

test("asked wrong, or for what isn't there: 400, 404, and no ffmpeg; the album's tracks asked once for all its tracks", async () => {
  const w = world({ tiers: { LOSSLESS: BTS("https://t/a.flac") } });
  for (const q of [{ service: "qobuz", album: "1", n: "1" }, { service: "tidal", album: "../x", n: "1" }, { service: "tidal", album: "77646290", n: "0" },
    { service: "tidal", album: "77646290", n: "1", quality: "mp3" }]) {
    assert.equal((await w.call("/api/phone/service/file", q)).code, 400, JSON.stringify(q));
  }
  assert.equal((await w.call("/api/phone/service/file", { service: "tidal", album: "77646290", n: "9" })).code, 404);
  await w.call("/api/phone/service/file", { service: "tidal", album: "77646290", n: "1", quality: "opus" });
  await w.call("/api/phone/service/file", { service: "tidal", album: "77646290", n: "2", quality: "opus" });
  assert.equal(w.asked.tracks, 1, "the track list is kept, not asked of TIDAL for every track");
  const none = world({ ffmpeg: null });
  assert.equal((await none.call("/api/phone/service/file", { service: "tidal", album: "77646290", n: "1" })).code, 500);
});

test("THE one for failures: ffmpeg making nothing is an error the phone is told, never an empty track", async () => {
  const w = world({ tiers: { LOSSLESS: BTS("https://t/a.flac") }, ffmpegFails: true });
  const r = await w.call("/api/phone/service/file", { service: "tidal", album: "77646290", n: "1", quality: "opus" });
  assert.equal(r.code, 502);
  assert.match(r.body.error, /couldn't be read/);
});

test("the phone gone while TIDAL is still being asked: ffmpeg is never started", async () => {
  let release;
  const slowTidal = new Promise((r) => { release = r; });
  const w = world({ tiers: { LOSSLESS: BTS("https://t/a.flac") }, slowTidal });
  w.call("/api/phone/service/file", { service: "tidal", album: "77646290", n: "1", quality: "opus", hangUp: "1" });
  await new Promise((r) => { setTimeout(r, 20); });
  release();
  await new Promise((r) => { setTimeout(r, 20); });
  assert.equal(w.asked.spawned.length, 0, "an ffmpeg was started for a phone that had gone");
});
