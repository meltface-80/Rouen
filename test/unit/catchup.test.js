"use strict";
// v1.9.72-t56: the catch-up (lib/catchup; dev/design/android-app.md §4.22). The owner, 2026-11-02: This phone's plays
// are replayed to Roon on a silent player, "Rouen catch-up", as soon as they reach Rouen, each to exactly where the phone
// stopped it, so Roon counts it or not by its own rules; the player is a zone in Roon but never one in Rouen. What Roon
// itself does with it is the owner's to see on his Core (the probe, §4.20, proved the counting); these pin what Rouen
// does: what the player says to Roon, how the driver replays, what the routes take, and that the zone stays hidden.
const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createCatchupPlayer, isCatchupZone, NAME } = require("../../lib/catchup/player");
const { createCatchup, RETRY_MS, MAX_QUEUE, SETTLE_MS, MAX_TRIES } = require("../../lib/catchup/driver");
const { mountCatchup, playOf, storeAt } = require("../../lib/catchup/mount");
const { createCatchupZones } = require("../../lib/catchup/zones");
const { mountZoneReads } = require("../../lib/routes/zones");
const { strm, createFakeCore } = require("../lib/fake-squeeze-core");

const BPS = 44100 * 2 * 2;
const pcm = (path_, port) => strm({ format: "p", size: "1", rate: "3", ch: "2", endian: "1", threshold: 1, port,
  request: "GET " + path_ + " HTTP/1.0\r\nHost: core\r\n\r\n" });
/** The elapsed ms in a STAT (Squeezelite's layout, lib/squeeze/slimproto.js stat). */
const elapsedOf = (m) => m.payload.readUInt32BE(43);

test("THE one for the player: it joins as \"Rouen catch-up\", plays what Roon sends, reports it played fast, held at the cap, and stops", async (t) => {
  const core = await createFakeCore({ "/t1": Buffer.alloc(BPS * 2, 1) });
  let clock = 1_000_000;
  const player = createCatchupPlayer({ now: () => clock, speed: 100,
    connect: (o) => net.connect({ host: "127.0.0.1", port: o.port === 3483 ? core.port : o.port }) });
  t.after(() => { player.stop(); core.close(); });

  player.start("127.0.0.1");
  await core.waitFor(() => core.got.some((m) => m.op === "HELO"), 4000, "HELO");
  const helo = core.got.find((m) => m.op === "HELO").payload;
  assert.equal(helo.subarray(2, 8).toString("hex"), "02526f756563", "its own MAC, not the probe's");
  assert.match(helo.toString("latin1", 36), /ModelName=Rouen catch-up,/, "Roon names the zone from the ModelName");

  core.send("setd", Buffer.from([0]));
  await core.waitFor(() => core.got.some((m) => m.op === "SETD"), 4000, "SETD");
  assert.equal(core.got.find((m) => m.op === "SETD").payload.toString("utf8", 1), NAME + "\0");

  core.send("strm", pcm("/t1", core.streamPort));
  await core.waitFor(() => core.events().includes("STMd"), 4000, "the stream all in");
  assert.deepEqual(core.events(), ["STMc", "STMs", "STMd"]);
  assert.deepEqual(core.requests, ["GET /t1 HTTP/1.0"]);

  clock += 1000;   // one second of clock: a hundred of track
  assert.equal(player.state().elapsedMs, 100_000);
  player.setCap(30_000);
  assert.equal(player.state().elapsedMs, 30_000, "held at the cap: never past where the phone stopped");
  core.send("strm", strm({ cmd: "t" }));
  await core.waitFor(() => core.got.filter((m) => m.event === "STMt").length > 0, 4000, "STMt");
  assert.equal(elapsedOf(core.got.filter((m) => m.event === "STMt").pop()), 30_000, "Roon is told the capped elapsed");

  core.send("strm", strm({ cmd: "q" }));
  await core.waitFor(() => core.events().includes("STMf"), 4000, "STMf");
  assert.equal(player.state().playing, false);
});

/** A driver over fakes, ticked by hand. */
function rig(o = {}) {
  let clock = 0;
  const calls = [];
  const saved = [];
  const st = { connected: true, playing: false, elapsedMs: 0, streams: 0 };
  const player = { start: (h) => calls.push(["start", h]), stop: () => calls.push(["stop"]), setCap: (ms) => calls.push(["cap", ms]),
    report: () => calls.push(["report"]), state: () => st };
  let on = o.on !== false, zone = "zc";
  const plays = [];
  const d = createCatchup({ player, host: () => "core", enabled: () => on, zoneId: () => zone,
    playTrack: (p, z) => { calls.push(["play", p.track, z]); return o.playTrack ? o.playTrack(p) : Promise.resolve(); },
    stop: (z) => { calls.push(["stopZone", z]); return Promise.resolve(); },
    store: { load: () => plays, save: (q) => saved.push(q.map((p) => p.track)) }, log: () => {}, now: () => clock,
    timers: { setInterval: () => 0, clearInterval: () => {} } });
  return { d, calls, saved, st, setClock: (c) => { clock = c; }, clock: () => clock, off: () => { on = false; }, noZone: () => { zone = null; } };
}
let at = 0;
const play = (track, elapsed) => ({ album: "Low", artist: "David Bowie", track, index: 0, elapsed, at: ++at });
const flush = () => new Promise((r) => { setImmediate(r); });

test("THE one for the driver: each play capped at how far the phone went, asked of Roon, told its cap, settled, then stopped — in order", async () => {
  const r = rig();
  r.d.add([play("Speed of Life", 42.5), play("Breaking Glass", 111)]);
  r.d.tick(); await flush();
  assert.deepEqual(r.calls.filter((c) => c[0] !== "start"), [["cap", 42500], ["play", "Speed of Life", "zc"]]);
  // The stream still running from before (no new stream yet) is not this play's, whatever its elapsed.
  r.st.playing = true; r.st.elapsedMs = 99_000;
  r.d.tick(); await flush();
  assert.ok(!r.calls.some((c) => c[0] === "report" || c[0] === "stopZone"), "not this play's stream yet");
  r.st.streams = 1; r.st.elapsedMs = 30_000;
  r.d.tick(); await flush();
  assert.ok(!r.calls.some((c) => c[0] === "stopZone"), "not yet where the phone stopped");
  r.st.elapsedMs = 42_500;
  r.d.tick(); await flush();
  assert.deepEqual(r.calls.filter((c) => c[0] === "report"), [["report"]], "Roon told the capped elapsed at once");
  assert.ok(!r.calls.some((c) => c[0] === "stopZone"), "and not stopped before the next beat has told it again");
  r.setClock(r.clock() + SETTLE_MS);
  r.d.tick(); await flush();
  assert.deepEqual(r.calls.filter((c) => c[0] === "stopZone"), [["stopZone", "zc"]]);
  assert.equal(r.d.status().replayed, 1);
  r.st.playing = false;
  r.d.tick(); await flush();
  assert.deepEqual(r.calls.filter((c) => c[0] === "play").map((c) => c[1]), ["Speed of Life", "Breaking Glass"]);
  assert.deepEqual(r.calls.filter((c) => c[0] === "cap" && c[1] !== null).map((c) => c[1]), [42500, 111000]);
  assert.deepEqual(r.saved.at(-1), ["Breaking Glass"], "what's left is kept on disk");
});

test("a play that can never be played is dropped and said; one that can't be played now waits and is tried again", async () => {
  let fail = { message: "not in the library: Low", permanent: true };
  const r = rig({ playTrack: () => (fail ? Promise.reject(fail) : Promise.resolve()) });
  r.d.add([play("Gone", 10), play("Later", 10)]);
  r.d.tick(); await flush();
  assert.equal(r.d.status().dropped, 1);
  assert.equal(r.d.status().recent[0].result, "dropped");
  fail = { message: "Not paired with Roon Core yet" };
  r.d.tick(); await flush();
  assert.equal(r.d.status().waiting, 1, "still waiting");
  const asked = r.calls.filter((c) => c[0] === "play").length;
  r.d.tick(); await flush();
  assert.equal(r.calls.filter((c) => c[0] === "play").length, asked, "not asked again before its retry time");
  fail = null;
  r.setClock(RETRY_MS + 1);
  r.d.tick(); await flush();
  assert.equal(r.calls.filter((c) => c[0] === "play").length, asked + 1, "asked again after it");
});

test("a play that keeps failing for now is given up after MAX_TRIES, so it can't hold up the plays behind it", async () => {
  const r = rig({ playTrack: (p) => (p.track === "Stuck" ? Promise.reject(new Error("no Play Now for it")) : Promise.resolve()) });
  r.d.add([play("Stuck", 10), play("Next", 10)]);
  for (let i = 0; i < MAX_TRIES; i++) { r.setClock(r.clock() + RETRY_MS + 1); r.d.tick(); await flush(); }
  assert.equal(r.d.status().dropped, 1);
  assert.match(r.d.status().recent[0].why, /gave up after 5 tries/);
  r.setClock(r.clock() + RETRY_MS + 1); r.d.tick(); await flush();
  assert.equal(r.calls.filter((c) => c[0] === "play").at(-1)[1], "Next");
});

test("the same play sent again (an answer lost on the way) is taken once", () => {
  const r = rig();
  const p = play("Warszawa", 380);
  assert.equal(r.d.add([p]), 1);
  assert.equal(r.d.add([Object.assign({}, p)]), 0);
  assert.equal(r.d.waiting(), 1);
});

test("off, nothing is replayed and the player leaves Roon; with no zone (not enabled in Roon) it waits", async () => {
  const off = rig({ on: false });
  off.d.add([play("Low", 10)]);
  off.d.tick(); await flush();
  assert.deepEqual(off.calls, [["stop"]]);
  const noZone = rig();
  noZone.noZone();
  noZone.d.add([play("Low", 10)]);
  noZone.d.tick(); await flush();
  assert.ok(!noZone.calls.some((c) => c[0] === "play"));
  assert.equal(noZone.d.status().waiting, 1);
});

test("the queue keeps the newest MAX_QUEUE plays", () => {
  const r = rig();
  const many = Array.from({ length: MAX_QUEUE + 3 }, (_, i) => play("t" + i, 5));
  assert.equal(r.d.add(many), MAX_QUEUE + 3, "all new");
  assert.equal(r.d.waiting(), MAX_QUEUE);
  assert.equal(r.saved.at(-1)[0], "t3", "the three oldest went");
});

test("a play is checked: album, track, index, elapsed and when", () => {
  assert.deepEqual(playOf({ album: " Low ", artist: "David Bowie", track: "Warszawa", index: 5, elapsed: 380.2, at: 1700000000000 }),
    { album: "Low", artist: "David Bowie", track: "Warszawa", index: 5, elapsed: 380.2, at: 1700000000000 });
  for (const bad of [null, {}, { album: "Low", track: "x", index: 0, elapsed: 1, at: 1 }, { album: "Low", artist: "B", track: "", index: 0, elapsed: 1, at: 1 }, { album: "Low", track: "x", index: -1, elapsed: 1, at: 1 },
    { album: "Low", track: "x", index: 0, elapsed: 0, at: 1 }, { album: "Low", track: "x", index: 0, elapsed: 1 }]) {
    assert.equal(playOf(bad), null, JSON.stringify(bad));
  }
});

/** The routes, called as Express would; [host]: the Core's (none: not paired). */
function routes(settings, host = null) {
  const r = {};
  const app = { get: (p, h) => { r["GET " + p] = h; }, post: (p, h) => { r["POST " + p] = h; } };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-catchup-"));
  let running = false;
  const player = { start() { running = true; }, stop() { running = false; }, setCap() {}, report() {},
    state: () => ({ running, connected: false, playing: false, elapsedMs: 0 }) };
  const catchup = mountCatchup(app, { root, host: () => host, zone: () => null, settings, core: () => null, libraryReady: () => false,
    relocate: () => -1, invokeTrackAction: () => Promise.resolve(), parseFilter: () => null, control: (z, op, done) => done(null),
    log: () => {}, player });
  const call = (m, p, body) => new Promise((resolve) => {
    const res = { code: 200, set() {}, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    r[m + " " + p]({ body }, res);
  });
  return { call, root, done: () => { catchup.stop(); fs.rmSync(root, { recursive: true, force: true }); } };
}
const ID = "0123456789abcdef0123456789abcdef";

test("THE one for the routes: off, the phone's plays are answered and not kept; on, kept on disk; the switch is the stored setting", async (t) => {
  let stored = {};
  const settings = { load: () => stored, save: (p) => { stored = Object.assign({}, stored, p); } };
  const r = routes(settings);
  t.after(r.done);
  const body = { device_id: ID, plays: [play("Warszawa", 380)] };
  assert.deepEqual((await r.call("POST", "/api/phone/plays", body)).body, { ok: true, kept: 0, waiting: 0, catchup: false });
  const on = await r.call("POST", "/api/catchup", { enabled: true });
  assert.equal(on.body.enabled, true);
  assert.equal(stored.catchupEnabled, true);
  assert.deepEqual((await r.call("POST", "/api/phone/plays", body)).body, { ok: true, kept: 1, waiting: 1, catchup: true });
  const kept = JSON.parse(fs.readFileSync(path.join(r.root, "data", "catchup-plays.json"), "utf8"));
  assert.deepEqual(kept.map((p) => p.track), ["Warszawa"]);
  const st = (await r.call("GET", "/api/catchup")).body;
  assert.equal(st.waiting, 1);
  assert.equal(st.zone_name, "Rouen catch-up");
  assert.equal((await r.call("POST", "/api/catchup", { enabled: "yes" })).code, 400);
  assert.equal((await r.call("POST", "/api/phone/plays", { device_id: ID, plays: [{ album: "x" }] })).code, 400);
  assert.equal((await r.call("POST", "/api/phone/plays", { device_id: "nope", plays: [] })).code, 400);
});

test("switched on while paired, the answer already says the player is joining Roon, not that Rouen isn't paired", async (t) => {
  let stored = {};
  const r = routes({ load: () => stored, save: (p) => { stored = Object.assign({}, stored, p); } }, "10.0.0.5");
  t.after(r.done);
  assert.equal((await r.call("POST", "/api/catchup", { enabled: true })).body.player.running, true);
  assert.equal((await r.call("POST", "/api/catchup", { enabled: false })).body.player.running, false);
});

test("THE one for invisibility: \"Rouen catch-up\" is in Roon's zones but in neither of Rouen's lists", () => {
  const zones = {
    z1: { zone_id: "z1", display_name: "Lounge", state: "stopped", outputs: [{ output_id: "o1", zone_id: "z1", display_name: "Lounge" }] },
    zc: { zone_id: "zc", display_name: NAME, state: "stopped", outputs: [{ output_id: "oc", zone_id: "zc", display_name: NAME }] },
  };
  const r = {};
  mountZoneReads({ get: (p, h) => { r[p] = h; } }, { core: () => ({}), zones: () => zones, outputs: () => ({}),
    zoneSettings: () => ({ shuffle: false, loop: "disabled", auto_radio: false }), noteLibraryClient() {}, creditLinks: () => [] });
  const get = (p) => { let out; r[p]({ query: {} }, { json: (b) => { out = b; }, status() { return this; }, set() {} }); return out; };
  assert.deepEqual(get("/api/zones").zones.map((z) => z.display_name), ["Lounge"]);
  assert.deepEqual(get("/api/outputs").outputs.map((o) => o.display_name), ["Lounge"]);
  assert.equal(isCatchupZone(zones.zc), true);
  assert.equal(isCatchupZone(zones.z1), false);
});

test("THE one for index.js's zones: the catch-up's zone is kept apart, never among Rouen's own — no default, radio or scrobble can pick it", () => {
  const k = createCatchupZones();
  const zc = { zone_id: "zc", display_name: NAME, outputs: [] };
  assert.equal(k.keep({ zone_id: "z1", display_name: "Lounge", outputs: [] }), true);
  assert.equal(k.keep(zc), false, "not into `zones`");
  assert.equal(k.current(), zc, "kept for the catch-up");
  assert.equal(k.keep({ zone_id: "zc", display_name: "Renamed in Roon", outputs: [] }), true, "renamed: an ordinary zone");
  assert.equal(k.current(), null);
  k.keep(zc);
  k.removed("zc");
  assert.equal(k.current(), null);
});

test("kept plays that can't be read are set aside, never written over", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rouen-plays-"));
  try {
    const file = path.join(dir, "catchup-plays.json");
    fs.writeFileSync(file, "[{\"album\": \"Lo");
    const said = [];
    const store = storeAt(file, (l) => said.push(l));
    assert.deepEqual(store.load(), []);
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.readdirSync(dir).filter((f) => f.startsWith("catchup-plays.json.unreadable-")).length, 1, "set aside beside it");
    assert.equal(said.length, 1);
    fs.writeFileSync(file, "{}");
    assert.deepEqual(store.load(), [], "not a list: set aside too");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
