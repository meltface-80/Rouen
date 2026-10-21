"use strict";
// ---------------------------------------------------------------------------
// Listen later's routes (lib/routes/listen-later.js, moved out of index.js in
// v1.9.45) and N2c-2 (native-remote.md §10.4): Roon's own list in place of
// Rouen's with native mode on, Rouen's own when it can't be read or a change
// can't be sent — said — and only said when one was sent and not shown.
// The native side here is a stand-in for lib/roon-direct/later.js, whose own
// test runs it against the fake server.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountListenLater } = require("../../lib/routes/listen-later");

const keyOf = (title, artist) => (title ? `${title.toLowerCase()}||${String(artist || "").toLowerCase()}` : null);
const LIBRARY = [{ title: "Dummy", subtitle: "Portishead", offset: 3, image_key: "img3" }];

function rig(o = {}) {
  const rows = [{ key: keyOf("Blue", "Joni Mitchell"), title: "Blue", artist: "Joni Mitchell", service: null, album_id: null, image: null, source: "album", ts: 5 }];
  const sets = [];
  const roon = [{ title: "Dummy", artist: "Portishead", service: "tidal", inLibrary: true, albumId: "7", imageKey: "k7", at: "2026-10-21T10:00:00.000Z" },
    { title: "Homogenic", artist: "Björk", service: "qobuz", inLibrary: false, albumId: "8", imageKey: "k8", at: null }];
  const sess = { n: 1 };   // the connection Roon's list was read on
  const native = {
    async list() { return o.unread ? { notRead: "Your server's Listen Later can't be read." } : { entries: roon, at: 1000 }; },
    has(w) { return o.unread ? null : roon.some((e) => keyOf(e.title, e.artist) === keyOf(w.title, w.artist)); },
    async set(w, on) { sets.push([w, on]); return o.answer || { ok: true, on }; },
    refresh: async () => ({}),
    // The move (v1.9.47): what the native side would hand back as on Roon's list, at once.
    listedOn: () => (o.unread ? null : sess.n), moves: [],
    move(rows, moved) {
      if (o.busyOnce && !native.refused) { native.refused = true; return { error: "Rouen's Listen Later is already being moved." }; }
      native.moves.push(rows.map((r) => r.title)); for (const r of rows) if (r.title !== "Further") moved(r); return { running: true, total: rows.length };
    },
    moveProgress: () => ({ running: false, total: 1, done: [{ title: "Further", artist: "Flying Saucer Attack", result: "failed", why: "Not found." }], error: null, at: 5 }),
  };
  const routes = {};
  const app = { get: (p, fn) => { routes["GET " + p] = fn; }, post: (p, fn) => { routes["POST " + p] = fn; } };
  const record = (title, artist) => LIBRARY.find((a) => keyOf(a.title, a.subtitle) === keyOf(title, artist)) || null;
  const matches = (title, artist, rs) => (rs || rows).filter((r) => r.key === keyOf(title, artist));
  const later = mountListenLater(app, {
    native: () => (o.noNative ? null : native), rows: () => rows, record, matches,
    add: (e) => { if (!matches(e.title, e.artist).length) rows.push({ key: keyOf(e.title, e.artist), title: e.title, artist: e.artist, source: e.source || "album", ts: 9 }); return true; },
    remove: (title, artist) => { const n = rows.length; rows.splice(0, rows.length, ...rows.filter((r) => r.key !== keyOf(title, artist))); return n - rows.length; },
    favourites: async () => ({ qobuz: null, tidal: null }), withSource: (a) => Object.assign({ badge: true }, a),
    serviceUrl: () => null, keyOf, dbReady: () => true, writable: () => !o.frozen, refreshMs: 0,
  });
  const call = async (k, req) => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes[k](Object.assign({ query: {}, body: {} }, req), res);
    return res;
  };
  return { call, rows, sets, later, native, sess };
}

test("native mode on: the list is Roon's, each album in Rouen's shape — playable when in the library, its cover your server's", async () => {
  const w = rig();
  const got = (await w.call("GET /api/listen-later")).body;
  assert.equal(got.roon, true);
  assert.deepEqual(got.albums.map((a) => [a.title, a.service, a.offset, a.image, a.source]), [
    ["Dummy", "tidal", 3, "/api/image/k7?size=500", "roon"], ["Homogenic", "qobuz", null, "/api/image/k8?size=500", "roon"]]);
  assert.equal(got.albums[0].added_at, Date.parse("2026-10-21T10:00:00.000Z"));
  assert.equal(got.albums[1].added_at, 1000, "no time given: when the list was read");
  assert.deepEqual(got.albums[0].album, { badge: true, offset: 3, title: "Dummy", subtitle: "Portishead", image_key: "img3" });
  // The album view and Smart Picks ask the same list.
  assert.equal(w.later.has("Homogenic", "Björk"), true);
  assert.equal(w.later.has("Blue", "Joni Mitchell"), false, "Rouen's own list is not used while Roon's is in force");
});

test("Roon's list can't be read, or native mode off: Rouen's own, as before", async () => {
  for (const o of [{ unread: true }, { noNative: true }]) {
    const w = rig(o);
    const got = (await w.call("GET /api/listen-later")).body;
    assert.equal(got.roon, undefined);
    assert.deepEqual(got.albums.map((a) => a.title), ["Blue"]);
    assert.equal(w.later.has("Blue", "Joni Mitchell"), true);
  }
});

test("a change goes to Roon's list; not sent: kept on Rouen's and said; sent and not shown: only said; native off: Rouen's, nothing said", async () => {
  const w = rig();
  const on = await w.call("POST /api/listen-later", { body: { title: "Dummy", artist: "Portishead", on: true, service: "tidal" } });
  assert.deepEqual(on.body, { ok: true, on: true, roon: true });
  assert.deepEqual(w.sets[0], [{ title: "Dummy", artist: "Portishead", service: "tidal", alt: { title: "Dummy", artist: "Portishead" } }, true]);
  assert.equal(w.rows.length, 1, "nothing kept on Rouen's own list");

  const notSent = rig({ answer: { notSent: "Your server's search didn't find this album on TIDAL or Qobuz." } });
  const kept = await notSent.call("POST /api/listen-later", { body: { title: "Further", artist: "Flying Saucer Attack", on: true } });
  assert.equal(kept.body.ok, true);
  assert.match(kept.body.kept, /didn't find this album.*on Rouen's own Listen later instead/);
  assert.deepEqual(notSent.rows.map((r) => r.title), ["Blue", "Further"]);

  const notShown = rig({ answer: { notShown: "Your server took it, but its Listen Later didn't show it on the list." } });
  const said = await notShown.call("POST /api/listen-later", { body: { title: "Further", artist: "Flying Saucer Attack", on: true } });
  assert.equal(said.code, 502);
  assert.match(said.body.error, /didn't show it/);
  assert.equal(notShown.rows.length, 1, "sent: it may yet take, so not kept twice");

  const off = rig({ answer: { off: true } });
  const plain = await off.call("POST /api/listen-later", { body: { title: "Blue", artist: "Joni Mitchell", on: false } });
  assert.deepEqual(plain.body, { ok: true, on: false });
  assert.equal(off.rows.length, 0);
});

test("a Smart Pick sent to Listen later: Roon's list, else Rouen's — never both", async () => {
  const w = rig();
  await w.later.put({ title: "Homogenic", artist: "Björk", service: "qobuz", album_id: "q1", source: "picks" });
  assert.equal(w.rows.length, 1);
  const notShown = rig({ answer: { notShown: "x" } });
  await notShown.later.put({ title: "Homogenic", artist: "Björk", source: "picks" });
  assert.equal(notShown.rows.length, 1);
  const notSent = rig({ answer: { notSent: "x" } });
  await notSent.later.put({ title: "Homogenic", artist: "Björk", source: "picks" });
  assert.deepEqual(notSent.rows.map((r) => [r.title, r.source]), [["Blue", "album"], ["Homogenic", "picks"]]);
});

test("Rouen's own list moves onto Roon's by itself, once a connection: what Roon's list shows leaves Rouen's, the rest stays and is said", async () => {
  const w = rig();
  w.rows.push({ key: keyOf("Further", "Flying Saucer Attack"), title: "Further", artist: "Flying Saucer Attack", source: "album", ts: 6 });
  await w.call("GET /api/listen-later");
  assert.deepEqual(w.native.moves, [["Blue", "Further"]]);
  assert.deepEqual(w.rows.map((r) => r.title), ["Further"], "Blue moved, so it left Rouen's list");
  await w.call("GET /api/listen-later");
  assert.equal(w.native.moves.length, 1, "moved again on the same connection");
  w.sess.n = 2;   // a new connection: what's left is tried again
  const st = (await w.call("GET /api/roon-later/move")).body;
  assert.deepEqual(w.native.moves, [["Blue", "Further"], ["Further"]]);
  assert.deepEqual([st.available, st.rouen, st.left.map((x) => x.title)], [true, 1, ["Further"]]);
});

test("the review: what Roon's list holds leaves Rouen's own on every read; a refused start is tried again; a removal clears Rouen's too", async () => {
  const w = rig();
  await w.call("GET /api/listen-later");
  // On the same connection, after its move: an album both lists hold (shown late, or put back by hand) leaves Rouen's.
  w.rows.push({ key: keyOf("Homogenic", "Björk"), title: "Homogenic", artist: "Björk", source: "album", ts: 7 });
  await w.call("GET /api/listen-later");
  assert.deepEqual(w.rows, [], "an album on Roon's list kept on Rouen's, to be sent again on the next connection");
  assert.equal(w.native.moves.length, 1);
  const busy = rig({ busyOnce: true });
  await busy.call("GET /api/listen-later");
  assert.deepEqual(busy.native.moves, [], "precondition: the first start refused");
  await busy.call("GET /api/listen-later");
  assert.deepEqual(busy.native.moves, [["Blue"]], "a refused start used up this connection's move");
  const off = rig({ noMove: true });
  off.native.listedOn = () => null;   // nothing moved: the row stays until the removal
  await off.call("POST /api/listen-later", { body: { title: "Blue", artist: "Joni Mitchell", on: false } });
  assert.deepEqual(off.rows, [], "taken off Roon's list and left on Rouen's, to come back on the next move");
});

test("no move while Roon's list can't be read, nor while Rouen restarts after a restore", async () => {
  for (const o of [{ unread: true }, { frozen: true }]) {
    const w = rig(o);
    await w.call("GET /api/listen-later");
    await w.call("GET /api/roon-later/move");
    assert.deepEqual(w.native.moves, []);
    assert.equal(w.rows.length, 1);
  }
  assert.deepEqual((await rig({ noNative: true }).call("GET /api/roon-later/move")).body, { available: false });
});

test("refused before anything is asked: no title, no on, a title with no letters", async () => {
  const w = rig();
  assert.equal((await w.call("POST /api/listen-later", { body: { on: true } })).code, 400);
  assert.equal((await w.call("POST /api/listen-later", { body: { title: "Blue" } })).code, 400);
  assert.equal(w.sets.length, 0);
});
