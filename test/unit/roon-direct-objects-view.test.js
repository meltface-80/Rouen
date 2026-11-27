"use strict";
// ---------------------------------------------------------------------------
// What fills the connection's objects (lib/roon-direct/objects-view.js, 2.0.8-t4): the owner's server ran out of room
// ("the Core's objects reached the cap Rouen keeps"; the P3-probe's "under 25,000 objects of room left"), and nothing
// said what took it. Read-only: nothing is sent to the server.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { objectsView, mountObjectsView, TOP } = require("../../lib/roon-direct/objects-view");

/** A connection holding `n` objects of each type given. @param {Record<string, number>} types @param {number} [max] */
function link(types, max = 200000) {
  const objects = new Map();
  let oid = 1;
  for (const [t, n] of Object.entries(types)) for (let i = 0; i < n; i++) objects.set(String(oid), { oid: BigInt(oid++), typeName: t, loaded: !t.includes("Lazy") });
  return { session: () => ({ graph: { objects, maxObjects: max } }), status: () => ({ reconnects: 5, lastDown: { why: "the Core's objects reached the cap Rouen keeps" } }) };
}

test("THE one: the objects held by type, most first, with the room left and the reconnects", () => {
  const v = objectsView(link({ "Sooloos.Broker.Api.TrackLite": 30, "Sooloos.Broker.Api.AlbumLite": 50, "Sooloos.Broker.Api.LazyRow": 5 }, 100));
  assert.deepEqual(v, { connected: true, held: 85, max: 100, roomLeft: 15,
    byType: [{ type: "AlbumLite", count: 50 }, { type: "TrackLite", count: 30 }, { type: "LazyRow", count: 5 }],
    otherTypes: 0, otherCount: 0, unloaded: 5, reconnects: 5, lastDown: { why: "the Core's objects reached the cap Rouen keeps" } });
});

test("past the first forty types, the rest summed; no connection, said so", () => {
  const many = {};
  for (let i = 0; i < TOP + 3; i++) many["T" + i] = TOP + 3 - i;
  const v = /** @type {any} */ (objectsView(link(many)));
  assert.equal(v.byType.length, TOP);
  assert.deepEqual([v.otherTypes, v.otherCount], [3, 3 + 2 + 1]);
  assert.deepEqual(objectsView(null), { connected: false });
  assert.deepEqual(objectsView({ session: () => null, status: () => ({}) }), { connected: false });
});

test("the route: what it reads, never cached; native mode not available here, 503", () => {
  const routes = {};
  const app = { get: (p, fn) => { routes[p] = fn; } };
  let view = () => objectsView(link({ X: 1 }));
  mountObjectsView(app, () => view());
  const res = { code: 200, body: null, headers: {}, set(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  routes["/api/debug/roon-objects"]({}, res);
  assert.deepEqual([res.code, res.body.held, res.headers["Cache-Control"]], [200, 1, "no-store"]);
  view = () => null;
  const off = { code: 200, body: null, set() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  routes["/api/debug/roon-objects"]({}, off);
  assert.deepEqual([off.code, off.body], [503, { error: "Native mode isn't available here." }]);
});
