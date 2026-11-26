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
let Database = null;
try { Database = require("../../lib/sqlite-compat").adapterOver(require("node:sqlite")); } catch (e) {
  // node:sqlite is Node 22.5+'s: without it, the tests of whose each album is (2.0.7-t5) skip, said as skipped
}
const { loadIndexFunctions } = require("../lib/extract");
// Rouen's own album key, as index.js gives the module (v1.9.49: the bug was in what it can't key).
const { albumKey } = loadIndexFunctions(["albumKey", "normalize", "canonText", "canonArtist"], {});

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
    entryOf(w) { return o.unread ? null : roon.find((e) => keyOf(e.title, e.artist) === keyOf(w.title, w.artist)) || false; },
    entries() { return o.unread ? null : roon; },
    async set(w, on) { sets.push([w, on]); return o.answer || { ok: true, on }; },
    refreshed: [], async refresh(age) { native.refreshed.push(age); return {}; },
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
  const clock = { t: 1000000 };
  const record = (title, artist) => LIBRARY.find((a) => keyOf(a.title, a.subtitle) === keyOf(title, artist)) || null;
  const matches = (title, artist, rs) => (rs || rows).filter((r) => r.key === keyOf(title, artist));
  const later = mountListenLater(app, {
    native: () => (o.noNative ? null : native), rows: () => rows, record, matches,
    add: (e) => { if (!matches(e.title, e.artist).length) rows.push({ key: keyOf(e.title, e.artist), title: e.title, artist: e.artist, source: e.source || "album", ts: 9 }); return true; },
    remove: (title, artist) => { const n = rows.length; rows.splice(0, rows.length, ...rows.filter((r) => r.key !== keyOf(title, artist))); return n - rows.length; },
    favourites: async () => ({ qobuz: null, tidal: null }), withSource: (a) => Object.assign({ badge: true }, a),
    serviceUrl: () => null, keyOf: o.keyOf || keyOf, dbReady: () => true, writable: () => !o.frozen, refreshMs: 0, now: () => clock.t,
    cover: o.cover, owners: o.owners, viewer: o.viewer, linked: o.linked,
  });
  const call = async (k, req) => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes[k](Object.assign({ query: {}, body: {} }, req), res);
    return res;
  };
  // The app's live poll, as index.js's own GET /api/live follows this module's (passed on with next()).
  const live = async () => { let passed = false; await routes["GET /api/live"]({}, {}, () => { passed = true; }); await new Promise((r) => { setImmediate(r); }); return passed; };
  return { call, rows, sets, later, native, sess, live, clock };
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

test("while Listen later is looked at, the live poll keeps Roon's list read: one try in 20 s, for 10 minutes after the list was asked for", async () => {
  const w = rig();
  assert.equal(await w.live(), true, "the live poll held up");
  assert.deepEqual(w.native.refreshed, [], "read for a device that never asked for Listen later (a Shelf left on)");
  await w.call("GET /api/listen-later");
  assert.equal(await w.live(), true);
  assert.deepEqual(w.native.refreshed, [10000], "asked for a list under 20 s old: a read just short of that would wait a second slot");
  assert.deepEqual(w.native.moves, [["Blue"]], "the read not followed by the move");
  w.clock.t += 3000;
  await w.live();
  assert.deepEqual(w.native.refreshed, [10000], "tried again within 20 s — on every poll of every device when a read fails");
  w.clock.t += 17000;
  await w.live();
  assert.deepEqual(w.native.refreshed, [10000, 10000]);
  w.clock.t += 10 * 60 * 1000;
  await w.live();
  assert.equal(w.native.refreshed.length, 2, "read on, 10 minutes after the list was last asked for");
  assert.equal(await rig({ noNative: true }).live(), true);
});

// v1.9.49, the owner's report: Ed Sheeran's "+" said "unrecognisable album title". Rouen keys its own list by an album's
// letters and digits, and "+" has none; your server names an album by its own id, so its list never needed that key.
test("an album whose title has no letters or digits (\"+\"): put on your server's list, not refused for Rouen's own key", async () => {
  assert.equal(albumKey("+", "Ed Sheeran"), null, "precondition: Rouen's own key can't name it");
  const w = rig({ keyOf: albumKey });
  const on = await w.call("POST /api/listen-later", { body: { title: "+", artist: "Ed Sheeran", on: true } });
  assert.deepEqual([on.code, on.body], [200, { ok: true, on: true, roon: true }]);
  assert.deepEqual(w.sets.map((x) => [x[0].title, x[1]]), [["+", true]]);
  const off = await w.call("POST /api/listen-later", { body: { title: "+", artist: "Ed Sheeran", on: false } });
  assert.deepEqual([off.code, off.body], [200, { ok: true, on: false, roon: true }]);
  // Native mode off, or your server couldn't take it: Rouen's own list can't hold it, said as such.
  const own = rig({ keyOf: albumKey, noNative: true });
  const kept = await own.call("POST /api/listen-later", { body: { title: "+", artist: "Ed Sheeran", on: true } });
  assert.equal(kept.code, 400);
  assert.match(kept.body.error, /Rouen's own Listen later can't hold an album with a title like this one/);
  // Taken off: nothing of it on Rouen's own list, so nothing to refuse.
  assert.deepEqual((await own.call("POST /api/listen-later", { body: { title: "+", artist: "Ed Sheeran", on: false } })).body, { ok: true, on: false });
  const notSent = rig({ keyOf: albumKey, answer: { notSent: "Your server's search didn't find this album on TIDAL or Qobuz." } });
  const said = await notSent.call("POST /api/listen-later", { body: { title: "+", artist: "Ed Sheeran", on: true } });
  assert.equal(said.code, 400);
  assert.match(said.body.error, /^Your server's search didn't find this album on TIDAL or Qobuz\. Rouen's own Listen later can't hold/);
});

test("refused before anything is asked: no title, no on", async () => {
  const w = rig();
  assert.equal((await w.call("POST /api/listen-later", { body: { on: true } })).code, 400);
  assert.equal((await w.call("POST /api/listen-later", { body: { title: "Blue" } })).code, 400);
  assert.equal(w.sets.length, 0);
});

test("v1.9.62 (native-remote.md §12.17): a cover your server names by its own key is given as its library album's, or none — never one that can't load", async () => {
  const w = rig({ cover: (k) => ({ k7: "img3" })[k] || null });
  const got = (await w.call("GET /api/listen-later")).body;
  assert.deepEqual(got.albums.map((a) => [a.title, a.image]), [["Dummy", "/api/image/img3?size=500"], ["Homogenic", ""]]);
});

// P2 (2.0.7-t4, profiles.md §5, §10.17): a device's own routes act in Roon for its Rouen profile's Roon profile; the
// moves onto Roon's are the household's, so they run outside the request that set them going (lib/profiles/context.js).
const { deviceCtx } = require("../lib/device-context");

test("P2: Rouen's own list moves onto the Roon profile chosen in Native mode, not the device's that opened Listen later", async () => {
  const d = deviceCtx();
  const w = rig();
  const seen = [];
  const { move, has } = w.native;
  w.native.move = (rows, moved) => { seen.push(["move", d.seen()]); return move(rows, moved); };
  w.native.has = (x) => { seen.push(["has", d.seen()]); return has(x); };
  let inside = null;
  await d.run(async () => { inside = d.seen(); await w.call("GET /api/listen-later"); });
  assert.deepEqual(inside, { viewer: { id: "2", legacy: false }, roon: "deadbeef" }, "the request was not the device's");
  assert.ok(seen.some((s) => s[0] === "move"), "no move");
  assert.deepEqual(seen.filter((s) => s[1].viewer !== null || s[1].roon !== null), [], "THE one: the move ran as the device's request");
});

// 2.0.7-t5 (profiles.md §12, the owner's answers §10.18): Roon's list stays the one store; each profile sees what it put
// aside and what no profile did; Guest sees the shared ones; taken off while another profile has it, only the tag goes.
test("Listen later per profile: each sees its own and the household's; one taken off another's still has stays", { skip: !Database }, async () => {
  const { createLaterOwners } = require("../../lib/listen-later/owners");
  const db = new Database(":memory:");
  const owners = createLaterOwners({ db: () => db });
  owners.migrate(db);
  let who = "1";
  const w = rig({ owners, viewer: () => who });
  const titles = async () => (await w.call("GET /api/listen-later", {})).body.albums.map((a) => a.title);
  assert.deepEqual(await titles(), ["Dummy", "Homogenic"], "the household's (no tag) not everyone's");
  // Dummy is on Roon's list: putting it aside is the tag only, nothing sent to Roon.
  assert.deepEqual((await w.call("POST /api/listen-later", { body: { title: "Dummy", artist: "Portishead", on: true } })).body, { ok: true, on: true, roon: true });
  assert.deepEqual(w.sets, [], "an album already on Roon's list sent again");
  who = "2";
  assert.deepEqual(await titles(), ["Homogenic"], "THE one: profile 1's album shown to profile 2");
  assert.equal(w.later.has("Dummy", "Portishead"), false, "the album view said profile 1's is on profile 2's list");
  who = "";
  assert.deepEqual(await titles(), ["Homogenic"], "Guest sees a profile's own");
  // Profile 2 puts Dummy aside too; profile 1 takes it off: only 1's tag goes, Roon's list is untouched.
  who = "2";
  await w.call("POST /api/listen-later", { body: { title: "Dummy", artist: "Portishead", on: true } });
  who = "1";
  assert.deepEqual((await w.call("POST /api/listen-later", { body: { title: "Dummy", artist: "Portishead", on: false } })).body, { ok: true, on: false, roon: true });
  assert.deepEqual(w.sets, [], "taken off Roon's list while another profile has it");
  assert.deepEqual(await titles(), ["Homogenic"]);
  who = "2";
  assert.deepEqual(await titles(), ["Dummy", "Homogenic"], "profile 2 lost it when profile 1 took it off");
  await w.call("POST /api/listen-later", { body: { title: "Dummy", artist: "Portishead", on: false } });
  assert.deepEqual(w.sets.map(([x, on]) => [x.title, on]), [["Dummy", false]], "the last one's not taken off Roon's list");
  // The household's taken off by anyone: off Roon's list.
  await w.call("POST /api/listen-later", { body: { title: "Homogenic", artist: "Björk", on: false } });
  assert.deepEqual(w.sets.map(([x, on]) => [x.title, on]), [["Dummy", false], ["Homogenic", false]]);
  // A Smart Pick sent to Listen later is its profile's.
  await w.later.put({ title: "Selected Ambient Works 85-92", artist: "Aphex Twin", profile: "1" });
  assert.deepEqual(owners.exportAll().map((r) => [r.title, r.profile]), [["Selected Ambient Works 85-92", "1"]]);
});

test("Listen later per profile, native mode off: Rouen's own list, the same way", { skip: !Database }, async () => {
  const { createLaterOwners } = require("../../lib/listen-later/owners");
  const db = new Database(":memory:");
  const owners = createLaterOwners({ db: () => db });
  owners.migrate(db);
  let who = "1";
  const w = rig({ noNative: true, owners, viewer: () => who });
  const titles = async () => (await w.call("GET /api/listen-later", {})).body.albums.map((a) => a.title);
  await w.call("POST /api/listen-later", { body: { title: "Dummy", artist: "Portishead", on: true } });
  assert.deepEqual((await titles()).sort(), ["Blue", "Dummy"]);
  who = "2";
  assert.deepEqual(await titles(), ["Blue"], "THE one: profile 1's album on profile 2's list");
  assert.equal(w.later.has("Dummy", "Portishead"), false);
  assert.equal(w.later.has("Blue", "Joni Mitchell"), true, "the household's hidden");
  await w.call("POST /api/listen-later", { body: { title: "Dummy", artist: "Portishead", on: false } });
  who = "1";
  assert.deepEqual((await titles()).sort(), ["Blue", "Dummy"], "profile 2 took profile 1's album off the list");
});

// The review of 2.0.7-t5: a removal Roon's list didn't take keeps the tags; a pick stays a pick; tags of albums on
// neither list go after a whole read; a linked device's own Roon list has no tags; one sent and not shown is tagged.
test("Listen later per profile, the review: failed removals, picks, the tidy-up, linked devices", { skip: !Database }, async () => {
  const { createLaterOwners } = require("../../lib/listen-later/owners");
  const make = () => { const db = new Database(":memory:"); const o = createLaterOwners({ db: () => db }); o.migrate(db); return o; };
  const DUMMY = { key: keyOf("Dummy", "Portishead"), albumId: null };
  // Taken off, Roon's list unreadable: kept on it, so its tags stay (else it is everyone's).
  let owners = make();
  let w = rig({ owners, viewer: () => "1", answer: { notSent: "Your server's Listen Later can't be read." } });
  await w.call("POST /api/listen-later", { body: { title: "Dummy", artist: "Portishead", on: true } });
  await w.call("POST /api/listen-later", { body: { title: "Dummy", artist: "Portishead", on: false } });
  assert.equal(owners.viewFor("2")(DUMMY), false, "THE one: a removal Roon's list never took made profile 1's album everyone's");
  // A pick put aside from its card is a pick; put aside again from the album view, still a pick.
  owners = make();
  w = rig({ owners, viewer: () => "1" });
  await w.call("POST /api/listen-later", { body: { title: "Dummy", artist: "Portishead", on: true, source: "picks" } });
  await w.call("POST /api/listen-later", { body: { title: "Dummy", artist: "Portishead", on: true } });
  assert.deepEqual(owners.exportAll().map((t) => t.source), ["picks"], "a pick's tag lost its source: Not for me would miss it");
  // The tidy-up: after a whole read, a tag whose album is on neither list goes; one on Roon's list stays.
  owners.claim("1", { key: keyOf("Gone", "Nobody"), albumId: null, title: "Gone", artist: "Nobody" });
  await w.call("GET /api/listen-later", {});
  assert.deepEqual(owners.exportAll().map((t) => t.title), ["Dummy"], "a tag of an album taken off in Roon's app kept: put back, it would be hidden");
  // A device acting for its own Roon profile: that list is its own already — no tags written, none hiding.
  owners = make();
  owners.claim("2", { key: keyOf("Homogenic", "Björk"), albumId: null, title: "Homogenic", artist: "Björk" });
  w = rig({ owners, viewer: () => "1", linked: () => true });
  assert.deepEqual((await w.call("GET /api/listen-later", {})).body.albums.map((a) => a.title), ["Dummy", "Homogenic"], "another profile's tag hid an album on a linked device's own list");
  await w.call("POST /api/listen-later", { body: { title: "Dummy", artist: "Portishead", on: true } });
  assert.deepEqual(owners.exportAll().map((t) => t.title), ["Homogenic"], "tagged on a linked device's own Roon list");
  // Sent and not shown: Roon may hold it, so it is this profile's.
  owners = make();
  w = rig({ owners, viewer: () => "1", answer: { notShown: "not shown" } });
  await w.call("POST /api/listen-later", { body: { title: "Mezzanine", artist: "Massive Attack", on: true } });
  assert.deepEqual(owners.exportAll().map((t) => [t.title, t.profile]), [["Mezzanine", "1"]]);
});
