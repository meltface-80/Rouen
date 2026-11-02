"use strict";
// ---------------------------------------------------------------------------
// The waveforms (lib/wave/), moved out of index.js unchanged in v1.9.72-t61.
//
// Everything runs on fakes: a history database that is a Map, an ffmpeg that answers what each test says, Qobuz and
// TIDAL clients that answer from a table, and a fetch that hands back a few bytes — no network, no Core, no service.
// The keys are index.js's own albumKey / albumKeys / favouriteTitleForms, extracted, so an album id is looked up in
// the key space it is filed under for real. What is pinned is what the move must not change: what is stored and
// under which key, who shares a decode, what is said once, which credentials are tried in which order, what each
// route answers, and that index.js hands each getter the variable of its own name.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadIndexFunctions, indexSource } = require("../lib/extract");
const { createWaveforms } = require("../../lib/wave");
const { createWaveformStore } = require("../../lib/wave/store");
const WF = require("../../lib/waveform");

const K = loadIndexFunctions(["normalize", "canonText", "canonArtist", "albumKey", "albumKeys", "albumTitleVariants",
  "favouriteTitleForms"], {});

/** Runs fn with console.log/error captured; resolves to { value, out, err }. */
async function quietly(fn) {
  const out = [], err = [];
  const log = console.log, error = console.error;
  console.log = (...a) => { out.push(a.join(" ")); };
  console.error = (...a) => { err.push(a.join(" ")); };
  try { return { value: await fn(), out, err }; } finally { console.log = log; console.error = error; }
}

function deferred() { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; }
const tick = () => new Promise((r) => { setImmediate(r); });

/** The `waveforms` table, as a Map behind prepare(). */
function fakeDb() {
  const rows = new Map();
  return { rows, prepare(sql) {
    return {
      get: (k) => (/COUNT/.test(sql) ? { c: rows.size } : rows.get(k)),
      run: (k, peaks, n) => { if (/DELETE/.test(sql)) rows.clear(); else rows.set(k, { peaks, n }); },
    };
  } };
}

const QALBUM = { title: "Kind of Blue", tracks: [{ id: 11, title: "So What", duration: 545 }, { id: 12, title: "Blue in Green", duration: 337 }] };

/** Everything index.js hands in, as fakes; `s` is the state the getters read and the setters write. */
function world(over) {
  const s = Object.assign({
    on: true, db: fakeDb(), zones: {}, localAlbumKeys: new Set(), localAlbumDirs: new Map(),
    qobuzAlbumKeys: new Set(), tidalAlbumKeys: new Set(), qobuzAlbumIds: new Map(), tidalAlbumIds: new Map(),
    qobuzAppSecret: "", qobuzSignAppId: "", qobuzSignToken: "", qobuzWaveToken: "", qobuzWaveUser: "", qobuzWaveName: "",
    qobuzToken: "", qobuzUsername: "", qobuzPasswordMd5: "", signTok: null, signTokAt: 7, tidalOn: false, minted: null,
    saved: [], said: new Set(), local: {}, files: {}, queue: [], peeks: 0, persisted: {}, asked: [], searches: 0,
    decode: async () => new Uint8Array([10, 20, 30]), decodeError: "", probe: { ok: true, source: "npm", version: "6.1" },
    fileUrl: () => ({ url: "https://audio.example/x.mp3" }),
  }, over);
  const qobuz = {
    APP_ID: "own-app",
    getAlbumResult: async (t, id, ms, appId) => { s.asked.push(["album", t, id, appId]); return s.qobuzAlbum ? s.qobuzAlbum(t) : { album: QALBUM }; },
    getFileUrlResult: async (t, trackId, secret, o) => { s.asked.push(["url", t, trackId, secret, o.appId]); return s.fileUrl(t); },
    searchCatalog: async () => { s.searches++; if (s.searchFails) throw new Error("429"); return { albums: { items: s.searchItems || [] } }; },
    describeQobuzError: (e) => "qobuz said " + e.message, describeFileUrlError: (e) => "url said " + e.message,
    login: async () => ({ token: "minted-now" }),
  };
  const tidal = {
    getAlbumTracks: async (t, cc, id) => (s.tidalAlbum === undefined ? { tracks: QALBUM.tracks } : s.tidalAlbum),
    getTrackStream: async () => ({ url: "https://tidal.example/x.flac" }),
  };
  const d = {
    DEBUG: false, MUSIC_DIR: "/music", persisted: s.persisted, qobuz, tidal, QOA: { APP_ID: "oauth-app", APP_SECRET: "oauth-secret" },
    WFD: { DECODE_RATE: 44100, DECODE_CHANNELS: 2, decodeWaveform: (f, o) => s.decode(f, o), lastDecodeError: () => s.decodeError,
      ffmpegProbe: async () => s.probe, ffmpegPath: () => "/usr/bin/ffmpeg" },
    labelsDb: () => s.db, waveformEnabled: () => s.on, setWaveformEnabled: (on) => { s.on = on; }, zones: () => s.zones,
    localAlbumKeys: () => s.localAlbumKeys, localAlbumDirs: () => s.localAlbumDirs, qobuzAlbumKeys: () => s.qobuzAlbumKeys,
    tidalAlbumKeys: () => s.tidalAlbumKeys, qobuzAlbumIds: () => s.qobuzAlbumIds, tidalAlbumIds: () => s.tidalAlbumIds,
    qobuzFavouritesRead: () => 3, qobuzFavouritesTotal: () => 3, tidalFavouritesRead: () => 0, tidalFavouritesTotal: () => 0,
    qobuzAppSecret: () => s.qobuzAppSecret, setQobuzAppSecret: (v) => { s.qobuzAppSecret = v; },
    qobuzSignAppId: () => s.qobuzSignAppId, setQobuzSignAppId: (v) => { s.qobuzSignAppId = v; },
    qobuzSignToken: () => s.qobuzSignToken, setQobuzSignToken: (v) => { s.qobuzSignToken = v; },
    qobuzWaveToken: () => s.qobuzWaveToken, qobuzWaveUser: () => s.qobuzWaveUser, qobuzWaveName: () => s.qobuzWaveName,
    qobuzToken: () => s.qobuzToken, qobuzUsername: () => s.qobuzUsername, qobuzPasswordMd5: () => s.qobuzPasswordMd5,
    qobuzSignTok: () => s.signTok, setQobuzSignTok: (v) => { s.signTok = v; }, setQobuzSignTokAt: (v) => { s.signTokAt = v; },
    albumKeys: K.albumKeys, albumKey: K.albumKey, canonArtist: K.canonArtist, favouriteTitleForms: K.favouriteTitleForms,
    qobuzReady: () => !!(s.qobuzWaveToken || s.qobuzToken), tidalReady: () => s.tidalOn,
    qobuzWithToken: (fn) => fn(s.qobuzToken || "own-token"), tidalWithToken: (fn) => fn("tidal-token", "GB"),
    qobuzSigningToken: async () => s.minted,
    wfQobuzSayOnce: (k, m) => { if (s.said.has(k)) return; s.said.add(k); console.log(m); }, wfQobuzSaid: s.said,
    savePersistedSettings: (p) => { s.saved.push(p); }, musicDirMounted: () => true,
    wfAlbumKey: (album) => s.local[album] || null, wfAlbumFiles: async (k) => s.files[k] || [],
    wfResolveFile: async (k, t) => ((s.files[k] || []).find((f) => f.title === t) || { file: null }).file,
    peekQueueRaw: async () => { s.peeks++; return s.queue; },
  };
  return { s, d };
}

/** The routes, mounted on a fake app; returns call(method, path, req) and the registration order. */
function mounted(w) {
  const h = {}, order = [];
  const app = { get: (p, f) => { h["GET " + p] = f; order.push("GET " + p); }, post: (p, f) => { h["POST " + p] = f; order.push("POST " + p); } };
  const wf = createWaveforms(w.d);
  wf.mountRoutes(app);
  wf.mountSettings(app);
  const call = (key, req) => new Promise((resolve) => {
    const res = { code: 200, headers: {}, set(k, v) { this.headers[k] = v; return this; },
      status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b, headers: this.headers }); return this; } };
    h[key](Object.assign({ query: {}, body: {} }, req), res);
  });
  return { wf, call, order };
}

/** A fetch that hands back two bytes, or the status asked for. */
function withFetch(status, fn) {
  const real = global.fetch;
  const urls = [];
  global.fetch = async (url) => { urls.push(url); return { ok: status === 200, status,
    body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2])); c.close(); } }) }; };
  return Promise.resolve().then(() => fn(urls)).finally(() => { global.fetch = real; });
}

test("the store: no database is no waveform and no write; a stored row comes back; an empty one is never written", () => {
  const w = world();
  const store = createWaveformStore(w.d);
  store.wfPut("k a", new Uint8Array([1, 2, 3]));
  assert.deepEqual(store.wfGet("k a"), { peaks: WF.encode(new Uint8Array([1, 2, 3])), n: 3 });
  store.wfPut("k b", new Uint8Array([]));
  assert.equal(store.wfGet("k b"), null);
  assert.equal(store.wfGet(""), null);
  w.s.db = null;
  assert.equal(store.wfGet("k a"), null, "read with no database");
});

test("the analysis stamp: unchanged keeps every row; changed wipes them, says how many, records the new stamp", async () => {
  const w = world({ persisted: { waveformAnalysis: WF.WAVE_GEN + ":44100:2" } });
  const store = createWaveformStore(w.d);
  store.wfPut("k a", new Uint8Array([1]));
  store.wfCheckAnalysis();
  assert.equal(w.s.db.rows.size, 1);
  assert.deepEqual(w.s.saved, []);
  w.s.persisted.waveformAnalysis = "1:16000:1";
  const { out } = await quietly(() => store.wfCheckAnalysis());
  assert.equal(w.s.db.rows.size, 0);
  assert.match(out.join("\n"), /analysis 1:16000:1 → \d+:44100:2 \(gen:rate:channels\): cleared 1 stored waveform,/);
  assert.deepEqual(w.s.saved, [{ waveformAnalysis: WF.WAVE_GEN + ":44100:2", waveformRate: undefined }]);
});

test("a local track is decoded with its length, stored and returned encoded; two askers share one decode", async () => {
  const gate = deferred();
  let decodes = 0;
  const w = world({ files: { "alb||art": [{ file: "/music/a.flac", title: "So What" }] },
    decode: async (f, o) => { decodes++; assert.equal(o.expectSeconds, 545); await gate.p; return new Uint8Array([5, 6]); } });
  const { call } = mounted(w);
  w.s.local["Alb"] = "alb||art";
  const q = { track: "So What", album: "Alb", artist: "Art", length: "545" };
  const { value, out } = await quietly(async () => {
    const one = call("GET /api/waveform", { query: q });
    await tick();
    const two = call("GET /api/waveform", { query: q });   // the same track: joins, not "busy"
    await tick();
    gate.resolve();
    return Promise.all([one, two]);
  });
  assert.equal(decodes, 1, "two askers, two decodes");
  for (const r of value) assert.deepEqual(r.body, { peaks: WF.encode(new Uint8Array([5, 6])), n: 2, cached: false });
  assert.match(out.join("\n"), /\[waveform\] So What in \d+ms/);
  const again = await call("GET /api/waveform", { query: q });
  assert.deepEqual(again.body, { peaks: WF.encode(new Uint8Array([5, 6])), n: 2, cached: true });
  assert.equal(again.headers["Cache-Control"], "public, max-age=604800, immutable");
});

test("GET /api/waveform: off, no track, busy with another track, undecodable, streamed and not local", async () => {
  const gate = deferred();
  const w = world({ files: { "alb||art": [{ file: "/a.flac", title: "A" }, { file: "/b.flac", title: "B" }, { file: "/c.flac", title: "C" }] },
    decode: async (f) => { if (f === "/a.flac") await gate.p; return f === "/c.flac" ? null : new Uint8Array([1]); },
    decodeError: "MIN_COVERAGE" });
  w.s.local["Alb"] = "alb||art";
  const { call } = mounted(w);
  w.s.on = false;
  assert.deepEqual((await call("GET /api/waveform", { query: { track: "A" } })).body, { peaks: null, reason: "off" });
  w.s.on = true;
  assert.equal((await call("GET /api/waveform", { query: {} })).code, 400);
  const a = call("GET /api/waveform", { query: { track: "A", album: "Alb", artist: "Art" } });
  await tick();
  assert.deepEqual((await call("GET /api/waveform", { query: { track: "B", album: "Alb", artist: "Art" } })).body,
    { peaks: null, reason: "busy" });
  gate.resolve();
  await quietly(() => a);
  const c = await quietly(() => call("GET /api/waveform", { query: { track: "C", album: "Alb", artist: "Art" } }));
  assert.deepEqual(c.value.body, { peaks: null, reason: "undecodable" });
  assert.match(c.out.join("\n"), /no waveform for C \(MIN_COVERAGE\)/);
  const none = await quietly(() => call("GET /api/waveform", { query: { track: "X", album: "Elsewhere", artist: "Nobody" } }));
  assert.deepEqual(none.value.body, { peaks: null, reason: "no-local-file" });
  assert.match(none.out.join("\n"), /not signed in to Qobuz/);
  assert.match(none.out.join("\n"), /TIDAL is not connected/);
});

test("prefetch: off does nothing; a track change peeks once; the next local track is warmed; a newer one cancels it", async () => {
  const signals = [];
  const gate = deferred();
  const w = world({ files: { "alb||art": [{ file: "/b.flac", title: "B" }, { file: "/c.flac", title: "C" }] },
    decode: async (f, o) => { signals.push(o.signal); await gate.p; return new Uint8Array([9]); } });
  w.s.local["Alb"] = "alb||art";
  const wf = createWaveforms(w.d);
  const zone = (now) => ({ zone_id: "z1", now_playing: { three_line: { line1: now } } });
  const next = (t) => [{}, { three_line: { line1: t, line2: "Art", line3: "Alb" }, length: 200 }];
  w.s.on = false;
  await wf.wfPrefetchNext(zone("A"));
  assert.equal(w.s.peeks, 0);
  w.s.on = true;
  w.s.queue = next("B");
  await wf.wfPrefetchNext(zone("A"));
  await wf.wfPrefetchNext(zone("A"));   // the same track again: the push repeats many times a second
  assert.equal(w.s.peeks, 1);
  await tick();
  assert.equal(signals.length, 1);
  w.s.queue = next("C");
  await wf.wfPrefetchNext(zone("B"));
  await tick();
  assert.equal(signals[0].aborted, true, "the overtaken prefetch was not cancelled");
  assert.equal(signals.length, 2);
  gate.resolve();
  await quietly(tick);
  assert.ok(w.s.db.rows.has(WF.trackKey("alb||art", "C")), "the next track was not stored");
});

test("prefetch of a streamed next track asks Qobuz first, then TIDAL", async () => {
  const w = world({ qobuzWaveToken: "wave", tidalOn: true });
  w.s.tidalAlbumIds.set(K.albumKey("Kind of Blue", "Miles Davis"), "T9");
  w.s.queue = [{}, { three_line: { line1: "So What", line2: "Miles Davis", line3: "Kind of Blue" }, length: 545 }];
  const wf = createWaveforms(w.d);
  await withFetch(200, async (urls) => {
    const { out } = await quietly(async () => { await wf.wfPrefetchNext({ zone_id: "z", now_playing: { line1: "x" } }); for (let i = 0; i < 20; i++) await tick(); });
    assert.match(out.join("\n"), /qobuz: no Qobuz album id for "Kind of Blue"/);
    assert.deepEqual(urls, ["https://tidal.example/x.flac"]);
  });
  assert.ok(w.s.db.rows.has(WF.trackKey("tidal:T9", "So What")));
});

test("ffmpeg is announced at startup, working or not", async () => {
  const w = world();
  const wf = createWaveforms(w.d);
  const ok = await quietly(async () => { wf.announceFfmpeg(); await tick(); });
  assert.deepEqual(ok.out, ["[waveform] ffmpeg ready via npm — 6.1"]);
  w.s.probe = { ok: false, source: "PATH", error: "ENOENT" };
  const bad = await quietly(async () => { wf.announceFfmpeg(); await tick(); });
  assert.match(bad.err[0], /^\[waveform\] NO WORKING FFMPEG \(PATH\): ENOENT — no waveforms can be produced/);
});

test("Qobuz: the album id from the favourites, else the catalogue — memoised with its misses, a failed search retried", async () => {
  const w = world({ qobuzToken: "own" });
  const { call } = mounted(w);
  w.s.qobuzAlbumIds.set(K.albumKey("Kind of Blue", "Miles Davis"), "Q1");
  const probe = (album, artist) => call("GET /api/debug/waveform", { query: { track: "So What", album, artist, length: "545", deep: "1" } });
  const fav = await probe("Kind of Blue", "Miles Davis");
  assert.equal(fav.body.streaming.qobuz.album_id, "Q1");
  assert.equal(fav.body.streaming.deep.album_id_came_from, "favourites");
  assert.equal(w.s.searches, 0);
  w.s.searchFails = true;
  await quietly(() => probe("Bitches Brew", "Miles Davis"));
  await quietly(() => probe("Bitches Brew", "Miles Davis"));
  assert.equal(w.s.searches, 2, "a failed search was cached as a miss");
  w.s.searchFails = false;
  w.s.searchItems = [{ id: "Q2", title: "Bitches Brew", artist: { name: "Miles Davis" } }];
  const found = await quietly(() => probe("Bitches Brew", "Miles Davis"));
  assert.equal(found.value.body.streaming.qobuz.album_id_from_search, "Q2");
  assert.equal(found.value.body.streaming.deep.album_id_came_from, "catalogue search");
  await probe("Bitches Brew", "Miles Davis");
  assert.equal(w.s.searches, 3, "a found album was searched for again");
});

test("Qobuz: the credential sets in order — the sign-in, the pasted token, the minted one, this app's own", async () => {
  const w = world({ qobuzWaveToken: "wave", qobuzSignToken: "pasted", qobuzSignAppId: "sign-app", qobuzAppSecret: "sec",
    minted: "minted", signTok: { appId: "sign-app", token: "minted" }, fileUrl: () => ({ url: null, reason: "refused" }) });
  w.s.qobuzAlbumIds.set(K.albumKey("Kind of Blue", "Miles Davis"), "Q1");
  const { call } = mounted(w);
  const r = await call("GET /api/debug/waveform", { query: { track: "So What", album: "Kind of Blue", artist: "Miles Davis", length: "545", deep: "1" } });
  const deep = r.body.streaming.deep;
  assert.equal(deep.stop, "audio");
  assert.deepEqual(deep.tried.map((t) => t.split(":")[0]),
    ["the Qobuz sign-in", "the token saved from a pasted file", "a token minted under app sign-app", "this app's Qobuz login"]);
  assert.deepEqual(w.s.asked.filter((a) => a[0] === "url").map((a) => [a[1], a[3], a[4]]),
    [["wave", "oauth-secret", "oauth-app"], ["pasted", "sec", "sign-app"], ["minted", "sec", "sign-app"], ["own-token", "sec", "sign-app"]]);
  assert.equal(w.s.signTok, null, "a refused minted token was kept");
  w.s.fileUrl = () => ({ url: "https://audio.example/y.mp3" });
  const ok = await call("GET /api/debug/waveform", { query: { track: "So What", album: "Kind of Blue", artist: "Miles Davis", length: "545", deep: "1" } });
  assert.equal(ok.body.streaming.deep.credentials_used, "the Qobuz sign-in");
  assert.equal(ok.body.streaming.deep.got_audio_url, true);
  const wrong = await call("GET /api/debug/waveform", { query: { track: "So What", album: "Kind of Blue", artist: "Miles Davis", length: "300", deep: "1" } });
  assert.equal(wrong.body.streaming.deep.stop, "track", "a track of the wrong length was not final");
});

test("a Qobuz track: fetched, decoded with its length, stored under its album id, then served stored", async () => {
  const lengths = [];
  const w = world({ qobuzWaveToken: "wave", decode: async (f, o) => { lengths.push(o.expectSeconds); return new Uint8Array([4]); } });
  w.s.qobuzAlbumIds.set(K.albumKey("Kind of Blue", "Miles Davis"), "Q1");
  const { call } = mounted(w);
  const q = { track: "So What", album: "Kind of Blue", artist: "Miles Davis", length: "545" };
  await withFetch(200, async (urls) => {
    const r = await quietly(() => call("GET /api/waveform", { query: q }));
    assert.deepEqual(r.value.body, { peaks: WF.encode(new Uint8Array([4])), n: 1, cached: false, source: "qobuz" });
    assert.deepEqual(urls, ["https://audio.example/x.mp3"]);
    assert.deepEqual(lengths, [545]);
  });
  assert.ok(w.s.db.rows.has(WF.trackKey("qobuz:Q1", "So What")));
  assert.equal((await call("GET /api/waveform", { query: q })).body.cached, true);
  await withFetch(503, async () => {
    const r = await quietly(() => call("GET /api/waveform", { query: Object.assign({}, q, { track: "Blue in Green", length: "337" }) }));
    assert.match(r.out.join("\n"), /qobuz: stream HTTP 503/);
  });
});

test("TIDAL: not connected and no album id are each said once; a found track is stored under its album id", async () => {
  const w = world();
  const { call } = mounted(w);
  const q = { track: "So What", album: "Kind of Blue", artist: "Miles Davis", length: "545" };
  const first = await quietly(async () => { await call("GET /api/waveform", { query: q }); await call("GET /api/waveform", { query: q }); });
  assert.equal(first.out.filter((l) => /TIDAL is not connected/.test(l)).length, 1);
  w.s.tidalOn = true;
  const noid = await quietly(async () => { await call("GET /api/waveform", { query: q }); await call("GET /api/waveform", { query: q }); });
  assert.equal(noid.out.filter((l) => /no TIDAL album id for "Kind of Blue"/.test(l)).length, 1);
  w.s.tidalAlbumIds.set(K.albumKey("Kind of Blue", "Miles Davis"), "T1");
  await withFetch(200, async () => {
    const r = await quietly(() => call("GET /api/waveform", { query: q }));
    assert.equal(r.value.body.source, "tidal");
  });
  assert.ok(w.s.db.rows.has(WF.trackKey("tidal:T1", "So What")));
});

test("the settings: GET says what is set, never a credential; POST sets the pair, the switch, and stops a prefetch", async () => {
  const gate = deferred();
  const signals = [];
  const w = world({ qobuzWaveToken: "wave-token", qobuzWaveName: "Ada", qobuzSignToken: "keep-me", signTok: { appId: "a", token: "t" },
    files: { "alb||art": [{ file: "/b.flac", title: "B" }] }, decode: async (f, o) => { signals.push(o.signal); await gate.p; return null; } });
  w.s.said.add("noid:x");
  const { call, wf } = mounted(w);
  const got = (await call("GET /api/settings/waveform")).body;
  assert.deepEqual(got, { enabled: true, decoder: true, qobuz_secret_set: false, qobuz_sign_app_id: null, qobuz_sign_token_set: true,
    qobuz_connected: true, qobuz_user: "Ada", qobuz_ready: true });
  assert.ok(!JSON.stringify(got).includes("wave-token"));
  const pair = await call("POST /api/settings/waveform", { body: { qobuz_secret: JSON.stringify({ app_id: "123", app_secret: "s3" }) } });
  assert.deepEqual(pair.body, { ok: true, enabled: true, qobuz_secret_set: true, qobuz_sign_app_id: "123", qobuz_sign_token_set: true });
  assert.equal(w.s.qobuzSignToken, "keep-me", "a pair with an app_id dropped the working token");
  assert.equal(w.s.signTok, null);
  assert.equal(w.s.signTokAt, 0);
  assert.equal(w.s.said.size, 0, "the said-once log was kept across a credential change");
  assert.deepEqual(w.s.saved, [{ qobuzAppSecret: "s3", qobuzSignAppId: "123", qobuzSignToken: "keep-me" }]);
  assert.equal((await call("POST /api/settings/waveform", { body: {} })).code, 400);
  w.s.local["Alb"] = "alb||art";
  w.s.queue = [{}, { three_line: { line1: "B", line2: "Art", line3: "Alb" }, length: 100 }];
  await wf.wfPrefetchNext({ zone_id: "z", now_playing: { line1: "A" } });
  await tick();
  const off = await call("POST /api/settings/waveform", { body: { enabled: false } });
  assert.deepEqual(off.body, { ok: true, enabled: false, qobuz_secret_set: true, qobuz_sign_app_id: "123", qobuz_sign_token_set: true });
  assert.equal(signals[0].aborted, true, "switching off left the prefetch running");
  assert.deepEqual(w.s.saved[1], { waveformEnabled: false });
  gate.resolve();
  await quietly(tick);
});

test("the debug routes: the probe is POST only, needs a secret and an album; nothing playing is named", async () => {
  const w = world();
  const { call } = mounted(w);
  assert.equal((await call("GET /api/debug/qobuz-probe")).code, 405);
  assert.equal((await call("POST /api/debug/qobuz-probe", { body: {} })).code, 400);
  assert.equal((await call("POST /api/debug/qobuz-probe", { body: { secret: "s" } })).code, 409);
  w.s.qobuzAlbumIds.set("x", "Q7");
  w.s.qobuzToken = "own";
  w.s.fileUrl = () => ({ url: "https://audio.example/z.mp3" });
  const r = await call("POST /api/debug/qobuz-probe", { body: { secret: "a-long-secret" } });
  assert.equal(r.body.album_id_tested, "Q7");
  assert.match(r.body.answer, /^WORKS with: this app's login/);
  const idle = await call("GET /api/debug/waveform", { query: {} });
  assert.match(idle.body.verdict, /^nothing playing and no track given/);
  assert.equal(idle.body.ffmpeg.ok, true);
});

test("the wiring: the routes keep index.js's order, and index.js hands each getter and setter its own variable", () => {
  const { order } = mounted(world());
  assert.deepEqual(order, ["GET /api/waveform", "GET /api/debug/waveform", "GET /api/debug/qobuz-probe",
    "POST /api/debug/qobuz-probe", "GET /api/settings/waveform", "POST /api/settings/waveform"]);
  const src = indexSource();
  const at = src.indexOf("const waveforms = createWaveforms({");
  assert.ok(at > 0, "index.js does not wire createWaveforms");
  const call = src.slice(at, src.indexOf("\n});", at));
  const renamed = { qobuzSignTok: "_qobuzSignTok" };
  const getters = [...call.matchAll(/(\w+): \(\) => (\w+)\b/g)];
  assert.ok(getters.length >= 23, "only " + getters.length + " getters found");
  for (const [, name, v] of getters) assert.equal(v, renamed[name] || name, name + " reads " + v);
  const setters = [...call.matchAll(/set(\w+): \((\w+)\) => \{ (\w+) = (\w+); \}/g)];
  const setRenamed = { QobuzSignTok: "_qobuzSignTok", QobuzSignTokAt: "_qobuzSignTokAt" };
  assert.equal(setters.length, 6);
  for (const [, name, arg, v, val] of setters) {
    assert.equal(v, setRenamed[name] || name[0].toLowerCase() + name.slice(1), "set" + name + " assigns " + v);
    assert.equal(val, arg);
  }
  assert.match(call, /persisted: _persisted\b/);
  assert.match(call, /wfQobuzSaid: _wfQobuzSaid\b/);
  // Startup runs the two checks where it always did, and the zone push reaches the prefetch by name.
  assert.ok(src.indexOf("waveforms.wfCheckAnalysis();") > at && src.indexOf("waveforms.announceFfmpeg();") > at);
  assert.match(src, /\nasync function wfPrefetchNext\(zone\) \{ return waveforms\.wfPrefetchNext\(zone\); \}/);
});
