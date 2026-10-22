"use strict";
// ---------------------------------------------------------------------------
// The hearts routes (lib/roon-direct/route.js, v1.9.27): what they accept, and
// that a Core call that throws is an answer, not a crash. marks.js itself is
// tested end to end in roon-direct-hearts.test.js.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountRoonDirect } = require("../../lib/roon-direct/route");

function rig(marks, finder) {
  const routes = {};
  const app = { get: (p, h) => { routes["GET " + p] = h; }, post: (p, h) => { routes["POST " + p] = h; } };
  mountRoonDirect(app, { status: () => ({}), unmatched: () => [], turnOn() {}, turnOff() {}, marks, finder,
    setProfile: (id) => (id === "cafebabe" ? { profile: id } : { error: "Your server has no such profile." }) });
  return async (method, p, o = {}) => {
    const res = { code: 200, body: null, set() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes[method + " " + p]({ query: o.query || {}, body: o.body }, res);
    return res;
  };
}
const calls = [];
const MARKS = {
  albumState: (t, a) => { calls.push(["state", t, a]); return { available: true, favorite: false }; },
  setAlbum: async (t, a, on) => { calls.push(["album", t, a, on]); return { ok: true, favorite: on }; },
  setTracks: async (t, a, titles, picks, on) => { calls.push(["tracks", t, a, titles, picks, on]); return { error: "Two tracks…", status: 409 }; },
};

test("the hearts routes: what they take, what they refuse", async () => {
  const call = rig(MARKS);
  assert.deepEqual((await call("GET", "/api/hearts/album", { query: { title: "Blue", artist: "Joni" } })).body, { available: true, favorite: false });
  assert.equal((await call("GET", "/api/hearts/album", { query: {} })).code, 400);
  assert.deepEqual((await call("POST", "/api/hearts/album", { body: { title: "Blue", artist: "Joni", on: true } })).body, { ok: true, favorite: true });
  for (const body of [{ title: "Blue", artist: "Joni", on: "yes" }, { artist: "Joni", on: true }, { title: "x".repeat(1001), on: true }]) {
    assert.equal((await call("POST", "/api/hearts/album", { body })).code, 400, JSON.stringify(body).slice(0, 60));
  }
  const tr = await call("POST", "/api/hearts/tracks", { body: { title: "Blue", artist: "Joni", titles: ["a", "b"], picks: [1], on: false } });
  assert.deepEqual([tr.code, tr.body], [409, { error: "Two tracks…" }]);
  assert.equal((await call("POST", "/api/hearts/tracks", { body: { title: "Blue", titles: ["a"], picks: [0.5], on: true } })).code, 400);
  assert.equal((await call("POST", "/api/hearts/tracks", { body: { title: "Blue", titles: "a", picks: [0], on: true } })).code, 400);
  assert.deepEqual(calls.map((c) => c[0]), ["state", "album", "tracks"], "a refused body reached marks");
});

test("a Core call that throws is a 502 with why, not a crash", async () => {
  const call = rig(Object.assign({}, MARKS, { setAlbum: async () => { throw new Error("the Core did not answer in 15000 ms"); } }));
  const r = await call("POST", "/api/hearts/album", { body: { title: "Blue", artist: "", on: true } });
  assert.deepEqual([r.code, r.body], [502, { error: "That didn't reach your server: the Core did not answer in 15000 ms" }]);
});

// N2b-1's check (v1.9.32, native-remote.md §9.1): what it takes, and that it passes on only that;
// begun by a POST and followed by GETs (v1.9.33, the review), a throw an answer rather than a crash.
test("the find route: 1 to 20 albums of TIDAL or Qobuz, each with a title; anything else refused", async () => {
  const asked = [];
  const call = rig(MARKS, { start: (list) => { asked.push(list); return { running: true, total: list.length }; },
    progress: () => ({ running: false, total: 1, findings: [{ title: "Blue", verdict: "found" }], error: null, max: 20, services: { tidal: "TIDAL" } }) });
  const ok = await call("POST", "/api/roon-direct/find", { body: { albums: [{ title: " Blue ", artist: "Joni", service: "tidal", extra: "x" }] } });
  assert.deepEqual([ok.code, ok.body], [200, { running: true, total: 1 }]);
  assert.deepEqual(asked[0], [{ title: "Blue", artist: "Joni", service: "tidal" }], "more than title, artist and service passed on");
  const got = await call("GET", "/api/roon-direct/find");
  assert.deepEqual([got.code, got.body.findings, got.body.max], [200, [{ title: "Blue", verdict: "found" }], 20]);
  const many = Array.from({ length: 21 }, () => ({ title: "x", artist: "y", service: "qobuz" }));
  for (const body of [{}, { albums: [] }, { albums: many }, { albums: [{ title: "x", service: "spotify" }] }, { albums: [{ title: "x", service: "toString" }] },
    { albums: [{ title: "  ", service: "tidal" }] }, { albums: [{ title: "x".repeat(1001), service: "tidal" }] }, { albums: ["Blue"] }]) {
    assert.equal((await call("POST", "/api/roon-direct/find", { body })).code, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.equal(asked.length, 1, "a refused body reached the server's search");
  const off = rig(MARKS, { start: () => ({ error: "Native mode is off.", status: 409 }) });
  const r = await off("POST", "/api/roon-direct/find", { body: { albums: [{ title: "x", artist: "", service: "tidal" }] } });
  assert.deepEqual([r.code, r.body], [409, { error: "Native mode is off." }]);
  const broken = rig(MARKS, { start: () => { throw new Error("no session"); } });
  const b = await broken("POST", "/api/roon-direct/find", { body: { albums: [{ title: "x", artist: "", service: "tidal" }] } });
  assert.deepEqual([b.code, b.body], [502, { error: "That didn't reach your server: no session" }]);
});

// v1.9.63 (the owner, native-remote.md §13): hearts are always on, so their switch's route is gone; whose stays.
test("THE one for v1.9.63: no route turns hearts off; the profile route stays", async () => {
  const routes = {};
  const app = { get: (p) => { routes["GET " + p] = true; }, post: (p) => { routes["POST " + p] = true; } };
  mountRoonDirect(app, { status: () => ({}), unmatched: () => [], turnOn() {}, turnOff() {}, marks: MARKS,
    setProfile: () => ({}) });
  assert.equal(routes["POST /api/roon-direct/hearts"], undefined, "hearts can still be switched off");
  assert.equal(routes["POST /api/roon-direct/profile"], true);
  const call = rig(MARKS);
  assert.equal((await call("POST", "/api/roon-direct/profile", { body: { id: "00ff00" } })).code, 404);
  assert.deepEqual((await call("POST", "/api/roon-direct/profile", { body: { id: "cafebabe" } })).body, { profile: "cafebabe" });
});
