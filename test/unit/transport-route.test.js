"use strict";
// ---------------------------------------------------------------------------
// Playing, seeking and volume (lib/routes/transport.js, v1.9.65, native-remote.md §14.3): native first; not sent →
// the official API, whatever it was; sent and not seen → the safe ones again through the official API, while next,
// previous, the play/pause toggle and seek are only said (the owner: a slow server must not skip two tracks). The
// routes themselves moved out of index.js unchanged but for the transport they call.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { createNativeFirst, mountTransport, SAFE } = require("../../lib/routes/transport");

/** o.native: what the native transport answers (an object, or "throw"), null for none; official calls recorded. */
function rig(o = {}) {
  const official = [];
  const answer = (cb) => cb(o.officialErr || null);
  const t = o.unpaired ? null : {
    control: (id, c, cb) => { official.push(["control", id, c]); answer(cb); },
    seek: (id, how, s, cb) => { official.push(["seek", id, how, s]); answer(cb); },
    change_volume: (id, how, v, cb) => { official.push(["volume", id, how, v]); answer(cb); },
    mute: (id, how, cb) => { official.push(["mute", id, how]); answer(cb); },
    change_settings: (id, p, cb) => { official.push(["settings", id, p]); answer(cb); },
  };
  const asked = [];
  const reply = async (what) => { asked.push(what); if (o.native === "throw") throw new Error("boom"); return o.native; };
  const native = o.native === null ? null : {
    command: (id, c) => reply(["command", id, c]), seek: (id, s) => reply(["seek", id, s]),
    volume: (id, how, v) => reply(["volume", id, how, v]), mute: (id, on) => reply(["mute", id, on]), settings: (id, p) => reply(["settings", id, p]),
  };
  const nf = createNativeFirst({ official: () => t, native: () => native, log: () => {} });
  const call = (fn) => new Promise((resolve) => { fn(nf, (err, via) => resolve({ err, via })); });
  return { nf, call, official, asked };
}

test("THE one: seen through the server — answered via roon, the official API never asked", async () => {
  const w = rig({ native: { seen: true } });
  assert.deepEqual(await w.call((t, cb) => t.control("z1", "next", cb)), { err: null, via: { via: "roon" } });
  assert.deepEqual(w.asked, [["command", "z1", "next"]]);
  assert.deepEqual(w.official, []);
});

test("not sent: the official API takes it, every control alike, saying why", async () => {
  for (const [fn, sent] of [
    [(t, cb) => t.control("z1", "next", cb), ["control", "z1", "next"]],
    [(t, cb) => t.seek("z1", "absolute", 30, cb), ["seek", "z1", "absolute", 30]],
    [(t, cb) => t.change_volume("o1", "relative", -2, cb), ["volume", "o1", "relative", -2]],
    [(t, cb) => t.mute("o1", "unmute", cb), ["mute", "o1", "unmute"]],
    [(t, cb) => t.change_settings("z1", { loop: "loop" }, cb), ["settings", "z1", { loop: "loop" }]]]) {
    const w = rig({ native: { notSent: "Native mode is off." } });
    assert.deepEqual(await w.call(fn), { err: null, via: { via: "official", why: "Native mode is off." } });
    assert.deepEqual(w.official, [sent]);
  }
  const none = rig({ native: null });
  assert.deepEqual(await none.call((t, cb) => t.control("z1", "pause", cb)), { err: null, via: { via: "official" } });
  const threw = rig({ native: "throw" });
  assert.deepEqual((await threw.call((t, cb) => t.control("z1", "pause", cb))).via, { via: "official", why: "boom" });
  assert.equal(threw.official.length, 1);
});

test("THE one for the owner's rule: sent, not seen — play, pause, stop, volume, mute and settings again officially; next, previous, the toggle and seek only said", async () => {
  const notSeen = { seen: false, why: "The zone didn't show it within 3 s." };
  for (const [fn, again] of [
    [(t, cb) => t.control("z1", "play", cb), true], [(t, cb) => t.control("z1", "pause", cb), true], [(t, cb) => t.control("z1", "stop", cb), true],
    [(t, cb) => t.change_volume("o1", "absolute", 20, cb), true], [(t, cb) => t.mute("o1", "mute", cb), true],
    [(t, cb) => t.change_settings("z1", { shuffle: true }, cb), true],
    [(t, cb) => t.control("z1", "next", cb), false], [(t, cb) => t.control("z1", "previous", cb), false],
    [(t, cb) => t.control("z1", "playpause", cb), false], [(t, cb) => t.seek("z1", "absolute", 30, cb), false]]) {
    const w = rig({ native: notSeen });
    const r = await w.call(fn);
    assert.equal(w.official.length, again ? 1 : 0, fn.toString());
    if (again) assert.deepEqual(r, { err: null, via: { via: "official", why: notSeen.why } });
    else assert.match(r.err, /^Your server took the (next|previous|play\/pause|seek), but the zone didn't show it in time, so Rouen didn't send it again\./);
  }
  assert.deepEqual([...SAFE].sort(), ["mute", "pause", "play", "settings", "stop", "volume"]);
});

test("not paired: said, nothing sent", async () => {
  const w = rig({ unpaired: true, native: { notSent: "Native mode is off." } });
  assert.deepEqual(await w.call((t, cb) => t.control("z1", "pause", cb)), { err: "Not paired with Roon Core", via: { via: "official" } });
});

test("the moved routes: what they take and refuse as before, each answer saying where it went", async () => {
  const routes = {};
  const app = { post: (p, h) => { routes[p] = h; } };
  const state = { core: {}, zones: { z1: { outputs: [{ output_id: "o1" }, { output_id: "o2" }] } }, outputs: { o3: { output_id: "o3" } } };
  const w = rig({ native: { seen: true } });
  mountTransport(app, { core: () => state.core, zones: () => state.zones, outputs: () => state.outputs, transport: w.nf });
  const call = (p, body) => new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); return this; } };
    routes[p]({ body }, res);
  });
  assert.equal((await call("/api/control", { zone_or_output_id: "z1", command: "dance" })).code, 400);
  assert.equal((await call("/api/control", { command: "play" })).code, 400);
  assert.deepEqual(await call("/api/control", { zone_or_output_id: "z1", command: "play" }), { code: 200, body: { ok: true, via: "roon" } });
  assert.equal((await call("/api/seek", { zone_or_output_id: "z1", seconds: -1 })).code, 400);
  assert.deepEqual((await call("/api/seek", { zone_or_output_id: "z1", seconds: 61.6 })).body, { ok: true, via: "roon" });
  assert.deepEqual(w.asked.at(-1), ["seek", "z1", 62]);
  // A zone's volume goes to each of its outputs.
  assert.deepEqual((await call("/api/volume", { zone_or_output_id: "z1", value: 20 })).body, { ok: true, via: "roon" });
  assert.deepEqual(w.asked.slice(-2), [["volume", "o1", "absolute", 20], ["volume", "o2", "absolute", 20]]);
  assert.equal((await call("/api/volume", { zone_or_output_id: "nope", value: 1 })).code, 404);
  assert.equal((await call("/api/volume", { zone_or_output_id: "o3" })).code, 400);
  state.core = null;
  assert.equal((await call("/api/control", { zone_or_output_id: "z1", command: "play" })).code, 503);
});

test("a zone's volume, one output through the server and one not: the answer says official", async () => {
  const routes = {};
  let n = 0;
  const nf = createNativeFirst({ official: () => ({ change_volume: (id, how, v, cb) => cb(null) }), log: () => {},
    native: () => ({ volume: async () => (n++ === 0 ? { seen: true } : { notSent: "Rouen couldn't tell which of your server's outputs is \"B\"." }) }) });
  mountTransport({ post: (p, h) => { routes[p] = h; } }, { core: () => ({}), zones: () => ({ z1: { outputs: [{ output_id: "o1" }, { output_id: "o2" }] } }),
    outputs: () => ({}), transport: nf });
  const body = await new Promise((resolve) => {
    routes["/api/volume"]({ body: { zone_or_output_id: "z1", relative: 2 } }, { status() { return this; }, json: resolve });
  });
  assert.equal(body.via, "official");
});

// The review of v1.9.65.
test("the review: a volume step is only said; a newer control makes an older one's resend stale; an answer that throws is caught", async () => {
  const notSeen = { seen: false, why: "The zone didn't show it within 3 s." };
  const step = rig({ native: notSeen });
  const r = await step.call((t, cb) => t.change_volume("o1", "relative", 2, cb));
  assert.equal(step.official.length, 0, "a volume step sent twice: it moves twice");
  assert.match(r.err, /^Your server took the volume step/);
  // 10 → 20 → 30: the 20 isn't seen (the zone shows 30), and isn't sent again over the 30.
  let release;
  const gate = new Promise((res) => { release = res; });
  const official = [];
  const nf = createNativeFirst({ log: () => {}, official: () => ({ change_volume: (id, how, v, cb) => { official.push(v); cb(null); } }),
    native: () => ({ volume: async (id, how, v) => { if (v === 20) { await gate; return notSeen; } return { seen: true }; } }) });
  const first = new Promise((res) => { nf.change_volume("o1", "absolute", 20, (err, via) => res(via)); });
  await new Promise((res) => { nf.change_volume("o1", "absolute", 30, () => res()); });
  release();
  assert.deepEqual(await first, { via: "roon", why: "A newer control followed it." });
  assert.deepEqual(official, [], "the older volume sent again over the newer");
  // A throw in the route's answer is logged, not an unhandled rejection.
  const logged = [];
  const quiet = createNativeFirst({ log: (l) => logged.push(l), official: () => null, native: () => ({ command: async () => ({ seen: true }) }) });
  await new Promise((res) => { quiet.control("z1", "pause", () => { setImmediate(res); throw new Error("headers already sent"); }); });
  assert.match(logged[0], /pause: the answer failed: headers already sent/);
});
