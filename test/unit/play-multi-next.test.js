"use strict";
// ---------------------------------------------------------------------------
// v1.8.80: Play next for several albums (Mandarin v0.6.22).
//
// What the user chose goes straight after the track playing, in the order they
// chose it, and the old queue follows on after. /api/play-multi used to send
// the first album with the chosen kind and QUEUE the rest — which, for Play
// next, put albums 2..N at the far end of the queue, behind everything already
// waiting. Now every album is Roon's Add Next, sent last first (each one lands
// in front of the one before), one at a time.
//
// The handler is the SHIPPING source, sliced out of index.js and compiled with
// stand-ins for the Core, so this exercises the real route.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { indexSource } = require("../lib/extract");
const { sendOrderFor } = require("../../lib/queue-history");

function loadHandler() {
  const src = indexSource();
  const at = src.indexOf('app.post("/api/play-multi", ');
  assert.ok(at > 0, "the play-multi route moved");
  const start = src.indexOf("async (req, res) =>", at);
  const end = src.indexOf("\n});", start);
  const body = src.slice(start, end + 2);
  // eslint-disable-next-line no-new-func
  return new Function("core", "parseFilter", "openAlbumByOffset", "sendOrderFor", "playMultiZones",
                      "return (" + body + ");");
}

function run(kind, items, opts = {}) {
  const sent = [];
  const zones = new Set();
  const handler = loadHandler()(
    {},                                   // core: paired
    () => null,                           // parseFilter
    async (offset, zone, k) => {          // openAlbumByOffset
      if (opts.fail && opts.fail.includes(offset)) {
        const e = new Error("refused " + offset); if (opts.stale) e.stale = true; throw e;
      }
      sent.push({ offset, zone, kind: k });
    },
    sendOrderFor,
    zones,
  );
  let status = 200, body = null;
  const res = {
    status(c) { status = c; return this; },
    json(b) { body = b; return this; },
  };
  return handler({ body: { items, zone_or_output_id: "z1", kind } }, res)
    .then(() => ({ status, body, sent, zones }));
}

const A = { offset: 10, title: "A", subtitle: "x" };
const B = { offset: 20, title: "B", subtitle: "y" };
const C = { offset: 30, title: "C", subtitle: "z" };

test("Play next sends every album as Add Next, last picked first", async () => {
  const r = await run("play_next", [A, B, C]);
  assert.equal(r.status, 200);
  assert.deepEqual(r.sent.map((s) => s.kind), ["play_next", "play_next", "play_next"],
    "an album after the first was queued at the end instead of played next");
  assert.deepEqual(r.sent.map((s) => s.offset), [30, 20, 10],
    "Add Next stacks, so the picks must go out last first to arrive in the order chosen");
  assert.equal(r.body.queued, 3);
  assert.equal(r.zones.size, 0, "the per-zone guard was not released");
});

test("Play now and Queue are unchanged: the first with the kind, the rest queued in order", async () => {
  for (const kind of ["play_now", "queue"]) {
    const r = await run(kind, [A, B, C]);
    assert.equal(r.status, 200);
    assert.deepEqual(r.sent.map((s) => s.offset), [10, 20, 30]);
    assert.deepEqual(r.sent.map((s) => s.kind), [kind, "queue", "queue"]);
  }
});

test("one refused album does not abandon the rest; counts travel", async () => {
  const r = await run("play_next", [A, B, C], { fail: [20] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.sent.map((s) => s.offset), [30, 10]);
  assert.equal(r.body.queued, 2);
  assert.equal(r.body.failed, 1);
  assert.match(r.body.first_error, /refused 20/);
});

test("every album refused is an error; a stale offset keeps the 409 contract", async () => {
  const r = await run("play_next", [A, B], { fail: [10, 20] });
  assert.equal(r.status, 500);
  const s = await run("play_next", [A], { fail: [10], stale: true });
  assert.equal(s.status, 409);
  assert.equal(s.zones.size, 0, "a failed run left the zone locked");
});

test("a second run on the same zone is refused while one is going", async () => {
  const zones = new Set(["z1"]);
  const handler = loadHandler()({}, () => null, async () => {}, sendOrderFor, zones);
  let status = 200;
  await handler({ body: { items: [A], zone_or_output_id: "z1", kind: "play_next" } },
                { status(c) { status = c; return this; }, json() { return this; } });
  assert.equal(status, 409);
});
