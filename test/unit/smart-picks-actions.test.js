"use strict";
// ---------------------------------------------------------------------------
// What changes today's Smart Picks (lib/routes/smart-picks-actions.js): Rebuild and "Not for me", moved out of
// index.js unchanged in 2.0.7-t1, and Tune's routes (dev/design/smart-picks.md §5): the whole Tune checked before any
// of it is taken, saved, then today's picks rebuilt; one artist's More / Never from a pick. Each test was broken on
// purpose once and failed.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountSmartPicksActions } = require("../../lib/routes/smart-picks-actions");
const { defaultTune } = require("../../lib/smart-picks/tune");

const canon = (/** @type {string} */ s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function harness(o = {}) {
  const routes = {};
  const app = { get: (p, fn) => { routes["GET " + p] = fn; }, post: (p, fn) => { routes["POST " + p] = fn; } };
  const log = [];
  let saved = o.tune || defaultTune();
  let kicked = false;
  const db = o.noDb ? null : { prepare: (sql) => ({ run: (...a) => { if (o.dbThrows) throw new Error("disk"); log.push(sql.split(" WHERE")[0] + " " + a.join(",")); } }) };
  mountSmartPicksActions(app, {
    paired: () => o.paired !== false, today: () => "2026-11-26", dest: () => o.dest || "ask", db: () => db,
    attemptKey: (day) => "attempt:" + day, forgetLaterDay: (day) => log.push("forget day " + day),
    forgetPickArtist: (c) => log.push("forget artist " + c), bump: () => log.push("bump"), kick: () => { kicked = true; log.push("kick"); },
    // As index.js: a kick starts a build (none when Smart Picks is off), seen as running just after it.
    running: () => { if (o.running) return o.running.promise; const k = kicked; kicked = false; return k && !o.off ? Promise.resolve() : null; },
    log: (l) => log.push(l), canonArtist: canon, blockStmt: () => (o.noDb ? null : { run: (c) => log.push("block " + c) }),
    tune: () => saved, saveTune: (t) => { if (o.saveFails) return false; saved = t; log.push("save"); return true; },
    listened: () => ({ genres: [{ name: "Jazz", share: 0.6 }], decades: [{ name: "1970s", share: 1 }] }),
  });
  const call = (key, body) => {
    let status = 200; let out;
    const res = { status: (s) => { status = s; return res; }, json: (b) => { out = b; } };
    routes[key]({ body }, res);
    return { status, body: out };
  };
  return { call, log, saved: () => saved, get: (k) => routes[k] };
}

test("Rebuild: today's set and its attempt marker go, then the build runs now; Listen later's copies go too", () => {
  const h = harness({ dest: "later" });
  const r = h.call("POST /api/smart-picks/rebuild", {});
  assert.deepEqual(r.body, { ok: true, building: true });
  assert.deepEqual(h.log, ["forget day 2026-11-26", "DELETE FROM smart_picks 2026-11-26", "DELETE FROM smart_cache attempt:2026-11-26", "bump", "kick"]);
  assert.equal(harness({ paired: false }).call("POST /api/smart-picks/rebuild", {}).status, 503);
  const bad = harness({ dbThrows: true });
  assert.equal(bad.call("POST /api/smart-picks/rebuild", {}).status, 500);
  assert.ok(!bad.log.includes("kick"), "a rebuild that couldn't clear today's set started a build on top of it");
});

test("a change while a build runs: that build used the Tune before it, so today's set is built again once it ends, once", async () => {
  let done;
  const running = { promise: new Promise((r) => { done = r; }) };
  const h = harness({ running });
  h.call("POST /api/smart-picks/tune/artist", { name: "Keith Jarrett", as: "more" });
  h.call("POST /api/smart-picks/tune/artist", { name: "Jan Garbarek", as: "more" });
  assert.equal(h.log.filter((l) => l === "kick").length, 0, "kicked into a running build, which ignores it");
  running.promise = null;
  done();
  await new Promise((r) => { setTimeout(r, 0); });
  assert.equal(h.log.filter((l) => l === "kick").length, 1, "THE one (the review): the change made during a build was never built");
  assert.deepEqual(h.saved().more.map((a) => a.name), ["Keith Jarrett", "Jan Garbarek"]);
});

test("Tune saved with Smart Picks switched off says nothing is rebuilt", () => {
  const r = harness({ off: true }).call("POST /api/smart-picks/tune", { tune: { window: 1 } });
  assert.equal(r.body.rebuilding, false);
  assert.match(r.body.note, /switched off/);
});

test("Tune: a pick's artists' More / Never matched as the server matches names, not by spelling", () => {
  const h = harness();
  h.call("POST /api/smart-picks/tune/artist", { name: "The Necks", as: "never" });
  const r = h.call("POST /api/smart-picks/tune/artist", { name: "Keith Jarrett", as: "more", names: ["the necks!", "KEITH JARRETT", "Nobody"] });
  assert.deepEqual(r.body.states, { "the necks!": "never", "KEITH JARRETT": "more", Nobody: "none" }, "THE one (the review): the sheet guessed by spelling");
  let got;
  const res = { status: () => res, json: (b) => { got = b; } };
  h.get("GET /api/smart-picks/tune")({ query: { names: JSON.stringify(["the necks"]) } }, res);
  assert.deepEqual(got.states, { "the necks": "never" });
  h.get("GET /api/smart-picks/tune")({ query: { names: "not json" } }, res);
  assert.match(got.error, /JSON list/);
});

test("Not for me: blocked for ever, out of today's set and Listen later", () => {
  const h = harness();
  assert.deepEqual(h.call("POST /api/smart-picks/block", { artist: " Taylor Dayne " }).body, { ok: true, artist: "Taylor Dayne" });
  assert.deepEqual(h.log, ["block taylor dayne", "DELETE FROM smart_picks taylor dayne", "bump", "forget artist taylor dayne"]);
  assert.equal(h.call("POST /api/smart-picks/block", {}).status, 400);
  assert.equal(harness({ noDb: true }).call("POST /api/smart-picks/block", { artist: "X" }).status, 503);
});

test("Tune: GET says the Tune and what it can be set on", () => {
  const r = harness().call("GET /api/smart-picks/tune");
  assert.deepEqual(r.body.tune, { window: 2, adventure: 2, genres: {}, decades: {}, more: [], never: [] });
  assert.deepEqual(r.body.genres, [{ name: "Jazz", share: 0.6 }]);
  assert.equal(r.body.windows.length, 5);
  assert.equal(r.body.adventures.length, 5);
});

test("Tune: POST saves the whole Tune, then rebuilds today's picks; a bad field changes nothing", () => {
  const h = harness();
  const r = h.call("POST /api/smart-picks/tune", { tune: { window: 0, genres: { Jazz: "more" }, never: ["Bolton"] } });
  assert.equal(r.status, 200);
  assert.equal(r.body.rebuilding, true);
  assert.deepEqual(r.body.tune, { window: 0, adventure: 2, genres: { Jazz: "more" }, decades: {}, more: [], never: ["Bolton"] });
  assert.deepEqual(h.log.slice(0, 2), ["save", "DELETE FROM smart_picks 2026-11-26"], "THE one: saved but not rebuilt (a change rebuilds, §5)");
  assert.ok(h.log.includes("kick"));
  const before = h.saved();
  const bad = h.call("POST /api/smart-picks/tune", { tune: { window: 1, adventure: 7 } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /adventure/);
  assert.equal(h.saved(), before, "a refused Tune was half taken");
  // Reset: {} is "As I listen".
  h.call("POST /api/smart-picks/tune", { tune: {} });
  assert.deepEqual(h.saved(), defaultTune());
});

test("Tune: saved while not paired says so; a save that fails says so", () => {
  const off = harness({ paired: false });
  const r = off.call("POST /api/smart-picks/tune", { tune: { window: 4 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.rebuilding, false);
  assert.match(r.body.note, /once Rouen is paired/);
  assert.ok(!off.log.includes("kick"));
  assert.equal(harness({ saveFails: true }).call("POST /api/smart-picks/tune", { tune: {} }).status, 500);
});

test("Tune: one artist, More or Never or neither, from a pick", () => {
  const h = harness();
  assert.deepEqual(h.call("POST /api/smart-picks/tune/artist", { name: "Keith Jarrett", as: "more" }).body.tune.more, ["Keith Jarrett"]);
  const r = h.call("POST /api/smart-picks/tune/artist", { name: "keith jarrett", as: "never" }).body.tune;
  assert.deepEqual([r.more, r.never], [[], ["keith jarrett"]], "THE one: an artist left in More when set to Never");
  assert.equal(h.call("POST /api/smart-picks/tune/artist", { name: "X", as: "sometimes" }).status, 400);
  assert.equal(h.log.filter((l) => l === "kick").length, 2, "each change rebuilds");
});
