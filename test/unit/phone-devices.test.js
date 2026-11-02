"use strict";
// v1.9.72-t5: the phones Rouen plays to (lib/phone/devices.js) and their API (lib/phone/routes.js; dev/design/
// android-app.md §4.10): hello, the commands long poll, a phone gone quiet leaving Roon, and every route's refusals.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDevices } = require("../../lib/phone/devices");
const { mountPhone, zoneNamed } = require("../../lib/phone/routes");

const ID = "0123456789abcdef0123456789abcdef";

/** A player that records what is asked of it; `send` is how it gives the phone a command. */
function fakePlayers() {
  const made = [];
  return { made, makePlayer: (o, send) => {
    const p = { o, send, running: false, starts: 0, stops: 0, reports: [], zoneName: "Rouen " + o.name,
      start() { this.running = true; this.starts++; }, stop() { this.running = false; this.stops++; },
      rename(n) { this.zoneName = "Rouen " + n; }, setQuality(q) { this.o.quality = q; },
      report(r) { this.reports.push(r); }, notes: [], note(w) { this.notes.push(w); },
      session: (n) => (n === 1 ? { n: 1, quality: "opus", pipeTo: (res, done) => { res.write(Buffer.from("OggS")); if (done) done({ sent: 4, why: "all sent" }); res.end(); } } : null),
      info: () => ({}) };
    made.push(p);
    return p;
  } };
}

test("hello starts the phone's player; a second hello renames it and changes its quality; no Core, no hello", (t) => {
  const P = fakePlayers();
  let host = null;
  const D = createDevices({ host: () => host, makePlayer: P.makePlayer });
  t.after(() => D.stopAll());
  assert.equal(D.hello({ device_id: ID, name: "Pixel", quality: "opus" }), null);
  host = "192.168.1.2";
  assert.deepEqual(D.hello({ device_id: ID, name: "Pixel", quality: "opus" }), { device_id: ID, zone_name: "Rouen Pixel", seq: 0, open: null });
  assert.equal(P.made[0].running, true);
  assert.equal(P.made[0].o.host, "192.168.1.2");
  assert.equal(D.hello({ device_id: ID, name: "Pixel 8", quality: "lossless" }).zone_name, "Rouen Pixel 8");
  assert.equal(P.made.length, 1);
  assert.equal(P.made[0].o.quality, "lossless");
});

test("the long poll: what is there comes at once, else it waits for the next; a phone that has not said hello is told to", async (t) => {
  const P = fakePlayers();
  const D = createDevices({ host: () => "h", makePlayer: P.makePlayer });
  t.after(() => D.stopAll());
  assert.equal(D.poll(ID, 0, 1000), null);
  D.hello({ device_id: ID, name: "Pixel", quality: "opus" });
  P.made[0].send({ op: "open", session: 1, url: "/u", play: true });
  assert.deepEqual(await D.poll(ID, 0, 1000), { seq: 1, commands: [{ seq: 1, op: "open", session: 1, url: "/u", play: true }] });
  const waiting = D.poll(ID, 1, 5000);
  setTimeout(() => P.made[0].send({ op: "pause" }), 30);
  assert.deepEqual(await waiting, { seq: 2, commands: [{ seq: 2, op: "pause" }] });
  assert.deepEqual(await D.poll(ID, 2, 30), { seq: 2, commands: [] }, "nothing new in the wait: an empty answer");
  // The session playing is given again to a phone that says hello again (it restarted), paused as it is now.
  assert.deepEqual(D.hello({ device_id: ID, name: "Pixel", quality: "opus" }).open, { op: "open", session: 1, url: "/u", play: false });
});

test("a phone that has not polled for 45 s leaves Roon; its next poll brings it back", async (t) => {
  const P = fakePlayers();
  let clock = 0;
  const intervals = [];
  const timers = { setInterval: (f) => { intervals.push(f); return intervals.length; }, clearInterval() {}, setTimeout, clearTimeout };
  const D = createDevices({ host: () => "h", makePlayer: P.makePlayer, now: () => clock, timers });
  t.after(() => D.stopAll());
  D.hello({ device_id: ID, name: "Pixel", quality: "opus" });
  clock = 44000; intervals[0]();
  assert.equal(P.made[0].running, true);
  clock = 46000; intervals[0]();
  assert.equal(P.made[0].running, false);
  D.poll(ID, 0, 0);
  assert.equal(P.made[0].running, true);
});

/** The routes, called as Express would. */
function api(deps) {
  const routes = {};
  const app = { get: (p, h) => { routes["GET " + p] = h; }, post: (p, h) => { routes["POST " + p] = h; } };
  mountPhone(app, deps);
  return (method, p, { query = {}, body = {} } = {}) => new Promise((resolve) => {
    const res = { code: 200, headers: {}, chunks: [], set(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; },
      json(b) { resolve({ code: this.code, body: b }); }, write(b) { this.chunks.push(b); return true; },
      end() { resolve({ code: this.code, headers: this.headers, body: Buffer.concat(this.chunks).toString() }); }, on() {}, once() {} };
    Promise.resolve(routes[method + " " + p]({ query, body }, res));
  });
}

test("the routes: refusals, the session sent, Roon's metadata, and the phone's buttons asking Roon on its own zone", async (t) => {
  const P = fakePlayers();
  const D = createDevices({ host: () => "h", makePlayer: P.makePlayer });
  t.after(() => D.stopAll());
  const zones = { z9: { zone_id: "z9", display_name: "Rouen Pixel", state: "playing",
    now_playing: { length: 300, seek_position: 12, image_key: "img1", three_line: { line1: "So What", line2: "Miles Davis", line3: "Kind of Blue" } } } };
  const asked = [];
  const call = api({ devices: D, zones: () => zones, control: (z, op, done) => { asked.push([z, op]); done(null); } });
  for (const bad of [{}, { device_id: "x", name: "a", quality: "opus" }, { device_id: ID, name: "", quality: "opus" }, { device_id: ID, name: "a", quality: "mp3" }]) {
    assert.equal((await call("POST", "/api/phone/hello", { body: bad })).code, 400, JSON.stringify(bad));
  }
  assert.equal((await call("GET", "/api/phone/commands", { query: { device_id: ID, after: "0", wait: "0" } })).code, 409);
  assert.equal((await call("POST", "/api/phone/hello", { body: { device_id: ID, name: "Pixel", quality: "opus" } })).code, 200);
  assert.equal((await call("GET", "/api/phone/commands", { query: { device_id: ID, after: "x" } })).code, 400);
  assert.deepEqual((await call("GET", "/api/phone/commands", { query: { device_id: ID, after: "0", wait: "0" } })).body, { seq: 0, commands: [] });
  assert.equal((await call("POST", "/api/phone/state", { body: { device_id: ID, session: 1, position: -1, state: "playing" } })).code, 400);
  assert.equal((await call("POST", "/api/phone/state", { body: { device_id: ID, session: 1, position: 5, state: "dancing" } })).code, 400);
  assert.deepEqual((await call("POST", "/api/phone/state", { body: { device_id: ID, session: 1, position: 5, state: "playing" } })).body, { ok: true });
  assert.deepEqual(P.made[0].reports, [{ session: 1, position: 5, state: "playing" }]);
  const audio = await call("GET", "/api/phone/audio", { query: { device_id: ID, session: "1" } });
  assert.equal(audio.headers["Content-Type"], "audio/ogg");
  assert.equal(audio.body, "OggS");
  assert.equal((await call("GET", "/api/phone/audio", { query: { device_id: ID, session: "2" } })).code, 404);
  assert.deepEqual((await call("GET", "/api/phone/now", { query: { device_id: ID } })).body,
    { zone_id: "z9", state: "playing", title: "So What", artist: "Miles Davis", album: "Kind of Blue", image_key: "img1", length: 300, seek: 12 });
  assert.equal((await call("POST", "/api/phone/control", { body: { device_id: ID, op: "dance" } })).code, 400);
  assert.deepEqual((await call("POST", "/api/phone/control", { body: { device_id: ID, op: "next" } })).body, { ok: true });
  assert.deepEqual(asked, [["z9", "next"]]);
  delete zones.z9;
  const missing = await call("POST", "/api/phone/control", { body: { device_id: ID, op: "pause" } });
  assert.equal(missing.code, 404);
  assert.match(missing.body.error, /enable it in Roon, Settings → Audio/);
  assert.equal(zoneNamed({ a: { display_name: "x", outputs: [{ display_name: "Rouen Pixel" }] } }, "Rouen Pixel").display_name, "x");
});

test("hello says whether the phone came over the tailnet, and gives Rouen's tailnet address (v1.9.72-t7, §4.7)", async () => {
  const P = fakePlayers();
  const D = createDevices({ host: () => "h", makePlayer: P.makePlayer });
  let address = null;
  const call = api({ devices: D, zones: () => ({}), control: (z, op, done) => done(null),
    away: (req) => req.ip === "100.90.1.7", awayAddress: () => address });
  const body = { device_id: ID, name: "Pixel", quality: "opus" };
  const home = await call("POST", "/api/phone/hello", { body });
  assert.equal(home.body.away, false);
  assert.equal(home.body.away_address, null, "not on a tailnet: none");
  address = "http://100.90.1.2:3399";
  const routes = {};
  mountPhone({ get: (p, h) => { routes["GET " + p] = h; }, post: (p, h) => { routes["POST " + p] = h; } },
    { devices: D, zones: () => ({}), control: (z, op, done) => done(null), away: (req) => req.ip === "100.90.1.7", awayAddress: () => address });
  const away = await new Promise((resolve) => {
    routes["POST /api/phone/hello"]({ body, ip: "100.90.1.7" }, { status() { return this; }, json: resolve });
  });
  assert.equal(away.away, true);
  assert.equal(away.away_address, "http://100.90.1.2:3399");
  assert.equal(away.zone_name, "Rouen Pixel");
  D.stopAll();
});

test("hello gives the Core's SlimProto host and port, for the app's own player at home (§4.21, v1.9.72-t42)", async () => {
  const P = fakePlayers();
  const D = createDevices({ host: () => "h", makePlayer: P.makePlayer });
  const body = { device_id: ID, name: "Pixel", quality: "opus" };
  const withHost = await api({ devices: D, zones: () => ({}), control: (z, op, done) => done(null), coreHost: () => "10.0.0.5" })("POST", "/api/phone/hello", { body });
  assert.equal(withHost.body.core_host, "10.0.0.5");
  assert.equal(withHost.body.slim_port, 3483);
  // No Core host known (not paired yet, or no dep): core_host is null, the port still named.
  const noHost = await api({ devices: D, zones: () => ({}), control: (z, op, done) => done(null), coreHost: () => null })("POST", "/api/phone/hello", { body });
  assert.equal(noHost.body.core_host, null);
  assert.equal(noHost.body.slim_port, 3483);
  const noDep = await api({ devices: D, zones: () => ({}), control: (z, op, done) => done(null) })("POST", "/api/phone/hello", { body });
  assert.equal(noDep.body.core_host, null, "no coreHost dep: null, not a crash");
  D.stopAll();
});

test("the phone's player's error rides with its report, cut to 200 characters (v1.9.72-t10)", async () => {
  const P = fakePlayers();
  const D = createDevices({ host: () => "h", makePlayer: P.makePlayer });
  const call = api({ devices: D, zones: () => ({}), control: (z, op, done) => done(null) });
  await call("POST", "/api/phone/hello", { body: { device_id: ID, name: "Pixel", quality: "lossless" } });
  await call("POST", "/api/phone/state", { body: { device_id: ID, session: 2, position: 0, state: "stopped", error: "ERROR_CODE_DECODING_FAILED " + "x".repeat(300) } });
  const r = P.made[0].reports[0];
  assert.equal(r.state, "stopped");
  assert.equal(r.error.length, 200);
  assert.match(r.error, /^ERROR_CODE_DECODING_FAILED x+$/);
  D.stopAll();
});

test("what a phone's zone is hearing, for Now playing's badge: Opus 256kbps, or lossless with its depth and rate (v1.9.72-t11)", () => {
  const formats = { opus: null, lossless: null };
  const made = [];
  const D = createDevices({ host: () => "h", makePlayer: (o) => {
    const p = { o, running: true, zoneName: "Rouen " + o.name, start() {}, stop() {}, rename() {}, setQuality() {}, report() {}, session: () => null,
      info: () => ({ format: formats[o.quality] }) };
    made.push(p);
    return p;
  } });
  D.hello({ device_id: ID, name: "Pixel", quality: "opus" });
  D.hello({ device_id: ID.replace(/0/g, "1"), name: "Tab", quality: "lossless" });
  const zone = (name) => ({ display_name: "Living Room", outputs: [{ display_name: name }] });
  assert.equal(D.formatFor(zone("Rouen Pixel")), null, "no session open: no badge");
  formats.opus = { quality: "opus", rate: 48000, bits: null };
  formats.lossless = { quality: "lossless", rate: 96000, bits: 24 };
  assert.deepEqual(D.formatFor(zone("Rouen Pixel")), { kind: "opus", text: "256kbps" });
  assert.deepEqual(D.formatFor({ display_name: "Rouen Tab" }), { kind: "lossless", text: "Lossless · 24-bit/96 kHz" });
  formats.lossless = { quality: "lossless", rate: 44100, bits: 16 };
  assert.deepEqual(D.formatFor({ display_name: "Rouen Tab" }), { kind: "lossless", text: "Lossless · 16-bit/44.1 kHz" });
  assert.equal(D.formatFor(zone("Kitchen")), null, "not a phone's zone");
  assert.equal(D.formatFor(null), null);
  D.stopAll();
});

test("the audio route writes the phone's fetch into its trail: the session asked for, and how its sending ended (v1.9.72-t17)", async (t) => {
  // The owner's log of 2026-10-29: a session stalled after 12 s at home, and Rouen's side could not say whether the
  // session stopped growing or the phone stopped taking it.
  const P = fakePlayers();
  const D = createDevices({ host: () => "h", makePlayer: P.makePlayer });
  t.after(() => D.stopAll());
  const call = api({ devices: D, zones: () => ({}), control: () => {} });
  await call("POST", "/api/phone/hello", { body: { device_id: ID, name: "Pixel", quality: "opus" } });
  await call("GET", "/api/phone/audio", { query: { device_id: ID, session: "1" } });
  assert.equal(P.made[0].notes.length, 2);
  assert.match(P.made[0].notes[0], /^the phone fetches session 1 \(opus\)$/);
  assert.match(P.made[0].notes[1], /^session 1 to the phone: 4 bytes in \d+ ms, all sent$/);
});
