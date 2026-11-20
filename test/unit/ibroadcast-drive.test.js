"use strict";
/*
 * iBroadcast's drive, the probe of 2.0.6-t2 (dev/design/ibroadcast.md §4), without FUSE: the folders and their names;
 * where a FLAC's or an MP3's audio begins; the read rule (a file's start and end always, the audio of a track playing or
 * queued, any other refused after a hold, nothing of it downloaded; a block downloaded once); the local server as rclone
 * reads it; rclone's arguments and the mount's state; and the whole drive against iBroadcast's stand-in.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildTree, safe } = require("../../lib/ibroadcast/drive-tree");
const { createDriveReads, audioStartOf, BLOCK, START_CAP } = require("../../lib/ibroadcast/drive-reads");
const { createDriveHttp } = require("../../lib/ibroadcast/drive-http");
const { rcloneArgs, mountState, createDriveMount } = require("../../lib/ibroadcast/drive-mount");
const { createPlaying } = require("../../lib/ibroadcast/playing");
const { originalUrl } = require("../../lib/ibroadcast/drive");
const { createIBroadcastService } = require("../../lib/ibroadcast/service");
const { FakeIBroadcast } = require("../lib/fake-ibroadcast");

/** A FLAC's start: "fLaC", STREAMINFO, and a picture block of `art` bytes, the last; then `audio` bytes of frames. */
function flac(art, audio) {
  const blockHead = (last, type, len) => Buffer.from([(last ? 0x80 : 0) | type, (len >> 16) & 255, (len >> 8) & 255, len & 255]);
  return Buffer.concat([Buffer.from("fLaC"), blockHead(false, 0, 34), Buffer.alloc(34, 1), blockHead(true, 6, art), Buffer.alloc(art, 2),
    Buffer.alloc(audio, 3)]);
}
const track = (id, title, data, extra = {}) => Object.assign({ id, title, artist: "INXS", track: 1, disc: 1, length: 200, size: data.length, type: "audio/flac", file: "/128/a/b/" + id, artwork: null }, extra);

test("the folders: Artist / Album (Year) / NN Title.ext, discs told apart, names made safe and told apart", () => {
  const t = buildTree([
    { id: "1", title: "Kick", artist: "INXS", year: 1987, tracks: [track("11", "Guns in the Sky", Buffer.alloc(9)), track("12", "New: Sensation?", Buffer.alloc(9), { track: 2, type: "audio/mpeg" })] },
    { id: "2", title: "Best / Of", artist: "inxs", year: null, tracks: [track("21", "Same", Buffer.alloc(9), { disc: 1 }), track("22", "Same", Buffer.alloc(9), { disc: 2 })] },
    { id: "3", title: "Kick", artist: "INXS", year: 1987, tracks: [track("31", "Dup", Buffer.alloc(9)), track("32", "Dup", Buffer.alloc(9))] },
  ]);
  assert.deepEqual(t.dirs.get(""), ["INXS/"], "one folder for the artist, whatever its case");
  assert.deepEqual(t.dirs.get("INXS"), ["Kick (1987)/", "Best - Of/", "Kick (1987) (2)/"]);
  assert.deepEqual(t.dirs.get("INXS/Kick (1987)"), ["01 Guns in the Sky.flac", "02 New- Sensation-.mp3"]);
  assert.deepEqual(t.dirs.get("INXS/Best - Of"), ["1-01 Same.flac", "2-01 Same.flac"], "a set of discs: DN-NN");
  assert.deepEqual(t.dirs.get("INXS/Kick (1987) (2)"), ["01 Dup.flac", "01 Dup (2).flac"]);
  assert.equal(t.files.get("INXS/Kick (1987)/01 Guns in the Sky.flac").track.id, "11");
  assert.equal(safe("..", "x"), "x");
  // Cut by characters (the review): an emoji at the 120th never left as half of one, and a half one sent made whole.
  const cut = safe("a".repeat(119) + "😀😀", "x");
  assert.equal([...cut].length, 120);
  assert.doesNotThrow(() => encodeURIComponent(cut));
  assert.doesNotThrow(() => encodeURIComponent(safe("broken \uD83D name", "x")));
  assert.equal(safe("Trailing. ", "x"), "Trailing");
});

test("where the audio begins: a FLAC's metadata blocks read from the file, an MP3's ID3v2 tag", async () => {
  const f = flac(300000, 10);
  assert.equal(await audioStartOf(async (off, len) => f.subarray(off, off + len)), 4 + 4 + 34 + 4 + 300000);
  // A FLAC behind an ID3v2 tag a tagger put first (the review): its metadata blocks after the tag, not "music".
  const tag = Buffer.alloc(10 + 200); tag.write("ID3"); tag[3] = 3; tag[8] = 1; tag[9] = 72;   // 200 bytes
  const tagged = Buffer.concat([tag, flac(5000, 10)]);
  assert.equal(await audioStartOf(async (off, len) => tagged.subarray(off, off + len)), 210 + 4 + 4 + 34 + 4 + 5000);
  const id3 = Buffer.alloc(20); id3.write("ID3"); id3[3] = 4; id3[5] = 0x10; id3[8] = 1; id3[9] = 2;   // 130 bytes, and a footer
  assert.equal(await audioStartOf(async (off, len) => id3.subarray(off, off + len)), 10 + 130 + 10);
  assert.equal(await audioStartOf(async () => Buffer.from("OggS......")), null);
});

/** A reads object over one file, on a clock the test moves. */
function rig({ data = flac(BLOCK + 5000, 4 * BLOCK), wanted = () => false } = {}) {
  const clock = { t: 0 };
  const asked = [];
  const reads = createDriveReads({
    fetchRange: async (f, s, e) => { asked.push([s, e]); return f.track.data.subarray(s, e + 1); },
    wanted: async (f) => wanted(f, clock.t), now: () => clock.t, sleep: async (ms) => { clock.t += ms; }, holdMs: 8000, pollMs: 500,
  });
  const f = { path: "A/B/01 T.flac", name: "01 T.flac", album: { title: "B", artist: "A" }, track: Object.assign(track("7", "T", data), { data }), ext: "flac" };
  return { reads, f, asked, clock, data };
}

test("the rule: a file's start and end always; another track's audio refused after a hold, nothing of it downloaded", async () => {
  const r = rig();
  const begins = 4 + 4 + 34 + 4 + BLOCK + 5000;
  const a = await r.reads.read(r.f, 0, 65535);
  assert.equal(a.ok, true);
  assert.equal(a.region, "start");
  assert.deepEqual(a.body, r.data.subarray(0, 65536));
  const tail = await r.reads.read(r.f, r.data.length - 1000, r.data.length + 50);
  assert.equal(tail.region, "tail");
  assert.equal(tail.body.length, 1000, "to the file's end");
  const t0 = r.clock.t;
  const refused = await r.reads.read(r.f, begins + 10, begins + 65545);
  assert.equal(refused.ok, false);
  assert.equal(refused.region, "audio");
  assert.equal(r.clock.t - t0, 8000, "held eight seconds first");
  // Downloaded: the first block (the metadata's block headers say where the audio begins: the picture's own bytes, in
  // block 1, are never needed) and the last; none of the audio's.
  const blocks = r.asked.map(([s]) => s / BLOCK);
  assert.deepEqual([...new Set(blocks)].sort((x, y) => x - y), [0, Math.floor((r.data.length - 1) / BLOCK)]);
  const rep = r.reads.report();
  assert.equal(rep.totals.refused, 1);
  assert.equal(rep.files[0].audioStart, begins);
  assert.equal(rep.files[0].heldMs, 8000);
  assert.equal(rep.reads[0].answer, "refused after 8 s");
});

test("the rule: a playing or queued track's audio is answered, after Roon's news; its later reads at once; a block once", async () => {
  // Wanted from the third look (Roon's news comes a second after its first read).
  const r = rig({ wanted: (f, t) => t >= 1000 });
  const begins = 4 + 4 + 34 + 4 + BLOCK + 5000;
  const a = await r.reads.read(r.f, begins, begins + 65535);
  assert.equal(a.ok, true);
  assert.deepEqual(a.body, r.data.subarray(begins, begins + 65536));
  assert.equal(r.reads.report().files[0].heldMs, 1000);
  const t0 = r.clock.t;
  const again = await r.reads.read(r.f, begins + 65536, begins + 131071);
  assert.equal(again.ok, true);
  assert.equal(r.clock.t, t0, "open: no hold");
  const n = r.asked.length;
  await r.reads.read(r.f, begins, begins + 65535);
  assert.equal(r.asked.length, n, "a block read twice is downloaded once");
  assert.equal(r.reads.report().totals.audio, 3 * 65536);
});

test("the rule: a long read from the start stops where the audio begins (or 128 KB)", async () => {
  const small = rig({ data: flac(10, 4 * BLOCK) });
  const a = await small.reads.read(small.f, 0, 3 * BLOCK);
  assert.equal(a.region, "start");
  assert.equal(a.body.length, START_CAP, "a short metadata: 128 KB at most");
  const big = rig();
  const begins = 4 + 4 + 34 + 4 + BLOCK + 5000;
  const b = await big.reads.read(big.f, 0, 3 * BLOCK);
  assert.equal(b.body.length, begins, "a long one: to where the audio begins");
});

test("the local server: folders as links, sizes to HEAD, ranges to GET, refused as 403, no range refused, its path secret", async (t) => {
  const r = rig({ wanted: () => false });
  const tree = { dirs: new Map([["", ["A/"]], ["A", ["B/"]], ["A/B", ["01 T.flac"]]]), files: new Map([["A/B/01 T.flac", r.f]]) };
  const srv = createDriveHttp({ tree: () => tree, reads: r.reads, mtime: () => Date.UTC(2026, 10, 20), token: "secret" });
  const url = await srv.start();
  t.after(() => srv.stop());
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/secret\/$/);
  assert.match(await (await fetch(url)).text(), /<a href="A\/">A\/<\/a>/);
  assert.match(await (await fetch(url + "A/B/")).text(), /<a href="01%20T\.flac">01 T\.flac<\/a>/);
  const head = await fetch(url + "A/B/01%20T.flac", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get("content-length")), r.data.length);
  const got = await fetch(url + "A/B/01%20T.flac", { headers: { Range: "bytes=0-99" } });
  assert.equal(got.status, 206);
  assert.equal(got.headers.get("content-range"), `bytes 0-99/${r.data.length}`);
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), r.data.subarray(0, 100));
  assert.equal((await fetch(url + "A/B/01%20T.flac")).status, 416, "a whole file at once would go round the rule");
  const begins = 4 + 4 + 34 + 4 + BLOCK + 5000;
  r.clock.t = 0;
  assert.equal((await fetch(url + "A/B/01%20T.flac", { headers: { Range: `bytes=${begins}-${begins + 99}` } })).status, 403);
  assert.equal((await fetch(url.replace("secret", "guess"))).status, 404);
});

test("rclone: read-only, 64 KB chunks, no cache, one try; the mount's state from mountinfo; what's missing, said", () => {
  const a = rcloneArgs("http://127.0.0.1:1/x/", "/ibroadcast");
  assert.deepEqual(a.slice(0, 3), ["mount", ":http:", "/ibroadcast"]);
  for (const [k, v] of [["--vfs-cache-mode", "off"], ["--vfs-read-chunk-size", "64k"], ["--vfs-read-chunk-size-limit", "64k"], ["--buffer-size", "0"], ["--low-level-retries", "1"]]) {
    assert.equal(a[a.indexOf(k) + 1], v, k);
  }
  assert.ok(a.includes("--read-only"));
  const bind = "100 90 8:1 /mnt/ibroadcast /ibroadcast rw,relatime shared:5 - ext4 /dev/sda1 rw";
  const fuse = "120 100 0:60 / /ibroadcast ro,nosuid,nodev,relatime shared:6 - fuse.rclone :http: ro,user_id=0";
  assert.deepEqual(mountState(bind, "/ibroadcast"), { mounted: true, fuse: false, shared: true, id: "100" });
  assert.deepEqual(mountState(bind + "\n" + fuse, "/ibroadcast"), { mounted: true, fuse: true, shared: true, id: "120" }, "the last mount there: rclone's");
  assert.deepEqual(mountState("100 90 8:1 /x /ibroadcast rw - ext4 /dev/sda1 rw", "/ibroadcast"), { mounted: true, fuse: false, shared: false, id: "100" });
  const fsOf = (have, mountinfo = "") => ({ existsSync: (p) => have.includes(p), readFileSync: () => mountinfo });
  assert.match(createDriveMount({ fs: /** @type {any} */ (fsOf([])), platform: "linux" }).missing(), /--device \/dev\/fuse/);
  assert.match(createDriveMount({ fs: /** @type {any} */ (fsOf(["/dev/fuse"])), platform: "linux" }).missing(), /-v \/mnt\/ibroadcast:\/ibroadcast:rshared/);
  assert.match(createDriveMount({ fs: /** @type {any} */ (fsOf(["/dev/fuse", "/ibroadcast"], "100 90 8:1 /x /ibroadcast rw - ext4 /dev/sda1 rw")), platform: "linux" }).missing(), /add :rshared/);
  assert.equal(createDriveMount({ fs: /** @type {any} */ (fsOf(["/dev/fuse", "/ibroadcast"], bind)), platform: "linux" }).missing(), null);
  assert.match(createDriveMount({ platform: "win32" }).missing(), /Windows/);
});

test("what Roon is playing and has queued: each zone's now playing and the next queued, read once a second", async () => {
  let peeks = 0, clock = 0;
  const zones = { z1: { zone_id: "z1", state: "playing", now_playing: { three_line: { line1: "Need You Tonight", line2: "INXS", line3: "Kick" } } },
    z2: { zone_id: "z2", state: "stopped", now_playing: null } };
  const p = createPlaying({ zones: () => zones, now: () => clock,
    peekQueue: async (z) => { peeks++; return z === "z1" ? [{ three_line: { line1: "Mediate", line2: "INXS", line3: "Kick" } }] : []; } });
  assert.equal(await p.wants({ title: "Need You Tonight", artist: "INXS" }, { title: "Kick", artist: "INXS" }), true);
  assert.equal(await p.wants({ title: "Mediate", artist: "inxs" }, { title: "KICK", artist: "INXS" }), true, "queued, case aside");
  assert.equal(await p.wants({ title: "Devil Inside", artist: "INXS" }, { title: "Kick", artist: "INXS" }), false);
  assert.equal(peeks, 1, "only the zone playing is asked, once a second");
  clock = 1000;
  await p.wants({ title: "x", artist: "y" }, { title: "z", artist: "w" });
  assert.equal(peeks, 2);
});

test("the original's address, as Mandarin's IBroadcastStreams.cs builds it", () => {
  assert.equal(originalUrl({ server: "https://s.example/", file: "/128/a/b/9", trackId: "9", access: "t k", userId: "42", version: "2.0.6-t2", now: 5 }),
    "https://s.example/orig/a/b/9?Expires=5&Signature=t%20k&file_id=9&user_id=42&platform=rouen&version=2.0.6-t2");
});

test("the drive against iBroadcast's stand-in: chosen albums served from the originals, rclone started and stopped", async (t) => {
  const kick = flac(2000, 3 * BLOCK);
  const ib = await new FakeIBroadcast({ albums: [{ id: 1, name: "Kick", artist: { id: 10, name: "INXS" }, year: 1987,
    tracks: [{ id: 101, title: "Need You Tonight", track: 1, data: kick }] }] }).start();
  t.after(() => ib.stop());
  ib.slowOnce = false;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-ib-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const store = {};
  const did = [];
  const mount = { missing: () => null, state: () => ({ mounted: did.at(-1) && did.at(-1)[0] === "start" }), start: async (url) => { did.push(["start", url]); },
    stop: async () => { did.push(["stop"]); } };
  const zones = { z: { zone_id: "z", state: "playing", now_playing: { three_line: { line1: "Need You Tonight", line2: "INXS", line3: "Kick" } } } };
  const svc = createIBroadcastService({ load: () => store, save: (p) => { Object.assign(store, p); return true; }, dataDir, version: "2.0.6-t2", base: ib.base,
    log: () => {}, zones: () => zones, peekQueue: async () => [], mount: /** @type {any} */ (mount), holdMs: 100 });
  t.after(() => svc.close());
  const call = async (method, p, body) => (await svc.dispatch({ method, path: p.split("?")[0], query: Object.fromEntries(new URL("http://x" + p).searchParams),
    body, headers: method === "GET" ? {} : { "content-type": "application/json" } })).body;
  await call("POST", "/signin");
  ib.approve();
  for (let i = 0; i < 100 && !((await call("GET", "/status")).library || {}).albums; i++) await new Promise((r) => { setTimeout(r, 50); });
  assert.deepEqual(await call("GET", "/drive/search?q=kick"), [{ id: "1", title: "Kick", artist: "INXS", year: 1987, tracks: 1 }]);
  const tooMany = await svc.dispatch({ method: "POST", path: "/drive/albums", headers: { "content-type": "application/json" }, body: { ids: Array.from({ length: 21 }, (_, i) => String(i)) } });
  assert.equal(tooMany.status, 400);
  const st = await call("POST", "/drive/albums", { ids: ["1"] });
  assert.deepEqual(st.albums.map((a) => a.title), ["Kick"]);
  assert.deepEqual(store.ibroadcastDrive, { albums: ["1"] });
  const started = did.find((d) => d[0] === "start");
  assert.ok(started, "rclone started on the local server");
  // Read as rclone would: the file's audio, Roon playing it.
  const url = started[1] + "INXS/Kick%20(1987)/01%20Need%20You%20Tonight.flac";
  const begins = 4 + 4 + 34 + 4 + 2000;
  const got = await fetch(url, { headers: { Range: `bytes=${begins}-${begins + 65535}` } });
  assert.equal(got.status, 206);
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), kick.subarray(begins, begins + 65536));
  const ask = ib.streamAsks.at(-1);
  assert.equal(ask.path, "/streaming/orig/a/b/101", "the original, never a transcode");
  assert.equal(ask.query.platform, "rouen");
  assert.equal(ask.query.file_id, "101");
  assert.equal(ask.query.user_id, "4242");
  assert.match(ask.range, /^bytes=\d+-\d+$/);
  // Not playing any more: another track's audio refused, after the (shortened) hold.
  zones.z.now_playing.three_line.line1 = "Something else";
  const rep0 = (await call("GET", "/drive/report")).totals;
  await call("POST", "/drive/albums", { ids: ["1"] });
  assert.equal(rep0.audio, 65536);
  // A server sending the whole file for a part (the review): refused, not downloaded a block at a time.
  ib.ignoreRange = true;
  zones.z.now_playing.three_line.line1 = "Need You Tonight";
  const whole = await fetch(url, { headers: { Range: `bytes=${2 * BLOCK}-${2 * BLOCK + 65535}` } });
  assert.equal(whole.status, 502);
  ib.ignoreRange = false;
  // Cleared: rclone stopped.
  await call("POST", "/drive/albums", { ids: [] });
  assert.deepEqual(did.at(-1), ["stop"]);
  const out = await call("POST", "/signout");
  assert.equal(out.connected, false);
});

/** A fake child process: emits as a spawned one does. */
function fakeChild() {
  const { EventEmitter } = require("node:events");
  const c = new EventEmitter();
  c.exitCode = null; c.signalCode = null;
  c.stdout = new EventEmitter(); c.stderr = new EventEmitter();
  c.killed = [];
  c.kill = (sig) => { c.killed.push(sig); setTimeout(() => { c.signalCode = sig; c.emit("exit", null, sig); c.emit("close", null, sig); }, 5); };
  return c;
}

test("the mount (the review): a mount left from before let go first; only its own let go; rclone missing doesn't stick", async () => {
  const lines = { now: "100 90 8:1 /mnt/ibroadcast /ibroadcast rw shared:5 - ext4 /dev/sda1 rw\n77 100 0:50 / /ibroadcast ro shared:6 - fuse.rclone :http: ro" };
  const fsx = { existsSync: () => true, readFileSync: () => lines.now };
  const unmounted = [];
  const children = [];
  const m = createDriveMount({ fs: /** @type {any} */ (fsx), platform: "linux", sleep: () => new Promise((r) => { setTimeout(r, 2); }), mountPoint: "/ibroadcast",
    unmount: () => { unmounted.push(lines.now.split("\n").length); lines.now = lines.now.split("\n")[0]; },
    spawn: /** @type {any} */ (() => { const c = fakeChild(); children.push(c); setTimeout(() => { lines.now += "\n130 100 0:51 / /ibroadcast ro shared:7 - fuse.rclone :http: ro"; }, 1); return c; }) });
  await m.start("http://127.0.0.1:1/t/");
  assert.equal(unmounted.length, 1, "the old mount (77) let go before rclone started");
  assert.equal(m.mounted(), true);
  // Another rclone's mount there now (the plugin off and on): not this one's to end.
  lines.now = "100 90 8:1 /mnt/ibroadcast /ibroadcast rw shared:5 - ext4 /dev/sda1 rw\n140 100 0:52 / /ibroadcast ro shared:8 - fuse.rclone :http: ro";
  await m.stop();
  assert.deepEqual(children[0].killed, ["SIGTERM"]);
  assert.equal(unmounted.length, 1, "mount 140 is not the one it made (130): left alone");

  // rclone not installed: "error" and "close", never "exit" — nothing stays running, and stop doesn't wait.
  const lone = createDriveMount({ fs: /** @type {any} */ ({ existsSync: () => true, readFileSync: () => "100 90 8:1 /m /ibroadcast rw shared:5 - ext4 x rw" }), platform: "linux",
    sleep: (ms) => new Promise((r) => { setTimeout(r, Math.min(ms, 5)); }),
    spawn: /** @type {any} */ (() => { const c = fakeChild(); setTimeout(() => { const e = new Error("spawn rclone ENOENT"); e.code = "ENOENT"; c.emit("error", e); c.emit("close", -2); }, 1); return c; }) });
  await lone.start("http://127.0.0.1:1/t/");
  assert.equal(lone.state().running, false);
  assert.match(lone.state().error, /rclone isn't in this image/);
  const t0 = Date.now();
  await lone.stop();
  assert.ok(Date.now() - t0 < 1000, "stop didn't wait for an exit that never comes");
});

test("what Roon is playing is read one at a time: a slow Core isn't asked again meanwhile (the review)", async () => {
  let peeks = 0, clock = 0;
  /** @type {() => void} */
  let answer = () => {};
  const p = createPlaying({ now: () => clock, zones: () => ({ z: { zone_id: "z", state: "playing", now_playing: null } }),
    peekQueue: () => { peeks++; return new Promise((r) => { answer = () => r([]); }); } });
  const a = p.list();
  clock = 3000;
  const b = p.list();
  assert.equal(b, a, "the reading under way, not another");
  assert.equal(peeks, 1);
  answer();
  await a;
  await p.list();
  assert.equal(peeks, 1, "within a second of the reading's end: kept");
});

test("removed while a change is under way: the drive isn't started after (the review)", async (t) => {
  const kick = flac(2000, BLOCK);
  const ib = await new FakeIBroadcast({ albums: [{ id: 1, name: "Kick", artist: { id: 10, name: "INXS" }, tracks: [{ id: 101, title: "T", track: 1, data: kick }] }] }).start();
  t.after(() => ib.stop());
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-ib-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  // Signed in, the library read and one album chosen, as Rouen finds them on starting.
  const store = { ibroadcastToken: { token: { access: ib.access, refresh: ib.refreshToken, expires: Date.now() + 3600e3, life: 3600e3, scope: null }, user: { id: 4242 } },
    ibroadcastDrive: { albums: ["1"] } };
  fs.mkdirSync(path.join(dataDir, "ibroadcast"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, "ibroadcast", "library.json"), JSON.stringify({ lastmodified: null, at: 1, streaming_server: ib.base + "/streaming", artwork_server: null,
    albums: [{ id: "1", title: "Kick", artist: "INXS", year: null, tracks: [{ id: "101", title: "T", artist: "INXS", track: 1, disc: 1, length: 1, size: kick.length, type: "audio/flac", file: "/128/a/b/101", artwork: null }] }] }));
  const did = [];
  /** @type {() => void} */
  let release = () => {};
  const mount = { missing: () => null, state: () => ({}), stop: async () => { did.push("stop"); },
    // The first start held until released (the one under way at the close); any later one at once, so a start after the
    // close shows in `did` rather than hanging the test.
    start: () => { did.push("start"); return did.length === 1 ? new Promise((r) => { release = r; }) : Promise.resolve(); } };
  const svc = createIBroadcastService({ load: () => store, save: (p) => { Object.assign(store, p); return true; }, dataDir, version: "t", base: ib.base, log: () => {},
    mount: /** @type {any} */ (mount) });
  await new Promise((r) => { setTimeout(r, 20); });
  assert.deepEqual(did, ["start"], "the start under way (the service's own, at its making)");
  const closing = svc.close();
  svc.drive.sync();                              // a library read's sync, queued behind
  release();
  await closing;
  await new Promise((r) => { setTimeout(r, 20); });
  assert.deepEqual(did, ["start", "stop"], "stopped after the start, and nothing started after the close");
});
