"use strict";
/*
 * GET /api/queue, moved out of index.js unchanged in 2.0.6-t2 (lib/routes/queue.js): not paired, 503; no zone, 400;
 * the queue's first payload as rows (three_line first) beside what the zone already played; the subscription let go once
 * answered; an error name, 502.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { mountQueue } = require("../../lib/routes/queue");
const { indexSource } = require("../lib/extract");

/** The route, and a call of it. */
function route(core) {
  let handler = null;
  mountQueue({ get: (p, h) => { assert.equal(p, "/api/queue"); handler = h; } }, { core: () => core, history: (z) => [{ zone: z, title: "Earlier" }] });
  return (query) => new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ status: this.code, body: b }); } };
    handler({ query }, res);
  });
}

test("not paired, or no zone: said", async () => {
  assert.equal((await route(null)({ zone: "z" })).status, 503);
  assert.equal((await route({})({})).status, 400);
});

test("the queue as rows beside what was played, and the subscription let go", async () => {
  let unsubscribed = 0;
  const core = { services: { RoonApiTransport: { subscribe_queue: (zone, count, cb) => {
    assert.equal(count, 100);
    setTimeout(() => cb("Subscribed", { items: [{ queue_item_id: 7, three_line: { line1: "Big Big Train", line2: "The Artist" }, one_line: { line1: "Big Big Train - The Artist" }, image_key: "k", length: 300 }] }), 5);
    return { unsubscribe: () => { unsubscribed++; } };
  } } } };
  const r = await route(core)({ zone: "z1" });
  assert.deepEqual(r.body, { items: [{ queue_item_id: 7, title: "Big Big Train", subtitle: "The Artist", image_key: "k", length: 300 }], history: [{ zone: "z1", title: "Earlier" }] });
  assert.equal(unsubscribed, 1);
  const bad = { services: { RoonApiTransport: { subscribe_queue: (z, c, cb) => { setTimeout(() => cb("NetworkError"), 5); return { unsubscribe() {} }; } } } };
  const e = await route(bad)({ zone: "z1" });
  assert.equal(e.status, 502);
  assert.match(e.body.error, /NetworkError/);
});

test("index.js mounts it with its Core and what each zone played, capped at 50", () => {
  assert.match(indexSource(), /\nmountQueue\(app, \{ core: \(\) => core, history: \(zoneId\) => recentHistory\(zoneHistory\.get\(zoneId\), 50\) \}\);\n/);
});
