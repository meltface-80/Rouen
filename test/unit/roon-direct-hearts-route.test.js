"use strict";
// ---------------------------------------------------------------------------
// The hearts routes (lib/roon-direct/route.js, v1.9.27): what they accept, and
// that a Core call that throws is an answer, not a crash. marks.js itself is
// tested end to end in roon-direct-hearts.test.js.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountRoonDirect } = require("../../lib/roon-direct/route");

function rig(marks) {
  const routes = {};
  const app = { get: (p, h) => { routes["GET " + p] = h; }, post: (p, h) => { routes["POST " + p] = h; } };
  mountRoonDirect(app, { status: () => ({}), unmatched: () => [], turnOn() {}, turnOff() {}, marks });
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
  assert.deepEqual([r.code, r.body], [502, { error: "Your server didn't answer: the Core did not answer in 15000 ms" }]);
});
