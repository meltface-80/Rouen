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
  const native = {
    async list() { return o.unread ? { notRead: "Your server's Listen Later can't be read." } : { entries: roon, at: 1000 }; },
    has(w) { return o.unread ? null : roon.some((e) => keyOf(e.title, e.artist) === keyOf(w.title, w.artist)); },
    async set(w, on) { sets.push([w, on]); return o.answer || { ok: true, on }; },
    refresh: async () => ({}), startCopy: () => ({ running: true, total: 1 }), copyProgress: () => ({ running: false, total: 0, done: [], error: null }),
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
    serviceUrl: () => null, keyOf, dbReady: () => true, refreshMs: 0,
  });
  const call = async (k, req) => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes[k](Object.assign({ query: {}, body: {} }, req), res);
    return res;
  };
  return { call, rows, sets, later };
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

test("the copy: begun with Rouen's rows, followed with how many of them Roon's list doesn't hold", async () => {
  const w = rig();
  assert.deepEqual((await w.call("POST /api/roon-later/copy")).body, { running: true, total: 1 });
  const p = (await w.call("GET /api/roon-later/copy")).body;
  assert.deepEqual([p.available, p.rouen, p.rouenOnly], [true, 1, 1]);
  assert.equal((await rig({ unread: true }).call("GET /api/roon-later/copy")).body.rouenOnly, null);
  assert.equal((await rig({ noNative: true }).call("POST /api/roon-later/copy")).code, 409);
});

test("refused before anything is asked: no title, no on, a title with no letters", async () => {
  const w = rig();
  assert.equal((await w.call("POST /api/listen-later", { body: { on: true } })).code, 400);
  assert.equal((await w.call("POST /api/listen-later", { body: { title: "Blue" } })).code, 400);
  assert.equal(w.sets.length, 0);
});
