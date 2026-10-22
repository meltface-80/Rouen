"use strict";
// ---------------------------------------------------------------------------
// N2e-1's routes (lib/routes/smart-roon.js, native-remote.md §12.3): Roon's
// smart playlists listed, a page read, a play sent — and what is said when
// native mode is off, nothing could be sent, or a play was sent and not shown.
// The native side is a stand-in for lib/roon-direct/smart.js, whose own test
// runs it against the fake server.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountSmartRoon } = require("../../lib/routes/smart-roon");

function rig(native) {
  const routes = {};
  const app = { get: (p, fn) => { routes["GET " + p] = fn; }, post: (p, fn) => { routes["POST " + p] = fn; } };
  mountSmartRoon(app, { smart: () => native });
  return async (k, req) => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes[k](Object.assign({ query: {}, body: {} }, req), res);
    return res;
  };
}

test("native mode off: the list isn't available, with no reason, and a page or a play is a 409", async () => {
  const call = rig(null);
  assert.deepEqual((await call("GET /api/roon-smart")).body, { available: false, why: "" });
  assert.equal((await call("GET /api/roon-smart/items", { query: { id: "ab12" } })).code, 409);
  assert.equal((await call("POST /api/roon-smart/play", { body: { id: "ab12", zone_or_output_id: "z" } })).code, 409);
});

test("the list, and why not when it can't be read", async () => {
  const lists = [{ playlists: [{ id: "ab12", name: "r&b random", tracks: 5007 }] }, { notSent: "Your server didn't send its playlists." }];
  const call = rig({ async list() { return lists.shift(); } });
  // moved: false with nothing moved (§12.16).
  assert.deepEqual((await call("GET /api/roon-smart")).body, { available: true, playlists: [{ id: "ab12", name: "r&b random", tracks: 5007, moved: false }] });
  assert.deepEqual((await call("GET /api/roon-smart")).body, { available: false, why: "Your server didn't send its playlists." });
});

test("a page: the id is checked, the page number passed on, and a refusal said", async () => {
  const asked = [];
  const call = rig({ async page(id, page) { asked.push([id, page]); return page > 4 ? { notSent: "Rouen shows the first 500 tracks of a smart playlist." } : { name: "x", count: 1, page, pages: 1, items: [], complete: true }; } });
  assert.equal((await call("GET /api/roon-smart/items", { query: { id: "../x" } })).code, 400);
  assert.equal((await call("GET /api/roon-smart/items", { query: { id: "ab12", page: "1" } })).body.page, 1);
  const r = await call("GET /api/roon-smart/items", { query: { id: "ab12", page: "5" } });
  assert.equal(r.code, 409);
  assert.match(r.body.error, /first 500/);
  assert.deepEqual(asked, [["ab12", 1], ["ab12", 5]]);
});

test("a play: shuffle only when true; not sent is a 409, sent and not shown a 502 that says it was sent", async () => {
  const answers = [{ ok: true, by: "id" }, { notSent: "Choose a zone to play on first." }, { notShown: "Your server took it, but the zone didn't start playing." }];
  const plays = [];
  const call = rig({ async play(id, zone, shuffle) { plays.push([id, zone, shuffle]); return answers.shift(); } });
  assert.equal((await call("POST /api/roon-smart/play", { body: { id: "ab12" } })).code, 400);
  assert.deepEqual((await call("POST /api/roon-smart/play", { body: { id: "ab12", zone_or_output_id: "z1", shuffle: "yes" } })).body, { ok: true, by: "id" });
  assert.equal((await call("POST /api/roon-smart/play", { body: { id: "ab12", zone_or_output_id: "z1", shuffle: true } })).code, 409);
  const r = await call("POST /api/roon-smart/play", { body: { id: "ab12", zone_or_output_id: "z1" } });
  assert.equal(r.code, 502);
  assert.equal(r.body.sent, true);
  assert.deepEqual(plays, [["ab12", "z1", false], ["ab12", "z1", true], ["ab12", "z1", false]]);
});
